//! The window's full screen, asked for by the app (F11, a deck, a video's own button)
//! and by nothing else: the window's page has no other way to it, since the window
//! plugin's own call is not granted (capabilities/default.json).
//!
//! Through here so that a run sent off the screen stays off it. A window put full
//! screen covers a monitor, wherever it was before - a probe's window at -32000 would
//! have been put over the reader's screen in front of their work - so under
//! `NIB_OFF_SCREEN` the window is left where it is and only what was asked is kept,
//! which is what a drive reads back to check it (`window_is_fullscreen`); see
//! placement.rs.
//!
//! And so that the crate knows which windows the app has put full screen: Escape that a
//! web tab's page let go by gives the screen back only there, and is left alone
//! everywhere else; see `web_opens.rs`.

use std::sync::{Mutex, PoisonError};

/// The windows the app has put full screen, by label.
static FULL: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// What full screen is asked of a window, written down: `on` for the window `label`.
/// Answers whether the window itself should be asked as well, which it never is off the
/// screen.
fn noted(label: &str, on: bool, away: bool) -> bool {
    let mut full = FULL.lock().unwrap_or_else(PoisonError::into_inner);
    full.retain(|one| one != label);
    if on {
        full.push(label.to_owned());
    }
    !away
}

/// Whether the app has put the window `label` full screen.
pub fn is_on(label: &str) -> bool {
    FULL.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .any(|one| one == label)
}

/// Puts the window asking full screen, or back. Off the window's own thread, which the
/// window is then asked from as any other thread asks it.
#[tauri::command(async)]
pub fn window_fullscreen(window: tauri::Window, on: bool) -> Result<(), String> {
    if !noted(window.label(), on, away()) {
        return Ok(());
    }
    window
        .set_fullscreen(on)
        .map_err(|error| format!("could not change full screen: {error}"))
}

/// Whether the window asking is full screen: as the system says, or, off the screen,
/// as it was asked to be.
#[tauri::command(async)]
pub fn window_is_fullscreen(window: tauri::Window) -> bool {
    if away() {
        return is_on(window.label());
    }
    window.is_fullscreen().unwrap_or(false)
}

/// Whether this run's windows were sent off the screen.
fn away() -> bool {
    crate::placement::asked_away()
}

/// What full screen is asked of a window off the screen, for another module's test.
#[cfg(test)]
pub fn noted_for_test(label: &str, on: bool) {
    noted(label, on, true);
}

#[cfg(test)]
mod tests {
    use super::{is_on, noted, FULL};

    #[test]
    fn a_window_off_the_screen_is_never_asked_and_still_says_what_it_was_asked() {
        assert!(!noted("probe-1", true, true));
        assert!(is_on("probe-1"));
        assert!(!noted("probe-1", false, true));
        assert!(!is_on("probe-1"));
    }

    #[test]
    fn a_window_on_the_screen_is_asked_and_remembered_once() {
        assert!(noted("main-test", true, false));
        assert!(noted("main-test", true, false));
        let held = FULL
            .lock()
            .map(|full| full.iter().filter(|one| *one == "main-test").count());
        assert_eq!(held.ok(), Some(1));

        assert!(noted("other-test", true, false));
        assert!(noted("main-test", false, false));
        assert!(!is_on("main-test"));
        assert!(is_on("other-test"));
        noted("other-test", false, false);
    }
}
