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
//! - **No top-level window of the process is ever on a screen, whichever thread made
//!   it.** Not only the app's own: a window Chromium makes for itself, on a thread of its
//!   own, asks nobody where to go. On 2026-10-03 a probe started with an extension that
//!   would not load raised Chromium's "Load error" message box - a native dialog with no
//!   parent, centred on the primary screen - and it stood there until the watch ended
//!   the probe, twice. So the process hooks the making of every window on every one of
//!   its threads (an in-context event hook, which runs on the thread that made the window
//!   before it can be shown), and every top-level window is held off every screen from
//!   then on: any move or show that would put a pixel of it on a screen is sent to the
//!   corner a minimised window is parked in instead, before it happens. A dialog that
//!   centres itself, a menu, a tooltip and a window put back where it was all go there.
//!   nib's own Chromium's other processes - the GPU's, a utility's - hold theirs the same
//!   way (`hold_helper`); its switches keep the dialogs it can be talked out of from being
//!   raised at all (see src-tauri/cef).
//!
//! And the app's own ways of asking for the keyboard do nothing under the switch; see
//! `raised` and `keyboard_to` in placement.rs. A drive that types into a probe does it
//! through the `DevTools` protocol or with messages to the probe's own window, and neither
//! needs the foreground (docs/conventions.md, "Probes").

// The styles and the two rules over them are Windows' alone, and tested everywhere: the
// rules are numbers, and a Mac or Linux runner holds them as well as a Windows one does.

/// `WS_EX_NOACTIVATE`: never activated by a click or by the system choosing a window.
#[cfg(any(windows, test))]
const NO_ACTIVATE: u32 = 0x0800_0000;
/// `WS_EX_TOOLWINDOW`: not in Alt+Tab, and no taskbar button.
#[cfg(any(windows, test))]
const TOOL_WINDOW: u32 = 0x0000_0080;
/// `WS_EX_APPWINDOW`: a taskbar button whatever else the style says.
#[cfg(any(windows, test))]
const APP_WINDOW: u32 = 0x0004_0000;
/// `WS_CHILD`: a window inside another, which is activated only with it.
#[cfg(any(windows, test))]
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
        held::on_every_thread(0);
        return locked;
    }
    false
}

/// Holds every window of one of nib's own Chromium's other processes off the screen,
/// where the run is a probe's: what `hold` does for the app's windows, for the windows a
/// GPU process or a utility makes. Called first thing in such a process. A renderer is
/// never asked: it makes no window, and a sandbox may refuse it the window manager.
pub fn hold_helper() {
    #[cfg(windows)]
    if crate::placement::asked_away() {
        held::on_every_thread(0);
    }
}

/// The corner a probe's window is held in: where Windows parks a minimised window, well
/// past any desk of monitors. The system clamps it nearer, and nearer is still past them.
#[cfg(any(windows, test))]
const PARKED: i32 = -32_000;

/// Where a top-level window going to `to` is let go: there, unless any of it would be on a
/// screen, and the parked corner if so.
#[cfg(any(windows, test))]
fn kept_off(to: (i32, i32), on_a_screen: bool) -> (i32, i32) {
    if on_a_screen {
        (PARKED, PARKED)
    } else {
        to
    }
}

/// The extended style a probe's top-level window is held to, from the one it asked for.
#[cfg(any(windows, test))]
fn kept_back(asked: u32) -> u32 {
    (asked | NO_ACTIVATE | TOOL_WINDOW) & !APP_WINDOW
}

/// Whether a window about to be made is one the system could activate: a top-level
/// window. A child is activated with its parent, and a window for messages alone is on
/// no desktop.
#[cfg(any(windows, test))]
fn top_level(style: u32, for_messages: bool) -> bool {
    style & CHILD == 0 && !for_messages
}

#[cfg(windows)]
mod held {
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONULL};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetDesktopWindow, GetWindowLongW, GetWindowRect,
        LockSetForegroundWindow, SetWindowLongW, SetWindowPos, SetWindowsHookExW, CBT_CREATEWNDW,
        CHILDID_SELF, EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, GA_PARENT, GWL_EXSTYLE,
        HCBT_ACTIVATE, HCBT_CREATEWND, HHOOK, HWND_MESSAGE, LSFW_LOCK, OBJID_WINDOW, STYLESTRUCT,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WH_CBT, WINDOWPOS, WINDOW_EX_STYLE,
        WINEVENT_INCONTEXT, WM_NCCREATE, WM_NCDESTROY, WM_STYLECHANGING, WM_WINDOWPOSCHANGING,
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

    /// Every top-level window any thread of this process makes from now on - or the one
    /// thread named, where `thread` is not 0 - is held back and off every screen: an event
    /// hook told of each window as it is made, on the thread that made it and before that
    /// thread can show it, which is where a window's own procedure can be put in front of
    /// the rest. For the process's whole life, unless the caller unhooks what it is handed.
    #[allow(unsafe_code, reason = "setting an event hook is a Win32 call")]
    pub fn on_every_thread(thread: u32) -> Option<HWINEVENTHOOK> {
        // Safe: an in-context hook on this process alone, whose procedure is in this very
        // module, which is never unloaded; and no pointers of ours.
        unsafe {
            let module = GetModuleHandleW(None).ok()?;
            let hook = SetWinEventHook(
                EVENT_OBJECT_CREATE,
                EVENT_OBJECT_SHOW,
                module,
                Some(made),
                GetCurrentProcessId(),
                thread,
                WINEVENT_INCONTEXT,
            );
            (!hook.is_invalid()).then_some(hook)
        }
    }

    /// A window of this process made, gone or shown. Made or shown, a top-level one is
    /// held: back, and off every screen.
    #[allow(
        unsafe_code,
        reason = "an event hook is a callback the system calls with a window it names"
    )]
    unsafe extern "system" fn made(
        _hook: HWINEVENTHOOK,
        event: u32,
        window: HWND,
        object: i32,
        child: i32,
        _thread: u32,
        _time: u32,
    ) {
        let itself = object == OBJID_WINDOW.0 && u32::try_from(child) == Ok(CHILDID_SELF);
        if !itself || !(event == EVENT_OBJECT_CREATE || event == EVENT_OBJECT_SHOW) {
            return;
        }
        if !top_level_now(window) {
            return;
        }
        // Safe: a window of this process, alive as its own event is told. A subclass is
        // only ever set from the window's own thread, which is where an in-context event
        // runs, and is refused, harmlessly, from anywhere else.
        unsafe {
            let _ = SetWindowSubclass(window, Some(holding), SUBCLASS, 0);
            let now = u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
            let _ = SetWindowLongW(
                window,
                GWL_EXSTYLE,
                i32::from_ne_bytes(super::kept_back(now).to_ne_bytes()),
            );
        }
        let mut now = RECT::default();
        // Safe: the window above, and a rectangle of this frame's own to write.
        if unsafe { GetWindowRect(window, &raw mut now) }.is_err() {
            return;
        }
        let to = super::kept_off((now.left, now.top), on_a_screen(&now));
        if to != (now.left, now.top) {
            // Safe: the window above, moved and nothing else.
            let _ = unsafe {
                SetWindowPos(
                    window,
                    HWND::default(),
                    to.0,
                    to.1,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                )
            };
        }
    }

    /// Whether a window is one of its own on the desktop now - not inside another, and
    /// not one kept for messages alone - which is what may be on a screen.
    #[allow(unsafe_code, reason = "asking a window's parent is a Win32 call")]
    fn top_level_now(window: HWND) -> bool {
        // Safe: no pointers; a window gone has no parent to answer.
        unsafe { GetAncestor(window, GA_PARENT) == GetDesktopWindow() }
    }

    /// Whether any pixel of a rectangle, in the pixels the asking thread reads, is on any
    /// screen.
    #[allow(
        unsafe_code,
        reason = "asking which screen a rectangle is on is a Win32 call"
    )]
    fn on_a_screen(rectangle: &RECT) -> bool {
        if rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top {
            return false;
        }
        // Safe: a rectangle of the caller's, read and not kept.
        !unsafe { MonitorFromRect(rectangle, MONITOR_DEFAULTTONULL) }.is_invalid()
    }

    /// A move, a resize or a show about to happen to a held window, changed before it
    /// happens so that none of the window lands on a screen.
    #[allow(unsafe_code, reason = "reading where a window is now is a Win32 call")]
    fn kept_away(window: HWND, going: &mut WINDOWPOS) {
        if !top_level_now(window) {
            return;
        }
        let mut now = RECT::default();
        // Safe: the window whose own procedure is running, and a rectangle of this frame's.
        if unsafe { GetWindowRect(window, &raw mut now) }.is_err() {
            return;
        }
        let (left, top) = if going.flags.contains(SWP_NOMOVE) {
            (now.left, now.top)
        } else {
            (going.x, going.y)
        };
        let (width, height) = if going.flags.contains(SWP_NOSIZE) {
            (now.right - now.left, now.bottom - now.top)
        } else {
            (going.cx, going.cy)
        };
        let lands = RECT {
            left,
            top,
            right: left.saturating_add(width),
            bottom: top.saturating_add(height),
        };
        let to = super::kept_off((left, top), on_a_screen(&lands));
        if to != (left, top) {
            (going.x, going.y) = to;
            going.flags &= !SWP_NOMOVE;
        }
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
                            // Born off every screen, rather than moved off one once made.
                            making.x = super::PARKED;
                            making.y = super::PARKED;
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
    /// is made and kept on every change anybody makes to it afterwards, and every move
    /// that would put it on a screen sent off them instead.
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
        if message == WM_WINDOWPOSCHANGING {
            // Safe: for `WM_WINDOWPOSCHANGING` the system passes where the window is about
            // to go, ours to change before it goes there.
            if let Some(going) = unsafe { (lparam.0 as *mut WINDOWPOS).as_mut() } {
                kept_away(window, going);
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
    use super::{
        kept_back, kept_off, top_level, APP_WINDOW, CHILD, NO_ACTIVATE, PARKED, TOOL_WINDOW,
    };

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
    fn a_window_that_would_be_on_a_screen_is_parked_and_any_other_left_alone() {
        assert_eq!(kept_off((100, 200), true), (PARKED, PARKED));
        assert_eq!(kept_off((-5000, 40), false), (-5000, 40));
        assert_eq!(kept_off((PARKED, PARKED), false), (PARKED, PARKED));
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

    /// A real native dialog with no parent - the kind Chromium raised on 2026-10-03 - made
    /// on a thread other than the one that set the hook: the system centres it on the
    /// primary screen, and on a thread that is held it is never on any screen, neither as
    /// it is shown nor when it is moved back onto one from outside. On a desktop of the
    /// test's own, which no screen ever shows, so the run without the hook - the proof
    /// that the system would have put it there - is in front of nobody either.
    #[cfg(windows)]
    #[test]
    fn a_dialog_any_thread_raises_is_never_on_a_screen() {
        let plain = a_message_box_watched(false);
        assert!(plain.seen, "the plain dialog never appeared");
        assert!(
            plain.on_a_screen,
            "the system kept the dialog off the screens by itself; the test proves nothing"
        );

        let held = a_message_box_watched(true);
        assert!(held.seen, "the held dialog never appeared");
        assert!(!held.on_a_screen, "the held dialog was on a screen");
    }

    /// What a watch saw of one message box: whether it was there at all, and whether any
    /// of it was ever on a screen.
    #[cfg(windows)]
    struct Watched {
        seen: bool,
        on_a_screen: bool,
    }

    /// A parentless message box raised on a desktop of the test's own, by a thread that is
    /// held where `holding` says so, and watched from outside until it is closed: moved
    /// back where the system would centre it, from another thread, as it first shows.
    #[cfg(windows)]
    #[allow(
        unsafe_code,
        reason = "a message box, a move and a close are Win32 calls"
    )]
    fn a_message_box_watched(holding: bool) -> Watched {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        use windows::core::w;
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::System::StationsAndDesktops::{CloseDesktop, HDESK};
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::Accessibility::UnhookWinEvent;
        use windows::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, PostMessageW, SetWindowPos, MB_OK, SWP_NOACTIVATE, SWP_NOSIZE,
            SWP_NOZORDER, WM_CLOSE,
        };

        let desktop = own_desktop(holding);
        let (told, thread) = mpsc::channel();
        let (go, going) = mpsc::channel::<()>();
        let maker = on_desktop(desktop, move || {
            // Safe: no pointers.
            told.send(unsafe { GetCurrentThreadId() }).expect("told");
            going.recv().expect("go");
            // Safe: a box with no parent, closed by the watch below.
            unsafe {
                MessageBoxW(
                    None,
                    w!("An extension could not be loaded."),
                    w!("Load error"),
                    MB_OK,
                );
            }
        });
        let raising = thread.recv().expect("the maker's thread");
        // An event hook hears the desktop of the thread that set it, so the hook is set
        // from a thread on the test's desktop too, which keeps it until the watch is done.
        let (hooked, hearing) = mpsc::channel();
        let (done, ending) = mpsc::channel::<()>();
        let hooking = on_desktop(desktop, move || {
            let hook = holding.then(|| super::held::on_every_thread(raising).expect("the hook"));
            hooked.send(()).expect("hooked");
            ending.recv().expect("done");
            if let Some(hook) = hook {
                // Safe: the hook set above, let go once.
                let _ = unsafe { UnhookWinEvent(hook) };
            }
        });
        hearing.recv().expect("hooked");
        go.send(()).expect("go");

        let mut watched = Watched {
            seen: false,
            on_a_screen: false,
        };
        let mut first: Option<Instant> = None;
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until && !maker.is_finished() {
            for (window, on_a_screen) in shown(desktop, raising) {
                let window = HWND(window as _);
                watched.seen = true;
                watched.on_a_screen |= on_a_screen;
                let since = *first.get_or_insert_with(|| {
                    // Put back where the system would centre it, from outside its thread.
                    // Safe: the dialog, moved and nothing else.
                    let _ = unsafe {
                        SetWindowPos(
                            window,
                            HWND::default(),
                            100,
                            100,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                    };
                    Instant::now()
                });
                if since.elapsed() > Duration::from_millis(400) {
                    // Safe: asks the dialog to close, as its own close button does.
                    let _ = unsafe { PostMessageW(window, WM_CLOSE, WPARAM(0), LPARAM(0)) };
                }
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        maker.join().expect("the maker");
        done.send(()).expect("done");
        hooking.join().expect("the hooker");
        // Safe: the desktop made for this run, closed once nothing is on it.
        let _ = unsafe { CloseDesktop(HDESK(desktop as _)) };
        watched
    }

    /// A desktop of the test's own, as a number a thread can be handed: no screen ever
    /// shows it, so whatever a thread on it shows is in front of nobody.
    #[cfg(windows)]
    #[allow(unsafe_code, reason = "making a desktop is a Win32 call")]
    fn own_desktop(which: bool) -> isize {
        use windows::core::PCWSTR;
        use windows::Win32::System::StationsAndDesktops::{CreateDesktopW, DESKTOP_CONTROL_FLAGS};

        /// `GENERIC_ALL`, for a desktop the test made and closes itself.
        const EVERYTHING: u32 = 0x1000_0000;

        let name: Vec<u16> = format!(
            "nib-foreground-test-{}-{}",
            std::process::id(),
            u8::from(which)
        )
        .encode_utf16()
        .chain([0])
        .collect();
        // Safe: a name that outlives the call; the desktop is the caller's to close.
        let desktop = unsafe {
            CreateDesktopW(
                PCWSTR(name.as_ptr()),
                None,
                None,
                DESKTOP_CONTROL_FLAGS(0),
                EVERYTHING,
                None,
            )
        }
        .expect("a desktop of the test's own");
        desktop.0 as isize
    }

    /// Runs `work` on a new thread on that desktop, before the thread has a window.
    #[cfg(windows)]
    #[allow(unsafe_code, reason = "moving a thread to a desktop is a Win32 call")]
    fn on_desktop(
        desktop: isize,
        work: impl FnOnce() + Send + 'static,
    ) -> std::thread::JoinHandle<()> {
        use windows::Win32::System::StationsAndDesktops::{SetThreadDesktop, HDESK};

        std::thread::spawn(move || {
            // Safe: a thread with no window and no hook yet.
            unsafe { SetThreadDesktop(HDESK(desktop as _)) }.expect("on the test's desktop");
            work();
        })
    }

    /// The visible windows one thread has on that desktop, each with whether any of it is
    /// on a screen.
    #[cfg(windows)]
    #[allow(unsafe_code, reason = "listing a desktop's windows is a Win32 call")]
    fn shown(desktop: isize, thread: u32) -> Vec<(isize, bool)> {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
        use windows::Win32::Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONULL};
        use windows::Win32::System::StationsAndDesktops::{EnumDesktopWindows, HDESK};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        };

        unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
            // Safe: `found` is the vector below, alive for the whole enumeration.
            unsafe { (*(found.0 as *mut Vec<isize>)).push(window.0 as isize) };
            BOOL(1)
        }

        let mut found: Vec<isize> = Vec::new();
        // Safe: the desktop, and the vector the callback writes into, both alive until
        // this returns.
        let _ = unsafe {
            EnumDesktopWindows(
                HDESK(desktop as _),
                Some(each),
                LPARAM(&raw mut found as isize),
            )
        };
        found
            .into_iter()
            .filter_map(|one| {
                let window = HWND(one as _);
                // Safe: windows the system just listed, asked and not kept.
                unsafe {
                    if GetWindowThreadProcessId(window, None) != thread
                        || !IsWindowVisible(window).as_bool()
                    {
                        return None;
                    }
                    let mut place = RECT::default();
                    GetWindowRect(window, &raw mut place).ok()?;
                    let on = !MonitorFromRect(&raw const place, MONITOR_DEFAULTTONULL).is_invalid();
                    Some((one, on))
                }
            })
            .collect()
    }
}
