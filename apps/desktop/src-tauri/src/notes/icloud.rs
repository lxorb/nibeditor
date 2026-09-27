//! Notes iCloud has taken off this Mac to save space.
//!
//! With "Desktop & Documents Folders" turned on in iCloud Drive, the default spaces
//! folder, `Documents/Nib`, is in iCloud, and "Optimise Mac Storage" may evict a
//! note nobody opened in a while. What is left on disk is a placeholder beside it:
//! `Plan.md` becomes `.Plan.md.icloud`, a small property list with the real name
//! inside. The file list leaves out anything that starts with a dot, so the note
//! simply vanished from the space.
//!
//! Obsidian lists such a note and fetches it when it is opened, and so does this:
//! the tree shows the placeholder under the name it stands for, marked as not on
//! this Mac, and reading it asks iCloud for it and waits until it has arrived. The
//! window is told while that happens, so the row can say so; see icloud.svelte.ts.
//!
//! What is not done yet: a search, the links and the tags read only what is on the
//! disk, so an evicted note is not in them until it has been opened once; and a
//! rename, a move or a delete of one acts on a file that is not there and fails.

use std::path::{Path, PathBuf};

/// What a placeholder's name ends with.
const SUFFIX: &str = ".icloud";

/// The name an iCloud placeholder stands for: `.Plan.md.icloud` is `Plan.md`.
/// Nothing for any other name.
pub fn evicted_name(name: &str) -> Option<&str> {
    name.strip_prefix('.')?
        .strip_suffix(SUFFIX)
        .filter(|real| !real.is_empty())
}

/// Where the placeholder for a file would be, if iCloud had taken the file away.
pub fn placeholder_of(target: &Path) -> Option<PathBuf> {
    let name = target.file_name()?.to_str()?;
    Some(target.with_file_name(format!(".{name}{SUFFIX}")))
}

/// Makes sure a file is on this Mac before it is read: where only its placeholder
/// is, iCloud is asked for it and this waits until it has arrived.
///
/// A file that is there, and one that is not there at all, return at once: the
/// read that follows says what it always said about both.
#[cfg(target_os = "macos")]
pub fn fetched(app: &tauri::AppHandle, target: &Path) -> Result<(), String> {
    use std::time::{Duration, Instant};
    use tauri::Emitter as _;

    /// How long a note may take to arrive. A note is a few kilobytes and arrives in
    /// a second; a PDF on a slow connection is the case this is sized for.
    const PATIENCE: Duration = Duration::from_secs(120);

    if target.exists() {
        return Ok(());
    }
    let Some(placeholder) = placeholder_of(target) else {
        return Ok(());
    };
    if !placeholder.exists() {
        return Ok(());
    }

    let shown = target.to_string_lossy().to_string();
    let _ = app.emit(
        EVENT,
        Fetching {
            path: &shown,
            done: false,
        },
    );
    download(target)?;

    let deadline = Instant::now() + PATIENCE;
    while !target.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }

    let _ = app.emit(
        EVENT,
        Fetching {
            path: &shown,
            done: true,
        },
    );
    if target.exists() {
        Ok(())
    } else {
        Err(format!("{shown} is still downloading from iCloud"))
    }
}

/// What the window hears while a file is on its way.
#[cfg(target_os = "macos")]
const EVENT: &str = "nib://icloud";

#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct Fetching<'a> {
    path: &'a str,
    done: bool,
}

/// Asks iCloud to bring a file back, the way Finder does when one is double-clicked:
/// `NSFileManager`'s own call, which `brctl download` is a wrapper around.
#[cfg(target_os = "macos")]
fn download(target: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let url = NSURL::fileURLWithPath(&NSString::from_str(&target.to_string_lossy()));
    NSFileManager::defaultManager()
        .startDownloadingUbiquitousItemAtURL_error(&url)
        .map_err(|error| {
            format!(
                "iCloud would not download {}: {}",
                target.display(),
                error.localizedDescription()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{evicted_name, placeholder_of};
    use std::path::{Path, PathBuf};

    #[test]
    fn a_placeholder_stands_for_the_name_inside_it() {
        assert_eq!(evicted_name(".Plan.md.icloud"), Some("Plan.md"));
        assert_eq!(
            evicted_name(".Über sicht.pdf.icloud"),
            Some("Über sicht.pdf")
        );
        // A hidden note that was evicted is still a hidden note.
        assert_eq!(evicted_name("..hidden.md.icloud"), Some(".hidden.md"));
    }

    #[test]
    fn nothing_else_is_one() {
        assert_eq!(evicted_name("Plan.md"), None);
        assert_eq!(evicted_name(".DS_Store"), None);
        assert_eq!(evicted_name("Plan.md.icloud"), None);
        assert_eq!(evicted_name(".icloud"), None);
    }

    #[test]
    fn a_file_knows_where_its_placeholder_would_be() {
        assert_eq!(
            placeholder_of(Path::new("/s/ideas/Plan.md")),
            Some(PathBuf::from("/s/ideas/.Plan.md.icloud"))
        );
    }
}
