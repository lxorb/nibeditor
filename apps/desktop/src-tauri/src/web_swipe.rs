//! A swipe over a page in a web tab: two fingers sideways on a touchpad, or a finger from
//! the side of the screen, said to the window.
//!
//! Emil, 2026-10-03: *"Swiping (left/right) to go to the previous / redo page."* Chrome and
//! Edge take a sideways scroll the page left over as Back or Forward, with an arrow that
//! follows the fingers. `WebView2` has that arrow too, behind `IsSwipeNavigationEnabled`,
//! and nib leaves it off (wry's default): it walks the engine's own history, and a tab nib
//! revived after a relaunch has none - its trail is this crate's (`Trail` in
//! `web_tabs.rs`) - so the engine's swipe would do nothing on most tabs after a restart,
//! and go the wrong way after any step the crate made itself. nib's own Chromium has no swipe
//! of its own at all.
//!
//! So the page says what it saw and the window decides, the same way for a page as for a
//! note: a script in nib's world in every page and frame (`SCRIPT`, `web_swipe.js`) hears
//! each sideways scroll and each finger from the side, asks whether anything in the page
//! would have taken it, and says it through a function only nib's world has (`BINDING`,
//! the engine's `DevTools` protocol's `Runtime.addBinding` by the world's name). Every
//! listener there is passive and only reads, so the page scrolls exactly as it did. What
//! comes back is read here into numbers and nothing else (`Said`) and said to the window
//! as `nib://web-swipe` for the tab it came from, where apps/desktop/src/lib/back-swipe
//! draws the arrow and steps the tab's trail through the same Back and Forward its arrows
//! press.
//!
//! The keyboard is not handed back to the window for any of it: a swipe is not a reason
//! to take the typing out of a page.
//!
//! Windows' two engines; a Mac's and Linux's pages have no channel back to the app.

// Elsewhere only the tests and the frame list in web_worlds.rs read any of it.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// nib's script for every page and frame, as the file holds it; see `web_swipe.js`.
const SCRIPT: &str = include_str!("web_swipe.js");

/// The script as a page is handed it: a function called on the spot and nothing round
/// it, the shape every one of nib's page scripts has (see `opening` in `web_tabs.rs`).
pub fn script() -> &'static str {
    SCRIPT.trim()
}

/// The function nib's world in a page says a swipe through.
pub const BINDING: &str = "nibSwiped";

/// The event the window hears a swipe on.
const SWIPED: &str = "nib://web-swipe";

/// What the protocol is asked to give nib's world, and no other world, the function by.
pub fn binding() -> Value {
    json!({ "name": BINDING, "executionContextName": crate::web_worlds::WORLD })
}

/// The longest step a page may report, in its own pixels: past anything a hand makes,
/// short of anything that would be a number gone wrong.
const LONGEST: f64 = 10_000.0;

/// What one call through `BINDING` said: a frame's worth of sideways scroll, a finger
/// moving from the side of the screen, or that finger lifted. `l` and `r` are whether the
/// page would have taken the scroll that way itself.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "k")]
enum Said {
    #[serde(rename = "w")]
    Wheel {
        dx: f64,
        dy: f64,
        t: f64,
        l: bool,
        r: bool,
    },
    #[serde(rename = "t")]
    Touch {
        dx: f64,
        dy: f64,
        t: f64,
        l: bool,
        r: bool,
    },
    #[serde(rename = "e")]
    End { t: f64 },
}

/// What the window is told, for the tab the page is in.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Swiped {
    tab: String,
    /// `wheel`, `touch` or `lift`.
    kind: &'static str,
    dx: f64,
    dy: f64,
    at: f64,
    left: bool,
    right: bool,
}

/// What a call through `BINDING` said, for `tab`, or `None` for anything that is not a
/// swipe as the script says one. Pure, and the only reading of what a page says here.
pub fn read(tab: &str, payload: &str) -> Option<Swiped> {
    let said: Said = serde_json::from_str(payload).ok()?;
    let fine = |one: f64| one.is_finite() && one.abs() <= LONGEST;
    let step = |kind, dx: f64, dy: f64, at: f64, left, right| {
        (fine(dx) && fine(dy) && at.is_finite()).then(|| Swiped {
            tab: tab.to_string(),
            kind,
            dx,
            dy,
            at,
            left,
            right,
        })
    };
    match said {
        Said::Wheel { dx, dy, t, l, r } => step("wheel", dx, dy, t, l, r),
        Said::Touch { dx, dy, t, l, r } => step("touch", dx, dy, t, l, r),
        Said::End { t } => step("lift", 0.0, 0.0, t, false, false),
    }
}

/// Says what a page said through `BINDING` to its window, for `tab`, which the caller
/// knows from where it was listening; nothing the page says names it.
pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    use tauri::Emitter;

    if let Some(swiped) = read(tab, payload) {
        let _ = app.emit_to(window, SWIPED, swiped);
    }
}

/// The binding's calls, out of the protocol's event that says one was made: its payload,
/// when it is this binding's.
pub fn called(event: &str) -> Option<String> {
    let said: Value = serde_json::from_str(event).ok()?;
    if said.get("name")?.as_str()? != BINDING {
        return None;
    }
    said.get("payload")?.as_str().map(str::to_string)
}

#[cfg(all(windows, not(feature = "cef")))]
pub use engine::listen;

/// `WebView2`: the binding's calls heard for as long as the page is open, from the page
/// and from every frame the page's registration follows (`web_worlds.rs`), whose events
/// the engine hands the same receiver.
#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use tauri::webview::PlatformWebview;
    use webview2_com::DevToolsProtocolEventReceivedEventHandler;
    use windows_core::{HSTRING, PWSTR};

    use super::{called, heard};

    #[allow(
        unsafe_code,
        reason = "the DevTools protocol's events are WebView2's own, reached through its COM interfaces"
    )]
    pub fn listen(webview: &PlatformWebview, app: tauri::AppHandle, tab: String, window: String) {
        // Safe: the controller is this window's, and everything below is used on this
        // thread; the engine holds the handler for as long as the webview lives.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(receiver) =
                core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Runtime.bindingCalled"))
            else {
                return;
            };
            let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
                move |_sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut event = PWSTR::null();
                    args.ParameterObjectAsJson(&raw mut event)?;
                    let event = webview2_com::take_pwstr(event);
                    if let Some(payload) = called(&event) {
                        heard(&app, &window, &tab, &payload);
                    }
                    Ok(())
                },
            ));
            let mut token = 0i64;
            let _ = receiver.add_DevToolsProtocolEventReceived(&handler, &raw mut token);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{binding, called, read, Swiped, BINDING, SCRIPT};

    fn swiped(kind: &'static str, dx: f64, dy: f64, at: f64, left: bool, right: bool) -> Swiped {
        Swiped {
            tab: "t1".into(),
            kind,
            dx,
            dy,
            at,
            left,
            right,
        }
    }

    #[test]
    fn a_frame_of_scroll_is_read_as_numbers_for_the_tab_it_came_from() {
        assert_eq!(
            read(
                "t1",
                r#"{"k":"w","dx":-12.5,"dy":0.5,"t":1234.5,"l":false,"r":true}"#
            ),
            Some(swiped("wheel", -12.5, 0.5, 1234.5, false, true))
        );
        assert_eq!(
            read("t1", r#"{"k":"t","dx":3,"dy":-1,"t":8,"l":true,"r":false}"#),
            Some(swiped("touch", 3.0, -1.0, 8.0, true, false))
        );
        assert_eq!(
            read("t1", r#"{"k":"e","t":99}"#),
            Some(swiped("lift", 0.0, 0.0, 99.0, false, false))
        );
    }

    #[test]
    fn anything_else_a_page_could_say_is_nothing() {
        for said in [
            "",
            "null",
            "[]",
            r#"{"k":"x","t":1}"#,
            r#"{"k":"w","dx":"1","dy":0,"t":1,"l":false,"r":false}"#,
            r#"{"k":"w","dx":1,"dy":0,"t":1}"#,
            r#"{"k":"w","dx":1e9,"dy":0,"t":1,"l":false,"r":false}"#,
            r#"{"k":"t","dx":1,"dy":-1e300,"t":1,"l":false,"r":false}"#,
        ] {
            assert_eq!(read("t1", said), None, "{said}");
        }
    }

    #[test]
    fn the_window_is_told_in_its_own_words() {
        let told = serde_json::to_value(swiped("wheel", -4.0, 0.0, 10.0, false, true))
            .expect("a swipe is said as JSON");
        assert_eq!(
            told,
            serde_json::json!({
                "tab": "t1", "kind": "wheel", "dx": -4.0, "dy": 0.0, "at": 10.0,
                "left": false, "right": true,
            })
        );
    }

    #[test]
    fn only_this_binding_s_calls_are_heard() {
        let event = |name: &str| {
            serde_json::json!({ "name": name, "payload": "{\"k\":\"e\",\"t\":1}", "executionContextId": 3 })
                .to_string()
        };
        assert_eq!(
            called(&event(BINDING)).as_deref(),
            Some("{\"k\":\"e\",\"t\":1}")
        );
        assert_eq!(called(&event("nibAsked")), None);
        assert_eq!(called("not json"), None);
    }

    #[test]
    fn the_binding_is_nib_s_world_s_alone() {
        assert_eq!(binding()["name"], BINDING);
        assert_eq!(binding()["executionContextName"], crate::web_worlds::WORLD);
    }

    /// The script says through the binding by its name, and reads nothing it was not
    /// handed: every listener only listens.
    #[test]
    fn the_script_asks_through_the_binding_and_only_listens() {
        assert!(SCRIPT.contains(&format!("typeof {BINDING} === 'function'")));
        assert_eq!(SCRIPT.matches("passive: true").count(), 5);
        assert!(!SCRIPT.contains("preventDefault()"));
        assert!(!SCRIPT.contains("stopPropagation"));
    }
}
