//! The Mac's menu bar, from the crate's side: the rows `AppKit` would add to it by
//! itself.
//!
//! The strip is the page's; see native-menu.ts. `AppKit` adds "Enter Full Screen" to
//! any menu titled View, and there it stood under the app's own Fullscreen row
//! (Ctrl+Cmd+F), which already asks for the Mac's full screen and puts the chrome
//! away with it. Two rows for one thing, with two keys, is one of them saying
//! something that is not quite so. `NSFullScreenMenuItemEverywhere` is `AppKit`'s own
//! switch for the row; it is registered rather than written, so it holds for this
//! run and is in nobody's preferences file.

/// The defaults key `AppKit` reads before it adds its full screen row.
const FULL_SCREEN_ROW: &str = "NSFullScreenMenuItemEverywhere";

/// Asks `AppKit` to leave its own full screen row out of the View menu. Called once,
/// before the page puts its strip up.
#[allow(
    unsafe_code,
    reason = "registering defaults takes a dictionary whose values the type system does not check"
)]
pub fn leave_out_system_rows() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str(FULL_SCREEN_ROW);
    let no = NSNumber::new_bool(false);
    let defaults: objc2::rc::Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[no.as_ref() as &AnyObject]);
    // SAFETY: the one value is an NSNumber, which is a property-list object, the
    // only kind the registration domain holds.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[cfg(test)]
mod tests {
    use super::{leave_out_system_rows, FULL_SCREEN_ROW};
    use objc2_foundation::{NSNumber, NSString, NSUserDefaults};

    #[test]
    fn the_full_screen_row_is_asked_to_stay_out() {
        leave_out_system_rows();

        let said = NSUserDefaults::standardUserDefaults()
            .objectForKey(&NSString::from_str(FULL_SCREEN_ROW))
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .map(|number| number.as_bool());
        assert_eq!(said, Some(false));
    }
}
