//! Where a Mac's traffic lights sit over nib's own bar, and keeping them there.
//!
//! Every titlebar `AppKit` draws centres its three buttons in its own height, with
//! the same margin on the left as above them: nine points in the plain 32 point
//! titlebar, twelve and thirteen in a compact toolbar's forty, nineteen in a
//! unified toolbar's fifty-two. Nib's bar is `--titlebar-height`, 38 points, which
//! is none of those, so the lights are placed by hand the way `AppKit` would have
//! placed them in a bar that tall: centred in it, and as far in from the left as
//! they are down from the top, with `AppKit`'s own distance between them.
//!
//! Placing them is the easy half. `AppKit` puts them back where its own titlebar
//! has them whenever it has a reason to, and it does so two ways, both measured on
//! macOS 26.6:
//!
//! - **In a layout pass** of the view that holds them: a resize, a change of
//!   appearance, the way back out of full screen. The view is given a subclass of
//!   its own class at runtime, the way key-value observing does it, whose `layout`
//!   runs `AppKit`'s and then places the lights, in the same pass and before
//!   anything is drawn.
//! - **Directly**, outside any layout: a new title, the edited dot, a change of
//!   style. Each of the three buttons is watched for moving, and a move is answered
//!   once, on the main queue: after `AppKit`'s own call has returned, since
//!   answering inside it put a button back only for `AppKit`'s loop to move the next
//!   one, and before the commit that draws the window, since the main queue is
//!   drained ahead of it.
//!
//! Nib retitles the window and marks it edited on every note it shows, so the second
//! is most of what the window does rather than an edge case.
//!
//! This is not tao's `traffic_light_inset`, which Tauri's `trafficLightPosition`
//! asks for: that one is applied from the content view's `drawRect:`, which a window
//! full of webview does not reach at launch or on a new title, and its arithmetic
//! takes the buttons to sit at the foot of their titlebar, which on macOS 26 put them
//! three points from the top of the window. See docs/macos.md.

/// The bar's height, in points: `--titlebar-height` in the themes.
const BAR: f64 = 38.0;

/// How far the first light is from the window's leading edge: as far as the
/// lights are from its top, which is `AppKit`'s own rule in every titlebar it
/// draws. `--traffic-lights` in the themes is the room this leaves in the bar.
const LEFT: f64 = 12.0;

/// Where one of the three buttons goes inside the view that holds them, as its
/// distance from that view's left edge and from its top edge.
///
/// `holder_width` is that view's width and `holder_top` how far its top edge is
/// below the window's. `index` counts from the close button, `pitch` is the distance
/// `AppKit` itself leaves from one button to the next, and `leftward` is a titlebar
/// laid out right to left, where the close button is the one at the right.
fn spot(
    button: (f64, f64),
    holder_width: f64,
    holder_top: f64,
    pitch: f64,
    index: u8,
    leftward: bool,
) -> (f64, f64) {
    let (width, height) = button;
    let along = LEFT + f64::from(index) * pitch;
    let x = if leftward {
        holder_width - along - width
    } else {
        along
    };
    let top = ((BAR - height) / 2.0).round() - holder_top;
    (x, top)
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

/// Lays the window's titlebar out afresh after its frame has been switched, so the
/// lights are where the new frame wants them: centred in nib's own bar, or where
/// `AppKit` keeps them in the system's titlebar. Switching the style alone moves
/// nothing, and the lights stayed where nib's frame had put them, three points low
/// in a titlebar of `AppKit`'s own.
#[cfg(target_os = "macos")]
pub fn refresh(window: &tauri::Window) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let pointer = pointer as usize;
    // After the style change, which is a message to the same main thread ahead of
    // this one.
    let _ = window.run_on_main_thread(move || native::refresh(pointer as *mut std::ffi::c_void));
}

#[cfg(target_os = "macos")]
mod native {
    use std::cell::Cell;
    use std::ffi::{c_void, CString};
    use std::ptr::NonNull;
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, ProtocolObject, Sel};
    use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass};
    use objc2_app_kit::{
        NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton, NSWindowStyleMask,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue, NSPoint,
    };

    use super::spot;

    /// What the subclass given to the view that holds the lights is called, before
    /// the name of the class it is made from.
    const PREFIX: &str = "NibLights_";

    thread_local! {
        /// Set while the lights are being placed, so the moves this module makes
        /// itself are not taken for `AppKit`'s and answered again.
        static PLACING: Cell<bool> = const { Cell::new(false) };
    }

    /// The key the watch is kept under on its window. Its address is the key.
    static KEPT: u8 = 0;

    /// What one window keeps for its lights: the observers they are kept in place by,
    /// given back to the notification centre when the window goes, and where `AppKit`
    /// had them before nib moved them, which is where they go back to under the
    /// system's frame.
    struct Held {
        observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
        /// Each light's distance from its holder's left and top edges, close first.
        own: [(f64, f64); 3],
    }

    impl Drop for Held {
        #[allow(
            unsafe_code,
            reason = "an observer is taken off the notification centre through the Objective-C runtime"
        )]
        fn drop(&mut self) {
            let centre = NSNotificationCenter::defaultCenter();
            for observer in &self.observers {
                // SAFETY: each is a token the default centre handed back from
                // `addObserverForName:object:queue:usingBlock:`, which is exactly
                // what `removeObserver:` takes.
                unsafe { centre.removeObserver(observer.as_ref()) };
            }
        }
    }

    define_class!(
        /// What a window carries for as long as it exists: see `Held`.
        #[unsafe(super(NSObject))]
        #[name = "NibLightsWatch"]
        #[ivars = Held]
        struct Watch;
    );

    /// The watch a window was given in `hold`, if it was given one.
    #[allow(
        unsafe_code,
        reason = "an associated object is read through the Objective-C runtime"
    )]
    fn watch_on(window: &NSWindow) -> Option<Retained<Watch>> {
        // SAFETY: the key is this module's own, and the only object ever stored under
        // it is a `Watch`, which the window retains for as long as it exists.
        unsafe {
            let found = objc2::ffi::objc_getAssociatedObject(
                std::ptr::from_ref(window).cast::<AnyObject>(),
                (&raw const KEPT).cast::<c_void>(),
            );
            Retained::retain(found.cast::<Watch>().cast_mut())
        }
    }

    /// Where a light is inside the view that holds it, as its distance from that
    /// view's left and top edges, whichever way up the view counts.
    fn edges(light: &NSView, holder: &NSView) -> (f64, f64) {
        let frame = light.frame();
        let top = if holder.isFlipped() {
            frame.origin.y
        } else {
            holder.bounds().size.height - frame.origin.y - frame.size.height
        };
        (frame.origin.x, top)
    }

    /// The view a view is in.
    #[allow(
        unsafe_code,
        reason = "AppKit marks reading a view's superview unsafe, as the answer's class is not promised"
    )]
    fn parent(view: &NSView) -> Option<Retained<NSView>> {
        // SAFETY: nothing here relies on the superview being any particular kind of
        // view: it is only measured, given a layout of its own, and has buttons
        // moved inside it, which every NSView answers.
        unsafe { view.superview() }
    }

    /// The three buttons, close first.
    fn buttons(window: &NSWindow) -> Option<[Retained<NSView>; 3]> {
        let one = |kind| {
            window
                .standardWindowButton(kind)
                .map(|button| Retained::into_super(Retained::into_super(button)))
        };
        Some([
            one(NSWindowButton::CloseButton)?,
            one(NSWindowButton::MiniaturizeButton)?,
            one(NSWindowButton::ZoomButton)?,
        ])
    }

    /// Whether the window wears nib's own frame: a transparent titlebar with the page
    /// running up under it. The system's frame is an opaque one, whichever way the
    /// content view is laid out, since Tauri switches to it at runtime by making the
    /// titlebar opaque and leaves the page where it was.
    fn nibs_frame(window: &NSWindow) -> bool {
        window.titlebarAppearsTransparent()
            && window
                .styleMask()
                .contains(NSWindowStyleMask::FullSizeContentView)
    }

    /// Where the lights go in nib's own bar: centred in it, see `spot`.
    fn centred(
        window: &NSWindow,
        lights: &[Retained<NSView>; 3],
        holder: &NSView,
    ) -> [(f64, f64); 3] {
        let seen = holder.convertRect_toView(holder.bounds(), None);
        let holder_top = window.frame().size.height - (seen.origin.y + seen.size.height);
        let width = holder.bounds().size.width;
        let (first, last) = (lights[0].frame().origin.x, lights[2].frame().origin.x);
        let pitch = (lights[1].frame().origin.x - first).abs();
        let leftward = first > last;

        let mut index = 0u8;
        lights.each_ref().map(|light| {
            let size = light.frame().size;
            let at = spot(
                (size.width, size.height),
                width,
                holder_top,
                pitch,
                index,
                leftward,
            );
            index += 1;
            at
        })
    }

    /// Puts the lights where the window's frame wants them: centred in nib's own bar,
    /// or back where `AppKit` had them under the system's titlebar, which a change of
    /// style does not do by itself. A window in full screen lends its lights to a
    /// titlebar window of `AppKit`'s own, which slides down over the page, and they
    /// are left exactly as it has them.
    fn place(window: &NSWindow) {
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let Some(lights) = buttons(window) else {
            return;
        };
        let Some(holder) = parent(&lights[0]) else {
            return;
        };
        let in_this_window = holder.window().is_some_and(|there| {
            std::ptr::eq(Retained::as_ptr(&there), std::ptr::from_ref(window))
        });
        let together = lights
            .iter()
            .all(|light| parent(light).is_some_and(|there| there == holder));
        if !in_this_window || !together {
            return;
        }

        // A view `AppKit` made again since is one that has to be taught again.
        adopt(&holder);

        let spots = if nibs_frame(window) {
            centred(window, &lights, &holder)
        } else if let Some(watch) = watch_on(window) {
            watch.ivars().own
        } else {
            return;
        };

        let height = holder.bounds().size.height;
        PLACING.set(true);
        for (light, (x, top)) in lights.iter().zip(spots) {
            let size = light.frame().size;
            let y = if holder.isFlipped() {
                top
            } else {
                height - top - size.height
            };
            let now = light.frame().origin;
            // Only a real move, so a placement that finds everything where it
            // belongs asks nothing more of anybody.
            if (now.x - x).abs() > 0.1 || (now.y - y).abs() > 0.1 {
                light.setFrameOrigin(NSPoint::new(x, y));
            }
        }
        PLACING.set(false);
    }

    /// The class a view had before it was given this module's, found by walking up
    /// from whatever class it has now: something else may have subclassed it again
    /// since, the way key-value observing does.
    fn original_of(view: &NSView) -> Option<&'static AnyClass> {
        let mut class = view.class();
        loop {
            if class.name().to_bytes().starts_with(PREFIX.as_bytes()) {
                return class.superclass();
            }
            class = class.superclass()?;
        }
    }

    /// The holder's `layout`: `AppKit`'s own, and then the lights where they belong,
    /// in the same pass.
    #[allow(
        unsafe_code,
        reason = "the class this method was added to is reached through the Objective-C runtime to call the layout it replaces"
    )]
    extern "C-unwind" fn laid_out(this: &NSView, _: Sel) {
        if let Some(original) = original_of(this) {
            // SAFETY: `layout` takes nothing and answers nothing on every NSView, and
            // `original` is a superclass of the view's own class.
            unsafe {
                let () = msg_send![super(this, original), layout];
            }
        }
        if let Some(window) = this.window() {
            place(&window);
        }
    }

    /// Gives the view that holds the lights a subclass of its own class whose layout
    /// places them. Once per view: a view that already has it is left alone.
    #[allow(
        unsafe_code,
        reason = "a class is made and an object's class is changed through the Objective-C runtime"
    )]
    fn adopt(holder: &NSView) {
        if original_of(holder).is_some() {
            return;
        }
        let base = holder.class();
        let Ok(name) = CString::new(format!("{PREFIX}{}", base.name().to_string_lossy())) else {
            return;
        };
        let class = if let Some(made) = AnyClass::get(&name) {
            made
        } else {
            let Some(mut builder) = ClassBuilder::new(&name, base) else {
                return;
            };
            // SAFETY: the function has exactly the signature `layout` has, a
            // receiver and a selector in and nothing out.
            unsafe {
                builder.add_method(sel!(layout), laid_out as extern "C-unwind" fn(_, _));
            }
            builder.register()
        };
        // SAFETY: the class is a subclass of the view's own class that adds one
        // method and no instance variables, so the object is laid out exactly as the
        // new class expects; this is the main thread, where the view belongs.
        unsafe {
            objc2::ffi::object_setClass(
                std::ptr::from_ref::<NSView>(holder)
                    .cast::<AnyObject>()
                    .cast_mut(),
                std::ptr::from_ref::<AnyClass>(class),
            );
        }
    }

    /// The lights where the window's frame now wants them; see `place`.
    #[allow(
        unsafe_code,
        reason = "Tauri hands the NSWindow over as a bare pointer"
    )]
    pub fn refresh(pointer: *mut c_void) {
        if pointer.is_null() {
            return;
        }
        // SAFETY: as in `hold`: the window's own NSWindow, retained while this runs on
        // the main thread.
        let Some(window) = (unsafe { Retained::retain(pointer.cast::<NSWindow>()) }) else {
            return;
        };
        place(&window);
    }

    /// Places the lights on the window behind `pointer`, which is the `NSWindow`
    /// Tauri hands out, and places them again whenever `AppKit` moves them.
    #[allow(
        unsafe_code,
        reason = "Tauri hands the NSWindow over as a bare pointer, and observers, the main queue and associated objects are the Objective-C runtime's own calls"
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

        let Some(lights) = buttons(&window) else {
            return;
        };
        let Some(holder) = parent(&lights[0]) else {
            return;
        };
        // Where `AppKit` has them now, before anything here has moved them.
        let own = lights.each_ref().map(|light| edges(light, &holder));

        // The block holds the window weakly: the window holds the observers, through
        // the watch below, and a strong hold back would keep both for ever.
        let weak = Weak::from_retained(&window);
        let waiting = Rc::new(Cell::new(false));
        let again = RcBlock::new(move |_: NonNull<NSNotification>| {
            if PLACING.get() || waiting.get() {
                return;
            }
            waiting.set(true);
            let (weak, waiting) = (weak.clone(), Rc::clone(&waiting));
            let later = RcBlock::new(move || {
                waiting.set(false);
                if let Some(window) = weak.load() {
                    place(&window);
                }
            });
            // SAFETY: the main queue runs its operations on the main thread, which is
            // where this block was made and where everything it touches belongs.
            unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&later) };
        });

        let centre = NSNotificationCenter::defaultCenter();
        let mut observers = Vec::new();
        for light in &lights {
            light.setPostsFrameChangedNotifications(true);
            // SAFETY: the name is AppKit's own, the object is a button of this
            // window, and no queue means the block runs where the button moved, the
            // main thread, which is where it has to run.
            let observer = unsafe {
                centre.addObserverForName_object_queue_usingBlock(
                    Some(NSViewFrameDidChangeNotification),
                    Some(light.as_ref() as &AnyObject),
                    None,
                    &again,
                )
            };
            observers.push(observer);
        }

        let watch = Watch::alloc().set_ivars(Held { observers, own });
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

        // Last, so what `AppKit` had is written down before the lights move.
        place(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::{spot, BAR, LEFT};

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
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 0, false),
            LEFT,
            12.0
        ));
        assert!(at(
            spot((14.0, 16.0), 300.0, 0.0, 20.0, 0, false),
            LEFT,
            11.0
        ));
    }

    #[test]
    fn a_holder_lower_in_the_window_is_allowed_for() {
        assert!(at(
            spot((14.0, 14.0), 300.0, 2.0, 23.0, 0, false),
            LEFT,
            10.0
        ));
    }

    #[test]
    fn the_lights_keep_the_systems_own_pitch() {
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 2, false),
            LEFT + 46.0,
            12.0
        ));
        assert!(at(
            spot((14.0, 16.0), 300.0, 0.0, 20.0, 1, false),
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
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 0, true),
            right,
            12.0
        ));
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 2, true),
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
