//! Windows' own schedule of toasts: a reminder handed to the system rings at its minute
//! with nib not running at all (docs/tasks.md 5.10).
//!
//! `ToastNotifier.AddToSchedule` under the app's own id, the one the notification plugin
//! already shows toasts under and the installer writes onto the Start menu's shortcut.
//! Each toast is tagged with its reminder's id and grouped under one name, so the
//! schedule is read back and taken apart by tag (schedule.rs). A Windows that refuses -
//! an id nothing registered, a build run from a folder no installer wrote - answers an
//! error, and the page then rings the plan itself while it runs (docs/tasks.md 7.3).
//!
//! Called on the window's own thread, whose apartment the app already set up: the
//! command that hands the plan over is not `async` for that reason (lib.rs).

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::DateTime;
use windows::UI::Notifications::{
    ScheduledToastNotification, ToastNotificationManager, ToastNotifier,
};

use super::schedule::System;
use super::{toast, Planned, Words};

/// The group every reminder's toast is in, so nothing else the app schedules is read
/// as one.
const GROUP: &str = "nib.reminders";

/// Milliseconds between 1601, where Windows counts from, and 1970.
const EPOCH_GAP_MS: i64 = 11_644_473_600_000;

/// The schedule of one app id.
pub struct Toasts {
    notifier: ToastNotifier,
}

impl Toasts {
    /// The schedule of the app the id names.
    pub fn of(app_id: &str) -> Result<Self, String> {
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
            .map_err(|error| error.message())?;
        Ok(Self { notifier })
    }

    /// The reminders' toasts on the schedule, by tag.
    fn ours(&self) -> Result<Vec<(String, ScheduledToastNotification)>, String> {
        let listed = self
            .notifier
            .GetScheduledToastNotifications()
            .map_err(|error| error.message())?;
        let count = listed.Size().map_err(|error| error.message())?;
        let mut found = Vec::new();
        for at in 0..count {
            let Ok(one) = listed.GetAt(at) else {
                continue;
            };
            let group = one
                .Group()
                .map(|group| group.to_string())
                .unwrap_or_default();
            let tag = one.Tag().map(|tag| tag.to_string()).unwrap_or_default();
            if group == GROUP && !tag.is_empty() {
                found.push((tag, one));
            }
        }
        Ok(found)
    }
}

impl System for Toasts {
    fn scheduled(&self) -> Result<Vec<String>, String> {
        Ok(self.ours()?.into_iter().map(|(tag, _)| tag).collect())
    }

    fn add(&self, one: &Planned, nonce: &str, words: &Words) -> Result<(), String> {
        let document = XmlDocument::new().map_err(|error| error.message())?;
        document
            .LoadXml(&HSTRING::from(toast::xml(one, nonce, words)))
            .map_err(|error| error.message())?;
        let when = DateTime {
            UniversalTime: (one.at + EPOCH_GAP_MS) * 10_000,
        };
        let scheduled =
            ScheduledToastNotification::CreateScheduledToastNotification(&document, when)
                .map_err(|error| error.message())?;
        scheduled
            .SetTag(&HSTRING::from(one.id.as_str()))
            .map_err(|error| error.message())?;
        scheduled
            .SetGroup(&HSTRING::from(GROUP))
            .map_err(|error| error.message())?;
        self.notifier
            .AddToSchedule(&scheduled)
            .map_err(|error| error.message())
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        for (tag, one) in self.ours()? {
            if tag == id {
                self.notifier
                    .RemoveFromSchedule(&one)
                    .map_err(|error| error.message())?;
            }
        }
        Ok(())
    }
}
