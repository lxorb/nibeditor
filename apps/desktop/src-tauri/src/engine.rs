//! Which engine every webview runs on, and where each keeps what it stores.
//!
//! Every webview is on the system's engine - `WebView2` on Windows, `WKWebView` on a Mac,
//! `WebKitGTK` on Linux - which is what Tauri gives without being asked. Up to 0.15 a
//! second build ran the app on nib's own Chromium; it is gone (#305, #313), and what it
//! left on a machine is cleared by `retired_engine.rs`.
//!
//! The web keeps the folder it has always used - `<config>/web`, as one `WebView2` user
//! data folder or one `WKWebView` data store. A store of its own is a folder under
//! `<config>/web-stores`; see `web_stores.rs`.

use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

/// The folder inside the app's own settings folder that the web lives in: the
/// `WebView2` user data folder the system's engine has always used.
const ROOT: &str = "web";

/// The same sixteen bytes every time, so `WKWebView` hands back the store it handed
/// out last time. macOS 14 and later; older macOS has no such API and falls back to
/// the default store, which is the one case where a web tab and the app share a
/// profile on disk. Said out loud in docs/web-tabs.md rather than hidden here.
#[cfg(target_os = "macos")]
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
///
/// And **the engine's own swipe between pages is off**, both halves of it. Emil,
/// 2026-10-08 (#209): *"edge supports it for some sites while nib supports it as well
/// ... sometimes both triggers"*. nib draws the swipe itself (`web_swipe.rs`) and walks the
/// tab's own trail; the engine's walks its own history, which a tab revived after a
/// relaunch does not have, so it went on some pages and not others, and on those it went
/// as well as nib's. `IsSwipeNavigationEnabled`, which wry leaves off, is documented for a
/// finger on a screen, and did not reach two on a touchpad: that is Chromium's
/// `TouchpadOverscrollHistoryNavigation`, and `--overscroll-history-navigation=0` turns
/// the whole of it off, touchpad and screen alike, whichever of the two a runtime reads.
/// See [`ENGINE_SWIPE`].
#[cfg(windows)]
pub(crate) const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping,",
    "TouchpadOverscrollHistoryNavigation",
    " --overscroll-history-navigation=0",
);

/// Chromium's own swipe between pages, which `WebView2` would run beside nib's: the
/// feature that is its touchpad half, and the switch, with its value, that is the whole
/// of it. Written into [`BROWSER_ARGS`]; a test holds the one to these names.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const ENGINE_SWIPE: (&str, &str, &str) = (
    "TouchpadOverscrollHistoryNavigation",
    "overscroll-history-navigation",
    "0",
);

/// The folder the web's own storage lives in, made if it is not there yet.
#[cfg(desktop)]
#[cfg_attr(
    target_os = "macos",
    allow(
        dead_code,
        reason = "a Mac's own engine is handed a store identifier rather than a folder; the folder is what the other two desktops use"
    )
)]
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}

/// Where a web tab's site data goes.
///
/// **This is the seam.** One call for every platform, so `web_tabs.rs` says where a
/// page's storage goes once rather than once per platform.
///
/// `store` is the store the tab was asked to be in, already checked by
/// `web_stores::named`: `None` for the one every space shares, a name for a space or a
/// site that keeps its own. See `web_stores.rs`.
///
/// For the shared store, the folder the app has always used, as a user data folder on
/// Windows and Linux and as a data store identifier on a Mac, unchanged to the byte from
/// what shipped. For a store of its own, a folder of its own under `web-stores`, or
/// sixteen bytes of its own on a Mac.
#[cfg(desktop)]
#[cfg_attr(
    target_os = "macos",
    allow(
        clippy::unnecessary_wraps,
        reason = "the seam is one signature for every platform; only the Windows and Linux path reaches the disk and can fail, and the caller returns Result either way"
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

/// The window the config describes, taken out of it so it is built by our own code
/// instead. The config keeps saying what the window looks like; only who builds it
/// changes.
///
/// The system's webview needs the window on screen before the webview inside it
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

/// The builder of nib's own window: everything the window needs from the engine, and
/// nothing about where it goes or when it shows, which is `ready`'s in lib.rs.
/// Developer tools in a development build only, as nib's own window always had, and the
/// switches every page of this app starts with; see [`BROWSER_ARGS`].
pub(crate) fn ui_window<'a, M: tauri::Manager<crate::Engine>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, crate::Engine, M>, Box<dyn std::error::Error>> {
    let building =
        tauri::WebviewWindowBuilder::from_config(manager, config)?.devtools(cfg!(debug_assertions));
    #[cfg(windows)]
    let building = building.additional_browser_args(BROWSER_ARGS);
    Ok(building)
}

#[cfg(test)]
mod tests {

    /// The engine's own swipe is named the way Chromium reads it, the switch without its
    /// dashes.
    #[test]
    fn the_engine_s_swipe_is_named_the_way_chromium_reads_it() {
        let (feature, switch, value) = super::ENGINE_SWIPE;
        assert_eq!(feature, "TouchpadOverscrollHistoryNavigation");
        assert_eq!(switch, "overscroll-history-navigation");
        assert_eq!(value, "0", "the history navigation that is none");
    }

    /// The pointer is never hidden by one browser process where another one has it,
    /// wry's own three switches survive being replaced - all in the one
    /// `--disable-features`, because Chromium reads only the last of a repeated switch -
    /// and the engine's own swipe is off.
    #[cfg(windows)]
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
        let (swipe, switch, value) = super::ENGINE_SWIPE;
        assert!(
            off.contains(&swipe),
            "the engine's touchpad swipe is not off"
        );
        let wanted = format!("--{switch}={value}");
        assert!(
            super::BROWSER_ARGS
                .split_whitespace()
                .any(|one| one == wanted),
            "the engine's swipe is not switched off"
        );
    }
}
