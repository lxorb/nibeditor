//! The app's own log: one file in the app's log folder, one line per message,
//! written by the window rather than from here. This module owns the file, its
//! size and the shape of a line.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use crate::lane::lane;
use crate::paths::{self, cannot, made};

/// Anything past this and the file is rolled over, so a loop cannot fill a disk.
const MAX_BYTES: u64 = 1024 * 1024;

/// How much of one message is kept. A stack trace is welcome; a whole document
/// pasted into a log line is not.
const MAX_MESSAGE: usize = 2000;

/// How much of the level and the timestamp is kept. Both come from the window and
/// both belong in one column.
const MAX_FIELD: usize = 40;

/// What the log file is called, in the log folder.
const FILE: &str = "nib.log";

/// Where the log file is, so the window can offer to open it.
///
/// The folder is made if it is not there yet, so this waits for the disk.
#[tauri::command(async)]
pub fn log_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_file(&app)?.to_string_lossy().to_string())
}

/// Appends one line. `at` comes from the caller so the timestamp matches the
/// clock the message was written by.
///
/// On the thread that called it, which for a command that is not `async` is the
/// one the window's message loop is on, so that the lines stay in the order they
/// were written: two in the air at once would not be. And so it touches no disk.
/// The line is handed to the log's own thread, which makes the folder, rolls the
/// file over and appends; this is a string and a channel. It used to be the whole
/// write, once per line on the thread that paints - and every error the window
/// catches is a line, so an error thrown once a frame was a file opened once a
/// frame there.
#[tauri::command]
pub fn write_log(app: AppHandle, level: String, message: String, at: String) -> Result<(), String> {
    // Asked of the app rather than of the disk: the folder is made by the thread
    // that writes into it.
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not find the log folder: {error}"))?;

    writer()
        .send((dir.join(FILE), line(&level, &message, &at)))
        .map_err(|_| "the log has stopped being written".to_owned())
}

/// One entry as it reads in the file. Every field is folded onto one line, the
/// timestamp included: a newline in any of them would otherwise pass itself off as
/// a second entry.
fn line(level: &str, message: &str, at: &str) -> String {
    format!(
        "{} {:<5} {}\n",
        one_line(at, MAX_FIELD),
        one_line(&level.to_uppercase(), MAX_FIELD),
        one_line(message, MAX_MESSAGE)
    )
}

/// The log's own thread, started by the first line: it takes the lines in the
/// order they were sent and appends each to the file it was sent for. See lane.rs.
///
/// A line that cannot be written is said on the standard error, which is all a
/// log that cannot be written has left: the window stopped waiting for an answer
/// the moment it handed the line over.
fn writer() -> &'static Sender<(PathBuf, String)> {
    static WRITER: OnceLock<Sender<(PathBuf, String)>> = OnceLock::new();

    WRITER.get_or_init(|| {
        lane(|(path, line): (PathBuf, String)| {
            if let Err(error) = append(&path, &line) {
                eprintln!("{error}");
            }
        })
    })
}

/// Appends one line to the file at `path`, rolling it over first when it has grown
/// past what a log may be. One previous file is kept, which is enough to span a
/// crash and a restart.
fn append(path: &Path, line: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        made(dir)?;
    }

    if fs::metadata(path).map_or(0, |one| one.len()) > MAX_BYTES {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| cannot("write", path, &error))?;

    file.write_all(line.as_bytes())
        .map_err(|error| cannot("write", path, &error))
}

/// The log as it stands. A log folder that cannot even be found, or a file that
/// cannot be read, reads as empty: the window asking has nothing better to show
/// either way, and a log is not worth an error of its own.
#[tauri::command(async)]
pub fn read_log(app: AppHandle) -> String {
    log_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

/// The log file, in a folder that exists by the time this returns.
fn log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::log_dir(app)?.join(FILE))
}

/// A log line is one line, so a stack trace cannot pass itself off as several
/// separate entries.
fn one_line(message: &str, limit: usize) -> String {
    message
        .replace(['\r', '\n'], " ⏎ ")
        .chars()
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{append, line, one_line, writer, MAX_BYTES, MAX_MESSAGE};

    #[test]
    fn folds_a_message_onto_one_line() {
        assert_eq!(one_line("a\nb\r\nc", MAX_MESSAGE), "a ⏎ b ⏎  ⏎ c");
        assert_eq!(one_line("plain", MAX_MESSAGE), "plain");
    }

    #[test]
    fn caps_how_long_a_line_can_get() {
        assert_eq!(
            one_line(&"x".repeat(5000), MAX_MESSAGE).chars().count(),
            MAX_MESSAGE
        );
    }

    #[test]
    fn a_timestamp_cannot_forge_a_second_entry() {
        assert_eq!(
            one_line("2026-01-01\nINFO  something else", 40),
            "2026-01-01 ⏎ INFO  something else"
        );
    }

    #[test]
    fn a_line_is_the_time_the_level_and_the_message() {
        assert_eq!(line("warn", "a\nb", "12:00"), "12:00 WARN  a ⏎ b\n");
    }

    /// Lines land in the order they were handed over, however quickly they come,
    /// and in a folder that did not exist before the first of them.
    #[test]
    fn lines_land_in_the_order_they_were_written() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("logs").join("nib.log");

        for index in 0..200 {
            writer()
                .send((path.clone(), line("info", &format!("line {index}"), "t")))
                .expect("the log's thread");
        }

        // The thread is the log's own, so the test waits for the last line.
        let started = std::time::Instant::now();
        while !std::fs::read_to_string(&path).is_ok_and(|text| text.contains("line 199")) {
            assert!(started.elapsed().as_secs() < 10, "the lines never landed");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        let text = std::fs::read_to_string(&path).expect("the log");
        let numbers: Vec<usize> = text
            .lines()
            .filter_map(|one| one.rsplit(' ').next()?.parse().ok())
            .collect();
        assert_eq!(numbers, (0..200).collect::<Vec<_>>());
    }

    /// A log past its size is rolled over before the next line, and that line
    /// starts the new file.
    #[test]
    fn a_full_log_rolls_over() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("nib.log");
        let full = usize::try_from(MAX_BYTES).expect("a size") + 1;
        std::fs::write(&path, "x".repeat(full)).expect("a full log");

        append(&path, "fresh\n").expect("the line");

        assert_eq!(std::fs::read_to_string(&path).expect("the log"), "fresh\n");
        assert_eq!(
            std::fs::metadata(path.with_extension("log.1"))
                .expect("the rolled log")
                .len(),
            MAX_BYTES + 1
        );
    }
}
