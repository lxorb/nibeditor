//! The extensions on this computer: one folder each, and a list of which, at which
//! version, on or off.
//!
//! ```text
//! <config>/extensions/library.json            what is installed, on or off, pinned or not
//! <config>/extensions/applied.json            which version each engine store was given
//! <config>/extensions/<id>/<version>/         the unpacked extension, never written again
//! ```
//!
//! **A version's folder is never changed once it is written.** `WebView2` installs an
//! unpacked extension where it lies, without copying it, and removes it from the profile
//! the moment its files change; Chromium reads an unpacked one in place too. So an update
//! is a new folder beside the old one, the engines are pointed at it, and the old one goes
//! after. A folder is written under a name starting with `.` and renamed into place whole,
//! so an install cut short leaves nothing an engine could be pointed at.
//!
//! One list for every store, global, per space and per site: an extension somebody
//! installed is installed, and "install it again over there" is not a sentence this app
//! makes anybody read (docs/browser.md, section 3).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
#[cfg(not(feature = "cef"))]
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::link::Store;
#[cfg(not(feature = "cef"))]
use super::{crx, manifest, unzip};

/// The list's file.
const LIST: &str = "library.json";

/// Which version each engine store has, kept per store.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
const APPLIED: &str = "applied.json";

/// One installed extension, as the list keeps it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    pub id: String,
    pub store: Store,
    pub version: String,
    pub enabled: bool,
    /// Whether its button sits in the web bar, rather than only in the list behind the
    /// extensions glyph. Chrome's pin, on from the start: somebody who installed an
    /// extension with a button wants to press it.
    pub pinned: bool,
}

/// The folder the extensions live in.
#[cfg(not(feature = "cef"))]
pub fn folder_of(root: &Path, id: &str, version: &str) -> PathBuf {
    root.join(id).join(version)
}

/// What is installed, as written down; nothing for a computer that never installed one.
pub fn read(root: &Path) -> Vec<Kept> {
    fs::read_to_string(root.join(LIST))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Kept>>(&text).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|kept| super::link::is_id(&kept.id) && plain_version(&kept.version))
        .collect()
}

/// Writes the list down, whole, through a file beside it.
pub fn write(root: &Path, list: &[Kept]) -> Result<(), String> {
    written(
        &root.join(LIST),
        &serde_json::to_string_pretty(list).map_err(|e| e.to_string())?,
    )
}

/// Which version of each extension each engine store was last given: store, then id.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub type Applied = BTreeMap<String, BTreeMap<String, String>>;

/// The versions each store was given, as written down.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub fn applied(root: &Path) -> Applied {
    fs::read_to_string(root.join(APPLIED))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes down the versions each store was given.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub fn write_applied(root: &Path, applied: &Applied) -> Result<(), String> {
    written(
        &root.join(APPLIED),
        &serde_json::to_string_pretty(applied).map_err(|e| e.to_string())?,
    )
}

/// A file written beside itself and moved into place, so a crash never leaves half.
fn written(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let beside = path.with_extension("json.new");
    fs::write(&beside, text).map_err(|error| error.to_string())?;
    fs::rename(&beside, path).map_err(|error| error.to_string())
}

/// Whether a version is one a folder may be named: up to four numbers and dots, which
/// is every version Chromium accepts.
pub fn plain_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version.split('.').count() <= 4
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

/// Checks a store's file for extension `id` and unpacks it into its version's folder,
/// answering the version. A version already there is kept as it is.
#[cfg(not(feature = "cef"))]
pub fn unpack(root: &Path, store: Store, id: &str, bytes: &[u8]) -> Result<String, String> {
    let checked = crx::checked(bytes, id, Some(store))?;
    unpack_checked(root, &checked)
}

/// The second half of `unpack`, for a file already checked.
#[cfg(not(feature = "cef"))]
pub fn unpack_checked(root: &Path, checked: &crx::Checked<'_>) -> Result<String, String> {
    // A name of its own per install, so two at once never write into one folder.
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let home = root.join(&checked.id);
    fs::create_dir_all(&home).map_err(|error| error.to_string())?;
    let making = home.join(format!(
        ".unpacking-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&making);

    let made = (|| {
        unzip::unzip(checked.zip, &making)?;
        manifest::keyed(&making, &checked.key)?;
        let about = manifest::read(&making)?;
        if !plain_version(&about.version) {
            return Err("that extension's version is not one".to_string());
        }
        Ok(about.version)
    })();

    let version = match made {
        Ok(version) => version,
        Err(why) => {
            let _ = fs::remove_dir_all(&making);
            return Err(why);
        }
    };
    let target = home.join(&version);
    if target.join("manifest.json").is_file() {
        let _ = fs::remove_dir_all(&making);
    } else {
        let _ = fs::remove_dir_all(&target);
        fs::rename(&making, &target).map_err(|error| error.to_string())?;
    }
    Ok(version)
}

/// Every version folder of `id` but `keep`, and anything an install cut short left.
#[cfg(not(feature = "cef"))]
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "the tidy that calls it is WebView2's alone")
)]
pub fn prune(root: &Path, id: &str, keep: &str) {
    let Ok(entries) = fs::read_dir(root.join(id)) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() != keep {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// An extension's folders, all of them.
#[cfg(not(feature = "cef"))]
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "the tidy that calls it is WebView2's alone")
)]
pub fn forget(root: &Path, id: &str) {
    if super::link::is_id(id) {
        let _ = fs::remove_dir_all(root.join(id));
    }
}

#[cfg(all(test, not(feature = "cef")))]
mod tests {
    use super::super::crx::tests::crx;
    use super::super::unzip::tests::zip;
    use super::{folder_of, plain_version, prune, read, unpack_checked, write, Kept, Store};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nib-library-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn an_extension_unpacks_into_its_version_with_its_key_in_the_manifest() {
        let root = scratch("unpack");
        let archive = zip(&[
            (
                "manifest.json",
                br#"{"name":"Test","version":"1.2.3","manifest_version":3}"#,
            ),
            ("popup.html", b"<p>hi</p>"),
        ]);
        let (bytes, id) = crx(&archive);
        let checked = super::crx::checked(&bytes, &id, None).expect("checked");

        let version = unpack_checked(&root, &checked).expect("unpacked");
        assert_eq!(version, "1.2.3");
        let folder = folder_of(&root, &id, &version);
        let manifest = std::fs::read_to_string(folder.join("manifest.json")).expect("there");
        assert!(manifest.contains("\"key\""), "{manifest}");
        assert!(folder.join("popup.html").is_file());

        // A second install of the same version keeps the folder as it is.
        assert_eq!(unpack_checked(&root, &checked).expect("again"), "1.2.3");
        prune(&root, &id, "1.2.3");
        assert!(folder.is_dir());
        let leftovers = std::fs::read_dir(root.join(&id)).expect("there").count();
        assert_eq!(leftovers, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_version_that_is_not_a_folder_name_is_refused() {
        let root = scratch("bad-version");
        let archive = zip(&[("manifest.json", br#"{"name":"x","version":"../1"}"#)]);
        let (bytes, id) = crx(&archive);
        let checked = super::crx::checked(&bytes, &id, None).expect("checked");
        assert!(unpack_checked(&root, &checked).is_err());
        assert!(!root.join(&id).join("..").join("1").exists());
        for (version, fine) in [
            ("1", true),
            ("2025.1.30.4", true),
            ("1.2.3.4.5", false),
            ("1..2", false),
            ("1a", false),
            ("", false),
        ] {
            assert_eq!(plain_version(version), fine, "{version}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_list_survives_being_written_and_drops_what_is_not_an_extension() {
        let root = scratch("list");
        let one = Kept {
            id: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
            store: Store::Chrome,
            version: "1.0".into(),
            enabled: true,
            pinned: true,
        };
        let mut bad = one.clone();
        bad.id = "../../x".into();
        write(&root, &[one.clone(), bad]).expect("written");
        assert_eq!(read(&root), vec![one]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
