//! The extensions nib's own Chromium runs: the engine's own, read and changed through
//! Chromium's management API.
//!
//! On this engine the Chrome Web Store installs for itself, in the browsing profile: its
//! own "Add to Chrome", Chromium's own prompt, Chromium's own updates. What a host cannot
//! do is install an unpacked folder - the protocol's `Extensions.loadUnpacked` answers a
//! page's own `DevTools` session "Not allowed", and only a browser-wide session, which is
//! a debugging port nib keeps closed, may call it (measured with
//! scripts/extensions-probe.py, 2026-10-03). So the list here is the engine's, and nib
//! draws it: the bar's buttons, the popup in its bubble, the rows in Settings. A link
//! pasted into nib opens the store's own page, where the store's own button installs.
//!
//! `chrome.management`, which `chrome://extensions` has, is the one door: it lists, turns
//! off without taking away - an uninstall takes an extension's stored data with it, and a
//! password manager turned off is not a password manager signed out - and removes. So nib
//! keeps one page of `chrome://extensions` nobody sees, in the browsing profile, and asks
//! it. The files are read where Chromium keeps them: `<profile>/Extensions/<id>` for one
//! from a store, and the folder it was loaded from for one loaded unpacked - developer
//! mode's Load unpacked, or `--load-extension` - which only `chrome.developerPrivate`,
//! on the same page, can say. Read from the store's folder alone, an unpacked one had
//! no files, so no row and no button, though it ran in every page.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager as _, Webview, WebviewBuilder, WebviewUrl,
};

use crate::engine::devtools;

use super::library::Kept;
use super::link::Store;

/// The page nobody sees that the management API is asked through.
const CONTROL: &str = "web-extensions-control";

/// How long one question to the engine may take.
const PATIENCE: Duration = Duration::from_secs(20);

/// One page built at a time.
static BUILDING: Mutex<()> = Mutex::new(());

/// What the engine has installed, with the folder each is unpacked in. From a thread
/// that is not the window's: the page's answers arrive on that one.
pub fn installed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    let Some(page) = control(app) else {
        return Vec::new();
    };
    let Ok(profile) = crate::engine::root(app).map(|root| root.join("Default").join("Extensions"))
    else {
        return Vec::new();
    };
    let all = asked(&page, LIST)
        .and_then(|all| all.as_array().cloned())
        .unwrap_or_default();
    entries(&all, &profile)
}

/// Every installed extension the engine listed, with its folder: `<profile>/Extensions`
/// for one from a store, the folder it was loaded from for one loaded unpacked. One whose
/// files are nowhere is left out: nothing of it can be drawn.
fn entries(all: &[Value], profile: &Path) -> Vec<(Kept, PathBuf)> {
    all.iter()
        .filter_map(|one| {
            let id = one["id"].as_str()?.to_owned();
            let version = one["version"].as_str()?.to_owned();
            let folder = match one["path"].as_str().filter(|path| !path.is_empty()) {
                Some(path) => Some(PathBuf::from(path)).filter(|folder| folder.is_dir()),
                None => unpacked(&profile.join(&id), &version),
            }?;
            let kept = Kept {
                id,
                store: if one["edge"].as_bool() == Some(true) {
                    Store::Edge
                } else {
                    Store::Chrome
                },
                version,
                enabled: one["enabled"].as_bool().unwrap_or(true),
                pinned: true,
            };
            Some((kept, folder))
        })
        .collect()
}

/// What the engine is asked for its list: each extension's id, version, whether it is
/// on, whether Edge Add-ons keeps it, and, for one loaded unpacked, its folder.
/// `chrome.developerPrivate` is asked beside `chrome.management` for the folder alone,
/// and a list without it is still the list.
const LIST: &str = "Promise.all([chrome.management.getAll(), chrome.developerPrivate ? chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }).catch(() => []) : []]).then(([all, info]) => all.filter(one => one.type === 'extension').map(one => ({ id: one.id, version: one.version, enabled: one.enabled, edge: (one.updateUrl || '').includes('edge.microsoft.com'), path: (info.find(said => said.id === one.id) || {}).path || null })))";

/// Where Chromium unpacked a version: `<version>_<n>`, the highest `n`.
fn unpacked(home: &Path, version: &str) -> Option<PathBuf> {
    let prefix = format!("{version}_");
    std::fs::read_dir(home)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry| entry.path())
        .max()
}

/// Turns one on or off, keeping what it stored.
pub fn enable(app: &AppHandle, id: &str, on: bool) -> Result<(), String> {
    let page = control(app).ok_or("the engine's extensions could not be reached")?;
    asked(
        &page,
        &format!(
            "chrome.management.setEnabled({}, {on}).then(() => true)",
            json!(id)
        ),
    )
    .map(|_| ())
    .ok_or_else(|| "the engine did not change it".to_string())
}

/// Takes one away, with what it stored.
pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let page = control(app).ok_or("the engine's extensions could not be reached")?;
    asked(
        &page,
        &format!(
            "chrome.management.uninstall({}, {{ showConfirmDialog: false }}).then(() => true)",
            json!(id)
        ),
    )
    .map(|_| ())
    .ok_or_else(|| "the engine did not remove it".to_string())
}

/// The page that asks the management API, built the first time it is needed and kept,
/// out of sight, in the browsing profile.
fn control(app: &AppHandle) -> Option<Webview> {
    let _building = BUILDING.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(page) = app.get_webview(CONTROL) {
        return Some(page);
    }
    let window = app.get_window("main")?;
    let address: tauri::Url = "chrome://extensions/".parse().ok()?;
    let builder = WebviewBuilder::new(CONTROL, WebviewUrl::External(address)).focused(false);
    let builder = crate::engine::web_store(builder, app, None).ok()?;
    let (made, waiting) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let built = window.add_child(
            builder,
            LogicalPosition::new(-10_000.0, -10_000.0),
            LogicalSize::new(400.0, 300.0),
        );
        let _ = made.try_send(built.ok());
    })
    .ok()?;
    let page = waiting.recv_timeout(PATIENCE).ok().flatten()?;
    // Ready once the management API answers.
    for _ in 0..50 {
        if asked(&page, "typeof chrome.management === 'object'").and_then(|said| said.as_bool())
            == Some(true)
        {
            return Some(page);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// What a promise the page evaluates comes to.
fn asked(page: &Webview, expression: &str) -> Option<Value> {
    let said = devtools::call(
        page,
        None,
        "Runtime.evaluate",
        &json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
        PATIENCE,
    )
    .ok()?;
    if said.get("exceptionDetails").is_some() {
        return None;
    }
    said.get("result")?.get("value").cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(at: &Path) -> PathBuf {
        std::fs::create_dir_all(at).expect("a folder");
        at.to_path_buf()
    }

    #[test]
    fn one_from_a_store_is_read_where_chromium_unpacked_it() {
        let profile = tempfile::tempdir().expect("a profile");
        let id = "eimadpbcbfnmbkopoojfekhnkhdbieeh";
        folder(&profile.path().join(id).join("4.9.0_0"));
        let newest = folder(&profile.path().join(id).join("4.9.0_1"));

        let all =
            [json!({ "id": id, "version": "4.9.0", "enabled": true, "edge": false, "path": null })];
        let found = entries(&all, profile.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, newest);
        assert_eq!(found[0].0.store, Store::Chrome);
    }

    #[test]
    fn one_loaded_unpacked_is_read_where_it_was_loaded_from() {
        let profile = tempfile::tempdir().expect("a profile");
        let loaded = tempfile::tempdir().expect("a folder of its own");
        let id = "ddkjiahejlhfcafbddmgiahcphecmpfh";
        let all = [json!({
            "id": id,
            "version": "2026.1",
            "enabled": false,
            "edge": true,
            "path": loaded.path().to_string_lossy(),
        })];
        let found = entries(&all, profile.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, loaded.path());
        assert!(!found[0].0.enabled);
        assert_eq!(found[0].0.store, Store::Edge);
    }

    #[test]
    fn one_whose_files_are_nowhere_is_left_out() {
        let profile = tempfile::tempdir().expect("a profile");
        let all = [
            json!({ "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "version": "1", "enabled": true, "path": null }),
            json!({ "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "version": "1", "enabled": true, "path": r"C:\nowhere\at\all" }),
        ];
        assert!(entries(&all, profile.path()).is_empty());
    }
}
