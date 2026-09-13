//! Where notes are allowed to live, and how a path handed in from the window is
//! judged before anything on disk is touched.
//!
//! This module owns the two folders the app has - the one the spaces live in and
//! its own, where what it keeps *about* a file goes - the containment check every
//! note and space command goes through, the one deliberate way out of that folder,
//! what counts as a note, a PDF or a canvas, the walk that reads a whole space,
//! and the two file operations that must not leave a mess behind when they fail.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fmt::Display;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The extensions the app treats as a note. Anything else is not listed, not
/// searched and not opened from the command line.
pub const MARKDOWN: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// Recently deleted things wait in here. It sits inside the spaces folder but is
/// not a space, and only the trash commands may touch it.
pub const TRASH: &str = ".trash";

/// How deep the tree walkers go. A folder nested further than this is either a
/// mistake or a symlink pointing at one of its own parents, and following the
/// second one forever is how a file manager hangs.
///
/// This bounds one chain of folders. What bounds how many chains there are is
/// `Seen`.
pub const MAX_DEPTH: usize = 32;

/// Makes each temp file its own, so two windows saving at the same moment cannot
/// write to the same half-finished file.
static WRITES: AtomicU64 = AtomicU64::new(0);

/// What a PDF's highlights are written beside it as. Not a note and not a file
/// anyone opens: it is data about one file, it travels with that file, and it
/// goes when the file goes.
pub const HIGHLIGHTS: &str = ".highlights.json";

/// Names Windows refuses whatever the extension, because each one names a device
/// rather than a file.
///
/// Here rather than in one of the two modules that ask, because both do: `spaces`
/// keeps a new space from being called one, and `trash` will not put a file back
/// under one. A second copy would be a second answer to the same question.
pub const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Whether a name is one of those, going by the part in front of the first dot,
/// which is where Windows looks: `NUL.md` names the device as surely as `NUL`.
///
/// Asked on every platform, not only on Windows. A note the reader syncs is a
/// note that has to land on all of their machines, and a name only some of them
/// can hold is not a name.
pub fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    RESERVED.contains(&stem.to_ascii_uppercase().as_str())
}

/// Whether a path names a note, in whichever case the extension is written.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| MARKDOWN.contains(&extension.to_lowercase().as_str()))
}

/// Whether a path names a PDF, in whichever case the extension is written. One
/// of the two things beside a note that the window can open in a tab of its own.
pub fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

/// Whether a path names a canvas: the plane of cards Obsidian keeps in a
/// `.canvas` file, which Nib reads and writes as JSON Canvas 1.0.
///
/// It is text, so `read_note` and `write_note` already carry it and nothing here
/// has to know what is inside; the crate only has to agree that it is a file the
/// window lists and opens.
pub fn is_canvas(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("canvas"))
}

/// Whether a path names a page note: the stack of paper a pen is used on, kept
/// in a `.pages` file.
///
/// The same file as a canvas under another name - JSON Canvas with pages among
/// its nodes - so the same reasoning holds: it is text, `read_note` and
/// `write_note` carry it, and the crate only has to agree that it is a file the
/// window lists and opens. It did not, which left a page note drawn in a tab and
/// in nothing else: no row in the file list, and nothing for the mirror to send
/// up, since the mirror walks the tree this crate builds.
pub fn is_pages(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pages"))
}

/// Whether a path names a website: a shortcut file rather than words.
///
/// `.url` is the Windows Internet Shortcut - an INI file with an address in it,
/// which Explorer and every browser write - and it is the one the app writes.
/// `.webloc` is the same idea on macOS, a plist, which Safari writes and the app
/// only reads. Both are small text files, so `read_note` and `write_note` already
/// carry them the way they carry a canvas, and all the crate has to agree on is
/// that they are files the window lists and opens. See web-tab/shortcut.ts.
pub fn is_shortcut(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("url") || extension.eq_ignore_ascii_case("webloc")
        })
}

/// Where a PDF's highlights live: the PDF's own name with the suffix after it,
/// so the two sit together in a folder and no note can ever collide with one.
pub fn highlights_of(pdf: &Path) -> PathBuf {
    let mut name = pdf.file_name().unwrap_or_default().to_os_string();
    name.push(HIGHLIGHTS);
    pdf.with_file_name(name)
}

/// A PDF's highlights travel with it. They are data about the file rather than a
/// file of their own, so a rename or a move that left them behind would leave
/// them describing a name nothing answers to.
///
/// Quiet about failure on purpose: the PDF has already moved, and a sidecar that
/// could not follow is a lost set of highlights, not a lost file.
pub fn move_highlights(from: &Path, to: &Path) {
    if !is_pdf(from) {
        return;
    }

    let source = highlights_of(from);
    if source.exists() {
        let _ = fs::rename(&source, highlights_of(to));
    }
}

/// And they go when it goes.
pub fn drop_highlights(pdf: &Path) {
    if is_pdf(pdf) {
        let _ = fs::remove_file(highlights_of(pdf));
    }
}

/// What went wrong and which file it was about. An `io::Error` names the failure
/// but never the path, and a message the window puts in front of someone has to
/// say both.
pub fn cannot(verb: &str, path: &Path, error: &impl Display) -> String {
    format!("could not {verb} {}: {error}", path.display())
}

/// Makes a folder, and every folder above it, saying which one it could not make.
///
/// Here rather than in each of the modules that keeps something in a folder of its
/// own, because all of them do: the spaces folder, the trash, the themes, one
/// note's history, a paper's words, the log, and the folder a note is written into.
pub fn made(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| cannot("create", dir, &error))
}

/// The variable that says where the notes are, for a probe or a drive.
///
/// **The identifier a build runs under does not keep anybody's notes apart.** It moves
/// the settings folder and the browsing profile, and says nothing at all about where the
/// spaces are - so a drive that made itself a space made it in the reader's own
/// `Documents/Nib`, beside their notes. This is the one way to keep out of them, and
/// every probe and drive sets it; see docs/automation.md.
const SPACES_DIR: &str = "NIB_SPACES_DIR";

/// The spaces root a variable names, or `None` for one it does not name.
///
/// Absolute only. A relative path is read against whatever folder the app happened to be
/// started in, which is not a place to decide somebody's notes live; and an empty value
/// is what a shell leaves behind when it clears a variable, so it reads as unset rather
/// than as the root of the disk.
///
/// Pure, and told what the variable said rather than reading it, so the rule is tested
/// without an app, a documents folder, or a variable set across a running test suite.
fn spaces_named(said: Option<&OsStr>) -> Option<PathBuf> {
    let path = PathBuf::from(said?);
    path.is_absolute().then_some(path)
}

/// `Documents/Nib`, so notes sit where a person would look for them rather than
/// buried in application data. Falls back to the home folder on a system that
/// has no documents folder of its own.
///
/// Where the folder is, and nothing more: judging a path is not a reason to make a
/// folder, and judging one is what most of the callers are doing - `in_spaces`
/// stands in front of every note, folder, tree, search and trash command, and a
/// note being read asks whether it is inside. What wants the folder to be there
/// says so, with `spaces_root`.
///
/// `NIB_SPACES_DIR` wins outright, and is read at call time and before the documents
/// folder is asked for: a drive that says where the notes go must not be overruled by a
/// documents folder, and must not need one to exist at all.
pub fn spaces_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(named) = spaces_named(std::env::var_os(SPACES_DIR).as_deref()) {
        return Ok(named);
    }

    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the documents folder: {error}"))?;

    Ok(base.join("Nib"))
}

/// The same folder, made if it is not there yet. What the commands that read or
/// write the folder itself ask for: the list of spaces, a new space, the trash.
pub fn spaces_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = spaces_dir(app)?;
    made(&dir)?;

    Ok(dir)
}

/// The app's own folder, which is where what the app keeps *about* a file lives:
/// the themes, the reader's own stylesheet, every version of every note, the words
/// taken out of a paper.
///
/// Nothing is made here. A folder is made by whoever writes into it, with `made`,
/// because most of the callers want a folder further down anyway.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))
}

/// The app's own log folder, made if it is not there yet.
///
/// Here rather than in one of the two modules that writes into it, because both do:
/// the log itself, and the launch trace that sits beside it.
pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not find the log folder: {error}"))?;

    made(&dir)?;
    Ok(dir)
}

/// The same path with `.` and `..` folded away, so it is judged by where it
/// points rather than by how it was spelled. Nothing is read from disk, and the
/// separators come out as this platform writes them.
pub fn folded(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();

    for part in path.components() {
        match part {
            Component::CurDir => {}
            // Climbing above the top of the path names no place at all, so the
            // component is simply dropped rather than kept for later.
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }

    out
}

/// True when `path` is `root` itself or something inside it.
///
/// Both sides are judged by what they say rather than by what they point at: a
/// space someone symlinked onto another disk is still their space, and `..` was
/// already folded away. What this stops is a path climbing out of the folder,
/// not a reader arranging their own notes.
pub fn inside(root: &Path, path: &Path) -> bool {
    let root = folded(root);
    let path = folded(path);
    if root.as_os_str().is_empty() {
        return false;
    }

    let mut theirs = path.components();
    for ours in root.components() {
        match theirs.next() {
            Some(mine) if same_part(ours, mine) => {}
            _ => return false,
        }
    }

    true
}

/// The space a folder belongs to: the folder directly inside `spaces` that holds
/// it, or the folder itself when it is one. None when it is not in a space at
/// all, which is what a note opened from somewhere else on the disk looks like,
/// and also what the spaces folder itself is.
///
/// Takes the spaces folder rather than the app, so what counts as a space can be
/// tested without one.
pub fn space_root(spaces: &Path, path: &Path) -> Option<PathBuf> {
    let spaces = folded(spaces);
    let path = folded(path);
    if !inside(&spaces, &path) {
        return None;
    }

    // The first part below the spaces folder is the space; the path itself is
    // the spaces folder when there is no such part, and that is no space.
    let mut parts = path.components().skip(spaces.components().count());
    parts.next().map(|first| spaces.join(first))
}

/// One part of a path against another. Windows tells `Notes` and `notes` apart
/// nowhere but in the letters, so neither does this.
fn same_part(one: Component, other: Component) -> bool {
    if cfg!(windows) {
        let (one, other) = (one.as_os_str(), other.as_os_str());
        one.to_string_lossy().to_lowercase() == other.to_string_lossy().to_lowercase()
    } else {
        one == other
    }
}

/// The gate every note, folder and space command goes through: a string from the
/// window only becomes a path once it is known to be inside the spaces folder.
/// The trash is inside that folder and still refused, because nothing but the
/// trash commands has any business in it.
pub fn in_spaces(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    judged(&spaces_dir(app)?, path)
}

/// That gate, with the spaces folder passed in rather than asked for, so what it
/// refuses can be said without an app around it.
fn judged(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if !inside(root, &target) || inside(&root.join(TRASH), &target) {
        return Err(format!("{path} is outside the notes folder"));
    }

    Ok(target)
}

/// A space is a folder directly inside the spaces folder, and not a hidden one.
/// Renaming or deleting a space moves a whole tree, so the path is held to the
/// stricter shape rather than to mere containment.
pub fn a_space(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    judged_space(&spaces_dir(app)?, path)
}

/// That shape, with the spaces folder passed in, for the same reason `judged` takes
/// one: a space is a shape a test can be about.
fn judged_space(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    let directly_inside = target
        .parent()
        .is_some_and(|parent| inside(root, parent) && inside(parent, root));
    let hidden = target
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with('.'));

    if !directly_inside || hidden {
        return Err(format!("{path} is not a space"));
    }

    Ok(target)
}

/// A path the reader chose: a file picked in the dialog, one named on the
/// command line, one the shell handed over, or the target of an export.
///
/// This is deliberately any path the app can reach. Nib edits files, and a file
/// worth editing is wherever it already is, so `read_note` and `write_note` are
/// the one way out of the spaces folder. It is written down here so that it
/// reads as a decision at the call site rather than as a missing check.
pub fn chosen(path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if target.file_name().is_none() {
        return Err(format!("{path} does not name a file"));
    }

    Ok(target)
}

/// Whether a path lies outside the spaces folder. A documents folder that cannot
/// even be resolved counts as outside, which is the cautious answer.
pub fn outside_spaces(app: &AppHandle, path: &Path) -> bool {
    spaces_dir(app).map_or(true, |root| !inside(&root, path))
}

/// The folders notes were opened from outside the spaces folder. Pictures sit
/// beside a note rather than inside it, so what is remembered is the folder and
/// not the single file.
#[derive(Default)]
pub struct Opened(Mutex<HashSet<PathBuf>>);

/// Whether a folder is one whose whole tree a note in it may reach.
///
/// What this rules out is the top of a disk. Opening a note gives the folder it
/// sits in, and everything under that folder, to the picture readers and to the
/// asset protocol - which for a note at `C:\` or at `/` would be the whole
/// machine. A note there is a note whose own folder is not a folder anybody meant
/// to share, so it gets no pictures rather than giving away a disk.
pub fn a_shareable_folder(folder: &Path) -> bool {
    folder
        .parent()
        .is_some_and(|above| !above.as_os_str().is_empty())
}

/// Records a note the app was asked to open from outside the spaces folder, so
/// the pictures beside it can be read and shown as well.
pub fn note_from_outside(app: &AppHandle, path: &Path) {
    let Some(folder) = path.parent().map(folded) else {
        return;
    };
    if !a_shareable_folder(&folder) {
        return;
    }

    if let Some(opened) = app.try_state::<Opened>() {
        if let Ok(mut folders) = opened.0.lock() {
            folders.insert(folder.clone());
        }
    }

    // The webview loads a picture over the asset protocol, which keeps a scope
    // of its own: a note it may read is a note whose pictures it may show.
    let _ = app.asset_protocol_scope().allow_directory(&folder, true);
}

/// Where a picture may be read from or written to: inside the spaces folder, or
/// beside a note the app was asked to open from outside it. A note can point at
/// a picture, so this is the reach a note gets, and no more.
pub fn beside_a_note(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if let Ok(root) = spaces_dir(app) {
        if inside(&root, &target) && !inside(&root.join(TRASH), &target) {
            return Ok(target);
        }
    }

    if let Some(opened) = app.try_state::<Opened>() {
        if let Ok(folders) = opened.0.lock() {
            if folders.iter().any(|folder| inside(folder, &target)) {
                return Ok(target);
            }
        }
    }

    Err(format!("{path} is not in a folder Nib has open"))
}

/// The folders a walk has already been inside, judged by where they really are
/// rather than by the path they were reached through.
///
/// The depth cap bounds one chain of folders and not how many chains there are,
/// and a symlink multiplies the chains. Two folders each holding a link to the
/// other hand the same note back once for every level the cap allows, each time
/// under a name of its own; a folder holding two links back to one of its parents
/// doubles the work at every level instead, which is two billion paths and a
/// sidebar that never finishes loading. Walking each folder once settles both: a
/// walk costs what the disk holds and no more.
///
/// A folder reachable two ways is therefore read the first way it is reached, and
/// the second way reads as empty. That is the answer this app wants: one note in
/// two places is still one note, and listing it twice is what a search must not
/// do.
///
/// The cost is one `canonicalize` per folder, beside the metadata call each walk
/// already makes per file.
#[derive(Default)]
pub struct Seen(HashSet<PathBuf>);

impl Seen {
    /// True the first time a folder is offered and false every time after.
    ///
    /// A folder whose real path cannot be read is judged by the path it was
    /// reached through. That may miss a cycle, and the depth cap is then what
    /// ends the walk.
    pub fn first_time(&mut self, dir: &Path) -> bool {
        self.0
            .insert(fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()))
    }
}

/// Every file in a space, split into the notes and everything else, each list in
/// a stable order so two walks of an unchanged space read the same.
///
/// Here rather than in one of the two modules that walk a space, because both do:
/// `search` reads every note for a word or a tag, and `links` reads every note
/// for the links out of it and every other file for a picture an embed might
/// name. A second copy of the walk would be a second answer to what counts as
/// part of a space.
///
/// Hidden folders are skipped, which is what keeps the trash out of a search, and
/// every folder is walked once, so a symlink pointing at one of its own parents
/// cannot be followed forever: see `Seen`.
pub fn files_in(dir: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut notes = Vec::new();
    let mut others = Vec::new();
    gather(dir, 0, &mut Seen::default(), &mut notes, &mut others);
    notes.sort();
    others.sort();
    (notes, others)
}

fn gather(
    dir: &Path,
    depth: usize,
    seen: &mut Seen,
    notes: &mut Vec<PathBuf>,
    others: &mut Vec<PathBuf>,
) {
    if depth >= MAX_DEPTH || !seen.first_time(dir) {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        if path.is_dir() {
            gather(&path, depth + 1, seen, notes, others);
        } else if is_markdown(&path) {
            notes.push(path);
        } else if !entry.file_name().to_string_lossy().ends_with(HIGHLIGHTS) {
            // A PDF's highlights are part of that PDF, not a file of the space:
            // nothing links to them and nothing searches them.
            others.push(path);
        }
    }
}

/// A stable, filesystem-safe folder name for a file's full path, so that what the
/// app keeps *about* a file can be found again without the path itself being a
/// folder name.
///
/// Any hash would do; this one is `FNV-1a`, which is a dozen lines and needs no
/// dependency. Folded case first, because two spellings of one path on Windows are
/// one file. Here rather than in one of the two modules that keeps something
/// beside a file, because both do: the version history of a note, and the words
/// taken out of a PDF.
#[must_use]
pub fn folder_key(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// What a folder named by `folder_key` keeps the file's own path in, so the store
/// can be listed by file without every record in it being read.
///
/// The other half of `folder_key`, and here for the same reason: the version
/// history of a note and the words taken out of a PDF each keep one.
pub const ORIGIN: &str = "origin.txt";

/// A path inside a space as the space speaks of it: relative, and with `/`
/// separators whichever the platform writes.
///
/// Here rather than in one of the modules that walks a space, because both do:
/// `links` names a note this way so a link can point at it, and `search` reads
/// the same spelling for the `path:` operator.
pub fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Writes a file whole: a temp file beside it takes the content and is flushed to
/// the disk itself before being renamed over the target. A crash, a full disk or
/// a pulled cable leaves either the old file or the new one, never half of
/// either, and never a temp file lying around.
pub fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{} has no folder to write into", target.display()))?;
    let name = target.file_name().and_then(OsStr::to_str).unwrap_or("file");

    // Hidden, so a half-written note never shows up in the tree beside the real
    // one, and named after this process so two windows cannot collide.
    let temp = parent.join(format!(
        ".{name}.{}-{}.nib-tmp",
        std::process::id(),
        WRITES.fetch_add(1, Ordering::Relaxed)
    ));

    if let Err(error) = spill(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        cannot("save", target, &error)
    })
}

/// The half of an atomic write that can fail with the temp file already there.
fn spill(temp: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(temp).map_err(|error| cannot("write", temp, &error))?;
    file.write_all(bytes)
        .map_err(|error| cannot("write", temp, &error))?;
    // The rename is only atomic if the bytes reached the disk before it.
    file.sync_all()
        .map_err(|error| cannot("finish writing", temp, &error))
}

/// `path` if nothing is there, else the first free `name 2`, `name 3`... - the
/// number before the extension for a file, after the name for a folder.
pub fn free_spot(path: &Path, is_file: bool) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let file_name = path
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().to_string());

    let (stem, extension) = match file_name.rfind('.') {
        Some(dot) if is_file && dot > 0 => {
            (file_name[..dot].to_string(), file_name[dot..].to_string())
        }
        _ => (file_name.clone(), String::new()),
    };

    let mut counter = 2;
    loop {
        let candidate = parent.join(format!("{stem} {counter}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Points `link` at the folder `target`, and says whether the platform made one.
///
/// Here rather than in the test module below because both walkers are held to the
/// same bound and a cycle is built the same way for either.
#[cfg(all(test, unix))]
pub(crate) fn link_to(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}

/// Points `link` at the folder `target`, and says whether Windows made one.
///
/// A symlink there needs a privilege an ordinary account does not hold, so the
/// fallback is a junction, which is the same thing as far as a walk is concerned:
/// one folder under a second name, resolved by `canonicalize` and stepped into by
/// `is_dir`. A machine that can make neither has no cycle to measure, and the
/// tests say so by stopping.
#[cfg(all(test, windows))]
pub(crate) fn link_to(target: &Path, link: &Path) -> bool {
    if std::os::windows::fs::symlink_dir(target, link).is_ok() {
        return true;
    }

    std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .is_ok_and(|made| made.status.success())
}

#[cfg(test)]
mod tests {
    use super::{
        a_shareable_folder, drop_highlights, files_in, folded, folder_key, free_spot,
        highlights_of, inside, is_canvas, is_markdown, is_pages, is_pdf, is_shortcut, judged,
        judged_space, link_to, move_highlights, space_root, spaces_named, write_atomically,
    };
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    /// Written the way the platform writes them, so the assertions read the same
    /// on a runner as they do on a laptop.
    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    /// A probe says where its notes go, because nothing else does: the identifier a
    /// build runs under moves the settings and the browsing profile and leaves the
    /// spaces in `Documents/Nib`, which is where a drive of mine wrote a space of its
    /// own beside somebody's real notes. See `SPACES_DIR` and docs/automation.md.
    #[test]
    fn a_variable_says_where_the_spaces_are_and_wins() {
        let absolute = if cfg!(windows) {
            path(&[r"C:\", "probe", "notes"])
        } else {
            path(&["/", "probe", "notes"])
        };

        // What comes back is that folder itself: not joined with `Nib`, and with no
        // documents folder anywhere in it. That is what "wins" means - `spaces_dir`
        // answers this before it asks for a documents folder at all.
        let said = spaces_named(Some(absolute.as_os_str())).expect("an absolute path");
        assert_eq!(said, absolute);
        assert!(!said.ends_with("Nib"));
    }

    /// Anything that is not an absolute path is not an override. A relative one would be
    /// read against whatever folder the app was started in, and an empty value is what a
    /// shell leaves behind when it clears a variable.
    #[test]
    fn a_variable_that_names_no_absolute_folder_is_ignored() {
        assert!(spaces_named(None).is_none());
        assert!(spaces_named(Some(OsStr::new(""))).is_none());
        assert!(spaces_named(Some(OsStr::new("notes"))).is_none());
        assert!(spaces_named(Some(OsStr::new("./notes"))).is_none());
        assert!(spaces_named(Some(OsStr::new("../notes"))).is_none());
        assert!(spaces_named(Some(OsStr::new("Documents/Nib"))).is_none());
    }

    #[test]
    fn folds_a_path_down_to_where_it_points() {
        assert_eq!(folded(&path(&["a", ".", "b"])), path(&["a", "b"]));
        assert_eq!(folded(&path(&["a", "b", "..", "c"])), path(&["a", "c"]));
        assert_eq!(folded(&path(&["a", "..", "..", "b"])), path(&["b"]));
    }

    #[test]
    fn a_path_is_inside_the_folder_it_starts_with() {
        let root = path(&["notes", "Nib"]);
        assert!(inside(&root, &root));
        assert!(inside(&root, &path(&["notes", "Nib", "Work", "a.md"])));
        assert!(!inside(&root, &path(&["notes", "Nibble", "a.md"])));
        assert!(!inside(&root, &path(&["notes"])));
    }

    #[test]
    fn climbing_out_of_the_folder_does_not_count_as_inside() {
        let root = path(&["notes", "Nib"]);
        assert!(!inside(&root, &path(&["notes", "Nib", "..", "secret.md"])));
        assert!(!inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "..", "secret.md"])
        ));
        // Folded first, so a climb that lands back inside is still inside.
        assert!(inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "Home", "a.md"])
        ));
    }

    #[test]
    fn nothing_is_inside_a_folder_with_no_name() {
        assert!(!inside(Path::new(""), &path(&["a"])));
    }

    /// The gate every note, folder, tree, search and trash command goes through,
    /// on the strings a caller can hand it. The window's own side judges a path
    /// before it sends one - see `insideOnly` in automation/inside.ts - and this is
    /// the half that does not take the window's word for it.
    #[test]
    fn the_gate_takes_a_path_inside_the_spaces_folder_and_nothing_else() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        let note = ["Documents", "Nib", "Work", "a.md"];
        assert_eq!(said(&note), Ok(path(&note)));
        // The folder itself is inside itself, which is what a tree read of a whole
        // space asks about.
        assert!(said(&["Documents", "Nib"]).is_ok());
        // A name outside it, a name that merely starts the same way, and the folder
        // above it.
        assert!(said(&["Documents", "Secrets", "a.md"]).is_err());
        assert!(said(&["Documents", "Nibble", "a.md"]).is_err());
        assert!(said(&["Documents"]).is_err());
        assert!(judged(&root, "").is_err());
    }

    /// A path that climbs. `folded` collapses the `..` rather than refusing it, so
    /// what is judged is where the path points: out of the folder is refused, and
    /// back into it is not.
    #[test]
    fn the_gate_refuses_a_path_that_climbs_out_of_the_spaces_folder() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        assert!(said(&["Documents", "Nib", "..", "secret.md"]).is_err());
        assert!(said(&["Documents", "Nib", "Work", "..", "..", "..", "secret.md"]).is_err());
        assert!(said(&["Documents", "Nib", "Work", "..", "Home", "a.md"]).is_ok());
    }

    /// The trash is inside the spaces folder and refused all the same: it is the one
    /// folder in there that is not a space, and only the trash commands may touch
    /// it. A note called `.trashy` is not the trash.
    #[test]
    fn the_gate_refuses_the_trash_it_stands_beside() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        assert!(said(&[".trash"]).is_err());
        assert!(said(&["Documents", "Nib", ".trash"]).is_err());
        assert!(said(&["Documents", "Nib", ".trash", "1-0", "a.md"]).is_err());
        assert!(said(&["Documents", "Nib", ".trashy.md"]).is_ok());
    }

    /// A space is a folder directly inside the spaces folder, which is the stricter
    /// shape: renaming or deleting one moves a whole tree.
    #[test]
    fn a_space_is_a_folder_directly_inside_the_spaces_folder() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged_space(&root, &path(one).to_string_lossy());

        assert!(said(&["Documents", "Nib", "Work"]).is_ok());
        // Deeper than a space, the spaces folder itself, and the folder above it.
        assert!(said(&["Documents", "Nib", "Work", "2026"]).is_err());
        assert!(said(&["Documents", "Nib"]).is_err());
        assert!(said(&["Documents"]).is_err());
        // The app's own folders in there are not spaces to rename or delete.
        assert!(said(&["Documents", "Nib", ".trash"]).is_err());
    }

    /// A space named in somebody's own language is a space, and the gate is about
    /// where a path points rather than which letters it is written in.
    #[test]
    fn a_space_outside_ascii_is_a_space_like_any_other() {
        let root = path(&["Documents", "Nib"]);

        assert!(judged(
            &root,
            &path(&["Documents", "Nib", "メモ", "考え.md"]).to_string_lossy()
        )
        .is_ok());
        assert!(judged_space(
            &root,
            &path(&["Documents", "Nib", "Ideen über alles"]).to_string_lossy()
        )
        .is_ok());
        assert!(judged(
            &root,
            &path(&["Documents", "メモ", "考え.md"]).to_string_lossy()
        )
        .is_err());
    }

    /// Opening a note hands its whole folder to the picture readers and to the
    /// asset protocol. The top of a disk is not a folder anybody meant by that: a
    /// note written to `C:\x.md` and then read would otherwise make every file on
    /// the drive readable.
    #[test]
    fn the_top_of_a_disk_is_not_a_folder_a_note_shares() {
        assert!(a_shareable_folder(&path(&["Users", "me", "Notes"])));

        if cfg!(windows) {
            assert!(!a_shareable_folder(Path::new(r"C:\")));
            assert!(!a_shareable_folder(Path::new(r"\\server\share")));
            assert!(a_shareable_folder(Path::new(r"C:\Notes")));
        } else {
            assert!(!a_shareable_folder(Path::new("/")));
            assert!(a_shareable_folder(Path::new("/Notes")));
        }

        // A note with no folder above it at all shares nothing either.
        assert!(!a_shareable_folder(Path::new("")));
        assert!(!a_shareable_folder(Path::new("Idea.md")));
    }

    #[test]
    fn names_the_space_a_folder_belongs_to() {
        let spaces = path(&["Documents", "Nib"]);
        let space = path(&["Documents", "Nib", "Notes"]);

        assert_eq!(space_root(&spaces, &space), Some(space.clone()));
        assert_eq!(
            space_root(&spaces, &space.join("Work")),
            Some(space.clone())
        );
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("2026")),
            Some(space.clone())
        );
        // Folded first, so a path that climbs back into its own space still
        // names that space.
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("..")),
            Some(space)
        );
    }

    #[test]
    fn nothing_outside_the_spaces_folder_belongs_to_a_space() {
        let spaces = path(&["Documents", "Nib"]);

        assert_eq!(space_root(&spaces, &path(&["elsewhere", "notes"])), None);
        // The spaces folder holds the spaces and is not one of them.
        assert_eq!(space_root(&spaces, &spaces), None);
    }

    #[test]
    #[cfg(windows)]
    fn windows_paths_differ_in_case_without_differing_in_meaning() {
        assert!(inside(
            Path::new(r"C:\Users\me\Documents\Nib"),
            Path::new(r"c:\users\me\documents\nib\Work\a.md")
        ));
    }

    #[test]
    fn names_a_note_by_its_extension() {
        assert!(is_markdown(Path::new("a/b.md")));
        assert!(is_markdown(Path::new("a/b.MARKDOWN")));
        assert!(!is_markdown(Path::new("a/b.txt")));
        assert!(!is_markdown(Path::new("a/b")));
    }

    #[test]
    fn an_atomic_write_leaves_the_file_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");

        write_atomically(&target, b"first").expect("the first write");
        write_atomically(&target, b"second").expect("the second write");

        assert_eq!(
            std::fs::read_to_string(&target).expect("the note"),
            "second"
        );

        let left: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["Note.md".to_string()]);
    }

    #[test]
    fn numbering_goes_before_the_extension_for_files() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Idea 2.md"), "").expect("a second note");
        std::fs::create_dir_all(here.join("Notes")).expect("a folder");

        assert_eq!(
            free_spot(&here.join("Idea.md"), true),
            here.join("Idea 3.md")
        );
        assert_eq!(free_spot(&here.join("Notes"), false), here.join("Notes 2"));
        assert_eq!(free_spot(&here.join("New.md"), true), here.join("New.md"));
    }

    /// The file names, sorted: the walk orders by whole path, and where in the
    /// tree each file sits is not what these tests are about.
    fn names(paths: &[PathBuf]) -> Vec<String> {
        let mut found: Vec<String> = paths
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();
        found.sort();
        found
    }

    #[test]
    fn names_a_pdf_by_its_extension() {
        assert!(is_pdf(Path::new("a/paper.pdf")));
        assert!(is_pdf(Path::new("a/paper.PDF")));
        assert!(!is_pdf(Path::new("a/paper.pdf.md")));
        assert!(!is_pdf(Path::new("a/paper")));
    }

    #[test]
    fn names_a_canvas_by_its_extension() {
        assert!(is_canvas(Path::new("a/Board.canvas")));
        assert!(is_canvas(Path::new("a/Board.CANVAS")));
        // A note that merely mentions one is still a note.
        assert!(!is_canvas(Path::new("a/Board.canvas.md")));
        assert!(!is_canvas(Path::new("a/Board")));
        assert!(!is_markdown(Path::new("a/Board.canvas")));
    }

    #[test]
    fn names_a_page_note_by_its_extension() {
        assert!(is_pages(Path::new("a/Journal.pages")));
        assert!(is_pages(Path::new("a/Journal.PAGES")));
        assert!(!is_pages(Path::new("a/Journal.pages.md")));
        assert!(!is_pages(Path::new("a/Journal")));
        // The two planes are told apart by their names, whatever is inside them.
        assert!(!is_canvas(Path::new("a/Journal.pages")));
        assert!(!is_markdown(Path::new("a/Journal.pages")));
    }

    #[test]
    fn names_a_website_by_its_extension() {
        assert!(is_shortcut(Path::new("a/Svelte docs.url")));
        assert!(is_shortcut(Path::new("a/Svelte docs.URL")));
        // The one macOS writes, which this app reads and never writes.
        assert!(is_shortcut(Path::new("a/Safari page.webloc")));
        assert!(!is_shortcut(Path::new("a/Svelte docs.url.md")));
        assert!(!is_shortcut(Path::new("a/Svelte docs")));
        // And a website is no other kind, whatever a space holds of that name.
        assert!(!is_markdown(Path::new("a/Svelte docs.url")));
        assert!(!is_canvas(Path::new("a/Svelte docs.url")));
        assert!(!is_pages(Path::new("a/Svelte docs.url")));
    }

    #[test]
    fn highlights_sit_beside_the_pdf_under_its_whole_name() {
        assert_eq!(
            highlights_of(&path(&["Nib", "Notes", "paper.pdf"])),
            path(&["Nib", "Notes", "paper.pdf.highlights.json"])
        );
        // Two PDFs whose names differ only in the extension keep two sidecars.
        assert_ne!(
            highlights_of(Path::new("paper.pdf")),
            highlights_of(Path::new("paper.PDF"))
        );
    }

    #[test]
    fn a_sidecar_never_leaves_the_folder_its_pdf_is_in() {
        let root = path(&["Documents", "Nib"]);
        let pdf = root.join("Notes").join("paper.pdf");

        assert_eq!(highlights_of(&pdf).parent(), pdf.parent());
        assert!(inside(&root, &highlights_of(&pdf)));
        // A PDF path that climbs out is refused before a sidecar is named at
        // all: `in_spaces` folds it first, and a folded climb is not inside.
        assert!(!inside(&root, &folded(&root.join("..").join("secret.pdf"))));
    }

    #[test]
    fn the_sidecar_follows_the_pdf_and_goes_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let was = here.join("paper.pdf");
        let now = here.join("Reading").join("renamed.pdf");
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(&was, b"%PDF-1.4").expect("a pdf");
        std::fs::write(highlights_of(&was), "{}").expect("its highlights");

        std::fs::rename(&was, &now).expect("the move");
        move_highlights(&was, &now);

        assert!(!highlights_of(&was).exists());
        assert!(highlights_of(&now).exists());

        drop_highlights(&now);
        assert!(!highlights_of(&now).exists());
    }

    #[test]
    fn a_note_has_no_sidecar_to_move() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let note = here.join("Idea.md");
        // Something that looks like a note's sidecar is left where it is: only a
        // PDF has one, and nothing else may take a file with it.
        std::fs::write(highlights_of(&note), "{}").expect("a decoy");

        move_highlights(&note, &here.join("Other.md"));
        drop_highlights(&note);
        assert!(highlights_of(&note).exists());
    }

    #[test]
    fn a_sidecar_is_not_one_of_the_files_of_a_space() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("paper.pdf"), "").expect("a pdf");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("its highlights");
        std::fs::write(here.join("notes.json"), "{}").expect("a plain json file");

        let (_notes, others) = files_in(here);
        assert_eq!(names(&others), ["notes.json", "paper.pdf"]);
    }

    #[test]
    fn tells_the_notes_of_a_space_from_the_files_beside_them() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Deep/Deeper")).expect("two folders");
        std::fs::create_dir_all(here.join(".hidden")).expect("a hidden folder");
        std::fs::write(here.join("One.md"), "").expect("a note");
        std::fs::write(here.join("Deep/Deeper/Two.markdown"), "").expect("a nested note");
        std::fs::write(here.join("Deep/notes.txt"), "").expect("a text file");
        std::fs::write(here.join("Deep/pic.png"), "").expect("a picture");
        std::fs::write(here.join(".hidden/Three.md"), "").expect("a hidden note");

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md", "Two.markdown"]);
        assert_eq!(names(&others), ["notes.txt", "pic.png"]);
    }

    #[test]
    fn stops_before_it_runs_out_of_stack() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let mut deep = dir.path().to_path_buf();
        // One past the cap, in short names so the whole path stays inside what
        // Windows allows without asking.
        for level in 0..34 {
            deep.push(format!("d{level}"));
        }
        std::fs::create_dir_all(&deep).expect("a very deep folder");
        std::fs::write(deep.join("Buried.md"), "").expect("a buried note");

        let (notes, others) = files_in(dir.path());
        assert!(notes.is_empty());
        assert!(others.is_empty());
    }

    /// Two folders, each holding a symlink to the other. The depth cap alone
    /// walks that chain thirty-two folders deep and hands each note back once per
    /// level, thirty-one times over, which is thirty-one hits in a search for one
    /// note.
    #[test]
    fn a_cycle_of_symlinks_is_walked_once() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Work")).expect("a folder");
        std::fs::create_dir_all(here.join("Home")).expect("another folder");
        std::fs::write(here.join("Work").join("One.md"), "").expect("a note");
        std::fs::write(here.join("Home").join("Two.md"), "").expect("another note");

        assert!(
            link_to(&here.join("Home"), &here.join("Work").join("to-home")),
            "a link from Work into Home"
        );
        assert!(
            link_to(&here.join("Work"), &here.join("Home").join("to-work")),
            "a link from Home into Work"
        );

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md", "Two.md"]);
        assert!(others.is_empty());
    }

    /// The fan-out rather than the chain: a folder holding two links back to the
    /// folder above it doubles the work at every level the cap allows, which is
    /// two billion paths and a walk that does not return. It returns here because
    /// each folder is entered once.
    #[test]
    fn two_links_back_up_do_not_double_the_walk() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");
        std::fs::write(inner.join("One.md"), "").expect("a note");

        assert!(link_to(here, &inner.join("up")), "one link back up");
        assert!(link_to(here, &inner.join("over")), "a second link back up");

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md"]);
        assert!(others.is_empty());
    }

    #[test]
    fn the_same_path_always_gets_the_same_folder() {
        assert_eq!(folder_key("/notes/a.md"), folder_key("/notes/a.md"));
    }

    #[test]
    fn different_paths_get_different_folders() {
        assert_ne!(folder_key("/notes/a.md"), folder_key("/notes/b.md"));
    }

    #[test]
    fn the_same_file_in_another_case_is_the_same_file() {
        assert_eq!(folder_key(r"C:\Notes\A.md"), folder_key(r"c:\notes\a.md"));
    }

    #[test]
    fn the_folder_name_is_filesystem_safe() {
        let name = folder_key(r"C:\notes\a b.md");
        assert_eq!(name.len(), 16);
        assert!(name.chars().all(|letter| letter.is_ascii_hexdigit()));
    }
}
