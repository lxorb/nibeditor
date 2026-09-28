//! Finding words in a web tab's page: Ctrl+F.
//!
//! The bar is nib's own - the one every other surface finds with, under the web bar -
//! and the finding is the engine's. `WebView2` has a find of its own (`ICoreWebView2Find`)
//! that marks every match in the page, walks them and says how many there are and which
//! one is lit, which is Chrome's own find with the dialog left out. The window types, the
//! engine finds, and the count comes back as `nib://web-found`.
//!
//! An engine without it - an older runtime, the other two desktops, nib's own Chromium -
//! is asked by a line of script in the page instead: the browser's own `window.find`
//! walks and selects the matches, and the page's text is counted for the tally. It marks
//! one match rather than all of them, which is the honest difference.
//!
//! The keys reach the window rather than the page: Ctrl+F, Ctrl+G and F3 are the
//! browser's in a web tab; see `web_keys.rs`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Webview};

/// The event the window hears the tally on.
const FOUND: &str = "nib://web-found";

/// Which way a look goes: a new word, or the next or the previous match of the last.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Look {
    Fresh,
    Next,
    Previous,
}

/// How many matches a page has and which is lit, counting from nought, or -1 for none.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Found {
    #[serde(default)]
    tab: String,
    count: i32,
    at: i32,
}

/// The page's own find, for an engine that has none to lend. `window.find` selects the
/// next match and scrolls to it; the tally is the page's text counted, without case.
const LOOKED: &str = r"(function (term, back, fresh) {
  try {
    var state = window.__nibFound || (window.__nibFound = { at: -1 })
    var selection = window.getSelection()
    if (fresh) {
      state.at = -1
      if (selection) selection.removeAllRanges()
    }

    var words = ((document.body && document.body.innerText) || '').toLowerCase()
    var want = term.toLowerCase()
    var count = 0
    for (var from = want ? words.indexOf(want) : -1; from >= 0; from = words.indexOf(want, from + want.length)) count++

    if (!count || typeof window.find !== 'function' || !window.find(term, false, back, true)) {
      return { count: count, at: -1 }
    }
    state.at = state.at < 0 ? (back ? count - 1 : 0) : (state.at + (back ? count - 1 : 1)) % count
    return { count: count, at: state.at }
  } catch (error) {
    return { count: 0, at: -1 }
  }
})(__TERM__, __BACK__, __FRESH__)";

/// And the same page let go of: the lit match is only a selection.
const LEFT: &str =
    "(function () { var one = window.getSelection(); if (one) one.removeAllRanges() })()";

/// The script for one look.
fn looked(term: &str, look: Look) -> String {
    let term = serde_json::to_string(term).unwrap_or_else(|_| "''".to_string());
    LOOKED
        .replace("__TERM__", &term)
        .replace(
            "__BACK__",
            if look == Look::Previous {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__FRESH__",
            if look == Look::Fresh { "true" } else { "false" },
        )
}

/// Looks for a word in a tab's page, or for the next or the previous of it.
#[tauri::command]
pub fn web_find(app: AppHandle, tab: String, term: String, look: Look) -> Result<(), String> {
    let view = crate::web_tabs::found(&app, &tab)?;

    #[cfg(all(windows, not(feature = "cef")))]
    {
        let asking = view.clone();
        app.run_on_main_thread(move || {
            if !native::seek(&tab, &term, look) {
                script(&asking, tab, &term, look);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }

    #[cfg(not(all(windows, not(feature = "cef"))))]
    {
        script(&view, tab, &term, look);
        Ok(())
    }
}

/// Stops looking: the marks go and the page is the page again.
#[tauri::command]
pub fn web_find_stop(app: AppHandle, tab: String) -> Result<(), String> {
    let view = crate::web_tabs::found(&app, &tab)?;

    #[cfg(all(windows, not(feature = "cef")))]
    {
        let asking = view.clone();
        app.run_on_main_thread(move || {
            if !native::halt(&tab) {
                let _ = asking.eval(LEFT);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }

    #[cfg(not(all(windows, not(feature = "cef"))))]
    view.eval(LEFT)
        .map_err(|error| format!("that page could not be reached: {error}"))
}

/// The page's own find, and its answer said to the window the way the engine's is.
fn script(view: &Webview, tab: String, term: &str, look: Look) {
    let telling = view.clone();
    let _ = view.eval_with_callback(looked(term, look), move |answer| {
        let Ok(mut found) = serde_json::from_str::<Found>(&answer) else {
            return;
        };
        found.tab.clone_from(&tab);
        let _ = telling.emit_to(telling.window().label(), FOUND, found);
    });
}

/// Every engine but `WebView2` finds through the page; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn forget(_tab: &str) {}

#[cfg(all(windows, not(feature = "cef")))]
pub use native::{forget, listen};

#[cfg(all(windows, not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment15, ICoreWebView2Find, ICoreWebView2_28,
    };
    use webview2_com::{
        FindActiveMatchIndexChangedEventHandler, FindMatchCountChangedEventHandler,
        FindStartCompletedHandler,
    };
    use windows_core::{Interface, HSTRING};

    use super::{Found, Look, FOUND};

    /// One page's find: the engine's object, the environment its options come from, and
    /// how its tally is said.
    struct Finder {
        find: ICoreWebView2Find,
        env: ICoreWebView2Environment15,
        tell: Rc<dyn Fn(&ICoreWebView2Find)>,
    }

    thread_local! {
        /// Each page's find, on the window's own thread and nowhere else.
        static FINDERS: RefCell<HashMap<String, Finder>> = RefCell::new(HashMap::new());
    }

    /// Starts listening on one page. Called on the window's thread, once, as the page is
    /// built. A runtime too old to find leaves nothing here, and the page's own find is
    /// used instead.
    #[allow(
        unsafe_code,
        reason = "the engine's find and its events are reached through WebView2's COM interfaces"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        // Safe: the controller is this window's, every object below is used only on this
        // thread, and WebView2 holds each handler for as long as it can fire.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(find) = core.cast::<ICoreWebView2_28>().and_then(|one| one.Find()) else {
                return;
            };
            let Ok(env) = webview.environment().cast::<ICoreWebView2Environment15>() else {
                return;
            };

            // Told the find it is about rather than holding one: a handler on the find
            // that held the find would keep it, and the page under it, for ever.
            let named = tab.clone();
            let tell: Rc<dyn Fn(&ICoreWebView2Find)> = Rc::new(move |reading| {
                let mut count = 0i32;
                let mut at = 0i32;
                let _ = reading.MatchCount(&raw mut count);
                let _ = reading.ActiveMatchIndex(&raw mut at);
                // The engine counts the lit match from one, and nothing lit as nought or
                // less; the window counts from nought, as the page's own find does.
                let found = Found {
                    tab: named.clone(),
                    count,
                    at: at - 1,
                };
                let _ = app.emit_to(window.as_str(), FOUND, found);
            });

            let counted = Rc::clone(&tell);
            let count = FindMatchCountChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(one) = sender {
                    counted(&one);
                }
                Ok(())
            }));
            let lit = Rc::clone(&tell);
            let active =
                FindActiveMatchIndexChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(one) = sender {
                        lit(&one);
                    }
                    Ok(())
                }));
            let mut token = 0i64;
            let _ = find.add_MatchCountChanged(&count, &raw mut token);
            let _ = find.add_ActiveMatchIndexChanged(&active, &raw mut token);

            FINDERS.with_borrow_mut(|all| all.insert(tab, Finder { find, env, tell }));
        }
    }

    /// Looks, through the engine, and says whether it could.
    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    pub fn seek(tab: &str, term: &str, look: Look) -> bool {
        FINDERS.with_borrow(|all| {
            let Some(finder) = all.get(tab) else {
                return false;
            };

            // Safe: every object is this page's, on the thread it was made on.
            let done = unsafe {
                match look {
                    Look::Next => finder.find.FindNext(),
                    Look::Previous => finder.find.FindPrevious(),
                    Look::Fresh => opened_on(finder, term),
                }
            };
            done.is_ok()
        })
    }

    /// A new word: the engine's options, with its own dialog kept out of sight because
    /// the bar is nib's. The tally is said once the session has started as well as as it
    /// changes, because a new word with as many matches as the last changes nothing the
    /// engine would report.
    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    unsafe fn opened_on(finder: &Finder, term: &str) -> windows_core::Result<()> {
        // Safe: as in `seek`, which is the only caller.
        unsafe {
            let options = finder.env.CreateFindOptions()?;
            options.SetFindTerm(&HSTRING::from(term))?;
            options.SetIsCaseSensitive(false)?;
            options.SetShouldMatchWord(false)?;
            options.SetShouldHighlightAllMatches(true)?;
            options.SetSuppressDefaultFindDialog(true)?;

            let tell = Rc::clone(&finder.tell);
            let find = finder.find.clone();
            let started = FindStartCompletedHandler::create(Box::new(move |_| {
                tell(&find);
                Ok(())
            }));
            finder.find.Start(&options, &started)
        }
    }

    /// Stops the engine's find, and says whether there was one to stop.
    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    pub fn halt(tab: &str) -> bool {
        // Safe: the object is this page's, on the thread it was made on.
        FINDERS.with_borrow(|all| {
            all.get(tab)
                .is_some_and(|finder| unsafe { finder.find.Stop() }.is_ok())
        })
    }

    /// The page has gone, and its find with it.
    pub fn forget(tab: &str) {
        FINDERS.with_borrow_mut(|all| all.remove(tab));
    }
}

#[cfg(test)]
mod tests {
    use super::{looked, Found, Look};

    #[test]
    fn a_word_is_handed_to_the_page_as_a_string_and_nothing_else() {
        let script = looked("it's \"quoted\"", Look::Fresh);
        assert!(script.ends_with(r#"("it's \"quoted\"", false, true)"#));
        assert!(!script.contains("__TERM__"));
    }

    #[test]
    fn the_previous_one_is_found_backwards() {
        assert!(looked("a", Look::Previous).ends_with(r#"("a", true, false)"#));
        assert!(looked("a", Look::Next).ends_with(r#"("a", false, false)"#));
    }

    #[test]
    fn the_page_s_answer_is_read_for_its_tally() {
        let found: Found = serde_json::from_str(r#"{"count":3,"at":1}"#).expect("an answer");
        assert_eq!((found.count, found.at), (3, 1));
    }
}
