//! Notifications the page shows that answer back (src/lib/notify.ts): a press on one
//! brings its window forward and tells the page which one it was, and a reply typed into
//! one is handed to the page to send (docs/chats.md 4.11).
//!
//! **Heard in this process.** On Windows a toast of our own XML (toast.rs) whose presses
//! are foreground activations, heard by the toast's own `Activated` (windows.rs); on a
//! Mac a notification request with a text field in its category, heard by the
//! notification centre's delegate that reminders already set (reminders/macos.rs). So no
//! press ever arrives as a link another program could write, and none reaches a nib that
//! is not running: every notice is taken off the screen as the app goes (`clear_all`),
//! where a reply field left behind in the action centre would answer nothing. Linux
//! shows the plugin's plain notification, with nothing to press but the notification.
//!
//! **One per tag.** A second notice with the same tag (a chat's id) replaces the first
//! rather than stacking, and the page takes a tag back (`notice_clear`) once what it was
//! about has been read.
//!
//! **Never a probe's**, unless the probe asks: a toast is on the screen of whoever is at
//! the machine. A probe started with `NIB_PROBE_NOTICES` shows its notices straight
//! into the action centre, with no banner, where the drive reads them and takes them off
//! again (scripts/chat-notify-probe.py).

#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(any(windows, test))]
mod toast;
#[cfg(windows)]
mod windows;

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _, Manager as _};

/// What the page is told when a notice was pressed.
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
const PRESSED: &str = "nib://notice";

/// The longest tag the system keeps: Windows' own limit for a toast's.
const LONGEST_TAG: usize = 64;

/// One notice as the page asks for it; see `Notice` in src/lib/notify.ts.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    /// Hex digits the page made, which a press is answered by.
    pub id: String,
    /// One notice per tag: a second replaces the first.
    pub tag: String,
    pub title: String,
    pub body: String,
    /// A quieter line under the words: what it is from.
    #[cfg_attr(
        not(any(windows, test)),
        allow(dead_code, reason = "only a Windows toast has a line for it")
    )]
    pub from: String,
    #[cfg_attr(
        not(any(windows, target_os = "macos", test)),
        allow(
            dead_code,
            reason = "Linux shows the plugin's notification, with its own sound"
        )
    )]
    pub silent: bool,
    /// A field to answer in, where the system has one.
    #[cfg_attr(
        not(any(windows, target_os = "macos", test)),
        allow(
            dead_code,
            reason = "Linux shows a notification with nothing to type in"
        )
    )]
    pub reply: Option<Reply>,
}

/// The words of a notice's answer field, in the reader's language.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos", test)),
    allow(
        dead_code,
        reason = "Linux shows a notification with nothing to type in"
    )
)]
pub struct Reply {
    pub placeholder: String,
    pub send: String,
}

/// What a press did: opened the notice, or sent words from its field.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
pub enum Act {
    Open,
    Reply,
}

/// What the page is told.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
struct Answer {
    id: String,
    act: Act,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

/// Which window showed each notice still on screen, by id, so a press brings that one
/// forward and is told to that one alone.
static WINDOWS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn in_windows<T>(alter: impl FnOnce(&mut HashMap<String, String>) -> T) -> T {
    let mut held = WINDOWS.lock().unwrap_or_else(PoisonError::into_inner);
    alter(held.get_or_insert_with(HashMap::new))
}

/// How many notices a press is still answered for; the oldest goes first.
const KEPT: usize = 64;

/// Whether a notice is one the system can be handed: an id and a tag of plain
/// characters, and a tag no longer than Windows keeps.
fn plain(notice: &Notice) -> bool {
    let word = |text: &str, most: usize| {
        !text.is_empty()
            && text.len() <= most
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    word(&notice.id, 64) && word(&notice.tag, LONGEST_TAG)
}

/// Whether this run may show anything: never a probe's, unless the probe was started to
/// prove exactly that.
fn probing() -> bool {
    crate::placement::away().is_some()
}

/// Shows one notice. On the window's own thread, where Linux's notification plugin is
/// added and whose apartment Windows' notifier is reached through.
#[tauri::command]
pub fn notice_show(webview: tauri::Webview, app: AppHandle, notice: Notice) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    if !plain(&notice) {
        return Err("a notice is named by plain characters".into());
    }
    if probing() && !(cfg!(windows) && std::env::var_os("NIB_PROBE_NOTICES").is_some()) {
        return Ok(());
    }
    in_windows(|windows| {
        if windows.len() >= KEPT {
            windows.clear();
        }
        windows.insert(notice.id.clone(), webview.window().label().to_string());
    });
    shown(&app, &notice)
}

/// Takes back whatever is showing under a tag.
#[tauri::command(async)]
pub fn notice_clear(webview: tauri::Webview, app: AppHandle, tag: String) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    #[cfg(windows)]
    windows::clear(&app, &tag)?;
    #[cfg(target_os = "macos")]
    macos::clear(&tag);
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = (app, tag);
    Ok(())
}

/// Every notice off the screen, as the app goes: one left in the action centre would
/// answer nothing once nobody is listening.
pub fn clear_all(app: &AppHandle) {
    #[cfg(windows)]
    windows::clear_all(app);
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::clear_all();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = app;
}

fn shown(app: &AppHandle, notice: &Notice) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows::show(app, notice, probing())
    }
    #[cfg(target_os = "macos")]
    {
        macos::show(app, notice)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        crate::agents::shell::notify(app, notice.title.clone(), notice.body.clone());
        Ok(())
    }
}

/// A press the system heard: the window that showed the notice comes forward for an
/// open, and is told either way.
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
pub fn answered(app: &AppHandle, id: &str, act: Act, text: Option<String>) {
    let label = in_windows(|windows| windows.get(id).cloned());
    let window = label
        .as_deref()
        .and_then(|label| app.get_window(label))
        .or_else(|| crate::agents::shell::host(app));
    let Some(window) = window else {
        return;
    };
    if act == Act::Open {
        let _ = window.show();
        crate::placement::raised(&window);
    }
    let answer = Answer {
        id: id.to_string(),
        act,
        text,
    };
    let _ = app.emit_to(window.label(), PRESSED, answer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(id: &str, tag: &str) -> Notice {
        Notice {
            id: id.into(),
            tag: tag.into(),
            title: String::new(),
            body: String::new(),
            from: String::new(),
            silent: true,
            reply: None,
        }
    }

    #[test]
    fn a_notice_is_named_by_plain_characters() {
        assert!(plain(&notice(
            "00ff00ff00ff00ff",
            "c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e"
        )));
        assert!(plain(&notice("ab", "terminal-12")));
        assert!(!plain(&notice("", "a")));
        assert!(!plain(&notice("ab", "")));
        assert!(!plain(&notice("ab", "a b")));
        assert!(!plain(&notice("ab", &"x".repeat(65))));
        assert!(!plain(&notice("a\"b", "a")));
    }

    #[test]
    fn the_page_reads_a_notice_as_it_writes_one() {
        let read: Notice = serde_json::from_value(serde_json::json!({
            "id": "00ff", "tag": "c_1", "title": "Lucile", "body": "Hi", "from": "#thesis",
            "silent": false, "reply": { "placeholder": "Reply", "send": "Send" },
        }))
        .expect("the page's shape");
        assert_eq!(read.reply.map(|reply| reply.send), Some("Send".to_string()));
        let answer = serde_json::to_value(Answer {
            id: "00ff".into(),
            act: Act::Reply,
            text: Some("ok".into()),
        })
        .expect("an answer");
        assert_eq!(
            answer,
            serde_json::json!({ "id": "00ff", "act": "reply", "text": "ok" })
        );
    }
}
