//! Which engine every webview in this build runs on, and which profile each of
//! them is in.
//!
//! Two builds come out of this source and they differ in one thing. The app that ships
//! runs every webview on the system's engine - `WebView2` on Windows, `WKWebView` on a
//! Mac, `WebKitGTK` on Linux - which is what Tauri gives without being asked. The other,
//! `nib-chromium`, is the same library compiled against Tauri 3 and `tauri-runtime-cef`
//! by `apps/desktop/src-tauri/cef`, with the `cef` feature on: nib's own Chromium, in
//! nib's own process, the app's interface and every web tab views in one browser process.
//! Which of the two a launch is, is the reader's choice in Settings; see
//! `engine_switch.rs`, and docs/browser.md for the design and the measurements.
//!
//! **The default build names no engine.** Everything Chromium is behind the feature, and
//! `tauri-runtime-cef`, the `cef` crate and the three hundred megabytes they download
//! are a dependency of the engine build's manifest alone, so the app's dependency graph,
//! lock file and launch are the ones that shipped yesterday.
//!
//! **The two profiles.** Chromium serves many profiles from one browser process, and an
//! extension is installed into a profile - so two profiles is what keeps an extension a
//! reader installed for the web out of nib's own interface. It is not a precaution: with
//! one profile the spike's test extension read the app's own document, in a screenshot,
//! on the first try (docs/browser.md section 9). The browsing profile is the engine's
//! *primary* one, which is where an extension installed by the command line or by
//! Chromium's policies lands, and nib's interface is the named one beside it. A space
//! that keeps its web data apart has a profile of its own too.
//!
//! ```text
//! <config>/chromium/                Chromium's user data directory, one lock on it
//! <config>/chromium/Default         the browsing profile. Cookies, logins, extensions
//! <config>/chromium/app             nib's own interface. No extensions, nothing granted
//! <config>/chromium/store-<name>    a space's or a site's own store; see web_stores.rs
//! ```
//!
//! The system's engine keeps the folder it has always used - `<config>/web`, as one
//! `WebView2` user data folder or one `WKWebView` data store - so nobody's cookies moved
//! because a second engine exists, and the two engines never read each other's files. A
//! store of its own is a folder under `<config>/web-stores`; see `web_stores.rs`.

use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

/// The folder inside the app's own settings folder that the web lives in: the
/// `WebView2` user data folder the system's engine has always used.
#[cfg(not(feature = "cef"))]
const ROOT: &str = "web";

/// And nib's own Chromium's user data directory, a folder of its own beside it: two
/// engines on one machine, each with its own profiles. A profile is a direct child of
/// it, which is the only shape CEF accepts. `cef/src/main.rs` names the same place.
#[cfg(feature = "cef")]
const ROOT: &str = "chromium";

/// What a store of its own is called as a Chromium profile, in front of its name.
#[cfg(feature = "cef")]
const STORE_PROFILE: &str = "store-";

/// The profile nib's own interface is in, as a folder name.
///
/// Only the `cef` feature has profiles; the name is here rather than beside its one
/// caller so that the layout in this file's comment is the layout in this file.
#[cfg_attr(
    not(feature = "cef"),
    allow(
        dead_code,
        reason = "only nib's own Chromium has profiles to name; the name is kept beside the layout it belongs to"
    )
)]
const APP_PROFILE: &str = "app";

/// The same sixteen bytes every time, so `WKWebView` hands back the store it handed
/// out last time. macOS 14 and later; older macOS has no such API and falls back to
/// the default store, which is the one case where a web tab and the app share a
/// profile on disk. Said out loud in docs/web-tabs.md rather than hidden here.
#[cfg(all(not(feature = "cef"), target_os = "macos"))]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

/// The switches every `WebView2` browser process of this app starts with: the app's own
/// page and every web tab's, in every store.
///
/// Three are wry's own defaults, written out again because passing any switches
/// replaces them: Edge's mini menu over a selection, in a page and in a PDF, and
/// `SmartScreen`. One is nib's: **`HideCursorWhileTyping` is off**. Emil, 2026-09-28:
/// *"manchmal habe ich einfach keinen mouse cursor waehrend ich im browser bin. dann
/// muss ich ihn aus dem browserfenster raus und dann wieder rein bewegen."*
///
/// The engine hides the pointer while somebody types, for Windows' *Hide pointer while
/// typing*, with `ShowCursor(FALSE)` on its own thread, and shows it again on the next
/// mouse event that same browser process receives. That is sound in a browser, which
/// is one process under one window. Here it is two or more: the app's page and the web
/// pages keep separate profiles, so separate browser processes, and every thread with a
/// window in nib's window shares one input queue and so one pointer count. Type an
/// address with the pointer resting on the page, and the app's process hides the pointer
/// over the whole window; moving it about the page reaches only the page's process,
/// which never hid it, so it stays gone until it crosses into the app's own page. The
/// same holds the other way round, and between two stores. Measured with
/// `scripts/web-cursor-probe.py`.
///
/// The engine offers no way to show a pointer another process hid, so the hiding goes:
/// the pointer stays where it was while somebody types, as it always had in nib until the
/// runtime started hiding it. One `--disable-features`, because Chromium reads only the
/// last of a repeated switch. Every webview on one user data folder must be started with
/// the same switches, which is why there is one list and not one per caller.
#[cfg(all(windows, not(feature = "cef")))]
pub(crate) const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping";

/// The folder the web's own storage lives in, made if it is not there yet.
#[cfg(desktop)]
#[cfg_attr(
    all(not(feature = "cef"), target_os = "macos"),
    allow(
        dead_code,
        reason = "a Mac's own engine is handed a store identifier rather than a folder; the folder is what the other two desktops and nib's own Chromium use"
    )
)]
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}

/// Where nib's own interface keeps what a webview keeps.
///
/// A profile of its own, so an extension installed for the web cannot reach the
/// app's own document: an extension is installed into a profile, and this is not
/// that profile.
#[cfg(feature = "cef")]
pub(crate) fn app_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?.join(APP_PROFILE);
    made(&dir)?;
    Ok(dir)
}

/// Where a web tab's site data goes, on the engine this build runs on.
///
/// **This is the seam.** One call for every engine, so `web_tabs.rs` says where a
/// page's storage goes once rather than once per platform per engine, and so the
/// answer for nib's own Chromium is in the module that knows about engines.
///
/// `store` is the store the tab was asked to be in, already checked by
/// `web_stores::named`: `None` for the one every space shares, a name for a space or a
/// site that keeps its own. See `web_stores.rs`.
///
/// - The system's engine: for the shared store, the folder the app has always used,
///   as a user data folder on Windows and Linux and as a data store identifier on a
///   Mac, unchanged to the byte from what shipped. For a store of its own, a folder of
///   its own under `web-stores`, or sixteen bytes of its own on a Mac.
/// - nib's own Chromium: nothing, deliberately, and for every store. A web tab is in
///   the engine's primary profile, which is where an extension installed by the
///   command line or by policy lands, and nib's own interface is the named profile
///   beside it; see this file's comment. A space that asks for a store of its own
///   shares that one there, until the runtime can be asked for a profile per tab.
#[cfg(all(desktop, not(feature = "cef")))]
#[cfg_attr(
    target_os = "macos",
    allow(
        clippy::unnecessary_wraps,
        reason = "the seam is one signature for every engine and platform; only the Windows and Linux path reaches the disk and can fail, and the caller returns Result either way"
    )
)]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    // Extensions run in every store a reader's tab can be in and in none of an agent's.
    // An environment option, and every page on one data folder must be built with the
    // same options, which is why it is decided here, by store, and nowhere else. See
    // extensions.rs.
    #[cfg(windows)]
    let builder = builder
        .additional_browser_args(BROWSER_ARGS)
        .browser_extensions_enabled(crate::extensions::in_store(store));

    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.data_directory(match store {
        None => root(app)?,
        Some(name) => {
            let dir = config_dir(app)?.join(crate::web_stores::STORES).join(name);
            made(&dir)?;
            dir
        }
    });

    #[cfg(target_os = "macos")]
    let builder = {
        let _ = app;
        builder.data_store_identifier(store.map_or(STORE_ID, crate::web_stores::identifier))
    };

    Ok(builder)
}

/// Where a web tab's site data goes on nib's own Chromium: the engine's primary
/// profile for the store every space shares - asked for as the user data directory
/// itself, which is how the runtime is told "the primary one" rather than a profile named
/// after it - and a profile of its own beside it for a store of its own. See above.
#[cfg(feature = "cef")]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    Ok(builder.data_directory(profile(app, store)?))
}

/// The folder a store's profile is on nib's own Chromium: the user data directory itself
/// for the store every space shares, which is how the engine is told "the primary
/// profile", and a profile of its own beside it for a store of its own. An agent's page
/// is put in a store's profile by this folder too (agents/engines/cef.rs).
#[cfg(feature = "cef")]
pub(crate) fn profile(app: &AppHandle, store: Option<&str>) -> Result<PathBuf, String> {
    let root = root(app)?;
    Ok(match store {
        None => root,
        Some(name) => {
            let dir = root.join(format!("{STORE_PROFILE}{name}"));
            made(&dir)?;
            dir
        }
    })
}

/// The window the config describes, taken out of it so it is built by our own code
/// instead. The config keeps saying what the window looks like; only who builds it
/// changes.
///
/// One reason per engine, and the same mechanism for both. Nib's own Chromium needs
/// the interface in a profile of its own, and a profile is asked for when a webview is
/// built. The system's webview needs the window on screen before the webview inside it
/// exists, and a window the runtime builds cannot be: it is built around its webview,
/// so nothing is visible until the webview runtime has started - between a third and
/// half of a launch on Windows. Either way a window in `tauri.conf.json` is built
/// before any of our own code runs, and this is what takes that over.
pub(crate) fn take_ui_window(
    context: &mut tauri::Context,
) -> Option<tauri::utils::config::WindowConfig> {
    let windows = &mut context.config_mut().app.windows;
    if windows.is_empty() {
        return None;
    }
    Some(windows.remove(0))
}

/// The builder of nib's own window, on the engine this build runs on: everything the
/// window needs from the engine, and nothing about where it goes or when it shows,
/// which is the same on both and is `ready`'s in lib.rs.
///
/// - The system's engine: developer tools in a development build only, as nib's own
///   window always had, and the switches every page of this app starts with; see
///   [`BROWSER_ARGS`].
/// - nib's own Chromium: the interface in a profile of its own, so an extension
///   installed for the web cannot reach the app's own document; see this file's comment.
pub(crate) fn ui_window<'a, M: tauri::Manager<crate::Engine>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, crate::Engine, M>, Box<dyn std::error::Error>> {
    let building =
        tauri::WebviewWindowBuilder::from_config(manager, config)?.devtools(cfg!(debug_assertions));
    #[cfg(all(windows, not(feature = "cef")))]
    let building = building.additional_browser_args(BROWSER_ARGS);
    #[cfg(feature = "cef")]
    let building = {
        let label = config.label.clone();
        building
            .data_directory(app_profile(manager.app_handle())?)
            // What the interface calls itself, which is how the gate can tell whether an
            // extension in the browsing profile reached across into it. Nothing but the
            // gate reads it, and the gate only exists in this build.
            .on_document_title_changed(move |_window, title| gate::title_seen(&label, &title))
    };
    Ok(building)
}

/// Whether a page is one the engine loads for itself rather than one a tab was sent to.
///
/// `tauri-runtime-cef` builds every browser on an inert document of its own - a `data:`
/// page marked `data-tauri-cef-internal`, titled "Tauri CEF Initial Load" - and only then
/// sends it where it was asked to go. It hides that page's address from the address
/// event and from nobody else: its load and its title arrive like any page's, and a web
/// tab took them for its own - one came back from a relaunch named after that page, at
/// that page. The system's engine has no such page, so nothing is one there.
pub(crate) fn internal(url: &str) -> bool {
    url.starts_with("data:") && url.contains("data-tauri-cef-internal")
}

#[cfg(feature = "cef")]
pub(crate) mod devtools;
#[cfg(feature = "cef")]
pub(crate) mod gate;

#[cfg(test)]
mod tests {
    use super::{internal, APP_PROFILE, ROOT};

    #[test]
    fn the_engine_s_own_first_page_is_nobody_s_address() {
        assert!(internal(concat!(
            "data:text/html;charset=utf-8,%3C!doctype%20html%3E",
            "%3Chtml%20data-tauri-cef-internal%3D%22initial-load%22%3E"
        )));
        assert!(!internal("about:blank"));
        assert!(!internal("https://example.com/?q=data-tauri-cef-internal"));
        assert!(!internal("data:text/html,<p>a page somebody made</p>"));
    }

    /// The one thing every release rests on: the engine is the system's unless
    /// somebody asked for the other one, so the app that ships is the app that
    /// shipped.
    ///
    /// This crate has no default features at all, which is what makes that true: a
    /// plain `cargo build`, the Tauri CLI's own build and every runner in
    /// .github/workflows/check.yml all get the same thing. The other half of the
    /// proof - that nothing which ships ever passes the flag - is a test over the
    /// manifests and the release workflows, in apps/desktop/test/cef.test.ts,
    /// because that is where the packaging lives.
    #[test]
    fn the_engine_feature_is_never_on_by_default() {
        let manifest = std::fs::read_to_string(crate::app_dir().join("Cargo.toml"))
            .expect("the crate's own manifest");

        assert!(
            manifest.contains("\ncef = []"),
            "the feature is not declared"
        );
        assert!(
            !manifest.contains("\ndefault = ["),
            "this crate has a default feature list, so something is on that nobody asked for"
        );
    }

    /// The pointer is never hidden by one browser process where another one has it, and
    /// wry's own three switches survive being replaced: all in the one
    /// `--disable-features`, because Chromium reads only the last of a repeated switch.
    #[cfg(all(windows, not(feature = "cef")))]
    #[test]
    fn the_engine_never_hides_the_pointer_and_keeps_wry_s_switches() {
        let features: Vec<&str> = super::BROWSER_ARGS
            .split_whitespace()
            .filter_map(|one| one.strip_prefix("--disable-features="))
            .collect();

        assert_eq!(
            features.len(),
            1,
            "one --disable-features, or all but the last are lost"
        );
        let off: Vec<&str> = features[0].split(',').collect();
        for feature in [
            "HideCursorWhileTyping",
            "msWebOOUI",
            "msPdfOOUI",
            "msSmartScreenProtection",
        ] {
            assert!(off.contains(&feature), "{feature} is not switched off");
        }
    }

    /// A profile is a direct child of the user data directory, which is the only
    /// shape CEF accepts: it refuses anything deeper, and anything outside it is
    /// turned into a hashed folder name nobody chose.
    #[test]
    fn a_profile_is_a_direct_child_of_the_user_data_directory() {
        assert!(!APP_PROFILE.contains('/'), "a profile is one folder name");
        assert!(!APP_PROFILE.contains('\\'));
        assert!(!ROOT.is_empty());
        assert_ne!(APP_PROFILE, ROOT, "the interface is not the whole of it");
    }

    /// A store of its own is a profile beside nib's interface and never the interface:
    /// a store is named `space_` or `site_` something, and the interface is `app`.
    #[cfg(feature = "cef")]
    #[test]
    fn a_store_s_profile_is_never_the_interface_s() {
        let named = format!("{}{}", super::STORE_PROFILE, "space_1");
        assert_ne!(named, APP_PROFILE);
        assert!(!named.contains('/') && !named.contains('\\'));
    }
}
