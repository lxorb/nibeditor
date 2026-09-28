//! Notes iCloud has taken off this Mac to save space.
//!
//! With "Desktop & Documents Folders" turned on in iCloud Drive, the default spaces
//! folder, `Documents/Nib`, is in iCloud, and "Optimise Mac Storage" may evict a
//! note nobody opened in a while. What that leaves on disk depends on the system:
//!
//! - **macOS 13** leaves a placeholder beside it: `Plan.md` becomes
//!   `.Plan.md.icloud`, a small property list with the real name inside. The file
//!   list leaves out anything that starts with a dot, so the note simply vanished
//!   from the space.
//! - **macOS 14 and later**, where iCloud Drive is a File Provider, keep the note
//!   under its own name as a *dataless* file: its size and dates are real, its bytes
//!   are in the cloud, and `SF_DATALESS` is set in its flags. Reading it makes the
//!   kernel fetch it first. Dropbox, Google Drive and `OneDrive` leave the same kind
//!   of file, so a dataless file is not always iCloud's.
//!
//! Obsidian lists such a note and fetches it when it is opened, and so does this:
//! the tree shows it under its name, marked as not on this Mac, and reading it asks
//! iCloud for it and waits until it has arrived. The window is told while that
//! happens, so the row can say so; see icloud.svelte.ts.
//!
//! What is not done yet: a search, the links and the tags read only what is on the
//! disk. A placeholder is not in them until the note has been opened once; a
//! dataless note is fetched by the kernel as they read it, which brings it back to
//! this Mac. And on macOS 13 a rename, a move or a delete of one acts on a file that
//! is not there and fails.

use std::path::{Path, PathBuf};

/// What a placeholder's name ends with.
const SUFFIX: &str = ".icloud";

/// `SF_DATALESS` in `sys/stat.h`: the file's bytes are with its provider.
#[cfg(any(target_os = "macos", test))]
const DATALESS: u32 = 0x4000_0000;

/// Whether a file's flags say its bytes are not on this Mac.
#[cfg(any(target_os = "macos", test))]
fn flags_are_dataless(flags: u32) -> bool {
    flags & DATALESS != 0
}

/// Whether a file is on disk by name only, its bytes with iCloud or another
/// provider. Read off the `stat` a caller already has, so a listing asks nothing
/// more of the disk for it.
#[cfg(target_os = "macos")]
pub fn is_dataless(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as _;
    flags_are_dataless(meta.st_flags())
}

/// Nowhere else has dataless files.
#[cfg(not(target_os = "macos"))]
pub fn is_dataless(_meta: &std::fs::Metadata) -> bool {
    false
}

/// Whether a file's bytes are here to be read: it exists, and is not dataless.
#[cfg(target_os = "macos")]
fn arrived(target: &Path) -> bool {
    std::fs::symlink_metadata(target).is_ok_and(|meta| !is_dataless(&meta))
}

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
/// is, or it is there by name only, iCloud is asked for it and this waits until it
/// has arrived.
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

    let dataless = std::fs::symlink_metadata(target).is_ok_and(|meta| is_dataless(&meta));
    if !dataless {
        if target.exists() {
            return Ok(());
        }
        let Some(placeholder) = placeholder_of(target) else {
            return Ok(());
        };
        if !placeholder.exists() {
            return Ok(());
        }
    }

    let shown = target.to_string_lossy().to_string();
    let say = |done: bool| {
        let _ = app.emit(EVENT, Fetching { path: &shown, done });
    };

    say(false);
    if let Err(error) = download(target) {
        say(true);
        // A dataless file iCloud does not keep - Dropbox's, Google Drive's - is not
        // one its call can fetch. The read that follows asks the kernel, which
        // fetches it from whichever provider it belongs to.
        return if dataless { Ok(()) } else { Err(error) };
    }

    let deadline = Instant::now() + PATIENCE;
    while !arrived(target) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }

    say(true);
    if arrived(target) {
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
    use super::{evicted_name, flags_are_dataless, is_dataless, placeholder_of};
    use std::path::{Path, PathBuf};

    #[test]
    fn a_file_with_its_data_elsewhere_says_so_in_its_flags() {
        assert!(flags_are_dataless(0x4000_0000));
        assert!(flags_are_dataless(0x4000_0040));
        // What a note iCloud has uploaded and kept carries: tracked, and here.
        assert!(!flags_are_dataless(0x40));
        assert!(!flags_are_dataless(0));
    }

    #[test]
    fn a_file_on_this_disk_is_not_dataless() {
        let file = tempfile_path();
        std::fs::write(&file, "# Here").unwrap();
        let meta = std::fs::symlink_metadata(&file).unwrap();
        assert!(!is_dataless(&meta));
        std::fs::remove_file(&file).unwrap();
    }

    fn tempfile_path() -> PathBuf {
        std::env::temp_dir().join(format!("nib-dataless-{}.md", std::process::id()))
    }

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
