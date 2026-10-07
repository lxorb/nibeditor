//! A notice as a Windows toast under the app's own id, heard back in this process.
//!
//! `ToastNotifier.Show` under the id the notification plugin and the reminders already
//! use, which the installer writes onto the Start menu's shortcut. Each toast is tagged
//! with its notice's tag and grouped under one name, so a second one with the same tag
//! replaces the first and the history is taken apart by tag and group. A press is the
//! toast's own `Activated`, raised on a thread of the system's while nib runs: a press
//! on Send carries what was typed in the toast's field as its user input.
//!
//! A probe's toast goes straight into the action centre (`SuppressPopup`), where the
//! drive can read it without anything appearing on anybody's screen.

use tauri::AppHandle;
use windows::core::{Interface as _, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::{IPropertyValue, TypedEventHandler};
use windows::UI::Notifications::{
    ToastActivatedEventArgs, ToastNotification, ToastNotificationManager,
};

use super::toast::{self, REPLY_ARGUMENT, REPLY_INPUT};
use super::{Act, Notice};

/// The group every notice's toast is in, apart from the reminders' scheduled ones.
const GROUP: &str = "nib.notices";

fn failed(error: &windows::core::Error) -> String {
    error.message()
}

/// Shows one notice, replacing whatever its tag showed.
pub fn show(app: &AppHandle, notice: &Notice, quietly: bool) -> Result<(), String> {
    let document = XmlDocument::new().map_err(|error| failed(&error))?;
    document
        .LoadXml(&HSTRING::from(toast::xml(notice)))
        .map_err(|error| failed(&error))?;
    let shown = ToastNotification::CreateToastNotification(&document).map_err(|error| failed(&error))?;
    shown
        .SetTag(&HSTRING::from(notice.tag.as_str()))
        .map_err(|error| failed(&error))?;
    shown
        .SetGroup(&HSTRING::from(GROUP))
        .map_err(|error| failed(&error))?;
    if quietly {
        shown.SetSuppressPopup(true).map_err(|error| failed(&error))?;
    }

    let app_for_press = app.clone();
    let id = notice.id.clone();
    let heard = TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(
        move |_, args| {
            let (act, text) = pressed(args.as_ref());
            super::answered(&app_for_press, &id, act, text);
            Ok(())
        },
    );
    shown.Activated(&heard).map_err(|error| failed(&error))?;

    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
        app.config().identifier.as_str(),
    ))
    .and_then(|notifier| notifier.Show(&shown))
    .map_err(|error| failed(&error))
}

/// What a press was: Send with the words in the field, or a press on the toast.
fn pressed(args: Option<&windows::core::IInspectable>) -> (Act, Option<String>) {
    let Some(args) = args.and_then(|args| args.cast::<ToastActivatedEventArgs>().ok()) else {
        return (Act::Open, None);
    };
    let reply = args
        .Arguments()
        .is_ok_and(|arguments| arguments == REPLY_ARGUMENT);
    if !reply {
        return (Act::Open, None);
    }
    let text = args
        .UserInput()
        .and_then(|input| input.Lookup(&HSTRING::from(REPLY_INPUT)))
        .and_then(|value| value.cast::<IPropertyValue>())
        .and_then(|value| value.GetString())
        .map(|text| text.to_string())
        .ok();
    (Act::Reply, text)
}

/// Takes whatever a tag is showing out of the action centre.
pub fn clear(app: &AppHandle, tag: &str) -> Result<(), String> {
    ToastNotificationManager::History()
        .and_then(|history| {
            history.RemoveGroupedTagWithId(
                &HSTRING::from(tag),
                &HSTRING::from(GROUP),
                &HSTRING::from(app.config().identifier.as_str()),
            )
        })
        .map_err(|error| failed(&error))
}

/// Takes every notice out of the action centre.
pub fn clear_all(app: &AppHandle) {
    // Nothing to do about a history that would not answer: the toasts left in it answer
    // nothing, which is what Windows does with a press for an app that has gone.
    let _ = ToastNotificationManager::History().and_then(|history| {
        history.RemoveGroupWithId(
            &HSTRING::from(GROUP),
            &HSTRING::from(app.config().identifier.as_str()),
        )
    });
}
