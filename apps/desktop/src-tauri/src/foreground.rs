//! A probe is never the window in front of anybody - by construction, rather than by
//! the watch in `scripts/probe_app.py` ending it once it already is.
//!
//! A drive's build runs with `NIB_OFF_SCREEN` (see placement.rs) on the machine of
//! somebody who is working at it. On 2026-09-30 off-screen probes became the window in
//! front ten times: Chromium ones five times in one lane, one at -32000,-32000 977
//! milliseconds into a warm launch, one for four seconds after the reader's own nib
//! restarted. Each was off every screen and under every other window, the watch ended
//! each of them, and each time the reader's typing went into it for a second or four
//! first.
//!
//! Windows decides who may take the foreground per process, not per window: the process
//! in front may, a process the one in front started may, the one that had the last
//! input may, and anybody may while nothing is in front. An agent's shell is started by a
//! terminal that is often the window in front, so a probe started from it can inherit
//! the right - and then the first of its windows anything activates is the window in
//! front, wherever it is. Or the window in front closes, and the system hands the
//! foreground to the next window it finds. So, under the switch, from the process's
//! first line to its last:
//!
//! - **Nothing in the process may take the foreground.** It locks the foreground as it
//!   starts (`LockSetForegroundWindow`), which the system grants only to a process that
//!   could have taken it - exactly the process this is for - and which then holds back
//!   every caller, the engine's own processes included, until somebody presses Alt or
//!   clicks a window. That is every other program as well, for as long as the lock
//!   stands: the price of a probe that could have come forward, and paid only then.
//! - **No window of the app's own thread is ever activated.** A computer-based-training
//!   hook on that thread refuses every activation before it happens, whoever asked for
//!   it: tao's, winit's, and nib's own Chromium's, whose windows are made and focused on
//!   that same thread (its message pump is the app's; see src-tauri/cef).
//! - **Every top-level window is one the system never activates either**: made
//!   `WS_EX_NOACTIVATE` and `WS_EX_TOOLWINDOW` and without `WS_EX_APPWINDOW`, so a click,
//!   Alt+Tab or the window in front closing never lands on it and there is no taskbar
//!   button to press. Held there through every restyle, because tao and winit both write
//!   a window's whole extended style afresh on every change of their own.
//!
//! And the app's own ways of asking for the keyboard do nothing under the switch; see
//! `raised` and `keyboard_to` in placement.rs. A drive that types into a probe does it
//! through the `DevTools` protocol or with messages to the probe's own window, and neither
//! needs the foreground (docs/conventions.md, "Probes").

/// `WS_EX_NOACTIVATE`: never activated by a click or by the system choosing a window.
const NO_ACTIVATE: u32 = 0x0800_0000;
/// `WS_EX_TOOLWINDOW`: not in Alt+Tab, and no taskbar button.
const TOOL_WINDOW: u32 = 0x0000_0080;
/// `WS_EX_APPWINDOW`: a taskbar button whatever else the style says.
const APP_WINDOW: u32 = 0x0004_0000;
/// `WS_CHILD`: a window inside another, which is activated only with it.
const CHILD: u32 = 0x4000_0000;

/// Holds this process out of the foreground for the rest of its life, where the run is a
/// probe's, and says whether the process could have taken the foreground as it started.
/// Called first thing, on the thread that goes on to run the event loop, before any
/// window exists. Nothing at all anywhere else, and nothing off Windows, whose window
/// managers give a process nothing like the foreground right to inherit.
pub fn hold() -> bool {
    #[cfg(windows)]
    if crate::placement::asked_away() {
        let locked = held::lock();
        held::on_this_thread();
        return locked;
    }
    false
}

/// The extended style a probe's top-level window is held to, from the one it asked for.
fn kept_back(asked: u32) -> u32 {
    (asked | NO_ACTIVATE | TOOL_WINDOW) & !APP_WINDOW
}

/// Whether a window about to be made is one the system could activate: a top-level
/// window. A child is activated with its parent, and a window for messages alone is on
/// no desktop.
fn top_level(style: u32, for_messages: bool) -> bool {
    style & CHILD == 0 && !for_messages
}

#[cfg(windows)]
mod held {
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetWindowLongW, LockSetForegroundWindow, SetWindowLongW, SetWindowsHookExW,
        CBT_CREATEWNDW, GWL_EXSTYLE, HCBT_ACTIVATE, HCBT_CREATEWND, HHOOK, HWND_MESSAGE, LSFW_LOCK,
        STYLESTRUCT, WH_CBT, WINDOW_EX_STYLE, WM_NCCREATE, WM_NCDESTROY, WM_STYLECHANGING,
    };

    /// This file's subclass among a window's others; tao's and wry's are theirs.
    const SUBCLASS: usize = 0x6e69_6200;

    /// Locks the foreground, which the system allows only a process that could take it;
    /// see the top of this file. True where it did.
    #[allow(unsafe_code, reason = "locking the foreground is a Win32 call")]
    pub fn lock() -> bool {
        // Safe: no pointers, and a refusal is an answer rather than a fault.
        unsafe { LockSetForegroundWindow(LSFW_LOCK) }.is_ok()
    }

    /// Every window this thread makes from now on is held back, and nothing on it is
    /// ever activated. For the thread's whole life: the hook is never removed.
    #[allow(unsafe_code, reason = "setting a window hook is a Win32 call")]
    pub fn on_this_thread() {
        // Safe: a hook on this thread alone, with a procedure that lives as long as the
        // process does.
        let _ = unsafe {
            SetWindowsHookExW(
                WH_CBT,
                Some(watching),
                HINSTANCE::default(),
                GetCurrentThreadId(),
            )
        };
    }

    #[allow(
        unsafe_code,
        reason = "a window hook is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn watching(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match u32::try_from(code) {
            // Refused, whoever asked: a nonzero answer and the window is not activated.
            Ok(HCBT_ACTIVATE) => return LRESULT(1),
            Ok(HCBT_CREATEWND) => {
                // Safe: for `HCBT_CREATEWND` the system passes a live `CBT_CREATEWND` whose
                // `lpcs` is the structure the window is being made from, ours to change
                // until this returns, and the window's own handle.
                unsafe {
                    let told = lparam.0 as *const CBT_CREATEWNDW;
                    if let Some(making) = told.as_ref().and_then(|told| told.lpcs.as_mut()) {
                        let style = u32::from_ne_bytes(making.style.to_ne_bytes());
                        if super::top_level(style, making.hwndParent == HWND_MESSAGE) {
                            making.dwExStyle =
                                WINDOW_EX_STYLE(super::kept_back(making.dwExStyle.0));
                            let _ =
                                SetWindowSubclass(HWND(wparam.0 as _), Some(holding), SUBCLASS, 0);
                        }
                    }
                }
            }
            _ => {}
        }
        // Safe: handing the call on is what a hook owes the rest of the chain.
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }

    /// A held window's own procedure, in front of the rest: its extended style set as it
    /// is made, and kept on every change anybody makes to it afterwards.
    #[allow(
        unsafe_code,
        reason = "a subclass procedure is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn holding(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        // Which style is changing, as the index `SetWindowLong` was given: sign-extended.
        let index = isize::from_ne_bytes(wparam.0.to_ne_bytes());
        if message == WM_STYLECHANGING && i32::try_from(index) == Ok(GWL_EXSTYLE.0) {
            // Safe: for `WM_STYLECHANGING` the system passes the new styles, ours to change
            // before they are set.
            if let Some(changing) = unsafe { (lparam.0 as *mut STYLESTRUCT).as_mut() } {
                changing.styleNew = super::kept_back(changing.styleNew);
            }
        }
        if message == WM_NCDESTROY {
            // Safe: this window's own subclass, removed once, as it goes.
            let _ = unsafe { RemoveWindowSubclass(window, Some(holding), SUBCLASS) };
        }
        // Safe: the rest of the window's procedures, as they were.
        let answer = unsafe { DefSubclassProc(window, message, wparam, lparam) };
        if message == WM_NCCREATE {
            // Whether the system took the style from the structure the hook changed or
            // from the one the window was first asked for, it has this one from here on;
            // setting it runs through `WM_STYLECHANGING` above.
            // Safe: the window this procedure belongs to, on its own thread.
            unsafe {
                let now = u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
                let _ = SetWindowLongW(
                    window,
                    GWL_EXSTYLE,
                    i32::from_ne_bytes(super::kept_back(now).to_ne_bytes()),
                );
            }
        }
        answer
    }
}

#[cfg(test)]
mod tests {
    use super::{kept_back, top_level, APP_WINDOW, CHILD, NO_ACTIVATE, TOOL_WINDOW};

    #[test]
    fn a_window_is_held_back_whatever_style_it_asked_for() {
        for asked in [
            0,
            APP_WINDOW,
            NO_ACTIVATE,
            APP_WINDOW | 0x0010_0000,
            u32::MAX,
        ] {
            let kept = kept_back(asked);
            assert_eq!(
                kept & NO_ACTIVATE,
                NO_ACTIVATE,
                "{asked:#x} can be activated"
            );
            assert_eq!(kept & TOOL_WINDOW, TOOL_WINDOW, "{asked:#x} is in Alt+Tab");
            assert_eq!(kept & APP_WINDOW, 0, "{asked:#x} has a taskbar button");
        }
        // Everything else it asked for, it keeps.
        assert_eq!(kept_back(0x0010_0000) & 0x0010_0000, 0x0010_0000);
    }

    /// Held back before anything in the process can make a window or start an engine,
    /// on either engine: `run_on` is where both builds start, and the plugins, the
    /// context and the runtime's own windows all come after it.
    #[test]
    fn the_app_holds_itself_back_before_it_makes_anything() {
        let lib = include_str!("lib.rs");
        let start = lib.find("pub fn run_on(").expect("run_on");
        let held = lib[start..]
            .find("foreground::hold()")
            .expect("run_on holds the process back");
        for later in [
            "generate_context!",
            ".plugin(",
            "engine_switch::handed_over",
        ] {
            let at = lib[start..].find(later).expect(later);
            assert!(held < at, "{later} comes before the process is held back");
        }
    }

    #[test]
    fn only_a_top_level_window_is_held_back() {
        assert!(top_level(0x0000_0000, false));
        assert!(top_level(0x9000_0000, false), "a popup is top level");
        assert!(!top_level(CHILD, false));
        assert!(
            !top_level(0, true),
            "a window for messages is on no desktop"
        );
    }

    /// The numbers this file writes out are the system's own.
    #[cfg(windows)]
    #[test]
    fn the_styles_are_the_system_s() {
        use windows::Win32::UI::WindowsAndMessaging::{
            WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        assert_eq!(NO_ACTIVATE, WS_EX_NOACTIVATE.0);
        assert_eq!(TOOL_WINDOW, WS_EX_TOOLWINDOW.0);
        assert_eq!(APP_WINDOW, WS_EX_APPWINDOW.0);
        assert_eq!(CHILD, WS_CHILD.0);
    }

    /// A real window, made on a thread that holds windows back: made held back though it
    /// asked for a taskbar button, still held back after its style is written over the
    /// way tao and winit write it, and never activated when asked to be - where the same
    /// window on a thread that does not hold them is activated and keeps its button, so
    /// what refuses is this file and not the system. Hidden, off every screen, on threads
    /// of this test's own: activating a window of a thread that is not the one in front
    /// never changes which window is in front.
    #[cfg(windows)]
    #[test]
    fn a_real_window_is_held_back_and_never_activated() {
        let plain = std::thread::spawn(|| made_and_asked(false))
            .join()
            .expect("the plain thread");
        assert!(
            plain.activated,
            "the system refused by itself; the test proves nothing"
        );
        assert_eq!(plain.made & APP_WINDOW, APP_WINDOW);

        let held = std::thread::spawn(|| made_and_asked(true))
            .join()
            .expect("the held thread");
        for (when, style) in [("made", held.made), ("restyled", held.restyled)] {
            assert_eq!(
                style & (NO_ACTIVATE | TOOL_WINDOW),
                NO_ACTIVATE | TOOL_WINDOW,
                "{when}: can be activated or is in Alt+Tab"
            );
            assert_eq!(style & APP_WINDOW, 0, "{when}: has a taskbar button");
        }
        assert!(!held.activated, "activated");
    }

    /// What became of one window asking for a taskbar button: its extended style as it
    /// was made and after being written over, and whether asking activated it.
    #[cfg(windows)]
    struct Asked {
        made: u32,
        restyled: u32,
        activated: bool,
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "making, restyling and activating a real window")]
    fn made_and_asked(holding: bool) -> Asked {
        use windows::core::w;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetActiveWindow, SetActiveWindow};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowLongW, SetWindowLongW, GWL_EXSTYLE,
            WS_EX_APPWINDOW, WS_POPUP,
        };

        if holding {
            super::held::on_this_thread();
        }
        // Safe: a window of this thread's own, of a class the system always has, never
        // shown, and destroyed before this returns.
        unsafe {
            let window = CreateWindowExW(
                WS_EX_APPWINDOW,
                w!("STATIC"),
                w!("held back"),
                WS_POPUP,
                -32_000,
                -32_000,
                100,
                100,
                None,
                None,
                None,
                None,
            )
            .expect("a window");
            let style = || u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
            let made = style();
            SetWindowLongW(
                window,
                GWL_EXSTYLE,
                i32::from_ne_bytes(APP_WINDOW.to_ne_bytes()),
            );
            let restyled = style();
            let _ = SetActiveWindow(window);
            let activated = GetActiveWindow() == window;
            DestroyWindow(window).expect("destroyed");
            Asked {
                made,
                restyled,
                activated,
            }
        }
    }
}
