//! A notice as a Mac's notification, heard back by the delegate reminders set.
//!
//! `UNUserNotificationCenter`, under the app's bundle: a request delivered at once, named
//! `notice.` and its id so the delegate (reminders/macos.rs) knows it from a reminder and
//! hands it here, and threaded by its tag so the system groups one chat's together. A
//! second notice with the same tag takes the first one's place. Where the page offers an
//! answer, the request is in a category with a text field, Messages' own inline reply;
//! what was typed arrives as the response's text.
//!
//! A build that is not a bundle - `cargo run` - has no notification centre, and asking
//! for one ends the process; there nothing is shown.

use std::collections::HashMap;
use std::sync::{Mutex, Once, PoisonError};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSArray, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNTextInputNotificationAction, UNTextInputNotificationResponse,
    UNUserNotificationCenter,
};
use tauri::AppHandle;

use super::{Act, Notice};

/// The category of a notice with a field to answer in, and its one action.
pub const CATEGORY: &str = "nib.notice.reply";
const SEND: &str = "send";

/// What every notice's request is named by, before its id.
const PREFIX: &str = "notice.";

/// Leave to show anything, asked of the reader once a run.
static ASKED: Once = Once::new();

/// The request each tag is showing, so the next one takes its place.
static SHOWING: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn in_showing<T>(alter: impl FnOnce(&mut HashMap<String, String>) -> T) -> T {
    let mut held = SHOWING.lock().unwrap_or_else(PoisonError::into_inner);
    alter(held.get_or_insert_with(HashMap::new))
}

/// The field a notice is answered in, in the reader's words.
pub fn reply_action(placeholder: &str, send: &str) -> Retained<UNNotificationAction> {
    let action =
        UNTextInputNotificationAction::actionWithIdentifier_title_options_textInputButtonTitle_textInputPlaceholder(
            &NSString::from_str(SEND),
            &NSString::from_str(send),
            UNNotificationActionOptions::empty(),
            &NSString::from_str(send),
            &NSString::from_str(placeholder),
        );
    Retained::into_super(action)
}

/// Shows one notice, replacing whatever its tag showed.
pub fn show(app: &AppHandle, notice: &Notice) -> Result<(), String> {
    use crate::reminders::macos as centre_of;

    if !centre_of::bundled() {
        return Err("not a bundle, so no notification centre".into());
    }
    centre_of::listen(app);
    let centre = UNUserNotificationCenter::currentNotificationCenter();
    ASKED.call_once(|| {
        let asked = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        centre.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &asked,
        );
    });

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&notice.title));
    content.setBody(&NSString::from_str(&notice.body));
    content.setThreadIdentifier(&NSString::from_str(&notice.tag));
    if let Some(reply) = &notice.reply {
        centre_of::reply_words(&reply.placeholder, &reply.send);
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
    }
    if !notice.silent {
        let sound = UNNotificationSound::defaultSound();
        content.setSound(Some(&*sound));
    }

    let name = format!("{PREFIX}{}", notice.id);
    if let Some(before) = in_showing(|showing| showing.insert(notice.tag.clone(), name.clone())) {
        centre.removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&[
            NSString::from_str(&before),
        ]));
    }
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&name),
        &content,
        None,
    );
    centre.addNotificationRequest_withCompletionHandler(&request, None);
    Ok(())
}

/// A response the delegate heard, answered here if it was a notice's. Answers whether it
/// was, so the delegate does not read it as a reminder's.
pub fn answer(app: &AppHandle, response: &UNNotificationResponse, name: &str) -> bool {
    let Some(id) = name.strip_prefix(PREFIX) else {
        return false;
    };
    let action = response.actionIdentifier().to_string();
    if action == SEND {
        let text = response
            .downcast_ref::<UNTextInputNotificationResponse>()
            .map(|typed| typed.userText().to_string());
        super::answered(app, id, Act::Reply, text);
    } else {
        super::answered(app, id, Act::Open, None);
    }
    true
}

/// Takes whatever a tag is showing out of the notification centre.
pub fn clear(tag: &str) {
    if !crate::reminders::macos::bundled() {
        return;
    }
    if let Some(name) = in_showing(|showing| showing.remove(tag)) {
        UNUserNotificationCenter::currentNotificationCenter()
            .removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&[
                NSString::from_str(&name),
            ]));
    }
}

/// Takes every notice out of the notification centre, and none of the reminders.
pub fn clear_all() {
    if !crate::reminders::macos::bundled() {
        return;
    }
    let names: Vec<Retained<NSString>> = in_showing(|showing| {
        showing
            .drain()
            .map(|(_, name)| NSString::from_str(&name))
            .collect()
    });
    if !names.is_empty() {
        UNUserNotificationCenter::currentNotificationCenter()
            .removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&names));
    }
}
