//! What of a web tab's page the app's own layers are drawn over, cut out of the page
//! rather than the page hidden for them.
//!
//! A page is a native webview, and a native webview draws above every pixel of the
//! window's own HTML: nothing of the app's can be drawn over it. So everything the app put
//! over a page - a menu, a tab's hover card, a site's popover under the bar - used to hide
//! the whole page and show a still picture of it in its place. Emil, 2026-10-03: *"While a
//! toast shows or while hovering things, the website is sometimes invisible until he
//! stops."* A page with no picture yet, or one whose picture had just been thrown away
//! because the page changed size, went blank for as long as the card was up; and every
//! page in the window stepped back for a card that was over one of them.
//!
//! Chrome draws its menus and hover cards over the page and the page goes on being the
//! page. The nearest a window of webviews gets to that is a window region: the shape the
//! page's window is allowed to draw in, which is the page less the rectangles of the
//! app's layers over it - each with its own rounded corners. The layer is then the
//! window's own HTML showing through the page where the layer is, and everywhere else the
//! page is live, scrolling and playing, never hidden and so never blank when the layer
//! goes. Measured with scripts/web-smooth-probe.py.
//!
//! A layer that dims the whole window - a sheet over its scrim - still covers all of the
//! page, and that is a cut too: an empty region. The page is out of sight without being
//! hidden, so the engine keeps its frame and the page is back the moment the sheet goes,
//! with nothing to repaint.
//!
//! The system engine on Windows only. Elsewhere `CUTS` is false, and the window answers a
//! layer over a page the way it always has: the still picture, and the page hidden.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde::Deserialize;
use tauri::Webview;

/// One of the app's layers over a page, in the page's own coordinates.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Hollow {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// The layer's own corner, so what shows through is its shape and no more.
    #[serde(default)]
    pub radius: f64,
}

/// What of a page the app's layers are over: all of it, or these.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Cut {
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub hollows: Vec<Hollow>,
}

/// A rounded rectangle in the page's window, in whole pixels of the screen: left, top,
/// right, bottom and the corner's diameter.
pub type Piece = (i32, i32, i32, i32, i32);

/// What the page's window may draw in: `None` for all of it, an empty list for none of
/// it, or all of it less these.
pub type Shape = Option<Vec<Piece>>;

/// Rounds a length in the window's own units to the screen's pixels.
#[allow(
    clippy::cast_possible_truncation,
    reason = "a page is never anywhere near two billion pixels across"
)]
fn pixels(length: f64, scale: f64) -> i32 {
    (length * scale).round() as i32
}

/// The shape a cut leaves of a page `width` by `height` in the window's own units, on a
/// screen of `scale`. Layers that miss the page are left out, and those that reach past
/// its edge are trimmed to it; a cut with nothing left in it is no cut.
#[must_use]
pub fn shape_of(cut: Option<&Cut>, width: f64, height: f64, scale: f64) -> Shape {
    let cut = cut?;
    if cut.all {
        return Some(Vec::new());
    }

    let (wide, tall) = (pixels(width, scale), pixels(height, scale));
    let pieces: Vec<Piece> = cut
        .hollows
        .iter()
        .map(|one| {
            (
                pixels(one.x, scale).max(0),
                pixels(one.y, scale).max(0),
                pixels(one.x + one.width, scale).min(wide),
                pixels(one.y + one.height, scale).min(tall),
                pixels(one.radius * 2.0, scale).max(0),
            )
        })
        .filter(|(left, top, right, bottom, _)| left < right && top < bottom)
        .collect();

    // Nothing over the page after all: the whole of it.
    if pieces.is_empty() {
        return None;
    }
    let mut whole = vec![(0, 0, wide, tall, 0)];
    whole.extend(pieces);
    Some(whole)
}

/// Whether this build cuts layers out of a page at all.
pub const CUTS: bool = cfg!(all(windows, not(feature = "cef")));

/// The cut each page was last given, and the shape that made of it, so the same shape is
/// not given twice - a region set again is a page drawn again - and a page resized under
/// a cut is given the cut again at its new size.
static GIVEN: LazyLock<Mutex<Given>> = LazyLock::new(Mutex::default);

/// Each page's last cut and shape, by its label.
type Given = HashMap<String, (Option<Cut>, Shape)>;

fn given<T>(look: impl FnOnce(&mut Given) -> T) -> T {
    look(&mut GIVEN.lock().unwrap_or_else(PoisonError::into_inner))
}

/// Gives a page the shape a cut leaves of it at `width` by `height`, unless it already
/// has that shape.
pub fn apply(view: &Webview, cut: Option<Cut>, width: f64, height: f64) {
    if !CUTS {
        return;
    }
    let scale = view.window().scale_factor().unwrap_or(1.0);
    let shape = shape_of(cut.as_ref(), width, height, scale);
    let label = view.label().to_string();
    let changed = given(|all| {
        // A page never given a shape has all of itself, which is `None`.
        let before = all.get(&label).and_then(|(_, one)| one.clone());
        all.insert(label, (cut, shape.clone()));
        before != shape
    });
    if changed {
        engine::shape(view, shape);
    }
}

/// A page under a cut has been given a new size: the cut again, at that size.
pub fn refit(view: &Webview, width: f64, height: f64) {
    let cut = given(|all| all.get(view.label()).and_then(|(cut, _)| cut.clone()));
    if cut.is_some() {
        apply(view, cut, width, height);
    }
}

/// A page closed: what shape it had is forgotten with it.
pub fn uncut(label: &str) {
    given(|all| all.remove(label));
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use tauri::Webview;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF,
    };

    use super::Shape;

    /// The window the engine draws the page in: the one wry made to hold the controller.
    #[allow(
        unsafe_code,
        reason = "the controller's window is asked through WebView2's COM interface, and the region set through GDI"
    )]
    pub fn shape(view: &Webview, shape: Shape) {
        let _ = view.with_webview(move |platform| {
            // Safe: the controller belongs to this live webview, the window it names is
            // the one wry made for it on this thread, and every region made here is
            // either handed to the system by `SetWindowRgn` - which owns it from then on
            // - or deleted before the block ends.
            unsafe {
                let mut held = windows_com::Win32::Foundation::HWND::default();
                if platform.controller().ParentWindow(&raw mut held).is_err() {
                    return;
                }
                let window = HWND(held.0);
                let Some(pieces) = shape else {
                    SetWindowRgn(window, HRGN::default(), BOOL::from(true));
                    return;
                };
                let region = match pieces.split_first() {
                    None => CreateRectRgn(0, 0, 0, 0),
                    Some((&(left, top, right, bottom, _), hollows)) => {
                        let whole = CreateRectRgn(left, top, right, bottom);
                        for &(left, top, right, bottom, round) in hollows {
                            let hollow =
                                CreateRoundRectRgn(left, top, right + 1, bottom + 1, round, round);
                            CombineRgn(whole, whole, hollow, RGN_DIFF);
                            let _ = DeleteObject(hollow);
                        }
                        whole
                    }
                };
                if SetWindowRgn(window, region, BOOL::from(true)) == 0 {
                    let _ = DeleteObject(region);
                }
            }
        });
    }
}

#[cfg(not(all(windows, not(feature = "cef"))))]
mod engine {
    use tauri::Webview;

    use super::Shape;

    /// Nothing to give: `CUTS` is false here, and nothing calls this.
    pub fn shape(_view: &Webview, _shape: Shape) {}
}

#[cfg(test)]
mod tests {
    use super::{shape_of, Cut, Hollow};

    fn hollow(x: f64, y: f64, width: f64, height: f64) -> Hollow {
        Hollow {
            x,
            y,
            width,
            height,
            radius: 0.0,
        }
    }

    #[test]
    fn nothing_over_the_page_is_the_whole_page() {
        assert_eq!(shape_of(None, 800.0, 600.0, 1.0), None);
        assert_eq!(shape_of(Some(&Cut::default()), 800.0, 600.0, 1.0), None);
    }

    #[test]
    fn a_sheet_over_everything_leaves_nothing() {
        let all = Cut {
            all: true,
            hollows: Vec::new(),
        };
        assert_eq!(shape_of(Some(&all), 800.0, 600.0, 1.0), Some(Vec::new()));
    }

    #[test]
    fn a_menu_is_taken_out_of_the_page_in_screen_pixels() {
        let cut = Cut {
            all: false,
            hollows: vec![Hollow {
                radius: 8.0,
                ..hollow(10.0, 20.0, 200.0, 100.0)
            }],
        };
        assert_eq!(
            shape_of(Some(&cut), 800.0, 600.0, 1.5),
            Some(vec![(0, 0, 1200, 900, 0), (15, 30, 315, 180, 24)])
        );
    }

    #[test]
    fn a_layer_reaching_past_the_page_is_trimmed_to_it() {
        let cut = Cut {
            all: false,
            hollows: vec![hollow(-40.0, -10.0, 100.0, 50.0)],
        };
        assert_eq!(
            shape_of(Some(&cut), 800.0, 600.0, 1.0),
            Some(vec![(0, 0, 800, 600, 0), (0, 0, 60, 40, 0)])
        );
    }

    #[test]
    fn a_layer_beside_the_page_is_no_cut() {
        let cut = Cut {
            all: false,
            hollows: vec![hollow(900.0, 10.0, 100.0, 50.0)],
        };
        assert_eq!(shape_of(Some(&cut), 800.0, 600.0, 1.0), None);
    }
}
