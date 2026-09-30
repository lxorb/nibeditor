//! Every call an agent makes, written down (docs/agent-native.md 9.5).
//!
//! One JSON line a call - when, which agent, which verb, which tab, the arguments, how it
//! went and how long it took - in `<local data>/agents/log/<date>.jsonl`, a file a day in
//! UTC, kept thirty days and never synced: it is this machine's record of what happened
//! on it. The activity panel reads it and a session can be written into a note from it.
//!
//! **No secrets.** A password field cannot be typed into by an agent, so there is none to
//! write; words typed into a field the page marks sensitive - a card's number, a one-time
//! code - are written as how many characters there were, never what they were. A
//! pairing's token is an answer and answers are not written.

use std::cell::Cell;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager as _};

/// How many days of the log are kept.
const KEPT_DAYS: u64 = 30;

/// One line.
#[derive(Serialize)]
pub struct Line<'a> {
    /// When, in milliseconds since 1970.
    pub at: u64,
    /// Which agent; `cli` for the reader's own command line.
    pub agent: &'a str,
    /// The verb.
    pub verb: &'a str,
    /// The tab, when there was one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab: Option<&'a str>,
    /// The arguments, with anything sensitive taken out.
    pub args: Value,
    /// `ok`, `needs_approval` or `error`.
    pub status: &'a str,
    /// Why not, when it was not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Value>,
    /// How long it took, in milliseconds.
    pub ms: u64,
}

thread_local! {
    /// Whether the call on this thread typed into a sensitive field: each call has a
    /// thread of its own, so this is that call's.
    static SENSITIVE: Cell<bool> = const { Cell::new(false) };
}

/// The day the log was last swept, so the sweep is once a day.
static SWEPT: Mutex<Option<String>> = Mutex::new(None);

/// Marks the call on this thread as having typed into a sensitive field.
pub fn sensitive() {
    SENSITIVE.set(true);
}

/// Writes one line. A log that cannot be written is not a reason for a call to fail.
pub fn write(app: &AppHandle, mut line: Line<'_>) {
    if SENSITIVE.replace(false) {
        line.args = redacted(line.args);
    }
    let Ok(folder) = folder(app) else {
        return;
    };
    let day = date(line.at);
    let fresh_day = {
        let mut swept = SWEPT.lock().unwrap_or_else(PoisonError::into_inner);
        let fresh = swept.as_deref() != Some(day.as_str());
        *swept = Some(day.clone());
        fresh
    };
    if fresh_day {
        sweep(&folder, line.at);
    }
    let Ok(text) = serde_json::to_string(&line) else {
        return;
    };
    let path = folder.join(format!("{day}.jsonl"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{text}");
    }
}

/// The lines of one day, oldest first, for the activity panel.
pub fn read_day(app: &AppHandle, day: &str) -> Vec<Value> {
    let Some(path) = is_day(day)
        .then(|| folder(app).ok())
        .flatten()
        .map(|folder| folder.join(format!("{day}.jsonl")))
    else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

/// The days the log has, newest first: what Settings > Agents reads the sessions from.
pub fn days(app: &AppHandle) -> Vec<String> {
    folder(app)
        .map(|folder| days_in(&folder))
        .unwrap_or_default()
}

/// The days in a folder of the log, newest first.
fn days_in(folder: &Path) -> Vec<String> {
    let mut days: Vec<String> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.strip_suffix(".jsonl")
                .filter(|day| is_day(day))
                .map(str::to_string)
        })
        .collect();
    days.sort_unstable_by(|one, other| other.cmp(one));
    days
}

/// Takes one agent's lines out of every day, or every line of every day when no agent
/// is named: the reader's Clear. A day left with nothing in it goes.
pub fn clear(app: &AppHandle, agent: Option<&str>) -> Result<(), String> {
    clear_in(&folder(app)?, agent)
}

/// `clear` in a folder of the log.
fn clear_in(folder: &Path, agent: Option<&str>) -> Result<(), String> {
    for day in days_in(folder) {
        let path = folder.join(format!("{day}.jsonl"));
        let text = if agent.is_some() {
            fs::read_to_string(&path).unwrap_or_default()
        } else {
            String::new()
        };
        let kept: Vec<&str> = agent.map_or_else(Vec::new, |agent| {
            text.lines()
                .filter(|line| !written_by(line, agent))
                .collect()
        });
        let done = if kept.is_empty() {
            fs::remove_file(&path)
        } else {
            fs::write(&path, format!("{}\n", kept.join("\n")))
        };
        done.map_err(|error| format!("could not clear the log: {error}"))?;
    }
    Ok(())
}

/// Whether a line of the log is one of this agent's calls. A line that cannot be read
/// is nobody's, and stays.
fn written_by(line: &str, agent: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| value.get("agent")?.as_str().map(|one| one == agent))
        .unwrap_or(false)
}

/// Whether a name is a day as the log writes one, `YYYY-MM-DD`: the one shape a file of
/// it may have, and the one shape a day asked for may.
fn is_day(day: &str) -> bool {
    day.len() == 10 && day.bytes().all(|one| one.is_ascii_digit() || one == b'-')
}

/// Where the log lives, made if it is not there.
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("agents")
        .join("log");
    crate::paths::made(&dir)?;
    Ok(dir)
}

/// The arguments with every typed word replaced by how many there were.
fn redacted(mut args: Value) -> Value {
    if let Some(text) = args.get_mut("text") {
        let count = text.as_str().map_or(0, |one| one.chars().count());
        *text = Value::String(format!("({count} characters, not kept)"));
    }
    if let Some(fields) = args.get_mut("fields").and_then(Value::as_array_mut) {
        for field in fields {
            if let Some(value) = field.get_mut("value") {
                *value = Value::String("(not kept)".into());
            }
        }
    }
    args
}

/// Removes every day older than thirty.
fn sweep(folder: &Path, now: u64) {
    let oldest = date(now.saturating_sub(KEPT_DAYS * 24 * 60 * 60 * 1000));
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(day) = name.strip_suffix(".jsonl") {
            // Dates written as `YYYY-MM-DD` sort as they fall.
            if day.len() == 10 && day < oldest.as_str() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// A moment's day in UTC, as `YYYY-MM-DD`.
pub fn date(ms: u64) -> String {
    let days = i64::try_from(ms / 86_400_000).unwrap_or(0);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_day_is_its_utc_date() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(951_782_400_000), "2000-02-29");
        assert_eq!(date(1_790_726_400_000), "2026-09-30");
        assert_eq!(date(1_790_812_799_999), "2026-09-30");
        assert_eq!(date(1_790_812_800_000), "2026-10-01");
    }

    #[test]
    fn typed_words_in_a_sensitive_field_are_counted_not_kept() {
        let args = redacted(json!({ "tab": "a1", "ref": "e4", "text": "4242424242424242" }));
        assert_eq!(args["text"], "(16 characters, not kept)");
        assert_eq!(args["ref"], "e4");
        let form = redacted(json!({ "fields": [{ "ref": "e1", "value": "123" }] }));
        assert_eq!(form["fields"][0]["value"], "(not kept)");
    }

    #[test]
    fn the_days_are_the_files_newest_first() {
        let folder = tempfile::tempdir().expect("folder");
        for name in [
            "2026-09-29.jsonl",
            "2026-09-30.jsonl",
            "notes.txt",
            "x.jsonl",
        ] {
            fs::write(folder.path().join(name), "{}\n").expect("write");
        }
        assert_eq!(days_in(folder.path()), ["2026-09-30", "2026-09-29"]);
        assert!(days_in(&folder.path().join("missing")).is_empty());
    }

    #[test]
    fn clearing_one_agent_keeps_everybody_else() {
        let folder = tempfile::tempdir().expect("folder");
        let day = |name: &str| folder.path().join(format!("{name}.jsonl"));
        fs::write(
            day("2026-09-29"),
            "{\"agent\":\"a\",\"verb\":\"read_note\"}\n{\"agent\":\"b\",\"verb\":\"read_note\"}\nnot json\n",
        )
        .expect("write");
        fs::write(
            day("2026-09-30"),
            "{\"agent\":\"a\",\"verb\":\"browser_open\"}\n",
        )
        .expect("write");

        clear_in(folder.path(), Some("a")).expect("clear");
        assert_eq!(
            fs::read_to_string(day("2026-09-29")).expect("read"),
            "{\"agent\":\"b\",\"verb\":\"read_note\"}\nnot json\n"
        );
        assert!(!day("2026-09-30").exists());

        clear_in(folder.path(), None).expect("clear all");
        assert!(days_in(folder.path()).is_empty());
    }

    #[test]
    fn thirty_days_are_kept_and_nothing_older() {
        let folder = tempfile::tempdir().expect("folder");
        let now = 1_790_726_400_000;
        for day in ["2026-08-30", "2026-08-31", "2026-09-29", "2026-09-30"] {
            fs::write(folder.path().join(format!("{day}.jsonl")), "{}\n").expect("write");
        }
        fs::write(folder.path().join("notes.txt"), "x").expect("write");
        sweep(folder.path(), now);
        let mut left: Vec<String> = fs::read_dir(folder.path())
            .expect("read")
            .flatten()
            .map(|one| one.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "2026-08-31.jsonl",
                "2026-09-29.jsonl",
                "2026-09-30.jsonl",
                "notes.txt"
            ]
        );
    }
}
