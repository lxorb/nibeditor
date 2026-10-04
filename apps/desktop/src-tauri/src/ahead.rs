//! What a launch reads first, read while the webview starts.
//!
//! A launch on Windows spends a third of a second or more with this process waiting
//! for `WebView2` to start its browser, and only once the page is up does the page ask
//! for anything: the list of spaces, the tree of the space it was left in, the notes
//! that were open. Every one of those is a disk read the crate could have done in the
//! time it spent waiting. So the page writes down, whenever it changes, what the next
//! launch will ask for first (`remember_launch`), and at the next launch a thread of
//! this crate's own reads it while the webview starts (`start`). The page asks for the
//! whole of it in one round trip the moment it arrives (`launch_ahead`, from
//! src/early.ts), and takes each answer only where it is the one it would have asked
//! for; anything else it asks for as it always did. See docs/conventions.md, Speed.
//!
//! The same commands answer, with the same checks: the thread calls `list_spaces`,
//! `read_tree` and `read_note` itself, so nothing here is a second way of reading a
//! space. On both engines alike: nothing below knows which one this build runs.
//!
//! What it does not change is what is true. The answers are taken once, by the launch
//! that read them; a tree read ahead is at most the webview's start older than one
//! read when asked, and the space watcher lists every space afresh as it starts (see
//! `space_watch.rs`), which is what already covered the moment between a read and the
//! watch.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::paths::{config_dir, made, openable, write_atomically};
use crate::spaces::{list_spaces, Space};
use crate::tree::{read_tree, Entry, TreeOptions};

/// What the file is called, beside `ground.txt`: something the app keeps about
/// itself, not something it reports.
const FILE: &str = "launch.json";

/// How long the page's question waits for a read that has not finished. A read that
/// takes longer than this is a disk the page would have waited for anyway, and it asks
/// for itself instead.
const PATIENCE: Duration = Duration::from_secs(2);

/// How many notes are read ahead, and how much of them. The note in front comes
/// first; the rest are the other tabs the window will read as it restores. A note
/// longer than the one bound is left to be read when it is opened, and so is
/// everything past the other: the answer is parsed before the first frame, and the
/// first frame is the thing this is for.
const MOST_NOTES: usize = 24;
const LONGEST_NOTE: u64 = 256 * 1024;
const MOST_BYTES: usize = 1024 * 1024;

/// Past this the plan the page wrote is not read at all.
const LONGEST_PLAN: u64 = 64 * 1024;

/// What the page will ask for first: the space it will list, how it lists it, and the
/// notes it will open, the one in front first. Written by the page, read back by the
/// next launch.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Plan {
    /// The space whose tree the page reads first.
    root: Option<String>,
    /// How it reads it, as the page wrote it; handed back so the page can tell its own
    /// question from another.
    options: serde_json::Value,
    /// The notes it will open, the one in front first.
    notes: Vec<String>,
    /// Whether a website is on screen as it opens, whose page wants the browser process
    /// web tabs share; see `start`.
    web: bool,
}

/// What was read, as the page receives it. A part that could not be read is absent,
/// and the page asks for that part itself.
#[derive(Serialize)]
pub struct Answer {
    plan: Plan,
    spaces: Option<Vec<Space>>,
    tree: Option<Entry>,
    /// Each note's words, by the path the plan named it by.
    notes: BTreeMap<String, String>,
}

/// Where the read ahead is.
enum Reading {
    /// Nothing was started: no plan, or a launch that is not a desktop's.
    Idle,
    /// The thread is reading.
    Busy,
    /// Read, and not asked for yet.
    Ready(Box<Answer>),
    /// Handed to the page, or given up on. Nothing is handed twice.
    Taken,
}

static READING: Mutex<Reading> = Mutex::new(Reading::Idle);
static READ: Condvar = Condvar::new();

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

/// The plan the last launch left, or none.
fn planned(app: &AppHandle) -> Option<Plan> {
    let path = file(app).ok()?;
    if std::fs::metadata(&path).ok()?.len() > LONGEST_PLAN {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Starts reading what the plan names, on a thread of its own, and returns at once.
/// Called before the window is built, so the reads run while the webview starts.
///
/// Answers whether a website will be on screen: its page is built on the browser
/// process every web tab shares, which takes the window's thread a third of a second
/// and more to start the first time, so the caller starts it while the window's own
/// page is still loading rather than when that page asks; see `web_tabs::warm`.
pub fn start(app: &AppHandle) -> bool {
    let Some(plan) = planned(app) else {
        return false;
    };
    let web = plan.web;
    if let Ok(mut reading) = READING.lock() {
        *reading = Reading::Busy;
    }

    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("launch ahead".into())
        .spawn(move || {
            let answer = read(&app, plan);
            if let Ok(mut reading) = READING.lock() {
                if matches!(*reading, Reading::Busy) {
                    *reading = Reading::Ready(Box::new(answer));
                }
            }
            READ.notify_all();
        });

    if spawned.is_err() {
        if let Ok(mut reading) = READING.lock() {
            *reading = Reading::Idle;
        }
    }
    web
}

/// Everything the plan names, through the commands the page would have asked.
fn read(app: &AppHandle, plan: Plan) -> Answer {
    let spaces = list_spaces(app.clone()).ok();
    crate::trace::mark("read ahead: spaces");

    let tree = plan.root.as_ref().and_then(|root| {
        let options = serde_json::from_value::<TreeOptions>(plan.options.clone()).ok();
        read_tree(app.clone(), root.clone(), options).ok()
    });
    crate::trace::mark("read ahead: tree");

    let notes = notes_of(app, &plan.notes);
    crate::trace::mark(&format!("read ahead: {} notes", notes.len()));

    Answer {
        plan,
        spaces,
        tree,
        notes,
    }
}

/// The notes, in the order named, while they fit.
fn notes_of(app: &AppHandle, paths: &[String]) -> BTreeMap<String, String> {
    let mut notes = BTreeMap::new();
    let mut bytes = 0;

    for path in paths.iter().take(MOST_NOTES) {
        // The one gate every read goes through, and the size before the words: a note
        // too long to be worth it here is not read twice.
        let Ok(target) = openable(app, path) else {
            continue;
        };
        match std::fs::metadata(&target) {
            Ok(meta) if meta.len() <= LONGEST_NOTE => {}
            _ => continue,
        }
        let Ok(words) = crate::notes::read_note(app.clone(), path.clone()) else {
            continue;
        };
        if bytes + words.len() > MOST_BYTES {
            break;
        }
        bytes += words.len();
        notes.insert(path.clone(), words);
    }

    notes
}

/// What was read ahead, for the page that asks as it arrives: taken once, and a read
/// still running is waited for rather than done a second time.
///
/// A page that asks after that - the same window loaded again, a second window - is
/// read for there and then. Still ahead of it: the question is asked before a line of
/// the app has run, so the reads overlap its loading all the same.
#[tauri::command(async)]
pub fn launch_ahead(app: AppHandle) -> Option<Answer> {
    taken().or_else(|| planned(&app).map(|plan| read(&app, plan)))
}

/// What the launch's own read left, once, waiting for it while it runs.
fn taken() -> Option<Answer> {
    let reading = READING.lock().ok()?;
    let (mut reading, _) = READ
        .wait_timeout_while(reading, PATIENCE, |now| matches!(now, Reading::Busy))
        .ok()?;

    match std::mem::replace(&mut *reading, Reading::Taken) {
        Reading::Ready(answer) => Some(*answer),
        _ => None,
    }
}

/// What the next launch will ask for first, written down as it changes. The page
/// sends it only when it differs from what it sent last.
#[tauri::command(async)]
pub fn remember_launch(app: AppHandle, plan: Plan) -> Result<(), String> {
    let bytes = serde_json::to_vec(&plan).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LONGEST_PLAN {
        return Err("that plan is too long".into());
    }

    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        made(parent)?;
    }
    write_atomically(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::{Plan, LONGEST_PLAN};

    /// A plan the page wrote reads back as it was written, and one written by a page
    /// that had fewer or more to say still reads: the launch after an update is the
    /// one most worth being quick.
    #[test]
    fn a_plan_reads_back_whatever_the_page_left_out() {
        let written = r#"{"root":"C:\\Nib\\Work","options":{"sort":"name","showHidden":false},"notes":["C:\\Nib\\Work\\Plan.md"]}"#;
        let plan: Plan = serde_json::from_str(written).expect("a plan");
        assert_eq!(plan.root.as_deref(), Some("C:\\Nib\\Work"));
        assert_eq!(plan.notes.len(), 1);

        let bare: Plan = serde_json::from_str("{}").expect("an empty plan");
        assert!(bare.root.is_none() && bare.notes.is_empty());

        let more: Plan = serde_json::from_str(r#"{"root":null,"later":1}"#).expect("more");
        assert!(more.root.is_none());
    }

    /// The bound is the file's, so a plan the page could write is one the launch reads.
    #[test]
    fn a_plan_of_every_note_a_window_holds_fits_the_bound() {
        let plan = Plan {
            root: Some("C:\\".repeat(100)),
            options: serde_json::json!({ "sort": "modified", "descending": true }),
            notes: vec!["C:\\Users\\somebody\\Documents\\Nib\\Space\\note.md".repeat(4); 24],
            web: true,
        };
        let bytes = serde_json::to_vec(&plan).expect("written");
        assert!((bytes.len() as u64) < LONGEST_PLAN);
    }
}
