//! The window's own edges: who draws the frame, and whether the desk shows through.
//!
//! Two choices, and both of them are about this machine rather than about the notes.
//! Nib draws its own frame by default - one bar holding the menu, the sidebar toggle,
//! the tabs and the window's three buttons, which is the shape the whole shell is built
//! round - and somebody who would rather have their system's titlebar can have it. The
//! second is the material: the window's ground becomes what the platform composites
//! behind it, which is Mica Alt on Windows 11, Acrylic on Windows 10 and a vibrancy view
//! on macOS. Nobody switches that on by itself any more; the glass theme wears it.
//!
//! Both are for every window the app draws itself but the presenter's: that one is
//! deliberately the system's, because a second screen showing a speaker's notes is not
//! a window anybody arranges.
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

/// A window built with nib's own frame, the way the first one is in tauri.conf.json.
///
/// Everywhere but a Mac that is no frame at all, and the bar draws the three buttons.
/// A Mac keeps its own traffic lights over the bar instead, the way VS Code and
/// Obsidian do there: the lights are the one part of a window a Mac user reaches for
/// without looking. Where they sit in the bar is lights.rs, once the window is built.
pub fn own_frame<R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'_, R, M>,
) -> tauri::WebviewWindowBuilder<'_, R, M> {
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    builder
}

/// Who draws the frame. `system` asks for the platform's titlebar and border; false is
/// nib's own, which is what every window starts as.
///
/// A Mac never loses its frame: nib's own is the system's titlebar made transparent
/// under the bar, with the traffic lights left where they are, and the system's is that
/// titlebar drawn above it.
#[tauri::command]
pub fn set_frame(app: AppHandle, system: bool) -> Result<(), String> {
    for window in ours(&app) {
        #[cfg(target_os = "macos")]
        let changed = window.set_title_bar_style(if system {
            tauri::TitleBarStyle::Visible
        } else {
            tauri::TitleBarStyle::Overlay
        });

        #[cfg(not(target_os = "macos"))]
        let changed = window.set_decorations(system);

        changed.map_err(|error| format!("the frame could not be changed: {error}"))?;

        #[cfg(target_os = "macos")]
        {
            crate::lights::refresh(&window);

            // Switching the titlebar lays the window's content out again, and AppKit
            // makes the window itself the first responder while it does: the page
            // lost the keyboard, and Escape, a shortcut or a letter went nowhere
            // until somebody clicked. The frame is switched from the page's own
            // settings, so the page is what gets it back.
            if let Some(page) = app.get_webview(window.label()) {
                crate::placement::keyboard_to(&page);
            }
        }
    }

    Ok(())
}

/// Whether this window's ground is the platform's own material, and which one it got.
///
/// Asked by the glass theme, which is the one look that wears it: a theme chosen in a
/// window is that window's, so only the window that asked is touched - a second window
/// still wearing glass must not lose its material to the first trying another look in
/// the theme picker. `dark` is the scheme the page is in, which is what the material is
/// tinted by on Windows; a Mac's is told the scheme by the page itself. `kind` is glass's
/// Material row - `mica-alt`, `mica`, `acrylic` or `clear` - and a platform without that
/// one gets the nearest it has.
///
/// Answers the material by name, which the page writes on its root so the theme can
/// know what it is standing on; see glass.css in @nib/themes. An error where there is
/// nothing to turn on, which the theme answers by standing on a colour of its own.
/// Turning it off never fails: a window with no material to clear is a window with no
/// material.
#[tauri::command]
pub fn set_translucency(
    window: Window,
    on: bool,
    dark: bool,
    kind: Option<String>,
) -> Result<&'static str, String> {
    if window.label() == PRESENTER {
        return Err("the presenter's window keeps the system's own".to_string());
    }

    if !on {
        material::clear(&window);
        return Ok("");
    }

    without_colour(&window);
    material::apply(&window, Some(dark), Kind::of(kind.as_deref()))
}

/// The material a window wears from its first frame, for a launch whose page last stood
/// on it: without it the window is on screen with nothing behind the page at all until
/// the page has started and asked, and what shows in that third of a second is the desk
/// itself. The scheme is the system's until the page says otherwise, a moment later, and
/// the material is the one the reader last chose. See `see_through` in ground.rs, which
/// is what says the page stood on it.
pub fn wear_from_the_start(window: &Window) {
    without_colour(window);
    let kind = crate::ground::material(window.app_handle());
    let _ = material::apply(window, None, Kind::of(kind.as_deref()));
}

/// Which material glass asks for. Mica Alt is the one Windows 11 asks of an app whose
/// tabs are in its title bar, and where nothing is said that is what is meant.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    MicaAlt,
    Mica,
    Acrylic,
    /// The desk itself, unblurred: a transparent window with no backdrop at all.
    Clear,
}

impl Kind {
    pub fn of(said: Option<&str>) -> Self {
        match said {
            Some("mica") => Self::Mica,
            Some("acrylic") => Self::Acrylic,
            Some("clear") => Self::Clear,
            _ => Self::MicaAlt,
        }
    }
}

/// The colour the window opened on goes first. A launch that had a ground remembered
/// painted it on the window's own layer so that the window could be on screen before
/// there was anything in it, and a material composited behind an opaque window is a
/// material nobody can see. Both layers, because the colour was set on both: the
/// window's is what the platform draws behind, and the webview's is what shows wherever
/// the page is transparent - which, with the material on, is everywhere. See ground.rs.
fn without_colour(window: &Window) {
    let _ = window.set_background_color(None);
    if let Some(view) = window.app_handle().get_webview_window(window.label()) {
        let _ = view.set_background_color(None);
    }
}

/// What each platform composites behind a window, through the one crate that knows how
/// to ask for it. Tauri's own `set_effects` wraps the same crate and picks the first
/// effect it is handed rather than the first the platform supports, which is the whole
/// question on Windows.
#[cfg(target_os = "windows")]
mod material {
    use super::Kind;
    use tauri::Window;
    use window_vibrancy::{
        apply_acrylic, apply_mica, apply_tabbed, clear_acrylic, clear_mica, clear_tabbed,
    };

    pub fn apply(window: &Window, dark: Option<bool>, kind: Kind) -> Result<&'static str, String> {
        // Whatever was there first: a change of material is never two at once.
        clear(window);

        // The desk itself: nothing composited behind a window that is transparent
        // already, which Windows 11 draws unblurred (Windows Terminal's opacity with
        // acrylic off). The page lays its own wash over it.
        if kind == Kind::Clear {
            return Ok("clear");
        }

        // Mica Alt is Mica with the desk's colour taken further, the backdrop Terminal
        // and Edge stand on; plain Mica is what the first Windows 11 has. Both are
        // opaque and keep their brightness whatever the wallpaper is, which is what lets
        // the chrome show them; see glass.css. Acrylic for Windows 10, which has
        // neither, and for a reader who asks for the blurred desk.
        if kind == Kind::MicaAlt && apply_tabbed(window, dark).is_ok() {
            return Ok("mica");
        }
        if kind != Kind::Acrylic && apply_mica(window, dark).is_ok() {
            return Ok("mica");
        }

        apply_acrylic(window, None)
            .map(|()| "acrylic")
            .map_err(|error| format!("this window cannot be made translucent: {error}"))
    }

    pub fn clear(window: &Window) {
        let _ = clear_tabbed(window);
        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
    }
}

#[cfg(target_os = "macos")]
mod material {
    use super::Kind;
    use tauri::Window;
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

    pub fn apply(
        window: &Window,
        _dark: Option<bool>,
        _kind: Kind,
    ) -> Result<&'static str, String> {
        // The material a window's own background is, rather than a sidebar's or a
        // menu's: this is the ground the whole app sits on. Its scheme is the window's
        // appearance, which the page sets; see `paintWindow` in theme.svelte.ts.
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .map(|()| "vibrancy")
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
    use super::Kind;
    use tauri::Window;

    pub fn apply(
        _window: &Window,
        _dark: Option<bool>,
        _kind: Kind,
    ) -> Result<&'static str, String> {
        Err("this platform has no translucency to turn on".to_string())
    }

    pub fn clear(_window: &Window) {}
}

#[cfg(test)]
mod tests {
    use super::Kind;

    /// Each word glass's Material row says is its material, and anything else - nothing
    /// said, an older page that says nothing, a word from somewhere else - is Mica Alt.
    #[test]
    fn a_material_is_what_the_row_says_and_mica_alt_otherwise() {
        assert_eq!(Kind::of(Some("mica-alt")), Kind::MicaAlt);
        assert_eq!(Kind::of(Some("mica")), Kind::Mica);
        assert_eq!(Kind::of(Some("acrylic")), Kind::Acrylic);
        assert_eq!(Kind::of(Some("clear")), Kind::Clear);
        assert_eq!(Kind::of(None), Kind::MicaAlt);
        assert_eq!(Kind::of(Some("blur")), Kind::MicaAlt);
    }
}
