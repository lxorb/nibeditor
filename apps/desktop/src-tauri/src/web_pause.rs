//! A tab's page paused, and let run again: what Hidden tabs' Pause does to the pages of
//! a space's set of tabs out of sight (lib/workspace/hidden-tabs.svelte.ts).
//!
//! Two halves, in this order. What the page is playing is paused first, from inside the
//! page - every audio and video element that is playing, each marked, so that letting
//! the page run again plays those and only those - and then the page itself is frozen,
//! its timers and its scripts held, by whatever the engine has for it:
//!
//! - `WebView2`: `TrySuspend`, the engine's own sleeping tab, which wants the page out of
//!   sight; it is hidden first. It leaves alone a page playing sound - which is why the
//!   sound is paused first - and one in a call, capturing the camera, the microphone or
//!   the screen, or holding a Web Lock, as Edge's sleeping tabs do: those run on. Shown
//!   again, the engine wakes it itself; `Resume` says so at once.
//! - nib's own Chromium: the page lifecycle's `frozen`, over the `DevTools` protocol, and
//!   `active` to let it run.
//! - `WKWebView` and `WebKitGTK` have neither: the sound is paused, and the engine's own
//!   throttling of a page out of sight is the rest.
//!
//! Letting it run is the other way round: the page woken, then what it was playing played.
//!
//! The window freezes a page that has been out of sight for a while as well, through this
//! same command (lib/web-tab/resting.ts), and wakes it before it is shown - or before an
//! agent acts in it, when the crate asks the window to lend it the tab (agents/reader.rs).

use tauri::AppHandle;

/// Pauses whatever the page is playing, marking each element it paused.
const PAUSE: &str = "document.querySelectorAll('audio, video').forEach(function (one) { if (!one.paused) { one.pause(); one.setAttribute('data-nib-paused', '') } })";

/// Plays again what `PAUSE` paused, and nothing else.
const PLAY: &str = "document.querySelectorAll('[data-nib-paused]').forEach(function (one) { one.removeAttribute('data-nib-paused'); one.play().catch(function () {}) })";

/// What the engine said: whether the page is frozen, or running again, now.
type Said = tauri::async_runtime::Sender<bool>;

/// Pauses a tab's page, or lets it run again, and answers whether the engine did.
///
/// The engine may refuse a freeze: `WebView2` leaves a page running that plays, is in a
/// call or holds a lock, and says so only in its answer. The window then counts the page as
/// running and asks again later (lib/web-tab/pages.svelte.ts). Async, so the answer is
/// waited for off the window's thread.
#[tauri::command]
pub async fn web_pause(app: AppHandle, tab: String, paused: bool) -> Result<bool, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    if paused {
        view.hide()
            .map_err(|error| format!("that page could not be hidden: {error}"))?;
    }
    let (said, mut heard) = tauri::async_runtime::channel::<bool>(1);
    engine::lull(&view, paused, said)?;
    // An engine that never answered froze nothing.
    Ok(heard.recv().await.unwrap_or(false))
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use tauri::Webview;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use webview2_com::{ExecuteScriptCompletedHandler, TrySuspendCompletedHandler};
    use windows_core::{Interface as _, HSTRING};

    use super::{Said, PAUSE, PLAY};

    /// The sound paused and then the page suspended, or the page resumed and then its
    /// sound played, each step once the one before has answered.
    #[allow(
        unsafe_code,
        reason = "the engine's own suspend is reached through its COM interfaces"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        view.with_webview(move |platform| {
            // Safe: the controller is this webview's own, asked on its own thread.
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            let Ok(three) = core.cast::<ICoreWebView2_3>() else {
                return;
            };

            if paused {
                let then = ExecuteScriptCompletedHandler::create(Box::new(move |_, _| {
                    let done = TrySuspendCompletedHandler::create(Box::new(move |done, frozen| {
                        let _ = said.try_send(done.is_ok() && frozen);
                        Ok(())
                    }));
                    // Safe: answered on the window's thread, on this page's own engine.
                    unsafe { three.TrySuspend(&done) }
                }));
                // Safe: as above.
                let _ = unsafe { core.ExecuteScript(&HSTRING::from(PAUSE), &then) };
                return;
            }

            // Safe: as above.
            let woke = unsafe { three.Resume() };
            let _ = said.try_send(woke.is_ok());
            let done = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
            // Safe: as above.
            let _ = unsafe { core.ExecuteScript(&HSTRING::from(PLAY), &done) };
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }
}

#[cfg(feature = "cef")]
mod engine {
    use serde_json::json;
    use tauri::Webview;

    use super::{Said, PAUSE, PLAY};

    /// Both halves over the page's own `DevTools` agent, which runs them in the order they
    /// are sent; see `tell` in engine/devtools.rs. The protocol freezes whatever it is
    /// told to, so the window never asks it about a page that has to go on.
    #[allow(
        clippy::unnecessary_wraps,
        clippy::needless_pass_by_value,
        reason = "the same answer as the other engines', whose calls can fail"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        let told = if paused {
            vec![
                ("Runtime.evaluate", json!({ "expression": PAUSE })),
                ("Page.setWebLifecycleState", json!({ "state": "frozen" })),
            ]
        } else {
            vec![
                ("Page.setWebLifecycleState", json!({ "state": "active" })),
                ("Runtime.evaluate", json!({ "expression": PLAY })),
            ]
        };
        crate::engine::devtools::tell(view, None, told);
        let _ = said.try_send(true);
        Ok(())
    }
}

#[cfg(all(not(windows), not(feature = "cef")))]
mod engine {
    use tauri::Webview;

    use super::{Said, PAUSE, PLAY};

    /// The sound alone: the engine has no freeze to ask for, so a page is never frozen.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "the same answer as the other engines'"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        view.eval(if paused { PAUSE } else { PLAY })
            .map_err(|error| format!("that page could not be reached: {error}"))?;
        let _ = said.try_send(!paused);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{PAUSE, PLAY};

    #[test]
    fn what_is_paused_is_marked_and_only_that_plays_again() {
        assert!(PAUSE.contains("if (!one.paused)"));
        assert!(PAUSE.contains("data-nib-paused"));
        assert!(PLAY.starts_with("document.querySelectorAll('[data-nib-paused]')"));
    }
}
