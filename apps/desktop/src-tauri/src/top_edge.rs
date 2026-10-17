//! The window's top edge, which offers to resize the window only where it can.
//!
//! nib draws its own frame on Windows, and Tauri gives a frameless window back its top
//! edge with a strip a few pixels tall laid over the page - `TAURI_DRAG_RESIZE_WINDOW`,
//! in tauri-runtime-wry's `undecorated_resizing.rs` - while the other three edges are the
//! system's own, outside the window, under its shadow. Every pointer over that strip
//! wears the double arrow. Tauri takes the strip away as a window is maximised, but only
//! on the resize that maximises it, and a window that opens maximised - which is how nib
//! reopens a window that was left maximised, see placement.rs - was maximised before its
//! webview, and the strip, were made. So the strip stayed along the top of the screen,
//! over the tabs, and a pointer flung up to them got a resize arrow on a window that
//! cannot be resized (Emil, 2026-10-13). Full screen kept it too, where it answered
//! nothing and only took the clicks meant for the page.
//!
//! So the strip is there exactly while the window can be resized from its top: not
//! maximised, not minimised, and with a sizing frame, which full screen takes off. It
//! is decided as the window is made and again on every change of its size or its
//! style. The thin outer border and nothing more, and none at all on a window filling
//! the screen, is what Chrome, Edge and VS Code show.
//!
//! A Mac keeps the system's frame (appearance.rs), and on Linux the frameless window's
//! edges are tao's, which already show no arrow on a maximised or full screen window.

use tauri::{Runtime, Window};

/// Whether a window can be resized from its top edge: shown in its own size, neither
/// filling the screen nor in the taskbar, and with the frame a window is resized by.
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "only a Windows window has the strip this decides")
)]
fn resizes_from_top(maximized: bool, minimized: bool, sizing_frame: bool) -> bool {
    sizing_frame && !maximized && !minimized
}

/// Keeps this window's top edge honest from now on; see the top of this file. Once per
/// window, after it is built, and again after its frame is changed, which makes the
/// strip anew.
pub fn mind<R: Runtime>(window: &Window<R>) {
    #[cfg(windows)]
    strip::mind(window);
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
mod strip {
    use tauri::{Runtime, Window};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, GetWindowLongW, IsIconic, IsZoomed, ShowWindow, GWL_STYLE, SW_HIDE,
        SW_SHOWNA, WM_NCDESTROY, WM_SIZE, WM_STYLECHANGED, WS_THICKFRAME, WS_VISIBLE,
    };

    /// This file's mark among the window's subclasses: tao, wry and Tauri's strip keep
    /// theirs there too.
    const OURS: usize = 0x746f_7065;

    /// Follows the window's own messages, on the window's own thread, which is the only
    /// one a subclass can be set from. Setting it twice only sets it again.
    #[allow(
        unsafe_code,
        reason = "a window's size and style are heard through a Win32 subclass, which only the Win32 API installs"
    )]
    pub fn mind<R: Runtime>(window: &Window<R>) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || {
            let window = HWND(hwnd as *mut core::ffi::c_void);
            // Safe: a window of this thread, and a procedure that lives for the program;
            // it takes itself off as the window goes.
            unsafe {
                let _ = SetWindowSubclass(window, Some(listened), OURS, 0);
            }
            matched(window);
        });
    }

    /// Every message goes on to the window first - Tauri's own strip is sized there on
    /// `WM_SIZE` - and the strip is shown or hidden after.
    #[allow(
        unsafe_code,
        reason = "a subclass procedure is called by Windows with the window's own message"
    )]
    unsafe extern "system" fn listened(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        // Safe: handing the message on is what a subclass owes the window.
        let answer = unsafe { DefSubclassProc(window, message, wparam, lparam) };
        match message {
            WM_SIZE | WM_STYLECHANGED => matched(window),
            WM_NCDESTROY => {
                // Safe: this subclass, taken off its own window as the window goes.
                let _ = unsafe { RemoveWindowSubclass(window, Some(listened), OURS) };
            }
            _ => {}
        }
        answer
    }

    /// Shows the window's strip where its top resizes it and hides it everywhere else.
    /// A window without one - a framed window, one that is not resizable - is left be.
    #[allow(
        unsafe_code,
        reason = "the strip is a Win32 child window that Tauri hands out no handle to"
    )]
    fn matched(window: HWND) {
        // Safe: questions about a live window of this thread, and its child of the same
        // thread shown or hidden without being activated.
        unsafe {
            let Ok(strip) = FindWindowExW(
                window,
                HWND::default(),
                w!("TAURI_DRAG_RESIZE_BORDERS"),
                w!("TAURI_DRAG_RESIZE_WINDOW"),
            ) else {
                return;
            };
            let style = |of| u32::from_ne_bytes(GetWindowLongW(of, GWL_STYLE).to_ne_bytes());
            let wanted = super::resizes_from_top(
                IsZoomed(window).as_bool(),
                IsIconic(window).as_bool(),
                style(window) & WS_THICKFRAME.0 != 0,
            );
            // Its own flag rather than whether it can be seen: a window still being
            // built is hidden, and so is everything in it, whatever it will show.
            if (style(strip) & WS_VISIBLE.0 != 0) != wanted {
                let _ = ShowWindow(strip, if wanted { SW_SHOWNA } else { SW_HIDE });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resizes_from_top;

    #[test]
    fn a_window_in_its_own_size_resizes_from_its_top() {
        assert!(resizes_from_top(false, false, true));
    }

    #[test]
    fn a_maximised_window_does_not() {
        assert!(!resizes_from_top(true, false, true));
    }

    #[test]
    fn a_full_screen_window_has_no_frame_to_resize_by() {
        assert!(!resizes_from_top(false, false, false));
    }

    #[test]
    fn a_minimised_window_does_not() {
        assert!(!resizes_from_top(false, true, true));
        assert!(!resizes_from_top(true, true, true));
    }
}
