//! Everything that goes through pandoc: reading a Word or ODT file in as
//! markdown, and writing a note out as one of the formats pandoc knows. Typora
//! shells out for the same jobs, and the formats are pandoc's rather than ours.
//!
//! Nothing here assumes pandoc is installed. `has_pandoc` is what the window asks
//! before it offers any of it.

#[cfg(target_os = "macos")]
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::paths::chosen;

/// What a document is read in as: plain markdown plus the few extensions the
/// editor itself understands, so nothing comes back that cannot be shown.
const READ_AS: &str =
    "markdown_strict+pipe_tables+backtick_code_blocks+strikeout+task_lists+tex_math_dollars";

/// What a note is written out from, which is what the editor writes.
const WRITE_FROM: &str = "markdown+tex_math_dollars+pipe_tables+task_lists+footnotes+strikeout";

#[cfg(any(target_os = "macos", test))]
mod finding;

/// pandoc, started the way every call here starts it: found where this machine
/// keeps it, and without a console window flashing up on Windows.
// `mut` is only used by the Windows branch below; elsewhere it is dead.
#[cfg_attr(not(windows), allow(unused_mut))]
fn pandoc() -> Command {
    let mut command = Command::new(program());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}

/// On Windows and Linux a launched app has the `PATH` its user set, so the name
/// is enough.
#[cfg(not(target_os = "macos"))]
fn program() -> PathBuf {
    PathBuf::from("pandoc")
}

/// On a Mac an app opened from Finder does not; see finding.rs. Looked up on every
/// call rather than once, so a pandoc installed while the app is open is found by
/// the next export. That is a handful of `stat` calls; only the login shell, which
/// is slow, is asked once per launch.
#[cfg(target_os = "macos")]
fn program() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let folders = finding::folders(std::env::var_os("PATH").as_deref(), home.as_deref());

    finding::first_in(&folders, runs)
        .or_else(from_login_shell)
        .unwrap_or_else(|| PathBuf::from("pandoc"))
}

/// Whether a path is a file somebody may run.
#[cfg(target_os = "macos")]
fn runs(program: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    fs::metadata(program)
        .is_ok_and(|found| found.is_file() && found.permissions().mode() & 0o111 != 0)
}

/// Where the reader's own login shell finds pandoc, asked once per launch.
#[cfg(target_os = "macos")]
fn from_login_shell() -> Option<PathBuf> {
    static ASKED: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell).clone()
}

/// Asks `$SHELL -ilc 'command -v pandoc'`, the way VS Code reads the `PATH` of a
/// shell nobody opened: interactive as well as a login, because a `PATH` line in
/// `.zshrc` is only read by an interactive shell. With nothing to read from, so a
/// shell file that asks a question gets no answer instead of waiting for one, and
/// given three seconds, so a slow or broken shell file costs the export list that
/// long once and never hangs it.
#[cfg(target_os = "macos")]
fn ask_login_shell() -> Option<PathBuf> {
    use std::io::Read as _;
    use std::time::{Duration, Instant};

    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", "command -v pandoc"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }

    let mut printed = String::new();
    child.stdout.take()?.read_to_string(&mut printed).ok()?;
    finding::shell_answer(&printed).filter(|program| runs(program))
}

/// Whether pandoc is on this machine, which is what decides the export list.
#[tauri::command(async)]
pub fn has_pandoc() -> bool {
    pandoc()
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// What one import is run with: the options, then `--`, then the file.
///
/// The marker is the whole point of the function. `chosen` judges a path and
/// deliberately allows any file the app can reach, so what arrives is the reader's
/// own - a file picked in the dialog, one named on the command line, one the shell
/// handed over - and a name that opens with a dash is a name pandoc reads as an
/// option instead. `--lua-filter=…` names a script pandoc runs, which is the same
/// road `is_format` below closes for a writer's name. `--` is where pandoc stops
/// reading options, so everything after it is a file however it is spelled.
fn reading(source: &str) -> [&str; 8] {
    [
        "--to",
        READ_AS,
        "--wrap",
        "none",
        "--extract-media",
        ".",
        "--",
        source,
    ]
}

/// Converts a document into markdown with pandoc. The format comes from the
/// file's extension, which is what pandoc infers from anyway.
///
/// Pictures inside the document are written out beside it rather than into
/// whichever folder the app happens to have been started in, which for an app
/// launched from its own shortcut is a folder nobody would think to look in.
#[tauri::command(async)]
pub fn import_document(path: String) -> Result<String, String> {
    // The same gate the note readers go through: a file the reader picked in the
    // dialog, judged as a path before pandoc is handed it.
    let source = chosen(&path)?;
    let beside = source
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{path} is not in a folder Nib can write to"))?;
    let source = source.to_string_lossy().to_string();

    let result = pandoc()
        .current_dir(&beside)
        .args(reading(&source))
        .output()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    if result.status.success() {
        return String::from_utf8(result.stdout)
            .map_err(|error| format!("pandoc returned something that is not text: {error}"));
    }

    Err(complaint(&result.stderr, "pandoc could not read that file"))
}

/// Whether a string is a format pandoc can be asked for by name.
///
/// This matters more than it looks. `--to` also takes the path of a Lua script,
/// which pandoc then runs as a custom writer with its own filesystem and process
/// access - so a format that could name a file would turn "write this note out"
/// into "run this program". A writer's name is lower-case letters, digits and the
/// three joining characters pandoc's own names use, and nothing that could be a
/// path or an extension.
fn is_format(format: &str) -> bool {
    !format.is_empty()
        && format.len() <= 40
        && format.starts_with(|first: char| first.is_ascii_lowercase())
        && format.chars().all(|one| {
            one.is_ascii_lowercase()
                || one.is_ascii_digit()
                || one == '-'
                || one == '_'
                || one == '+'
        })
}

/// Converts markdown with pandoc, the same way Typora does. The source is piped
/// in rather than written to a temp file, so nothing is left behind.
#[tauri::command(async)]
pub fn run_pandoc(source: String, output: String, format: String) -> Result<(), String> {
    if !is_format(&format) {
        return Err(format!("{format} is not a format pandoc writes"));
    }

    let mut child = pandoc()
        .args([
            "--from",
            WRITE_FROM,
            "--to",
            &format,
            "--standalone",
            "--output",
            &output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    let mut sink = child.stdin.take().ok_or("could not write to pandoc")?;

    // On its own thread, because pandoc writes as it reads: a long note plus a
    // pandoc with plenty to say would otherwise be two programs each waiting for
    // the other to take what it has written.
    let writer = std::thread::spawn(move || sink.write_all(source.as_bytes()));

    let result = child
        .wait_with_output()
        .map_err(|error| format!("pandoc did not finish: {error}"))?;
    let written = writer
        .join()
        .map_err(|_| "the thread feeding pandoc stopped".to_string())?;

    if result.status.success() {
        // Pandoc is happy, so it read what it needed; a write that failed at the
        // very end is still worth saying out loud.
        return written.map_err(|error| format!("could not send the note to pandoc: {error}"));
    }

    Err(complaint(&result.stderr, "pandoc failed"))
}

/// What pandoc said, or a sentence of our own when it said nothing.
fn complaint(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr);

    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{complaint, is_format, reading};

    /// A path is the reader's own, and pandoc reads a leading dash as an option.
    #[test]
    fn the_file_is_read_as_a_file_whatever_it_is_called() {
        let args = reading("-lua-filter=evil.lua");

        assert_eq!(args.last(), Some(&"-lua-filter=evil.lua"));
        // The marker sits immediately in front of it, so nothing between the
        // options and the file can be read as one.
        assert_eq!(args[args.len() - 2], "--");
        // And it is said once: a second `--` would be a file called `--`.
        assert_eq!(args.iter().filter(|one| **one == "--").count(), 1);
    }

    /// Every format the window offers; see `src/lib/export-formats.ts`.
    #[test]
    fn takes_the_formats_the_window_asks_for() {
        for format in [
            "odt",
            "latex",
            "mediawiki",
            "rst",
            "textile",
            "opml",
            "revealjs",
        ] {
            assert!(is_format(format), "{format}");
        }
        // And the spellings pandoc writes with extensions on them.
        assert!(is_format("markdown+tex_math_dollars"));
        assert!(is_format("commonmark_x"));
    }

    /// `--to` takes the path of a Lua script as readily as a writer's name, and
    /// pandoc runs that script. Nothing that could be a path is a format.
    #[test]
    fn refuses_anything_that_could_name_a_file() {
        assert!(!is_format("evil.lua"));
        assert!(!is_format("./evil.lua"));
        assert!(!is_format("/tmp/evil.lua"));
        assert!(!is_format(r"C:\Users\me\evil.lua"));
        assert!(!is_format("../evil"));
        assert!(!is_format("evil lua"));
        assert!(!is_format(""));
        assert!(!is_format("--lua-filter=evil.lua"));
        assert!(!is_format(&"a".repeat(41)));
    }

    #[test]
    fn repeats_what_pandoc_said() {
        assert_eq!(
            complaint(b"  no such format\n", "fallback"),
            "no such format"
        );
    }

    #[test]
    fn says_something_when_pandoc_said_nothing() {
        assert_eq!(complaint(b"", "pandoc failed"), "pandoc failed");
        assert_eq!(complaint(b"   \n", "pandoc failed"), "pandoc failed");
    }

    #[test]
    fn survives_output_that_is_not_utf8() {
        assert_eq!(complaint(&[0xff, b'a'], "pandoc failed"), "\u{fffd}a");
    }
}
