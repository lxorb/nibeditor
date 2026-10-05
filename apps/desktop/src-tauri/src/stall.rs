//! What nib was doing when it stopped answering, said in nib.log.
//!
//! Emil, 2026-10-04: *"nib still freezes pretty often."* A freeze on somebody else's
//! machine is a freeze nobody can fix unless the machine says what it was doing, so
//! the app watches its own window thread the way Windows does - a message sent to one
//! of its windows, and how long the answer takes - from a thread of its own, which a
//! stuck window thread cannot stop. Chrome's `HangWatcher` is the same idea; this is the
//! part of it a log needs.
//!
//! What lands in the log, and nothing else:
//!
//! ```text
//! WARN  stall: the window has not answered for 1 s (web_open)
//! WARN  stall: the window answered after 3.4 s (web_open)
//! WARN  stall: nib was not responding for 41 s when it was ended (web_open), since 2026-10-04T08:15:02.481Z
//! ERROR stall: the window's page stopped responding
//! ```
//!
//! The name in brackets is what the window's thread was running: the command the window
//! asked for, by its name in lib.rs, or one of the crate's own jobs that is known to be
//! long (`doing`). Never a path, an address or a note's words - a log somebody sends is
//! a log somebody reads. A stall of five seconds is written down on the disk as well, so
//! that when the process is ended in the middle of one - from the task manager, or by a
//! second launch (see handover.rs) - the next launch still says it happened.
//!
//! The page's own main thread is the window's business; see lib/stalls.ts.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::logs::say;

/// How long the window's thread may be away before it is a stall worth a line: a second,
/// past anything a person reads as the app merely being busy.
const STALL: Duration = Duration::from_secs(1);

/// How long a stall goes on before it is written down for the next launch: what Windows
/// waits before it calls a window "Not responding".
const HUNG: Duration = Duration::from_secs(5);

/// How often the watch asks, between stalls.
const LOOK: Duration = Duration::from_millis(500);

/// The file a long stall is written into, beside the log, and taken away when it ends.
const MARKER: &str = "not-responding.json";

/// What the window's thread is running now, innermost last: a command can wait in a
/// nested message loop while another is answered inside it.
static DOING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Says what the window's thread is running for as long as the guard lives.
pub struct Doing(());

/// Marks the window's thread as running `what` until the guard is dropped. A string and
/// a lock, which is cheap enough to wrap every command in.
pub fn doing(what: &str) -> Doing {
    if let Ok(mut held) = DOING.lock() {
        held.push(what.to_owned());
    }
    Doing(())
}

impl Drop for Doing {
    fn drop(&mut self) {
        if let Ok(mut held) = DOING.lock() {
            held.pop();
        }
    }
}

/// What the window's thread is running, innermost first and each inside the one after
/// it - `web_place: shown < web_open: building the page` is a placement answered inside a
/// build's own wait - or a word for nothing of the crate's: the engine's own work, a
/// layout, the system's.
fn now_doing() -> String {
    DOING
        .lock()
        .ok()
        .filter(|held| !held.is_empty())
        .map_or_else(
            || "nothing of nib's own".to_owned(),
            |held| held.iter().rev().cloned().collect::<Vec<_>>().join(" < "),
        )
}

/// Starts watching. Called from the window's own thread, once, after the window is up:
/// that thread is the one watched.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    let watched = Watched::this_thread(&app);
    let _ = std::thread::Builder::new()
        .name("nib stall watch".to_owned())
        .spawn(move || {
            if let Some(dir) = marker_dir(&app) {
                if let Some(said) = last_run(&dir.join(MARKER)) {
                    say(&app, "warn", &said);
                }
            }
            loop {
                std::thread::sleep(LOOK);
                watch_once(&app, &watched);
            }
        });
}

/// One look: nothing at all while the window answers within a second, and the stall's
/// two lines, with the marker between them, while it does not.
fn watch_once(app: &AppHandle, watched: &Watched) {
    let asked = Instant::now();
    let Answer::Late(how) = watched.answers(STALL) else {
        return;
    };

    let what = match how {
        Late::Stuck => now_doing(),
        Late::Nested => format!("{}, in a nested loop", now_doing()),
    };
    say(
        app,
        "warn",
        &format!("stall: the window has not answered for 1 s ({what})"),
    );

    let marker = marker_dir(app).map(|dir| dir.join(MARKER));
    let since = crate::clock::now().saturating_sub(millis(asked.elapsed()));
    let mut written = false;
    while matches!(watched.answers(STALL), Answer::Late(_)) {
        let held = asked.elapsed();
        // Written once it is a hang, and again with every second it goes on, so the next
        // launch knows how long it lasted if the process is ended in the middle of it.
        if held >= HUNG {
            if let Some(marker) = &marker {
                let _ = std::fs::write(marker, marked(since, held, &what));
            }
            written = true;
        }
    }

    say(
        app,
        "warn",
        &format!(
            "stall: the window answered after {} ({what})",
            seconds(asked.elapsed())
        ),
    );
    if written {
        if let Some(marker) = &marker {
            let _ = std::fs::remove_file(marker);
        }
    }
}

/// Where the marker goes: the log's own folder, made if it is not there.
fn marker_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::paths::log_dir(app).ok()
}

/// What a long stall leaves on the disk.
#[derive(serde::Serialize, serde::Deserialize)]
struct Marked {
    since: u64,
    held: u64,
    doing: String,
}

fn marked(since: u64, held: Duration, doing: &str) -> String {
    serde_json::to_string(&Marked {
        since,
        held: millis(held),
        doing: doing.to_owned(),
    })
    .unwrap_or_default()
}

/// The line about a run that ended in the middle of a stall, from what it left on the
/// disk, which is then taken away so it is said once.
fn last_run(marker: &Path) -> Option<String> {
    let text = std::fs::read_to_string(marker).ok()?;
    let _ = std::fs::remove_file(marker);
    let left: Marked = serde_json::from_str(&text).ok()?;
    Some(format!(
        "stall: nib was not responding for {} when it was ended ({}), since {}",
        seconds(Duration::from_millis(left.held)),
        left.doing,
        crate::clock::iso(left.since)
    ))
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

/// A span as a person reads it in a log: tenths of a second below a minute.
fn seconds(span: Duration) -> String {
    let tenths = span.as_millis() / 100;
    if tenths < 600 {
        format!("{}.{} s", tenths / 10, tenths % 10)
    } else {
        format!("{} s", tenths / 10)
    }
}

/// How the window's thread answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Answer {
    /// Within the time it was given.
    Answered,
    /// Not within it.
    Late(Late),
    /// Nothing there to ask: no window yet, or the app is going.
    Gone,
}

/// Which way the window's thread did not answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Late {
    /// It took no message at all: stuck in a call that does not come back. Only Windows
    /// has a message to send that tells this from the next.
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "only Windows can tell a stuck thread from a nested loop"
        )
    )]
    Stuck,
    /// It takes messages, so the window repaints, but from inside a loop of its own - a
    /// call waiting on another process with a message pump under it - and nothing the
    /// app's own loop has queued runs: no command is answered and no event reaches the
    /// page. To the person in front of it, the same freeze.
    Nested,
}

/// The thread being watched, and how it is asked: a task posted to the runtime's own
/// loop, which is what every command, event and page load the app has queued waits
/// behind; and on Windows first a message sent to one of the thread's windows, which is
/// what the system itself asks to decide a window is not responding, and which tells a
/// thread stuck outright from one waiting in a loop of its own.
struct Watched {
    app: AppHandle,
    #[cfg(windows)]
    thread: u32,
}

impl Watched {
    #[cfg_attr(
        windows,
        allow(unsafe_code, reason = "the thread's number is Win32's to say")
    )]
    fn this_thread(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            // Safe: no arguments.
            #[cfg(windows)]
            thread: unsafe { windows::Win32::System::Threading::GetCurrentThreadId() },
        }
    }

    fn answers(&self, within: Duration) -> Answer {
        let asked = Instant::now();
        #[cfg(windows)]
        match pumps(self.thread, within) {
            Answer::Answered => {}
            other => return other,
        }
        match self.looped(within.saturating_sub(asked.elapsed())) {
            Answer::Late(_) if self.held_by_the_person() => Answer::Answered,
            other => other,
        }
    }

    /// Whether the runtime's own loop runs a task posted to it within `within`.
    fn looped(&self, within: Duration) -> Answer {
        let (told, heard) = std::sync::mpsc::channel();
        if self
            .app
            .run_on_main_thread(move || {
                let _ = told.send(());
            })
            .is_err()
        {
            return Answer::Gone;
        }
        match heard.recv_timeout(within) {
            Ok(()) => Answer::Answered,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Answer::Late(Late::Nested),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Answer::Gone,
        }
    }

    /// Whether a loop of the system's own is running for somebody's hand: a window being
    /// dragged or sized, or a menu held open. The runtime's tasks wait through those as
    /// they should, and that is no freeze.
    #[cfg(windows)]
    #[allow(
        unsafe_code,
        reason = "a thread's state is asked through GetGUIThreadInfo"
    )]
    fn held_by_the_person(&self) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetGUIThreadInfo, GUITHREADINFO, GUI_INMENUMODE, GUI_INMOVESIZE, GUI_POPUPMENUMODE,
            GUI_SYSTEMMENUMODE,
        };
        let mut info = GUITHREADINFO {
            cbSize: u32::try_from(std::mem::size_of::<GUITHREADINFO>()).unwrap_or(0),
            ..Default::default()
        };
        // Safe: a structure this frame owns, its size said.
        if unsafe { GetGUIThreadInfo(self.thread, &raw mut info) }.is_err() {
            return false;
        }
        let held = GUI_INMOVESIZE.0 | GUI_INMENUMODE.0 | GUI_POPUPMENUMODE.0 | GUI_SYSTEMMENUMODE.0;
        info.flags.0 & held != 0
    }

    #[cfg(not(windows))]
    #[allow(
        clippy::unused_self,
        reason = "one signature on every system; only Windows can ask a thread whether a hand holds it"
    )]
    fn held_by_the_person(&self) -> bool {
        false
    }
}

/// Asks one of the thread's windows, found afresh each time without sending anything to
/// the thread: `EnumThreadWindows` reads the window manager's own list.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a window's thread is asked through SendMessageTimeout, which only the Win32 API has"
)]
fn pumps(thread: u32, within: Duration) -> Answer {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumThreadWindows, IsWindow, SendMessageTimeoutW, SMTO_NORMAL, WM_NULL,
    };

    unsafe extern "system" fn first_window_of_thread(window: HWND, found: LPARAM) -> BOOL {
        // Safe: `found` is the address of the `isize` below, alive for the call.
        unsafe { *(found.0 as *mut isize) = window.0 as isize };
        BOOL(0)
    }

    let mut found: isize = 0;
    // Safe: the callback writes one `isize` this frame owns.
    unsafe {
        let _ = EnumThreadWindows(
            thread,
            Some(first_window_of_thread),
            LPARAM(&raw mut found as isize),
        );
    }
    if found == 0 {
        return Answer::Gone;
    }
    let window = HWND(found as *mut core::ffi::c_void);
    let mut result = 0usize;
    let wait = u32::try_from(within.as_millis()).unwrap_or(u32::MAX);
    // Safe: a message with no arguments, sent to a window that may be gone, which
    // the call says by failing.
    let sent = unsafe {
        SendMessageTimeoutW(
            window,
            WM_NULL,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            wait,
            Some(&raw mut result),
        )
    };
    if sent.0 != 0 {
        Answer::Answered
    } else if unsafe { IsWindow(window) }.as_bool() {
        Answer::Late(Late::Stuck)
    } else {
        Answer::Gone
    }
}

/// Says in the log when the engine behind the window's own page stops answering or goes,
/// which from outside looks exactly like nib freezing: `WebView2`'s `ProcessFailed`,
/// whose "unresponsive" kind is raised after the page has not answered input for a few
/// seconds. The kind is all that is said.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a webview's processes are WebView2's own event, reached through its COM interfaces"
)]
pub fn watch_page(app: &AppHandle, webview: &tauri::Webview, whose: &'static str) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::ProcessFailedEventHandler;

    let app = app.clone();
    let _ = webview.with_webview(move |platform| {
        // Safe: the controller is this webview's, used on its own thread, and WebView2
        // holds the handler for as long as it can fire.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                let _ = args.ProcessFailedKind(&raw mut kind);
                let what = match kind {
                    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => {
                        "stopped responding"
                    }
                    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "ended",
                    COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => {
                        "lost its browser process"
                    }
                    COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "lost its GPU process",
                    _ => return Ok(()),
                };
                say(
                    &app,
                    "error",
                    &format!("stall: {whose} page {what} ({})", now_doing()),
                );
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ProcessFailed(&handler, &raw mut token);
        }
    });
}

/// Every other engine: nothing to listen to.
#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn watch_page(_app: &AppHandle, _webview: &tauri::Webview, _whose: &'static str) {}

#[cfg(test)]
mod tests {
    use super::{doing, last_run, marked, now_doing, seconds};
    use std::time::Duration;

    #[test]
    fn a_stall_is_said_in_tenths_below_a_minute() {
        assert_eq!(seconds(Duration::from_millis(1040)), "1.0 s");
        assert_eq!(seconds(Duration::from_millis(3460)), "3.4 s");
        assert_eq!(seconds(Duration::from_secs(41)), "41.0 s");
        assert_eq!(seconds(Duration::from_secs(75)), "75 s");
    }

    #[test]
    fn what_is_running_is_said_innermost_first_and_ends_with_its_guard() {
        let outer = doing("web_open");
        {
            let _inner = doing("web_place");
            assert_eq!(now_doing(), "web_place < web_open");
        }
        assert_eq!(now_doing(), "web_open");
        drop(outer);
        assert_eq!(now_doing(), "nothing of nib's own");
    }

    /// A run ended in the middle of a hang is said once by the next, and the file goes.
    #[test]
    fn a_hang_the_last_run_ended_in_is_said_once() {
        let dir = tempfile::tempdir().expect("a folder");
        let marker = dir.path().join("not-responding.json");
        std::fs::write(
            &marker,
            marked(1_791_065_463_685, Duration::from_secs(41), "web_open"),
        )
        .expect("written");

        assert_eq!(
            last_run(&marker).as_deref(),
            Some("stall: nib was not responding for 41.0 s when it was ended (web_open), since 2026-10-03T22:11:03.685Z")
        );
        assert!(!marker.exists());
        assert_eq!(last_run(&marker), None);
    }

    /// The thread that stops answering is caught by a watch on another, and lets go.
    #[cfg(windows)]
    #[test]
    #[allow(
        unsafe_code,
        reason = "a window of the test's own, made and pumped through Win32"
    )]
    fn a_thread_that_stops_pumping_is_late_and_answers_after() {
        use super::{pumps, Answer, Late};
        use std::sync::mpsc;
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, MSG, PM_REMOVE,
            WINDOW_EX_STYLE, WS_OVERLAPPED,
        };

        let (told, heard) = mpsc::channel();
        let (stop, stopping) = mpsc::channel::<()>();
        let (go, going) = mpsc::channel::<()>();
        let worker = std::thread::spawn(move || {
            // Safe: a hidden window of this thread, pumped and destroyed by it.
            let window = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("STATIC"),
                    w!(""),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("a window");
            // Safe: no arguments.
            told.send(unsafe { windows::Win32::System::Threading::GetCurrentThreadId() })
                .expect("told");
            let pump = || {
                let mut message = MSG::default();
                // Safe: this thread's own queue.
                while unsafe { PeekMessageW(&raw mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                    unsafe {
                        DispatchMessageW(&raw const message);
                    }
                }
            };
            // Answers until told to stop, then stops pumping until told to go on.
            while stopping.try_recv().is_err() {
                pump();
                std::thread::sleep(Duration::from_millis(5));
            }
            going.recv().expect("go");
            for _ in 0..100 {
                pump();
                std::thread::sleep(Duration::from_millis(5));
            }
            // Safe: this thread's own window.
            let _ = unsafe { DestroyWindow(window) };
        });
        let thread = heard.recv().expect("the worker");

        assert_eq!(pumps(thread, Duration::from_millis(500)), Answer::Answered);
        stop.send(()).expect("stop");
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(
            pumps(thread, Duration::from_millis(300)),
            Answer::Late(Late::Stuck)
        );
        go.send(()).expect("go");
        assert_eq!(pumps(thread, Duration::from_secs(2)), Answer::Answered);
        worker.join().expect("the worker");
    }
}
