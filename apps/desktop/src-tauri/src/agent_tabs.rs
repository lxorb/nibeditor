//! A page an agent drives that nobody sees. The spike behind docs/agent-native.md,
//! on branch `spike/agent-tabs`; the lanes in that document build the real thing.
//!
//! Three things were in doubt, and this file is what `scripts/agent-tab-probe.py`
//! measured them through:
//!
//! - **Out of sight without being hidden.** A webview told it is hidden
//!   (`IsVisible` false) is a background tab to Chromium: its timers are held to one
//!   a second, `requestAnimationFrame` stops, and a screenshot has no frame to
//!   take. So an agent's page is a webview that is *shown*, in the window, at a
//!   place outside the window's client area. A child window is always clipped to
//!   its parent, so nothing of it can reach the screen, and to the engine it is a
//!   visible page at a desktop size. The same store as the reader's own web tabs -
//!   one browser process, one login - so the switches every webview on that folder
//!   must share (`engine::BROWSER_ARGS`) are left alone.
//! - **No keyboard, no window, no sound.** Built without the focus a webview is
//!   otherwise given, never handed any of the listeners a reader's tab has (the
//!   browser's chords, the page-first keys, the full screen, the permission bubble),
//!   with the engine's own dialogs, context menu, accelerator keys and developer
//!   tools off and its sound muted - each of which would otherwise put a window of
//!   its own on the screen or a key in the reader's way.
//! - **Driven through the engine, never through the operating system.** Every read
//!   and every press is the `DevTools` Protocol through `CallDevToolsProtocolMethod`
//!   on this webview alone: no port, no socket, and no input anywhere but the page.

use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
};

/// What an agent's page is labelled, so nothing that looks for a reader's tab
/// (`web-`) can mistake one for it.
const LABEL: &str = "agent-";

/// Where an agent's page sits, in the window's own coordinates: far enough past the
/// window's top left corner that a popup the page raises lands on no screen either.
const AWAY: f64 = -10_000.0;

/// How long one protocol call may take before the caller is told it did not answer.
const PATIENCE: Duration = Duration::from_secs(30);

/// The dialogs the agents' pages raised, by label, as they were raised. A page's
/// `alert` is an answer the agent has to read, and never a window on the screen.
static DIALOGS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Opens a page for an agent: `hidden` asks for the engine's own hiding instead, which
/// is the control the probe measures the rest against.
#[tauri::command]
pub async fn agent_open(
    webview: Webview,
    id: String,
    url: String,
    hidden: bool,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let address: Url = url
        .parse()
        .map_err(|error| format!("that is not an address: {error}"))?;
    if !matches!(address.scheme(), "http" | "https") {
        return Err("an agent's page is on the web".into());
    }

    let label = format!("{LABEL}{id}");
    let app = webview.app_handle().clone();
    if app.get_webview(&label).is_some() {
        return Err("that agent already has a page".into());
    }

    // Built on nothing, so the settings below are in place before the first byte of
    // the site arrives.
    let blank: Url = "about:blank"
        .parse()
        .map_err(|error| format!("no blank page: {error}"))?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(blank))
        .focused(false)
        .devtools(false)
        .disable_drag_drop_handler()
        .on_new_window(|_, _| NewWindowResponse::Deny);
    let builder = crate::engine::web_store(builder, &app, None)?;

    let window = webview.window();
    let building = app.clone();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let posted = app.run_on_main_thread(move || {
        #[cfg(all(windows, not(feature = "cef")))]
        let builder = crate::web_tabs::on_shared_session(builder, &window, &building, None);
        #[cfg(not(all(windows, not(feature = "cef"))))]
        let _ = &building;

        let made = window
            .add_child(
                builder,
                LogicalPosition::new(AWAY, AWAY),
                LogicalSize::new(width, height),
            )
            .map_err(|error| format!("that page could not be built: {error}"))
            .and_then(|view| {
                if hidden {
                    view.hide().map_err(|error| error.to_string())?;
                }
                quiet(&view)?;
                view.navigate(address).map_err(|error| error.to_string())
            });
        let _ = sending.try_send(made);
    });

    match posted {
        Err(error) => Err(format!("that page could not be built: {error}")),
        Ok(()) => waiting
            .recv()
            .await
            .unwrap_or_else(|| Err("that page was never built".into())),
    }
}

/// One `DevTools` Protocol call on an agent's page or on a reader's web tab, answered
/// with the protocol's own JSON.
#[tauri::command]
pub async fn agent_cdp(
    app: AppHandle,
    label: String,
    method: String,
    params: String,
) -> Result<String, String> {
    if !(label.starts_with(LABEL) || label.starts_with("web-")) {
        return Err("only a page can be driven".into());
    }
    let view = app
        .get_webview(&label)
        .ok_or_else(|| "there is no such page".to_string())?;

    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<String, String>>(2);
    let late = sending.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PATIENCE);
        let _ = late.try_send(Err("the page did not answer".into()));
    });

    call(&view, method, params, sending)?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("the page did not answer".into()))
}

/// The dialogs raised so far on the agent's page with this id, oldest first.
#[tauri::command]
pub fn agent_dialogs(id: String) -> Vec<String> {
    let label = format!("{LABEL}{id}");
    let setup = format!("{label}#setup");
    DIALOGS
        .lock()
        .map(|held| {
            held.iter()
                .filter(|(one, _)| *one == label || *one == setup)
                .map(|(_, said)| said.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Closes an agent's page.
#[tauri::command]
pub fn agent_close(app: AppHandle, id: String) -> Result<(), String> {
    app.get_webview(&format!("{LABEL}{id}"))
        .ok_or_else(|| "there is no such page".to_string())?
        .close()
        .map_err(|error| error.to_string())
}

/// The engine's own furniture switched off on an agent's page, before it loads.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
fn quiet(view: &Webview) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2_8,
    };
    use webview2_com::ScriptDialogOpeningEventHandler;
    use windows_core::Interface as _;

    let label = view.label().to_string();
    let named = label.clone();
    view.with_webview(move |platform| {
        let label = named;
        // Safe: on the window's own thread, which is where `with_webview` runs, and the
        // handler is held by the engine for as long as it can fire.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
                let _ = settings.SetAreDefaultContextMenusEnabled(false);
                let _ = settings.SetIsStatusBarEnabled(false);
                let _ = settings.SetIsZoomControlEnabled(false);
                if let Ok(three) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = three.SetAreBrowserAcceleratorKeysEnabled(false);
                }
                if let Ok(four) = settings.cast::<ICoreWebView2Settings4>() {
                    let _ = four.SetIsGeneralAutofillEnabled(false);
                    let _ = four.SetIsPasswordAutosaveEnabled(false);
                }
            }
            if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
                let _ = eight.SetIsMuted(true);
            }

            let raising = label.clone();
            let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let text = args.map_or_else(
                    || "a dialog with no arguments".to_string(),
                    |args| {
                        let mut said = windows_core::PWSTR::null();
                        match args.Message(&raw mut said) {
                            Ok(()) => webview2_com::take_pwstr(said),
                            Err(error) => {
                                format!("a dialog whose message could not be read: {error}")
                            }
                        }
                    },
                );
                if let Ok(mut held) = DIALOGS.lock() {
                    held.push((raising.clone(), text));
                }
                Ok(())
            }));
            let mut token = 0i64;
            let added = core.add_ScriptDialogOpening(&handler, &raw mut token);
            let mut defaults = windows_core::BOOL(1);
            let read = core
                .Settings()
                .and_then(|settings| settings.AreDefaultScriptDialogsEnabled(&raw mut defaults));
            if let Ok(mut held) = DIALOGS.lock() {
                held.push((
                    format!("{label}#setup"),
                    format!(
                        "handler {added:?}, default dialogs {} ({read:?})",
                        defaults.as_bool()
                    ),
                ));
            }
        }
    })
    .map_err(|error| format!("that page could not be quietened: {error}"))
}

/// Every other engine: nothing here yet; see docs/agent-native.md.
#[cfg(not(all(windows, not(feature = "cef"))))]
#[allow(
    clippy::unnecessary_wraps,
    reason = "one signature for every engine; only WebView2 has settings to reach"
)]
fn quiet(_view: &Webview) -> Result<(), String> {
    Ok(())
}

/// Sends one call to the engine behind a page, on the window's own thread, and the
/// answer to `sending` whenever it comes.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is reached through WebView2's COM interfaces"
)]
fn call(
    view: &Webview,
    method: String,
    params: String,
    sending: tauri::async_runtime::Sender<Result<String, String>>,
) -> Result<(), String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    view.with_webview(move |platform| {
        let answering = sending.clone();
        let done =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                let _ = answering.try_send(result.map(|()| json).map_err(|error| error.message()));
                Ok(())
            }));
        let method = HSTRING::from(method);
        let params = HSTRING::from(params);
        // Safe: the controller is this webview's own, asked on its own thread, and the
        // handler outlives the call because WebView2 holds it.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                let _ = sending.try_send(Err("the page has no engine".into()));
                return;
            };
            if let Err(error) = core.CallDevToolsProtocolMethod(&method, &params, &done) {
                let _ = sending.try_send(Err(error.message()));
            }
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}

/// Every other engine: no protocol to speak; see docs/agent-native.md.
#[cfg(not(all(windows, not(feature = "cef"))))]
fn call(
    _view: &Webview,
    _method: String,
    _params: String,
    _sending: tauri::async_runtime::Sender<Result<String, String>>,
) -> Result<(), String> {
    Err("only WebView2 is driven in this spike".into())
}
