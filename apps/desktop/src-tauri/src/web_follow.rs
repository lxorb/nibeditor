//! Every web tab's page following its window as the window is resized, in the window's
//! own resize rather than a frame or two after it.
//!
//! Emil, 2026-10-03: *"While resizing the window, the page sometimes freezes where it
//! is. [...] Resizing web tabs in general is still super buggy."* A page is a webview of
//! its own, placed over the hole its pane leaves; the window measures the hole and says
//! where it is (`web_place`). That is right for everything the window lays out - a
//! divider, a sidebar, the notices row - but a window being resized is laid out by the
//! window's page *after* the resize: the app's page is told its new size, lays itself
//! out, its resize observer fires, and only then does a placement cross back here. A
//! frame or two behind the window's edge on every step of the drag, measured at 12 ms
//! median and 30 ms at worst (scripts/web-smooth-probe.py), with one step in five never
//! caught up at all.
//!
//! Electron met the same thing with its own native child views and answered it with
//! `setAutoResize`: the main process moves the view in the window's resize. Tauri's
//! `auto_resize` does the same with fixed proportions of the window, which is wrong for a
//! sidebar of a fixed width. So each placement carries where the hole sat in the layout
//! as well as where it is - the panes' area and the pane the hole is in, at the window
//! size it was measured at - and a resize puts each page where that layout puts it at the
//! new size: the area keeps its distance from every edge of the window, and a pane keeps
//! its share of the area. Exact for one pane, and for the outer edges of several; an inner
//! divider is off by a fraction of its gutter until the window's own placement lands a
//! frame later and corrects it.
//!
//! The same mapping is applied to every placement the window sends. A placement measured
//! at an older size than the window has now - the window said it, and a resize happened
//! while it crossed - lands where that layout is at the current size, rather than putting
//! the page back where the pane was before the resize. That was the freeze: the window's
//! last word was a stale one, and it never had reason to say another.
//!
//! The mapping is a bridge and never the answer: what the window measured is the one
//! source of where a page goes, and the window measures again after every change of its
//! layout, its size and its scale (see `look` in web-tab/WebTab.svelte). So this side
//! invents nothing the window would not say. Two things it used to (#246):
//!
//! * **A minimised window has no size**, and is not a window of no size. Windows says a
//!   minimised window's client area is nothing, and tao passes that on as a resize to
//!   nought by nought, which mapped every page in the window down to one pixel: every
//!   site laid itself out again for a window one pixel wide, and again when the window
//!   came back. Chrome leaves a minimised window's pages their size, and so does this:
//!   an empty client area is no news about the layout.
//! * **A page's edges are the hole's edges.** The window draws the hole with each edge
//!   rounded to the screen's pixels, and the runtime rounded the page's corner and its
//!   size apart, so at 125 or 150 per cent the page's far edge could be a pixel off the
//!   hole's: a hairline of the pane beside it, or a page a pixel over the divider.
//!   `edges` rounds each edge, as the window's compositor does.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde::Deserialize;
use tauri::{Manager as _, PhysicalPosition, PhysicalSize, Rect, Window, WindowEvent};

/// A rectangle in the window's own coordinates, as the window measures one.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A size, as the window measures it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Extent {
    pub width: f64,
    pub height: f64,
}

/// Where a hole sat in the window's layout when it was measured: the window's size, the
/// area every pane shares and the pane the hole is in.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Frame {
    pub window: Extent,
    pub area: Bounds,
    pub pane: Bounds,
}

/// Less than this is the same size: the window measures in whole pixels of its own and
/// this side has the window's size in fractions of one.
const SAME: f64 = 0.5;

/// One axis of `fitted`: where an edge measured at `extent` is when the window is
/// `now`. The area keeps its start and its distance from the window's end; a pane keeps
/// its share of the area; the hole keeps its distance from its pane's edges.
fn along(
    hole: (f64, f64),
    pane: (f64, f64),
    area: (f64, f64),
    extent: f64,
    now: f64,
) -> (f64, f64) {
    let (start, end) = area;
    let width = end - start;
    let grown = (now - extent).max(start - end);
    let scale = if width > 0.0 {
        (width + grown) / width
    } else {
        1.0
    };
    let at = |edge: f64| start + (edge - start) * scale;
    (
        at(pane.0) + (hole.0 - pane.0),
        at(pane.1) + (hole.1 - pane.1),
    )
}

/// Where a hole measured in `frame` is, in a window of `now`. The hole itself when the
/// window has not changed size since.
#[must_use]
pub fn fitted(hole: Bounds, frame: &Frame, now: Extent) -> Bounds {
    if (now.width - frame.window.width).abs() < SAME
        && (now.height - frame.window.height).abs() < SAME
    {
        return hole;
    }

    let (left, right) = along(
        (hole.x, hole.x + hole.width),
        (frame.pane.x, frame.pane.x + frame.pane.width),
        (frame.area.x, frame.area.x + frame.area.width),
        frame.window.width,
        now.width,
    );
    let (top, bottom) = along(
        (hole.y, hole.y + hole.height),
        (frame.pane.y, frame.pane.y + frame.pane.height),
        (frame.area.y, frame.area.y + frame.area.height),
        frame.window.height,
        now.height,
    );
    Bounds {
        x: left,
        y: top,
        width: (right - left).max(1.0),
        height: (bottom - top).max(1.0),
    }
}

/// A page on screen and where the window last put it.
#[derive(Clone, Copy)]
struct Followed {
    hole: Bounds,
    frame: Frame,
}

/// Every page on screen, by its label, with the window it is in.
static FOLLOWING: LazyLock<Mutex<HashMap<String, (String, Followed)>>> =
    LazyLock::new(Mutex::default);

fn following<T>(look: impl FnOnce(&mut HashMap<String, (String, Followed)>) -> T) -> T {
    look(&mut FOLLOWING.lock().unwrap_or_else(PoisonError::into_inner))
}

/// A client area of `width` by `height` screen pixels at `scale`, in the units the window
/// measures in, or nothing for an empty one: a minimised window, which says nothing about
/// where anything is.
#[must_use]
pub fn extent(width: u32, height: u32, scale: f64) -> Option<Extent> {
    if width == 0 || height == 0 || scale <= 0.0 {
        return None;
    }
    Some(Extent {
        width: f64::from(width) / scale,
        height: f64::from(height) / scale,
    })
}

/// The window's size now, in the units the window measures in; nothing while it is
/// minimised.
pub fn extent_of(window: &Window) -> Option<Extent> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?;
    extent(size.width, size.height, scale)
}

/// Where a placement puts a page now, and the page followed from here on - or, without a
/// frame, simply where it was said to go. A page out of sight is not followed: nothing
/// of it shows, and it is placed again before it does.
pub fn placed(
    window: &Window,
    label: &str,
    hole: Bounds,
    frame: Option<Frame>,
    shown: bool,
) -> Bounds {
    let Some(frame) = frame.filter(|_| shown) else {
        unfollow(label);
        return hole;
    };
    following(|all| {
        all.insert(
            label.to_string(),
            (window.label().to_string(), Followed { hole, frame }),
        )
    });
    extent_of(window).map_or(hole, |now| fitted(hole, &frame, now))
}

/// A page closed or hidden: nothing to follow.
pub fn unfollow(label: &str) {
    following(|all| all.remove(label));
}

/// A page's window in the screen's own pixels at `scale`: left, top, width and height,
/// with each edge rounded where the window's compositor rounds the hole's, so the two
/// meet at every scale. Never less than a pixel either way.
#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    reason = "a page is never anywhere near two billion pixels across"
)]
pub fn edges(bounds: Bounds, scale: f64) -> (i32, i32, u32, u32) {
    let at = |length: f64| (length * scale).round() as i32;
    let (left, top) = (at(bounds.x), at(bounds.y));
    let (right, bottom) = (at(bounds.x + bounds.width), at(bounds.y + bounds.height));
    (
        left,
        top,
        right.saturating_sub(left).max(1).unsigned_abs(),
        bottom.saturating_sub(top).max(1).unsigned_abs(),
    )
}

/// Places a page in the window's own units at `scale`: screen pixels where the runtime
/// positions child webviews, and GTK's layout pixels on Linux, where the page is in an
/// overlay. The Linux runtime bounds leave it beside the app's webview, where GTK shares
/// their height; see `web_overlay.rs`.
#[cfg_attr(
    target_os = "linux",
    allow(
        clippy::unnecessary_wraps,
        reason = "placement on other platforms can fail"
    )
)]
pub fn put(view: &tauri::Webview, bounds: Bounds, scale: f64) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let _ = scale;
        crate::web_overlay::page_over(view, edges(bounds, 1.0));
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        view.set_bounds(rect_of(edges(bounds, scale)))
    }
}

/// A page's window as `edges` says it, in the runtime's own terms.
#[must_use]
#[cfg_attr(
    target_os = "linux",
    allow(dead_code, reason = "GTK uses its own layout pixels")
)]
pub fn rect_of((left, top, width, height): (i32, i32, u32, u32)) -> Rect {
    Rect {
        position: PhysicalPosition::new(left, top).into(),
        size: PhysicalSize::new(width, height).into(),
    }
}

/// A window was resized, or moved to a screen of another scale: every page on screen in
/// it goes where its layout puts it at the new size, inside this same resize.
///
/// A change of scale says the size the window is about to be given, and that is the size
/// followed. The window still has its old size in the screen's pixels when it is told,
/// and the old size at the new scale is a layout twice or half as big, for the one
/// message before the resize that follows.
pub fn heard(window: &Window, event: &WindowEvent) {
    let (now, scale) = match event {
        WindowEvent::Resized(_) => {
            let Ok(scale) = window.scale_factor() else {
                return;
            };
            (extent_of(window), scale)
        }
        WindowEvent::ScaleFactorChanged {
            scale_factor,
            new_inner_size,
            ..
        } => (
            extent(new_inner_size.width, new_inner_size.height, *scale_factor),
            *scale_factor,
        ),
        _ => return,
    };
    // Minimised: every page keeps its place and its size until the window is back.
    let Some(now) = now else {
        return;
    };
    let mine: Vec<(String, Followed)> = following(|all| {
        all.iter()
            .filter(|(_, (held, _))| held == window.label())
            .map(|(label, (_, one))| (label.clone(), *one))
            .collect()
    });
    for (label, one) in mine {
        if let Some(view) = window.app_handle().get_webview(&label) {
            let bounds = fitted(one.hole, &one.frame, now);
            let (_, _, width, height) = edges(bounds, scale);
            let _ = put(&view, bounds, scale);
            // A page under one of the app's layers keeps the layer cut out of it at its
            // new size; see web_cut.rs.
            crate::web_cut::refit(&view, width, height, scale);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{edges, extent, fitted, Bounds, Extent, Frame};

    /// Within a hundredth of a pixel, which is what floating point owes a division.
    fn near(found: Bounds, wanted: Bounds) {
        let off = [
            found.x - wanted.x,
            found.y - wanted.y,
            found.width - wanted.width,
            found.height - wanted.height,
        ];
        assert!(
            off.iter().all(|one| one.abs() < 0.01),
            "{found:?} is not {wanted:?}"
        );
    }

    fn at(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    /// A window of 1200 by 800 with a sidebar of 240 and the notices row and status bar
    /// taking 40 under the panes; the bar over the page is 40 high.
    fn one_pane() -> (Bounds, Frame) {
        let area = at(240.0, 36.0, 960.0, 724.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area,
            pane: area,
        };
        (at(240.0, 76.0, 960.0, 684.0), frame)
    }

    #[test]
    fn the_same_size_is_the_same_place() {
        let (hole, frame) = one_pane();
        assert_eq!(fitted(hole, &frame, frame.window), hole);
    }

    #[test]
    fn one_pane_keeps_the_sidebar_and_the_bars_and_takes_the_rest() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1500.0,
                height: 900.0,
            },
        );
        near(now, at(240.0, 76.0, 1260.0, 784.0));
    }

    #[test]
    fn a_window_made_smaller_shrinks_the_page_and_nothing_else() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1000.0,
                height: 700.0,
            },
        );
        near(now, at(240.0, 76.0, 760.0, 584.0));
    }

    #[test]
    fn a_pane_of_two_keeps_its_share() {
        // Two panes side by side, the right one from 720 to 1200, its page under a bar.
        let area = at(240.0, 36.0, 960.0, 724.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area,
            pane: at(720.0, 36.0, 480.0, 724.0),
        };
        let hole = at(720.0, 76.0, 480.0, 684.0);
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1440.0,
                height: 800.0,
            },
        );
        // The area is 1200 wide now: the right half starts at 840 and runs to the edge.
        near(now, at(840.0, 76.0, 600.0, 684.0));
    }

    #[test]
    fn a_page_never_folds_to_nothing() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 100.0,
                height: 50.0,
            },
        );
        assert!(now.width >= 1.0 && now.height >= 1.0);
    }

    #[test]
    fn a_page_filling_the_window_fills_it_at_every_size() {
        let whole = at(0.0, 0.0, 1200.0, 800.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area: whole,
            pane: whole,
        };
        let now = fitted(
            whole,
            &frame,
            Extent {
                width: 1920.0,
                height: 1080.0,
            },
        );
        near(now, at(0.0, 0.0, 1920.0, 1080.0));
    }

    #[test]
    fn half_a_pixel_of_rounding_is_no_resize() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1200.4,
                height: 799.7,
            },
        );
        assert_eq!(now, hole);
    }

    /// Minimised, Windows says the window has no client area, and tao says that as a resize
    /// to nought by nought; mapped, it was every page in the window one pixel wide.
    #[test]
    fn a_minimised_window_says_nothing_about_the_layout() {
        assert_eq!(extent(0, 0, 1.5), None);
        assert_eq!(extent(1200, 0, 1.0), None);
        assert_eq!(
            extent(1800, 1200, 1.5),
            Some(Extent {
                width: 1200.0,
                height: 800.0,
            })
        );
    }

    /// At 150 per cent a hole from 100.3 to 300.6 is drawn from pixel 150 to pixel 451.
    /// Its corner and its size rounded apart made a page 300 wide, a pixel short of the
    /// hole's far edge; and the same below.
    #[test]
    fn a_page_s_edges_are_rounded_where_the_hole_s_are() {
        assert_eq!(
            edges(at(100.3, 40.2, 200.3, 560.2), 1.5),
            (150, 60, 301, 841)
        );
        assert_eq!(
            edges(at(240.0, 76.0, 960.0, 684.0), 1.0),
            (240, 76, 960, 684)
        );
        assert_eq!(edges(at(-10.0, -10.0, 0.1, 0.1), 2.0), (-20, -20, 1, 1));
    }
}
