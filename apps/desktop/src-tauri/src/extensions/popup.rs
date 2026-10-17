//! An extension's popup: its own page, in a webview of its own, inside nib's bubble.
//!
//! What a browser does when the extension's button is pressed - a small window under the
//! button holding `chrome-extension://<id>/<popup>`, sized to what the page lays out, at
//! most 800 by 600 - done the one way the engine allows: a child webview, in the store
//! the tab is in, so the page is the extension's own and talks to its own background. The
//! window draws the bubble round it and says where; this builds the page, puts it there,
//! and says how large the page wants to be.
//!
//! **Sized the way Chromium sizes one.** The page is laid out at the smallest size first
//! and asked how wide and tall it then is, which is the page's own idea of its width -
//! a popup sets one, almost always - and asked again at that width for its height, and
//! again and again for as long as it is open, as Chromium resizes a popup whenever what it
//! lays out changes: most popups draw themselves after they load, on a busy machine well
//! after (a bubble left at its smallest, a square of 27 pixels, on 2026-10-03), and some
//! grow once they are used.
//!
//! **One at a time, and never past what opened it.** A second press closes the first, as
//! does Escape inside the popup, the page asking to close itself, and anything the window
//! decides (a press outside, the tab going away); see lib/web-tab/WebExtensionPopup.svelte.
//!
//! **Never waiting on a browser that does not answer.** The popup is drawn by the browser
//! process of the tab's store, and building it, placing it, sizing it and closing it are
//! each a call into that process the window's thread waits on. Emil, 2026-10-13: "nib
//! crashes once I click on an extension" - his web browser busy, as it often is, and a
//! press on Proton Pass's button held the window's thread for as long as the browser was:
//! Windows called nib not responding, and he ended it. So every one of those calls asks
//! the browser first, the way a tab's page does (`web_answers.rs`): one that does not answer
//! is not built in - the window asks again shortly - and one already open is put out of
//! sight and closed once it answers again. Each popup has a name of its own, so one still
//! waiting to be closed never stands in the way of the next.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter as _, LogicalPosition, LogicalSize, Manager as _, Url, Webview,
    WebviewBuilder, WebviewUrl,
};

/// The start of every popup's label: under the `web-` prefix every page of the web wears,
/// so no capability names it.
const LABEL: &str = "web-extension-popup-";

/// The number the next popup's label ends in.
static NUMBERED: AtomicU64 = AtomicU64::new(0);

/// The label of the popup that is open, if one is.
static SHOWN: Mutex<Option<String>> = Mutex::new(None);

/// A label no popup of this run has had.
fn fresh_label() -> String {
    format!("{LABEL}{}", NUMBERED.fetch_add(1, Ordering::SeqCst))
}

/// The label of the popup that is open, which is now no longer the one that is open.
fn taken() -> Option<String> {
    SHOWN.lock().unwrap_or_else(PoisonError::into_inner).take()
}

/// Whether `label` is the popup that is open.
fn is_shown(label: &str) -> bool {
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_deref()
        == Some(label)
}

/// The popup that is open, if its browser answers: the one way anything here reaches it
/// from the window's thread. On that thread only, where `web_answers::answers` is asked
/// at once.
fn answering(app: &AppHandle) -> Option<Webview> {
    let label = SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()?;
    let view = app.get_webview(&label)?;
    let _doing = crate::stall::doing("extension popup: asked");
    if crate::web_answers::answers(&view) {
        Some(view)
    } else {
        crate::web_answers::said(app);
        None
    }
}

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

/// When the page is asked its size after it has loaded, in milliseconds since: quickly
/// while it draws itself, then every `AGAIN_EVERY` until it closes.
const ASKED_AT: [u64; 4] = [0, 150, 500, 1200];

/// How often an open popup is asked its size once it has loaded, in milliseconds: one
/// question a second, and only while a popup is open.
const AGAIN_EVERY: u64 = 1000;

/// Which measuring is the popup's own: each page load starts one, and an older one stops.
static MEASURING: AtomicU64 = AtomicU64::new(0);

/// How long to wait before the `ask`th question, in milliseconds.
fn wait_before(ask: usize) -> u64 {
    match (
        ask.checked_sub(1).and_then(|at| ASKED_AT.get(at)),
        ASKED_AT.get(ask),
    ) {
        (_, None) => AGAIN_EVERY,
        (None, Some(&first)) => first,
        (Some(&before), Some(&at)) => at - before,
    }
}

/// A new measuring, which every older one gives way to.
fn measuring() -> u64 {
    MEASURING.fetch_add(1, Ordering::SeqCst) + 1
}

/// Whether `which` is still the measuring that counts.
fn still(which: u64) -> bool {
    MEASURING.load(Ordering::SeqCst) == which
}

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
/// it was pressed in, closing any other. Refused with `web_answers::NOT_ANSWERING` while
/// the tab's browser does not answer, which the window asks again after.
#[tauri::command]
pub async fn extension_popup_open(
    webview: Webview,
    id: String,
    tab: String,
    store: Option<String>,
    rect: Rect,
) -> Result<(), String> {
    let app = webview.app_handle().clone();
    let finding = app.clone();
    let address: Url =
        tauri::async_runtime::spawn_blocking(move || super::page_of(&finding, &id, false))
            .await
            .map_err(|error| error.to_string())??
            .parse()
            .map_err(|_| "that extension's popup has no address".to_string())?;
    let store = crate::web_stores::named(store.as_deref())?.map(str::to_owned);

    let label = fresh_label();
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(blank()?))
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
    let (opening, asking, going) = (app.clone(), tab.clone(), label.clone());
    let builder = builder.on_new_window(move |url: Url, _| {
        // A link in the popup, or the extension opening a page of its own: a tab, as
        // everywhere else a page asks for a window.
        if crate::web_tabs::tab_may_open(&url) {
            crate::web_tabs::open_as_tab(&opening, &holder, &asking, &url);
        }
        // Not from inside the engine's event: closing a webview there waits on it.
        let (app, label) = (opening.clone(), going.clone());
        let _ = opening.run_on_main_thread(move || went(&app, &label));
        tauri::webview::NewWindowResponse::Deny
    });

    let window = webview.window();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let building = app.clone();
    app.run_on_main_thread(move || {
        let _doing = crate::stall::doing("extension_popup_open: building the popup");
        closed(&building);
        // The popup is drawn by the tab's own browser: one that does not answer would
        // hold this thread for as long as it does not.
        if let Some(page) = building.get_webview(&crate::web_tabs::label_of(&tab)) {
            if !crate::web_answers::answers(&page) {
                crate::web_answers::said(&building);
                let _ = sending.try_send(Err(crate::web_answers::NOT_ANSWERING.to_owned()));
                return;
            }
        }
        #[cfg(windows)]
        let builder =
            crate::web_tabs::on_shared_session(builder, &window, &building, store.as_deref());
        #[cfg(not(windows))]
        let _ = &store;
        let made = window
            .add_child(
                builder,
                LogicalPosition::new(rect.x, rect.y),
                LogicalSize::new(SMALLEST, SMALLEST),
            )
            .map_err(|error| format!("that popup could not be opened: {error}"));
        let made = made.map(|view| {
            *SHOWN.lock().unwrap_or_else(PoisonError::into_inner) = Some(label);
            sent(&building, &view, &address);
        });
        let _ = sending.try_send(made);
    })
    .map_err(|error| error.to_string())?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("that popup was never built".into()))
}

/// Puts the popup where the window now wants it, at the size the window gives it. A
/// popup whose browser does not answer stays where it is until the next placement.
#[tauri::command]
pub fn extension_popup_place(app: AppHandle, rect: Rect) {
    if let Some(view) = answering(&app) {
        let _doing = crate::stall::doing("extension_popup_place");
        let _ = view.set_position(LogicalPosition::new(rect.x, rect.y));
        let _ = view.set_size(LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)));
    }
}

/// Closes the popup, if one is open. From the window's own turn rather than inside the
/// engine's event the command arrives in: closing a webview there waits on it.
#[tauri::command]
pub async fn extension_popup_close(app: AppHandle) {
    let closing = app.clone();
    let _ = app.run_on_main_thread(move || closed(&closing));
}

/// Closes the popup that is open, if one is: at once if its browser answers, else out of
/// sight now and closed once it does. On the window's own thread.
fn closed(app: &AppHandle) {
    let Some(label) = taken() else {
        return;
    };
    let Some(view) = app.get_webview(&label) else {
        return;
    };
    let _doing = crate::stall::doing("extension popup: closing");
    if crate::web_answers::answers(&view) {
        let _ = view.close();
    } else {
        crate::web_answers::said(app);
        crate::web_answers::put_away(&view);
        crate::web_answers::close_when_answering(app, label);
    }
}

/// Popup `label` went by itself - Escape, its own `window.close()`, a page it opened -
/// and the window is told, which takes its bubble down. Nothing, if another popup has
/// taken its place since. On the window's own thread.
fn went(app: &AppHandle, label: &str) {
    if is_shown(label) {
        closed(app);
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
    #[cfg(windows)]
    {
        let (closing, label) = (app.clone(), view.label().to_owned());
        let address = address.to_string();
        let _ = view.with_webview(move |platform| {
            let _ = crate::web_worlds::sent(&platform, &address, "");
            heard(&closing, &label, &platform);
        });
    }
    #[cfg(not(windows))]
    let _ = (app, view, address);
}

/// Escape inside the popup, and the page closing itself, close it.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the key and the close are WebView2's own events, reached through its COM interfaces"
)]
fn heard(app: &AppHandle, label: &str, platform: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
    use webview2_com::{AcceleratorKeyPressedEventHandler, WindowCloseRequestedEventHandler};

    /// The Escape key's virtual-key code.
    const ESCAPE: u32 = 0x1b;

    let controller = platform.controller();
    let (escaping, escaped) = (app.clone(), label.to_owned());
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
            let (app, label) = (escaping.clone(), escaped.clone());
            let _ = escaping.run_on_main_thread(move || went(&app, &label));
        }
        Ok(())
    }));
    let (closing, shutting) = (app.clone(), label.to_owned());
    let shut = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
        let (app, label) = (closing.clone(), shutting.clone());
        let _ = closing.run_on_main_thread(move || went(&app, &label));
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

/// Asks the page how large it is as it draws itself and for as long as it is open, and
/// grows the popup to it. From a thread of its own: every answer comes back on the
/// window's thread, and every size is given there, to a popup whose browser answers.
fn measure(app: &AppHandle, view: &Webview) {
    let mine = measuring();
    let mut shown = (pixels(SMALLEST), pixels(SMALLEST));
    for ask in 0.. {
        std::thread::sleep(Duration::from_millis(wait_before(ask)));
        // Closed, or another page loaded in it, whose own measuring goes on from here.
        if !is_shown(view.label()) || !still(mine) {
            return;
        }
        // The width at the height it has, then the height at that width: a page laid
        // out narrower than it wants is taller than it will be.
        // A question the page did not answer in time is asked again next time round.
        let Some((width, _)) = laid_out(view) else {
            continue;
        };
        let width = if width < NO_WIDTH { FLUID } else { width };
        let width = pixels(width.clamp(SMALLEST, WIDEST)).max(shown.0);
        if width != shown.0 {
            resized(app, view.label(), LogicalSize::new(width, shown.1));
            std::thread::sleep(Duration::from_millis(30));
        }
        let Some((_, height)) = laid_out(view) else {
            continue;
        };
        let wanted = (width, pixels(height.clamp(SMALLEST, TALLEST)).max(shown.1));
        if wanted == shown {
            continue;
        }
        shown = wanted;
        resized(app, view.label(), LogicalSize::new(shown.0, shown.1));
        let _ = app.emit(
            SAID,
            Said::Size {
                width: shown.0,
                height: shown.1,
            },
        );
    }
}

/// Gives popup `label` `size`, from the window's own thread, if it is still the one open
/// and its browser answers.
fn resized(app: &AppHandle, label: &str, size: LogicalSize<u32>) {
    let (sizing, label) = (app.clone(), label.to_owned());
    let _ = app.run_on_main_thread(move || {
        if let Some(view) = answering(&sizing).filter(|view| view.label() == label) {
            let _ = view.set_size(size);
        }
    });
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

/// What the page asks of its own document: how wide and how tall it lays out, by its own
/// stylesheets - with what a script wrote on the root element itself set aside for the
/// question and put straight back. A popup that sizes itself to the window it finds writes
/// it there, and would only ever answer the size it was given: Proton Pass's, told by
/// `WebView2` it is in a tab, set itself to the whole window and stayed a strip 58 pixels
/// tall (2026-10-13) where its stylesheet asks for 600 by 430.
#[cfg(windows)]
const ASK: &str = "(() => { const root = document.documentElement, body = document.body, own = root.getAttribute('style'); root.removeAttribute('style'); const size = [Math.max(root.scrollWidth, body ? body.scrollWidth : 0), Math.max(root.scrollHeight, body ? body.scrollHeight : 0)]; if (own !== null) root.setAttribute('style', own); return JSON.stringify(size) })()";

/// The page's own size, from the engine this build runs on.
fn laid_out(view: &Webview) -> Option<(f64, f64)> {
    let said = evaluated(view)?;
    let pair: (f64, f64) = serde_json::from_str(&said).ok()?;
    Some(pair)
}

/// The answer to `ASK`, as the JSON text the page wrote.
#[cfg(windows)]
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

/// Neither: no other engine runs extensions.
#[cfg(not(windows))]
fn evaluated(_view: &Webview) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_popup_is_asked_its_size_for_as_long_as_it_is_open() {
        // Quickly while it loads, as before.
        assert_eq!(
            (0..4).map(wait_before).collect::<Vec<_>>(),
            [0, 150, 350, 700]
        );
        // And then on and on, a popup that draws itself late on a busy machine or grows
        // once it is used - Bitwarden unlocked - included.
        assert!((4..1000).all(|ask| wait_before(ask) == AGAIN_EVERY));
    }

    #[test]
    fn every_popup_has_a_name_of_its_own_under_the_web_prefix() {
        // One still waiting on its browser to be closed never takes the next one's name.
        let (first, second) = (fresh_label(), fresh_label());
        assert_ne!(first, second);
        assert!(first.starts_with("web-") && second.starts_with("web-"));
    }

    #[test]
    fn the_popup_that_is_open_is_closed_once() {
        *SHOWN.lock().unwrap_or_else(PoisonError::into_inner) =
            Some("web-extension-popup-x".into());
        assert!(is_shown("web-extension-popup-x"));
        assert!(!is_shown("web-extension-popup-y"));
        assert_eq!(taken().as_deref(), Some("web-extension-popup-x"));
        assert_eq!(taken(), None);
        assert!(!is_shown("web-extension-popup-x"));
    }

    /// Every call into the popup's browser from the window's thread - building, placing,
    /// sizing, closing - asks that browser first, so a busy one never stops the app: what
    /// "nib crashes once I click on an extension" was (2026-10-13).
    #[test]
    fn nothing_reaches_the_popup_without_asking_its_browser_first() {
        let source = include_str!("popup.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        let calls = [".add_child(", ".set_position(", ".set_size(", ".close()"];
        let mut checked = 0;
        let starts = ["\nfn ", "\npub fn ", "\npub async fn "];
        for body in starts.iter().flat_map(|start| code.split(start).skip(1)) {
            let body = body.split("\n}\n").next().unwrap_or(body);
            if calls.iter().any(|call| body.contains(call)) {
                checked += 1;
                assert!(
                    body.contains("answering(") || body.contains("answers("),
                    "a call into the popup's browser that does not ask it first: {}",
                    body.lines().next().unwrap_or_default()
                );
            }
        }
        assert!(
            checked >= 4,
            "the scan found the calls it is about ({checked})"
        );
    }

    #[test]
    fn a_newer_measuring_ends_the_older() {
        let first = measuring();
        assert!(still(first));
        let second = measuring();
        assert!(!still(first) && still(second));
    }
}
