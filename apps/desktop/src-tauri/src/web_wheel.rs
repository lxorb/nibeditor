//! One notch of the wheel over a page scrolls it one notch.
//!
//! Emil, 2026-09-30: *"the scrolling doesn't feel like it should. I have the feeling it
//! may be faster than it should be (this is only when scrolling in a web tab)"*. It was
//! twice as fast: 333 pixels a notch where Chrome on the same machine moves 167, and a
//! site that listens to the wheel - a map, a slideshow - heard every notch twice.
//! Measured by `scripts/web-scroll-probe.py`.
//!
//! **Why.** The engine takes mouse input in a window of its own over the page, the
//! "Chrome Legacy Window" (`Chrome_RenderWidgetHostHWND`), which hands every message on
//! to the page's own window, its parent. A wheel message that arrives *there* is handled
//! twice: once as it is handed on, and once more when the legacy window passes it to
//! `DefWindowProc`, which bubbles a wheel up to the parent - the same page's window,
//! which handles it again. Two wheel events for one notch. That is Chromium's own and not
//! `WebView2`'s: a bare wry window and upstream Chromium (Electron 33) do the same.
//!
//! Chrome never meets it. Its legacy window is on the thread that holds the keyboard, and
//! Windows hands a wheel over it to that thread's focus - the browser's own window - which
//! handles it once: one event a notch, the notch Chrome is known for. A page in nib is a
//! window of another process inside nib's window, on a thread that holds the keyboard only
//! after a click in the page. Anywhere else - the address field, the sidebar, a note, a
//! tab just switched to - the wheel is delivered to the window under the pointer, the
//! legacy window, and the page scrolls double. That much is read off the two ends rather
//! than watched, because no real wheel ever reaches a probe that is never on the screen;
//! and the fix below holds whichever window Windows picks. Nib's own page meets the same
//! thing the other way round, over a note while the keyboard is in a site.
//!
//! **What this does.** It sends the wheel where Chrome's goes. A low-level mouse hook
//! sees each wheel before Windows delivers it; one over a legacy window inside one of
//! nib's own windows is taken and posted to that legacy window's parent, the page's own
//! window, with the delta, the point and the keys held exactly as Windows would have
//! written them. The engine handles it there once, reroutes nothing, and scrolls one
//! notch with its own animation. Every other wheel, and every other mouse message, goes
//! on untouched: a window of another program is never aimed at.
//!
//! Nothing here slows a wheel down or speeds one up: the distance is the engine's own,
//! from the reader's *lines to scroll* setting, as in Chrome. And a precision touchpad
//! never comes through here at all - its two fingers reach the page through Direct
//! Manipulation, not as wheel messages - so it pans and flings as it did.
//!
//! **What it costs.** The hook is installed with the first page of a run and kept until
//! the app quits, like the page that holds the web's session open (see
//! `session::anchor` in `web_tabs.rs`): a run with no web tab never has one. It runs on a
//! thread of its own that does nothing else, so a mouse message is answered in a few
//! microseconds and no busy moment in the window can hold the pointer up.
//!
//! `WebView2`'s alone. Nib's own Chromium puts every page and the interface in one
//! browser process with the focus, which is Chrome's arrangement, and a Mac or Linux
//! engine has no legacy window.

/// The class of the engine's input window over a page. Chromium's own name for it,
/// `ui::kLegacyRenderWidgetHostHwnd`, unchanged since the window was introduced.
const INPUT_WINDOW: &str = "Chrome_RenderWidgetHostHWND";

/// `WM_MOUSEWHEEL` and `WM_MOUSEHWHEEL`: the two messages a wheel arrives as.
const WHEEL: u32 = 0x020A;
const TILT: u32 = 0x020E;

/// A key or a button that can be held down as a wheel turns: Ctrl, which a map zooms by
/// and the engine zooms the page by when the page let it go by, Shift, which scrolls
/// sideways, and a drag the wheel turns during. Ctrl is read off this flag by the engine,
/// so a notch posted with it is one rung of the page's zoom; see `web_page.rs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    Ctrl,
    Shift,
    Left,
    Right,
    Middle,
    Back,
    Forward,
}

impl Hold {
    /// Every one of them, in the order Windows numbers their flags.
    pub const ALL: [Self; 7] = [
        Self::Left,
        Self::Right,
        Self::Shift,
        Self::Ctrl,
        Self::Middle,
        Self::Back,
        Self::Forward,
    ];

    /// The `MK_*` flag a wheel message carries for it.
    pub fn flag(self) -> u16 {
        match self {
            Self::Left => 0x0001,
            Self::Right => 0x0002,
            Self::Shift => 0x0004,
            Self::Ctrl => 0x0008,
            Self::Middle => 0x0010,
            Self::Back => 0x0020,
            Self::Forward => 0x0040,
        }
    }

    /// The button on the mouse that is this one to the reader. The message names the
    /// buttons as the reader uses them and the hardware as they are wired, so a reader who
    /// swapped them has their left button on the right-hand key.
    pub fn wired(self, swapped: bool) -> Self {
        match (self, swapped) {
            (Self::Left, true) => Self::Right,
            (Self::Right, true) => Self::Left,
            (one, _) => one,
        }
    }
}

/// Whether a message is a turn of the wheel, upright or tilted.
pub fn is_wheel(message: u32) -> bool {
    message == WHEEL || message == TILT
}

/// Whether a wheel over a window of this class, in a window of the app's own, is one to
/// send to the page's window instead.
pub fn is_input_window(class: &str) -> bool {
    class == INPUT_WINDOW
}

/// The `MK_*` flags a wheel message carries, for whichever of them `held` says are down.
pub fn keys(held: impl Fn(Hold) -> bool) -> u16 {
    Hold::ALL
        .into_iter()
        .filter(|one| held(*one))
        .fold(0, |all, one| all | one.flag())
}

/// A wheel message's `wParam`: the turn in the high word, a notch being 120 and a finer
/// wheel less, and the keys in the low one.
pub fn wparam(delta: i16, keys: u16) -> usize {
    (usize::from(u16::from_ne_bytes(delta.to_ne_bytes())) << 16) | usize::from(keys)
}

/// A wheel message's `lParam`: the pointer on the screen, in physical pixels, one signed
/// word each - a screen left of or above the main one has negative coordinates.
pub fn lparam(x: i32, y: i32) -> isize {
    let word = |at: i32| {
        let [low, high, ..] = at.to_le_bytes();
        u32::from(u16::from_le_bytes([low, high]))
    };
    let packed = usize::try_from((word(y) << 16) | word(x)).unwrap_or_default();
    isize::from_ne_bytes(packed.to_ne_bytes())
}

/// The turn a low-level hook reads out of `mouseData`: the high word, signed.
pub fn delta(mouse_data: u32) -> i16 {
    let [.., low, high] = mouse_data.to_le_bytes();
    i16::from_le_bytes([low, high])
}

#[cfg(all(windows, not(feature = "cef")))]
pub use hook::arm;

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a wheel is seen before Windows delivers it only through a low-level hook, and the windows it is aimed at are asked through user32"
)]
mod hook {
    use std::sync::Once;

    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_SHIFT, VK_XBUTTON1,
        VK_XBUTTON2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetClassNameW, GetMessageW, GetParent, GetSystemMetrics,
        GetWindowThreadProcessId, PostMessageW, SetWindowsHookExW, WindowFromPoint, GA_ROOT,
        HC_ACTION, HHOOK, MSG, MSLLHOOKSTRUCT, SM_SWAPBUTTON, WH_MOUSE_LL,
    };

    use super::{delta, is_input_window, is_wheel, keys, lparam, wparam, Hold};

    /// Starts sending every wheel over a page to the page's own window, from now until
    /// the app quits. Called as each page is built; only the first call does anything.
    pub fn arm() {
        static ARMED: Once = Once::new();
        ARMED.call_once(|| {
            let _ = std::thread::Builder::new()
                .name("wheel".into())
                .spawn(listen);
        });
    }

    /// The hook's own thread: installs it and answers it for the rest of the run. A
    /// low-level hook is called on the thread that installed it, through that thread's
    /// messages, so this does nothing but wait for them.
    fn listen() {
        // Safe: every call is on this thread, about this thread, and the hook it installs
        // is answered by the loop below for as long as the thread lives.
        unsafe {
            // Ahead of the app's other threads: every mouse message on the machine waits
            // for this one to answer.
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            if SetWindowsHookExW(WH_MOUSE_LL, Some(heard), HINSTANCE::from(module), 0).is_err() {
                return;
            }
            let mut message = MSG::default();
            while GetMessageW(&raw mut message, HWND::default(), 0, 0).as_bool() {}
        }
    }

    /// Every mouse message on the machine, before it is delivered. A wheel sent to a
    /// page's window is taken, so Windows delivers nothing of it; anything else is
    /// passed on at once.
    unsafe extern "system" fn heard(code: i32, message: WPARAM, info: LPARAM) -> LRESULT {
        if code == i32::try_from(HC_ACTION).unwrap_or(-1) {
            let kind = u32::try_from(message.0).unwrap_or(0);
            // Safe: for `HC_ACTION` a low-level mouse hook's `lParam` is the event, and it
            // lives for as long as this call.
            if is_wheel(kind) && sent(kind, unsafe { &*(info.0 as *const MSLLHOOKSTRUCT) }) {
                return LRESULT(1);
            }
        }
        // Safe: the event as it came, handed on; the hook handle is ignored for this kind.
        unsafe { CallNextHookEx(HHOOK::default(), code, message, info) }
    }

    /// Posts a wheel to the page's window when it is over a page, and says whether it
    /// did.
    fn sent(kind: u32, event: &MSLLHOOKSTRUCT) -> bool {
        // Safe: a point in, a window handle out, or none.
        let under = unsafe { WindowFromPoint(event.pt) };
        aim(under, kind, delta(event.mouseData), event.pt, keys(held))
    }

    /// Posts a wheel to the parent of `under` when `under` is the engine's input window
    /// inside one of the app's own windows, and says whether it did. Apart from where the
    /// wheel comes from, so the tests can hand it windows of their own.
    pub fn aim(under: HWND, kind: u32, turn: i16, at: POINT, keys: u16) -> bool {
        if under.is_invalid() || !is_input_window(&class_of(under)) || !ours(under) {
            return false;
        }
        // Safe: a window handle in, its parent out; a window gone since is an error.
        let Ok(page) = (unsafe { GetParent(under) }) else {
            return false;
        };
        // Safe: a message posted to another window, which copies the two words.
        unsafe {
            PostMessageW(
                page,
                kind,
                WPARAM(wparam(turn, keys)),
                LPARAM(lparam(at.x, at.y)),
            )
        }
        .is_ok()
    }

    /// The class a window was registered under.
    fn class_of(window: HWND) -> String {
        let mut name = [0u16; 64];
        // Safe: the buffer is this function's and its length is the slice's.
        let length = unsafe { GetClassNameW(window, &mut name) };
        String::from_utf16_lossy(&name[..usize::try_from(length).unwrap_or(0)])
    }

    /// Whether the window a window sits in is one of this process's own: a page in nib,
    /// never a browser or anything else on the machine that also runs Chromium.
    fn ours(window: HWND) -> bool {
        let mut owner = 0u32;
        // Safe: handles in, a process id out.
        unsafe {
            GetWindowThreadProcessId(GetAncestor(window, GA_ROOT), Some(&raw mut owner));
            owner == GetCurrentProcessId()
        }
    }

    /// Whether a key or a button is down as the wheel turns, off the hardware as it is now.
    fn held(one: Hold) -> bool {
        // Safe: a question with no arguments.
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let key = match one.wired(swapped) {
            Hold::Ctrl => VK_CONTROL,
            Hold::Shift => VK_SHIFT,
            Hold::Left => VK_LBUTTON,
            Hold::Right => VK_RBUTTON,
            Hold::Middle => VK_MBUTTON,
            Hold::Back => VK_XBUTTON1,
            Hold::Forward => VK_XBUTTON2,
        };
        // Safe: a question about one key.
        unsafe { GetAsyncKeyState(i32::from(key.0)) < 0 }
    }

    #[cfg(test)]
    mod tests {
        use std::cell::Cell;

        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW,
            RegisterClassW, HMENU, MSG, PM_REMOVE, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
            WNDPROC, WS_CHILD, WS_EX_TRANSPARENT, WS_OVERLAPPED,
        };

        use super::super::Hold;
        use super::super::WHEEL;
        use super::aim;

        thread_local! {
            /// What the page's window in the test was sent: each wheel's two words.
            static HEARD: Cell<Vec<(usize, isize)>> = const { Cell::new(Vec::new()) };
        }

        /// Every window here but the page's: nothing to answer.
        unsafe extern "system" fn plain(
            window: HWND,
            message: u32,
            first: WPARAM,
            second: LPARAM,
        ) -> LRESULT {
            // Safe: the message as it came, handed to Windows' own answer.
            unsafe { DefWindowProcW(window, message, first, second) }
        }

        /// The page's window: writes down every wheel it is sent.
        unsafe extern "system" fn page(
            window: HWND,
            message: u32,
            first: WPARAM,
            second: LPARAM,
        ) -> LRESULT {
            if message == WHEEL {
                HEARD.with(|heard| {
                    let mut all = heard.take();
                    all.push((first.0, second.0));
                    heard.set(all);
                });
                return LRESULT(0);
            }
            // Safe: as above.
            unsafe { DefWindowProcW(window, message, first, second) }
        }

        /// A window of this process that nobody sees, with a page's window inside it and
        /// the engine's input window inside that - the three a wheel over a page passes
        /// through - and one more child of another class beside the last.
        struct Windows {
            top: HWND,
            page: HWND,
            input: HWND,
            other: HWND,
        }

        impl Windows {
            fn built() -> Self {
                // Safe: classes and windows of this test's own, never shown and destroyed
                // when it ends; nothing here reaches another process.
                unsafe {
                    let module =
                        HINSTANCE::from(GetModuleHandleW(None).expect("the test's own module"));
                    let classes: [(PCWSTR, WNDPROC); 4] = [
                        (w!("nib test top"), Some(plain)),
                        (w!("nib test page"), Some(page)),
                        (w!("Chrome_RenderWidgetHostHWND"), Some(plain)),
                        (w!("nib test other"), Some(plain)),
                    ];
                    for (name, answer) in classes {
                        // A second test registering the same class is told it exists,
                        // which is as good.
                        RegisterClassW(&WNDCLASSW {
                            lpfnWndProc: answer,
                            hInstance: module,
                            lpszClassName: name,
                            ..Default::default()
                        });
                    }
                    let make =
                        |extra: WINDOW_EX_STYLE, class: PCWSTR, style: WINDOW_STYLE, parent| {
                            CreateWindowExW(
                                extra,
                                class,
                                PCWSTR::null(),
                                style,
                                0,
                                0,
                                400,
                                300,
                                parent,
                                HMENU::default(),
                                module,
                                None,
                            )
                            .expect("a window of the test's own")
                        };
                    let none = WINDOW_EX_STYLE::default();
                    let top = make(none, w!("nib test top"), WS_OVERLAPPED, HWND::default());
                    let page = make(none, w!("nib test page"), WS_CHILD, top);
                    let input = make(
                        WS_EX_TRANSPARENT,
                        w!("Chrome_RenderWidgetHostHWND"),
                        WS_CHILD,
                        page,
                    );
                    let other = make(none, w!("nib test other"), WS_CHILD, page);
                    Self {
                        top,
                        page,
                        input,
                        other,
                    }
                }
            }

            /// Every wheel the page's window has been posted, delivered and read back.
            fn heard(&self) -> Vec<(usize, isize)> {
                // Safe: this thread's own queue, for the test's own window.
                unsafe {
                    let mut message = MSG::default();
                    while PeekMessageW(&raw mut message, self.page, 0, 0, PM_REMOVE).as_bool() {
                        DispatchMessageW(&raw const message);
                    }
                }
                HEARD.with(Cell::take)
            }
        }

        impl Drop for Windows {
            fn drop(&mut self) {
                // Safe: the test's own window, which takes its children with it.
                unsafe {
                    let _ = DestroyWindow(self.top);
                }
            }
        }

        #[test]
        fn a_wheel_over_a_page_goes_to_the_page_s_own_window_once() {
            let windows = Windows::built();
            let at = POINT { x: -21_000, y: 480 };
            let ctrl = Hold::Ctrl.flag();

            assert!(aim(windows.input, WHEEL, -120, at, ctrl));
            let heard = windows.heard();

            assert_eq!(heard.len(), 1, "one notch, one wheel: {heard:?}");
            let (first, second) = heard[0];
            assert_eq!(
                first,
                (0xFF88 << 16) | 0x0008,
                "a notch down with Ctrl held"
            );
            assert_eq!(
                second,
                (0x01E0 << 16) | 0xADF8,
                "the point, as Windows packs it"
            );
        }

        #[test]
        fn a_wheel_over_anything_else_is_left_alone() {
            let windows = Windows::built();
            let at = POINT { x: 10, y: 10 };

            assert!(!aim(windows.other, WHEEL, -120, at, 0));
            assert!(!aim(windows.page, WHEEL, -120, at, 0));
            assert!(!aim(windows.top, WHEEL, -120, at, 0));
            assert!(!aim(HWND::default(), WHEEL, -120, at, 0));
            assert!(windows.heard().is_empty());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{delta, is_input_window, is_wheel, keys, lparam, wparam, Hold};

    #[test]
    fn only_the_two_wheel_messages_are_wheels() {
        assert!(is_wheel(0x020A));
        assert!(is_wheel(0x020E));
        assert!(!is_wheel(0x0200), "a move");
        assert!(!is_wheel(0x0201), "a press");
    }

    #[test]
    fn only_the_engine_s_input_window_is_aimed_past() {
        assert!(is_input_window("Chrome_RenderWidgetHostHWND"));
        assert!(
            !is_input_window("Chrome_WidgetWin_1"),
            "the page's own window"
        );
        assert!(!is_input_window("Chrome_WidgetWin_0"));
        assert!(!is_input_window("WRY_WEBVIEW"));
        assert!(!is_input_window("Tauri Window"));
    }

    #[test]
    fn the_keys_held_are_the_flags_windows_writes() {
        assert_eq!(keys(|_| false), 0);
        assert_eq!(keys(|one| one == Hold::Ctrl), 0x0008, "Ctrl, which zooms");
        assert_eq!(
            keys(|one| one == Hold::Shift),
            0x0004,
            "Shift, which scrolls sideways"
        );
        assert_eq!(keys(|one| one == Hold::Left), 0x0001, "a drag");
        assert_eq!(keys(|_| true), 0x007F);
    }

    #[test]
    fn swapped_buttons_are_read_off_the_other_key() {
        assert_eq!(Hold::Left.wired(false), Hold::Left);
        assert_eq!(Hold::Left.wired(true), Hold::Right);
        assert_eq!(Hold::Right.wired(true), Hold::Left);
        assert_eq!(Hold::Middle.wired(true), Hold::Middle);
        assert_eq!(Hold::Ctrl.wired(true), Hold::Ctrl);
    }

    #[test]
    fn a_turn_is_the_high_word_and_keeps_its_sign_and_its_fraction() {
        assert_eq!(delta(0xFF88_0000), -120, "a notch towards the reader");
        assert_eq!(delta(0x0078_0000), 120, "a notch away");
        assert_eq!(
            delta(0xFFE2_0000),
            -30,
            "a quarter notch of a free-spinning wheel"
        );
        assert_eq!(delta(0x0000_0000), 0);
    }

    #[test]
    fn the_message_words_are_packed_as_windows_packs_them() {
        assert_eq!(wparam(-120, 0), 0xFF88 << 16);
        assert_eq!(wparam(120, 0x0008), (0x0078 << 16) | 0x0008);
        assert_eq!(wparam(-30, 0x0004), (0xFFE2 << 16) | 0x0004);
        assert_eq!(lparam(0x0064, 0x00C8), (0x00C8 << 16) | 0x0064);
        // A screen to the left of or above the main one.
        assert_eq!(lparam(-1, -2), (0xFFFE << 16) | 0xFFFF);
        assert_eq!(lparam(-21_000, 480), (0x01E0 << 16) | 0xADF8);
    }

    /// The round trip the hook makes: what it reads out of the event is what the page's
    /// window reads back out of the message it posts.
    #[test]
    fn a_page_reads_back_the_turn_and_the_point_it_was_sent() {
        for (turn, x, y) in [(-120, 640, 400), (120, -2000, -300), (-30, 0, 0)] {
            let first = wparam(turn, 0);
            let second = lparam(x, y);
            let signed = |word: u16| i16::from_ne_bytes(word.to_ne_bytes());
            let high = u16::try_from(first >> 16).expect("one word");
            assert_eq!(signed(high), turn, "GET_WHEEL_DELTA_WPARAM");
            let low =
                |word: isize| i32::from(signed(u16::try_from(word & 0xFFFF).expect("one word")));
            assert_eq!(low(second), x, "GET_X_LPARAM");
            assert_eq!(low(second >> 16), y, "GET_Y_LPARAM");
        }
    }
}
