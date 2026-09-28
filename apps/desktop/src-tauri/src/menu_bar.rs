//! The Mac's menu bar, from the crate's side: what `AppKit` would do to it by itself.
//!
//! The strip is the page's; see native-menu.ts. Two things `AppKit` does to any menu
//! bar are undone here.
//!
//! It adds "Enter Full Screen" to any menu titled View, and there it stood under the
//! app's own Fullscreen row (Ctrl+Cmd+F), which already asks for the Mac's full screen
//! and puts the chrome away with it. Two rows for one thing, with two keys, is one of
//! them saying something that is not quite so. `NSFullScreenMenuItemEverywhere` is
//! `AppKit`'s own switch for the row; it is registered rather than written, so it
//! holds for this run and is in nobody's preferences file.
//!
//! And it rewrites a row's key for the keyboard layout in use. Nib has a table of keys
//! of its own, which the reader rebinds in Settings > Keyboard and the page matches
//! presses against, and `AppKit` rewriting it behind that table broke both: on a
//! QWERTZ keyboard Zoom in's Cmd+= became Cmd+*, which is what Shift+Cmd+] - the next
//! tab, matched by the key rather than the character - types there, so the next tab
//! zoomed the note instead; and the menu's hints stopped saying what the settings
//! said. So every row keeps the key it was given.

/// The defaults key `AppKit` reads before it adds its full screen row.
#[cfg(target_os = "macos")]
const FULL_SCREEN_ROW: &str = "NSFullScreenMenuItemEverywhere";

/// Asks `AppKit` to leave its own full screen row out of the View menu. Called once,
/// before the page puts its strip up.
#[cfg(target_os = "macos")]
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

/// Keeps every row of the menu bar on the key it was given; see the top of this file.
/// The page asks as it puts a strip up, since a strip is new rows each time. Nothing
/// to do anywhere but a Mac, where there is no such menu bar.
#[tauri::command]
pub fn keep_keys_as_written(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(as_written);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn as_written() {
    let Some(main) = objc2::MainThreadMarker::new() else {
        return;
    };
    if let Some(menu) = objc2_app_kit::NSApplication::sharedApplication(main).mainMenu() {
        each_row(&menu);
    }
}

#[cfg(target_os = "macos")]
fn each_row(menu: &objc2_app_kit::NSMenu) {
    for row in &menu.itemArray() {
        row.setAllowsAutomaticKeyEquivalentLocalization(false);
        if let Some(inner) = row.submenu() {
            each_row(&inner);
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
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
