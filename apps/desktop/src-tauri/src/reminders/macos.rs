//! A Mac's own schedule: each reminder a notification request with a calendar trigger,
//! which the system delivers at its minute with nib quit (docs/tasks.md 5.10).
//!
//! `UNUserNotificationCenter`, under the app's bundle. A request's identifier is its
//! reminder's id, so the schedule is read back and taken apart by id (schedule.rs); a
//! snooze is a request of the system's own, named after the reminder with a suffix, and
//! no plan takes one off. Every reminder is in one category with Done and two snoozes:
//! Done reaches the app without bringing it forward (the system starts it where it is
//! not running) and comes back as a press (`pressed` in reminders.rs) with the nonce
//! kept for that id; a snooze is answered here, by asking again in 15 minutes or an
//! hour; a press on the notification itself opens the note at the task.
//!
//! A build that is not a bundle - `cargo run` - has no notification centre, and asking
//! for one ends the process; there the answer is no, and the page rings the plan itself.

use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread as _};
use objc2_foundation::{
    NSArray, NSBundle, NSCalendar, NSCalendarUnit, NSDate, NSError, NSObjectProtocol, NSSet,
    NSString,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNCalendarNotificationTrigger, UNMutableNotificationContent,
    UNNotification, UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
    UNNotificationCategoryOptions, UNNotificationPresentationOptions, UNNotificationRequest,
    UNNotificationResponse, UNNotificationSound, UNTimeIntervalNotificationTrigger,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::AppHandle;

use super::link::Act;
use super::schedule::System;
use super::{Planned, Words};

/// The category every reminder is in, and its actions' identifiers.
const CATEGORY: &str = "nib.reminder";
const DONE: &str = "done";
const LATER: &str = "snooze-15";
const HOUR: &str = "snooze-60";

/// How long the system has to say what it holds.
const PATIENCE: Duration = Duration::from_secs(2);

/// The app, for the delegate, which the system calls with nothing of ours.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Whether this process is a bundle the notification centre will answer.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

define_class!(
    /// What the notification centre tells about a reminder: a press on it or on one of
    /// its buttons, and one arriving while nib is in front, which is shown all the same.
    #[unsafe(super(NSObject))]
    #[name = "NibReminders"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            answered(response);
            completion.call(());
        }
    }
);

/// The delegate, made once and kept for the life of the process: the centre holds it
/// weakly.
#[allow(
    unsafe_code,
    reason = "a class of our own is initialised through the Objective-C runtime"
)]
fn delegate() -> Retained<Delegate> {
    let made = Delegate::alloc();
    // SAFETY: `init` is NSObject's own initialiser, called once on an object just
    // allocated, and the class has no instance variables of its own.
    unsafe { msg_send![made, init] }
}

/// Listens for presses from the launch on, so a press that started the app is heard:
/// the system hands it over once the delegate is set.
pub fn listen(app: &AppHandle) {
    if !bundled() || APP.set(app.clone()).is_err() {
        return;
    }
    let centre = UNUserNotificationCenter::currentNotificationCenter();
    let kept = delegate();
    centre.setDelegate(Some(ProtocolObject::from_ref(&*kept)));
    std::mem::forget(kept);
}

/// A press, answered: a snooze here, Done and a press on the notification by the app.
fn answered(response: &UNNotificationResponse) {
    let Some(app) = APP.get() else {
        return;
    };
    let action = response.actionIdentifier().to_string();
    let request = response.notification().request();
    let id = request.identifier().to_string();
    // A snooze of a snooze is the same reminder.
    let id = id.split('-').next().unwrap_or(&id).to_string();

    match action.as_str() {
        LATER | HOUR => {
            let minutes = if action == HOUR { 60.0 } else { 15.0 };
            let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
                minutes * 60.0,
                false,
            );
            let again = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&format!("{id}-{}", super::now_ms())),
                &request.content(),
                Some(&trigger),
            );
            UNUserNotificationCenter::currentNotificationCenter()
                .addNotificationRequest_withCompletionHandler(&again, None);
        }
        DONE => super::pressed_by_id(app, Act::Done, &id),
        _ => super::pressed_by_id(app, Act::Open, &id),
    }
}

/// The schedule of this app's bundle.
pub struct Requests {
    centre: Retained<UNUserNotificationCenter>,
}

impl Requests {
    /// The centre, asked once for leave to show anything, with the buttons in the
    /// reader's words.
    pub fn start(app: &AppHandle, words: &Words) -> Result<Self, String> {
        if !bundled() {
            return Err("not a bundle, so no notification centre".into());
        }
        listen(app);
        let centre = UNUserNotificationCenter::currentNotificationCenter();

        let asked = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        centre.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &asked,
        );

        let action = |id: &str, title: &str| {
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(id),
                &NSString::from_str(title),
                UNNotificationActionOptions::empty(),
            )
        };
        let actions = NSArray::from_retained_slice(&[
            action(DONE, &words.done),
            action(LATER, &format!("{} {}", words.snooze, words.minutes)),
            action(HOUR, &format!("{} {}", words.snooze, words.hour)),
        ]);
        let category =
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str(CATEGORY),
                &actions,
                &NSArray::new(),
                UNNotificationCategoryOptions::empty(),
            );
        centre.setNotificationCategories(&NSSet::from_retained_slice(&[category]));

        Ok(Self { centre })
    }
}

impl System for Requests {
    fn scheduled(&self) -> Result<Vec<String>, String> {
        let (said, heard) = mpsc::channel();
        let answer = RcBlock::new(
            move |requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>| {
                // SAFETY of the read: the system hands a live array for the call's length.
                let ids = ids_of(requests);
                let _ = said.send(ids);
            },
        );
        self.centre
            .getPendingNotificationRequestsWithCompletionHandler(&answer);
        let ids = heard
            .recv_timeout(PATIENCE)
            .map_err(|_| "the notification centre did not say what it holds".to_string())?;
        // A snooze is the system's own until it rings.
        Ok(ids.into_iter().filter(|id| !id.contains('-')).collect())
    }

    fn add(&self, one: &Planned, _nonce: &str, _words: &Words) -> Result<(), String> {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&one.title));
        content.setBody(&NSString::from_str(&one.body));
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
        content.setSound(Some(&UNNotificationSound::defaultSound()));

        #[allow(
            clippy::cast_precision_loss,
            reason = "milliseconds since 1970 are well inside a double's exact integers"
        )]
        let seconds = one.at as f64 / 1000.0;
        let date = NSDate::dateWithTimeIntervalSince1970(seconds);
        let units = NSCalendarUnit::Year
            | NSCalendarUnit::Month
            | NSCalendarUnit::Day
            | NSCalendarUnit::Hour
            | NSCalendarUnit::Minute;
        let parts = NSCalendar::currentCalendar().components_fromDate(units, &date);
        let trigger =
            UNCalendarNotificationTrigger::triggerWithDateMatchingComponents_repeats(&parts, false);

        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&one.id),
            &content,
            Some(&trigger),
        );
        self.centre
            .addNotificationRequest_withCompletionHandler(&request, None);
        Ok(())
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        let ids = NSArray::from_retained_slice(&[NSString::from_str(id)]);
        self.centre
            .removePendingNotificationRequestsWithIdentifiers(&ids);
        Ok(())
    }
}

/// The identifiers of the requests the centre handed over.
#[allow(
    unsafe_code,
    reason = "the centre hands its answer over as a bare pointer for the length of the call"
)]
fn ids_of(requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>) -> Vec<String> {
    // SAFETY: the pointer is the array the notification centre passes its completion
    // handler, alive for the whole of the call this runs inside.
    let requests = unsafe { requests.as_ref() };
    requests
        .iter()
        .map(|request| request.identifier().to_string())
        .collect()
}
