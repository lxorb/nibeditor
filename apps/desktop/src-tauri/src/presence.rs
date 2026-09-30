//! Whether somebody is at this computer, and what the computer is called: the two things
//! a device says about itself to its account's hub (docs/sync-v2.md section 6.2).
//!
//! **Somebody is at it** while a key was pressed or the pointer moved in nib in the last
//! five minutes. The app's own page hears its own input, and nothing else: a key typed
//! into a web page, or the pointer moving over one, goes to the page's own webview, which
//! is another process's window, and the app's page never hears of it. So the system is
//! asked instead - when it last had any input at all, and whether one of nib's windows is
//! the one in front - which together say that the input was nib's. Where the system cannot
//! be asked the window's own page is what the app goes on.
//!
//! **What it is called** is the name a person gave the machine, where the system keeps
//! one worth showing: a Mac's computer name (Emil's laptop, say). A Windows or Linux
//! host name is `DESKTOP-4F2K9L` far more often than it is anything a person chose, so
//! there the app says the platform instead, the way a caret does (`rooms/who.ts`), and
//! the name can be changed on the account.

use serde::Serialize;

/// What the system says about its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    /// How long ago the last key or pointer input was, anywhere on the machine.
    pub idle_ms: u64,
    /// Whether one of this process's windows is the one in front.
    pub front: bool,
}

/// When the system last had input and whether nib is in front, or nothing where the
/// system has no way to say.
#[tauri::command(async)]
pub fn input_idle() -> Option<Input> {
    platform::system_input()
}

/// The name a person gave this computer, where the system keeps one worth showing.
#[tauri::command(async)]
pub fn device_name() -> Option<String> {
    platform::computer_name().and_then(|name| shown(&name))
}

/// The longest name a device is announced with; the account keeps sixty characters of a
/// person's name, and a computer's is no longer worth.
const LONGEST: usize = 60;

/// A name as it is announced: trimmed, one line, and not too long to read.
fn shown(name: &str) -> Option<String> {
    let one_line: String = name
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let trimmed = one_line.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(
        trimmed
            .chars()
            .take(LONGEST)
            .collect::<String>()
            .trim_end()
            .to_owned(),
    )
}

#[cfg(windows)]
mod platform {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    use super::Input;

    pub fn system_input() -> Option<Input> {
        let mut last = LASTINPUTINFO {
            cbSize: u32::try_from(std::mem::size_of::<LASTINPUTINFO>()).ok()?,
            dwTime: 0,
        };
        let mut process = 0u32;

        // SAFETY: `last` is a LASTINPUTINFO with its size filled in, which is all the
        // first call reads, and `process` is a number the last one writes; both live for
        // the calls. The tick count and the window in front take nothing, and a window
        // handle the system has just given out is what the last call is asked about.
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask Windows when it last had input, or which window is in front"
        )]
        let (read, now) = unsafe {
            let read = GetLastInputInfo(&raw mut last).as_bool();
            let front = GetForegroundWindow();
            if !front.is_invalid() {
                GetWindowThreadProcessId(front, Some(&raw mut process));
            }
            (read, GetTickCount())
        };
        if !read {
            return None;
        }

        Some(Input {
            idle_ms: u64::from(now.wrapping_sub(last.dwTime)),
            front: process != 0 && process == std::process::id(),
        })
    }

    /// A Windows machine's name is its host name, which a person has rarely chosen.
    pub fn computer_name() -> Option<String> {
        None
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::NSRunningApplication;

    use super::Input;

    /// `kCGEventSourceStateCombinedSessionState`: every source of input in the session.
    const COMBINED: i32 = 0;
    /// `kCGAnyInputEventType`: any kind of event.
    const ANY_INPUT: u32 = !0;

    #[allow(
        unsafe_code,
        reason = "CoreGraphics' idle time has no binding in the crates this app uses"
    )]
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
    }

    pub fn system_input() -> Option<Input> {
        // SAFETY: two plain values in and a number out; the call reads no memory of ours.
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask macOS when it last had input"
        )]
        let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED, ANY_INPUT) };
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a finite, non-negative number of seconds, as milliseconds"
        )]
        let idle_ms = (seconds * 1000.0) as u64;

        Some(Input {
            idle_ms,
            front: NSRunningApplication::currentApplication().isActive(),
        })
    }

    /// The computer name from Sharing in System Settings.
    pub fn computer_name() -> Option<String> {
        let out = std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::Input;

    /// Linux has no one answer: X11 and every Wayland compositor keep their own.
    pub fn system_input() -> Option<Input> {
        None
    }

    pub fn computer_name() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::shown;

    /// A name is one trimmed line of a readable length, and an empty one is none.
    #[test]
    fn a_name_is_one_readable_line() {
        assert_eq!(shown("  Emil's laptop\n").as_deref(), Some("Emil's laptop"));
        assert_eq!(shown("a\tb").as_deref(), Some("a b"));
        assert_eq!(shown("   "), None);
        assert_eq!(shown(&"x".repeat(200)).map(|one| one.len()), Some(60));
    }

    /// The system answers here, whatever it answers: a number and a flag, never a panic.
    #[test]
    fn the_system_is_asked_without_trouble() {
        let _ = super::input_idle();
    }
}
