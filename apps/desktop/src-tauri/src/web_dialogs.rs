//! What a page says with `alert`, asks with `confirm` and `prompt`, and asks as it is
//! left: in nib's own card over the page, answered the way the reader answers it.
//!
//! **What it was.** The dialog plugin writes its own `alert` and `confirm` into every
//! webview the app builds, a web tab's included, and those two call into the app - which
//! a site's origin is refused. So on a site `alert()` showed nothing, and `confirm()`
//! answered at once with a promise, which is truthy: a site's *"Delete this?"* went ahead
//! as if the reader had said yes. That script is gone from a tab's page with everything
//! else the runtime registers (see `web_worlds.rs`), and the engine's own dialogs are
//! back: `confirm()` blocks the page's script until it is answered and answers a
//! boolean, `prompt()` a string or `null`, and `alert()` shows.
//!
//! **What they look like is nib's.** A browser draws these itself, in the page's own
//! tab, never as a window of the system's: Chrome's is a card at the top of the page.
//! `WebView2`'s own is a window, drawn in the engine's style and not the app's, and it
//! comes forward to be answered. So the engine is told to leave them to the app
//! (`AreDefaultScriptDialogsEnabled`), every one is held open with a deferral while the
//! window shows its card, and the reader's answer lets it go - the shape the site's
//! permission requests already have; see `ask` in `web_tabs.rs`.
//!
//! `WebView2`'s alone. `WKWebView` and `WebKitGTK` still carry the dialog plugin's script
//! in a tab's page; see docs/web-tabs.md.

use serde::Serialize;

/// The event the window hears a page's dialog on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const DIALOG: &str = "nib://web-dialog";

/// Which dialog a page opened, in the window's words for them. `leave` is the one a
/// page's `beforeunload` asks for as the tab moves on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Alert,
    Confirm,
    Prompt,
    Leave,
}

/// A dialog a page has opened and nobody has answered, on its way to the window. `id` is
/// what the answer comes back with; the page's script is waiting on it.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Debug, Serialize)]
struct Opened {
    tab: String,
    id: u64,
    kind: Kind,
    message: String,
    /// What a `prompt` offers to start with.
    text: String,
    /// The page that opened it, which is what the card names.
    origin: String,
}

/// The page's dialog, answered: `accept` is OK, Leave, or a prompt's answer with `text`
/// in it; anything else is Cancel, which is also what closing the card is. A dialog the
/// crate is no longer holding - its tab closed meanwhile - is nothing to answer.
#[tauri::command]
pub fn web_dialog_answer(app: tauri::AppHandle, id: u64, accept: bool, text: Option<String>) {
    #[cfg(all(windows, not(feature = "cef")))]
    let _ = app.run_on_main_thread(move || engine::answer(id, accept, text.as_deref()));
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let _ = (app, id, accept, text);
}

#[cfg(all(windows, not(feature = "cef")))]
pub use engine::{forget, listen};

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2ScriptDialogOpeningEventArgs,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND, COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD, COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
    };
    use webview2_com::ScriptDialogOpeningEventHandler;
    use windows_core::{HSTRING, PWSTR};

    use super::{Kind, Opened, DIALOG};

    /// One dialog nobody has answered: the engine's own two objects, held exactly as long
    /// as the card is up, and the tab it belongs to.
    struct Waiting {
        tab: String,
        args: ICoreWebView2ScriptDialogOpeningEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        /// The dialogs waiting for an answer, on the window's own thread and nowhere
        /// else: the engine's objects may be touched from no other.
        static WAITING: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
    }

    /// What the next dialog is called. Across threads, because the id is the only thing
    /// about a dialog that leaves this one.
    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn kind_of(kind: COREWEBVIEW2_SCRIPT_DIALOG_KIND) -> Option<Kind> {
        match kind {
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT => Some(Kind::Alert),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => Some(Kind::Confirm),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => Some(Kind::Prompt),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => Some(Kind::Leave),
            // A kind this app has never heard of is answered as the engine answers a
            // dialog nobody took: cancelled.
            _ => None,
        }
    }

    /// A string the engine allocated for one of its getters, taken and freed.
    fn read(get: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
        let mut value = PWSTR::null();
        match get(&raw mut value) {
            Ok(()) => webview2_com::take_pwstr(value),
            Err(_) => String::new(),
        }
    }

    /// Takes a page's dialogs off the engine and hands them to the window. Called on the
    /// window's thread, once, as the page is built and before it is sent anywhere: the
    /// setting holds from the next document on, which is the site's.
    #[allow(
        unsafe_code,
        reason = "a page's dialogs are WebView2's own, reached through its COM interfaces"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        // Safe: the controller is this window's, every object below is used only on this
        // thread, and the engine holds the handler for as long as it can fire.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            if settings.SetAreDefaultScriptDialogsEnabled(false).is_err() {
                return;
            }

            let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let deferral = args.GetDeferral()?;

                let mut raw = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
                args.Kind(&raw mut raw)?;
                let Some(kind) = kind_of(raw) else {
                    return deferral.Complete();
                };

                let id = NEXT.fetch_add(1, Ordering::Relaxed);
                let opened = Opened {
                    tab: tab.clone(),
                    id,
                    kind,
                    message: read(|out| args.Message(out)),
                    text: read(|out| args.DefaultText(out)),
                    origin: read(|out| args.Uri(out)),
                };
                WAITING.with_borrow_mut(|held| {
                    held.insert(
                        id,
                        Waiting {
                            tab: tab.clone(),
                            args,
                            deferral,
                        },
                    )
                });

                // A window that cannot be told can never answer, and a page waiting on
                // it would wait for ever: cancelled at once instead.
                if app.emit_to(window.as_str(), DIALOG, opened).is_err() {
                    answer(id, false, None);
                }
                Ok(())
            }));

            let mut token = 0i64;
            let _ = core.add_ScriptDialogOpening(&handler, &raw mut token);
        }
    }

    /// Lets a dialog go with the reader's answer. On the window's own thread.
    #[allow(
        unsafe_code,
        reason = "a dialog is answered through WebView2's own COM interfaces"
    )]
    pub fn answer(id: u64, accept: bool, text: Option<&str>) {
        let Some(waiting) = WAITING.with_borrow_mut(|held| held.remove(&id)) else {
            return;
        };

        // Safe: both objects are this thread's, held since the engine handed them over.
        unsafe {
            if accept {
                if let Some(text) = text {
                    let _ = waiting.args.SetResultText(&HSTRING::from(text));
                }
                let _ = waiting.args.Accept();
            }
            let _ = waiting.deferral.Complete();
        }
    }

    /// A tab going away takes its dialogs with it, cancelled: nobody is left to answer
    /// them, and the engine's objects are let go of.
    pub fn forget(tab: &str) {
        let gone: Vec<u64> = WAITING.with_borrow(|held| {
            held.iter()
                .filter(|(_, one)| one.tab == tab)
                .map(|(id, _)| *id)
                .collect()
        });
        for id in gone {
            answer(id, false, None);
        }
    }
}

/// Every other engine keeps its own dialogs; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn forget(_tab: &str) {}

#[cfg(test)]
mod tests {
    use super::{Kind, Opened};

    #[test]
    fn the_window_hears_which_dialog_and_what_it_says() {
        let said = serde_json::to_value(Opened {
            tab: "t1".into(),
            id: 7,
            kind: Kind::Prompt,
            message: "Your name?".into(),
            text: "Ada".into(),
            origin: "https://a.example/form".into(),
        })
        .expect("json");
        assert_eq!(
            said,
            serde_json::json!({
                "tab": "t1",
                "id": 7,
                "kind": "prompt",
                "message": "Your name?",
                "text": "Ada",
                "origin": "https://a.example/form",
            })
        );
    }

    #[test]
    fn a_page_left_asks_as_leave() {
        for (kind, word) in [
            (Kind::Alert, "alert"),
            (Kind::Confirm, "confirm"),
            (Kind::Prompt, "prompt"),
            (Kind::Leave, "leave"),
        ] {
            assert_eq!(serde_json::to_value(kind).expect("json"), word);
        }
    }
}
