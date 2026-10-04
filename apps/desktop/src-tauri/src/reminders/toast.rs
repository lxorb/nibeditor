//! A reminder as a Windows toast, in the XML the system reads.
//!
//! The shape Windows' own Alarms and Calendar use for something that must not be
//! missed: `scenario="reminder"`, which keeps the toast on screen until it is dealt with;
//! the system's own snooze, with a choice of 15 minutes, an hour or tomorrow morning,
//! which Windows carries out itself without starting anything; and Done, a `nib://` link
//! (link.rs), which reaches the app however it is running. A press on the toast itself
//! opens the note at the task.
//!
//! Pure, so the XML is tested on every runner; only Windows builds a toast from it.

use std::fmt::Write as _;

use super::link::{link, Act};
use super::{Planned, Words};

/// Minutes in the two fixed snoozes.
const SNOOZES: [u32; 2] = [15, 60];

/// The toast for one reminder.
pub fn xml(one: &Planned, nonce: &str, words: &Words) -> String {
    let open = escaped(&link(Act::Open, &one.id, nonce));
    let done = escaped(&link(Act::Done, &one.id, nonce));

    let mut choices = String::new();
    let mut add = |minutes: u32, label: &str| {
        // One choice per number of minutes: the system reads the id as the snooze.
        if !choices.contains(&format!("id=\"{minutes}\"")) {
            let _ = write!(
                choices,
                "<selection id=\"{minutes}\" content=\"{}\"/>",
                escaped(label)
            );
        }
    };
    add(SNOOZES[0], &words.minutes);
    add(SNOOZES[1], &words.hour);
    if let Some(minutes) = one.tomorrow.filter(|minutes| *minutes > 0) {
        add(minutes, &words.tomorrow);
    }

    format!(
        concat!(
            "<toast launch=\"{open}\" activationType=\"protocol\" scenario=\"reminder\">",
            "<visual><binding template=\"ToastGeneric\">",
            "<text>{title}</text><text>{body}</text>",
            "</binding></visual>",
            "<actions>",
            "<input id=\"snooze\" type=\"selection\" defaultInput=\"{first}\">{choices}</input>",
            "<action activationType=\"system\" arguments=\"snooze\" hint-inputId=\"snooze\" content=\"{snooze}\"/>",
            "<action activationType=\"protocol\" arguments=\"{done}\" content=\"{done_word}\"/>",
            "</actions>",
            "</toast>"
        ),
        open = open,
        title = escaped(&one.title),
        body = escaped(&one.body),
        first = SNOOZES[0],
        choices = choices,
        snooze = escaped(&words.snooze),
        done = done,
        done_word = escaped(&words.done),
    )
}

/// Text as XML holds it, in an attribute or between tags alike.
fn escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // A control character is not XML at all, and the system refuses the toast.
            one if one.is_control() && one != '\t' => out.push(' '),
            one => out.push(one),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reminders::schedule::tests::planned;

    #[test]
    fn a_toast_says_the_task_and_offers_snooze_and_done() {
        let mut one = planned("00ff00ff00ff00ff", 1);
        one.title = "Pay <rent> & \"bills\"".into();
        one.tomorrow = Some(900);
        let made = xml(&one, "0123", &Words::default());

        assert!(made.starts_with(
            "<toast launch=\"nib://reminder?act=open&amp;id=00ff00ff00ff00ff&amp;n=0123\""
        ));
        assert!(made.contains("scenario=\"reminder\""));
        assert!(
            made.contains("<text>Pay &lt;rent&gt; &amp; &quot;bills&quot;</text><text>Plan</text>")
        );
        assert!(made.contains(
            "<selection id=\"15\" content=\"15 min\"/><selection id=\"60\" content=\"1 h\"/><selection id=\"900\" content=\"Tomorrow\"/>"
        ));
        assert!(made.contains("arguments=\"nib://reminder?act=done&amp;id=00ff00ff00ff00ff&amp;n=0123\" content=\"Done\""));
    }

    #[test]
    fn tomorrow_morning_an_hour_away_is_offered_once() {
        let mut one = planned("aa", 1);
        one.tomorrow = Some(60);
        let made = xml(&one, "bb", &Words::default());
        assert_eq!(made.matches("id=\"60\"").count(), 1);
        assert!(!made.contains("Tomorrow"));
    }

    #[test]
    fn a_control_character_in_a_task_is_a_space() {
        assert_eq!(escaped("a\u{0}b\tc"), "a b\tc");
    }
}
