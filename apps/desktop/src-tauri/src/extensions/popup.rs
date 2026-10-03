//! An extension's popup: its own page, in a webview of its own, inside nib's bubble.
//!
//! What a browser does when the extension's button is pressed - a small window under the
//! button holding `chrome-extension://<id>/<popup>`, sized to what the page lays out, at
//! most 800 by 600 - done the one way both engines allow: a child webview, in the store
//! the tab is in, so the page is the extension's own and talks to its own background. The
//! window draws the bubble round it and says where; this builds the page, puts it there,
//! and says how large the page wants to be.
//!
//! **Sized the way Chromium sizes one.** The page is laid out at the smallest size first
//! and asked how wide and tall it then is, which is the page's own idea of its width -
//! a popup sets one, almost always - and asked again at that width for its height, and
//! again a moment later, because most popups draw themselves after they load.
//!
//! **One at a time, and never past what opened it.** A second press closes the first, as
//! does Escape inside the popup, the page asking to close itself, and anything the window
//! decides (a press outside, the tab going away); see lib/web-tab/WebExtensionPopup.svelte.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter as _, LogicalPosition, LogicalSize, Manager as _, Url, Webview,
    WebviewBuilder, WebviewUrl,
};

/// The popup's label: under the `web-` prefix every page of the web wears, so no
/// capability names it.
pub const LABEL: &str = "web-extension-popup";

/// What the window hears: the size the page wants, or that it closed.
const SAID: &str = "nib://extension-popup";

/// Chromium's bounds for a popup, in CSS pixels.
const SMALLEST: f64 = 25.0;
const WIDEST: f64 = 800.0;
const TALLEST: f64 = 600.0;

/// The width a popup is given when it lays itself out to whatever width it has - a page
/// whose width is the window's, as Bitwarden's is - and so says nothing of its own: the
/// width most popups set for themselves.
const FLUID: f64 = 380.0;

/// Below this, a page that came back as narrow as it was laid out has no width of its own.
const NO_WIDTH: f64 = 100.0;

/// When the page is asked its size again after it has loaded, in milliseconds since.
const ASKED_AT: [u64; 4] = [0, 150, 500, 1200];

/// Where the window wants the popup, in its own coordinates.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the window is told.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Said {
    /// The size the page lays itself out at.
    Size { width: u32, height: u32 },
    /// The page closed, or asked to.
    Closed,
}

/// Opens extension `id`'s popup at `rect`'s corner, in the store of tab `tab`, the one
/// it was pressed in, closing any other.
#[tauri::command]
pub async fn extension_popup_open(
    webview: Webview,
    id: String,
    tab: String,
    store: Option<String>,
    rect: Rect,
) -> Result<(), String> {
    let app = webview.app_handle().clone();
    close_now(&app);
    let finding = app.clone();
    let address: Url =
        tauri::async_runtime::spawn_blocking(move || super::page_of(&finding, &id, false))
            .await
            .map_err(|error| error.to_string())??
            .parse()
            .map_err(|_| "that extension's popup has no address".to_string())?;
    let store = crate::web_stores::named(store.as_deref())?.map(str::to_owned);

    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(blank()?))
        .focused(crate::placement::away().is_none())
        .disable_drag_drop_handler()
        .on_navigation(crate::web_tabs::tab_may_open);
    let builder = crate::engine::web_store(builder, &app, store.as_deref())?;
    let measuring = app.clone();
    let builder = builder.on_page_load(move |view, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            && super::ours(payload.url())
        {
            let (app, view) = (measuring.clone(), view.clone());
            std::thread::spawn(move || measure(&app, &view));
        }
    });
    let holder = webview.window().label().to_string();
    let opening = app.clone();
    let builder = builder.on_new_window(move |url: Url, _| {
        // A link in the popup, or the extension opening a page of its own: a tab, as
        // everywhere else a page asks for a window.
        if crate::web_tabs::tab_may_open(&url) {
            crate::web_tabs::open_as_tab(&opening, &holder, &tab, &url);
        }
        // Not from inside the engine's event: closing a webview there waits on it.
        let app = opening.clone();
        let _ = opening.run_on_main_thread(move || close_now(&app));
        tauri::webview::NewWindowResponse::Deny
    });

    let window = webview.window();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let building = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(all(windows, not(feature = "cef")))]
        let builder =
            crate::web_tabs::on_shared_session(builder, &window, &building, store.as_deref());
        #[cfg(not(all(windows, not(feature = "cef"))))]
        let _ = (&building, &store);
        let made = window
            .add_child(
                builder,
                LogicalPosition::new(rect.x, rect.y),
                LogicalSize::new(SMALLEST, SMALLEST),
            )
            .map_err(|error| format!("that popup could not be opened: {error}"));
        let made = made.map(|view| sent(&building, &view, &address));
        let _ = sending.try_send(made);
    })
    .map_err(|error| error.to_string())?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("that popup was never built".into()))
}

/// Puts the popup where the window now wants it, at the size the window gives it.
#[tauri::command]
pub fn extension_popup_place(app: AppHandle, rect: Rect) {
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.set_position(LogicalPosition::new(rect.x, rect.y));
        let _ = view.set_size(LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)));
    }
}

/// Closes the popup, if one is open.
#[tauri::command]
pub fn extension_popup_close(app: AppHandle) {
    close_now(&app);
}

/// Closes the popup and tells the window, which takes its bubble down.
fn close_now(app: &AppHandle) {
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.close();
        let _ = app.emit(SAID, Said::Closed);
    }
}

/// `about:blank`, which every page of the web is built on before it is sent anywhere.
fn blank() -> Result<Url, String> {
    "about:blank"
        .parse()
        .map_err(|_| "no blank page to start from".to_string())
}

/// The runtime's scripts taken off the page and the page sent to the popup, the way a
/// tab's is (`web_worlds.rs`); and on `WebView2` Escape and the page's own `window.close()`
/// heard, which close it.
fn sent(app: &AppHandle, view: &Webview, address: &Url) {
    #[cfg(all(windows, not(feature = "cef")))]
    {
        let closing = app.clone();
        let address = address.to_string();
        let _ = view.with_webview(move |platform| {
            let _ = crate::web_worlds::sent(&platform, &address, "");
            heard(&closing, &platform);
        });
    }
    #[cfg(feature = "cef")]
    {
        let _ = app;
        let (view, address) = (view.clone(), address.clone());
        std::thread::spawn(move || {
            let _ = crate::web_worlds::sent(&view, &address, "");
        });
    }
    #[cfg(not(any(windows, feature = "cef")))]
    let _ = (app, view, address);
}

/// Escape inside the popup, and the page closing itself, close it.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the key and the close are WebView2's own events, reached through its COM interfaces"
)]
fn heard(app: &AppHandle, platform: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
    use webview2_com::{AcceleratorKeyPressedEventHandler, WindowCloseRequestedEventHandler};

    /// The Escape key's virtual-key code.
    const ESCAPE: u32 = 0x1b;

    let controller = platform.controller();
    let escaping = app.clone();
    let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()) };
        let (mut kind, mut key) = (
            webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND::default(),
            0u32,
        );
        // Safe: the arguments are the engine's, read inside its own event.
        unsafe {
            args.KeyEventKind(&raw mut kind)?;
            args.VirtualKey(&raw mut key)?;
        }
        if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && key == ESCAPE {
            // Not from inside the engine's event: closing a webview there waits on it.
            let app = escaping.clone();
            let _ = escaping.run_on_main_thread(move || close_now(&app));
        }
        Ok(())
    }));
    let closing = app.clone();
    let shut = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
        let app = closing.clone();
        let _ = closing.run_on_main_thread(move || close_now(&app));
        Ok(())
    }));
    // Safe: the controller is this popup's, on the window's thread.
    unsafe {
        let mut token = 0i64;
        let _ = controller.add_AcceleratorKeyPressed(&keys, &raw mut token);
        if let Ok(core) = controller.CoreWebView2() {
            let _ = core.add_WindowCloseRequested(&shut, &raw mut token);
        }
    }
}

/// Asks the page how large it is, a few times as it draws itself, and grows the popup to
/// it. From a thread of its own: every answer comes back on the window's thread.
fn measure(app: &AppHandle, view: &Webview) {
    let mut shown = (pixels(SMALLEST), pixels(SMALLEST));
    let mut slept = 0;
    for at in ASKED_AT {
        std::thread::sleep(Duration::from_millis(at.saturating_sub(slept)));
        slept = at;
        if app.get_webview(LABEL).is_none() {
            return;
        }
        // The width at the height it has, then the height at that width: a page laid
        // out narrower than it wants is taller than it will be.
        let Some((width, _)) = laid_out(view) else {
            return;
        };
        let width = if width < NO_WIDTH { FLUID } else { width };
        let width = pixels(width.clamp(SMALLEST, WIDEST)).max(shown.0);
        if width != shown.0 {
            let _ = view.set_size(LogicalSize::new(width, shown.1));
            std::thread::sleep(Duration::from_millis(30));
        }
        let Some((_, height)) = laid_out(view) else {
            return;
        };
        let wanted = (width, pixels(height.clamp(SMALLEST, TALLEST)).max(shown.1));
        if wanted == shown {
            continue;
        }
        shown = wanted;
        let _ = view.set_size(LogicalSize::new(shown.0, shown.1));
        let _ = app.emit(
            SAID,
            Said::Size {
                width: shown.0,
                height: shown.1,
            },
        );
    }
}

/// A length in whole CSS pixels, which is what a layout measures in and what two sizes
/// are compared by.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a popup's bounds first, so always a small positive length"
)]
fn pixels(length: f64) -> u32 {
    length.ceil().max(0.0) as u32
}

/// What the page asks of its own document: how wide and how tall it lays out.
const ASK: &str = "JSON.stringify([Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)])";

/// The page's own size, from the engine this build runs on.
fn laid_out(view: &Webview) -> Option<(f64, f64)> {
    let said = evaluated(view)?;
    let pair: (f64, f64) = serde_json::from_str(&said).ok()?;
    Some(pair)
}

/// The answer to `ASK`, as the JSON text the page wrote.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "WebView2's own script call, through its COM interface"
)]
fn evaluated(view: &Webview) -> Option<String> {
    use webview2_com::ExecuteScriptCompletedHandler;

    let (answered, answer) = std::sync::mpsc::sync_channel::<Option<String>>(1);
    view.with_webview(move |platform| {
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, json| {
            // The result of a script is JSON; the script's own JSON is a string in it.
            let said = result
                .ok()
                .and_then(|()| serde_json::from_str::<String>(&json).ok());
            let _ = answered.try_send(said);
            Ok(())
        }));
        // Safe: the controller is this popup's, on the window's thread.
        unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = core.ExecuteScript(&windows_core::HSTRING::from(ASK), &handler);
            }
        }
    })
    .ok()?;
    answer.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

/// The answer to `ASK`, through the page's `DevTools` agent.
#[cfg(feature = "cef")]
fn evaluated(view: &Webview) -> Option<String> {
    let said = crate::engine::devtools::call(
        view,
        None,
        "Runtime.evaluate",
        &serde_json::json!({ "expression": ASK, "returnByValue": true }),
        Duration::from_secs(2),
    )
    .ok()?;
    said.get("result")?
        .get("value")?
        .as_str()
        .map(str::to_owned)
}

/// Neither: no other engine runs extensions.
#[cfg(not(any(windows, feature = "cef")))]
fn evaluated(_view: &Webview) -> Option<String> {
    None
}
