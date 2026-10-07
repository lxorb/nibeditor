//! A notice as a Windows toast, in the XML the system reads.
//!
//! The shape Windows' own messaging apps use: the title, the words and a quieter line
//! of where it came from; a field to answer in with a Send beside it where the page
//! offers one, which Teams and every messenger put on theirs; the instant-message sound, or
//! none. Every press is a foreground activation, heard in this process by the toast's
//! own `Activated` (windows.rs): never a `nib://` link, which would start whichever nib
//! registered the scheme, and never one that lands in an app that is not running,
//! because a notice is taken off the screen when nib quits (notices.rs).
//!
//! Pure, so the XML is tested on every runner; only Windows builds a toast from it.

use std::fmt::Write as _;

use super::Notice;

/// The id of the field a reply is typed into, which the activation's input is read by.
pub const REPLY_INPUT: &str = "reply";

/// What a press on Send says, apart from a press on the toast itself.
pub const REPLY_ARGUMENT: &str = "reply";

/// The toast for one notice.
pub fn xml(notice: &Notice) -> String {
    let mut texts = format!(
        "<text>{}</text><text>{}</text>",
        escaped(&notice.title),
        escaped(&notice.body)
    );
    if !notice.from.is_empty() {
        let _ = write!(
            texts,
            "<text placement=\"attribution\">{}</text>",
            escaped(&notice.from)
        );
    }

    let actions = notice.reply.as_ref().map_or_else(String::new, |reply| {
        format!(
            concat!(
                "<actions>",
                "<input id=\"{input}\" type=\"text\" placeHolderContent=\"{placeholder}\"/>",
                "<action content=\"{send}\" arguments=\"{argument}\" hint-inputId=\"{input}\" activationType=\"foreground\"/>",
                "</actions>"
            ),
            input = REPLY_INPUT,
            placeholder = escaped(&reply.placeholder),
            send = escaped(&reply.send),
            argument = REPLY_ARGUMENT,
        )
    });

    let audio = if notice.silent {
        "<audio silent=\"true\"/>"
    } else {
        "<audio src=\"ms-winsoundevent:Notification.IM\"/>"
    };

    format!(
        "<toast activationType=\"foreground\" launch=\"open\"><visual><binding template=\"ToastGeneric\">{texts}</binding></visual>{actions}{audio}</toast>"
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
            one if one.is_control() && one != '\t' && one != '\n' => out.push(' '),
            one => out.push(one),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::Reply;
    use super::*;

    fn notice() -> Notice {
        Notice {
            id: "00ff00ff00ff00ff".into(),
            tag: "c_3f9a".into(),
            title: "Lucile".into(),
            body: "The figures <are> in & \"done\"".into(),
            from: "#thesis".into(),
            silent: true,
            reply: None,
        }
    }

    #[test]
    fn a_toast_says_who_what_and_where_and_opens_in_this_process() {
        let made = xml(&notice());
        assert!(made.starts_with("<toast activationType=\"foreground\" launch=\"open\">"));
        assert!(made.contains(
            "<text>Lucile</text><text>The figures &lt;are&gt; in &amp; &quot;done&quot;</text><text placement=\"attribution\">#thesis</text>"
        ));
        assert!(made.contains("<audio silent=\"true\"/>"));
        assert!(!made.contains("<actions>"));
        assert!(!made.contains("nib://"));
    }

    #[test]
    fn a_reply_is_a_field_and_send() {
        let mut one = notice();
        one.reply = Some(Reply {
            placeholder: "Reply".into(),
            send: "Send".into(),
        });
        one.silent = false;
        one.from = String::new();
        let made = xml(&one);
        assert!(made.contains(
            "<input id=\"reply\" type=\"text\" placeHolderContent=\"Reply\"/><action content=\"Send\" arguments=\"reply\" hint-inputId=\"reply\" activationType=\"foreground\"/>"
        ));
        assert!(made.contains("<audio src=\"ms-winsoundevent:Notification.IM\"/>"));
        assert!(!made.contains("attribution"));
    }

    #[test]
    fn a_control_character_is_a_space_and_a_line_stays_a_line() {
        assert_eq!(escaped("a\u{0}b\tc\nd"), "a b\tc\nd");
    }
}
