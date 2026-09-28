//! The reload glyph's other two faces: stopping a page on its way in, and loading it
//! again past everything the engine kept of it.
//!
//! Chrome's cross while a page is coming, and its Ctrl+Shift+R. Wry hands out neither.
//! `WebView2` has both - `Stop`, and the `DevTools` Protocol's `Page.reload` with
//! `ignoreCache` - reached through its controller the way `CapturePreview` is. Every
//! other engine gets the nearest thing a page can do for itself: `window.stop()`, and
//! an ordinary reload. See docs/web-tabs.md.

use tauri::Webview;

/// Stops the page where it is, the way the cross over the reload glyph does.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "Stop is WebView2's own, reached through its COM interfaces"
)]
pub fn stop(view: &Webview) -> Result<(), String> {
    // Safe: the engine is the one this tab's webview owns, and it is used on the
    // window's own thread, which is where `with_webview` runs.
    engine(view, |core| unsafe { core.Stop() })
}

/// The page again, with nothing of it taken from the cache.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is reached through WebView2's COM interfaces"
)]
pub fn fresh(view: &Webview) -> Result<(), String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::w;

    engine(view, |core| {
        // Nothing to hear back: the page arriving again is what says it worked.
        let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
        // Safe: as in `stop`, and the handler outlives the call because WebView2
        // holds it.
        unsafe {
            core.CallDevToolsProtocolMethod(w!("Page.reload"), w!(r#"{"ignoreCache":true}"#), &done)
        }
    })
}

/// Runs one call on the engine behind a tab's webview, on the window's own thread.
/// A call the engine refuses has nothing to say to anybody: the glyph stays as it
/// was, which is what it would have shown anyway.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the engine is reached through WebView2's controller, a COM interface"
)]
fn engine(
    view: &Webview,
    call: impl FnOnce(
            &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
        ) -> windows_core::Result<()>
        + Send
        + 'static,
) -> Result<(), String> {
    view.with_webview(move |platform| {
        // Safe: the controller is this webview's own, asked on its own thread.
        if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
            let _ = call(&core);
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}

/// Every other engine: what the page itself can do, which stops everything but a
/// navigation the engine was sent on.
#[cfg(any(not(windows), feature = "cef"))]
pub fn stop(view: &Webview) -> Result<(), String> {
    view.eval("window.stop()")
        .map_err(|error| format!("that page could not be stopped: {error}"))
}

/// Every other engine: an ordinary reload, which is what the engine offers.
#[cfg(any(not(windows), feature = "cef"))]
pub fn fresh(view: &Webview) -> Result<(), String> {
    view.reload()
        .map_err(|error| format!("that page could not be reloaded: {error}"))
}
