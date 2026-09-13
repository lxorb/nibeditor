//! Which engine every webview in this build runs on, and which profile each of
//! them is in.
//!
//! Two builds come out of this crate and they differ in one thing.
//!
//! The default one is the app that ships, and it is untouched by anything here:
//! the system's engine behind every webview - `WebView2` on Windows, `WKWebView`
//! on a Mac, `WebKitGTK` on Linux - which is what Tauri gives without being
//! asked. The other is behind the `cef` feature: nib's own Chromium, in nib's own
//! process, through `tauri-runtime-cef`, with the app's own interface and every
//! web tab as views in one browser process. See docs/browser.md, which is the
//! design and the measurement, and `apps/desktop/src-tauri/cef`, which is the
//! binary that links the engine and hands it to `run_on`.
//!
//! **Nothing here names Chromium.** The engine arrives as an already-configured
//! `tauri::Builder` from the binary that linked it, and that is the whole point of
//! the seam: `tauri-runtime-cef`, the `cef` crate and the three hundred megabytes
//! they download are not a dependency of this crate at all, in either build, so
//! the default build's dependency graph, lock file and launch are the ones that
//! shipped yesterday.
//!
//! **The two profiles.** Chromium serves many profiles from one browser process,
//! and an extension is installed into a profile - so two profiles is what keeps an
//! extension a reader installed for the web out of nib's own interface. It is not a
//! precaution: with one profile the spike's test extension read the app's own
//! document, in a screenshot, on the first try (docs/browser.md section 9).
//!
//! Which of the two is the engine's *primary* profile is a decision and not a
//! detail. An extension installed from the command line or by Chromium's own policy
//! mechanisms lands in the primary profile, so **the browsing profile is the primary
//! one and nib's interface is the named one beside it** - the opposite way round
//! from the sketch in docs/browser.md, and the only way round that puts a reader's
//! extensions where a reader's pages are.
//!
//! ```text
//! <config>/web/           the user data directory: Chromium's own, one lock on it
//! <config>/web/Default    the browsing profile. Cookies, logins, extensions
//! <config>/web/app        nib's own interface. No extensions, nothing granted
//! ```
//!
//! The default build keeps the directory it has always used - `<config>/web`, the
//! whole of it, as one `WebView2` user data folder or one `WKWebView` data store -
//! so nobody's cookies move because a feature exists.

use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

/// The folder inside the app's own settings folder that the web lives in.
///
/// One name for two things on purpose, because they are the same thing: the
/// `WebView2` user data folder the default build has always used, and Chromium's
/// user data directory under the `cef` feature. A profile is a direct child of it,
/// which is the only shape CEF accepts.
const ROOT: &str = "web";

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
/// - The system's engine: the folder the app has always used, as a user data folder
///   on Windows and Linux and as a data store identifier on a Mac. Unchanged, to
///   the byte, from what shipped.
/// - nib's own Chromium: nothing, deliberately. A web tab is in the engine's
///   primary profile, which is where an extension installed by the command line or
///   by policy lands, and nib's own interface is the named profile beside it; see
///   this file's comment.
#[cfg(all(desktop, not(feature = "cef")))]
#[allow(
    dead_code,
    reason = "web_tabs.rs is being reworked next door and adopts this call there; until then the seam is held by the tests beside it and by the flagged build"
)]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
) -> Result<WebviewBuilder<R>, String> {
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.data_directory(root(app)?);

    #[cfg(target_os = "macos")]
    let builder = {
        let _ = app;
        builder.data_store_identifier(STORE_ID)
    };

    Ok(builder)
}

/// Where a web tab's site data goes on nib's own Chromium: the engine's own primary
/// profile, which is the one line of this seam that is a decision. See above.
#[cfg(feature = "cef")]
#[allow(
    dead_code,
    reason = "web_tabs.rs is being reworked next door and adopts this call there; the gate goes through the command that file already has"
)]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    _app: &AppHandle,
) -> Result<WebviewBuilder<R>, String> {
    Ok(builder)
}

/// The window the config describes, taken out of it so it is built here instead.
///
/// Only nib's own Chromium needs this, and it needs it for one reason: the
/// interface has to be in a profile of its own, a profile is asked for when a
/// webview is built, and a window in `tauri.conf.json` is built by the runtime
/// before any of our own code runs. So the config keeps saying what the window
/// looks like and this takes over saying it.
#[cfg(feature = "cef")]
pub(crate) fn take_ui_window(
    context: &mut tauri::Context,
) -> Option<tauri::utils::config::WindowConfig> {
    let windows = &mut context.config_mut().app.windows;
    if windows.is_empty() {
        return None;
    }
    Some(windows.remove(0))
}

/// Builds the window `take_ui_window` took, in nib's own profile.
#[cfg(feature = "cef")]
pub(crate) fn open_ui_window(
    app: &tauri::App,
    config: &tauri::utils::config::WindowConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let profile = app_profile(app.handle())?;
    let label = config.label.clone();
    tauri::WebviewWindowBuilder::from_config(app, config)?
        .data_directory(profile)
        // What the interface calls itself, which is how the gate can tell whether
        // an extension in the browsing profile reached across into it. Nothing but
        // the gate reads it, and the gate only exists in this build.
        .on_document_title_changed(move |_window, title| gate::title_seen(&label, &title))
        .build()?;
    Ok(())
}

#[cfg(feature = "cef")]
pub(crate) mod gate;

#[cfg(test)]
mod tests {
    use super::{APP_PROFILE, ROOT};

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
        let manifest = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
        )
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
}
