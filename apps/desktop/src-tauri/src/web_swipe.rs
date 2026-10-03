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
//! would have taken it, and says it a frame at a time. Every listener there is passive and
//! only reads, so the page scrolls exactly as it did.
//!
//! **How it is said** is each engine's one road back from nib's world. On nib's own
//! Chromium a function only that world has (`BINDING`, the `DevTools` protocol's
//! `Runtime.addBinding` by the world's name), as `web_opens.rs` asks there. On `WebView2`
//! a window asked for under a name that carries it (`NAMED`), which `web_opens.rs` hears
//! with the rest of the names and the engine never opens - the way that file asks for the
//! find and the address field. A binding is not that road on `WebView2`: the engine puts
//! one in a world only while the protocol's runtime domain is on, and turning it on for
//! every page is the one thing a site that looks for automation looks for. A page can
//! ask under the name too, from its own world; all it gets is its own tab stepped back
//! or forward, which `history.back()` already gets it. What
//! comes back is read here into numbers and nothing else (`Said`) and said to the window
//! as `nib://web-swipe` for the tab it came from, where apps/desktop/src/lib/back-swipe
//! draws the arrow and steps the tab's trail through the same Back and Forward its arrows
//! press.
//!
//! The keyboard is not handed back to the window for any of it: a swipe is not a reason
//! to take the typing out of a page.
//!
//! Windows' two engines; a Mac's and Linux's pages have no channel back to the app.

// Elsewhere nothing but the tests reads any of it.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// nib's script for every page and frame, as the file holds it; see `web_swipe.js`.
const SCRIPT: &str = include_str!("web_swipe.js");

/// The script as a page is handed it: a function called on the spot and nothing round
/// it, the shape every one of nib's page scripts has (see `opening` in `web_tabs.rs`).
/// Prettier writes the file with a semicolon in front, as it writes every statement that
/// begins with a bracket; `opening` puts its own between the scripts.
pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}

/// The function nib's world in a page says a swipe through on nib's own Chromium.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const BINDING: &str = "nibSwiped";

/// What the window name a swipe is said under on `WebView2` begins with; the rest is
/// what the binding would have been handed.
const NAMED: &str = "nib-swipe:";

/// What a window asked for under `name` says of a swipe, or `None` for any other name.
/// Pure, and the only reading of that name.
pub fn named(name: &str) -> Option<&str> {
    name.strip_prefix(NAMED)
}

/// The event the window hears a swipe on.
const SWIPED: &str = "nib://web-swipe";

/// What the protocol is asked to give nib's world, and no other world, the function by.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
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

#[cfg(test)]
mod tests {
    use super::{binding, named, read, Swiped, BINDING, SCRIPT};

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
    fn a_swipe_said_as_a_window_name_is_read_off_the_name() {
        assert_eq!(
            named(r#"nib-swipe:{"k":"e","t":1}"#),
            Some(r#"{"k":"e","t":1}"#)
        );
        assert_eq!(named("nib-find"), None);
        assert_eq!(named("nib-swipe"), None);
        assert_eq!(named(""), None);
        let said = named(r#"nib-swipe:{"k":"w","dx":-3,"dy":0,"t":2,"l":false,"r":false}"#)
            .and_then(|payload| read("t1", payload));
        assert_eq!(said.map(|one| one.kind), Some("wheel"));
    }

    #[test]
    fn the_binding_is_nib_s_world_s_alone() {
        assert_eq!(binding()["name"], BINDING);
        assert_eq!(binding()["executionContextName"], crate::web_worlds::WORLD);
    }

    /// The script says through the binding by its name, or under the window name where
    /// there is none, and every listener only listens.
    #[test]
    fn the_script_asks_through_the_binding_and_only_listens() {
        assert!(SCRIPT.contains(&format!("typeof {BINDING} === 'function'")));
        assert!(SCRIPT.contains(&format!("open('about:blank', '{}' + words)", super::NAMED)));
        assert_eq!(SCRIPT.matches("passive: true").count(), 5);
        assert!(!SCRIPT.contains("preventDefault()"));
        assert!(!SCRIPT.contains("stopPropagation"));
    }
}
