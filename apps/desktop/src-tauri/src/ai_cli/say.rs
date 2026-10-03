//! What the window may say to a session, and what a session says back.
//!
//! The window never writes to a program. It names one of these, and session.rs (Claude
//! Code) or `codex_app.rs` (Codex) writes the message the program reads: so a page that got
//! hold of the bridge can send words, pick a model or an effort, stop a turn and ask for
//! the window's fill, and nothing else - no `command/exec`, no `fs/writeFile`, no
//! `mcp_set_servers`, no permission mode. Free text is only ever the reader's words.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::args::{model_ok, Effort};
use super::run::Ended;

/// The most a message may be: the reader's words and every note attached to them.
const LONGEST_TEXT: usize = 4 << 20;

/// The most a picture may be, as base64.
const LONGEST_IMAGE: usize = 20 << 20;

/// A picture sent with a message.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Image {
    /// One of the four kinds both programs take.
    pub mime: String,
    /// Its bytes, as base64.
    pub data: String,
}

/// Where a goal is to go (docs/ai-sidebar.md 4.8).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "do", rename_all = "camelCase")]
pub enum GoalSay {
    /// Work towards this until it holds; `budget` is a token budget where the program has
    /// one.
    Set {
        objective: String,
        #[serde(default)]
        budget: Option<u64>,
    },
    /// Hold it.
    Pause,
    /// Go on with it.
    Resume,
    /// Drop it.
    Clear,
    /// Where it stands.
    Get,
}

/// One thing the window says to a session.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Say {
    /// The reader's message, starting a turn.
    Turn {
        text: String,
        #[serde(default)]
        images: Vec<Image>,
    },
    /// Words for the turn that is running (Ctrl+Enter).
    Steer { text: String },
    /// Stop the turn; what arrived stays.
    Interrupt,
    /// Answer with this model from the next request on.
    Model { model: String },
    /// Think this hard from the next request on; `None` is the model's own default.
    Effort { effort: Option<Effort> },
    /// The provider's faster tier from the next request on, where it has one.
    Fast { on: bool },
    /// The older turns become a summary; `focus` steers it where the program takes one.
    Compact {
        #[serde(default)]
        focus: String,
    },
    /// How full the window is, by part, where the program says.
    Context,
    /// The thread's goal.
    Goal { goal: GoalSay },
}

impl Say {
    /// Refuses what no program should be handed: a message too long to be one, a picture
    /// that is not one, a model name that could be read as a flag.
    pub fn checked(self) -> Result<Self, String> {
        match &self {
            Self::Turn { text, images } => {
                fits(text)?;
                for image in images {
                    picture(image)?;
                }
            }
            Self::Steer { text } => fits(text)?,
            Self::Model { model } if !model_ok(model) => {
                return Err(format!("{model:?} is not a model name"))
            }
            Self::Compact { focus } => fits(focus)?,
            Self::Goal {
                goal: GoalSay::Set { objective, .. },
            } => fits(objective)?,
            _ => {}
        }
        Ok(self)
    }
}

fn fits(text: &str) -> Result<(), String> {
    if text.len() > LONGEST_TEXT {
        return Err("the message is too long".to_owned());
    }
    Ok(())
}

fn picture(image: &Image) -> Result<(), String> {
    let kind = matches!(
        image.mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    );
    let base64 = image.data.len() <= LONGEST_IMAGE
        && image
            .data
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='));
    if kind && base64 && !image.data.is_empty() {
        Ok(())
    } else {
        Err("not a picture".to_owned())
    }
}

/// Words on one line, for a command that takes the rest of its line as its argument.
pub fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// What a session's channel carries.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Message {
    /// One line the program printed, as it printed it: an event for `lib/ai/local`.
    Line { line: String },
    /// The program's answer to something the window said, by what was asked (`models`,
    /// `context`, `goal`, `compact`), or why it could not.
    Reply {
        to: String,
        result: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// The end: the program ended, was stopped, or the session was closed.
    End(Ended),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn said(value: Value) -> Result<Say, String> {
        serde_json::from_value::<Say>(value)
            .map_err(|error| error.to_string())
            .and_then(Say::checked)
    }

    #[test]
    fn a_turn_is_words_and_pictures() {
        let turn = said(json!({
            "kind": "turn",
            "text": "what is a heron",
            "images": [{ "mime": "image/png", "data": "iVBORw0KGgo=" }],
        }))
        .expect("a turn");
        assert!(matches!(turn, Say::Turn { ref images, .. } if images.len() == 1));
    }

    #[test]
    fn nothing_but_the_named_things_can_be_said() {
        for odd in [
            json!({ "kind": "exec", "command": "rm -rf /" }),
            json!({ "kind": "raw", "line": "{}" }),
            json!({ "kind": "permissions", "mode": "bypassPermissions" }),
            json!({ "kind": "model", "model": "--dangerously-skip-permissions" }),
            json!({ "kind": "effort", "effort": "ultra" }),
            json!({ "kind": "turn", "text": "x", "images": [{ "mime": "text/html", "data": "PGI+" }] }),
            json!({ "kind": "turn", "text": "x", "images": [{ "mime": "image/png", "data": "a\"b" }] }),
        ] {
            assert!(said(odd.clone()).is_err(), "{odd} was taken");
        }
        assert!(said(json!({ "kind": "effort", "effort": null })).is_ok());
        assert!(said(json!({ "kind": "goal", "goal": { "do": "set", "objective": "file the inbox" } })).is_ok());
    }

    #[test]
    fn a_long_message_is_refused() {
        let long = "a".repeat(LONGEST_TEXT + 1);
        assert!(said(json!({ "kind": "turn", "text": long })).is_err());
    }

    #[test]
    fn a_command_s_argument_stays_on_its_line() {
        assert_eq!(one_line("keep the\n/clear  dates"), "keep the /clear dates");
    }
}
