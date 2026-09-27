//! A note is a file. This module owns the nine things the window can ask of one:
//! read it, write it back as text, write it back as bytes, rename or move it,
//! delete it, ask when it was last written and how long it is, make the folder it
//! is going to live in, take that folder away, and take it away only if nothing
//! whatever is left in it. Whether a path is allowed at all is decided by `paths`,
//! not here.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs;
use std::io::Read as _;
use std::path::Path;
use tauri::AppHandle;

#[cfg(any(target_os = "macos", test))]
pub mod icloud;

use crate::clock;
use crate::paths::{
    cannot, chosen, drop_highlights, in_spaces, made, move_highlights, note_from_outside,
    outside_spaces, write_atomically,
};

/// Reads a note, whatever folder it is in. Opening a file from outside the
/// spaces folder is the deliberate exception the app is built around, and it is
/// also what makes the pictures beside that file readable.
#[tauri::command(async)]
pub fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    let target = chosen(&path)?;
    // A note iCloud took off this Mac is brought back before it is read.
    #[cfg(target_os = "macos")]
    icloud::fetched(&app, &target)?;
    let body = fs::read_to_string(&target).map_err(|error| cannot("read", &target, &error))?;

    if outside_spaces(&app, &target) {
        note_from_outside(&app, &target);
    }

    Ok(body)
}

/// Writes a note atomically, so a crash mid-write can never truncate the note
/// that was already there. Missing folders are created, which is what lets sync
/// land a note at a path that is new on this machine.
///
/// Like `read_note` this takes any path the reader chose: a note in a space, a
/// file opened from elsewhere, or the file an export was pointed at.
///
/// The line endings the file already had are kept; see `as_written`.
#[tauri::command(async)]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    let target = chosen(&path)?;
    let body = as_written(&target, &content);
    write_file(&target, &path, body.as_bytes())
}

/// The text with the line endings the file on disk already uses.
///
/// The editor holds one line ending, `\n`, whatever the file had: that is
/// `CodeMirror`'s own convention and the only sane one for a document being
/// edited. A file written on Windows by another program very often has `\r\n`,
/// and writing it back with bare newlines rewrites every line of it - which shows
/// up as a whole-file change in git, in a diff, and in anything watching the
/// folder, for a note where one word was corrected.
///
/// So the file is asked what it uses, and it is written back the same way. A file
/// that is not there yet is new, and a new file gets `\n`: it is what markdown is
/// written in and what every editor on every platform reads.
///
/// No setting. There is no answer here anybody could want other than "the way it
/// already was".
fn as_written(target: &Path, content: &str) -> String {
    if !crlf(target) {
        return content.to_owned();
    }

    // Only the newlines that stand alone: text that already carries `\r\n`, which
    // a paste can, must not become `\r\r\n`.
    content.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// Whether the file at `target` uses `\r\n`, judged by its first line ending. A
/// file with no line ending at all, one that cannot be read, or one that is not
/// there says no, which is the `\n` a new note is written in.
fn crlf(target: &Path) -> bool {
    let Ok(file) = fs::File::open(target) else {
        return false;
    };

    // The first line ending settles it, so only the head of the file is read: a
    // note is written on every keystroke that is saved, and a megabyte read to
    // answer a question the first eighty bytes answer is a megabyte wasted.
    let mut head = [0_u8; HEAD];
    let Ok(read) = (&file).take(HEAD as u64).read(&mut head) else {
        return false;
    };

    head[..read]
        .iter()
        .position(|byte| *byte == b'\n')
        .is_some_and(|at| at > 0 && head[at - 1] == b'\r')
}

/// How much of a file is read to find its first line ending. Long enough for a
/// front matter fence and a heading, short enough to cost nothing.
const HEAD: usize = 8192;

/// Writes bytes, under exactly the checks the text writer is held to: any path
/// the reader chose, the folders above it made, and the file written whole.
///
/// An export is bytes as often as it is text - a Word file, an `ePub`, a
/// picture, a `TextPack`, the pictures inside a `TextBundle` - none of those go
/// through `write_note` without being mangled by the string.
///
/// Base64 rather than an array of numbers: a two megabyte picture written out as
/// JSON digits is twenty megabytes of text for the bridge to parse, and one
/// export is a document plus every picture in it.
#[tauri::command(async)]
pub fn write_bytes(path: String, base64: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|error| format!("{path} was handed something that is not base64: {error}"))?;

    write_file(&chosen(&path)?, &path, &bytes)
}

/// What both writers do once they have the bytes: make the folder, then write
/// the file whole. Atomic, so a crash mid-write can never truncate the file that
/// was already there; and the missing folders are made, which is what lets sync
/// land a note at a path that is new on this machine.
///
/// The target is judged by the caller rather than here, because the text writer has
/// to read the file before it knows what to write; `shown` is the path as that
/// caller spelled it, which is what a refusal names.
fn write_file(target: &Path, shown: &str, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{shown} has no folder to write into"))?;

    made(parent)?;
    write_atomically(target, bytes)
}

/// Deletes a note outright. The window sends almost everything to the trash
/// instead; this is for the cases that are already a copy, such as a file sync
/// has just replaced.
#[tauri::command(async)]
pub fn delete_note(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_file(&target).map_err(|error| cannot("delete", &target, &error))?;

    // A PDF's highlights are part of that PDF and have nothing left to describe.
    drop_highlights(&target);
    Ok(())
}

/// Renames a note, which is also how it is moved: the new path can name a folder
/// that does not exist yet. A folder is renamed and moved the same way.
#[tauri::command(async)]
pub fn rename_note(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = in_spaces(&app, &from)?;
    let target = in_spaces(&app, &to)?;
    let respelling = respelled(&source, &target, same_entry);

    move_entry(&source, &target, respelling)?;

    // A PDF's highlights follow it, so a rename or a move keeps them.
    move_highlights(&source, &target);
    Ok(())
}

/// Whether `target` is `source` under another spelling of its own name: `idea.md`
/// renamed `Idea.md` on a Mac or on Windows, whose filesystems look a name up
/// without regard to case, and on a Mac without regard to how its letters are
/// composed either. There `target` already "exists", because it is the very file
/// being renamed, and refusing that as a collision is refusing every rename that
/// only fixes a capital. Finder, Explorer and Obsidian all take one.
///
/// Only a name beside itself can be one: a move into another folder is never the
/// same entry. Whether the two paths reach one entry is `same`'s to say, handed in
/// so the decision can be tested on a filesystem that tells case apart.
pub(crate) fn respelled(source: &Path, target: &Path, same: impl Fn(&Path, &Path) -> bool) -> bool {
    source != target && source.parent() == target.parent() && same(source, target)
}

/// Whether two paths name one directory entry, rather than two entries that happen
/// to hold the same file.
///
/// On a Unix the entry's device and inode, with one caution: a file with a second
/// hard link has the same inode under another name that is not a respelling, and
/// renaming over it would take that name away. A file with one link, or a folder
/// (which cannot be hard-linked), reached under two spellings is one entry.
#[cfg(unix)]
pub(crate) fn same_entry(one: &Path, other: &Path) -> bool {
    use std::os::unix::fs::MetadataExt as _;

    match (fs::symlink_metadata(one), fs::symlink_metadata(other)) {
        (Ok(one), Ok(other)) => {
            one.dev() == other.dev()
                && one.ino() == other.ino()
                && (one.is_dir() || one.nlink() == 1)
        }
        _ => false,
    }
}

/// On Windows the file's own spelling of its path: `canonicalize` asks the handle
/// for its final name, which comes back the same for both spellings of one file.
/// The file index that would say it directly is not stable in `std` yet.
#[cfg(not(unix))]
pub(crate) fn same_entry(one: &Path, other: &Path) -> bool {
    match (fs::canonicalize(one), fs::canonicalize(other)) {
        (Ok(one), Ok(other)) => one == other,
        _ => false,
    }
}

/// Moves a note or a folder to where it is going.
///
/// Two notes cannot share a path, and a rename that would overwrite one is a
/// mistake rather than an instruction. The check races with whatever else is
/// writing to the folder, which is as close as either platform gets: both renames
/// replace the target without asking. A respelling is the exception, since what is
/// there is the note itself; see `respell`.
pub(crate) fn move_entry(source: &Path, target: &Path, respelling: bool) -> Result<(), String> {
    if respelling {
        return respell(source, target);
    }

    if target.exists() {
        return Err("something already lives there".into());
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    fs::rename(source, target).map_err(|error| cannot("rename", source, &error))
}

/// Renames an entry to another spelling of its own name by way of a name of its
/// own, the way git does on a filesystem that ignores case.
///
/// A direct rename works on APFS and NTFS, but not on every filesystem a Mac
/// mounts - an exFAT stick, a network share - where a rename onto what the
/// filesystem calls the same name is allowed to do nothing and say it succeeded.
/// Two steps through a name nothing else can hold always land. The step is dotted,
/// so the file list never shows it in the moment it exists, and if the second step
/// fails the first is taken back, so the note is never left under it.
fn respell(source: &Path, target: &Path) -> Result<(), String> {
    let step = stepping_name(source)
        .ok_or_else(|| format!("{} has no name to rename", source.display()))?;
    if fs::symlink_metadata(&step).is_ok() {
        return Err("something already lives there".into());
    }

    fs::rename(source, &step).map_err(|error| cannot("rename", source, &error))?;

    fs::rename(&step, target).map_err(|error| {
        let _ = fs::rename(&step, source);
        cannot("rename", source, &error)
    })
}

/// The dotted name beside an entry that a respelling passes through.
fn stepping_name(source: &Path) -> Option<std::path::PathBuf> {
    let mut name = std::ffi::OsString::from(".");
    name.push(source.file_name()?);
    name.push(".nib-renaming");
    Some(source.with_file_name(name))
}

/// Makes a folder inside a space, and every folder above it.
#[tauri::command(async)]
pub fn create_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    made(&target)
}

/// Removes a folder and everything under it.
#[tauri::command(async)]
pub fn delete_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_dir_all(&target).map_err(|error| cannot("delete", &target, &error))
}

/// Removes a folder only if there is nothing whatever left inside it.
///
/// `remove_dir` rather than `remove_dir_all`, and that is the whole point. The
/// caller decided the folder was empty by reading the file tree, and the tree
/// leaves out the dotted files and everything a tab cannot hold - so a folder
/// that looks empty in the sidebar may still hold the picture a note was written
/// around, or a PDF's highlights. This refuses instead of taking those with it,
/// and the caller ignores the refusal: a folder left standing is a folder, while
/// a picture taken away is gone. See `unnest` in workspace.svelte.ts.
#[tauri::command(async)]
pub fn remove_empty_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_dir(&target).map_err(|error| cannot("delete", &target, &error))
}

/// When a file was last written, and how long it is: enough to tell that
/// something other than this app has changed it.
///
/// Two numbers and a copy, so that anything holding what it read of a file can
/// hold one of these beside it and tell in a `stat` call whether what it read is
/// still what is there; see `warm` in search.rs.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Stamp {
    /// Milliseconds since the epoch, as the window counts time.
    pub modified: u64,
    /// How many bytes the file holds.
    pub len: u64,
}

/// The stamp of one file, or nothing where there is no file to stamp.
///
/// What the window watches an opened file with. A file the reader keeps outside
/// every space is a file other programs edit - a build writes it, a script
/// rewrites it, git checks another branch out over it - and the note open in the
/// editor should follow rather than sit there stale until it is saved over the
/// top. Two numbers rather than a hash: reading a megabyte every few seconds to
/// answer a question a stat call answers is a megabyte wasted.
///
/// Null rather than an error for a file that is gone: a file being deleted or
/// replaced is a thing that happens, not a failure to report.
#[tauri::command(async)]
pub fn file_stamp(path: String) -> Result<Option<Stamp>, String> {
    Ok(stamp_of(&chosen(&path)?))
}

/// The stamp of one file, for the crate's own use: the command above, and the
/// search asking whether the note it is holding is still the note on disk.
///
/// Nothing here reads a byte of the file, which is the whole point: a space of
/// five thousand notes can be asked whether it has changed for the price of five
/// thousand `stat` calls rather than of five thousand reads.
#[must_use]
pub fn stamp_of(target: &Path) -> Option<Stamp> {
    let data = fs::metadata(target).ok()?;
    if !data.is_file() {
        return None;
    }

    Some(Stamp {
        modified: clock::of(data.modified().ok()),
        len: data.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::{move_entry, respelled, same_entry, write_bytes, write_note};
    use std::path::Path;
    // The trait the encoding method hangs off. The module above reaches it
    // through what it imports; a test module is its own scope and has to say so.
    use base64::Engine;
    use std::fs;

    /// The bytes of a two by one PNG, which is a picture rather than text and so
    /// cannot go through the text writer at all.
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff];

    fn path(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn writes_bytes_untouched() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    #[test]
    fn makes_the_folders_it_needs() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "Exports/deep/picture.png");

        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    #[test]
    fn refuses_a_path_that_names_no_file() {
        // The same check the text writer is held to; see paths::chosen.
        let error = write_bytes("/".to_string(), super::BASE64.encode(PNG))
            .expect_err("a root that is not a file");
        assert!(error.contains("does not name a file"), "{error}");
    }

    #[test]
    fn refuses_something_that_is_not_base64() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        let error = write_bytes(target.clone(), "not base64!!".to_string())
            .expect_err("nonsense to be refused");
        assert!(error.contains("not base64"), "{error}");
        assert!(
            !std::path::Path::new(&target).exists(),
            "nothing was written"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_note(path(&dir, "note.md"), "hello".to_string()).expect("the write to land");
        write_bytes(path(&dir, "picture.png"), super::BASE64.encode(PNG)).expect("the write");

        let left: Vec<String> = fs::read_dir(dir.path())
            .expect("the folder")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".nib-tmp"))
            .collect();

        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn replaces_what_was_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        write_bytes(target.clone(), super::BASE64.encode(b"old")).expect("the first write");
        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the second write");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    /// The editor always hands over `\n`; what reaches the disk is what the file
    /// already used, so correcting one word in a Windows file is a change to one
    /// line rather than to every line of it.
    #[test]
    fn keeps_the_line_endings_a_file_already_had() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "windows.md");

        fs::write(&target, b"one\r\ntwo\r\n").expect("the file to start out with CRLF");
        write_note(target.clone(), "one\ntwo!\n".to_string()).expect("the write to land");

        assert_eq!(
            fs::read(&target).expect("the file back"),
            b"one\r\ntwo!\r\n"
        );
    }

    #[test]
    fn leaves_a_file_written_with_newlines_alone() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "unix.md");

        fs::write(&target, b"one\ntwo\n").expect("the file to start out with LF");
        write_note(target.clone(), "one\ntwo!\n".to_string()).expect("the write to land");

        assert_eq!(fs::read(&target).expect("the file back"), b"one\ntwo!\n");
    }

    #[test]
    fn writes_a_new_file_with_newlines() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "fresh.md");

        write_note(target.clone(), "one\ntwo\n".to_string()).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), b"one\ntwo\n");
    }

    /// Text that already carries `\r\n` - a paste from somewhere else - must not
    /// come out as `\r\r\n`.
    #[test]
    fn never_doubles_a_carriage_return() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "mixed.md");

        fs::write(&target, b"one\r\n").expect("the file to start out with CRLF");
        write_note(target.clone(), "one\r\ntwo\n".to_string()).expect("the write to land");

        assert_eq!(fs::read(&target).expect("the file back"), b"one\r\ntwo\r\n");
    }

    /// A file whose first line is longer than the head that is read still answers,
    /// because the answer is the first line ending anywhere in that head.
    #[test]
    fn reads_only_the_head_of_a_file_to_answer() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "long.md");

        let mut body = "x".repeat(super::HEAD * 2).into_bytes();
        body.extend_from_slice(b"\r\nafter\r\n");
        fs::write(&target, &body).expect("a long first line");

        // Nothing was found in the head, so the file is written the way a new one
        // is. Said out loud because it is a choice: a first line longer than eight
        // kilobytes is not a line anybody wrote.
        assert!(!super::crlf(std::path::Path::new(&target)));
    }

    #[test]
    fn stamps_a_file_and_says_nothing_of_one_that_is_not_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "watched.md");

        assert!(super::file_stamp(target.clone())
            .expect("no error for a missing file")
            .is_none());

        fs::write(&target, b"words").expect("the file");
        let stamp = super::file_stamp(target)
            .expect("the stamp")
            .expect("a file that is there");

        assert_eq!(stamp.len, 5);
        assert!(stamp.modified > 0);
    }

    #[test]
    fn does_not_stamp_a_folder() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let inside = path(&dir, "folder");
        fs::create_dir(&inside).expect("the folder");

        assert!(super::file_stamp(inside).expect("no error").is_none());
    }

    /// A rename that only changes a capital is the note itself, not a collision.
    /// Whether two paths reach one entry is handed in, because this machine's disk
    /// tells case apart and a Mac's does not.
    #[test]
    fn a_respelling_is_a_name_beside_itself_that_reaches_the_same_entry() {
        fn asks<'a>(from: &'a str, to: &'a str) -> (&'a Path, &'a Path) {
            (Path::new(from), Path::new(to))
        }

        let same = |_: &Path, _: &Path| true;
        let other = |_: &Path, _: &Path| false;

        let (from, to) = asks("/s/idea.md", "/s/Idea.md");
        assert!(respelled(from, to, same));
        assert!(!respelled(from, to, other));

        // A move is never one, whatever the disk says, and nor is no change at all.
        let (from, to) = asks("/s/idea.md", "/s/in/Idea.md");
        assert!(!respelled(from, to, same));
        let (from, to) = asks("/s/idea.md", "/s/idea.md");
        assert!(!respelled(from, to, same));
    }

    #[test]
    fn respells_a_note_through_a_name_of_its_own() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("idea.md"), dir.path().join("Idea.md"));
        fs::write(&from, "words").expect("the note");

        move_entry(&from, &to, true).expect("the respelling");

        assert_eq!(fs::read_to_string(&to).expect("the note, renamed"), "words");
        let left: Vec<_> = fs::read_dir(dir.path()).expect("the folder").collect();
        assert_eq!(left.len(), 1, "nothing but the note is left behind");
    }

    #[test]
    fn respells_a_folder_with_everything_in_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the folder");
        fs::write(from.join("plan.md"), "plan").expect("a note inside");

        move_entry(&from, &to, true).expect("the respelling");

        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    #[test]
    fn refuses_to_move_onto_another_note() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&from, "a").expect("one note");
        fs::write(&to, "b").expect("another");

        assert!(move_entry(&from, &to, false).is_err());
        assert_eq!(fs::read_to_string(&to).expect("the other note"), "b");
    }

    /// A second hard link is the same file under a name that is not a respelling,
    /// and renaming over it would take that name away.
    #[cfg(unix)]
    #[test]
    fn a_hard_link_is_not_the_same_entry() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (one, other) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&one, "a").expect("the note");
        fs::hard_link(&one, &other).expect("a second link");

        assert!(!same_entry(&one, &other));
        assert!(same_entry(dir.path(), dir.path()));
    }
}
