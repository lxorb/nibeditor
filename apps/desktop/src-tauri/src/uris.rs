//! The `nib://` scheme: how a link written somewhere else on the machine reaches
//! the app.
//!
//! A shortcut, a launcher, a note in another program: all any of them can do is
//! hand the system an address. This module owns the arriving half of that - the
//! link the app was launched by, which lands before there is a window to give it
//! to, and the link that arrives while the app is already up, which goes to the
//! window as an event. What a link *means* is the window's, which holds the
//! spaces and the command registry; see apps/desktop/src/lib/automation.
//!
//! The same shape `launch` uses for the files a command line names, and for the
//! same reason: a launch argument reaches the app before anything is listening,
//! so it waits here until the window asks.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt as _;

/// What the window is told when a link arrives while the app is already running.
const OPENED: &str = "nib://open-url";

/// Links the app was launched by, waiting for the window to ask for them.
#[derive(Default)]
pub struct Pending(pub Mutex<Vec<String>>);

/// Starts listening for links, and puts aside the one that started the app.
///
/// On Linux, and in a debug build on Windows, the scheme is registered here
/// rather than by an installer: there is no installer in either case, and a
/// scheme nothing has registered is a link that opens nothing at all. A release
/// on Windows and macOS is registered by the bundle itself.
pub fn watch(app: &AppHandle) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        // Nothing to do about a refusal: the app runs, and a link into it does
        // not. Which is exactly what happens today.
        let _ = app.deep_link().register_all();
    }

    let opened = app.clone();
    app.deep_link().on_open_url(move |event| {
        let urls = said(event.urls());
        if urls.is_empty() {
            return;
        }

        // A link is somebody asking for this app, so the window comes forward.
        // A phone has one window and the system has already brought it up.
        #[cfg(desktop)]
        // The window, not the webview window, which a window with a page in a tab
        // is not; see web_tabs.rs.
        if let Some(window) = opened.get_window("main") {
            crate::placement::raised(&window);
        }

        let _ = opened.emit(OPENED, urls);
    });

    // The link that started the app, which no handler above can have heard: it
    // was delivered before this function existed.
    let launched = said(
        app.deep_link()
            .get_current()
            .ok()
            .flatten()
            .unwrap_or_default(),
    );
    if launched.is_empty() {
        return;
    }

    if let Some(pending) = app.try_state::<Pending>() {
        if let Ok(mut waiting) = pending.0.lock() {
            *waiting = launched;
        }
    }
}

/// Handed to the window once it is ready; clearing them stops a reload from
/// following the same link a second time.
#[tauri::command]
pub fn take_startup_uris(pending: tauri::State<'_, Pending>) -> Vec<String> {
    let Ok(mut urls) = pending.0.lock() else {
        return Vec::new();
    };

    std::mem::take(&mut *urls)
}

/// The links as the window reads them: strings, and none of them empty.
///
/// Written against anything that can say itself rather than against the URL type
/// the plugin hands over, so this module has no opinion about which crate parsed
/// the address.
fn said<T: ToString>(urls: Vec<T>) -> Vec<String> {
    urls.iter()
        .map(ToString::to_string)
        .filter(|one| !one.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::said;

    #[test]
    fn says_every_link_it_is_given() {
        let urls = vec![
            "nib://open?path=Idea.md".to_string(),
            "nib://search".to_string(),
        ];
        assert_eq!(
            said(urls),
            vec![
                "nib://open?path=Idea.md".to_string(),
                "nib://search".to_string()
            ]
        );
    }

    #[test]
    fn leaves_out_an_address_that_says_nothing() {
        assert!(said(vec![String::new()]).is_empty());
        assert!(said(Vec::<String>::new()).is_empty());
    }
}
