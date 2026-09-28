//! The Mac's menu bar, from the crate's side: the rows `AppKit` would add to it by
//! itself, and the actions its own rows send.
//!
//! The strip is the page's; see native-menu.ts. `AppKit` adds "Enter Full Screen" to
//! any menu titled View, and there it stood under the app's own Fullscreen row
//! (Ctrl+Cmd+F), which already asks for the Mac's full screen and puts the chrome
//! away with it. Two rows for one thing, with two keys, is one of them saying
//! something that is not quite so. `NSFullScreenMenuItemEverywhere` is `AppKit`'s own
//! switch for the row; it is registered rather than written, so it holds for this
//! run and is in nobody's preferences file.
//!
//! One more thing `AppKit` does is left as it is: it rewrites a row's key for the
//! keyboard layout in use, so on QWERTZ Fold's Opt+Cmd+[ reads Opt+Cmd+Ö. That
//! looks like it is overriding Nib's own table, and turning it off was tried. But a
//! key equivalent is matched by the character it types, and QWERTZ types `[` with
//! Opt+5, so Opt+Cmd+5 folded the note rather than making Heading 5. The rewrite is
//! what keeps rows like that apart on every layout.
//!
//! And Undo, Redo and Select All are the page's rows rather than `AppKit`'s, which
//! send their key to the page first; see `standIn` in native-menu-bar.svelte.ts. What
//! the page does not take comes back here, to go where `AppKit`'s own row would have
//! sent it.

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

/// One of `AppKit`'s own edit actions, which a row of the page's stands in for. Named
/// rather than any selector the page cares to send, so these three are all it can.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StandIn {
    Undo,
    Redo,
    SelectAll,
}

/// Sends the action to whatever has the keyboard, the way `AppKit`'s own row would:
/// a field in the page, which undoes its own typing, or a site in a web tab. Nothing
/// to do anywhere but a Mac, where the page's menu is in the window and its keys
/// reach the page.
#[tauri::command]
pub fn hand_to_keyboard(app: tauri::AppHandle, action: StandIn) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || send(action));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, action);
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "an action is sent by selector, which the type system cannot check"
)]
fn send(action: StandIn) {
    let Some(main) = objc2::MainThreadMarker::new() else {
        return;
    };
    let selector = match action {
        StandIn::Undo => objc2::sel!(undo:),
        StandIn::Redo => objc2::sel!(redo:),
        StandIn::SelectAll => objc2::sel!(selectAll:),
    };
    // SAFETY: each selector is one of NSResponder's standard edit actions, which
    // take the sender and nothing else, and a nil target is AppKit's own way of
    // saying "the first responder that answers it", which is what the system's rows
    // send.
    unsafe {
        objc2_app_kit::NSApplication::sharedApplication(main)
            .sendAction_to_from(selector, None, None);
    }
}

#[cfg(test)]
mod tests {
    use super::StandIn;

    #[test]
    fn the_page_asks_for_an_action_by_the_name_it_writes() {
        let named = |text: &str| serde_json::from_str::<StandIn>(text).ok();

        assert_eq!(named("\"undo\""), Some(StandIn::Undo));
        assert_eq!(named("\"redo\""), Some(StandIn::Redo));
        assert_eq!(named("\"selectAll\""), Some(StandIn::SelectAll));
        // Nothing else, not even another of the responder's own.
        assert_eq!(named("\"copy\""), None);
        assert_eq!(named("\"terminate:\""), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_full_screen_row_is_asked_to_stay_out() {
        use objc2_foundation::{NSNumber, NSString, NSUserDefaults};

        super::leave_out_system_rows();

        let said = NSUserDefaults::standardUserDefaults()
            .objectForKey(&NSString::from_str(super::FULL_SCREEN_ROW))
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .map(|number| number.as_bool());
        assert_eq!(said, Some(false));
    }
}
