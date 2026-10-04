//! Reminders that ring with nib closed (docs/tasks.md 5.10): the plan the page makes,
//! handed to the system's own scheduler, and the presses on what rings handed back.
//!
//! **The plan is the page's.** The window reads every space's tasks and works out the
//! next 64 moments (src/lib/reminders); this module only makes the system hold them:
//! scheduled toasts on Windows (toasts.rs), notification requests on a Mac (macos.rs).
//! Linux has no scheduler a notification can be handed to, so there the answer is no,
//! and the page rings them itself while nib runs, in the tray where it keeps running.
//!
//! **A press comes back as a link.** Done and a press on the notification are
//! `nib://reminder` links (link.rs) carrying a nonce made here, kept in `reminders.json`
//! beside the settings and nowhere else, so only a notification this app made can tick
//! a task. A link that arrives is checked, put in a queue and the window told to look
//! (`nib://reminder`); the window takes the queue (`reminders_taken`) and ticks the task
//! through the one write path every box uses. Started by a Done, the app comes up
//! without its window (`quiet_launch`), does it, and stays in the tray.
//!
//! **Never a probe's**, unless the probe asks: a run whose windows are off the screen is
//! a drive's, and a toast is on the screen of whoever is at the machine. Only a probe
//! started with `NIB_PROBE_REMINDERS` schedules, and the drive takes it off again
//! (scripts/reminders-probe.py).

pub(crate) mod link;
#[cfg(target_os = "macos")]
mod macos;
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux has no schedule to hand a notification to")
)]
pub(crate) mod schedule;
#[cfg(any(windows, test))]
mod toast;
#[cfg(windows)]
mod toasts;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

use link::Act;

/// One reminder as the page hands it over; see `Reminder` in src/lib/reminders/plan.ts.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    /// Sixteen hex digits.
    pub id: String,
    /// Milliseconds since the epoch.
    pub at: i64,
    pub title: String,
    pub body: String,
    pub space: String,
    pub path: String,
    pub hash: String,
    pub line: u32,
    /// Minutes from its moment to nine the next morning, which the snooze offers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "a Windows toast's snooze; a Mac's snoozes are fixed"
        )
    )]
    pub tomorrow: Option<u32>,
}

/// The words on a notification's buttons, in the reader's language.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux shows a reminder with no buttons")
)]
pub struct Words {
    pub done: String,
    pub snooze: String,
    /// The first snooze, fifteen minutes.
    pub minutes: String,
    /// The second, an hour.
    pub hour: String,
    /// Nine the next morning.
    pub tomorrow: String,
}

impl Default for Words {
    fn default() -> Self {
        Self {
            done: "Done".into(),
            snooze: "Snooze".into(),
            minutes: "15 min".into(),
            hour: "1 h".into(),
            tomorrow: "Tomorrow".into(),
        }
    }
}

/// A press the window has to answer: tick a task, or open its note at it.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Pressed {
    pub act: Act,
    pub space: String,
    pub path: String,
    pub hash: String,
    pub line: u32,
}

/// How long a reminder that rang is still answered: its notification may sit in the
/// action centre for days before somebody presses Done on it.
const ANSWERED_FOR_MS: i64 = 7 * 86_400_000;

/// What the window is told when a press is waiting.
const PRESSED: &str = "nib://reminder";

/// The file the nonces are kept in, beside the settings.
const FILE: &str = "reminders.json";

/// One reminder kept: as planned, and the nonce its links carry.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Kept {
    #[serde(flatten)]
    planned: Planned,
    nonce: String,
}

#[derive(Default)]
struct State {
    /// By id; read from the file the first time anything is asked.
    kept: Option<HashMap<String, Kept>>,
    /// Presses waiting for the window, as they arrived: checked against the nonces as
    /// the window takes them, off the thread a link arrives on.
    pressed: Vec<Arrived>,
}

/// A press as it arrived: what it asks, of which reminder, and with which nonce; none
/// for one the system itself handed over.
struct Arrived {
    act: Act,
    id: String,
    nonce: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    kept: None,
    pressed: Vec::new(),
});

fn in_state<T>(alter: impl FnOnce(&mut State) -> T) -> T {
    alter(&mut STATE.lock().unwrap_or_else(PoisonError::into_inner))
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    crate::paths::config_dir(app).ok().map(|dir| dir.join(FILE))
}

/// The reminders kept, read from the file once.
fn kept<'a>(state: &'a mut State, app: &AppHandle) -> &'a mut HashMap<String, Kept> {
    state.kept.get_or_insert_with(|| {
        file(app)
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<Kept>>(&bytes).ok())
            .map(|list| {
                list.into_iter()
                    .map(|one| (one.planned.id.clone(), one))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// The plan merged into what is kept: each reminder keeps the nonce it was first given,
/// one that rang is kept a week for its Done, and one taken out of the plan before it
/// rang is forgotten. Answers the plan with its nonces.
fn merge(
    kept: &mut HashMap<String, Kept>,
    plan: Vec<Planned>,
    now: i64,
    nonce: impl Fn() -> String,
) -> Vec<(Planned, String)> {
    let wanted: Vec<String> = plan.iter().map(|one| one.id.clone()).collect();
    kept.retain(|id, one| {
        wanted.contains(id) || (one.planned.at <= now && now - one.planned.at < ANSWERED_FOR_MS)
    });
    plan.into_iter()
        .map(|one| {
            let entry = kept.entry(one.id.clone()).or_insert_with(|| Kept {
                planned: one.clone(),
                nonce: nonce(),
            });
            entry.planned = one.clone();
            (one, entry.nonce.clone())
        })
        .collect()
}

/// Sixteen hex digits from the system's own randomness.
fn fresh_nonce() -> String {
    let mut bytes = [0u8; 8];
    // A machine with no randomness to give is not one a reminder is worth failing on:
    // the nonce is then the clock's, which nobody else on the machine can know either.
    if getrandom::fill(&mut bytes).is_err() {
        bytes = now_ms().to_le_bytes();
    }
    bytes
        .iter()
        .fold(String::with_capacity(16), |mut out, byte| {
            use std::fmt::Write as _;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
        })
}

fn save(app: &AppHandle, kept: &HashMap<String, Kept>) {
    let Some(path) = file(app) else {
        return;
    };
    let mut list: Vec<&Kept> = kept.values().collect();
    list.sort_by_key(|one| one.planned.at);
    if let Ok(bytes) = serde_json::to_vec(&list) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Nothing to do about a failed write: the reminders still ring, and a Done on
        // one is answered for as long as this run holds its nonce.
        let _ = std::fs::write(path, bytes);
    }
}

/// Whether this run may put anything on the system's schedule: never a probe's, unless
/// the probe was started to prove exactly that.
fn may_schedule() -> bool {
    if crate::placement::away().is_some() {
        return std::env::var_os("NIB_PROBE_REMINDERS").is_some();
    }
    true
}

/// The plan, handed to the system. Answers whether the system holds it now: false is
/// the page's to ring while it runs (Linux, and a Windows that refused the app's id).
/// On a thread of the runtime's: the nonces are a file, and Windows' schedule is reached
/// through the apartment the `windows` crate joins for a thread that has none.
#[tauri::command(async)]
pub fn reminders_set(
    webview: tauri::Webview,
    app: AppHandle,
    reminders: Vec<Planned>,
    words: Words,
) -> Result<bool, String> {
    crate::agents::from_the_app(&webview)?;
    // A probe says yes and holds nothing: the page must not ring one either.
    if !may_schedule() {
        return Ok(true);
    }

    let now = now_ms();
    let wanted = in_state(|state| {
        let kept = kept(state, &app);
        let wanted = merge(kept, reminders, now, fresh_nonce);
        save(&app, kept);
        wanted
    });
    Ok(handed(&app, &wanted, &words, now))
}

/// The plan made so on this platform's schedule, if it has one.
fn handed(app: &AppHandle, wanted: &[(Planned, String)], words: &Words, now: i64) -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        #[cfg(windows)]
        let system = toasts::Toasts::of(&app.config().identifier);
        #[cfg(target_os = "macos")]
        let system = macos::Requests::start(app, words);
        system
            .and_then(|system| schedule::make_so(&system, wanted, words, now))
            .map_err(|error| eprintln!("nib: reminders: {error}"))
            .is_ok()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, wanted, words, now);
        false
    }
}

/// One reminder rung by the page itself, where the system holds none (`reminders_set`
/// answered no): a notification with its words, and nothing to press but the
/// notification. On the window's own thread, where the notification plugin is added.
#[tauri::command]
pub fn reminders_ring(
    webview: tauri::Webview,
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    crate::agents::shell::notify(&app, title, body);
    Ok(())
}

/// The presses waiting, taken: each is answered once, and only one whose nonce is the
/// one kept for its reminder - a link nobody's notification made does nothing.
#[tauri::command(async)]
pub fn reminders_taken(webview: tauri::Webview, app: AppHandle) -> Result<Vec<Pressed>, String> {
    crate::agents::from_the_app(&webview)?;
    Ok(in_state(|state| {
        let arrived = std::mem::take(&mut state.pressed);
        let kept = kept(state, &app);
        arrived
            .into_iter()
            .filter_map(|one| answered(kept, &one))
            .collect()
    }))
}

/// A press as the window answers it, where it is one of ours.
fn answered(kept: &HashMap<String, Kept>, press: &Arrived) -> Option<Pressed> {
    let one = kept
        .get(&press.id)
        .filter(|one| press.nonce.as_ref().is_none_or(|nonce| &one.nonce == nonce))?;
    Some(Pressed {
        act: press.act,
        space: one.planned.space.clone(),
        path: one.planned.path.clone(),
        hash: one.planned.hash.clone(),
        line: one.planned.line,
    })
}

/// Listens for presses on what a Mac shows from the launch on, so a press that started
/// the app is heard; nothing anywhere else, where a press arrives as a link.
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if may_schedule() {
        macos::listen(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// A press on a reminder, from a link: queued with its nonce, which the window's taking
/// checks, and the window told.
pub fn pressed(app: &AppHandle, act: Act, id: &str, nonce: &str) {
    press(app, act, id, Some(nonce));
}

/// A press the system itself handed over, which needs no nonce: a Mac's notification
/// centre says which of the app's own requests was pressed.
#[cfg(target_os = "macos")]
pub fn pressed_by_id(app: &AppHandle, act: Act, id: &str) {
    press(app, act, id, None);
}

fn press(app: &AppHandle, act: Act, id: &str, nonce: Option<&str>) {
    in_state(|state| {
        state.pressed.push(Arrived {
            act,
            id: id.to_string(),
            nonce: nonce.map(str::to_string),
        });
    });
    // A press on the notification itself asks for the note, so the window comes forward;
    // a Done is answered out of sight.
    if act == Act::Open {
        if let Some(window) = crate::agents::shell::host(app) {
            let _ = window.show();
            crate::placement::raised(&window);
        }
    }
    let _ = app.emit(PRESSED, ());
}

/// A `nib://` link that arrived, answered here if it is a reminder's. Answers whether it
/// was, so uris.rs neither raises the window for a Done nor hands it to the automation.
pub fn answer_link(app: &AppHandle, url: &str) -> bool {
    if !link::is_reminder(url) {
        return false;
    }
    if let Some((act, id, nonce)) = link::parsed(url) {
        pressed(app, act, &id, &nonce);
    }
    true
}

/// The window has answered what a quiet launch was for (`quiet_launch`): with its window
/// still out of sight and nothing keeping nib in the tray, the app goes again, the way
/// Quit in the tray ends it. On a thread of the runtime's, as a quit writes down where
/// each window was.
#[tauri::command(async)]
pub fn reminders_quietly(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    let hidden =
        crate::agents::shell::host(&app).is_some_and(|window| !window.is_visible().unwrap_or(true));
    if hidden && !crate::agents::shell::in_tray() {
        crate::lifecycle::quit(&app);
    }
    Ok(())
}

/// Whether a launch was asked for by nothing but a reminder's Done: the app then comes
/// up without its window, answers it and stays in the tray.
pub fn quiet_launch(urls: &[String]) -> bool {
    !urls.is_empty()
        && urls
            .iter()
            .all(|url| matches!(link::parsed(url), Some((Act::Done, _, _))))
}

#[cfg(test)]
mod tests {
    use super::schedule::tests::planned;
    use super::*;

    #[test]
    fn a_reminder_keeps_its_nonce_and_one_that_rang_is_kept_a_week() {
        let mut kept = HashMap::new();
        let counter = std::cell::Cell::new(0);
        let nonce = || {
            counter.set(counter.get() + 1);
            format!("n{}", counter.get())
        };

        let first = merge(
            &mut kept,
            vec![planned("a", 2000), planned("b", 3000)],
            1000,
            nonce,
        );
        assert_eq!(first[0].1, "n1");
        assert_eq!(first[1].1, "n2");

        // Planned again with b moved: a keeps its nonce, b's own goes, c is new.
        let second = merge(
            &mut kept,
            vec![planned("a", 2000), planned("c", 4000)],
            1500,
            nonce,
        );
        assert_eq!(second[0].1, "n1");
        assert_eq!(second[1].1, "n3");
        assert!(!kept.contains_key("b"));

        // a rang and is out of the plan: kept for its Done, then let go after a week.
        merge(&mut kept, vec![planned("c", 4000)], 2500, nonce);
        assert!(kept.contains_key("a"));
        merge(
            &mut kept,
            vec![planned("c", 4000)],
            2000 + ANSWERED_FOR_MS,
            nonce,
        );
        assert!(!kept.contains_key("a"));
    }

    #[test]
    fn a_press_is_answered_only_with_its_own_nonce() {
        let mut kept = HashMap::new();
        merge(&mut kept, vec![planned("a", 2000)], 1000, || {
            "right".to_string()
        });
        let press = |nonce: Option<&str>| Arrived {
            act: Act::Done,
            id: "a".into(),
            nonce: nonce.map(str::to_string),
        };
        let answer = answered(&kept, &press(Some("right"))).expect("its own nonce");
        assert_eq!(
            (answer.act, answer.path.as_str(), answer.line),
            (Act::Done, "Plan.md", 2)
        );
        assert_eq!(answered(&kept, &press(Some("wrong"))), None);
        // The system's own press, which carries none.
        assert!(answered(&kept, &press(None)).is_some());
        assert_eq!(
            answered(
                &kept,
                &Arrived {
                    act: Act::Open,
                    id: "gone".into(),
                    nonce: None
                }
            ),
            None
        );
    }

    #[test]
    fn only_a_launch_for_nothing_but_a_done_is_quiet() {
        let done = link::link(Act::Done, "aa", "bb");
        let open = link::link(Act::Open, "aa", "bb");
        assert!(quiet_launch(std::slice::from_ref(&done)));
        assert!(!quiet_launch(&[done.clone(), open]));
        assert!(!quiet_launch(&[done, "nib://open?path=a".into()]));
        assert!(!quiet_launch(&[]));
    }

    #[test]
    fn a_nonce_is_sixteen_hex_digits() {
        let made = fresh_nonce();
        assert_eq!(made.len(), 16);
        assert!(made.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(made, fresh_nonce());
    }

    #[test]
    fn the_plan_reads_as_the_page_writes_it() {
        let read: Planned = serde_json::from_value(serde_json::json!({
            "id": "00ff00ff00ff00ff", "at": 1_790_000_000_000_i64, "title": "Call",
            "body": "Plan", "space": "Work", "path": "Plan.md", "hash": "abc", "line": 3,
            "tomorrow": 900,
        }))
        .expect("the page's shape");
        assert_eq!(read.tomorrow, Some(900));
        assert_eq!(read.line, 3);
    }
}
