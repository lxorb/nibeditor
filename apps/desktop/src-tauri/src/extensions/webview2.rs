//! The list, handed to `WebView2`: each store's profile given exactly the extensions
//! that are on the list, at the version on the list, on or off as the list says.
//!
//! A store's profile is reached through any page built in it, so the first web tab of a
//! store in a run is where it is reconciled, and every change to the list after that is
//! handed to every store that has a page open. A store with no page open is reconciled
//! the next time one is built there, which is also the first time anything could run an
//! extension in it.
//!
//! `WebView2` keeps what it was given across runs, in the profile, so most runs find
//! every store already right and add nothing. It cannot say which folder or version an
//! extension came from - only its id and whether it is on - so the version each store
//! was handed is written down beside the list (`applied.json`), and a store whose version
//! is behind the list's is handed the new folder, which replaces the old one by id.
//!
//! Everything here runs on the window's own thread, where the engine's objects live and
//! its answers arrive.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Once;

use tauri::webview::PlatformWebview;
use tauri::AppHandle;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2BrowserExtension, ICoreWebView2Profile7, ICoreWebView2_13,
};
use webview2_com::{
    BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
};
use windows_core::{Interface as _, HSTRING, PWSTR};

use super::library::{self, Kept};

thread_local! {
    /// The profile of every store with a page open this run, by store - the shared one
    /// under the empty name - with the environment it was reached through, so a store
    /// whose browser process ended and started again is reconciled again.
    static OPEN: RefCell<HashMap<String, (ICoreWebView2Profile7, usize)>> =
        RefCell::new(HashMap::new());
}

/// The folders nothing names any more go once a run, off the window's thread.
static TIDIED: Once = Once::new();

/// A page was built in `store`: its profile is remembered, and handed the list if it is
/// new to this run. Called as every web tab's page is built.
pub fn seen(app: &AppHandle, store: Option<&str>, platform: &PlatformWebview) {
    if !super::in_store(store) {
        return;
    }
    let Some(profile) = profile_of(platform) else {
        return;
    };
    let key = store.unwrap_or_default().to_owned();
    let environment = platform.environment().as_raw() as usize;
    let fresh = OPEN.with_borrow_mut(|open| {
        let fresh = open.get(&key).is_none_or(|(_, seen)| *seen != environment);
        if fresh {
            open.insert(key.clone(), (profile.clone(), environment));
        }
        fresh
    });
    if fresh {
        reconcile(app, &key, &profile);
    }

    let tidying = app.clone();
    TIDIED.call_once(move || {
        std::thread::spawn(move || super::tidy(&tidying));
    });
}

/// Hands every open store the list as it is now.
pub fn apply(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let open: Vec<(String, ICoreWebView2Profile7)> = OPEN.with_borrow(|open| {
            open.iter()
                .map(|(key, (profile, _))| (key.clone(), profile.clone()))
                .collect()
        });
        for (key, profile) in open {
            reconcile(&handle, &key, &profile);
        }
    });
}

/// The profile a page is in, if the engine is new enough to have extensions.
fn profile_of(platform: &PlatformWebview) -> Option<ICoreWebView2Profile7> {
    #[allow(
        unsafe_code,
        reason = "the profile is reached through WebView2's own COM interfaces, on the page's own thread"
    )]
    // Safe: the controller is this page's, asked on the thread it was built on.
    unsafe {
        platform
            .controller()
            .CoreWebView2()
            .ok()?
            .cast::<ICoreWebView2_13>()
            .ok()?
            .Profile()
            .ok()?
            .cast::<ICoreWebView2Profile7>()
            .ok()
    }
}

/// Makes `store`'s profile hold what the list holds.
#[allow(
    unsafe_code,
    reason = "the extensions are read, added, turned on and off and removed through WebView2's own COM interfaces"
)]
fn reconcile(app: &AppHandle, store: &str, profile: &ICoreWebView2Profile7) {
    let Ok(root) = super::root(app) else {
        return;
    };
    let list = super::kept(app);
    let store = store.to_owned();
    let adding = profile.clone();

    let handler =
        ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, extensions| {
            if result.is_err() {
                return Ok(());
            }
            let installed = extensions.map(|all| listed(&all)).unwrap_or_default();
            let applied = library::applied(&root);
            let given = applied.get(&store).cloned().unwrap_or_default();

            for kept in &list {
                match installed.get(&kept.id) {
                    Some(extension) if given.get(&kept.id) == Some(&kept.version) => {
                        switched(extension, kept.enabled);
                    }
                    _ => add(&adding, &root, &store, kept),
                }
            }
            let mut stale = Vec::new();
            for (id, extension) in &installed {
                if !list.iter().any(|kept| &kept.id == id) {
                    // Safe: the extension is this profile's, on the window's thread.
                    unsafe {
                        let _ = extension.Remove(&BrowserExtensionRemoveCompletedHandler::create(
                            Box::new(|_| Ok(())),
                        ));
                    }
                    stale.push(id.clone());
                }
            }
            if !stale.is_empty() {
                let mut applied = library::applied(&root);
                if let Some(given) = applied.get_mut(&store) {
                    given.retain(|id, _| !stale.contains(id));
                }
                let _ = library::write_applied(&root, &applied);
            }
            Ok(())
        }));
    // Safe: the profile is the page's, on the window's thread.
    unsafe {
        let _ = profile.GetBrowserExtensions(&handler);
    }
}

/// What a profile has, by id.
#[allow(unsafe_code, reason = "the list is WebView2's own COM collection")]
fn listed(
    all: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2BrowserExtensionList,
) -> HashMap<String, ICoreWebView2BrowserExtension> {
    let mut out = HashMap::new();
    let mut count = 0u32;
    // Safe: the collection the engine handed this answer, read on the thread it arrived on.
    unsafe {
        if all.Count(&raw mut count).is_err() {
            return out;
        }
        for at in 0..count {
            let Ok(one) = all.GetValueAtIndex(at) else {
                continue;
            };
            let mut id = PWSTR::null();
            if one.Id(&raw mut id).is_ok() {
                out.insert(webview2_com::take_pwstr(id), one);
            }
        }
    }
    out
}

/// Turns an extension on or off, if it is not already.
#[allow(unsafe_code, reason = "WebView2's own COM interface")]
fn switched(extension: &ICoreWebView2BrowserExtension, enabled: bool) {
    let mut on = windows_core::BOOL::default();
    // Safe: the extension is this profile's, on the window's thread.
    unsafe {
        if extension.IsEnabled(&raw mut on).is_ok() && on.as_bool() != enabled {
            let _ = extension.Enable(
                enabled,
                &BrowserExtensionEnableCompletedHandler::create(Box::new(|_| Ok(()))),
            );
        }
    }
}

/// Hands a profile one extension's folder, and writes down the version once it took it.
#[allow(unsafe_code, reason = "WebView2's own COM interface")]
fn add(profile: &ICoreWebView2Profile7, root: &std::path::Path, store: &str, kept: &Kept) {
    let folder = library::folder_of(root, &kept.id, &kept.version);
    if !folder.join("manifest.json").is_file() {
        super::went_wrong(&kept.id, "its files are missing");
        return;
    }
    let (root, store, id, version, enabled) = (
        root.to_path_buf(),
        store.to_owned(),
        kept.id.clone(),
        kept.version.clone(),
        kept.enabled,
    );
    let handler =
        ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
            match (result, extension) {
                (Ok(()), Some(extension)) => {
                    if !enabled {
                        switched(&extension, false);
                    }
                    let mut applied = library::applied(&root);
                    applied
                        .entry(store.clone())
                        .or_default()
                        .insert(id.clone(), version.clone());
                    let _ = library::write_applied(&root, &applied);
                    super::went_right(&id);
                }
                (Err(error), _) => super::went_wrong(&id, &error.message()),
                (Ok(()), None) => super::went_wrong(&id, "the engine did not take it"),
            }
            Ok(())
        }));
    // Safe: the profile is the page's, on the window's thread.
    unsafe {
        if let Err(error) = profile.AddBrowserExtension(&HSTRING::from(folder.as_path()), &handler)
        {
            super::went_wrong(&kept.id, &error.message());
        }
    }
}
