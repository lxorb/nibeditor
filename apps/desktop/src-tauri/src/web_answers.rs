//! Whether the browser behind a web tab's page answers, asked before the window's
//! thread waits on it.
//!
//! Every web tab of a store is drawn by one `WebView2` browser process, and showing a
//! page is a call into that process which the window's thread waits on: the controller's
//! own wait, with a message loop under it. Measured 2026-10-04 with the browser process
//! held still from outside (the probe suspends its threads, which is what a busy chat
//! site does to it for seconds at a time): a press on a web tab sat in `web_place`
//! for as long as the browser did - fifty seconds - and for all of it the window repainted
//! but nothing the app had queued ran: no command answered, no event reached the page,
//! no note saved. That is the freeze. See stall.rs, which is how it was found.
//!
//! So the page's own window is asked first, the way Windows decides a window is not
//! responding: a message sent to it and waited for a moment. A browser that does not
//! answer is not asked to show a page; the call is refused with `NOT_ANSWERING`, the pane
//! keeps what it shows, and the window asks again shortly (see `place` in
//! web-tab/pages.svelte.ts). The rest of the app goes on.

/// What a refused call says, which the window reads to ask again later rather than to
/// conclude the page has gone; see web-tab/pages.svelte.ts.
pub const NOT_ANSWERING: &str = "that page is not answering";

/// Says in the log that a page was not shown because its browser did not answer: once
/// a minute at most, since the window asks again every second while it does not.
pub fn said(app: &tauri::AppHandle) {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let Ok(mut last) = LAST.lock() else { return };
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return;
    }
    *last = Some(Instant::now());
    crate::logs::say(
        app,
        "warn",
        "stall: a web page's browser is not answering; the page waits rather than the window",
    );
}

/// Whether the browser drawing this page answers within a moment. A page whose window is
/// not there yet, or an engine with no such window, answers.
#[cfg(all(windows, not(feature = "cef")))]
///
/// Called on the window's own thread, where `with_webview` runs at once rather than
/// later, so the answer is in by the time it returns.
pub fn answers(view: &tauri::Webview) -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let answered = Arc::new(AtomicBool::new(true));
    let telling = answered.clone();
    let _ = view.with_webview(move |platform| {
        // The window the controller was given, and the browser process drawing this page:
        // that process's own window under it is the one asked, since every page in the
        // window - the app's own among them - has one there.
        let mut held = windows_com::Win32::Foundation::HWND::default();
        let mut browser = 0u32;
        // Safe: the controller is this live webview's and is asked on its own thread.
        #[allow(
            unsafe_code,
            reason = "the controller and its page are WebView2's COM interfaces"
        )]
        let named = unsafe {
            let controller = platform.controller();
            controller.ParentWindow(&raw mut held).is_ok()
                && controller
                    .CoreWebView2()
                    .is_ok_and(|core| core.BrowserProcessId(&raw mut browser).is_ok())
        };
        if named && browser != 0 {
            telling.store(engine::answers(held.0 as isize, browser), Ordering::SeqCst);
        }
    });
    answered.load(Ordering::SeqCst)
}

/// Every other engine draws its pages in this process, or answers on its own thread.
#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn answers(_view: &tauri::Webview) -> bool {
    true
}

/// Takes a page whose browser does not answer out of sight without asking that browser
/// anything: the window wry holds the page in is this process's own, and it is moved
/// out of the window's room, the way wry places it - asynchronously, so not even the
/// system waits on the browser's window inside it. Hiding that window was tried first and
/// waited on the browser all the same: the system tells a window being hidden, child
/// windows of another process included. The next placement once the browser answers
/// puts it back where its pane is.
#[cfg(all(windows, not(feature = "cef")))]
pub fn put_away(view: &tauri::Webview) {
    let _ = view.with_webview(|platform| {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        };

        /// Far outside any window's room.
        const AWAY: i32 = -100_000;

        let mut held = windows_com::Win32::Foundation::HWND::default();
        // Safe: the controller is this live webview's, asked on its own thread; the window
        // it names is wry's, made on this thread, and is only moved.
        #[allow(
            unsafe_code,
            reason = "the holder is named by WebView2's COM interface and moved through Win32"
        )]
        unsafe {
            if platform.controller().ParentWindow(&raw mut held).is_ok() {
                let _ = SetWindowPos(
                    windows::Win32::Foundation::HWND(held.0),
                    None,
                    AWAY,
                    AWAY,
                    0,
                    0,
                    SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                );
            }
        }
    });
}

#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn put_away(_view: &tauri::Webview) {}

/// Closes a page whose browser did not answer once it does, asking every second; a
/// browser that never comes back keeps a page out of sight until the app quits.
pub fn close_when_answering(app: &tauri::AppHandle, label: String) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let (told, heard) = std::sync::mpsc::channel();
        let asking = app.clone();
        let named = label.clone();
        let posted = app.run_on_main_thread(move || {
            use tauri::Manager as _;
            let done = match asking.get_webview(&named) {
                None => true,
                Some(view) if answers(&view) => {
                    let _ = view.close();
                    true
                }
                Some(_) => false,
            };
            let _ = told.send(done);
        });
        if posted.is_err() || heard.recv().unwrap_or(true) {
            return;
        }
    });
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetWindowThreadProcessId, IsWindow, SendMessageTimeoutW,
        SMTO_ABORTIFHUNG, SMTO_BLOCK, SMTO_ERRORONEXIT, WM_NULL,
    };

    /// How long the browser has to answer. Long enough for a browser that is merely busy
    /// drawing; short enough that a frozen one costs the window's thread a blink - and
    /// nothing at all once Windows has called it hung, which `SMTO_ABORTIFHUNG` asks.
    /// `SMTO_BLOCK`, because a thread waiting without it answers whatever is sent to it
    /// meanwhile, and one of those started a wait of its own on the same browser: the
    /// question meant to keep the window out of a wait was measured holding it for
    /// twenty-six seconds.
    const MOMENT: u32 = 150;

    /// What the walk looks for, and what it found.
    struct Looking {
        browser: u32,
        found: isize,
    }

    /// Whether the first window under `holder` that belongs to `browser` - the process
    /// drawing the page - takes a message within a moment.
    #[allow(
        unsafe_code,
        reason = "a window of another process is found and asked through Win32"
    )]
    pub fn answers(holder: isize, browser: u32) -> bool {
        unsafe extern "system" fn of_the_browser(window: HWND, looking: LPARAM) -> BOOL {
            // Safe: `looking` is the address of the `Looking` below, alive for the walk.
            let looking = unsafe { &mut *(looking.0 as *mut Looking) };
            let mut process = 0u32;
            // Safe: a number this frame owns; the window is the one being enumerated.
            unsafe { GetWindowThreadProcessId(window, Some(&raw mut process)) };
            if process == looking.browser {
                looking.found = window.0 as isize;
                return BOOL(0);
            }
            BOOL(1)
        }

        let mut looking = Looking { browser, found: 0 };
        // Safe: the callback writes into one `Looking` this frame owns.
        unsafe {
            let _ = EnumChildWindows(
                HWND(holder as *mut core::ffi::c_void),
                Some(of_the_browser),
                LPARAM(&raw mut looking as isize),
            );
        }
        let found = looking.found;
        if found == 0 {
            return true;
        }
        let mut result = 0usize;
        // Safe: a message with no arguments to a window that may be gone, which the call
        // says by failing.
        let sent = unsafe {
            SendMessageTimeoutW(
                HWND(found as *mut core::ffi::c_void),
                WM_NULL,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG | SMTO_BLOCK | SMTO_ERRORONEXIT,
                MOMENT,
                Some(&raw mut result),
            )
        };
        // A browser that has gone answers nothing either, and is no reason to wait: the
        // call is let through to fail as a page that has gone does.
        sent.0 != 0 || !unsafe { IsWindow(HWND(found as *mut core::ffi::c_void)) }.as_bool()
    }
}
