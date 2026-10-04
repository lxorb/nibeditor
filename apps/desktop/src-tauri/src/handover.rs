//! A second launch, when the nib already running does not answer.
//!
//! A second launch belongs to the window already open: the single instance plugin finds
//! the first instance's hidden window and hands it the launch's arguments with
//! `SendMessage`, which waits until the first instance's window thread takes the message,
//! for ever if that thread is stuck. So a nib that froze took every launch after it down
//! with it: each one sat invisible, waiting, and the reader clicked again. Emil's log of
//! 2026-10-03 has five launches in twenty-five seconds.
//!
//! So the hand-over is made here first, before the plugin, the same message in the same
//! shape, but with `SendMessageTimeout`: answered within two seconds, it is the plugin's
//! hand-over exactly and this launch ends. Not answered, this launch asks the one
//! question Firefox asks in the same place (the running one is not responding; end it?)
//! and, told yes, ends that process, found through the plugin's own window so it can
//! only ever be nib under this identifier, waits for it to go, and carries on as the
//! first launch. Told no, it leaves the frozen one alone and goes. If the frozen one
//! comes back while the question is up, the question goes and the launch is handed over
//! as it would have been.
//!
//! Starting fresh beside the frozen one is not an option: two instances would write the
//! same notes, and the new one's webview would join the frozen one's browser process,
//! which is what froze the launches before.
//!
//! A probe never shows the question - nobody is there to answer it - and takes its
//! answer from `NIB_PROBE_NOT_RESPONDING` instead: `end`, `leave`, or `wait`, which waits
//! as the open question does for the frozen one to answer.

/// What the first instance answered, when there was one.
#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Found {
    /// No nib is running under this identifier: this is the first launch.
    Nothing,
    /// It took the launch's arguments.
    Handed,
    /// It did not answer in time.
    Silent,
}

/// What to do about a nib that does not answer.
#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Asked {
    /// End it, and carry on as the first launch.
    End,
    /// Leave it and go.
    Leave,
    /// It answered after all: hand over as usual.
    Answered,
}

/// The process this launch ended, so the log can say so once the log is there.
static ENDED: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

/// Hands this launch to the nib already running, and answers whether this process
/// should now go. Called before anything of the app is built.
#[cfg(windows)]
pub fn handed_over(identifier: &str) -> bool {
    // A relaunch waits for the app it replaces to go, rather than handing itself to it.
    if crate::engine_switch::relaunching() {
        return false;
    }
    let names = Names::of(identifier);
    let launch = arguments();
    match handed(&names, &launch, ANSWER) {
        Found::Nothing => false,
        Found::Handed => true,
        Found::Silent => match asked(&names, &launch) {
            Asked::Answered | Asked::Leave => true,
            Asked::End => {
                if let Some(pid) = names.owner() {
                    if ended(pid) {
                        let _ = ENDED.set(pid);
                    }
                }
                false
            }
        },
    }
}

/// Elsewhere the plugin talks over a socket that does not wait on a window thread.
#[cfg(not(windows))]
pub fn handed_over(_identifier: &str) -> bool {
    false
}

/// Says in the log what the launch did about a frozen nib, now that there is a log.
pub fn said(app: &tauri::AppHandle) {
    if let Some(pid) = ENDED.get() {
        crate::logs::say(
            app,
            "warn",
            &format!(
                "stall: a launch ended the nib before it, which was not responding (pid {pid})"
            ),
        );
    }
}

/// How long the running nib has to take the launch before it is asked about.
#[cfg(windows)]
const ANSWER: std::time::Duration = std::time::Duration::from_secs(2);

/// What the plugin calls its window and the mark its message carries; see
/// tauri-plugin-single-instance's `platform_impl/windows.rs`, whose message this is.
#[cfg(windows)]
const MARK: usize = 1542;

/// The single instance plugin's names for this identifier.
#[cfg(windows)]
struct Names {
    class: Vec<u16>,
    window: Vec<u16>,
}

#[cfg(windows)]
impl Names {
    fn of(identifier: &str) -> Self {
        let wide = |text: String| text.encode_utf16().chain(std::iter::once(0)).collect();
        Self {
            class: wide(format!("{identifier}-sic")),
            window: wide(format!("{identifier}-siw")),
        }
    }

    /// The running nib's hand-over window, if one is open.
    #[allow(unsafe_code, reason = "a window is found through FindWindowW")]
    fn find(&self) -> Option<windows::Win32::Foundation::HWND> {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
        // Safe: two strings that end in a nought and outlive the call.
        unsafe { FindWindowW(PCWSTR(self.class.as_ptr()), PCWSTR(self.window.as_ptr())) }
            .ok()
            .filter(|window| !window.is_invalid())
    }

    /// The process that window belongs to: nib, under this identifier, and nothing else.
    #[allow(
        unsafe_code,
        reason = "a window's process is asked through GetWindowThreadProcessId"
    )]
    fn owner(&self) -> Option<u32> {
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let window = self.find()?;
        let mut pid = 0u32;
        // Safe: a number this frame owns.
        unsafe { GetWindowThreadProcessId(window, Some(&raw mut pid)) };
        (pid != 0 && pid != std::process::id()).then_some(pid)
    }
}

/// The launch as the plugin hands it over: the folder it was started in, then every
/// argument, joined by `|` and ended with a nought.
#[cfg(windows)]
fn arguments() -> Vec<u8> {
    let folder = std::env::current_dir().unwrap_or_default();
    let args = std::env::args().collect::<Vec<String>>().join("|");
    format!("{}|{args}\0", folder.to_str().unwrap_or_default()).into_bytes()
}

/// Sends the launch to the running nib, waiting `within` at most.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the hand-over is a WM_COPYDATA message, which only Win32 sends"
)]
fn handed(names: &Names, launch: &[u8], within: std::time::Duration) -> Found {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COPYDATA,
    };

    let Some(window) = names.find() else {
        return Found::Nothing;
    };
    let data = COPYDATASTRUCT {
        dwData: MARK,
        cbData: u32::try_from(launch.len()).unwrap_or(u32::MAX),
        lpData: launch.as_ptr().cast_mut().cast(),
    };
    let mut result = 0usize;
    // Safe: the structure and the bytes it points at outlive the call, which copies them
    // into the other process before it returns.
    let sent = unsafe {
        SendMessageTimeoutW(
            window,
            WM_COPYDATA,
            WPARAM(0),
            LPARAM(std::ptr::from_ref(&data) as isize),
            SMTO_ABORTIFHUNG,
            u32::try_from(within.as_millis()).unwrap_or(u32::MAX),
            Some(&raw mut result),
        )
    };
    if sent.0 != 0 {
        Found::Handed
    } else {
        Found::Silent
    }
}

/// Asks whether to end the nib that does not answer, and goes on trying it while the
/// question is up: an answer from it closes the question and the launch is handed over.
#[cfg(windows)]
#[allow(unsafe_code, reason = "the question is a Win32 message box")]
fn asked(names: &Names, launch: &[u8]) -> Asked {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use windows::core::w;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, PostThreadMessageW, IDCANCEL, IDOK, MB_ICONWARNING, MB_OKCANCEL,
        MB_SETFOREGROUND, WM_QUIT,
    };

    // Safe: no arguments.
    let asking = Arc::new(AtomicU32::new(unsafe { GetCurrentThreadId() }));
    let answered = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let trying = {
        let (asking, answered, done) = (asking.clone(), answered.clone(), done.clone());
        let launch = launch.to_vec();
        let names = Names {
            class: names.class.clone(),
            window: names.window.clone(),
        };
        std::thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                if handed(&names, &launch, std::time::Duration::from_millis(500)) != Found::Silent {
                    answered.store(true, Ordering::SeqCst);
                    // The message box runs its own loop on the asking thread, and a quit
                    // posted there ends it as if it were closed.
                    // Safe: a message with no arguments to a thread of this process.
                    let _ = unsafe {
                        PostThreadMessageW(
                            asking.load(Ordering::SeqCst),
                            WM_QUIT,
                            WPARAM(0),
                            LPARAM(0),
                        )
                    };
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })
    };

    // A probe is answered from its environment, and nobody is shown anything; `wait`
    // waits as the question would for the frozen one to answer. See the top of the file.
    let chosen = if crate::placement::asked_away() {
        match std::env::var("NIB_PROBE_NOT_RESPONDING").as_deref() {
            Ok("end") => IDOK,
            Ok("wait") => {
                let until = std::time::Instant::now() + std::time::Duration::from_secs(20);
                while !answered.load(Ordering::SeqCst) && std::time::Instant::now() < until {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                IDCANCEL
            }
            _ => IDCANCEL,
        }
    } else {
        // Safe: two strings the macro ends with a nought, and no owner. A quit posted to
        // this thread by the watch above ends it as a close would.
        unsafe {
            MessageBoxW(
                None,
                w!("nib is not responding.\n\nEnd it and open nib again?"),
                w!("nib"),
                MB_OKCANCEL | MB_ICONWARNING | MB_SETFOREGROUND,
            )
        }
    };
    done.store(true, Ordering::SeqCst);
    let _ = trying.join();

    if answered.load(Ordering::SeqCst) {
        Asked::Answered
    } else if chosen == IDOK {
        Asked::End
    } else {
        Asked::Leave
    }
}

/// Ends the frozen nib and waits for it to have gone, with everything it held: the
/// single instance lock, the engine lock and the webview's profile. Answers whether it
/// went.
#[cfg(windows)]
#[allow(unsafe_code, reason = "a process is ended through TerminateProcess")]
fn ended(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    /// How long it is given to go.
    const GOING: u32 = 10_000;

    // Safe: a handle of this function's own, closed before it returns.
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) else {
            return false;
        };
        let _ = TerminateProcess(process, 1);
        let gone = WaitForSingleObject(process, GOING) == WAIT_OBJECT_0;
        let _ = CloseHandle(process);
        gone
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{arguments, handed, Found, Names};
    use std::time::Duration;

    /// No nib under an identifier nobody uses: this launch is the first.
    #[test]
    fn nothing_running_is_nothing_to_hand_to() {
        let names = Names::of("ch.emilvinu.nib.test.nobody-runs-this");
        assert_eq!(
            handed(&names, &arguments(), Duration::from_millis(50)),
            Found::Nothing
        );
        assert_eq!(names.owner(), None);
    }

    /// The bytes are the plugin's own shape, which its window reads by splitting on `|`.
    #[test]
    fn the_launch_is_the_folder_then_the_arguments() {
        let launch = String::from_utf8(arguments()).expect("text");
        assert!(launch.ends_with('\0'));
        let mut parts = launch.trim_end_matches('\0').split('|');
        let folder = parts.next().expect("the folder");
        assert_eq!(
            folder,
            std::env::current_dir()
                .expect("a folder")
                .to_str()
                .expect("text")
        );
        assert!(
            parts.next().is_some(),
            "the program itself is the first argument"
        );
    }
}
