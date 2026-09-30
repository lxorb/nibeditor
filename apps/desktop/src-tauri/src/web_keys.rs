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
//! out of the page to the address field. And nib's own Alt and a digit, the tabs by
//! number, which Chrome keeps from a page on Linux, and Shift+F11, the tab filling nib's
//! window, which no browser binds and so no site is used to having. Everything else is
//! the page's, which is what lets a site's own Ctrl+K work, so nothing else is touched.
//! Reloading needs nothing here: F5 and Ctrl+R pressed in a page are the engine's own, as
//! they are in Chrome. See docs/web-tabs.md.
//!
//! Finding and the address field's other two keys are not among them, because Chrome
//! asks the page first: Google Docs, Notion and VS Code on the web have a find of their
//! own on Ctrl+F, and many a site its own Ctrl+L. The browser's answer comes only when
//! the page let the key go by. So the page has Ctrl+F, Ctrl+G, F3, Ctrl+L and Alt+D, and
//! a line of script in it asks for nib's answer when nothing in the page took them; see
//! `web_opens.rs`. Ctrl+D too, Chrome's bookmark and nib's Deselect tab: Sheets fills
//! down with it and Figma duplicates.
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
//! chooses. So is Alt going down on its own, and whatever key goes down while it is
//! held, as `Unidentified` and never as the key: the window shows each tab's number
//! while Alt is held and puts them away at the next key (`told`). Nothing else is said,
//! so a site cannot be read through this and cannot speak through it either: the event
//! is the engine's, raised in this process, and nothing in the page can raise it.
//!
//! `WebView2`'s alone. `WebKitGTK` has no such event reachable through what wry hands
//! out, and on nib's own Chromium the webview has no controller to ask; on those a page
//! keeps every key, as it did.
//!
//! **A Mac needs none of this.** There the chords are rows of the menu bar across the
//! top of the screen - Cmd+T, Cmd+W, Ctrl+Tab and the rest are key equivalents - and
//! `AppKit` offers a key equivalent to the menu bar before a web tab's page: wry's child
//! webview declines every one (tauri-apps/tauri#9426), so the page never sees them. The
//! menu's row runs the command in the app's own page and hands the keyboard back to it,
//! which is what this file does by hand on Windows. See native-menu.ts in the frontend.

use serde::Serialize;

/// The event the window hears a key on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub const PRESSED: &str = "nib://web-key";

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

impl Pressed {
    /// Whether the page keeps the keyboard after this key. Every other chord here is about
    /// the browser, and the next key a hand presses is too; a tab filling the window is no
    /// reason to take the caret out of what fills it.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn keeps_page(&self) -> bool {
        self.code == "F11"
    }

    /// A letter pressed with Ctrl alone, once: a chord the page was offered first and
    /// let go by, said in the same words as the ones here. Ctrl+D is the one, which
    /// Chrome gives the page first as well; see `web_opens.rs`.
    #[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
    pub const fn with_ctrl(key: &'static str, code: &'static str) -> Self {
        Self {
            key,
            code,
            held: Held {
                ctrl: true,
                shift: false,
                alt: false,
            },
            repeat: false,
            down: true,
        }
    }
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

    // Shift+F11, the tab filling nib's window: bound by no browser and not a character, so
    // a page loses nothing a site relies on. F11 alone stays the page's, for its video.
    if vk == 0x7A && held.shift && !held.ctrl && !held.alt {
        return Some(pressed("F11", "F11"));
    }

    // Alt and a digit, nib's own way to the tabs by number, and Chrome's and Firefox's on
    // Linux. Alt alone is not a character on Windows - AltGr is Ctrl and Alt together,
    // which is the page's below - so the one thing a page loses is a digit `accesskey`,
    // as it does in those two.
    if held.alt && !held.ctrl && !held.shift {
        return digit(vk).map(|(key, code)| pressed(key, code));
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

/// A key the page keeps that the window is only told of: Alt going down on its own, and
/// any key going down while it is held, named for nothing but that. The window shows each
/// tab's number after Alt has been held a moment and puts them away at the next key (see
/// `lib/tab-strip/numbers.svelte.ts`); the page has both keys, as it always did. `AltGr`
/// is Ctrl and Alt on Windows and is never said, and Alt with Shift is the system's
/// switch between keyboards. Asked only of a key `meaning` left to the page.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn told(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    if !down || repeat || held.ctrl {
        return None;
    }
    let pressed = |key, code| Pressed {
        key,
        code,
        held,
        repeat,
        down,
    };

    if vk == 0x12 {
        return (!held.shift).then(|| pressed("Alt", "AltLeft"));
    }
    held.alt.then(|| pressed("Unidentified", ""))
}

/// A digit on the top row, which a browser jumps between its tabs with: Ctrl+1 to
/// Ctrl+9, and here Alt+0 to Alt+9 as well.
fn digit(vk: u32) -> Option<(&'static str, &'static str)> {
    const DIGITS: [(&str, &str); 10] = [
        ("0", "Digit0"),
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

    let at = usize::try_from(vk.checked_sub(0x30)?).ok()?;
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
            let repeat = status.WasKeyDown.as_bool();
            let Some(pressed) = meaning(vk, now, down, repeat) else {
                // Alt held on its own, which the page keeps and the window is told of.
                if let Some(said) = told(vk, now, down, repeat) {
                    let _ = app.emit_to(window.as_str(), PRESSED, said);
                }
                return Ok(());
            };

            // A chord is the browser's: the page never hears it, and the keyboard goes
            // back to the app, where the rest of the gesture - T again, the arrows, the
            // release - is a key like any other; see `keeps_page` for the one that does
            // not. A release is only told: the page gets its own as well.
            if down {
                args.SetHandled(true)?;
                if !pressed.keeps_page() {
                    if let Some(ours) = app.get_webview(&window) {
                        let _ = ours.set_focus();
                    }
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

/// Every other engine: a page keeps every key, and on a Mac the menu bar takes the
/// browser's own chords before the page is asked; see the top of this file. nib's own
/// Chromium on Windows hears them for every page at once instead; see `chromium`.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(_webview: &tauri::webview::PlatformWebview, _app: tauri::AppHandle, _window: String) {
}

/// The browser's chords on nib's own Chromium, on Windows.
///
/// Chromium keeps Ctrl+T, Ctrl+W, Ctrl+Tab and the rest from a page before the page is
/// asked - they are its reserved accelerators - and the runtime then swallows the command
/// they stand for, since the Chrome window they belong to is not there. So they never
/// reached the page, the app, or anything: pressed with the keyboard in a web tab they did
/// nothing at all. And the runtime offers no event for a key, as `WebView2` does.
///
/// Every window of the engine's browsers is on the app's own thread, so the keys a page
/// is sent pass through that thread's message queue first, and a hook on the thread sees
/// each one as it is taken off the queue: the same moment `WebView2`'s event is raised,
/// before Chromium has read it. A key is the browser's by `meaning`, the one rule both
/// engines are held to, and only while the keyboard is in one of the web tabs' pages - the
/// app's own page answers its keys itself. Such a key is taken off the queue, the
/// keyboard goes back to the app's page, and the window is told the key, as on `WebView2`.
#[cfg(all(windows, feature = "cef"))]
pub mod chromium {
    use std::sync::{Mutex, OnceLock, PoisonError};

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetFocus, GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, IsChild, SetWindowsHookExW, HC_ACTION, WH_KEYBOARD,
    };

    use super::{meaning, told, Held, PRESSED};

    /// The app, for the hook to tell the window with.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// Each web tab's page: its webview's label, the window its browser draws in, and the
    /// label of the app window it is in.
    static PAGES: Mutex<Vec<(String, isize, String)>> = Mutex::new(Vec::new());

    /// Starts hearing keys on this thread, once. On the app's own thread, which every
    /// browser window of the engine is on.
    #[allow(
        unsafe_code,
        reason = "a thread's keys are heard with a Win32 hook, which only the Win32 API installs"
    )]
    pub fn start(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // Safe: a hook on this thread alone, with a procedure that lives for the program;
        // it is never removed, and the thread's own end removes it.
        unsafe {
            let _ = SetWindowsHookExW(WH_KEYBOARD, Some(heard), None, GetCurrentThreadId());
        }
    }

    /// A web tab's page, by its webview's label and the window its browser draws in.
    pub fn page(label: &str, window: isize, holder: &str) {
        let mut pages = PAGES.lock().unwrap_or_else(PoisonError::into_inner);
        pages.retain(|(one, _, _)| one != label);
        pages.push((label.to_string(), window, holder.to_string()));
    }

    /// And the page gone.
    pub fn page_closed(label: &str) {
        PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|(one, _, _)| one != label);
    }

    /// The app window holding the web tab that has the keyboard, if one has it.
    #[allow(
        unsafe_code,
        reason = "which window has the keyboard is Win32's to say"
    )]
    fn typing_in() -> Option<String> {
        // Safe: reads which window of this thread has the keyboard, and whether it is
        // inside another; neither takes anything.
        let focus = unsafe { GetFocus() };
        if focus.is_invalid() {
            return None;
        }
        let pages = PAGES.lock().unwrap_or_else(PoisonError::into_inner);
        pages.iter().find_map(|(_, page, holder)| {
            let page = HWND(*page as *mut core::ffi::c_void);
            let inside = page == focus || unsafe { IsChild(page, focus).as_bool() };
            inside.then(|| holder.clone())
        })
    }

    #[allow(
        unsafe_code,
        reason = "the hook's own procedure, called by Win32 with the key's words"
    )]
    unsafe extern "system" fn heard(code: i32, key: WPARAM, flags: LPARAM) -> LRESULT {
        // Only a key being taken off the queue: a look at the queue that leaves it there is
        // the same key again.
        if code == i32::try_from(HC_ACTION).unwrap_or(0) {
            if let Some(taken) = chord(key, flags) {
                if taken {
                    return LRESULT(1);
                }
            }
        }
        // Safe: hands the key on to whatever else is hooked, as every hook must.
        unsafe { CallNextHookEx(None, code, key, flags) }
    }

    /// What a key means here: `None` for a key that is the page's, and otherwise whether
    /// it is taken from the page (a chord going down) or only told (a modifier let go).
    #[allow(unsafe_code, reason = "which modifiers are down is Win32's to say")]
    fn chord(key: WPARAM, flags: LPARAM) -> Option<bool> {
        let holder = typing_in()?;
        let app = APP.get()?;
        let vk = u32::try_from(key.0).ok()?;
        // Bit 31 of a key message's flags is set as the key goes up, and bit 30 while it
        // was already down.
        let down = flags.0 & (1 << 31) == 0;
        let repeat = flags.0 & (1 << 30) != 0;
        // Safe: reads the state this thread's input has for three keys.
        let pressed_with = |key: VIRTUAL_KEY| unsafe { GetKeyState(i32::from(key.0)) < 0 };
        let held = Held {
            ctrl: pressed_with(VK_CONTROL),
            shift: pressed_with(VK_SHIFT),
            alt: pressed_with(VK_MENU),
        };
        let Some(pressed) = meaning(vk, held, down, repeat) else {
            // Alt held on its own: the page keeps it, and the window is told.
            let said = told(vk, held, down, repeat)?;
            let (app, window) = (app.clone(), holder);
            std::thread::spawn(move || {
                let _ = app.emit_to(window.as_str(), PRESSED, said);
            });
            return Some(false);
        };

        // Told from a thread of its own, since the hook runs in the middle of the app's
        // own thread taking a message, where a question to a window waits for itself.
        let (app, window) = (app.clone(), holder);
        std::thread::spawn(move || {
            if down && !pressed.keeps_page() {
                if let Some(ours) = app.get_webview(&window) {
                    let _ = ours.set_focus();
                }
            }
            let _ = app.emit_to(window.as_str(), PRESSED, pressed);
        });
        Some(down)
    }
}

#[cfg(test)]
mod tests {
    use super::{meaning, told, Held};

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
    fn ctrl_d_is_the_page_s_first_as_in_chrome() {
        // Chrome reserves only the tab and window chords, so Sheets fills down, Figma
        // duplicates and vscode.dev selects the next one on Ctrl+D. nib's Deselect tab
        // comes after the page, by way of web_opens.rs.
        assert_eq!(down(0x44, false), None);
        assert_eq!(down(0x44, true), None);
    }

    #[test]
    fn a_chord_let_go_by_is_said_as_one_of_these() {
        let said = serde_json::to_value(super::Pressed::with_ctrl("d", "KeyD")).expect("a key");
        assert_eq!(said["key"], "d");
        assert_eq!(said["code"], "KeyD");
        assert_eq!(said["ctrl"], true);
        assert_eq!(said["shift"], false);
        assert_eq!(said["alt"], false);
        assert_eq!(said["repeat"], false);
        assert_eq!(said["down"], true);
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
    fn alt_held_on_its_own_is_told_and_left_to_the_page() {
        let alt = Held {
            alt: true,
            ..Held::default()
        };
        let said = |vk, held, repeat| told(vk, held, true, repeat).map(|one| one.key);

        // Alt going down, whether or not the engine has it as held yet.
        assert_eq!(said(0x12, Held::default(), false), Some("Alt"));
        assert_eq!(said(0x12, alt, false), Some("Alt"));
        // Held, it repeats, and a repeat is the same hold.
        assert_eq!(said(0x12, alt, true), None);
        // Any other key while it is held puts the numbers away, named for nothing.
        assert_eq!(said(0x25, alt, false), Some("Unidentified"));
        assert_eq!(said(0x44, alt, false), Some("Unidentified"));
        // Nor is a key without Alt said at all.
        assert_eq!(said(0x44, Held::default(), false), None);
        // And none of it is taken from the page: `meaning` leaves these alone.
        assert_eq!(meaning(0x12, alt, true, false), None);
        // Let go of, Alt is `meaning`'s release as it always was.
        assert_eq!(told(0x12, alt, false, false), None);
    }

    #[test]
    fn altgr_and_alt_with_shift_are_never_a_hold() {
        // AltGr is Ctrl and Alt on Windows: a Swiss `@` and a German `{`.
        assert_eq!(told(0x12, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(told(0x32, Held { alt: true, ..CTRL }, true, false), None);
        // Alt with Shift is the switch between keyboards.
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        assert_eq!(told(0x12, shift, true, false), None);
        // Shift pressed while Alt is held ends the hold like any other key.
        let held = Held {
            alt: true,
            shift: true,
            ..Held::default()
        };
        assert_eq!(
            told(0x10, held, true, false).map(|one| one.key),
            Some("Unidentified")
        );
    }

    #[test]
    fn a_chord_with_alt_is_a_character_on_altgr_keyboards() {
        assert_eq!(meaning(0x54, Held { alt: true, ..CTRL }, true, false), None);
        // AltGr and a digit too: a Swiss `@`, a German `{`.
        assert_eq!(meaning(0x32, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(meaning(0x37, Held { alt: true, ..CTRL }, true, false), None);
    }

    #[test]
    fn alt_and_a_digit_are_the_tabs_by_number_nought_included() {
        let alt = |shift| Held {
            ctrl: false,
            shift,
            alt: true,
        };
        let pressed = |vk, held| meaning(vk, held, true, false).map(|one| (one.key, one.code));

        assert_eq!(pressed(0x31, alt(false)), Some(("1", "Digit1")));
        assert_eq!(pressed(0x33, alt(false)), Some(("3", "Digit3")));
        assert_eq!(pressed(0x39, alt(false)), Some(("9", "Digit9")));
        assert_eq!(pressed(0x30, alt(false)), Some(("0", "Digit0")));
        // Said with the Alt it was pressed with, so the window reads Alt and the digit.
        assert!(meaning(0x30, alt(false), true, false).is_some_and(|one| one.held.alt));

        // With Shift it is a character on some layout, and the page's.
        assert_eq!(pressed(0x31, alt(true)), None);
        // A letter with Alt is the page's: Alt+D asks the page first; see web_opens.rs.
        assert_eq!(pressed(0x44, alt(false)), None);
        // And the digits on the number pad are numbers, not places.
        assert_eq!(pressed(0x61, alt(false)), None);
        // Ctrl and the nought is still the page's zoom.
        assert_eq!(down(0x30, false), None);
    }

    #[test]
    fn shift_f11_fills_the_window_and_leaves_the_page_its_keyboard() {
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        let filled = meaning(0x7A, shift, true, false);
        assert_eq!(filled.as_ref().map(|one| (one.key, one.code)), Some(("F11", "F11")));
        // Said with its Shift, so the window reads Shift+F11 rather than full screen.
        assert!(filled.as_ref().is_some_and(|one| one.held.shift));
        assert!(filled.is_some_and(|one| one.keeps_page()));

        // F11 alone is the page's, for a video's own full screen, and so is it with Ctrl
        // or Alt.
        assert_eq!(meaning(0x7A, Held::default(), true, false), None);
        assert_eq!(meaning(0x7A, Held { shift: true, ..CTRL }, true, false), None);
        let alt = Held {
            shift: true,
            alt: true,
            ..Held::default()
        };
        assert_eq!(meaning(0x7A, alt, true, false), None);

        // Every other chord hands the keyboard back to the app.
        assert!(meaning(0x54, CTRL, true, false).is_some_and(|one| !one.keeps_page()));
        assert!(meaning(0x75, Held::default(), true, false).is_some_and(|one| !one.keeps_page()));
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
