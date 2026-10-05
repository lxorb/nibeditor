//! The reader's own web tabs, acted in by an agent (docs/agent-native.md 7).
//!
//! The same verbs as on an agent's own tab, on the page of any web tab the reader has
//! open, in any space the grant reaches, by the tab's id, with `browser.reader`. Emil,
//! 2026-10-05: *"an agent should be able to use any of a user's tabs, and it should not
//! lose access just because the user does something in it."* So nothing here watches
//! the reader: a press, a scroll or a key of theirs in the tab is the page changing, as a
//! page changes by itself, and the agent reads it as it then is. What stops an agent is
//! the stop (stop.rs); what it may not do is the policy's, read from the page (9.3, 9.4).
//!
//! Two things are different from an agent's own tab, and neither is about who holds it:
//!
//! - **The page may not be running.** A tab behind another one, in a space out of sight,
//!   or parked to give memory back has a page that is hidden, frozen or not there at
//!   all, and a hidden page answers a press after five seconds or never (section 3). So
//!   before every call the window is asked to lend the tab (`LEND`): its page is built
//!   or thawed and kept shown to the engine outside the window - out of sight, never on
//!   a screen - for as long as the agent is at work there, and the reader's own showing
//!   of it is untouched.
//! - **No key through the protocol.** A reader's tab has the page-first keys and the
//!   browser's chords listening; a key pressed into it through the protocol is a key
//!   those hand to the window, which then takes the keyboard back to itself - a probe did
//!   exactly that and came to the front. So `browser_press` on a reader's tab is the
//!   page's own key events with the key's default done the page's way, and its text
//!   inserted as text (`Page::press_in_page`); on an agent's own tab it is the engine's.

use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager as _};

use super::engines::View;
use super::grants::Spaces;
use super::verbs::{window, ReaderTab};

/// How long the window has to say which reader's tabs there are.
const ASKING: Duration = Duration::from_millis(800);

/// How long the window has to lend a tab: building a parked page is a load.
const LENDING: Duration = Duration::from_secs(15);

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

/// The page of a reader's tab, lent to the agent first. A window that does not answer
/// lends nothing, and the page is driven as it is, if it is there at all.
pub fn page(app: &AppHandle, tab: &str) -> Option<View> {
    let label = crate::web_tabs::label_of(tab);
    // The page that holds the shared session open is under the same prefix and is
    // nobody's tab (see `session::anchor` in web_tabs.rs); nib's own window never is.
    if label == "web-session" || !(label.starts_with("web-") || label.starts_with("agent-")) {
        return None;
    }
    let lend = window::Lend {
        tab: tab.to_string(),
    };
    let _ = crate::endpoint::ask(
        app,
        window::LEND,
        serde_json::to_value(lend).unwrap_or_default(),
        LENDING,
    );
    super::engines::view(app, &label)
}
