//! What a notification's buttons say, as a `nib://` link, and reading one back.
//!
//! A Windows toast can only start a program by a link (a protocol activation), and that
//! link reaches the app the way every other `nib://` link does (uris.rs). So a link is
//! the one shape every platform's Done and press come in by, and anybody on the machine
//! could write one: each reminder's links carry a nonce made when it was handed to the
//! system, kept by the crate and nowhere else, so a link nobody's notification made does
//! nothing at all. Done is the one that writes, and it can only tick the task its own
//! reminder was about.

/// What a press on a reminder asks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Act {
    /// Tick the task.
    Done,
    /// Open its note at its line.
    Open,
}

impl Act {
    fn word(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Open => "open",
        }
    }
}

/// The host every reminder's link is under.
const HOST: &str = "nib://reminder";

/// The link a press sends.
pub fn link(act: Act, id: &str, nonce: &str) -> String {
    format!("{HOST}?act={}&id={id}&n={nonce}", act.word())
}

/// Whether an address is a reminder's at all, whatever it says after: such a link
/// never brings the window forward on its own (a Done is answered out of sight).
pub fn is_reminder(url: &str) -> bool {
    url.trim()
        .get(..HOST.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(HOST))
}

/// A reminder's link read back: what it asks, of which reminder, with which nonce.
/// None for anything else, or a link with a part missing or written twice.
pub fn parsed(url: &str) -> Option<(Act, String, String)> {
    let url = url.trim();
    if !is_reminder(url) {
        return None;
    }
    let query = url.get(HOST.len()..)?.strip_prefix('?')?;

    let (mut act, mut id, mut nonce) = (None, None, None);
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let (slot, hex) = match key {
            "act" => (&mut act, false),
            "id" => (&mut id, true),
            "n" => (&mut nonce, true),
            _ => continue,
        };
        if slot.is_some() || (hex && !plain(value)) {
            return None;
        }
        *slot = Some(value.to_string());
    }

    let act = match act?.as_str() {
        "done" => Act::Done,
        "open" => Act::Open,
        _ => return None,
    };
    Some((act, id?, nonce?))
}

/// Ids and nonces are hex digits, and nothing a link could smuggle anything else in by.
fn plain(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_reads_back_as_what_it_said() {
        let made = link(Act::Done, "00ff00ff00ff00ff", "abcdef0123456789");
        assert_eq!(
            made,
            "nib://reminder?act=done&id=00ff00ff00ff00ff&n=abcdef0123456789"
        );
        assert_eq!(
            parsed(&made),
            Some((
                Act::Done,
                "00ff00ff00ff00ff".to_string(),
                "abcdef0123456789".to_string()
            ))
        );
        assert_eq!(
            parsed(&link(Act::Open, "aa", "bb")).map(|(act, _, _)| act),
            Some(Act::Open)
        );
    }

    #[test]
    fn anything_else_is_no_reminder() {
        assert_eq!(parsed("nib://open?path=Plan.md"), None);
        assert!(!is_reminder("nib://open?path=Plan.md"));
        assert!(is_reminder("NIB://Reminder?act=done"));
        assert_eq!(parsed("nib://reminder?act=delete&id=aa&n=bb"), None);
        assert_eq!(parsed("nib://reminder?act=done&id=aa"), None);
        assert_eq!(parsed("nib://reminder?act=done&id=aa&id=bb&n=cc"), None);
        assert_eq!(parsed("nib://reminder?act=done&id=../x&n=cc"), None);
        assert_eq!(parsed("nib://reminders?act=done&id=aa&n=cc"), None);
    }
}
