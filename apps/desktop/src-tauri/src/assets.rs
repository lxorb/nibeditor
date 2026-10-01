//! The files a note points at. This module owns copying a picture in beside the
//! note, handing one back as a `data:` URI for an export that has to carry its
//! own pictures, and handing a whole file back as bytes for the window to read
//! itself. Everything here stays inside the folder the note is in.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{
    at_most, cannot, folded, free_spot, in_spaces, inside, made, space_root, spaces_dir,
};

/// Bigger than any picture belongs in a document, and small enough that turning
/// it into text cannot exhaust the memory of the window asking.
const LIMIT: u64 = LIMIT_MB * 1024 * 1024;

/// The same ceiling in megabytes, because a picture that is refused says the
/// number, and a sentence carrying a second copy of it is one that goes stale.
const LIMIT_MB: u64 = 12;

/// How long a picture's file name may be, so the whole path stays inside the
/// limits Windows puts on one.
const MAX_NAME: usize = 120;

/// How large a file the window may read whole. Bigger than any PDF anyone keeps
/// notes on - a scanned book of a thousand pages is well under this - and small
/// enough that one read cannot exhaust the memory of the window asking.
const FILE_LIMIT: u64 = 192 * 1024 * 1024;

/// A file beside a note as its bytes, for the window to read itself: the PDF a
/// tab is showing, which is far too large to spell out as text.
///
/// The bytes go over the IPC as bytes rather than as JSON, which is what makes a
/// thirty megabyte PDF a copy rather than a hundred megabytes of numbers.
#[tauri::command(async)]
pub fn read_file(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let target = in_spaces(&app, &path)?;
    // A PDF iCloud took off this Mac is brought back before it is read.
    #[cfg(target_os = "macos")]
    crate::notes::icloud::fetched(&app, &target)?;
    let Some(bytes) = at_most(&target, FILE_LIMIT)? else {
        return Err(format!("{path} is too large to open"));
    };

    Ok(tauri::ipc::Response::new(bytes))
}

/// A picture as a `data:` URI, so an exported page carries its own pictures.
/// Refuses anything large enough to bloat the file past usefulness.
#[tauri::command(async)]
pub fn read_asset(app: AppHandle, path: String) -> Result<String, String> {
    let target = in_spaces(&app, &path)?;
    let Some(bytes) = at_most(&target, LIMIT)? else {
        return Err(format!("{path} is larger than {LIMIT_MB} MB"));
    };

    Ok(format!(
        "data:{};base64,{}",
        mime_of(&target),
        encode(&bytes)
    ))
}

/// Copies a pasted or dropped picture into the folder the window asked for and
/// returns the relative path to write into the markdown, so the note stays
/// portable.
///
/// `folder` is relative to the note's own folder, empty for the folder itself.
/// The window decides which of them it is - the space's assets folder, beside the
/// note, a folder named after it - and this decides whether the result is still
/// somewhere a note of this space may write.
#[tauri::command(async)]
pub fn save_asset(
    app: AppHandle,
    note_path: String,
    folder: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let note = in_spaces(&app, &note_path)?;
    let note_folder = note
        .parent()
        .ok_or_else(|| format!("{note_path} has no folder"))?;

    // How far a picture may be put from the note: anywhere in its space.
    let limit = space_root(&spaces_dir(&app)?, note_folder)
        .ok_or_else(|| format!("{note_path} is not in a space"))?;

    let relative = trimmed(&folder);
    let dir = asset_dir(note_folder, relative, &limit)?;
    made(&dir)?;

    let safe = safe_name(&name).ok_or("that picture has no name that can be written")?;
    let mut target = dir.join(&safe);

    match fs::read(&target) {
        // The caller names the file after a hash of its contents, so a name that
        // is already taken usually holds this very picture. Pasting the same one
        // twice should cost nothing.
        Ok(held) if held == bytes => {}
        // The same name over a different picture would take the first one away,
        // so both are kept.
        Ok(_) => {
            target = free_spot(&target, true);
            fs::write(&target, &bytes).map_err(|error| cannot("write", &target, &error))?;
        }
        Err(_) => fs::write(&target, &bytes).map_err(|error| cannot("write", &target, &error))?,
    }

    let file = target
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("could not name the picture")?;

    // What goes into the note: forward slashes and the folder the window asked
    // for, so the link reads the same on every platform and resolves from the
    // note's own folder.
    Ok(if relative.is_empty() {
        file.to_string()
    } else {
        format!("{relative}/{file}")
    })
}

/// The folder as the markdown will spell it: no leading or trailing slashes, and
/// slashes rather than whatever the window sent.
fn trimmed(folder: &str) -> &str {
    folder.trim_matches('/')
}

/// Where a picture from a note in `note_folder` goes, given the folder relative
/// to it that the window asked for.
///
/// Refused when the folder is not relative, when it names a hidden folder, or
/// when joining it on lands outside `limit`: `../assets` reaches the space's own
/// folder from a note one level down, and `../../..` reaches another space, which
/// is not this note's to write in. Nothing is read from disk, so this is a
/// decision about paths alone.
fn asset_dir(note_folder: &Path, folder: &str, limit: &Path) -> Result<PathBuf, String> {
    let asked = Path::new(folder);

    // An absolute path handed to `join` replaces what it is joined to, so it
    // would leave the note's folder behind entirely.
    let from_the_root = asked
        .components()
        .any(|part| matches!(part, Component::Prefix(_) | Component::RootDir));
    if from_the_root {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    // A dot in front is the app's own business - the trash is `.trash` inside the
    // spaces folder, which a note directly in that folder would otherwise reach -
    // and a picture there would be invisible anyway: the tree, the search and the
    // link scan all skip a hidden folder. `..` is not one of these; it is a
    // component of its own and the check below is what judges it.
    let hidden = asked.components().any(|part| match part {
        Component::Normal(name) => name.to_string_lossy().starts_with('.'),
        _ => false,
    });
    if hidden {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    let target = folded(&note_folder.join(asked));
    if !inside(limit, &target) {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    Ok(target)
}

/// The name a picture may be written under: what the caller asked for, with
/// anything that could name another folder replaced by a dash. A name that is
/// nothing but dots is refused, because `.` and `..` are folders and not files.
fn safe_name(name: &str) -> Option<String> {
    let safe: String = name
        .chars()
        .take(MAX_NAME)
        .map(|letter| {
            if letter.is_alphanumeric() || letter == '.' || letter == '-' || letter == '_' {
                letter
            } else {
                '-'
            }
        })
        .collect();

    if safe.is_empty() || safe.chars().all(|letter| letter == '.') {
        return None;
    }

    Some(safe)
}

/// What kind of file this is, going by the extension, which is all a `data:` URI
/// needs to be told.
///
/// Sound and film are here because a note embeds those the way it embeds a
/// picture, and a player handed `application/octet-stream` refuses to play. The
/// bytes still go the same way; only the label changes.
fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        // A container either can be in is labelled with what it usually holds;
        // see the two lists in the markdown package's links.ts.
        "ogg" | "oga" | "opus" => "audio/ogg",
        "weba" => "audio/webm",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Base64, the same way the byte writer reads it: one encoding for the crate, so
/// a picture handed to the window and a picture handed back cannot disagree about
/// what base64 is. The tests below are the RFC's own vectors.
fn encode(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::{asset_dir, encode, mime_of, safe_name, trimmed, MAX_NAME};
    use std::path::{Path, PathBuf};

    /// Written the way the platform writes them, so the assertions read the same
    /// on a runner as they do on a laptop.
    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn the_space_folder_is_reached_from_a_note_in_it() {
        let space = path(&["Nib", "Notes"]);

        assert_eq!(
            asset_dir(&space, "assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
        assert_eq!(
            asset_dir(&space.join("Work"), "../assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
        assert_eq!(
            asset_dir(&space.join("Work").join("2026"), "../../assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
    }

    #[test]
    fn no_folder_at_all_is_the_note_s_own() {
        let space = path(&["Nib", "Notes"]);
        let here = space.join("Work");

        assert_eq!(asset_dir(&here, "", &space), Ok(here.clone()));
    }

    #[test]
    fn a_folder_named_after_the_note_sits_beside_it() {
        let space = path(&["Nib", "Notes"]);

        assert_eq!(
            asset_dir(&space, "Read me", &space),
            Ok(path(&["Nib", "Notes", "Read me"]))
        );
    }

    #[test]
    fn a_folder_that_climbs_out_of_the_space_is_refused() {
        let space = path(&["Nib", "Notes"]);

        assert!(asset_dir(&space, "../assets", &space).is_err());
        assert!(asset_dir(&space, "../../elsewhere", &space).is_err());
        // Another space is inside the spaces folder and still none of this
        // note's business.
        assert!(asset_dir(&space.join("Work"), "../../Other/assets", &space).is_err());
    }

    /// A note directly in the spaces folder has that folder as its limit, and the
    /// trash is a folder inside it. Nothing but the trash commands has any
    /// business there, and a picture in any hidden folder is one the tree, the
    /// search and the link scan would all skip.
    #[test]
    fn a_hidden_folder_is_refused() {
        let spaces = path(&["Documents", "Nib"]);

        assert!(asset_dir(&spaces, ".trash", &spaces).is_err());
        assert!(asset_dir(&spaces, ".trash/1700000000000-0", &spaces).is_err());
        assert!(asset_dir(&spaces, "assets/.hidden", &spaces).is_err());
        assert!(asset_dir(&spaces, ".git", &spaces).is_err());
        // A note whose own folder is hidden still keeps its own folder: what is
        // judged is the folder that was asked for, not where the note lives.
        let inside_a_dot = path(&["home", "me", ".config", "notes"]);
        assert_eq!(
            asset_dir(&inside_a_dot, "assets", &inside_a_dot),
            Ok(inside_a_dot.join("assets"))
        );
    }

    #[test]
    fn a_folder_that_is_not_relative_is_refused() {
        let space = path(&["Nib", "Notes"]);

        assert!(asset_dir(&space, "/etc", &space).is_err());
        if cfg!(windows) {
            assert!(asset_dir(&space, r"C:\Windows", &space).is_err());
        }
    }

    #[test]
    fn a_note_outside_the_spaces_folder_reaches_its_own_folder_and_no_further() {
        let here = path(&["elsewhere", "notes"]);

        assert_eq!(asset_dir(&here, "assets", &here), Ok(here.join("assets")));
        assert!(asset_dir(&here, "../assets", &here).is_err());
    }

    #[test]
    fn the_folder_is_trimmed_to_what_the_markdown_says() {
        assert_eq!(trimmed("/assets/"), "assets");
        assert_eq!(trimmed(""), "");
        assert_eq!(trimmed("../assets"), "../assets");
    }

    #[test]
    fn encodes_the_rfc_4648_vectors() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn encodes_bytes_that_are_not_text() {
        assert_eq!(encode(&[0x00, 0xff, 0x80]), "AP+A");
        assert_eq!(encode(&[0xfb, 0xff]), "+/8=");
    }

    #[test]
    fn names_the_type_from_the_extension() {
        assert_eq!(mime_of(Path::new("a/b.PNG")), "image/png");
        assert_eq!(mime_of(Path::new("a/b.jpeg")), "image/jpeg");
        assert_eq!(mime_of(Path::new("a/b.svg")), "image/svg+xml");
        assert_eq!(mime_of(Path::new("a/b.xyz")), "application/octet-stream");
        // Sound and film, so a player handed one knows what it is.
        assert_eq!(mime_of(Path::new("a/clip.MP3")), "audio/mpeg");
        assert_eq!(mime_of(Path::new("a/talk.m4a")), "audio/mp4");
        assert_eq!(mime_of(Path::new("a/demo.mp4")), "video/mp4");
        assert_eq!(mime_of(Path::new("a/demo.mov")), "video/quicktime");
        // A container either can be in is labelled with what it usually holds.
        assert_eq!(mime_of(Path::new("a/x.ogg")), "audio/ogg");
        assert_eq!(mime_of(Path::new("a/x.ogv")), "video/ogg");
        assert_eq!(mime_of(Path::new("a/x.webm")), "video/webm");
        assert_eq!(mime_of(Path::new("a/x.weba")), "audio/webm");
        assert_eq!(
            mime_of(Path::new("noextension")),
            "application/octet-stream"
        );
    }

    #[test]
    fn keeps_a_plain_picture_name() {
        assert_eq!(safe_name("a1b2c3.png"), Some("a1b2c3.png".into()));
        assert_eq!(safe_name("my-image_2.jpeg"), Some("my-image_2.jpeg".into()));
    }

    #[test]
    fn a_picture_cannot_name_another_folder() {
        assert_eq!(
            safe_name("../../secret.png"),
            Some("..-..-secret.png".into())
        );
        assert_eq!(safe_name(r"..\secret.png"), Some("..-secret.png".into()));
        assert_eq!(
            safe_name("C:/Windows/x.png"),
            Some("C--Windows-x.png".into())
        );
    }

    #[test]
    fn refuses_a_name_that_is_only_dots() {
        assert_eq!(safe_name(""), None);
        assert_eq!(safe_name("."), None);
        assert_eq!(safe_name(".."), None);
    }

    #[test]
    fn caps_how_long_a_name_can_get() {
        let long = format!("{}.png", "x".repeat(400));
        assert_eq!(
            safe_name(&long).map(|name| name.chars().count()),
            Some(MAX_NAME)
        );
    }
}
