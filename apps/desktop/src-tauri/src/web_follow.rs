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

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde::Deserialize;
use tauri::{LogicalPosition, LogicalSize, Manager as _, Rect, Window, WindowEvent};

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

/// The window's size now, in the units the window measures in.
pub fn extent_of(window: &Window) -> Option<Extent> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Extent {
        width: size.width,
        height: size.height,
    })
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

/// The bounds a page is set to, in the runtime's own terms.
pub fn rect_of(bounds: Bounds) -> Rect {
    Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(bounds.width, bounds.height).into(),
    }
}

/// A window was resized: every page on screen in it goes where its layout puts it at the
/// new size, inside this same resize.
pub fn heard(window: &Window, event: &WindowEvent) {
    if !matches!(
        event,
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
    ) {
        return;
    }
    let Some(now) = extent_of(window) else {
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
            let _ = view.set_bounds(rect_of(bounds));
            // A page under one of the app's layers keeps the layer cut out of it at its
            // new size; see web_cut.rs.
            crate::web_cut::refit(&view, bounds.width, bounds.height);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fitted, Bounds, Extent, Frame};

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
}
