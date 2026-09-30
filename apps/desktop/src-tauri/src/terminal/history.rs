//! A terminal's last lines between runs: what a restart puts back above the fresh shell.
//!
//! A screen can hold anything that was printed to it - a token a command echoed, a
//! password somebody typed where a prompt said not to - so where it is kept is the whole
//! question, and the answer is the one place on this machine that is nobody's to share:
//! the app's local data folder, one file per terminal, `terminal/<space>/<key>.json`.
//! Never a space's folder, which is synced and handed to other people; never the
//! webview's storage, whose quota the session's unsaved words live in; never a roaming
//! profile, which would carry it to the next computer. `<space>` is the space the tab was
//! opened in, and `none` for one opened in none.
//!
//! The window decides when (a moment after the output rests, as the tab leaves its pane,
//! as the window goes) and forgets one when its tab closes; see `lib/terminal/history.ts`.
//! Here is the disk: every command runs off the window's thread, every write lands whole
//! or not at all, and a space keeps at most `MOST_PER_SPACE` of them, so terminals nobody
//! closed properly - a crash, a session lost - do not pile up the way Windows Terminal's
//! `buffer_*.txt` files did.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};

/// What one terminal's history is: the screen and its scrollback as xterm.js serialised
/// them, the size it was written at, so it can be replayed at that width and reflowed,
/// and when, which the line under it says.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct History {
    pub cols: u16,
    pub rows: u16,
    /// Milliseconds since 1970, as the window's clock said it.
    pub at: u64,
    pub text: String,
}

/// The most one history's text may be. The window keeps its own to half a million
/// characters (see history.ts), which is a megabyte and a half at the very most; anything
/// past this was not written by the app.
const MOST_TEXT: usize = 2 << 20;

/// The most a history's file is read to: its text with every escape written out as JSON
/// writes one, which is up to six bytes for a byte of the screen's colours.
const MOST_FILE: usize = 16 << 20;

/// How many histories one space keeps, newest first. Only terminals that went without
/// their tab being closed are ever over it: a closed tab takes its file with it.
const MOST_PER_SPACE: usize = 32;

/// The folder for terminals opened in no space.
const NO_SPACE: &str = "none";

/// Where every history is kept.
fn root(webview: &Webview) -> Result<PathBuf, String> {
    let data = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(data.join("terminal"))
}

/// A space's id or a terminal's key as the name of a folder or a file: both are ids the
/// window made, so anything else is refused rather than made safe, and no name can reach
/// outside the folder.
fn name(id: &str) -> Result<&str, String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(id)
    } else {
        Err(format!("{id:?} is not a terminal's name"))
    }
}

/// The folder of one space's histories.
fn folder(root: &Path, space: Option<&str>) -> Result<PathBuf, String> {
    Ok(root.join(match space {
        Some(space) => name(space)?,
        None => NO_SPACE,
    }))
}

/// The file of one terminal's history.
fn file(root: &Path, space: Option<&str>, key: &str) -> Result<PathBuf, String> {
    Ok(folder(root, space)?.join(format!("{}.json", name(key)?)))
}

/// One history, or nothing where there is none or what is there does not read as one.
fn read(path: &Path) -> Option<History> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() > MOST_FILE {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

/// A name for the half-written file, never the same twice in one run: two writes of one
/// terminal may be in the air at once, and each renames its own.
fn scratch(path: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let turn = NEXT.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("{turn}.part"))
}

/// Writes one history whole: into a file of its own first and then renamed over the old
/// one, so a crash in the middle leaves the last history rather than half of this one.
fn write(path: &Path, history: &History) -> Result<(), String> {
    if history.text.len() > MOST_TEXT {
        return Err("a terminal's history is kept to two megabytes".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "a history has a folder".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let bytes = serde_json::to_vec(history).map_err(|error| error.to_string())?;
    let part = scratch(path);
    fs::write(&part, bytes).map_err(|error| error.to_string())?;
    fs::rename(&part, path).map_err(|error| {
        let _ = fs::remove_file(&part);
        error.to_string()
    })
}

/// Keeps the newest `MOST_PER_SPACE` histories of a folder and removes the rest, with
/// any half-written file a crash left behind.
fn prune(folder: &Path) {
    let Ok(listed) = fs::read_dir(folder) else {
        return;
    };
    let mut kept = Vec::new();
    for entry in listed.flatten() {
        let path = entry.path();
        match path.extension().and_then(|one| one.to_str()) {
            Some("json") => {
                let when = entry.metadata().and_then(|one| one.modified()).ok();
                kept.push((when, path));
            }
            Some("part") if is_stale(&entry) => {
                let _ = fs::remove_file(&path);
            }
            _ => {}
        }
    }

    if kept.len() <= MOST_PER_SPACE {
        return;
    }
    kept.sort_by_key(|one| std::cmp::Reverse(one.0));
    for (_, path) in kept.into_iter().skip(MOST_PER_SPACE) {
        let _ = fs::remove_file(path);
    }
}

/// A half-written file old enough that no write can still be renaming it.
fn is_stale(entry: &fs::DirEntry) -> bool {
    entry
        .metadata()
        .and_then(|one| one.modified())
        .ok()
        .and_then(|when| when.elapsed().ok())
        .is_some_and(|age| age.as_secs() > 60)
}

/// A terminal's history, or nothing: none was written, it was forgotten, or restoring
/// is off and there never was one.
#[tauri::command(async)]
pub fn terminal_history_read(
    webview: Webview,
    space: Option<String>,
    key: String,
) -> Result<Option<History>, String> {
    super::owner(&webview)?;
    Ok(read(&file(&root(&webview)?, space.as_deref(), &key)?))
}

/// Writes a terminal's history down, in place of the one before.
#[tauri::command(async)]
pub fn terminal_history_write(
    webview: Webview,
    space: Option<String>,
    key: String,
    history: History,
) -> Result<(), String> {
    super::owner(&webview)?;
    let root = root(&webview)?;
    let path = file(&root, space.as_deref(), &key)?;
    write(&path, &history)?;
    prune(&folder(&root, space.as_deref())?);
    Ok(())
}

/// Forgets one terminal's history - its tab has closed - or, with no key, every history
/// there is: restoring was turned off.
#[tauri::command(async)]
pub fn terminal_history_forget(
    webview: Webview,
    space: Option<String>,
    key: Option<String>,
) -> Result<(), String> {
    super::owner(&webview)?;
    let root = root(&webview)?;
    let gone = match key {
        Some(key) => fs::remove_file(file(&root, space.as_deref(), &key)?),
        None => fs::remove_dir_all(&root),
    };
    match gone {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(text: &str, at: u64) -> History {
        History {
            cols: 120,
            rows: 30,
            at,
            text: text.to_owned(),
        }
    }

    #[test]
    fn a_name_is_an_id_and_nothing_else() {
        let root = Path::new("data");
        assert_eq!(
            file(root, Some("0-abc123"), "k-1").unwrap(),
            root.join("0-abc123").join("k-1.json")
        );
        assert_eq!(
            file(root, None, "k").unwrap(),
            root.join("none").join("k.json")
        );
        for bad in [
            "",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "c:",
            "a b",
            &"x".repeat(81),
        ] {
            assert!(file(root, None, bad).is_err(), "key {bad:?} was taken");
            assert!(
                file(root, Some(bad), "k").is_err(),
                "space {bad:?} was taken"
            );
        }
    }

    #[test]
    fn a_history_comes_back_as_it_was_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), Some("space"), "key").unwrap();
        let written = history("\u{1b}[31mfailed\u{1b}[0m\r\nC:\\>", 1_700_000_000_000);

        write(&path, &written).unwrap();
        assert_eq!(read(&path), Some(written));

        // And again, in place of the one before, with nothing left beside it.
        let again = history("C:\\>", 1_700_000_001_000);
        write(&path, &again).unwrap();
        assert_eq!(read(&path), Some(again));
        let left: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|one| one.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("key.json")]);
    }

    #[test]
    fn what_does_not_read_as_a_history_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.json");
        assert_eq!(read(&path), None);

        fs::write(&path, b"{\"cols\": \"wide\"}").unwrap();
        assert_eq!(read(&path), None);

        fs::write(&path, b"not json").unwrap();
        assert_eq!(read(&path), None);
    }

    #[test]
    fn more_than_two_megabytes_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.json");
        let huge = history(&"x".repeat(MOST_TEXT + 1), 0);
        assert!(write(&path, &huge).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn a_space_keeps_its_newest_histories() {
        let dir = tempfile::tempdir().unwrap();
        let space = dir.path().join("space");
        fs::create_dir_all(&space).unwrap();

        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for turn in 0..MOST_PER_SPACE + 3 {
            let path = space.join(format!("t{turn}.json"));
            write(&path, &history("screen", 0)).unwrap();
            // The first three are the oldest, whatever the clock's resolution.
            if turn < 3 {
                fs::File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_modified(old)
                    .unwrap();
            }
        }
        // A half-written file from a crash an hour ago goes too.
        let part = space.join("t0.7.part");
        fs::write(&part, b"half").unwrap();
        fs::File::options()
            .write(true)
            .open(&part)
            .unwrap()
            .set_modified(old)
            .unwrap();

        prune(&space);

        let left = fs::read_dir(&space).unwrap().count();
        assert_eq!(left, MOST_PER_SPACE);
        for gone in ["t0.json", "t1.json", "t2.json", "t0.7.part"] {
            assert!(!space.join(gone).exists(), "{gone} is still there");
        }
        assert!(space.join("t3.json").exists());
    }
}
