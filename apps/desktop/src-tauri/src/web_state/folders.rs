//! Where bundles are on this computer between a capture and its upload, and between a
//! download and its restore: `web-state` in the app's own folder, one folder each.
//!
//! ```text
//! <config>/web-state/out-<random>/manifest     a capture: the manifest and its chunks
//! <config>/web-state/out-<random>/<chunk>
//! <config>/web-state/in-<random>/...           a download, for a restore to read
//! ```
//!
//! Each file is the generation of the web key it is sealed under, four bytes big-endian,
//! and then what `crypto.rs` sealed: the account keeps the generation beside every state
//! anyway, and a restore has to know which key to open it with before it can open it.
//! Everything in a file is ciphertext, so what is left here is nobody's login; a folder
//! a day old is taken away the next time one is made.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use crate::paths::{config_dir, made, write_atomically};

/// The folder inside the app's own that bundles are kept in.
const ROOT: &str = "web-state";

/// What a bundle's manifest file is called.
pub(crate) const MANIFEST: &str = "manifest";

/// How long a bundle's folder is kept before it is taken away.
const KEPT: Duration = Duration::from_secs(24 * 60 * 60);

/// Now, in milliseconds since 1970.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// The folder every bundle's folder is in, made if it is not there yet.
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}

/// A new, empty folder for one bundle, `out` for a capture and `in` for a download. The
/// folders a day old go first.
pub(crate) fn fresh(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let root = root(app)?;
    swept(&root);
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let name = random.iter().fold(format!("{kind}-"), |mut name, byte| {
        let _ = write!(name, "{byte:02x}");
        name
    });
    let dir = root.join(name);
    made(&dir)?;
    Ok(dir)
}

/// Takes away every bundle folder older than a day. Nothing in one is worth an error.
fn swept(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > KEPT);
        if old && entry.path().is_dir() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// A manifest's path the window handed over, checked: a file called `manifest` directly
/// inside one of the bundle folders, and nothing else on this disk.
pub(crate) fn manifest_at(app: &AppHandle, asked: &str) -> Result<PathBuf, String> {
    let root = root(app)?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let refused = || "that is not a web state of this app's".to_owned();
    let path = Path::new(asked).canonicalize().map_err(|_| refused())?;
    let folder = path.parent().ok_or_else(refused)?;
    let fits = path.file_name().is_some_and(|name| name == MANIFEST)
        && folder.parent() == Some(root.as_path());
    if fits {
        Ok(path)
    } else {
        Err(refused())
    }
}

/// One of the bundle folders, by the name `fresh` gave it (`in-` or `out-` and sixteen
/// hex digits), as the window hands it back to upload from or download into: a name,
/// never a path, so nothing the window says can reach outside the folder bundles are in.
pub(crate) fn folder_named(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let folder = root(app)?.join(name);
    if is_folder_name(name) && folder.is_dir() {
        Ok(folder)
    } else {
        Err("that is not a web state of this app's".to_owned())
    }
}

/// Whether a name is one `fresh` gives a folder.
fn is_folder_name(name: &str) -> bool {
    let random = name
        .strip_prefix("in-")
        .or_else(|| name.strip_prefix("out-"));
    random.is_some_and(|random| {
        random.len() == 16 && random.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

/// Writes one file of a bundle.
pub(crate) fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomically(path, bytes)
}

/// Whether a name is one a file of a bundle can have: the manifest's, or a chunk's, which
/// is hex, so it cannot climb out of the folder it is in.
pub(crate) fn is_file_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Reads one file of a bundle, by name, from its folder.
pub(crate) fn read(folder: &Path, name: &str) -> Result<Vec<u8>, String> {
    if !is_file_name(name) {
        return Err("that is not a chunk of a web state".to_owned());
    }
    fs::read(folder.join(name)).map_err(|error| format!("{name} could not be read: {error}"))
}

/// A sealed object with the generation it is sealed under in front.
pub(crate) fn framed(generation: u32, sealed: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + sealed.len());
    out.extend_from_slice(&generation.to_be_bytes());
    out.extend_from_slice(sealed);
    out
}

/// The generation and the sealed object out of a file.
pub(crate) fn unframed(bytes: &[u8]) -> Result<(u32, &[u8]), String> {
    let (generation, sealed) = bytes
        .split_first_chunk::<4>()
        .ok_or_else(|| "that web state is empty".to_owned())?;
    Ok((u32::from_be_bytes(*generation), sealed))
}

#[cfg(test)]
mod tests {
    use super::{framed, is_file_name, is_folder_name, read, unframed};

    /// The generation goes in front and comes back off, and the rest is untouched.
    #[test]
    fn a_file_carries_its_generation() {
        let file = framed(7, b"sealed");
        assert_eq!(&file[..4], &[0, 0, 0, 7]);
        assert_eq!(unframed(&file), Ok((7, &b"sealed"[..])));
        assert!(unframed(b"abc").is_err());
    }

    /// A chunk's name is hex, so nothing but a file in the folder can be read by it.
    #[test]
    fn a_chunk_name_cannot_leave_its_folder() {
        let folder = std::env::temp_dir();
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:x", "."] {
            assert!(read(&folder, bad).is_err(), "{bad} was read");
            assert!(!is_file_name(bad), "{bad} was a name");
        }
        assert!(is_file_name("manifest"));
        assert!(is_file_name("0a1b2c"));
    }

    /// A folder is named the way `fresh` names one, and nothing else is one.
    #[test]
    fn a_folder_is_one_fresh_made() {
        assert!(is_folder_name("in-0123456789abcdef"));
        assert!(is_folder_name("out-0123456789abcdef"));
        for bad in [
            "in-",
            "in-0123",
            "x-0123456789abcdef",
            "in-0123456789abcdeg",
            "..",
            "in-../../",
        ] {
            assert!(!is_folder_name(bad), "{bad} was a folder");
        }
    }
}
