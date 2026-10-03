//! Which engine an agent's page is on, and the one handle every verb holds it by
//! (docs/agent-native.md 12).
//!
//! | build | an agent's own tab | a reader's tab | the verbs |
//! | --- | --- | --- | --- |
//! | `WebView2` | a child webview outside the window's client area (`tabs.rs`) | its webview | the `DevTools` Protocol, all of them |
//! | nib's own Chromium | a windowless browser with no native window at all (`cef.rs`) | its webview, through `engine/devtools.rs` | the same protocol, all of them |
//! | `WKWebView`, `WebKitGTK` | none: see `webkit.rs` and `gtk.rs` for what was measured and why | - | `unsupported_on_this_engine` |
//!
//! **The reader's logins, never the reader's extensions.** Emil, 2026-10-03: an agent's
//! tab never loads the reader's extensions. An extension is installed into a profile, and
//! neither engine has a per-page switch for it, so a page in the reader's own store runs
//! every extension the reader installed - a password manager that fills in the agent's
//! page, an ad blocker that changes what it reads, anything with `<all_urls>` reading
//! what the agent reads. Two ways out, and Emil has not chosen; [`READER_STORE`] is the
//! switch:
//!
//! - **The twin** (the default): `store: "reader"` and `"space"` open in that store's twin,
//!   a profile of its own with no extension in it, which is handed the reader's cookies -
//!   every one, partitions kept - each time an agent's tab is built there. So the agent is
//!   signed in where the reader is and nothing of the reader's extensions is near it.
//!   Nothing goes back: what the agent signs into or out of in the twin never reaches the
//!   reader's store. What a cookie does not carry - a site that keeps its login in
//!   `localStorage` or `IndexedDB` alone - is signed out in the twin, and a site that
//!   rotates its session on every use can sign the reader out when the agent uses the
//!   copy. Playwright's `storageState` is the same idea and has the same edges.
//! - **Blocked**: an agent's tab is never in the reader's store; asked for it, the tab
//!   opens in the agent's own store, signed out, and the answer says so - the way a site
//!   set to "agent store only" already answers.

#[cfg(feature = "cef")]
pub mod cef;

use tauri::{AppHandle, Manager as _, Webview};

/// How an agent's tab reaches the reader's logins: see this file's comment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReaderStore {
    /// A twin of the reader's store, with their cookies and none of their extensions.
    Twin,
    /// Never the reader's store: the agent's own instead.
    Blocked,
}

/// The switch, until Emil decides. `NIB_AGENT_READER_STORE=blocked` turns a run to the
/// other one, which is how a probe proves both.
pub const READER_STORE: ReaderStore = ReaderStore::Twin;

/// The switch as this run has it.
pub fn reader_store() -> ReaderStore {
    match std::env::var("NIB_AGENT_READER_STORE").as_deref() {
        Ok("blocked") => ReaderStore::Blocked,
        Ok("twin") => ReaderStore::Twin,
        _ => READER_STORE,
    }
}

/// What a twin's name starts with. An agent's own store is `agent_<id>`, and an id is
/// letters, digits and dashes, so no agent's store is ever a twin's, and both start with
/// `agent_`, which is what keeps extensions out of a store on `WebView2`
/// (`extensions::in_store`).
const TWIN: &str = "agent__twin";

/// The twin of a reader's store: `None` is the one every space shares.
pub fn twin_of(reader: Option<&str>) -> String {
    match reader {
        None => TWIN.to_string(),
        Some(name) => format!("{TWIN}_{name}"),
    }
}

/// The reader's store a twin carries the cookies of, or `None` for a store that is no
/// twin. `Some(None)` is the store every space shares.
#[allow(
    clippy::option_option,
    reason = "no twin, and a twin of the store every space shares, are two different answers"
)]
pub fn reader_of(store: Option<&str>) -> Option<Option<&str>> {
    let rest = store?.strip_prefix(TWIN)?;
    if rest.is_empty() {
        return Some(None);
    }
    rest.strip_prefix('_').filter(|one| !one.is_empty()).map(Some)
}

/// One page an agent acts on, on whichever engine it is.
#[derive(Clone)]
pub enum View {
    /// A webview of the app's: a reader's tab, or an agent's own on `WebView2`.
    Webview(Webview),
    /// An agent's own tab on nib's own Chromium: a browser with no window.
    #[cfg(feature = "cef")]
    Windowless(cef::Windowless),
}

impl View {
    /// Its label: `web-<tab>` or `agent-<tab>`.
    pub fn label(&self) -> String {
        match self {
            View::Webview(view) => view.label().to_string(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.label().to_string(),
        }
    }

    /// Where it is now.
    pub fn url(&self) -> String {
        match self {
            View::Webview(view) => view.url().map(|one| one.to_string()).unwrap_or_default(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.url(),
        }
    }

    /// The app's webview, for a page that is one.
    #[cfg_attr(
        not(feature = "cef"),
        allow(
            clippy::unnecessary_wraps,
            reason = "every page is a webview on the system's engine; on nib's own Chromium an agent's is not"
        )
    )]
    pub fn webview(&self) -> Option<&Webview> {
        match self {
            View::Webview(view) => Some(view),
            #[cfg(feature = "cef")]
            View::Windowless(_) => None,
        }
    }

    /// Closes it.
    pub fn close(&self) {
        match self {
            View::Webview(view) => {
                let _ = view.close();
            }
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.close(),
        }
    }
}

/// The page under a label, on whichever engine has it.
pub fn view(app: &AppHandle, label: &str) -> Option<View> {
    #[cfg(feature = "cef")]
    if let Some(page) = cef::page(label) {
        return Some(View::Windowless(page));
    }
    app.get_webview(label).map(View::Webview)
}

#[cfg(test)]
mod tests {
    use super::{reader_of, twin_of};

    #[test]
    fn a_twin_names_the_store_it_carries_and_no_agent_s_store_is_one() {
        assert_eq!(reader_of(Some(&twin_of(None))), Some(None));
        assert_eq!(
            reader_of(Some(&twin_of(Some("space_abc")))),
            Some(Some("space_abc"))
        );
        // An agent's own store, whatever the agent is called, is never a twin.
        assert_eq!(reader_of(Some("agent_twin")), None);
        assert_eq!(reader_of(Some("agent_claude-code")), None);
        assert_eq!(reader_of(Some("agent__twin_")), None);
        assert_eq!(reader_of(None), None);
        assert_eq!(reader_of(Some("space_x")), None);
        // And a twin keeps extensions out the way an agent's own store does.
        assert!(twin_of(None).starts_with("agent_"));
    }
}
