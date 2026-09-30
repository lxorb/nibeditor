//! Recently deleted, on this machine. A deleted note, folder or space is not
//! removed but moved into `Documents/Nib/.trash/<id>/`, and a manifest beside
//! those folders remembers what each one was and where it came from, so it can
//! be put back for fourteen days. The app sweeps what is older.
//!
//! This module owns that folder, that manifest, and nothing else.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR_STR};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, folded, free_spot, in_spaces, inside, is_reserved, made, move_highlights, spaces_dir,
    write_atomically, TRASH,
};

/// The record of what is in the trash, written beside the folders it describes.
const MANIFEST: &str = "manifest.json";

/// What the app knows how to put back. The kind decides how a name is numbered if
/// its old place has been taken in the meantime.
const KINDS: [&str; 3] = ["note", "folder", "space"];

/// Two deletions in the same millisecond still get different folders.
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// The manifest is read, changed and written whole. Two windows deleting at the
/// same moment would otherwise each write a manifest that does not know about the
/// other's entry, and one of the two notes would be unreachable. Only one process
/// ever runs, so one lock covers it.
static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

/// One thing waiting in the trash.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// The folder inside the trash that holds it.
    pub id: String,
    /// `note`, `folder` or `space`: what the app should call it, and how to
    /// number it if its place is taken on the way back.
    pub kind: String,
    /// The name it had, which is also the name it is stored under.
    pub name: String,
    /// Where it was, relative to the notes folder, with `/` between parts.
    pub from: String,
    /// When it was deleted, in milliseconds since the epoch.
    pub trashed_at: u64,
}

/// Moves a note, folder or space into the trash and says what it became.
#[tauri::command(async)]
pub fn trash_item(app: AppHandle, path: String, kind: String) -> Result<TrashEntry, String> {
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("{kind} is not something nibeditor can delete"));
    }

    let base = spaces_dir(&app)?;
    // Refuses anything outside the notes folder, and the trash itself: what is
    // already deleted cannot be deleted again.
    let source = in_spaces(&app, &path)?;

    let relative = source
        .strip_prefix(&base)
        .map_err(|_| format!("{path} is not in the notes folder"))?;
    if relative.as_os_str().is_empty() {
        return Err("that cannot be deleted".into());
    }
    if !source.exists() {
        return Err("nothing is there".into());
    }

    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("that has no name")?;

    let _guard = locked();
    let dir = trash_dir(&app)?;
    let id = new_id();
    let slot = dir.join(&id);
    made(&slot)?;

    let held = slot.join(&name);
    if let Err(error) = fs::rename(&source, &held) {
        let _ = fs::remove_dir_all(&slot);
        return Err(cannot("delete", &source, &error));
    }

    // A deleted PDF takes its highlights into the same folder, so putting it
    // back puts them back with it.
    move_highlights(&source, &held);

    let entry = TrashEntry {
        id,
        kind,
        name,
        from: relative.to_string_lossy().replace('\\', "/"),
        trashed_at: clock::now(),
    };

    let mut entries = read_manifest(&dir);
    entries.push(entry.clone());

    // An entry that cannot be written down is a note nobody could find again, so
    // it goes back where it came from instead.
    if let Err(error) = write_manifest(&dir, &entries) {
        let _ = fs::rename(&held, &source);
        move_highlights(&held, &source);
        let _ = fs::remove_dir_all(&slot);
        return Err(error);
    }

    Ok(entry)
}

/// Everything in the trash, newest first.
#[tauri::command(async)]
pub fn list_trash(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.trashed_at));
    Ok(entries)
}

/// Puts something back where it was and returns where it landed, which is the
/// old place unless that is taken by now.
#[tauri::command(async)]
pub fn restore_trash(app: AppHandle, id: String) -> Result<String, String> {
    let base = spaces_dir(&app)?;

    let _guard = locked();
    let dir = trash_dir(&app)?;
    let mut entries = read_manifest(&dir);

    let position = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or("nothing to restore")?;
    let entry = entries[position].clone();

    // Where it is now and where it is going, both judged before anything moves:
    // the manifest is a file on disk, and a hand-edited one names neither.
    if !is_slot(&entry.id) {
        return Err("that is not something in the trash".into());
    }
    let target = restore_target(&base, &entry)?;

    let slot = dir.join(&entry.id);
    let held = slot.join(&entry.name);
    if !held.exists() {
        entries.remove(position);
        write_manifest(&dir, &entries)?;
        return Err("it is already gone".into());
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    fs::rename(&held, &target).map_err(|error| cannot("restore", &target, &error))?;
    // The highlights come back under whatever name the PDF landed under, which
    // is not the old one when something has taken its place in the meantime.
    move_highlights(&held, &target);
    let _ = fs::remove_dir_all(&slot);

    entries.remove(position);
    write_manifest(&dir, &entries)?;
    Ok(target.to_string_lossy().to_string())
}

/// Takes one thing away for good.
#[tauri::command(async)]
pub fn purge_trash(app: AppHandle, id: String) -> Result<(), String> {
    if !is_slot(&id) {
        return Err(format!("{id} is not something in the trash"));
    }

    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    purge(&dir, &mut entries, &id);
    write_manifest(&dir, &entries)
}

/// The sweep: everything that has waited longer than `age` milliseconds goes.
/// Returns how many did.
#[tauri::command(async)]
pub fn purge_trash_older_than(app: AppHandle, age: u64) -> Result<u32, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    let cutoff = clock::now().saturating_sub(age);

    let old: Vec<String> = entries
        .iter()
        .filter(|entry| entry.trashed_at < cutoff)
        .map(|entry| entry.id.clone())
        .collect();
    for id in &old {
        purge(&dir, &mut entries, id);
    }

    write_manifest(&dir, &entries)?;
    Ok(u32::try_from(old.len()).unwrap_or(u32::MAX))
}

/// The trash folder, made if it is not there yet. One `create_dir_all` for both:
/// the folder above it is the spaces folder, and making a folder makes its parents.
fn trash_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = spaces_dir(app)?.join(TRASH);
    made(&dir)?;
    Ok(dir)
}

/// The lock, whether or not whoever held it last panicked: what it protects is a
/// file on disk, and that file is no less readable for it.
fn locked() -> MutexGuard<'static, ()> {
    MANIFEST_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A folder name no other deletion will use.
fn new_id() -> String {
    format!(
        "{}-{}",
        clock::now(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Whether a string is one of the folder names `new_id` hands out, which is the
/// shape a whole tree is about to be removed under.
///
/// The window sends an id back to purge one thing, and `purge` joins it onto the
/// trash folder. `..` there names the folder above, and `remove_dir_all` on that
/// takes the notes folder or the documents folder with it, so the id is held to
/// digits and the one hyphen rather than merely to being a single part.
fn is_slot(id: &str) -> bool {
    let Some((moment, counter)) = id.split_once('-') else {
        return false;
    };

    !moment.is_empty()
        && !counter.is_empty()
        && moment.len() <= 20
        && counter.len() <= 20
        && moment.bytes().all(|byte| byte.is_ascii_digit())
        && counter.bytes().all(|byte| byte.is_ascii_digit())
}

/// The manifest, or an empty one when there is nothing to read.
fn read_manifest(dir: &Path) -> Vec<TrashEntry> {
    let path = dir.join(MANIFEST);
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };

    serde_json::from_str(&text).unwrap_or_else(|_| {
        // A manifest that cannot be read is kept rather than written over: the
        // folders beside it still hold the notes, and this is the only record of
        // where each of them came from.
        let _ = fs::rename(&path, dir.join(format!("{MANIFEST}.unreadable")));
        Vec::new()
    })
}

/// Written whole and renamed into place, so a crash mid-write cannot leave half
/// a manifest behind.
fn write_manifest(dir: &Path, entries: &[TrashEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("could not write down what is in the trash: {error}"))?;
    write_atomically(&dir.join(MANIFEST), text.as_bytes())
}

/// Forgets one entry and takes its folder with it. An id of any other shape is
/// forgotten without a folder being removed: the manifest is a file on disk and
/// a hand-edited one must not be able to name a folder outside the trash.
fn purge(dir: &Path, entries: &mut Vec<TrashEntry>, id: &str) {
    if is_slot(id) {
        let _ = fs::remove_dir_all(dir.join(id));
    }
    entries.retain(|entry| entry.id != id);
}

/// Where something is put back, given the notes folder and the entry that says
/// where it came from.
///
/// The manifest is a file in the notes folder like any other, so what it says is
/// read the way anything from outside is: `from` has to land back inside the
/// notes folder and outside the trash, and the name it was stored under has to be
/// a name rather than a path.
fn restore_target(base: &Path, entry: &TrashEntry) -> Result<PathBuf, String> {
    if !is_name(&entry.name) {
        return Err("that is not a name nibeditor stored".into());
    }

    let wanted = folded(&base.join(entry.from.replace('/', MAIN_SEPARATOR_STR)));
    if !inside(base, &wanted) || inside(&base.join(TRASH), &wanted) || wanted == folded(base) {
        return Err("that did not come from the notes folder".into());
    }

    Ok(free_spot(&wanted, entry.kind == "note"))
}

/// Whether a string names one file or folder rather than a path to one. What the
/// trash stores something under is its own name, so nothing else is one.
///
/// Judged by its letters rather than by this platform's path parser, and to the
/// same rule everywhere. `Path` reads `C:` as a drive on Windows and as an
/// ordinary name on Linux, so asking it would make the trash answer differently
/// on the two - and the answer that matters is the stricter one, whichever
/// machine is asking: a manifest travels between them, and a name Windows would
/// read as a drive must not be put back on Linux either.
///
/// Refused, then: anything that could be a path (`/`, `\`, `:`) or end a C string
/// (`NUL`); a trailing dot or space, which Windows drops silently, so the file
/// written would not be the file named - and which is also what rules out `.` and
/// `..`; a leading space, for the same reason at the other end; and a device name.
///
/// A leading dot is kept. A hidden note can be deleted and has to come back, and
/// a dot in front is the only thing about it that is unusual.
fn is_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name.starts_with(' ')
        && !is_reserved(name)
}

#[cfg(test)]
mod tests {
    use super::{
        is_name, is_slot, purge, read_manifest, restore_target, write_manifest, TrashEntry,
        MANIFEST,
    };
    use std::path::{Path, PathBuf};

    fn entry(id: &str, name: &str, from: &str) -> TrashEntry {
        TrashEntry {
            id: id.into(),
            kind: "note".into(),
            name: name.into(),
            from: from.into(),
            trashed_at: 1_700_000_000_000,
        }
    }

    /// Written the way the platform writes them, so the assertions read the same
    /// on a runner as they do on a laptop.
    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn only_a_folder_the_trash_named_itself_is_one() {
        assert!(is_slot("1700000000000-0"));
        assert!(is_slot("1-42"));
        assert!(!is_slot(".."));
        assert!(!is_slot("../.."));
        assert!(!is_slot("1700000000000"));
        assert!(!is_slot("a-0"));
        assert!(!is_slot("1--0"));
        assert!(!is_slot(""));
        assert!(!is_slot("-0"));
        assert!(!is_slot("1-"));
    }

    /// The id comes from the window, and `purge` joins it onto the trash folder
    /// before removing that folder and everything under it. `..` there names the
    /// notes folder, and the folder above that is the reader's documents.
    #[test]
    fn purging_cannot_reach_outside_the_trash() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let trash = dir.path().join("Nib").join(".trash");
        let elsewhere = dir.path().join("Nib").join("Notes");
        std::fs::create_dir_all(&trash).expect("the trash");
        std::fs::create_dir_all(&elsewhere).expect("a space beside it");
        std::fs::write(elsewhere.join("Idea.md"), "mine").expect("a note in it");

        let mut entries = Vec::new();
        for id in ["../Notes", "..", r"..\Notes"] {
            purge(&trash, &mut entries, id);
        }

        assert!(
            elsewhere.join("Idea.md").exists(),
            "the note is still there"
        );
        assert!(elsewhere.exists(), "and so is the space");
    }

    #[test]
    fn a_stored_name_is_a_name_and_not_a_path() {
        assert!(is_name("Idea.md"));
        assert!(is_name("Notizen über Bücher.md"));
        assert!(!is_name(""));
        assert!(!is_name("."));
        assert!(!is_name(".."));
        assert!(!is_name("Work/Idea.md"));
        assert!(!is_name(r"..\Idea.md"));
        assert!(!is_name("/Idea.md"));
        // A drive is a path on Windows and an ordinary name on Linux, and the
        // answer here is the same on both: the rule reads the letters rather than
        // asking a parser that only one of the two platforms has.
        assert!(!is_name("C:"));
        assert!(!is_name(r"C:\Notes\Idea.md"));
        assert!(!is_name("Idea.md:stream"));
        // A trailing dot or space is dropped by Windows, so the file written
        // would not be the file named.
        assert!(!is_name("Idea.md "));
        assert!(!is_name("Idea.md."));
        assert!(!is_name(" Idea.md"));
        // A device name is a device on Windows whatever follows the dot.
        assert!(!is_name("NUL"));
        assert!(!is_name("nul.md"));
        assert!(!is_name("COM1.md"));
        // Only the exact ones, so an ordinary note that starts like one is fine.
        assert!(is_name("Console.md"));
        assert!(is_name("nullable.md"));
        // A name cannot hold a zero byte on either platform.
        assert!(!is_name("Idea\0.md"));
    }

    /// A hidden note can be deleted, so it has to come back. A dot in front is
    /// the only thing unusual about its name, and it is not one of the shapes
    /// that could name somewhere else.
    #[test]
    fn a_hidden_note_is_still_a_name() {
        assert!(is_name(".secret.md"));
        assert!(is_name(".gitignore"));

        let base = path(&["Documents", "Nib"]);
        assert_eq!(
            restore_target(&base, &entry("1-0", ".secret.md", "Work/.secret.md")),
            Ok(base.join("Work").join(".secret.md"))
        );
    }

    /// A manifest is a file in the notes folder, so where it says something came
    /// from is read as warily as anything else from outside.
    #[test]
    fn restoring_lands_back_inside_the_notes_folder() {
        let base = path(&["Documents", "Nib"]);

        assert_eq!(
            restore_target(&base, &entry("1-0", "Idea.md", "Work/Idea.md")),
            Ok(base.join("Work").join("Idea.md"))
        );
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "../Idea.md")).is_err());
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "../../../../etc/passwd")).is_err());
        // Back into the trash is not back where it came from either.
        assert!(restore_target(&base, &entry("1-0", "Idea.md", ".trash/1-0/Idea.md")).is_err());
        // Nor is the notes folder itself, which is no note.
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "")).is_err());
        // And a name that is a path cannot pick a file out of another folder.
        assert!(restore_target(&base, &entry("1-0", "../../Idea.md", "Idea.md")).is_err());
    }

    #[test]
    fn a_restore_numbers_a_name_whose_place_is_taken() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        std::fs::write(base.join("Idea.md"), "the one that stayed").expect("a note");

        let target = restore_target(base, &entry("1-0", "Idea.md", "Idea.md")).expect("a place");
        assert_eq!(target, base.join("Idea 2.md"));
        assert!(Path::new(&target).parent().is_some());
    }

    #[test]
    fn a_manifest_survives_the_round_trip() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let written = vec![
            entry("1-0", "Idea.md", "Work/Idea.md"),
            entry(
                "1-1",
                "Notizen über Bücher.md",
                "Privat/Notizen über Bücher.md",
            ),
        ];

        write_manifest(dir.path(), &written).expect("the manifest");
        let read = read_manifest(dir.path());

        assert_eq!(read.len(), 2);
        assert_eq!(read[1].name, "Notizen über Bücher.md");
        assert_eq!(read[1].from, "Privat/Notizen über Bücher.md");
        assert_eq!(read[0].trashed_at, 1_700_000_000_000);
    }

    #[test]
    fn the_manifest_is_the_camel_case_the_window_reads() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_manifest(dir.path(), &[entry("1-0", "Idea.md", "Idea.md")]).expect("the manifest");

        let text = std::fs::read_to_string(dir.path().join(MANIFEST)).expect("the file");
        assert!(text.contains("\"trashedAt\""));
        assert!(!text.contains("trashed_at"));
    }

    #[test]
    fn nothing_written_yet_reads_as_an_empty_trash() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert!(read_manifest(dir.path()).is_empty());
    }

    #[test]
    fn a_manifest_that_cannot_be_read_is_kept_rather_than_lost() {
        let dir = tempfile::tempdir().expect("a temp folder");
        std::fs::write(dir.path().join(MANIFEST), "{ not json").expect("a broken manifest");

        assert!(read_manifest(dir.path()).is_empty());
        assert!(dir.path().join("manifest.json.unreadable").exists());
    }
}
