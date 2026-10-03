//! An extension's zip, written out into its folder - and nothing outside it.
//!
//! The zip inside a CRX file is a plain one: stored or deflated entries, no encryption,
//! no zip64. That is the whole of what is read, with flate2, which the crate already has;
//! the zip crate in the lock file is the updater's and built without deflate.
//!
//! Every name is judged before a byte is written, because the archive is somebody
//! else's: no absolute path, no drive, no `..`, no backslash, nothing a file system
//! would read as something else. And every size is held to: what an entry says it
//! unpacks to is what it may unpack to, and the whole is capped, so a small file that
//! inflates to fill the disk stops at the cap.
//!
//! `_metadata` is left out. It is the store's own record of the files' hashes, which a
//! browser reads for an extension it installed itself, and an unpacked extension with a
//! folder whose name starts with `_` other than `_locales` is refused by Chromium.

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

/// The most an extension may unpack to, all its files together.
const MOST_BYTES: u64 = 512 * 1024 * 1024;

/// The most files an extension may have.
const MOST_FILES: usize = 50_000;

/// The folder Chromium keeps for itself, never written.
const SKIPPED: &str = "_metadata";

/// One entry of the central directory.
struct Entry<'a> {
    name: &'a str,
    method: u16,
    crc: u32,
    packed: u64,
    size: u64,
    at: usize,
}

/// Writes `zip` into `into`, which must not exist yet and is made here.
pub fn unzip(zip: &[u8], into: &Path) -> Result<(), String> {
    let entries = entries(zip)?;
    if entries.len() > MOST_FILES {
        return Err("that extension has too many files".into());
    }

    fs::create_dir_all(into).map_err(|error| error.to_string())?;
    let mut total = 0u64;
    for entry in &entries {
        let Some(path) = place(entry.name)? else {
            continue;
        };
        let target = into.join(&path);
        if entry.name.ends_with('/') {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }

        total = total.saturating_add(entry.size);
        if total > MOST_BYTES {
            return Err("that extension is too large".into());
        }
        let bytes = contents(zip, entry)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target, bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Where an entry goes inside the folder, `None` for one that is left out, or an error
/// for a name that reaches anywhere else.
fn place(name: &str) -> Result<Option<PathBuf>, String> {
    let refused = || {
        Err(format!(
            "that extension has a file nib will not write: {name}"
        ))
    };
    if name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(char::is_control)
    {
        return refused();
    }

    let parts: Vec<&str> = name.trim_end_matches('/').split('/').collect();
    if parts.iter().any(|part| {
        part.is_empty()
            || *part == "."
            || *part == ".."
            || part.ends_with('.')
            || part.ends_with(' ')
    }) {
        return refused();
    }
    if parts.first() == Some(&SKIPPED) {
        return Ok(None);
    }
    Ok(Some(parts.iter().collect()))
}

/// What one entry unpacks to, checked against its own size and CRC.
fn contents(zip: &[u8], entry: &Entry<'_>) -> Result<Vec<u8>, String> {
    let broken = || format!("that extension's archive is broken at {}", entry.name);
    let header = zip.get(entry.at..entry.at + 30).ok_or_else(broken)?;
    if u32_at(header, 0) != 0x0403_4b50 {
        return Err(broken());
    }
    let start = entry.at + 30 + usize::from(u16_at(header, 26)) + usize::from(u16_at(header, 28));
    let packed = usize::try_from(entry.packed).map_err(|_| broken())?;
    let data = zip.get(start..start + packed).ok_or_else(broken)?;

    let size = usize::try_from(entry.size).map_err(|_| broken())?;
    let mut out = Vec::with_capacity(size.min(1 << 24));
    match entry.method {
        0 => out.extend_from_slice(data),
        8 => {
            flate2::read::DeflateDecoder::new(data)
                .take(entry.size + 1)
                .read_to_end(&mut out)
                .map_err(|_| broken())?;
        }
        _ => {
            return Err(format!(
                "that extension's archive packs {} a way nib cannot read",
                entry.name
            ))
        }
    }
    if out.len() != size {
        return Err(broken());
    }
    let mut crc = flate2::Crc::new();
    crc.update(&out);
    if crc.sum() != entry.crc {
        return Err(broken());
    }
    Ok(out)
}

/// The central directory's entries, in order.
fn entries(zip: &[u8]) -> Result<Vec<Entry<'_>>, String> {
    let broken = || "that extension's archive is broken".to_string();
    // The end record is the last 22 bytes and a comment of up to 64 kB.
    let from = zip.len().saturating_sub(22 + usize::from(u16::MAX));
    let end = (from..zip.len().saturating_sub(21))
        .rev()
        .find(|at| u32_at(zip, *at) == 0x0605_4b50)
        .ok_or_else(broken)?;
    let count = usize::from(u16_at(zip, end + 10));
    let mut at = u32_at(zip, end + 16) as usize;
    if u32_at(zip, end + 16) == u32::MAX {
        return Err("that extension's archive is a zip64, which nib does not read".into());
    }

    let mut entries = Vec::with_capacity(count.min(MOST_FILES + 1));
    for _ in 0..count {
        let fixed = zip.get(at..at + 46).ok_or_else(broken)?;
        if u32_at(fixed, 0) != 0x0201_4b50 {
            return Err(broken());
        }
        if u16_at(fixed, 8) & 1 != 0 {
            return Err("that extension's archive is encrypted".into());
        }
        let named = usize::from(u16_at(fixed, 28));
        let extra = usize::from(u16_at(fixed, 30));
        let comment = usize::from(u16_at(fixed, 32));
        let name = zip.get(at + 46..at + 46 + named).ok_or_else(broken)?;
        let name = std::str::from_utf8(name).map_err(|_| broken())?;
        entries.push(Entry {
            name,
            method: u16_at(fixed, 10),
            crc: u32_at(fixed, 16),
            packed: u64::from(u32_at(fixed, 20)),
            size: u64::from(u32_at(fixed, 24)),
            at: u32_at(fixed, 42) as usize,
        });
        at += 46 + named + extra + comment;
    }
    Ok(entries)
}

/// A little-endian `u16` at `at`, or nought past the end.
fn u16_at(bytes: &[u8], at: usize) -> u16 {
    bytes
        .get(at..at + 2)
        .map_or(0, |two| u16::from_le_bytes([two[0], two[1]]))
}

/// A little-endian `u32` at `at`, or nought past the end.
fn u32_at(bytes: &[u8], at: usize) -> u32 {
    bytes.get(at..at + 4).map_or(0, |four| {
        u32::from_le_bytes([four[0], four[1], four[2], four[3]])
    })
}

#[cfg(test)]
pub(super) mod tests {
    use std::io::Write as _;

    use super::{place, unzip};

    /// A zip of `files`, each deflated, as a test writes one.
    pub fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, bytes) in files {
            let mut packer =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            packer.write_all(bytes).expect("packed");
            let deflated = packer.finish().expect("packed");
            let mut crc = flate2::Crc::new();
            crc.update(bytes);
            let at = u32::try_from(out.len()).expect("small");
            let named = u16::try_from(name.len()).expect("short");
            let packed_len = u32::try_from(deflated.len()).expect("small");
            let size = u32::try_from(bytes.len()).expect("small");

            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&[20, 0, 0, 0, 8, 0, 0, 0, 0, 0]);
            out.extend_from_slice(&crc.sum().to_le_bytes());
            out.extend_from_slice(&packed_len.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&named.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&deflated);

            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&[20, 0, 20, 0, 0, 0, 8, 0, 0, 0, 0, 0]);
            central.extend_from_slice(&crc.sum().to_le_bytes());
            central.extend_from_slice(&packed_len.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&named.to_le_bytes());
            central.extend_from_slice(&[0; 12]);
            central.extend_from_slice(&at.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let start = u32::try_from(out.len()).expect("small");
        let count = u16::try_from(files.len()).expect("few");
        let length = u32::try_from(central.len()).expect("small");
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nib-unzip-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn files_and_folders_are_written_and_the_store_s_record_is_not() {
        let dir = scratch("good");
        let bytes = zip(&[
            ("manifest.json", b"{\"name\":\"x\"}"),
            ("js/a.js", b"let a = 1"),
            ("_metadata/verified_contents.json", b"[]"),
        ]);
        unzip(&bytes, &dir).expect("written");
        assert_eq!(
            std::fs::read_to_string(dir.join("js").join("a.js")).expect("there"),
            "let a = 1"
        );
        assert!(!dir.join("_metadata").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_that_climbs_out_is_refused() {
        for bad in [
            "../evil.js",
            "a/../../evil.js",
            "/etc/passwd",
            "C:/x.js",
            "a\\b.js",
            "a//b.js",
            "con.",
            "",
        ] {
            assert!(place(bad).is_err(), "{bad}");
        }
        assert!(place("_locales/en/messages.json").expect("fine").is_some());
    }

    #[test]
    fn a_broken_archive_is_refused_before_anything_is_written() {
        let dir = scratch("bad");
        assert!(unzip(b"not a zip", &dir).is_err());
        let mut bytes = zip(&[("a.js", b"let a = 1")]);
        // A byte of the packed data changed: the CRC no longer matches.
        bytes[40] ^= 0xff;
        assert!(unzip(&bytes, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
