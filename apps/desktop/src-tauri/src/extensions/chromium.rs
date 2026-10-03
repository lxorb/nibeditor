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
//! it. The files are read where Chromium unpacked them, `<profile>/Extensions/<id>`.

use std::path::PathBuf;
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
    let all = asked(
        &page,
        "chrome.management.getAll().then(all => all.filter(one => one.type === 'extension').map(one => ({ id: one.id, version: one.version, enabled: one.enabled, edge: (one.updateUrl || '').includes('edge.microsoft.com') })))",
    )
    .and_then(|all| all.as_array().cloned())
    .unwrap_or_default();

    all.iter()
        .filter_map(|one| {
            let id = one["id"].as_str()?.to_owned();
            let version = one["version"].as_str()?.to_owned();
            let folder = unpacked(&profile.join(&id), &version)?;
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

/// Where Chromium unpacked a version: `<version>_<n>`, the highest `n`.
fn unpacked(home: &std::path::Path, version: &str) -> Option<PathBuf> {
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
