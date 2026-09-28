//! Where a Mac's traffic lights sit over nib's own bar, and keeping them there.
//!
//! Every titlebar `AppKit` draws centres its three buttons in its own height, with
//! the same margin on the left as above them: nine points in the plain 32 point
//! titlebar, twelve and thirteen in a compact toolbar's forty, nineteen in a
//! unified toolbar's fifty-two. Nib's bar is `--titlebar-height`, 38 points, which
//! is none of those, so the lights are placed by hand the way `AppKit` would have
//! placed them in a bar that tall: centred in it, and as far in from the left as
//! they are down from the top.
//!
//! Placing them is the easy half. `AppKit` lays the titlebar out again whenever
//! it has a reason to - a resize, a new title, the edited dot, a change of
//! appearance or of style - and puts the buttons back where its own titlebar has
//! them each time. So the placement is repeated whenever any of the three buttons,
//! or the view that holds them, is moved. Nib retitles the window and marks it
//! edited on every note it shows, so this is not an edge case but most of what the
//! window does.
//!
//! This is not tao's `traffic_light_inset`, which Tauri's `trafficLightPosition`
//! asks for: that one is applied from the content view's `drawRect:`, which a
//! window full of webview does not reach at launch or on a new title, and its
//! arithmetic takes the buttons to sit at the foot of their titlebar, which on
//! macOS 26 put them three points from the top of the window. Measured on macOS
//! 26.6 with `nibdrive frame`; see docs/macos.md.

/// The bar's height, in points: `--titlebar-height` in the themes.
const BAR: f64 = 38.0;

/// How far the first light is from the window's leading edge: as far as the
/// lights are from its top, which is `AppKit`'s own rule in every titlebar it
/// draws. `--traffic-lights` in the themes is the room this leaves in the bar.
const LEFT: f64 = 12.0;

/// Where one of the three buttons goes, as the origin `setFrameOrigin:` takes: in
/// the coordinates of the view that holds them, which is `holder` points wide and
/// as tall as the bar.
///
/// `index` counts from the close button, `pitch` is the distance `AppKit` itself
/// leaves from one button to the next, and `leftward` is a titlebar laid out right
/// to left, where the close button is the one at the right.
fn origin(
    button: (f64, f64),
    holder: (f64, f64),
    pitch: f64,
    index: u8,
    leftward: bool,
) -> (f64, f64) {
    let (width, height) = button;
    let along = LEFT + f64::from(index) * pitch;
    let x = if leftward {
        holder.0 - along - width
    } else {
        along
    };
    // Centred either way up: the view's origin is at its foot, and the button's
    // distance from the foot and from the top are the same number.
    let y = ((holder.1 - height) / 2.0).round();
    (x, y)
}

/// Puts the window's lights in the bar and keeps them there for as long as the
/// window lives. Called once, on the main thread, as each window with nib's own
/// frame is built.
#[cfg(target_os = "macos")]
pub fn hold(window: &tauri::WebviewWindow) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let pointer = pointer as usize;
    let on = move || native::hold(pointer as *mut std::ffi::c_void);

    // At once where it can be, so a window that is shown as it is built is never
    // seen with the lights where they started.
    if objc2::MainThreadMarker::new().is_some() {
        on();
    } else {
        let _ = window.run_on_main_thread(on);
    }
}

#[cfg(target_os = "macos")]
mod native {
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread};
    use objc2_app_kit::{
        NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton, NSWindowStyleMask,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSPoint};

    use super::{origin, BAR};

    thread_local! {
        /// Set while the lights are being placed, so the moves this module makes
        /// itself are not taken for `AppKit`'s and answered again.
        static PLACING: Cell<bool> = const { Cell::new(false) };
    }

    /// The key the watch is kept under on its window. Its address is the key.
    static KEPT: u8 = 0;

    /// The observers one window's lights are kept in place by, given back to the
    /// notification centre when the window goes.
    struct Observers(Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>);

    impl Drop for Observers {
        #[allow(
            unsafe_code,
            reason = "an observer is taken off the notification centre through the Objective-C runtime"
        )]
        fn drop(&mut self) {
            let centre = NSNotificationCenter::defaultCenter();
            for observer in &self.0 {
                // SAFETY: each is a token the default centre handed back from
                // `addObserverForName:object:queue:usingBlock:`, which is exactly
                // what `removeObserver:` takes.
                unsafe { centre.removeObserver(observer.as_ref()) };
            }
        }
    }

    define_class!(
        /// What a window carries for as long as it exists: the observers that keep
        /// its lights in the bar.
        #[unsafe(super(NSObject))]
        #[name = "NibLightsWatch"]
        #[ivars = Observers]
        struct Watch;
    );

    /// The view a view is in.
    #[allow(
        unsafe_code,
        reason = "AppKit marks reading a view's superview unsafe, as the answer's class is not promised"
    )]
    fn parent(view: &NSView) -> Option<Retained<NSView>> {
        // SAFETY: nothing here relies on the superview being any particular kind of
        // view: it is only measured and moved, which every NSView answers.
        unsafe { view.superview() }
    }

    /// The three buttons, close first, and the view that holds them.
    fn buttons(window: &NSWindow) -> Option<([Retained<NSView>; 3], Retained<NSView>)> {
        let close = window.standardWindowButton(NSWindowButton::CloseButton)?;
        let minimize = window.standardWindowButton(NSWindowButton::MiniaturizeButton)?;
        let zoom = window.standardWindowButton(NSWindowButton::ZoomButton)?;
        let bar = parent(&close)?;
        let holder = parent(&bar)?;
        Some((
            [
                Retained::into_super(Retained::into_super(close)),
                Retained::into_super(Retained::into_super(minimize)),
                Retained::into_super(Retained::into_super(zoom)),
            ],
            holder,
        ))
    }

    /// Centres the lights in the bar, where the bar is nib's own. A window in full
    /// screen has its lights in `AppKit`'s own titlebar, which slides down over the
    /// page, and a window with the system's frame has the system's titlebar: both
    /// are left exactly as `AppKit` has them.
    fn place(window: &NSWindow) {
        // The system's frame is an opaque titlebar, whichever way the content view
        // is laid out: Tauri switches to it at runtime by making the titlebar opaque
        // and leaves the page running up under it.
        let style = window.styleMask();
        if !window.titlebarAppearsTransparent()
            || !style.contains(NSWindowStyleMask::FullSizeContentView)
            || style.contains(NSWindowStyleMask::FullScreen)
        {
            return;
        }
        let Some(([close, minimize, zoom], container)) = buttons(window) else {
            return;
        };

        PLACING.set(true);

        // The titlebar's own view as tall as the bar, from the top of the window,
        // so the lights are not cut off at its foot and still answer a click.
        let mut frame = container.frame();
        frame.size.height = BAR;
        frame.origin.y = window.frame().size.height - BAR;
        container.setFrame(frame);

        let pitch = (minimize.frame().origin.x - close.frame().origin.x).abs();
        let leftward = close.frame().origin.x > zoom.frame().origin.x;
        for (index, button) in (0u8..).zip([&close, &minimize, &zoom]) {
            let Some(holder) = parent(button) else {
                continue;
            };
            let (size, room) = (button.frame().size, holder.frame().size);
            let (x, y) = origin(
                (size.width, size.height),
                (room.width, room.height),
                pitch,
                index,
                leftward,
            );
            button.setFrameOrigin(NSPoint::new(x, y));
        }

        PLACING.set(false);
    }

    /// Places the lights on the window behind `pointer`, which is the `NSWindow`
    /// Tauri hands out, and places them again whenever `AppKit` moves them.
    #[allow(
        unsafe_code,
        reason = "Tauri hands the NSWindow over as a bare pointer, and observers and associated objects are the Objective-C runtime's own calls"
    )]
    pub fn hold(pointer: *mut c_void) {
        if pointer.is_null() {
            return;
        }
        // SAFETY: the pointer is the window's own NSWindow, alive for as long as the
        // window is; retaining it keeps it so while this runs, on the main thread.
        let Some(window) = (unsafe { Retained::retain(pointer.cast::<NSWindow>()) }) else {
            return;
        };

        place(&window);

        let Some((watched, container)) = buttons(&window) else {
            return;
        };

        // The block holds the window weakly: the window holds the observers, through
        // the watch below, and a strong hold back would keep both for ever.
        let weak = Weak::from_retained(&window);
        let again = RcBlock::new(move |_: NonNull<NSNotification>| {
            if PLACING.get() {
                return;
            }
            if let Some(window) = weak.load() {
                place(&window);
            }
        });

        let centre = NSNotificationCenter::defaultCenter();
        let mut observers = Vec::new();
        for view in watched.iter().chain(std::iter::once(&container)) {
            view.setPostsFrameChangedNotifications(true);
            // SAFETY: the name is AppKit's own, the object is a view of this window,
            // no queue means the block runs where the view moved - the main thread,
            // which is where `place` has to run - and the block holds nothing that
            // cannot be touched there.
            let observer = unsafe {
                centre.addObserverForName_object_queue_usingBlock(
                    Some(NSViewFrameDidChangeNotification),
                    Some(view.as_ref() as &AnyObject),
                    None,
                    &again,
                )
            };
            observers.push(observer);
        }

        let watch = Watch::alloc().set_ivars(Observers(observers));
        // SAFETY: `init` is NSObject's own initialiser, on an object just allocated
        // and given its instance variables.
        let watch: Retained<Watch> = unsafe { msg_send![super(watch), init] };

        // SAFETY: the window is alive, the key is this module's own static, and the
        // watch is retained by the window from here, so it goes - and its observers
        // with it - when the window does.
        unsafe {
            objc2::ffi::objc_setAssociatedObject(
                Retained::as_ptr(&window).cast::<AnyObject>().cast_mut(),
                (&raw const KEPT).cast::<c_void>(),
                Retained::as_ptr(&watch).cast::<AnyObject>().cast_mut(),
                objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{origin, BAR, LEFT};

    /// The widest distance from one light to the next of the systems nib runs on:
    /// 23 points on macOS 26, where each button is 14 points with nine between.
    const WIDEST_PITCH: f64 = 23.0;
    const LIGHT: f64 = 14.0;

    fn pixels(css: &str, token: &str) -> f64 {
        let start = css
            .find(&format!("{token}:"))
            .unwrap_or_else(|| panic!("{token} is not in tokens.css"));
        let value = css[start + token.len() + 1..]
            .split(';')
            .next()
            .unwrap()
            .trim();
        value
            .strip_suffix("px")
            .unwrap_or_else(|| panic!("{token} is not in pixels: {value}"))
            .parse()
            .unwrap()
    }

    /// Whether a point is where it should be, to within a rounding error.
    fn at(point: (f64, f64), x: f64, y: f64) -> bool {
        (point.0 - x).abs() < f64::EPSILON && (point.1 - y).abs() < f64::EPSILON
    }

    #[test]
    fn a_light_is_centred_in_the_bar() {
        // macOS 26's buttons are 14 points square; older ones are 14 by 16.
        assert!(at(
            origin((14.0, 14.0), (300.0, BAR), 23.0, 0, false),
            LEFT,
            12.0
        ));
        assert!(at(
            origin((14.0, 16.0), (300.0, BAR), 20.0, 0, false),
            LEFT,
            11.0
        ));
    }

    #[test]
    fn the_lights_keep_the_systems_own_pitch() {
        assert!(at(
            origin((14.0, 14.0), (300.0, BAR), 23.0, 2, false),
            LEFT + 46.0,
            12.0
        ));
        assert!(at(
            origin((14.0, 16.0), (300.0, BAR), 20.0, 1, false),
            LEFT + 20.0,
            11.0
        ));
    }

    #[test]
    fn a_titlebar_laid_out_right_to_left_is_mirrored() {
        // The close button at the right, as far in from that edge as it would be
        // from the left.
        let right = 300.0 - LEFT - 14.0;
        assert!(at(
            origin((14.0, 14.0), (300.0, BAR), 23.0, 0, true),
            right,
            12.0
        ));
        assert!(at(
            origin((14.0, 14.0), (300.0, BAR), 23.0, 2, true),
            right - 46.0,
            12.0
        ));
    }

    #[test]
    fn the_bar_is_as_tall_as_the_themes_say() {
        let tokens = include_str!("../../../../packages/themes/src/tokens.css");
        assert!((pixels(tokens, "--titlebar-height") - BAR).abs() < f64::EPSILON);
    }

    #[test]
    fn the_bar_leaves_room_for_all_three_lights() {
        let tokens = include_str!("../../../../packages/themes/src/tokens.css");
        let last_light_ends = LEFT + 2.0 * WIDEST_PITCH + LIGHT;
        assert!(
            pixels(tokens, "--traffic-lights") >= last_light_ends + 4.0,
            "--traffic-lights must clear the zoom button, which ends at {last_light_ends}"
        );
    }

    #[test]
    fn tao_is_not_asked_to_place_them_too() {
        // tao would move them again from its own drawRect:, somewhere else.
        let config = include_str!("../tauri.macos.conf.json");
        assert!(!config.contains("trafficLightPosition"));
    }
}
