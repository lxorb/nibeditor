//! The window's own edges: who draws the frame, and whether the desk shows through.
//!
//! Two choices, and both of them are about this machine rather than about the notes.
//! Nib draws its own frame by default - one bar holding the menu, the sidebar toggle,
//! the tabs and the window's three buttons, which is the shape the whole shell is built
//! round - and somebody who would rather have their system's titlebar can have it. The
//! second is translucency: the window's ground becomes the material the platform
//! composites behind it, which is Mica on Windows 11, Acrylic on Windows 10 and a
//! vibrancy view on macOS.
//!
//! Applied to every window the app draws itself, which is all of them but the
//! presenter's: that one is deliberately the system's, because a second screen showing a
//! speaker's notes is not a window anybody arranges.
//!
//! `get_window` rather than `get_webview_window`, for the reason `web_tabs.rs` gives at
//! length: a window holding a web tab has two webviews in it, and the webview-window
//! lookup answers nothing for a window like that.

use tauri::{AppHandle, Manager, Window};

/// The presenter's window, which keeps the system's frame and no material: see
/// `slides/presenter.ts`.
const PRESENTER: &str = "nib-presenter";

/// Every window whose edges are the app's own.
fn ours(app: &AppHandle) -> Vec<Window> {
    app.windows()
        .into_values()
        .filter(|window| window.label() != PRESENTER)
        .collect()
}

/// Who draws the frame. `system` asks for the platform's titlebar and border; false is
/// nib's own, which is what every window starts as.
#[tauri::command]
pub fn set_frame(app: AppHandle, system: bool) -> Result<(), String> {
    for window in ours(&app) {
        window
            .set_decorations(system)
            .map_err(|error| format!("the frame could not be changed: {error}"))?;
    }

    Ok(())
}

/// Whether the window's ground is the platform's own material.
///
/// Answers an error the pane can show rather than failing quietly: a reader who turns
/// this on on a platform that has nothing to turn on has asked a question and deserves
/// the answer. Turning it off never fails - a window with no material to clear is a
/// window with no material.
#[tauri::command]
pub fn set_translucency(app: AppHandle, on: bool) -> Result<(), String> {
    let mut trouble: Option<String> = None;

    for window in ours(&app) {
        if on {
            if let Err(reason) = material::apply(&window) {
                trouble = Some(reason);
            }
        } else {
            material::clear(&window);
        }
    }

    match trouble {
        Some(reason) => Err(reason),
        None => Ok(()),
    }
}

/// What each platform composites behind a window, through the one crate that knows how
/// to ask for it. Tauri's own `set_effects` wraps the same crate and picks the first
/// effect it is handed rather than the first the platform supports, which is the whole
/// question on Windows: Mica is Windows 11's and Acrylic is what Windows 10 has.
#[cfg(target_os = "windows")]
mod material {
    use tauri::Window;
    use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};

    pub fn apply(window: &Window) -> Result<(), String> {
        // Mica first, which is the one Windows 11 draws and the one that costs nothing:
        // it is the desktop's own wallpaper, blurred by the compositor that was drawing
        // it anyway. Acrylic behind it for Windows 10, where Mica does not exist.
        if apply_mica(window, None).is_ok() {
            return Ok(());
        }

        apply_acrylic(window, None)
            .map_err(|error| format!("this window cannot be made translucent: {error}"))
    }

    pub fn clear(window: &Window) {
        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
    }
}

#[cfg(target_os = "macos")]
mod material {
    use tauri::Window;
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

    pub fn apply(window: &Window) -> Result<(), String> {
        // The material a window's own background is, rather than a sidebar's or a
        // menu's: this is the ground the whole app sits on.
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .map_err(|error| format!("this window cannot be made translucent: {error}"))
    }

    pub fn clear(window: &Window) {
        let _ = clear_vibrancy(window);
    }
}

/// Linux has no one answer: a compositor may blur behind a window, and the two desktops
/// most people are on disagree about how to ask. So the window stays as it is and the
/// pane says so, which is better than a switch that does nothing.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod material {
    use tauri::Window;

    pub fn apply(_window: &Window) -> Result<(), String> {
        Err("this platform has no translucency to turn on".to_string())
    }

    pub fn clear(_window: &Window) {}
}
