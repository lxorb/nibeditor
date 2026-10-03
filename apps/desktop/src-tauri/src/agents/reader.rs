//! The reader's own web tabs, acted in by an agent (docs/agent-native.md 7).
//!
//! The same verbs as on an agent's own tab, on the page of a tab the reader has open,
//! with `browser.reader`. Two things are different, and both are the reader winning:
//!
//! - **A press or a key from the reader pauses the agent on that tab at once.** The
//!   engine says when a webview takes the keyboard (`GotFocus`) and when it lets go
//!   (`LostFocus`), and the protocol's own presses never move the keyboard - the probe
//!   measures it on every run - so a `GotFocus` on a page an agent is acting in is always
//!   the reader. The agent's next call there answers `paused_by_reader`, and nothing
//!   gives the tab back but the reader's press on the agent's mark (`agents_resume`).
//!   nib's own Chromium has no such event for a page the runtime built, so there the
//!   window's own answer to which page has the keyboard is asked ten times a second
//!   while an agent acts in one of the reader's tabs (Windows); where nothing can say it
//!   (nib's own Chromium on a Mac or Linux) the reader's tabs are not an agent's to act
//!   in at all, since the reader could not take one back.
//! - **No key through the protocol.** A reader's tab has the page-first keys and the
//!   browser's chords listening; a key pressed into it through the protocol is a key
//!   those hand to the window, which then takes the keyboard back to itself - a probe did
//!   exactly that and came to the front. So `browser_press` on a reader's tab is the
//!   page's own key events with the key's default done the page's way, and its text
//!   inserted as text (`Page::press_in_page`); on an agent's own tab it is the engine's.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager as _};

use super::engines::View;
use super::grants::Spaces;
use super::verbs::{window, ReaderTab};

/// How long the window has to say which reader's tabs there are.
const ASKING: Duration = Duration::from_millis(800);

/// The agents acting on each reader's tab, by the tab's id, and the tabs the engine's
/// focus events are followed on.
static ACTING: Mutex<Option<HashMap<String, HashSet<String>>>> = Mutex::new(None);

/// The reader's web tabs, as the window knows them, or as far as the crate knows them
/// when the window does not say: the reader's tabs of the spaces the agent may reach.
pub fn tabs(app: &AppHandle, spaces: &Spaces) -> Vec<ReaderTab> {
    let listed: Vec<ReaderTab> = crate::endpoint::ask(app, window::READER_TABS, json!({}), ASKING)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(|| pages(app));
    listed
        .into_iter()
        .filter(|tab| match (spaces, &tab.space) {
            (Spaces::All(_), _) => true,
            (Spaces::Named(_), None) => false,
            (Spaces::Named(_), Some(space)) => spaces.reach(space),
        })
        .collect()
}

/// The reader's tabs as the crate sees them: every page in a tab, without the window's
/// word on which space or whether in front.
fn pages(app: &AppHandle) -> Vec<ReaderTab> {
    app.webviews()
        .into_iter()
        .filter_map(|(label, view)| {
            let id = label.strip_prefix("web-")?;
            (id != "session").then(|| ReaderTab {
                id: id.to_string(),
                title: String::new(),
                url: view.url().map(|url| url.to_string()).unwrap_or_default(),
                space: None,
                front: false,
                on_screen: false,
            })
        })
        .collect()
}

/// Whether this engine can hear the reader take one of their tabs back (7.3), without
/// which an agent never acts in one.
pub const HEARS_THE_READER: bool = cfg!(windows);

/// The page of a reader's tab, if the tab has one.
pub fn page(app: &AppHandle, tab: &str) -> Option<View> {
    let label = crate::web_tabs::label_of(tab);
    // The page that holds the shared session open is under the same prefix and is
    // nobody's tab (see `session::anchor` in web_tabs.rs); nib's own window never is.
    if label == "web-session" || !(label.starts_with("web-") || label.starts_with("agent-")) {
        return None;
    }
    super::engines::view(app, &label)
}

/// Notes an agent acting on a reader's tab, and starts following the tab's keyboard
/// the first time any agent does.
pub fn acting(app: &AppHandle, agent: &str, tab: &str, view: &View) {
    let first = {
        let mut all = ACTING.lock().unwrap_or_else(PoisonError::into_inner);
        let all = all.get_or_insert_with(HashMap::new);
        let first = !all.contains_key(tab);
        all.entry(tab.to_string())
            .or_default()
            .insert(agent.to_string());
        first
    };
    if first {
        follow_focus(app, tab, view);
    }
}

/// The agents that have acted on a reader's tab.
fn agents_on(tab: &str) -> Vec<String> {
    ACTING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .and_then(|all| all.get(tab))
        .map(|agents| agents.iter().cloned().collect())
        .unwrap_or_default()
}

/// Follows the keyboard of a reader's tab: taking it pauses every agent acting there.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the webview's focus is WebView2's own controller event, reached through COM"
)]
fn follow_focus(app: &AppHandle, tab: &str, view: &View) {
    use webview2_com::FocusChangedEventHandler;

    let View::Webview(view) = view;
    let (app, tab) = (app.clone(), tab.to_string());
    let _ = view.with_webview(move |platform| {
        let pausing = app.clone();
        let named = tab.clone();
        let got = FocusChangedEventHandler::create(Box::new(move |_, _| {
            took_the_keyboard(&pausing, &named);
            Ok(())
        }));
        let mut token = 0i64;
        // Safe: the controller is this webview's own, on its own thread; the engine holds
        // the handler for as long as the webview lives.
        unsafe {
            let _ = platform.controller().add_GotFocus(&got, &raw mut token);
        }
    });
}

/// Follows the keyboard of a reader's tab on nib's own Chromium, where no event says it:
/// which page of the window has the keyboard, asked on the window's thread (the only one
/// that can answer) ten times a second, for as long as an agent acts in the tab. The
/// moment it becomes this tab's page is the reader taking it.
#[cfg(feature = "cef")]
fn follow_focus(app: &AppHandle, tab: &str, view: &View) {
    let Some(webview) = view.webview() else {
        return;
    };
    let (app, tab) = (app.clone(), tab.to_string());
    let (window, label) = (webview.window().label().to_string(), view.label());
    std::thread::spawn(move || {
        let mut had = false;
        while !agents_on(&tab).is_empty() {
            let (said, answer) = std::sync::mpsc::sync_channel(1);
            let asked = window.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = said.try_send(crate::keyboard::page_holding(&asked));
            });
            let has = answer
                .recv_timeout(Duration::from_secs(1))
                .ok()
                .flatten()
                .is_some_and(|holding| holding == label);
            if has && !had {
                took_the_keyboard(&app, &tab);
            }
            had = has;
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

/// The reader took a tab's keyboard: every agent acting there is paused. What the
/// engine's `GotFocus` says, and all it says.
fn took_the_keyboard(app: &AppHandle, tab: &str) {
    super::stop::reader_took(app, tab, &agents_on(tab));
}

/// The harness's stand-in for the reader's press (7.3): the engine's `GotFocus` on a tab,
/// said without pressing anything on this machine, where a real press would move the
/// keyboard of whoever is at it. The same `took_the_keyboard` the engine's handler calls,
/// on a tab the handler is following. See `agents_test_reader_focus`.
pub fn focus_for_test(app: &AppHandle, tab: &str) -> Result<(), String> {
    if agents_on(tab).is_empty() {
        return Err(format!(
            "no agent has acted on {tab}: its keyboard is not being followed"
        ));
    }
    took_the_keyboard(app, tab);
    Ok(())
}

/// Forgets a reader's tab that closed.
pub fn gone(tab: &str) {
    if let Some(all) = ACTING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(tab);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_acted_on_lists_its_agents() {
        ACTING
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashMap::new)
            .entry("t-reader".into())
            .or_default()
            .insert("claude-code".into());
        assert_eq!(agents_on("t-reader"), ["claude-code"]);
        gone("t-reader");
        assert!(agents_on("t-reader").is_empty());
    }
}
