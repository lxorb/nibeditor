//! Chrome and Edge extensions in web tabs, on both engines.
//!
//! Emil, 2026-10-03: extensions on `WebView2` and on nib's own Chromium, installed from a
//! Chrome Web Store or Edge Add-ons link or from the store's own page in a tab, kept in
//! the app's own folder, updated through the stores' own update service, with a button in
//! the web bar, the popup in a bubble, the options page as a tab and a list in Settings.
//!
//! **Who installs depends on the engine, and nothing else does.** `WebView2` installs
//! nothing from a store - its API takes an unpacked folder - so on it nib installs: the
//! file fetched from the store's update service (fetch.rs), checked the way Chromium
//! checks it (crx.rs), unpacked into `<config>/extensions` (library.rs), handed to every
//! store's profile (webview2.rs), and updated the same way. nib's own Chromium installs
//! from the store for itself and refuses a host the one door to install a folder, so there
//! the store's own button installs and the list is the engine's (chromium.rs). Everything
//! the reader sees is the same on both: the button and its icons in the web bar
//! (lib/web-tab/ExtensionButtons.svelte), the popup in a bubble (popup.rs), the options
//! page as a tab, the rows in Settings.
//!
//! **Where they run.** Every store a reader's tab can be in: the shared one, a space's, a
//! site's. Never nib's own interface, which is a separate data folder on `WebView2` and a
//! separate profile on Chromium (engine.rs). And never an agent's own store, which is
//! built with extensions off at the engine; see `in_store`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Url};

// What nib installs itself, which on nib's own Chromium the store does; see chromium.rs.
#[cfg(not(feature = "cef"))]
mod crx;
#[cfg(not(feature = "cef"))]
mod fetch;
pub mod library;
pub mod link;
mod manifest;
pub mod popup;
#[cfg(not(feature = "cef"))]
mod unzip;

#[cfg(feature = "cef")]
mod chromium;
#[cfg(all(windows, not(feature = "cef")))]
pub mod webview2;

use library::Kept;
use link::Store;
use manifest::About;

/// What the window hears when the list changed: nothing, the window asks again.
const CHANGED: &str = "nib://extensions";

/// One change to the list at a time, so two installs never write over each other.
static WRITING: Mutex<()> = Mutex::new(());

/// The ids installed, for the one question asked of every address a tab goes to: is
/// `chrome-extension://<id>/` one of ours? Filled each time the list is read.
static KNOWN: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

/// Why an extension did not load this run, by id, for its row to say.
static PROBLEMS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Writes down why an extension did not load.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only what nib hands WebView2 can fail to load")
)]
fn went_wrong(id: &str, why: &str) {
    let mut problems = PROBLEMS.lock().unwrap_or_else(PoisonError::into_inner);
    problems.retain(|(one, _)| one != id);
    problems.push((id.to_owned(), why.to_owned()));
}

/// An extension that loaded has nothing wrong with it any more.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only what nib hands WebView2 can fail to load")
)]
fn went_right(id: &str) {
    PROBLEMS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|(one, _)| one != id);
}

/// Whether this build's engine runs extensions at all: `WebView2` and nib's Chromium.
/// A Mac's and Linux's own engines have no extension API.
pub const SUPPORTED: bool = cfg!(any(feature = "cef", windows));

/// The folder extensions live in, made if it is not there.
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("extensions");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Whether a store's pages run extensions: every store but an agent's own.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "an environment option of WebView2's; nib's own Chromium keeps agents' stores apart by profile"
    )
)]
pub fn in_store(store: Option<&str>) -> bool {
    SUPPORTED && !store.is_some_and(|name| name.starts_with("agent_"))
}

/// Whether `url` is a page of an installed extension: `chrome-extension://<id>/...`.
pub fn ours(url: &Url) -> bool {
    url.scheme() == "chrome-extension"
        && url.host_str().is_some_and(|id| {
            KNOWN
                .read()
                .unwrap_or_else(PoisonError::into_inner)
                .contains(id)
        })
}

/// The list as written down: on `WebView2`, what nib installed; on nib's own Chromium,
/// the pins the reader set, the list itself being the engine's (`listed`).
pub fn kept(app: &AppHandle) -> Vec<Kept> {
    root(app)
        .map(|root| library::read(&root))
        .unwrap_or_default()
}

/// What is installed, each with the folder it is unpacked in, and the ids remembered for
/// `ours`. From a thread that is not the window's: on Chromium the engine is asked.
fn listed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    #[cfg(feature = "cef")]
    let list: Vec<(Kept, PathBuf)> = {
        let pins = kept(app);
        chromium::installed(app)
            .into_iter()
            .map(|(mut one, folder)| {
                one.pinned = pins
                    .iter()
                    .find(|pin| pin.id == one.id)
                    .is_none_or(|pin| pin.pinned);
                (one, folder)
            })
            .collect()
    };
    #[cfg(not(feature = "cef"))]
    let list: Vec<(Kept, PathBuf)> = match root(app) {
        Ok(root) => library::read(&root)
            .into_iter()
            .map(|one| {
                let folder = library::folder_of(&root, &one.id, &one.version);
                (one, folder)
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    *KNOWN.write().unwrap_or_else(PoisonError::into_inner) =
        list.iter().map(|(one, _)| one.id.clone()).collect();
    list
}

/// One extension as the window draws it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    #[serde(flatten)]
    kept: Kept,
    #[serde(flatten)]
    about: About,
    /// Its picture as a `data:` address, so the window needs no way into the folder.
    picture: Option<String>,
    /// Why it did not load this run, if it did not.
    problem: Option<String>,
}

/// An extension's row: the list's entry and what its manifest says.
fn shown(kept: Kept, folder: &Path) -> Shown {
    let about = manifest::read(folder).unwrap_or_default();
    let picture = about.icon.as_deref().and_then(|icon| picture(folder, icon));
    let problem = PROBLEMS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .find(|(id, _)| *id == kept.id)
        .map(|(_, why)| why.clone());
    Shown {
        kept,
        about,
        picture,
        problem,
    }
}

/// A picture in an extension's folder as a `data:` address, if it is a small one.
fn picture(folder: &Path, path: &str) -> Option<String> {
    use base64::Engine as _;

    let kind = match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let bytes = std::fs::read(folder.join(path)).ok()?;
    (bytes.len() <= 512 * 1024).then(|| {
        format!(
            "data:{kind};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

/// Tells the window the list changed, and every `WebView2` store what it now holds.
fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED, ());
    #[cfg(all(windows, not(feature = "cef")))]
    webview2::apply(app);
}

/// What is installed.
#[tauri::command]
pub async fn extensions_list(app: AppHandle) -> Result<Vec<Shown>, String> {
    if !SUPPORTED {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        listed(&app)
            .into_iter()
            .map(|(one, folder)| shown(one, &folder))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// What an install came to: the extension, installed - or, on nib's own Chromium, the
/// store's own page, where the store's own button installs it.
#[derive(Serialize)]
#[serde(untagged)]
pub enum Done {
    #[cfg_attr(
        feature = "cef",
        allow(dead_code, reason = "nib's own Chromium installs through the store")
    )]
    Installed(Box<Shown>),
    #[cfg_attr(
        not(feature = "cef"),
        allow(
            dead_code,
            reason = "only nib's own Chromium sends the reader to the store"
        )
    )]
    Store { store: String },
}

/// Installs the extension a store link or an id names, or updates it if it is there.
#[tauri::command]
pub async fn extensions_install(app: AppHandle, link: String) -> Result<Done, String> {
    if !SUPPORTED {
        return Err("this engine runs no extensions".into());
    }
    let (store, id) = link::named(&link).ok_or("that is not a link to an extension")?;
    #[cfg(feature = "cef")]
    {
        let _ = app;
        Ok(Done::Store {
            store: link::page_of(store, &id),
        })
    }
    #[cfg(not(feature = "cef"))]
    {
        let bytes = fetch::crx(store, &id).await?;
        installed(app, store, id, bytes)
            .await
            .map(|one| Done::Installed(Box::new(one)))
    }
}

/// Unpacks a fetched file, puts it on the list and hands it to the engines.
#[cfg(not(feature = "cef"))]
async fn installed(
    app: AppHandle,
    store: Store,
    id: String,
    bytes: Vec<u8>,
) -> Result<Shown, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let version = library::unpack(&root, store, &id, &bytes)?;

        let one = {
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            let mut list = kept(&app);
            let one = if let Some(there) = list.iter_mut().find(|one| one.id == id) {
                there.version.clone_from(&version);
                there.store = store;
                there.clone()
            } else {
                let fresh = Kept {
                    id: id.clone(),
                    store,
                    version,
                    enabled: true,
                    pinned: true,
                };
                list.push(fresh.clone());
                fresh
            };
            library::write(&root, &list)?;
            one
        };
        let folder = library::folder_of(&root, &one.id, &one.version);
        let _ = listed(&app);
        changed(&app);
        Ok(shown(one, &folder))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Turns an extension on or off, or pins or unpins its button.
#[tauri::command]
pub async fn extensions_set(
    app: AppHandle,
    id: String,
    enabled: Option<bool>,
    pinned: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        // nib's own Chromium keeps whether one is on itself, and loses nothing it stored.
        #[cfg(feature = "cef")]
        if let Some(on) = enabled {
            chromium::enable(&app, &id, on)?;
        }
        {
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            let mut list = kept(&app);
            if !list.iter().any(|one| one.id == id) {
                let (one, _) = listed(&app)
                    .into_iter()
                    .find(|(one, _)| one.id == id)
                    .ok_or("that extension is not installed")?;
                list.push(one);
            }
            if let Some(one) = list.iter_mut().find(|one| one.id == id) {
                if let Some(on) = enabled {
                    one.enabled = on;
                }
                if let Some(on) = pinned {
                    one.pinned = on;
                }
            }
            library::write(&root, &list)?;
        }
        changed(&app);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Removes an extension: from every store, and on `WebView2` its folder with it on the next
/// tidy.
#[tauri::command]
pub async fn extensions_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        #[cfg(feature = "cef")]
        chromium::remove(&app, &id)?;
        {
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            let mut list = kept(&app);
            list.retain(|one| one.id != id);
            library::write(&root, &list)?;
        }
        let _ = listed(&app);
        changed(&app);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Looks for a newer version of every extension, and installs what it finds. Answers how
/// many moved. The window asks every few hours, never at the launch. nib's own Chromium
/// updates what its store installed itself.
#[tauri::command]
pub async fn extensions_update(app: AppHandle) -> Result<usize, String> {
    #[cfg(feature = "cef")]
    {
        let _ = app;
        Ok(0)
    }
    #[cfg(not(feature = "cef"))]
    {
        if !SUPPORTED {
            return Ok(0);
        }
        let mut moved = 0;
        for one in kept(&app) {
            let Ok(Some((_, file))) = fetch::newer(one.store, &one.id, &one.version).await else {
                continue;
            };
            let Ok(bytes) = fetch::download(&file).await else {
                continue;
            };
            if installed(app.clone(), one.store, one.id.clone(), bytes)
                .await
                .is_ok()
            {
                moved += 1;
            }
        }
        Ok(moved)
    }
}

/// The address of an extension's popup or options page, for the window to open.
#[tauri::command]
pub async fn extensions_page(app: AppHandle, id: String, options: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || page_of(&app, &id, options))
        .await
        .map_err(|error| error.to_string())?
}

/// The address of an extension's popup, or of its options page.
fn page_of(app: &AppHandle, id: &str, options: bool) -> Result<String, String> {
    let (_, folder) = listed(app)
        .into_iter()
        .find(|(one, _)| one.id == id)
        .ok_or("that extension is not installed")?;
    let about = manifest::read(&folder)?;
    let page = if options { about.options } else { about.popup };
    page.map(|page| format!("chrome-extension://{id}/{page}"))
        .ok_or_else(|| "that extension has no such page".to_string())
}

/// The store's own page a tab is on, if it is an extension's: `(store, id)`, so the bar
/// can offer Add there. Never on nib's own Chromium, where the store's own button
/// installs.
#[tauri::command]
pub fn extensions_named(link: String) -> Option<(Store, String)> {
    if !SUPPORTED || cfg!(feature = "cef") {
        return None;
    }
    link::named(&link).filter(|_| link.contains("://"))
}

/// Folders nothing on the list names any more, and versions an update left behind. Once
/// a run, after the first store has been handed its extensions, so no engine still has a
/// folder it is being taken away from.
#[cfg(all(windows, not(feature = "cef")))]
pub fn tidy(app: &AppHandle) {
    let Ok(root) = root(app) else {
        return;
    };
    let list = library::read(&root);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !entry.path().is_dir() {
            continue;
        }
        match list.iter().find(|one| one.id == name) {
            Some(one) => library::prune(&root, &one.id, &one.version),
            None => library::forget(&root, &name),
        }
    }
}
