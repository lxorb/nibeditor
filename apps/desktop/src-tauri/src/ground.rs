//! The colour the window opens on, so that it can open before there is anything in
//! it.
//!
//! A window described in `tauri.conf.json` is built by the runtime before any of our
//! own code runs, and it is built around its webview: nothing is on screen until the
//! webview runtime has started. On Windows that was measured at 323 of the 778
//! milliseconds a launch of a five thousand note space takes - a third of the wait,
//! with the screen empty for all of it and this process using no processor at all.
//! So `ready` in lib.rs builds the window itself instead, and shows it at once.
//!
//! Which needs a colour, and the colour is the whole difficulty. A window has to open
//! on *this* reader's ground: the side of the theme they chose, a colour out of a
//! theme file they installed, or - with translucency on - no colour whatsoever, so
//! that the platform's own material shows through. None of that can be known before
//! the page that knows it has been read, so it is remembered instead: the window
//! writes down what it was standing on, and the next launch stands on that.
//!
//! Two readers of one value. This file is the crate's, for the native window; the
//! other is three lines inline in index.html, for the page - written from
//! `src/lib/ground.ts`, which keeps both. The page's copy is in local storage because
//! it is read before any module exists; this one is a file because the crate cannot
//! read local storage.
//!
//! Cosmetic by construction. A machine with nothing remembered - the first launch of
//! all - and a reader whose ground is the platform's material rather than a colour
//! both get the window exactly as it always came: built hidden, shown once there is
//! something in it. That is right rather than merely cautious. A solid rectangle in
//! the wrong colour, or an opaque one where somebody chose to see their wallpaper, is
//! worse than a moment more of nothing.

use std::path::PathBuf;
use tauri::utils::config::Color;
use tauri::AppHandle;

use crate::paths::{config_dir, made, write_atomically};

/// What the file is called. Beside the themes and the history rather than in the log
/// folder: it is something the app keeps about itself, not something it reports.
const FILE: &str = "ground.txt";

/// Anything longer than this is not a colour and is not read. A `rgba()` with four
/// numbers in it is under thirty characters.
const MOST: usize = 64;

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

/// What the window is standing on, as the window itself resolved it.
///
/// One string, written whenever it changes, which is a theme being chosen or
/// translucency being switched. The value is whatever `getComputedStyle` gives for the
/// page's background - `rgb(14, 16, 19)`, or `rgba(0, 0, 0, 0)` for a window with the
/// material showing through - so no colour arithmetic happens on either side of this:
/// the browser resolves it and the crate reads back what the browser said.
#[tauri::command(async)]
pub fn remember_ground(app: AppHandle, colour: String) -> Result<(), String> {
    if colour.len() > MOST {
        return Err("that is not a colour".into());
    }

    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        made(parent)?;
    }

    write_atomically(&path, colour.as_bytes())
}

/// The colour the next window may open on, or nothing.
///
/// Nothing for every case that is not a colour to paint: no file yet, a file that is
/// not one, and - deliberately - any colour that is not fully opaque. A ground with
/// alpha in it is a reader who asked to see the material behind their window, and
/// painting it on the window layer is exactly what would hide that.
pub fn remembered(app: &AppHandle) -> Option<Color> {
    let said = std::fs::read_to_string(file(app).ok()?).ok()?;
    colour_of(said.trim())
}

/// `rgb(14, 16, 19)` or `rgba(14, 16, 19, 1)`, as a browser writes a resolved colour.
///
/// Nothing for anything else, which includes `transparent`, `rgba(…, 0)` and every
/// half-written file: the caller's answer to nothing is the window it has always
/// built, so a value this cannot read costs a launch its head start and never
/// anything else.
fn colour_of(said: &str) -> Option<Color> {
    let inside = said
        .strip_prefix("rgba(")
        .or_else(|| said.strip_prefix("rgb("))?
        .strip_suffix(')')?;

    let mut parts = inside.split(',').map(str::trim);
    let red = parts.next()?.parse::<u8>().ok()?;
    let green = parts.next()?.parse::<u8>().ok()?;
    let blue = parts.next()?.parse::<u8>().ok()?;

    // The fourth is optional and, when it is there, has to be 1: a browser writes the
    // alpha as a decimal fraction, and anything under one is a window somebody wants to
    // see through.
    match parts.next() {
        None => {}
        Some(alpha) if alpha.parse::<f32>().is_ok_and(|one| one >= 1.0) => {}
        Some(_) => return None,
    }

    if parts.next().is_some() {
        return None;
    }

    Some(Color(red, green, blue, 255))
}

#[cfg(test)]
mod tests {
    use super::colour_of;
    use tauri::utils::config::Color;

    #[test]
    fn a_resolved_colour_is_the_colour_it_says() {
        assert_eq!(colour_of("rgb(14, 16, 19)"), Some(Color(14, 16, 19, 255)));
        assert_eq!(
            colour_of("rgb(251,252,253)"),
            Some(Color(251, 252, 253, 255))
        );
        assert_eq!(
            colour_of("rgba(14, 16, 19, 1)"),
            Some(Color(14, 16, 19, 255))
        );
    }

    /// The one case that matters most: a reader who chose to see the material behind
    /// their window must not get a solid rectangle painted over it for a third of a
    /// second. Both spellings a browser uses for it.
    #[test]
    fn a_ground_somebody_can_see_through_is_no_ground_to_paint() {
        assert_eq!(colour_of("rgba(0, 0, 0, 0)"), None);
        assert_eq!(colour_of("rgba(14, 16, 19, 0.5)"), None);
        assert_eq!(colour_of("transparent"), None);
    }

    /// And anything else at all, because the file is on a disk and disks keep halves
    /// of things. Every one of these is a launch that opens the way it always did.
    #[test]
    fn nothing_that_is_not_a_colour_is_read_as_one() {
        for said in [
            "",
            "rgb(",
            "rgb(14, 16)",
            "rgb(14, 16, 19",
            "rgb(14, 16, 19, 1, 1)",
            "rgb(300, 16, 19)",
            "rgb(-1, 16, 19)",
            "#0e1013",
            "var(--bg)",
            "rgb(a, b, c)",
        ] {
            assert_eq!(colour_of(said), None, "{said}");
        }
    }
}
