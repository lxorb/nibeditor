//! A site's web login, carried between the person's computers: taken out of one web
//! store, sealed so that only their own computers can open it, and put into another -
//! on another computer, and on another engine if need be. The native half of
//! docs/sync-v2.md section 6; when it happens and where the bundle goes are the lease's
//! (lib/web-tab/lease.svelte.ts) and the account's.
//!
//! Emil, 2026-09-30: *"The state of the website should be synced as accurately as
//! possible. Not just some basic cookies, but basically the same way as closing and
//! reopening Chrome."* So what travels is what Chrome brings back after a restart
//! (docs/sync-v2.md 6.3): every cookie of the site (session, `HttpOnly`, partitioned
//! ones included), each origin's localStorage and `IndexedDB`, and the web note tab's
//! sessionStorage. Never the files: a cookie database is encrypted to the machine it is
//! on, so everything moves through each engine's own APIs.
//!
//! | | `WebView2` | `WKWebView` | `WebKitGTK` |
//! | --- | --- | --- | --- |
//! | cookies | `DevTools` `Network.*` (`cookies.rs`) | `WKHTTPCookieStore` | the cookie manager |
//! | the page's storage | dump.js and restore.js in an isolated world (`isolated.rs`) | a `WKContentWorld` | a script world |
//! | a page on an origin nobody has open | `WebResourceRequested` answering `<origin>/__nib_restore` (`restore_view.rs`) | `loadHTMLString` | `load_html` |
//! | the tab's sessionStorage | a script at the next document's start (`session.rs`) | written in, then a reload | the same |
//!
//! nib's own Chromium (the `cef` feature) is not here: its `DevTools` handle belongs to the
//! runtime the binary links, which this crate never names (`engine.rs`), so a capture or
//! restore there says so. The keys work on every desktop.
//!
//! The pieces, one file each: the bundle's shape (`bundle.rs`), the keys' arithmetic
//! (`crypto.rs`) and their place in the keychain (`keys.rs`), the folders bundles sit in
//! between the disk and the account (`folders.rs`), and the capture and the restore
//! (`capture.rs`, `restore.rs`) over the engine's parts named above.
//!
//! **Who may call.** Only the app's own windows (`main`, `nib-2`, ...): a web tab's page
//! is a remote origin that reaches no command anyway, and the commands refuse any other
//! caller besides, as the terminal's do. No command hands out a private key or the web
//! key: only a public key, a wrap for another computer, six digits and opaque names.

// nib's own Chromium keeps only the keys; the rest is the system engines' for now.
#[cfg_attr(feature = "cef", allow(dead_code))]
mod bundle;
#[cfg_attr(feature = "cef", allow(dead_code))]
mod crypto;
#[cfg_attr(feature = "cef", allow(dead_code))]
mod folders;
mod keys;

#[cfg(not(feature = "cef"))]
mod answer;
#[cfg(not(feature = "cef"))]
mod capture;
#[cfg(all(windows, not(feature = "cef")))]
mod cdp;
#[cfg(not(feature = "cef"))]
mod cookies;
#[cfg(not(feature = "cef"))]
mod isolated;
#[cfg(not(feature = "cef"))]
mod restore;
#[cfg(not(feature = "cef"))]
mod restore_view;
#[cfg(not(feature = "cef"))]
mod session;

use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;
use tauri::{Manager as _, Webview};

use keys::Keychain;

/// The page's half of a capture; see scripts/dump.js.
#[cfg(not(feature = "cef"))]
const DUMP: &str = include_str!("web_state/scripts/dump.js");

/// The page's half of a restore; see scripts/restore.js.
#[cfg(not(feature = "cef"))]
const RESTORE: &str = include_str!("web_state/scripts/restore.js");

/// Which engine a bundle says it came out of.
#[cfg(all(windows, not(feature = "cef")))]
const ENGINE: &str = "webview2";
#[cfg(all(target_os = "macos", not(feature = "cef")))]
const ENGINE: &str = "wkwebview";
#[cfg(all(target_os = "linux", not(feature = "cef")))]
const ENGINE: &str = "webkitgtk";

/// The one answer every caller that is not a window of ours gets.
const REFUSED: &str = "not a window of this app";

/// The name of the store every space shares, as the lease key and a manifest say it.
const GLOBAL: &str = "global";

/// Refuses every caller but the app's own windows.
fn ours(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err(REFUSED.to_owned())
    }
}

/// The store asked for: its name for a manifest and a lease key, and what a page is
/// built in (none for the shared one). Checked by the rule every web tab's store is;
/// see `web_stores.rs`.
fn store_of(asked: Option<&str>) -> Result<(&str, Option<&str>), String> {
    match crate::web_stores::named(asked.filter(|one| *one != GLOBAL))? {
        None => Ok((GLOBAL, None)),
        Some(name) => Ok((name, Some(name))),
    }
}

/// A site as `siteOf` in web-data.ts makes one, checked: a registrable domain, or an
/// address, in lower case, and nothing that could be read as two fields where it is
/// joined to a store.
fn site_of(asked: &str) -> Result<&str, String> {
    let fits = !asked.is_empty()
        && asked.len() <= 253
        && !asked.starts_with('.')
        && !asked.ends_with('.')
        && asked.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'-' | b':' | b'[' | b']')
        });
    if fits {
        Ok(asked)
    } else {
        Err("that is not a site".to_owned())
    }
}

/// The current web key, or why there is none yet.
fn web_key(vault: &Keychain) -> Result<crypto::WebKey, String> {
    keys::current(vault)?.ok_or_else(|| "this computer has no web key yet".to_owned())
}

/// Takes a site's state out of a store and seals it into a folder of its own: the
/// cookies, and per origin in `origins` its localStorage and `IndexedDB`; with `tab`, the
/// web note's page is read first and its sessionStorage goes too. `app` is carried as
/// it is (the trail, zoom, grants, the fence). Answers the folder, the manifest's and
/// every chunk's name and size, and what stayed behind.
#[cfg(not(feature = "cef"))]
#[tauri::command]
pub async fn web_state_capture(
    webview: Webview,
    store: Option<String>,
    site: String,
    origins: Vec<String>,
    tab: Option<String>,
    app: Option<serde_json::Value>,
) -> Result<capture::Captured, String> {
    ours(&webview)?;
    let (label, store) = store_of(store.as_deref())?;
    let site = site_of(&site)?;
    let key = web_key(&Keychain::of(webview.app_handle()))?;
    let tab = match tab {
        Some(tab) => Some(crate::web_tabs::found(webview.app_handle(), &tab)?),
        None => None,
    };
    capture::capture(
        &webview,
        &key,
        capture::Asked {
            label,
            store,
            site,
            origins,
            tab,
            app,
        },
    )
    .await
}

/// Puts a bundle into a store: the manifest at `manifest_path` (in a folder
/// `web_state_inbox` made, with its chunks beside it), sealed for this store and site.
/// Answers what it did, the tab's sessionStorage for `web_state_session`, and what the
/// app carried.
#[cfg(not(feature = "cef"))]
#[tauri::command]
pub async fn web_state_restore(
    webview: Webview,
    store: Option<String>,
    site: String,
    manifest_path: String,
) -> Result<restore::Restored, String> {
    ours(&webview)?;
    let (label, store) = store_of(store.as_deref())?;
    let site = site_of(&site)?;
    let path = folders::manifest_at(webview.app_handle(), &manifest_path)?;
    let vault = Keychain::of(webview.app_handle());
    restore::restore(&webview, &vault, label, store, site, &path).await
}

/// Seeds a tab's sessionStorage for `origin` and loads its page again so the site
/// starts from it: what a restored web note's tab gets back.
#[cfg(not(feature = "cef"))]
#[tauri::command]
pub async fn web_state_session(
    webview: Webview,
    tab: String,
    origin: String,
    items: Vec<(String, String)>,
) -> Result<(), String> {
    ours(&webview)?;
    let view = crate::web_tabs::found(webview.app_handle(), &tab)?;
    let url: tauri::Url = origin
        .parse()
        .map_err(|_| format!("{origin} is not an origin"))?;
    let origin = capture::origin_of(&url).ok_or_else(|| format!("{origin} is not on the web"))?;
    session::seed(&view, &origin, &items).await
}

/// What a capture and a restore say on nib's own Chromium, which has no door to them
/// from this crate yet; see the top of this file.
#[cfg(feature = "cef")]
const NOT_HERE: &str = "web state cannot be carried on this engine yet";

/// See the system engine's `web_state_capture`.
#[cfg(feature = "cef")]
#[tauri::command(async)]
pub fn web_state_capture() -> Result<(), String> {
    Err(NOT_HERE.to_owned())
}

/// See the system engine's `web_state_restore`.
#[cfg(feature = "cef")]
#[tauri::command(async)]
pub fn web_state_restore() -> Result<(), String> {
    Err(NOT_HERE.to_owned())
}

/// See the system engine's `web_state_session`.
#[cfg(feature = "cef")]
#[tauri::command(async)]
pub fn web_state_session() -> Result<(), String> {
    Err(NOT_HERE.to_owned())
}

/// A new, empty folder to download a bundle into, for `web_state_restore` to read.
#[tauri::command(async)]
pub fn web_state_inbox(webview: Webview) -> Result<PathBuf, String> {
    ours(&webview)?;
    folders::fresh(webview.app_handle(), "in")
}

/// This computer's public key, base64, made the first time it is asked for: what the
/// account knows the computer by, and what another computer wraps the web key to.
#[tauri::command(async)]
pub fn web_key_device(webview: Webview) -> Result<String, String> {
    ours(&webview)?;
    Ok(STANDARD.encode(keys::device(&Keychain::of(webview.app_handle()))?.public()))
}

/// The six digits both screens show while a computer is approved, from its public key.
#[tauri::command]
pub fn web_key_digits(public_key: String) -> Result<String, String> {
    Ok(crypto::digits(&keys::public_key(&public_key)?))
}

/// The web key, wrapped to another computer's public key, and its generation.
#[derive(Debug, Serialize)]
pub struct Wrapped {
    wrapped: String,
    generation: u32,
}

/// Wraps the current web key to another computer's public key: what **Allow** sends.
#[tauri::command(async)]
pub fn web_key_wrap(webview: Webview, target_public_key: String) -> Result<Wrapped, String> {
    ours(&webview)?;
    let key = web_key(&Keychain::of(webview.app_handle()))?;
    Ok(Wrapped {
        wrapped: STANDARD.encode(crypto::wrap(&key, &keys::public_key(&target_public_key)?)?),
        generation: key.generation(),
    })
}

/// Takes the web key another computer wrapped to this one, and keeps it.
#[tauri::command(async)]
pub fn web_key_accept(webview: Webview, wrapped: String, generation: u32) -> Result<(), String> {
    ours(&webview)?;
    let bytes = STANDARD
        .decode(wrapped.trim())
        .map_err(|_| "that web key was not wrapped for this computer".to_owned())?;
    keys::accept(&Keychain::of(webview.app_handle()), &bytes, generation)
}

/// Makes a new web key one generation on (the first, on the first computer), keeps it
/// and answers its generation: what the first upload does, and the first one after a
/// computer was ended.
#[tauri::command(async)]
pub fn web_key_rotate(webview: Webview) -> Result<u32, String> {
    ours(&webview)?;
    Ok(keys::rotate(&Keychain::of(webview.app_handle()))?.generation())
}

/// Which generation of the web key this computer holds, or none before it is approved.
#[tauri::command(async)]
pub fn web_key_current(webview: Webview) -> Result<Option<u32>, String> {
    ours(&webview)?;
    keys::current_generation(&Keychain::of(webview.app_handle()))
}

/// The lease key of a site in a store: the opaque name the hub knows it by.
#[tauri::command(async)]
pub fn web_key_lease(
    webview: Webview,
    store: Option<String>,
    site: String,
) -> Result<String, String> {
    ours(&webview)?;
    let (label, _) = store_of(store.as_deref())?;
    Ok(web_key(&Keychain::of(webview.app_handle()))?.lease(label, site_of(&site)?))
}

/// Forgets every key this computer holds for web logins: what signing out does.
#[tauri::command(async)]
pub fn web_key_forget(webview: Webview) -> Result<(), String> {
    ours(&webview)?;
    keys::forget(&Keychain::of(webview.app_handle()))
}

#[cfg(test)]
mod tests {
    use super::{site_of, store_of};

    /// The shared store is `global` whichever way it is asked for, and every other store
    /// is held to the web tab's rule.
    #[test]
    fn a_store_is_named_as_the_lease_names_it() {
        assert_eq!(store_of(None), Ok(("global", None)));
        assert_eq!(store_of(Some("")), Ok(("global", None)));
        assert_eq!(store_of(Some("global")), Ok(("global", None)));
        assert_eq!(
            store_of(Some("space_0-k3j9x2")),
            Ok(("space_0-k3j9x2", Some("space_0-k3j9x2")))
        );
        assert!(store_of(Some("../web")).is_err());
    }

    /// A site is one lower-case domain or address, and never something with a line in it.
    #[test]
    fn a_site_is_one_plain_name() {
        for fine in [
            "ethz.ch",
            "xn--mnchen-3ya.de",
            "127.0.0.1",
            "[::1]",
            "localhost",
        ] {
            assert_eq!(site_of(fine), Ok(fine));
        }
        for bad in [
            "", ".ethz.ch", "ethz.ch.", "ETHZ.ch", "a\nb", "a b", "a/b", "ä.ch",
        ] {
            assert!(site_of(bad).is_err(), "{bad} was taken");
        }
    }
}
