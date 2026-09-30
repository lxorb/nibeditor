//! What the engine says about a page beside where it is: whether it is playing sound
//! and whether that sound is muted, whether something in it has asked for the whole
//! screen, and how large it is drawn.
//!
//! Three things a browser shows or does without being asked, and each was missing:
//!
//! - **Sound.** Chrome puts a speaker on the tab a sound is coming from, and its tab
//!   menu mutes the site. `WebView2` says both (`IsDocumentPlayingAudio`, `IsMuted`)
//!   and takes the second; see `web_mute`.
//! - **The whole screen.** A video's own full screen button asks the engine for the
//!   whole screen, and the engine can only give it the whole of the webview, which was
//!   the pane. `WebView2` says when a page holds a full screen element, and the window
//!   answers by going full screen with the page over all of it. Escape and F11 give the
//!   screen back, as in Chrome; they are the engine's to hear, so they are heard here.
//! - **Zoom.** Ctrl and the wheel, Ctrl and a sign, or a pinch zoom the page inside the
//!   engine (switched on for a web tab's page in `web_tabs.rs`), and the menu's
//!   percentage never knew. The engine says when it changes, so the window can show it
//!   and keep it for the site. And the engine keeps such a zoom for the one page it was
//!   made on: at the next page, the same site's or not, it goes back to the last zoom the
//!   app set and says so - which the window took for the site going back to that size,
//!   and forgot what the reader chose. So a zoom made in the page is set again as the
//!   app's own the moment it is heard, which is what the engine keeps across pages until
//!   the window sets the next site's. Its Ctrl+0 goes back to that same zoom the app set,
//!   which is no zoom at all; so Ctrl+0 is the page's first and then nib's, the way the
//!   find keys are (see `web_opens.rs`), and `actual_size` answers it.
//!
//! All of it is said to the window as one event, `nib://web-page`, carrying the tab.
//! `WebView2`'s alone: elsewhere nothing is said, a video fills its pane as it did, and
//! a mute is the page's own media elements told to be quiet.

use serde::Serialize;
use tauri::AppHandle;

/// The event the window hears on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const SAID: &str = "nib://web-page";

/// What the engine said about one page.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    /// Whether the page is playing sound, and whether it is muted.
    Sound { playing: bool, muted: bool },
    /// Whether something in the page holds the whole screen.
    Fill { on: bool },
    /// How large the page is drawn: 1 is a hundred per cent.
    Zoom { factor: f64 },
}

/// One of those, with the tab it is about.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Serialize)]
struct Heard {
    tab: String,
    #[serde(flatten)]
    said: Said,
}

/// Whether a key gives the screen back from a page holding it: Escape or F11, pressed
/// rather than let go of, and nothing held with it.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn leaves(vk: u32, down: bool) -> bool {
    down && matches!(vk, 0x1B | 0x7A)
}

/// What a page is told when its sound is turned off or on, on an engine that cannot
/// mute a page itself: every media element in it, as it is now.
#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
const QUIET: &str =
    "document.querySelectorAll('audio, video').forEach(function (one) { one.muted = __MUTED__ })";

/// Draws a tab's page at a hundred per cent, for Ctrl+0 pressed inside it that nothing
/// in the page took, and tells the window, which forgets the site's size: a zoom the app
/// sets is one the engine says nothing about. See the top of this file.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn actual_size(app: &AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    if view.set_zoom(1.0).is_ok() {
        let heard = Heard {
            tab: tab.to_string(),
            said: Said::Zoom { factor: 1.0 },
        };
        let _ = app.emit_to(window, SAID, heard);
    }
}

/// Mutes a tab's page, or lets it be heard again.
#[tauri::command]
pub fn web_mute(app: AppHandle, tab: String, muted: bool) -> Result<(), String> {
    mute(&crate::web_tabs::found(&app, &tab)?, muted)
}

/// Gives the screen back from a page holding it, for a tab going out of sight while it
/// does. The page's own call, so the page hears about it the way it would from Escape.
#[tauri::command]
pub fn web_unfill(app: AppHandle, tab: String) -> Result<(), String> {
    crate::web_tabs::found(&app, &tab)?
        .eval("if (document.fullscreenElement) document.exitFullscreen()")
        .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(all(windows, not(feature = "cef")))]
pub use heard::{listen, mute};

#[cfg(all(windows, not(feature = "cef")))]
mod heard {
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2_8, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, ContainsFullScreenElementChangedEventHandler,
        ExecuteScriptCompletedHandler, IsDocumentPlayingAudioChangedEventHandler,
        IsMutedChangedEventHandler, ZoomFactorChangedEventHandler,
    };
    use windows_core::{Interface, BOOL};

    use super::{leaves, Heard, Said, SAID};

    /// Starts listening on one page. Called on the window's thread, once, as the page is
    /// built; `window` is the label of the window it is in.
    #[allow(
        unsafe_code,
        reason = "what a page is doing is told through WebView2's own events, reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        let tell = move |said: Said| {
            let heard = Heard {
                tab: tab.clone(),
                said,
            };
            let _ = app.emit_to(window.as_str(), SAID, heard);
        };

        // Safe: the controller is this window's, every object below is used only on
        // this thread, and WebView2 holds each handler for as long as it can fire.
        unsafe {
            let controller = webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                return;
            };

            // The sound, whichever of the two changed: the tab draws both at once.
            if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
                let told = tell.clone();
                let heard = move |sender: Option<ICoreWebView2>| {
                    if let Some(said) = sender.and_then(|one| sound(&one)) {
                        told(said);
                    }
                    Ok(())
                };
                let playing = IsDocumentPlayingAudioChangedEventHandler::create(Box::new({
                    let heard = heard.clone();
                    move |sender, _| heard(sender)
                }));
                let muted =
                    IsMutedChangedEventHandler::create(Box::new(move |sender, _| heard(sender)));
                let mut token = 0i64;
                let _ = eight.add_IsDocumentPlayingAudioChanged(&playing, &raw mut token);
                let _ = eight.add_IsMutedChanged(&muted, &raw mut token);
            }

            let told = tell.clone();
            let filled =
                ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        told(Said::Fill { on: filling(&core) });
                    }
                    Ok(())
                }));
            let mut token = 0i64;
            let _ = core.add_ContainsFullScreenElementChanged(&filled, &raw mut token);

            // Escape and F11 while the page holds the screen. The page is asked to let
            // go, which is what makes the event above say so; nothing else about either
            // key changes.
            let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |sender, args| {
                let (Some(sender), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                let mut vk = 0u32;
                args.KeyEventKind(&raw mut kind)?;
                args.VirtualKey(&raw mut vk)?;
                let down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;

                if !leaves(vk, down) {
                    return Ok(());
                }
                // The page's engine from the controller the key arrived at, rather than
                // one held here: a handler holding its own webview would keep it alive.
                let core = sender.CoreWebView2()?;
                if filling(&core) {
                    args.SetHandled(true)?;
                    let done = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
                    core.ExecuteScript(windows_core::w!("document.exitFullscreen()"), &done)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = controller.add_AcceleratorKeyPressed(&keys, &raw mut token);

            // Only a zoom made in the page is heard: one the app sets says nothing, so
            // setting this one again cannot come back round. See the top of this file.
            let zoomed = ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                let mut factor = 1.0f64;
                if let Some(controller) = sender {
                    if controller.ZoomFactor(&raw mut factor).is_ok() {
                        let _ = controller.SetZoomFactor(factor);
                        tell(Said::Zoom { factor });
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = controller.add_ZoomFactorChanged(&zoomed, &raw mut token);
        }
    }

    /// What the page's sound is now, or nothing from an engine too old to say.
    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn sound(core: &ICoreWebView2) -> Option<Said> {
        // Safe: the engine is this page's, on this thread.
        unsafe {
            let eight = core.cast::<ICoreWebView2_8>().ok()?;
            let mut playing = BOOL::default();
            let mut muted = BOOL::default();
            eight.IsDocumentPlayingAudio(&raw mut playing).ok()?;
            eight.IsMuted(&raw mut muted).ok()?;
            Some(Said::Sound {
                playing: playing.as_bool(),
                muted: muted.as_bool(),
            })
        }
    }

    /// Whether something in the page holds the whole screen.
    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn filling(core: &ICoreWebView2) -> bool {
        let mut on = BOOL::default();
        // Safe: the engine is this page's, on this thread.
        unsafe { core.ContainsFullScreenElement(&raw mut on).is_ok() && on.as_bool() }
    }

    /// The engine's own mute, on the window's thread, where its objects live. An engine
    /// too old to mute is told the way every other engine is.
    #[allow(
        unsafe_code,
        reason = "the engine is reached through its COM interfaces"
    )]
    pub fn mute(view: &Webview, muted: bool) -> Result<(), String> {
        let fallback = view.clone();
        view.with_webview(move |platform| {
            // Safe: the controller is this webview's own, asked on its own thread.
            let done = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_8>())
                    .and_then(|eight| eight.SetIsMuted(muted))
            };
            if done.is_err() {
                let _ = super::quieted(&fallback, muted);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }
}

/// Tells a page's media elements to be quiet, or not.
#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
fn quieted(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    view.eval(QUIET.replace("__MUTED__", if muted { "true" } else { "false" }))
        .map_err(|error| format!("that page could not be reached: {error}"))
}

/// Every other engine says nothing about a page; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

/// Every other engine mutes what the page is playing now.
#[cfg(all(not(windows), not(feature = "cef")))]
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    quieted(view, muted)
}

/// nib's own Chromium mutes the page the way Chrome's tab strip does: the browser's own
/// sound off, whatever the page plays next, and nothing said to the page.
#[cfg(feature = "cef")]
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri_runtime_cef::WebviewCefExt as _;
    view.with_cef_webview(move |page| {
        if let Some(host) = page.browser().host() {
            host.set_audio_muted(i32::from(muted));
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{leaves, Heard, Said, QUIET};

    #[test]
    fn escape_and_f11_give_the_screen_back() {
        assert!(leaves(0x1B, true));
        assert!(leaves(0x7A, true));
        // Let go of, or any other key, is the page's.
        assert!(!leaves(0x1B, false));
        assert!(!leaves(0x0D, true));
    }

    #[test]
    fn the_window_hears_which_tab_and_what() {
        let heard = Heard {
            tab: "a".into(),
            said: Said::Sound {
                playing: true,
                muted: false,
            },
        };
        let json = serde_json::to_value(&heard).expect("json");
        assert_eq!(
            json,
            serde_json::json!({ "tab": "a", "said": "sound", "playing": true, "muted": false })
        );

        let fill = serde_json::to_value(Heard {
            tab: "b".into(),
            said: Said::Fill { on: true },
        })
        .expect("json");
        assert_eq!(fill["said"], "fill");

        let zoom = serde_json::to_value(Heard {
            tab: "c".into(),
            said: Said::Zoom { factor: 1.25 },
        })
        .expect("json");
        assert_eq!(zoom["factor"], 1.25);
    }

    #[test]
    fn a_page_is_quieted_through_its_own_media() {
        assert!(QUIET.contains("audio, video"));
        assert!(QUIET.contains("__MUTED__"));
    }
}
