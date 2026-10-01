//! A note is a file. This module owns the ten things the window can ask of one:
//! read it, write it back as text, write it back as bytes, rename or move it,
//! copy it, delete it, ask when it was last written and how long it is, make the folder it
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

use crate::carry::{copy_whole, move_whole};
use crate::clock;
use crate::paths::{
    at_most, cannot, chosen, copy_highlights, drop_highlights, in_spaces, made, move_highlights,
    openable, write_atomically,
};

/// The most a note may be for nib to read it: 64 MiB.
///
/// Not a limit anybody writing notes meets. The account keeps a note to 4 MiB
/// (`MAX_NOTE_BYTES` in services/sync/src/notes.ts), and the editor stops parsing
/// one past 512 KiB (`PARSED_AT_MOST` in packages/editor/src/modes.ts); this is
/// sixteen times the first. What it stops is a file of gigabytes somebody left in a
/// space - a log, an export, a dump - which read whole is an allocation the app does
/// not survive, and which would cross to the window as a string of the same size if
/// it did. The browser build refuses at the same number; see `read_note` in
/// web/commands.ts.
pub const MOST_NOTE_BYTES: u64 = 64 * 1024 * 1024;

/// What a file past that is refused with: the account's own sentence for a note too
/// large to keep, so every catalogue carries it already.
pub const TOO_LARGE: &str = "that note is too large";

/// Reads a note: a file in a space, or one of the app's own two settings files.
/// nib opens nothing from anywhere else on the disk; see `openable`.
#[tauri::command(async)]
pub fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    let target = openable(&app, &path)?;
    // A note iCloud took off this Mac is brought back before it is read.
    #[cfg(target_os = "macos")]
    icloud::fetched(&app, &target)?;
    words_of(&target)
}

/// The words of a note: the file whole, when it is small enough to be one and is
/// text. What `read_note` answers with, and how the search and the link scan read a
/// space, so that none of the three reads a file of gigabytes whole - the scan least
/// of all, which reads every note in a space at the launch, before anybody has
/// opened anything. See `MOST_NOTE_BYTES`.
pub fn words_of(target: &Path) -> Result<String, String> {
    let bytes = at_most(target, MOST_NOTE_BYTES)?.ok_or(TOO_LARGE)?;
    String::from_utf8(bytes).map_err(|error| cannot("read", target, &error))
}

/// Writes a note atomically, so a crash mid-write can never truncate the note
/// that was already there. Missing folders are created, which is what lets sync
/// land a note at a path that is new on this machine.
///
/// A note in a space, one of the settings files, or the file an export was pointed
/// at in the save dialog; see `chosen`.
///
/// The line endings the file already had are kept; see `as_written`.
#[tauri::command(async)]
pub fn write_note(app: AppHandle, path: String, content: String) -> Result<(), String> {
    note_written(&chosen(&app, &path)?, &path, &content)
}

/// The text writer once the path has been judged.
fn note_written(target: &Path, shown: &str, content: &str) -> Result<(), String> {
    let body = as_written(target, content);
    write_file(target, shown, body.as_bytes())
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

/// Writes bytes, under exactly the checks the text writer is held to: a path the
/// reader chose, the folders above it made, and the file written whole.
///
/// An export is bytes as often as it is text - a Word file, an `ePub`, a
/// picture, a `TextPack`, the pictures inside a `TextBundle` - none of those go
/// through `write_note` without being mangled by the string.
///
/// Base64 rather than an array of numbers: a two megabyte picture written out as
/// JSON digits is twenty megabytes of text for the bridge to parse, and one
/// export is a document plus every picture in it.
#[tauri::command(async)]
pub fn write_bytes(app: AppHandle, path: String, base64: String) -> Result<(), String> {
    bytes_written(&chosen(&app, &path)?, &path, &base64)
}

/// The bytes writer once the path has been judged.
fn bytes_written(target: &Path, shown: &str, base64: &str) -> Result<(), String> {
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|error| format!("{shown} was handed something that is not base64: {error}"))?;

    write_file(target, shown, &bytes)
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

    // A move into a space on another disk is a copy and a removal; see carry.rs.
    move_whole(source, target, "rename")
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

/// Copies a note, a file or a folder with everything in it, which is what pasting a
/// copied row and a Ctrl-drag in the file list both mean.
///
/// Here rather than read and written back through the window, because the file
/// list is not the folder: it leaves out the pictures a note was written around,
/// the dotted files and a PDF's own highlights, and a copy made out of what the
/// list shows would be a copy with holes in it. Bytes, so a PDF or a picture
/// arrives the way it left.
///
/// Like a rename it never writes over anything: the window picks a name nothing
/// answers to first, and a copy that lands on something anyway is a race the
/// reader is told about rather than a file lost.
#[tauri::command(async)]
pub fn copy_path(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = in_spaces(&app, &from)?;
    let target = in_spaces(&app, &to)?;
    copied(&source, &target)
}

/// The copy itself, with the two paths already judged. Whole or not at all, and
/// never over anything; see `copy_whole`.
fn copied(source: &Path, target: &Path) -> Result<(), String> {
    // A folder copied into itself would go on finding the copy it is making.
    if target.starts_with(source) {
        return Err(format!("{} cannot be copied into itself", source.display()));
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    copy_whole(source, target)?;

    // A PDF's highlights are part of it, so the copy has them too. A folder's
    // come along with everything else in it.
    copy_highlights(source, target);
    Ok(())
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

/// The stamp of one file, or nothing where there is no file to stamp: whether a
/// note that would not read is there all the same, and what the mirror compares a
/// space's files by. Two numbers rather than a hash: reading a megabyte to answer a
/// question a stat call answers is a megabyte wasted.
///
/// Only what `read_note` may read, and refused rather than null for anything else,
/// so asking is also how the window learns whether nib may open a path at all.
///
/// Null rather than an error for a file that is gone: a file being deleted or
/// replaced is a thing that happens, not a failure to report.
#[tauri::command(async)]
pub fn file_stamp(app: AppHandle, path: String) -> Result<Option<Stamp>, String> {
    Ok(stamp_of(&openable(&app, &path)?))
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
    use super::{copied, move_entry, respelled, Stamp};
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

    /// The two writers and the stamp past their judges, which want an app around
    /// them: what `chosen` and `openable` let through is tested in paths.rs.
    fn write_bytes(path: String, base64: String) -> Result<(), String> {
        super::bytes_written(Path::new(&path), &path, &base64)
    }

    fn write_note(path: String, content: String) -> Result<(), String> {
        super::note_written(Path::new(&path), &path, &content)
    }

    fn file_stamp(path: &str) -> Option<Stamp> {
        super::stamp_of(Path::new(path))
    }

    #[test]
    fn copies_a_file_byte_for_byte() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("picture.png");
        fs::write(&source, PNG).expect("the picture");

        copied(&source, &dir.path().join("Copies/picture.png")).expect("the copy");
        assert_eq!(
            fs::read(dir.path().join("Copies/picture.png")).expect("the copy back"),
            PNG
        );
        assert_eq!(fs::read(&source).expect("the original"), PNG);
    }

    #[test]
    fn copies_a_folder_with_what_the_list_leaves_out() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(source.join("assets")).expect("the folders");
        fs::write(source.join("Trip.md"), "# Trip").expect("the note");
        fs::write(source.join("assets/map.png"), PNG).expect("the picture");
        fs::write(source.join(".hidden"), "kept").expect("the dotted file");

        let target = dir.path().join("Trip copy");
        copied(&source, &target).expect("the copy");

        assert_eq!(
            fs::read_to_string(target.join("Trip.md")).expect("note"),
            "# Trip"
        );
        assert_eq!(
            fs::read(target.join("assets/map.png")).expect("picture"),
            PNG
        );
        assert_eq!(
            fs::read_to_string(target.join(".hidden")).expect("dotted"),
            "kept"
        );
    }

    #[test]
    fn copies_a_papers_highlights_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("paper.pdf");
        fs::write(&source, b"%PDF").expect("the paper");
        fs::write(dir.path().join("paper.pdf.highlights.json"), "[]").expect("highlights");

        copied(&source, &dir.path().join("paper copy.pdf")).expect("the copy");
        assert!(dir.path().join("paper copy.pdf.highlights.json").exists());
    }

    #[test]
    fn never_writes_over_anything() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::write(dir.path().join("a.md"), "a").expect("a");
        fs::write(dir.path().join("b.md"), "b").expect("b");

        let error = copied(&dir.path().join("a.md"), &dir.path().join("b.md"))
            .expect_err("a taken name to be refused");
        assert!(error.contains("already lives there"), "{error}");
        assert_eq!(fs::read_to_string(dir.path().join("b.md")).expect("b"), "b");
    }

    /// A folder with a file in it that will not be read: the copy is the whole folder or
    /// nothing, and a paste that says it worked while leaving the file out is a copy with
    /// a hole in it nobody was told about.
    #[test]
    fn a_copy_that_cannot_finish_leaves_nothing_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(source.join("assets")).expect("the folders");
        fs::write(source.join("Trip.md"), "# Trip").expect("a note");
        fs::write(source.join("assets/map.png"), PNG).expect("a picture");
        let held = source.join("assets/scan.png");
        fs::write(&held, PNG).expect("a picture nobody may read");
        let Some(_held) = crate::carry::unreadable(&held) else {
            return;
        };

        let target = dir.path().join("Trip copy");
        assert!(copied(&source, &target).is_err());
        assert!(!target.exists(), "half a folder was left behind");
        assert_eq!(
            fs::read(source.join("assets/map.png")).expect("the original"),
            PNG
        );
    }

    #[test]
    fn refuses_a_folder_into_itself() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(&source).expect("the folder");

        let error = copied(&source, &source.join("Trip")).expect_err("a copy into itself");
        assert!(error.contains("into itself"), "{error}");
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
        // The same check the text writer is held to.
        let error = write_bytes("/".to_string(), super::BASE64.encode(PNG))
            .expect_err("a root that is not a file");
        assert!(error.contains("has no folder to write into"), "{error}");
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

        assert!(file_stamp(&target).is_none());

        fs::write(&target, b"words").expect("the file");
        let stamp = file_stamp(&target).expect("a file that is there");

        assert_eq!(stamp.len, 5);
        assert!(stamp.modified > 0);
    }

    #[test]
    fn does_not_stamp_a_folder() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let inside = path(&dir, "folder");
        fs::create_dir(&inside).expect("the folder");

        assert!(file_stamp(&inside).is_none());
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
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        let (one, other) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&one, "a").expect("the note");
        fs::hard_link(&one, &other).expect("a second link");

        assert!(!same_entry(&one, &other));
        assert!(same_entry(dir.path(), dir.path()));
    }

    /// Whether this disk looks a name up the way a Mac's does: `a` found as `A`.
    /// The three tests below ask the real disk, so on one that tells case apart they
    /// have nothing to show and say nothing.
    #[cfg(unix)]
    fn ignores_case(dir: &tempfile::TempDir) -> bool {
        let probe = dir.path().join("case-probe");
        fs::write(&probe, "").expect("the probe");
        let answer = dir.path().join("CASE-PROBE").exists();
        fs::remove_file(&probe).expect("the probe, gone");
        answer
    }

    /// What is in a folder, by name as the disk spells it.
    #[cfg(unix)]
    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("the folder")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    /// `idea.md` to `Idea.md` on a disk that calls both one file: the whole
    /// decision, with the disk's own answer to whether they are one entry.
    #[cfg(unix)]
    #[test]
    fn a_capital_is_changed_on_a_disk_that_ignores_case() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let (from, to) = (dir.path().join("idea.md"), dir.path().join("Idea.md"));
        fs::write(&from, "words").expect("the note");

        assert!(respelled(&from, &to, same_entry));
        move_entry(&from, &to, true).expect("the rename");

        assert_eq!(names(dir.path()), ["Idea.md"]);
        assert_eq!(fs::read_to_string(&to).expect("the note"), "words");
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_changes_its_capital_with_its_notes_in_it() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the folder");
        fs::write(from.join("plan.md"), "plan").expect("a note in it");

        assert!(respelled(&from, &to, same_entry));
        move_entry(&from, &to, true).expect("the rename");

        assert_eq!(names(dir.path()), ["Work"]);
        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    /// `Übersicht` written the way a Mac keyboard composes it, one letter and a
    /// combining mark, renamed to the way it is typed elsewhere, one letter. A Mac's
    /// disk calls both the same name, so it is a respelling like a capital is.
    #[cfg(unix)]
    #[test]
    fn a_name_composed_another_way_is_the_same_note() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let decomposed = dir.path().join("U\u{308}bersicht.md");
        let composed = dir.path().join("\u{dc}bersicht.md");
        fs::write(&decomposed, "overview").expect("the note");

        assert!(respelled(&decomposed, &composed, same_entry));
        move_entry(&decomposed, &composed, true).expect("the rename");

        assert_eq!(names(dir.path()).len(), 1);
        assert_eq!(fs::read_to_string(&composed).expect("the note"), "overview");
    }
}
