//! Spaces live in one folder the app owns, so nobody is ever asked where to put
//! a note. Each space is a directory inside it, named after the space, and this
//! module owns making, listing, renaming and removing those directories.

use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use tauri::AppHandle;

use crate::notes::{move_entry, respelled, same_entry};
use crate::paths::{self, a_space, cannot, is_reserved};

/// Long enough for any real name, short enough to stay well inside the path
/// limits once the space folder and a note name are added.
const MAX_NAME: usize = 64;

/// How many times a taken name is numbered before the app admits defeat. Reached
/// only by someone with five hundred spaces of the same name.
const MAX_TRIES: usize = 500;

/// One space: the name the window shows and the folder it stands for.
#[derive(Serialize)]
pub struct Space {
    name: String,
    path: String,
}

/// The folder every space lives in, as a string the window can hand back. Made
/// if it is not there yet, so this waits for the disk.
#[tauri::command(async)]
pub fn spaces_root(app: AppHandle) -> Result<String, String> {
    Ok(paths::spaces_root(&app)?.to_string_lossy().to_string())
}

/// Every space on disk, alphabetical. The folder is the source of truth, so a
/// space copied in by hand simply appears.
#[tauri::command(async)]
pub fn list_spaces(app: AppHandle) -> Result<Vec<Space>, String> {
    let dir = paths::spaces_root(&app)?;
    let mut spaces = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|error| cannot("read", &dir, &error))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // A dot in front means the app's own business, the trash above all.
        if path.is_dir() && !name.starts_with('.') {
            spaces.push(Space {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    spaces.sort_by_key(|space| space.name.to_lowercase());
    Ok(spaces)
}

/// Creates a space and returns where it landed. The folder name is derived from
/// what was typed, and numbered if that name is taken.
#[tauri::command(async)]
pub fn create_space(app: AppHandle, name: String) -> Result<Space, String> {
    let dir = paths::spaces_root(&app)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;

    // Creating the folder is how the name is claimed: `create_dir` fails when
    // something is already there, so two windows asking at the same moment end
    // up with two spaces rather than sharing one.
    let mut candidate = wanted.clone();
    for counter in 2..=MAX_TRIES {
        let path = dir.join(&candidate);

        match fs::create_dir(&path) {
            Ok(()) => return Ok(space_at(&path)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                candidate = format!("{wanted} {counter}");
            }
            Err(error) => return Err(cannot("create", &path, &error)),
        }
    }

    Err(format!("there are already too many spaces called {wanted}"))
}

/// Renames a space by renaming its folder.
#[tauri::command(async)]
pub fn rename_space(app: AppHandle, from: String, name: String) -> Result<Space, String> {
    let source = a_space(&app, &from)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;
    // Beside itself: `a_space` has already said the folder is directly inside the
    // spaces folder, and a rename never moves it out.
    let target = source.with_file_name(&wanted);

    rename_folder(&source, &target, same_entry)?;
    Ok(space_at(&target))
}

/// Renames a space's folder, the decision apart from the app, with whether two paths
/// are one entry handed in so a test can answer it on a filesystem that tells case
/// apart.
///
/// The same name is nothing to do. Another spelling of it - `work` to `Work` - is a
/// rename on a Mac and on Windows, whose filesystems call both the same folder and so
/// say the target already exists; it goes the way a note's respelling does, through a
/// name of its own (see `respell` in notes.rs). Finder, Explorer and Obsidian's vault
/// rename all take one. Anything else already there is another space.
fn rename_folder(
    source: &Path,
    target: &Path,
    same: impl Fn(&Path, &Path) -> bool,
) -> Result<(), String> {
    if source == target {
        return Ok(());
    }

    let respelling = respelled(source, target, same);
    if !respelling && target.exists() {
        return Err("a space with that name already exists".into());
    }

    move_entry(source, target, respelling)
}

/// Deletes a space and every note in it. Only a folder directly inside the
/// spaces folder is a space, so a mistyped path cannot take a different
/// directory with it.
#[tauri::command(async)]
pub fn delete_space(app: AppHandle, path: String) -> Result<(), String> {
    let target = a_space(&app, &path)?;
    if !target.is_dir() {
        return Err(format!("{path} is not a space"));
    }

    fs::remove_dir_all(&target).map_err(|error| cannot("delete", &target, &error))
}

/// A space as the window wants it, named after the folder it actually is.
fn space_at(path: &Path) -> Space {
    Space {
        name: path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
    }
}

/// Turns what someone typed into a folder name every platform accepts, or None
/// when nothing usable is left.
fn folder_name(input: &str) -> Option<String> {
    let cleaned: String = input
        .chars()
        // `<>:"/\|?*` are illegal on Windows; control characters everywhere.
        .map(|letter| {
            if letter.is_control() || r#"<>:"/\|?*"#.contains(letter) {
                ' '
            } else {
                letter
            }
        })
        .collect();

    // Collapse the runs the replacement above can leave behind.
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    // A trailing dot or space is dropped silently by Windows, so a name that
    // ends in one would not be the name that was asked for.
    let trimmed = collapsed.trim_matches(|letter: char| letter == '.' || letter.is_whitespace());
    if trimmed.is_empty() {
        return None;
    }

    let capped: String = trimmed.chars().take(MAX_NAME).collect();
    let capped = capped
        .trim_matches(|letter: char| letter == '.' || letter.is_whitespace())
        .to_string();
    if capped.is_empty() {
        return None;
    }

    // A reserved name is fine with something appended, which is less surprising
    // than refusing it.
    if is_reserved(&capped) {
        return Some(format!("{capped} space"));
    }

    Some(capped)
}

#[cfg(test)]
mod tests {
    use super::{folder_name, rename_folder, MAX_NAME};
    use std::fs;

    /// `work` to `Work`, on a disk that calls both the same folder: the space takes
    /// the new spelling with everything in it, rather than the rename being refused
    /// as a clash with itself.
    #[test]
    fn respells_a_space_in_another_case() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the space");
        fs::write(from.join("plan.md"), "plan").expect("a note in it");

        rename_folder(&from, &to, |_, _| true).expect("the respelling");

        let names: Vec<_> = fs::read_dir(dir.path())
            .expect("the spaces folder")
            .map(|one| one.expect("an entry").file_name())
            .collect();
        assert_eq!(names, vec!["Work"]);
        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    #[test]
    fn refuses_a_name_another_space_has() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("home"));
        fs::create_dir(&from).expect("one space");
        fs::create_dir(&to).expect("another");

        assert!(rename_folder(&from, &to, |_, _| false).is_err());
        assert!(from.is_dir());
    }

    #[test]
    fn the_same_name_is_nothing_to_do() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let from = dir.path().join("work");
        fs::create_dir(&from).expect("the space");

        rename_folder(&from, &from, |_, _| true).expect("no change");
        assert!(from.is_dir());
    }

    #[test]
    fn keeps_an_ordinary_name() {
        assert_eq!(folder_name("Journal"), Some("Journal".into()));
        assert_eq!(
            folder_name("Work notes 2026"),
            Some("Work notes 2026".into())
        );
    }

    #[test]
    fn strips_characters_windows_refuses() {
        assert_eq!(folder_name("a/b\\c:d"), Some("a b c d".into()));
        assert_eq!(folder_name("what? yes!"), Some("what yes!".into()));
        assert_eq!(folder_name("a<b>c|d*e\"f"), Some("a b c d e f".into()));
    }

    #[test]
    fn drops_control_characters() {
        assert_eq!(folder_name("a\nb\tc"), Some("a b c".into()));
        assert_eq!(folder_name("a\u{0}b"), Some("a b".into()));
    }

    #[test]
    fn refuses_a_trailing_dot_or_space() {
        assert_eq!(folder_name("Notes."), Some("Notes".into()));
        assert_eq!(folder_name("  Notes  "), Some("Notes".into()));
        assert_eq!(folder_name("Notes..."), Some("Notes".into()));
    }

    #[test]
    fn refuses_a_name_with_nothing_left() {
        assert_eq!(folder_name(""), None);
        assert_eq!(folder_name("   "), None);
        assert_eq!(folder_name("///"), None);
        assert_eq!(folder_name("..."), None);
    }

    #[test]
    fn a_name_cannot_climb_out_of_the_spaces_folder() {
        assert_eq!(folder_name(".."), None);
        assert_eq!(folder_name("../../elsewhere"), Some("elsewhere".into()));
        assert_eq!(folder_name(r"..\elsewhere"), Some("elsewhere".into()));
    }

    #[test]
    fn works_around_the_reserved_names() {
        assert_eq!(folder_name("CON"), Some("CON space".into()));
        assert_eq!(folder_name("nul"), Some("nul space".into()));
        assert_eq!(folder_name("COM1"), Some("COM1 space".into()));
        // Only the exact names are reserved.
        assert_eq!(folder_name("Console"), Some("Console".into()));
    }

    #[test]
    fn caps_the_length() {
        let long = "x".repeat(200);
        assert_eq!(
            folder_name(&long).map(|name| name.chars().count()),
            Some(MAX_NAME)
        );
    }

    #[test]
    fn keeps_letters_other_languages_use() {
        assert_eq!(
            folder_name("Notizen über Bücher"),
            Some("Notizen über Bücher".into())
        );
        assert_eq!(folder_name("日本語"), Some("日本語".into()));
    }
}
