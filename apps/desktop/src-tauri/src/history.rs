//! Every version of a note the app has seen. A copy is kept before a note is
//! overwritten, so a bad edit or a sync conflict is never the end of the story.
//!
//! The copies live in the app's own config folder rather than beside the note:
//! a note's folder belongs to the person who owns it, and history would clutter
//! it. Each note gets a folder named after a hash of its path, and the snapshots
//! in it are named after the moment they were taken.

use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, config_dir, folded, folder_key, inside, made, write_atomically, ORIGIN,
};

/// How many snapshots of one note are kept before the oldest is dropped.
const KEEP: usize = 40;

/// One kept version of a note.
#[derive(Serialize)]
pub struct Snapshot {
    /// Milliseconds since the epoch, and also the file's name.
    taken_at: u64,
    size: u64,
    path: String,
    /// Who the version was kept for, when it was not a save: an agent's name, kept
    /// before its first edit of the note. What the versions list shows where it
    /// shows a device; see docs/agent-native.md 8.5.
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// The extension of the file beside a snapshot that says who it was kept for. Beside
/// it and named after it, so it goes wherever the snapshot's folder goes.
const SOURCE: &str = "by";

/// As much of a name as a version keeps: a label, not a paragraph.
const LONGEST_SOURCE: usize = 64;

/// Keeps a copy of a note before it is overwritten. Does nothing for a note with
/// no text in it, which is what an empty new note is, and nothing when the text
/// has not changed since the last copy.
///
/// `source` names who it was kept for when that was not a save: an agent about to
/// edit the note. The same words as the last copy are that copy, which then says so.
#[tauri::command(async)]
pub fn snapshot_note(
    app: AppHandle,
    path: String,
    content: String,
    source: Option<String>,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Ok(());
    }

    keep_in(
        &history_root(&app, &path)?,
        &path,
        &content,
        source.as_deref(),
    )
}

/// `snapshot_note` into one note's history folder, apart from the app it is found
/// through.
fn keep_in(dir: &Path, path: &str, content: &str, source: Option<&str>) -> Result<(), String> {
    let mut existing = snapshot_files(dir);
    if let Some(last) = existing.last() {
        if fs::read_to_string(last).is_ok_and(|body| body == content) {
            if let Some(source) = source {
                name_source(last, source);
            }
            return Ok(());
        }
    }

    // The name is the moment it was taken, so two saves inside one millisecond
    // would otherwise be the same file. The later one moves on by a millisecond
    // rather than replacing the earlier.
    let mut taken_at = clock::now();
    while dir.join(format!("{taken_at}.md")).exists() {
        taken_at += 1;
    }
    let file = dir.join(format!("{taken_at}.md"));
    write_atomically(&file, content.as_bytes())?;
    if let Some(source) = source {
        name_source(&file, source);
    }

    existing = snapshot_files(dir);
    if existing.len() > KEEP {
        for old in &existing[..existing.len() - KEEP] {
            drop_version(old);
        }
    }

    // The note's own path is recorded so history can be listed by name later. Not
    // worth failing a snapshot over.
    let _ = fs::write(dir.join(ORIGIN), path);
    Ok(())
}

/// Writes who a version was kept for beside it. A label, so a failure to write it
/// is not worth failing the version over.
fn name_source(snapshot: &Path, source: &str) {
    let name: String = source.trim().chars().take(LONGEST_SOURCE).collect();
    if !name.is_empty() {
        let _ = fs::write(snapshot.with_extension(SOURCE), name);
    }
}

/// Who a version was kept for, when anybody says.
fn source_of(snapshot: &Path) -> Option<String> {
    let name = fs::read_to_string(snapshot.with_extension(SOURCE)).ok()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

/// A version gone, and who it was kept for with it. Answers whether it went.
fn drop_version(snapshot: &Path) -> bool {
    let _ = fs::remove_file(snapshot.with_extension(SOURCE));
    fs::remove_file(snapshot).is_ok()
}

/// Every kept version of one note, newest first.
#[tauri::command(async)]
pub fn list_snapshots(app: AppHandle, path: String) -> Result<Vec<Snapshot>, String> {
    Ok(listed(&history_root(&app, &path)?))
}

/// The versions in one history folder, newest first.
fn listed(dir: &Path) -> Vec<Snapshot> {
    let mut snapshots: Vec<Snapshot> = snapshot_files(dir)
        .into_iter()
        .filter_map(|file| {
            let taken_at = moment(&file)?;

            Some(Snapshot {
                taken_at,
                size: fs::metadata(&file).map_or(0, |one| one.len()),
                source: source_of(&file),
                path: file.to_string_lossy().to_string(),
            })
        })
        .collect();

    snapshots.reverse();
    snapshots
}

/// A day and an hour in milliseconds, which is the unit every snapshot's name
/// is in.
const HOUR: u64 = 60 * 60 * 1000;
const DAY: u64 = 24 * HOUR;

/// Which of one note's versions have had their day, given when they were taken
/// and what time it is now.
///
/// Two rules, and a version has to survive both. Nothing older than the
/// retention is kept, which is what the person asked for. And past the first
/// day only the last version of each hour is kept: today is when a bad edit is
/// noticed and every step of it is worth having, while a week ago one version
/// an hour is a history and the other ninety-nine are a disk full. That second
/// rule is the size cap, so a long note written in all day leaves twenty-four
/// versions of that day behind rather than hundreds.
///
/// The same policy runs in the browser, over `IndexedDB`; see
/// `src/lib/recovery.ts`.
fn stale(taken: &[u64], now: u64, days: u64) -> Vec<u64> {
    let mut newest_first: Vec<u64> = taken.to_vec();
    newest_first.sort_unstable_by(|a, b| b.cmp(a));

    let mut stale = Vec::new();
    let mut hours_kept = HashSet::new();
    // The retention comes from the window, and a number of days large enough to
    // wrap this would come back as a cutoff of nothing, which is every version
    // there is. Saturating, so an absurd retention keeps everything rather than
    // sweeping everything.
    let retention = days.saturating_mul(DAY);

    for at in newest_first {
        let age = now.saturating_sub(at);
        if age > retention {
            stale.push(at);
        } else if age > DAY && !hours_kept.insert(at / HOUR) {
            // Newest first, so the first version met in an hour is the one that
            // hour keeps and every older one in it goes.
            stale.push(at);
        }
    }

    stale
}

/// Sweeps every note's history by the policy above. Answers how many versions
/// went, which is what the caller logs and nothing else reads.
#[tauri::command(async)]
pub fn purge_snapshots(app: AppHandle, days: u64) -> Result<usize, String> {
    let root = history_dir(&app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        // Nothing has ever been kept, so there is nothing to sweep.
        return Ok(0);
    };

    let now = clock::now();
    let mut dropped = 0;

    for note in entries.flatten().map(|entry| entry.path()) {
        if !note.is_dir() {
            continue;
        }

        let files = snapshot_files(&note);
        let taken: Vec<u64> = files.iter().filter_map(|file| moment(file)).collect();

        for at in stale(&taken, now, days) {
            if drop_version(&note.join(format!("{at}.md"))) {
                dropped += 1;
            }
        }

        // A note whose every version has gone leaves an empty folder and the
        // note's path in it; both go with the last version.
        if snapshot_files(&note).is_empty() {
            let _ = fs::remove_file(note.join(ORIGIN));
            let _ = fs::remove_dir(&note);
        }
    }

    Ok(dropped)
}

/// Moves every note's history to where the note is now, after the spaces folder
/// itself moved from `from` to `to`. Answers how many notes' histories moved.
///
/// A history's folder is named after its note's path, and an iPhone moves every path:
/// the app's container is named afresh with each update, and the notes are inside it.
/// So after an update every version the phone had kept was under a name no note had
/// any more - there, and never listed. The page notices the move and asks for this;
/// see moved.ts.
#[tauri::command(async)]
pub fn rehome_snapshots(app: AppHandle, from: String, to: String) -> Result<usize, String> {
    Ok(rehome_in(&history_dir(&app)?, &from, &to))
}

/// `rehome_snapshots` over one history folder, apart from the app it is found through.
fn rehome_in(root: &Path, from: &str, to: &str) -> usize {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };

    let mut moved = 0;
    for note in entries.flatten().map(|entry| entry.path()) {
        let Ok(was) = fs::read_to_string(note.join(ORIGIN)) else {
            continue;
        };
        // Under the old folder, and not merely beside it: `/a/Nib2` is not in `/a/Nib`.
        let Some(rest) = was.strip_prefix(from) else {
            continue;
        };
        if !rest.starts_with(['/', '\\']) {
            continue;
        }

        let now = format!("{to}{rest}");
        let there = root.join(folder_key(&now));
        // A note already written to at its new path keeps the history it has there;
        // the two are not merged, and the older one waits where it was.
        if there.exists() {
            continue;
        }
        if fs::rename(&note, &there).is_ok() {
            let _ = fs::write(there.join(ORIGIN), &now);
            moved += 1;
        }
    }

    moved
}

/// The moment a snapshot was taken, which is its file name.
fn moment(file: &Path) -> Option<u64> {
    file.file_stem()
        .and_then(OsStr::to_str)
        .and_then(|stem| stem.parse::<u64>().ok())
}

/// Reads one kept version back. Only the history folder is readable this way; a
/// note itself is read by `read_note`.
#[tauri::command(async)]
pub fn read_snapshot(app: AppHandle, path: String) -> Result<String, String> {
    let kept = folded(Path::new(&path));
    if !inside(&history_dir(&app)?, &kept) {
        return Err(format!("{path} is not a kept version of a note"));
    }

    fs::read_to_string(&kept).map_err(|error| cannot("read", &kept, &error))
}

/// The folder every note's history lives under.
fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("history"))
}

/// The folder this one note's history lives in, made if it is not there yet.
fn history_root(app: &AppHandle, note_path: &str) -> Result<PathBuf, String> {
    let dir = history_dir(app)?.join(folder_key(note_path));
    made(&dir)?;
    Ok(dir)
}

/// The snapshots in one folder, oldest first. The names are all the same length
/// until the year 2286, so sorting them as text sorts them by age.
fn snapshot_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(OsStr::to_str) == Some("md"))
        .collect();

    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::{keep_in, listed, rehome_in, snapshot_files, stale, DAY, HOUR, KEEP};
    use crate::paths::{folder_key, ORIGIN};
    use std::fs;

    /// Two installs of the same app on one iPhone.
    const OLD: &str = "/var/mobile/Containers/Data/Application/03742EE0/Documents/Nib";
    const NEW: &str = "/var/mobile/Containers/Data/Application/853E8E51/Documents/Nib";

    fn kept_at(root: &std::path::Path, note: &str) -> std::path::PathBuf {
        let dir = root.join(folder_key(note));
        fs::create_dir_all(&dir).expect("a history folder");
        fs::write(dir.join(ORIGIN), note).expect("its origin");
        fs::write(dir.join("1773500400000.md"), "a version").expect("a version");
        dir
    }

    #[test]
    fn a_history_follows_its_note_when_the_spaces_folder_moves() {
        let root = tempfile::tempdir().expect("a temp folder");
        let before = kept_at(root.path(), &format!("{OLD}/Notes/Read me.md"));

        assert_eq!(rehome_in(root.path(), OLD, NEW), 1);

        let now = format!("{NEW}/Notes/Read me.md");
        let after = root.path().join(folder_key(&now));
        assert!(!before.exists());
        assert_eq!(
            fs::read_to_string(after.join(ORIGIN)).expect("the origin"),
            now
        );
        assert!(after.join("1773500400000.md").exists());
    }

    #[test]
    fn a_history_outside_the_old_folder_stays_where_it_is() {
        let root = tempfile::tempdir().expect("a temp folder");
        let beside = kept_at(root.path(), &format!("{OLD}2/Notes/a.md"));
        let elsewhere = kept_at(root.path(), "/somewhere/else/a.md");

        assert_eq!(rehome_in(root.path(), OLD, NEW), 0);
        assert!(beside.exists());
        assert!(elsewhere.exists());
    }

    #[test]
    fn a_history_already_kept_at_the_new_path_is_not_written_over() {
        let root = tempfile::tempdir().expect("a temp folder");
        let before = kept_at(root.path(), &format!("{OLD}/Notes/a.md"));
        let already = kept_at(root.path(), &format!("{NEW}/Notes/a.md"));

        assert_eq!(rehome_in(root.path(), OLD, NEW), 0);
        assert!(before.exists());
        assert!(already.exists());
    }

    /// A fixed moment, so what the policy answers never depends on the day the
    /// tests are run.
    const NOW: u64 = 1_773_500_400_000;

    fn kept(taken: &[u64], days: u64) -> Vec<u64> {
        let dropped = stale(taken, NOW, days);
        taken
            .iter()
            .copied()
            .filter(|at| !dropped.contains(at))
            .collect()
    }

    #[test]
    fn everything_from_the_last_day_is_kept() {
        let today = [NOW - 60_000, NOW - 120_000, NOW - HOUR, NOW - DAY + 1];
        assert!(stale(&today, NOW, 7).is_empty());
    }

    #[test]
    fn nothing_older_than_the_retention_is_kept() {
        let old = NOW - 8 * DAY;
        assert_eq!(stale(&[old], NOW, 7), vec![old]);
        assert!(stale(&[old], NOW, 30).is_empty());
    }

    #[test]
    fn one_version_an_hour_past_the_first_day() {
        let hour = NOW - 2 * DAY;
        let versions = [hour, hour + 10 * 60_000, hour + 20 * 60_000];
        assert_eq!(kept(&versions, 7), vec![hour + 20 * 60_000]);
    }

    #[test]
    fn a_version_a_minute_for_a_day_thins_to_a_version_an_hour() {
        let start = NOW - 3 * DAY;
        let versions: Vec<u64> = (0..24 * 60).map(|minute| start + minute * 60_000).collect();

        assert_eq!(versions.len(), 1440);
        assert_eq!(kept(&versions, 7).len(), 24);
    }

    #[test]
    fn a_note_with_no_versions_has_nothing_to_sweep() {
        assert!(stale(&[], NOW, 7).is_empty());
    }

    /// The retention crosses from the window as a number, and a day is 86 400 000
    /// milliseconds - a multiple of 1024. A retention of 2^54 days multiplies out
    /// to exactly zero, and a cutoff of zero makes every version of every note
    /// older than the retention. The whole history is what would go.
    #[test]
    fn a_retention_too_large_to_multiply_keeps_everything() {
        let versions = [NOW - 60_000, NOW - 8 * DAY, NOW - 400 * DAY];

        assert!(stale(&versions, NOW, 1 << 54).is_empty());
        assert!(stale(&versions, NOW, u64::MAX).is_empty());
    }

    /// An agent's first edit of a note keeps the version before it, and the list
    /// says whose edit it was kept for - where it says a device for the account's.
    #[test]
    fn a_version_kept_for_an_agent_says_whose() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "saved", None).expect("a save");
        keep_in(here, "/notes/a.md", "before the agent", Some("Claude Code")).expect("kept");

        let versions = listed(here);
        let sources: Vec<Option<&str>> = versions.iter().map(|one| one.source.as_deref()).collect();
        assert_eq!(sources, [Some("Claude Code"), None]);
    }

    /// The words an agent is about to edit are often what the last save kept, and
    /// then that version is the one before the agent, and says so.
    #[test]
    fn the_same_words_as_the_last_version_are_that_version() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "saved", None).expect("a save");
        keep_in(here, "/notes/a.md", "saved", Some("Codex")).expect("kept");

        let versions = listed(here);
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].source.as_deref(), Some("Codex"));
    }

    #[test]
    fn who_a_version_was_kept_for_goes_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "first", Some("Claude Code")).expect("kept");
        for at in 0..KEEP {
            keep_in(here, "/notes/a.md", &format!("save {at}"), None).expect("a save");
        }

        let left = fs::read_dir(here)
            .expect("the folder")
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|one| one == "by"))
            .count();
        assert_eq!(left, 0);
        assert_eq!(listed(here).len(), KEEP);
    }

    #[test]
    fn snapshots_come_back_oldest_first_and_nothing_else_does() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("1700000000002.md"), "second").expect("a snapshot");
        std::fs::write(here.join("1700000000001.md"), "first").expect("an older snapshot");
        std::fs::write(here.join("origin.txt"), "/notes/a.md").expect("the origin");

        let files = snapshot_files(here);
        let names: Vec<String> = files
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();

        assert_eq!(names, ["1700000000001.md", "1700000000002.md"]);
    }
}
