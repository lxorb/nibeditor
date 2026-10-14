//! Quick add from any app (docs/tasks.md 5.6): a key the system holds for nib, and the
//! small window it opens over whatever is in front, with the quick add field and
//! nothing else.
//!
//! **The key is the page's.** The window's page says which key (`app.quick-add`, which
//! the reader can move or switch off in Settings) after its launch order, and again
//! whenever it changes; nothing is registered before. The page that says it is the one
//! that writes the tasks the window hands over, so it is also the window that comes
//! forward when a task is opened (`host`).
//!
//! **The window is made on the first press** and hidden rather than closed after it, so
//! every press after the first shows a page that is already there. It is its own page,
//! `quick-add.html`, which carries the field and none of the app; it talks to the app's
//! page over a broadcast channel, so it is granted nothing (see the capability's
//! description in capabilities/default.json, whose labels it does not match).
//!
//! **A probe never holds the reader's key.** A run whose windows are sent off the screen
//! is a drive's, and a key registered there is a key taken from whoever is at the
//! machine, their own nib's included. There the key is the one the drive names in
//! `NIB_QUICK_ADD_KEY`, or none at all, and the window it opens is sent off the screen
//! like every other and never brought forward (`placement::built`, `placement::raised`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager as _, Webview, WebviewUrl, WebviewWindowBuilder};

/// The window's label: no capability names it, so it is granted nothing.
const LABEL: &str = "nib-quick-add";

/// How big the window is, in points: the field, a description line, the controls.
const WIDTH: f64 = 600.0;
const HEIGHT: f64 = 150.0;

/// The key a probe registers instead of the page's.
const PROBE_KEY: &str = "NIB_QUICK_ADD_KEY";

/// The label of the window whose page answers, which is the window that comes forward
/// when a task is opened.
static HOST: Mutex<Option<String>> = Mutex::new(None);

/// Whether this launch was started by `--quick-add`, and the window is to come up as
/// soon as there is a page to answer it.
static ASKED_AT_LAUNCH: AtomicBool = AtomicBool::new(false);

fn host() -> Option<String> {
    HOST.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// The key a run may hold: the page's, or in a probe the one the drive named, and none
/// where the page asks for none.
fn key_allowed(asked: Option<String>, probe: Option<String>, away: bool) -> Option<String> {
    let asked = asked.filter(|key| !key.trim().is_empty())?;
    if away {
        probe.filter(|key| !key.trim().is_empty())
    } else {
        Some(asked)
    }
}

/// The key quick add answers to from any app, from the page of a document window, or
/// none. Answers the key held now. A sync command on purpose: a hot key registered
/// from another thread is one whose presses go to a thread with no loop to hear them.
#[tauri::command]
pub fn quick_add_key(app: AppHandle, webview: Webview, key: Option<String>) -> Option<String> {
    if !crate::launch::is_document_window(webview.label()) {
        return None;
    }
    let probe = std::env::var(PROBE_KEY).ok();
    let wanted = key_allowed(key, probe, crate::placement::away().is_some());
    *HOST.lock().unwrap_or_else(PoisonError::into_inner) = Some(webview.label().to_owned());
    let held = crate::hotkeys::hold(&app, crate::hotkeys::Which::QuickAdd, wanted);
    if ASKED_AT_LAUNCH.swap(false, Ordering::Relaxed) {
        bring_up(&app, None);
    }
    held
}

/// Notes a launch started by `--quick-add`, whose window comes up once the page that
/// answers it is there (`quick_add_key`).
pub fn asked_at_launch(argv: &[String]) {
    if crate::hotkeys::Which::asked_by(argv).contains(&crate::hotkeys::Which::QuickAdd) {
        ASKED_AT_LAUNCH.store(true, Ordering::Relaxed);
    }
}

/// The window, shown over whatever is in front with the keyboard in its field: made the
/// first time, shown again every time after. With the compositor's token for the press,
/// where a Wayland session handed one, so the window may take the front.
pub(crate) fn bring_up(app: &AppHandle, token: Option<String>) {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => match quick_window(app) {
            Ok(window) => window,
            Err(_) => return,
        },
    };
    if crate::placement::away().is_none() {
        under_pointer(app, &window);
        let _ = window.show();
    }
    #[cfg(target_os = "linux")]
    if let Some(token) = token {
        crate::linux::token_arrived(token);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = token;
    crate::placement::raised(&window.as_ref().window());
    crate::placement::keyboard_to(window.as_ref());
}

/// The window, built hidden: small, on top, no frame, no taskbar button.
fn quick_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow<crate::Engine>> {
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick-add.html".into()))
        .title("Orden")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);

    // The same switches as the first window, which runs on the same user data folder
    // and would refuse a webview started any other way; see `engine::BROWSER_ARGS`.
    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(crate::engine::BROWSER_ARGS);

    // Off the screen with every other window where a drive sent them there.
    crate::placement::built(builder)
}

/// Centred across the screen the pointer is on, a quarter of the way down, where a
/// launcher's field is. Not on Wayland, which never says where the pointer is outside
/// the app's own windows and places every window itself.
fn under_pointer(app: &AppHandle, window: &tauri::WebviewWindow<crate::Engine>) {
    #[cfg(target_os = "linux")]
    if !crate::linux::places_windows() {
        return;
    }
    let Ok(pointer) = app.cursor_position() else {
        let _ = window.center();
        return;
    };
    let Ok(Some(screen)) = app.monitor_from_point(pointer.x, pointer.y) else {
        let _ = window.center();
        return;
    };
    let area = screen.work_area();
    let scale = screen.scale_factor();
    let width = WIDTH * scale;
    let x = f64::from(area.position.x) + (f64::from(area.size.width) - width) / 2.0;
    let y = f64::from(area.position.y) + f64::from(area.size.height) / 4.0;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// How tall the window grows while one of its pickers is open: room for the list under
/// the controls, which a window no taller than its field would cut off.
const TALL: f64 = 420.0;

/// The window grown to hold an open picker, or back to its field's height.
#[tauri::command]
pub fn quick_add_tall(app: AppHandle, webview: Webview, tall: bool) {
    if webview.label() != LABEL {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let height = if tall { TALL } else { HEIGHT };
        let _ = window.set_size(tauri::LogicalSize::new(WIDTH, height));
    }
}

/// The window put away: Escape, a task added, or another app taken to. With `raise`,
/// the window whose page answers comes forward, for a task opened at its line.
#[tauri::command]
pub fn quick_add_hide(app: AppHandle, webview: Webview, raise: bool) {
    if webview.label() != LABEL {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    if raise {
        if let Some(window) = host().and_then(|label| app.get_window(&label)) {
            crate::placement::raised(&window);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_holds_only_the_key_its_drive_named() {
        let asked = Some("Control+Alt+Space".to_owned());
        assert_eq!(key_allowed(asked.clone(), None, false), asked);
        assert_eq!(key_allowed(Some(String::new()), None, false), None);
        assert_eq!(key_allowed(None, None, false), None);
        assert_eq!(key_allowed(asked.clone(), None, true), None);
        let probe = Some("Control+Alt+Shift+F24".to_owned());
        assert_eq!(key_allowed(asked, probe.clone(), true), probe);
        assert_eq!(key_allowed(None, probe, true), None);
    }

    /// `scripts/quick-add-probe.py` presses the probe's key the way the system does, by
    /// the id the plugin gives it; this is that id.
    #[test]
    fn the_probe_key_is_the_id_the_probe_presses() {
        use std::str::FromStr as _;

        let key = tauri_plugin_global_shortcut::Shortcut::from_str("Control+Alt+Shift+F24");
        assert_eq!(key.map(|key| key.id()).ok(), Some(0x0209_00b7));
    }
}
