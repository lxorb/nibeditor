//! The profiles Zen keeps on this machine, and the file of each that holds its
//! spaces and tabs.
//!
//! Zen is Firefox underneath, so it keeps a `profiles.ini` in its own folder - the
//! one Firefox keeps in `Mozilla/Firefox`, under the name Zen builds with, `zen` -
//! and a profile folder per profile. Arc's first run lists the browsers on the
//! machine by name; this lists Zen's profiles the same way, out of Zen's own list,
//! so nobody hunts for a folder called `x7k2.Default (release)`.
//!
//! The sidebar is in `zen-sessions.jsonlz4` in the profile, with backups beside it;
//! a profile from before that file holds the same lists in Firefox's own session,
//! `sessionstore-backups/recovery.jsonlz4`. Those few files, by those names, are all
//! this reads, and only out of a profile Zen lists: a narrow way past paths.rs, as
//! `obsidian_vaults.rs` is. Never written, and read while Zen runs: `fs::read` opens a
//! file sharing it for reading, writing and deleting, which is how Zen replaces it,
//! and the bytes are a copy the moment they are read. The unpacking is the app's;
//! see `import/mozlz4.ts`.
//!
//! Desktop only: a phone's Zen, where there is one, is somebody else's sandbox.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::{folded, folder_named};

/// One profile, the way Zen's profile manager shows it.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ZenProfile {
    pub name: String,
    pub path: String,
    /// The session files the profile holds, the one to read first in front.
    pub files: Vec<String>,
}

/// Where a drive keeps a Zen of its own, so a probe never reads the reader's: the
/// folder `profiles.ini` is in. The same rule as `NIB_SPACES_DIR`.
const ZEN_DIR: &str = "NIB_ZEN_DIR";

/// The session files, in the order they are worth reading: Zen's own, its last
/// clean copy, and Firefox's session, which carries the same lists on each window.
/// The newest of Zen's dated backups goes after its clean copy; see `files_of`.
const SESSIONS: [&str; 4] = [
    "zen-sessions.jsonlz4",
    "zen-sessions-backup/clean.jsonlz4",
    "sessionstore-backups/recovery.jsonlz4",
    "sessionstore.jsonlz4",
];

/// Where Zen keeps its dated backups, and what each is called.
const BACKUPS: &str = "zen-sessions-backup";
const BACKUP_PREFIX: &str = "zen-sessions-";
const BACKUP_SUFFIX: &str = ".jsonlz4";

/// More than any session is. A file past it is not one, and the app holds what it
/// reads whole.
const MOST_BYTES: u64 = 128 * 1024 * 1024;

/// The profiles on this machine that hold a session, the one Zen opens first in
/// front. None where Zen has never run.
#[tauri::command(async)]
pub fn zen_profiles() -> Vec<ZenProfile> {
    listed()
}

/// One session file of a profile Zen lists, as base64, which is how bytes cross the
/// bridge.
#[tauri::command(async)]
pub fn read_zen_file(profile: String, file: String) -> Result<String, String> {
    let path = known(&profile, &file, &listed())?;
    let size = fs::metadata(&path)
        .map_err(|error| format!("{file}: {error}"))?
        .len();
    if size > MOST_BYTES {
        return Err(format!("{file} is larger than any session"));
    }
    let bytes = fs::read(&path).map_err(|error| format!("{file} could not be read: {error}"))?;
    Ok(BASE64.encode(bytes))
}

fn listed() -> Vec<ZenProfile> {
    homes()
        .iter()
        .flat_map(|home| profiles_in(home))
        .fold(Vec::new(), |mut all, one| {
            if !all.iter().any(|held: &ZenProfile| held.path == one.path) {
                all.push(one);
            }
            all
        })
}

/// The folders Zen keeps `profiles.ini` in: its own folder in the system's
/// application data, and on Linux the dotted folder Firefox's lineage uses and the
/// Flatpak's own home.
fn homes() -> Vec<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(ZEN_DIR).as_deref()) {
        return vec![named];
    }

    let mut found = Vec::new();
    if let Some(config) = dirs::config_dir() {
        found.push(config.join("zen"));
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        found.push(home.join(".zen"));
        found.push(home.join(".var/app/app.zen_browser.zen/.zen"));
    }

    found
}

/// The profiles of one `profiles.ini` that hold a session: the one an install
/// opens first, then the one marked default, then the rest in the file's order.
fn profiles_in(home: &Path) -> Vec<ZenProfile> {
    let Ok(text) = fs::read_to_string(home.join("profiles.ini")) else {
        return Vec::new();
    };

    let mut found: Vec<(u8, ZenProfile)> = Vec::new();
    let opened = installed_defaults(&text);
    for entry in entries_in(&text) {
        let folder = if entry.relative {
            home.join(&entry.path)
        } else {
            PathBuf::from(&entry.path)
        };
        let files = files_of(&folder);
        if files.is_empty() {
            continue;
        }
        let rank = if opened.contains(&entry.path) {
            0
        } else if entry.default {
            1
        } else {
            2
        };
        found.push((
            rank,
            ZenProfile {
                name: entry.name,
                path: folder.to_string_lossy().into_owned(),
                files,
            },
        ));
    }

    found.sort_by_key(|(rank, _)| *rank);
    found.into_iter().map(|(_, one)| one).collect()
}

/// A `[ProfileN]` section.
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    name: String,
    path: String,
    relative: bool,
    default: bool,
}

/// The sections of an INI file as `(section, key, value)` rows, keys and sections
/// compared without case the way Firefox's own parser compares them.
fn rows(text: &str) -> Vec<(String, String, String)> {
    let mut section = String::new();
    let mut found = Vec::new();

    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            name.trim().clone_into(&mut section);
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            found.push((
                section.clone(),
                key.trim().to_ascii_lowercase(),
                value.trim().to_owned(),
            ));
        }
    }

    found
}

/// Every profile the file names, in its order.
fn entries_in(text: &str) -> Vec<Entry> {
    let rows = rows(text);
    let mut sections: Vec<&str> = Vec::new();
    for (section, _, _) in &rows {
        if section.to_ascii_lowercase().starts_with("profile")
            && !sections.contains(&section.as_str())
        {
            sections.push(section);
        }
    }

    sections
        .into_iter()
        .filter_map(|section| {
            let value = |key: &str| {
                rows.iter()
                    .find(|(one, name, _)| one == section && name == key)
                    .map(|(_, _, value)| value.clone())
            };
            let path = value("path").filter(|one| !one.is_empty())?;
            Some(Entry {
                name: value("name")
                    .filter(|one| !one.is_empty())
                    .unwrap_or_else(|| path.clone()),
                relative: value("isrelative").as_deref() != Some("0"),
                default: value("default").as_deref() == Some("1"),
                path,
            })
        })
        .collect()
}

/// The profile each install opens first: `[InstallXXXX]` sections, one per copy of
/// Zen on the machine, each with `Default=` the profile's `Path`.
fn installed_defaults(text: &str) -> Vec<String> {
    rows(text)
        .into_iter()
        .filter(|(section, key, _)| {
            section.to_ascii_lowercase().starts_with("install") && key == "default"
        })
        .map(|(_, _, value)| value)
        .collect()
}

/// The session files a profile holds, in the order they are worth reading.
fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = SESSIONS
        .iter()
        .filter(|name| profile.join(name).is_file())
        .map(|name| (*name).to_owned())
        .collect();

    let newest = fs::read_dir(profile.join(BACKUPS))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX))
        .max();
    if let Some(name) = newest {
        let at = found
            .iter()
            .position(|one| one.starts_with("sessionstore"))
            .unwrap_or(found.len());
        found.insert(at, format!("{BACKUPS}/{name}"));
    }

    found
}

/// The file asked for, when the profile is one Zen lists and the file is one of the
/// session files that profile was listed with: never a path the caller made up.
fn known(profile: &str, file: &str, listed: &[ZenProfile]) -> Result<PathBuf, String> {
    let asked = folded(Path::new(profile));
    let one = listed
        .iter()
        .find(|one| folded(Path::new(&one.path)) == asked)
        .ok_or_else(|| format!("{profile} is not a profile Zen lists"))?;
    if !one.files.iter().any(|name| name == file) {
        return Err(format!("{file} is not a session file of that profile"));
    }
    Ok(Path::new(&one.path).join(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Install6F193CCC56814779]\r\nDefault=Profiles/b2.Default (release)\r\nLocked=1\r\n\r\n[Profile1]\r\nName=Default Profile\r\nIsRelative=1\r\nPath=Profiles/a1.default\r\nDefault=1\r\n\r\n[Profile0]\r\nName=Default (release)\r\nIsRelative=1\r\nPath=Profiles/b2.Default (release)\r\n\r\n[Profile2]\r\nName=Work\r\nIsRelative=1\r\nPath=Profiles/c3.Work\r\n\r\n[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n";

    fn profile(home: &Path, path: &str, files: &[&str]) {
        for file in files {
            let at = home.join(path).join(file);
            fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
            fs::write(at, b"mozLz40\0").expect("a session");
        }
    }

    #[test]
    fn every_profile_of_the_file_is_read() {
        assert_eq!(
            entries_in(INI)
                .into_iter()
                .map(|one| (one.name, one.path, one.relative, one.default))
                .collect::<Vec<_>>(),
            vec![
                (
                    "Default Profile".into(),
                    "Profiles/a1.default".into(),
                    true,
                    true
                ),
                (
                    "Default (release)".into(),
                    "Profiles/b2.Default (release)".into(),
                    true,
                    false
                ),
                ("Work".into(), "Profiles/c3.Work".into(), true, false),
            ]
        );
        assert_eq!(
            installed_defaults(INI),
            vec!["Profiles/b2.Default (release)".to_owned()]
        );
    }

    #[test]
    fn the_profile_zen_opens_comes_first_and_one_without_a_session_not_at_all() {
        let here = tempfile::tempdir().expect("a folder");
        fs::write(here.path().join("profiles.ini"), INI).expect("the list");
        profile(
            here.path(),
            "Profiles/a1.default",
            &["sessionstore-backups/recovery.jsonlz4"],
        );
        profile(
            here.path(),
            "Profiles/b2.Default (release)",
            &["zen-sessions.jsonlz4"],
        );
        fs::create_dir_all(here.path().join("Profiles/c3.Work")).expect("an empty profile");

        let found = profiles_in(here.path());
        let names: Vec<&str> = found.iter().map(|one| one.name.as_str()).collect();
        assert_eq!(names, vec!["Default (release)", "Default Profile"]);
        assert_eq!(found[0].files, vec!["zen-sessions.jsonlz4".to_owned()]);
    }

    #[test]
    fn the_session_files_come_in_the_order_they_are_worth_reading() {
        let here = tempfile::tempdir().expect("a folder");
        profile(
            here.path(),
            "p",
            &[
                "sessionstore-backups/recovery.jsonlz4",
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-01-09.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "zen-sessions-backup/recovery.baklz4",
            ],
        );

        assert_eq!(
            files_of(&here.path().join("p")),
            vec![
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "sessionstore-backups/recovery.jsonlz4",
            ]
        );
    }

    #[test]
    fn only_a_listed_file_of_a_listed_profile_is_read() {
        let listed = vec![ZenProfile {
            name: "Default".into(),
            path: "/home/me/.zen/p".into(),
            files: vec!["zen-sessions.jsonlz4".into()],
        }];

        assert!(known("/home/me/.zen/p", "zen-sessions.jsonlz4", &listed).is_ok());
        assert!(known("/home/me/.zen/p/../q", "zen-sessions.jsonlz4", &listed).is_err());
        assert!(known("/home/me/.zen/p", "../../.ssh/id_ed25519", &listed).is_err());
        assert!(known("/home/me/.zen/p", "places.sqlite", &listed).is_err());
        assert!(known("/home/me/.zen/other", "zen-sessions.jsonlz4", &listed).is_err());
    }

    #[test]
    fn a_missing_or_broken_list_is_no_profiles() {
        let here = tempfile::tempdir().expect("a folder");
        assert!(profiles_in(here.path()).is_empty());
        fs::write(here.path().join("profiles.ini"), "not an ini\0\u{1}").expect("a list");
        assert!(profiles_in(here.path()).is_empty());
    }
}
