//! The keys a page in a web tab never gets: the browser's own.
//!
//! Emil, 2026-09-27: *"if I press Ctrl+T right now while I'm in a browser window,
//! nothing happens."* A web tab's page is a webview of its own, so once a click has put
//! the keyboard in it every key went to the site and none to the app. Ctrl+T, Ctrl+W,
//! Ctrl+Tab - the keys a hand in a browser reaches for without looking - did nothing at
//! all.
//!
//! Chrome's rule is the one kept here. A handful of chords are the browser's and a page
//! is never offered them: a new tab, closing one, going round them, moving one along,
//! reopening the last, a new window - and F6, which a hand in a browser presses to get
//! out of the page to the address field. Everything else is the page's, which is what
//! lets a site's own Ctrl+K work, so nothing else is touched. Reloading needs nothing
//! here: F5 and Ctrl+R pressed in a page are the engine's own, as they are in Chrome. See
//! docs/web-tabs.md.
//!
//! Finding and the address field's other two keys are not among them, because Chrome
//! asks the page first: Google Docs, Notion and VS Code on the web have a find of their
//! own on Ctrl+F, and many a site its own Ctrl+L. The browser's answer comes only when
//! the page let the key go by. So the page has Ctrl+F, Ctrl+G, F3, Ctrl+L and Alt+D, and
//! a line of script in it asks for nib's answer when nothing in the page took them; see
//! `web_opens.rs`.
//!
//! **How they get out.** `WebView2` tells the host about every key pressed with Ctrl or
//! Alt held before the page sees it (`AcceleratorKeyPressed`), and a key the host marks
//! handled never reaches the page. So a reserved chord is marked, the keyboard is handed
//! back to the app's own page - the chord is about the browser, and the next key a hand
//! presses is too - and the window is told the key as if it had been pressed there. The
//! window replays it on itself, so the one handler every other key goes through answers
//! this one too, rebinding and all; see `lib/web-tab/keys.ts`.
//!
//! The release of a modifier is told as well, and not taken from the page: Ctrl+T held
//! is Alt+Tab's shape, and a Ctrl let go of inside the page is the release that
//! chooses. Nothing else is said, so a site cannot be read through this and cannot
//! speak through it either: the event is the engine's, raised in this process, and
//! nothing in the page can raise it.
//!
//! `WebView2`'s alone. `WKWebView` and `WebKitGTK` have no such event reachable through
//! what wry hands out, and on nib's own Chromium the webview has no controller to ask;
//! on those a page keeps every key, as it did.

use serde::Serialize;

/// The event the window hears a key on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const PRESSED: &str = "nib://web-key";

/// The modifiers held with a key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Held {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// A key the page did not get, the way `KeyboardEvent` would have named it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Pressed {
    key: &'static str,
    code: &'static str,
    #[serde(flatten)]
    held: Held,
    /// A key held down, arriving again.
    repeat: bool,
    /// Pressed rather than let go of.
    down: bool,
}

/// What a key means here, from the virtual key code Windows names it by and the
/// modifiers held with it: a chord the page may not have, the release of a modifier,
/// or nothing - which is every other key, and the page's.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn meaning(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    let pressed = |key, code| Pressed {
        key,
        code,
        held,
        repeat,
        down,
    };

    if !down {
        return match vk {
            0x11 => Some(pressed("Control", "ControlLeft")),
            0x10 => Some(pressed("Shift", "ShiftLeft")),
            0x12 => Some(pressed("Alt", "AltLeft")),
            _ => None,
        };
    }

    // F6, the address field's key no page has a use for: Chrome keeps it, and it is not a
    // character on any keyboard.
    if vk == 0x75 && !held.ctrl && !held.shift && !held.alt {
        return Some(pressed("F6", "F6"));
    }

    // Chrome's reserved chords are all Ctrl and never Alt: Ctrl+Alt is AltGr on half
    // the keyboards in Europe, and a character typed with it is the page's.
    if !held.ctrl || held.alt {
        return None;
    }

    match (vk, held.shift) {
        (0x54, false) => Some(pressed("t", "KeyT")),
        (0x54, true) => Some(pressed("T", "KeyT")),
        (0x57, false) => Some(pressed("w", "KeyW")),
        (0x57, true) => Some(pressed("W", "KeyW")),
        (0x4E, false) => Some(pressed("n", "KeyN")),
        (0x4E, true) => Some(pressed("N", "KeyN")),
        (0x09, _) => Some(pressed("Tab", "Tab")),
        // Going round the strip and moving a tab along it, with Shift.
        (0x21, _) => Some(pressed("PageUp", "PageUp")),
        (0x22, _) => Some(pressed("PageDown", "PageDown")),
        (0x31..=0x39, false) => digit(vk).map(|(key, code)| pressed(key, code)),
        _ => None,
    }
}

/// Ctrl+1 to Ctrl+9, which a browser jumps between its tabs with.
fn digit(vk: u32) -> Option<(&'static str, &'static str)> {
    const DIGITS: [(&str, &str); 9] = [
        ("1", "Digit1"),
        ("2", "Digit2"),
        ("3", "Digit3"),
        ("4", "Digit4"),
        ("5", "Digit5"),
        ("6", "Digit6"),
        ("7", "Digit7"),
        ("8", "Digit8"),
        ("9", "Digit9"),
    ];

    let at = usize::try_from(vk.checked_sub(0x31)?).ok()?;
    DIGITS.get(at).copied()
}

/// Starts listening on one page. Called on the window's thread, once, as the page is
/// built; `window` is the label of the window it is in, which is also the label of
/// that window's own page.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a key pressed in a page is one of WebView2's own events, and its objects are reached through COM"
)]
pub fn listen(webview: &tauri::webview::PlatformWebview, app: tauri::AppHandle, window: String) {
    use tauri::{Emitter, Manager};
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    // Whether a modifier was down with the key. The event names the key and not the
    // hand around it, so it is asked two ways: as the input this thread shares with the
    // page's window had it when the key arrived, which is the answer that belongs to
    // this key, and as the keyboard has it now, for a page whose window keeps its input
    // to itself. Either says a hand is on it.
    let held = |key: VIRTUAL_KEY| {
        let code = i32::from(key.0);
        unsafe { GetKeyState(code) < 0 || GetAsyncKeyState(code) < 0 }
    };

    // Safe: the controller is the one this window owns, every object below is used only
    // on this thread, and the handler outlives the call because WebView2 holds it.
    unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else {
                return Ok(());
            };

            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            let mut vk = 0u32;
            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            args.KeyEventKind(&raw mut kind)?;
            args.VirtualKey(&raw mut vk)?;
            args.PhysicalKeyStatus(&raw mut status)?;

            let down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
            let now = Held {
                ctrl: held(VK_CONTROL),
                shift: held(VK_SHIFT),
                alt: held(VK_MENU),
            };
            let Some(pressed) = meaning(vk, now, down, status.WasKeyDown.as_bool()) else {
                return Ok(());
            };

            // A chord is the browser's: the page never hears it, and the keyboard goes
            // back to the app, where the rest of the gesture - T again, the arrows, the
            // release - is a key like any other. A release is only told: the page gets
            // its own as well.
            if down {
                args.SetHandled(true)?;
                if let Some(ours) = app.get_webview(&window) {
                    let _ = ours.set_focus();
                }
            }

            let _ = app.emit_to(window.as_str(), PRESSED, pressed);
            Ok(())
        }));

        let mut token = 0i64;
        let _ = webview
            .controller()
            .add_AcceleratorKeyPressed(&handler, &raw mut token);
    }
}

/// Every other engine: a page keeps every key; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(_webview: &tauri::webview::PlatformWebview, _app: tauri::AppHandle, _window: String) {
}

#[cfg(test)]
mod tests {
    use super::{meaning, Held};

    const CTRL: Held = Held {
        ctrl: true,
        shift: false,
        alt: false,
    };

    fn down(vk: u32, shift: bool) -> Option<(&'static str, &'static str)> {
        meaning(vk, Held { shift, ..CTRL }, true, false).map(|one| (one.key, one.code))
    }

    #[test]
    fn a_new_tab_and_the_last_one_closed_are_the_browser_s() {
        assert_eq!(down(0x54, false), Some(("t", "KeyT")));
        assert_eq!(down(0x54, true), Some(("T", "KeyT")));
    }

    #[test]
    fn so_are_closing_going_round_and_a_new_window() {
        assert_eq!(down(0x57, false), Some(("w", "KeyW")));
        assert_eq!(down(0x09, false), Some(("Tab", "Tab")));
        assert_eq!(down(0x09, true), Some(("Tab", "Tab")));
        assert_eq!(down(0x4E, true), Some(("N", "KeyN")));
        assert_eq!(down(0x22, false), Some(("PageDown", "PageDown")));
        assert_eq!(down(0x21, true), Some(("PageUp", "PageUp")));
    }

    #[test]
    fn and_the_nine_tabs_by_number() {
        assert_eq!(down(0x31, false), Some(("1", "Digit1")));
        assert_eq!(down(0x39, false), Some(("9", "Digit9")));
        // Shift turns a digit into a character on most layouts, and that is the page's.
        assert_eq!(down(0x31, true), None);
        assert_eq!(down(0x30, false), None);
    }

    #[test]
    fn and_f6_to_the_address_field() {
        let alone = |vk, held| meaning(vk, held, true, false).map(|one| one.key);
        assert_eq!(alone(0x75, Held::default()), Some("F6"));

        // Shift+F6 and Ctrl+F6 are the page's.
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        assert_eq!(alone(0x75, shift), None);
        assert_eq!(alone(0x75, CTRL), None);
    }

    #[test]
    fn finding_and_the_address_field_s_other_keys_are_the_page_s_first() {
        // Ctrl+F, Ctrl+G and Ctrl+Shift+G, F3 either way, Ctrl+L and Alt+D: a site's own
        // answer has them before nib's does; see web_opens.rs.
        for (vk, shift) in [
            (0x46, false),
            (0x47, false),
            (0x47, true),
            (0x46, true),
            (0x4C, false),
        ] {
            assert_eq!(down(vk, shift), None, "{vk:#x}");
        }
        for shift in [false, true] {
            let bare = Held {
                shift,
                ..Held::default()
            };
            assert_eq!(meaning(0x72, bare, true, false), None);
        }
        let alt = Held {
            alt: true,
            ..Held::default()
        };
        assert_eq!(meaning(0x44, alt, true, false), None);
    }

    #[test]
    fn everything_else_is_the_page_s() {
        // Ctrl+L, Ctrl+K, Ctrl+F, Ctrl+P, Ctrl+R: a site's own shortcuts, and the reason
        // there is a rule. F5 and Ctrl+R reach the engine's own reload.
        for vk in [0x4C, 0x4B, 0x46, 0x50, 0x52] {
            assert_eq!(down(vk, false), None, "{vk:#x}");
        }
        assert_eq!(meaning(0x74, Held::default(), true, false), None);
        // A letter with no Ctrl is typing.
        assert_eq!(meaning(0x54, Held::default(), true, false), None);
    }

    #[test]
    fn a_chord_with_alt_is_a_character_on_altgr_keyboards() {
        assert_eq!(meaning(0x54, Held { alt: true, ..CTRL }, true, false), None);
    }

    #[test]
    fn a_modifier_let_go_of_is_told_and_nothing_else_released_is() {
        let up = |vk| meaning(vk, Held::default(), false, false).map(|one| one.key);
        assert_eq!(up(0x11), Some("Control"));
        assert_eq!(up(0x10), Some("Shift"));
        assert_eq!(up(0x12), Some("Alt"));
        assert_eq!(up(0x54), None);
    }

    #[test]
    fn a_key_held_down_says_so() {
        let again = meaning(0x54, CTRL, true, true);
        assert!(again.is_some_and(|one| one.repeat && one.down));
    }
}
