//! The vaults Obsidian knows about on this machine, and reading one of them.
//!
//! Chrome's and Arc's first run, which list the browsers already on the machine by
//! name rather than asking for a profile folder nobody has ever looked for. Obsidian
//! keeps its own list in `obsidian.json` beside its settings - the vault chooser's
//! rows - so nib reads that list and offers each vault by its name.
//!
//! This is a narrow way past paths.rs, which keeps the crate to the spaces folder: a
//! folder is read here only when Obsidian itself lists it as a vault, and every file
//! asked for is judged to be inside that folder. The vault is read and never
//! written; what the import writes goes into a space like every other import.
//!
//! Desktop only: a phone has no Obsidian config this app could read.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::paths::{folded, inside, MAX_DEPTH};

/// One vault, the way Obsidian's chooser shows it.
#[derive(Serialize, Debug, PartialEq)]
pub struct Vault {
    /// The folder's name, which is what Obsidian calls the vault.
    pub name: String,
    pub path: String,
}

/// One file of a vault, relative to it, with forward slashes.
#[derive(Serialize, Debug, PartialEq)]
pub struct VaultFile {
    pub path: String,
    pub size: u64,
}

/// More files than any vault anybody writes in, so a folder that is not really a
/// vault - a home folder somebody opened as one - is not walked forever.
const MOST_FILES: usize = 200_000;

/// The vaults on this machine, most recently opened first. None where Obsidian
/// has never run.
#[tauri::command(async)]
pub fn obsidian_vaults() -> Vec<Vault> {
    listed()
        .into_iter()
        .filter(|path| path.is_dir())
        .map(|path| Vault {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
        })
        .collect()
}

/// Every file of a vault Obsidian lists, minus what is about one machine rather
/// than the vault.
#[tauri::command(async)]
pub fn obsidian_vault_files(vault: String) -> Result<Vec<VaultFile>, String> {
    let root = known(&vault, &listed())?;
    Ok(files_of(&root))
}

/// One file of such a vault, as base64, which is how bytes cross the bridge.
#[tauri::command(async)]
pub fn read_obsidian_file(vault: String, path: String) -> Result<String, String> {
    let root = known(&vault, &listed())?;
    let file = file_in(&root, &path)?;
    let bytes = fs::read(&file).map_err(|error| format!("{path} could not be read: {error}"))?;
    Ok(BASE64.encode(bytes))
}

/// The vaults `obsidian.json` names, wherever this platform's Obsidian keeps it.
fn listed() -> Vec<PathBuf> {
    listed_in(&config_files())
}

/// The vaults of every one of these lists, each once. Every list is read rather
/// than the first found, because a Linux reader who moved from the downloaded app to the
/// Flatpak still has the old list, naming vaults long gone, beside the one Obsidian
/// writes now.
///
/// Newest first across all of them, as within one: the leftover list is the older
/// one, and its vaults would otherwise sit above the ones opened yesterday. A vault
/// in two lists is as new as the newer of them says.
fn listed_in(configs: &[PathBuf]) -> Vec<PathBuf> {
    let mut found: Vec<(i64, PathBuf)> = Vec::new();

    for config in configs {
        let Ok(text) = fs::read_to_string(config) else {
            continue;
        };
        for (when, vault) in dated_in(&text) {
            match found.iter_mut().find(|(_, one)| *one == vault) {
                Some(held) => held.0 = held.0.max(when),
                None => found.push((when, vault)),
            }
        }
    }

    found.sort_by_key(|(when, _)| std::cmp::Reverse(*when));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Where Obsidian writes `obsidian.json`: its config folder, which on Linux may also
/// be inside a Flatpak's or a Snap's own home.
fn config_files() -> Vec<PathBuf> {
    let mut found = Vec::new();

    if let Some(config) = dirs::config_dir() {
        found.push(config.join("obsidian").join("obsidian.json"));
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        found.push(home.join(".var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json"));
        found.push(home.join("snap/obsidian/current/.config/obsidian/obsidian.json"));
    }

    found
}

/// The vaults out of the file's text: `{"vaults": {"<id>": {"path", "ts"}}}`, the
/// newest `ts` first, which is the order Obsidian's chooser lists them in.
#[cfg(test)]
fn vaults_in(text: &str) -> Vec<PathBuf> {
    dated_in(text).into_iter().map(|(_, path)| path).collect()
}

/// The same, each with its `ts`, so lists can be put in one order.
fn dated_in(text: &str) -> Vec<(i64, PathBuf)> {
    let Ok(said) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(vaults) = said.get("vaults").and_then(|one| one.as_object()) else {
        return Vec::new();
    };

    let mut found: Vec<(i64, PathBuf)> = vaults
        .values()
        .filter_map(|vault| {
            let path = vault.get("path")?.as_str()?;
            let when = vault
                .get("ts")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);
            Some((when, PathBuf::from(path)))
        })
        .collect();

    found.sort_by_key(|(when, _)| std::cmp::Reverse(*when));
    found
}

/// The vault asked for, when it is one of those listed, spelled the way the list
/// spells it.
fn known(vault: &str, listed: &[PathBuf]) -> Result<PathBuf, String> {
    let asked = folded(Path::new(vault));
    listed
        .iter()
        .find(|one| inside(one, &asked) && inside(&asked, one))
        .cloned()
        .ok_or_else(|| format!("{vault} is not a vault Obsidian lists"))
}

/// A file inside the vault, from its relative path: nothing absolute, no climbing
/// out, nothing through a link.
fn file_in(root: &Path, path: &str) -> Result<PathBuf, String> {
    let asked = Path::new(path);
    let plain = asked
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if !plain {
        return Err(format!("{path} is not a file inside the vault"));
    }

    let file = root.join(asked);
    let real = fs::canonicalize(&file).map_err(|error| format!("{path}: {error}"))?;
    let real_root = fs::canonicalize(root).map_err(|error| format!("the vault: {error}"))?;
    if !inside(&real_root, &real) || !real.is_file() {
        return Err(format!("{path} is not a file inside the vault"));
    }

    Ok(real)
}

/// Every file of the vault, walked without following links. Hidden folders are
/// another program's business and are left, except Obsidian's own, which keeps the
/// settings the vault was written under; inside that, the panes of the last
/// machine, the plugins' code, themes and caches stay behind. So do `.git`,
/// `node_modules` and Obsidian's own trash.
fn files_of(root: &Path) -> Vec<VaultFile> {
    let mut found = Vec::new();
    walk(root, root, 0, &mut found);
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

fn walk(root: &Path, folder: &Path, depth: usize, found: &mut Vec<VaultFile>) {
    if depth > MAX_DEPTH || found.len() >= MOST_FILES {
        return;
    }

    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        let Some(relative) = relative(root, &path) else {
            continue;
        };
        if left(&relative, kind.is_dir()) {
            continue;
        }

        if kind.is_dir() {
            walk(root, &path, depth + 1, found);
        } else if kind.is_file() {
            let size = entry.metadata().map_or(0, |one| one.len());
            found.push(VaultFile {
                path: relative,
                size,
            });
            if found.len() >= MOST_FILES {
                return;
            }
        }
    }
}

/// The path from the vault's top, with forward slashes. None for a name that is not
/// UTF-8, an old Latin-1 download on Linux, say: written out it would be a name with
/// a replacement character in it, which `read_obsidian_file` could then not find.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let parts: Option<Vec<&str>> = rest
        .components()
        .map(|part| part.as_os_str().to_str())
        .collect();
    Some(parts?.join("/"))
}

/// Whether a path of the vault stays behind.
fn left(relative: &str, is_dir: bool) -> bool {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    // The desktop's rubbish, inside Obsidian's folder as much as anywhere else.
    let rubbish = name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini";

    if let Some(rest) = relative.strip_prefix(".obsidian/") {
        let top = rest.split('/').next().unwrap_or(rest);
        // `workspace.json` and `workspace-mobile.json` are the last machine's panes;
        // `workspaces.json` is the layouts saved by name, which are the vault's own.
        let panes = name.strip_suffix(".json").is_some_and(|stem| {
            stem.eq_ignore_ascii_case("workspace")
                || stem
                    .get(..10)
                    .is_some_and(|start| start.eq_ignore_ascii_case("workspace-"))
        });
        return rubbish
            || matches!(top, "plugins" | "themes" | "cache")
            || (!rest.contains('/') && panes);
    }
    if relative == ".obsidian" {
        return false;
    }

    rubbish || (is_dir && name == "node_modules")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_comes_newest_first() {
        let text = r#"{"vaults":{
            "a1":{"path":"/home/me/Old","ts":100},
            "b2":{"path":"/home/me/Work","ts":300,"open":true},
            "c3":{"path":"/home/me/Uni","ts":200}
        }}"#;

        assert_eq!(
            vaults_in(text),
            vec![
                PathBuf::from("/home/me/Work"),
                PathBuf::from("/home/me/Uni"),
                PathBuf::from("/home/me/Old"),
            ]
        );
    }

    #[test]
    fn a_file_obsidian_could_not_read_lists_nothing() {
        assert!(vaults_in("not json").is_empty());
        assert!(vaults_in(r#"{"other":1}"#).is_empty());
    }

    #[test]
    fn every_list_obsidian_keeps_is_read_each_vault_once() {
        let here = tempfile::tempdir().expect("a folder");
        let native = here.path().join("native.json");
        let flatpak = here.path().join("flatpak.json");
        fs::write(
            &native,
            r#"{"vaults":{"a":{"path":"/gone/Old","ts":1},"b":{"path":"/home/me/Work","ts":2}}}"#,
        )
        .expect("the native list");
        fs::write(
            &flatpak,
            r#"{"vaults":{"c":{"path":"/home/me/Notes","ts":3},"d":{"path":"/home/me/Work","ts":2}}}"#,
        )
        .expect("the Flatpak's list");

        assert_eq!(
            listed_in(&[native, here.path().join("missing.json"), flatpak]),
            vec![
                PathBuf::from("/home/me/Notes"),
                PathBuf::from("/home/me/Work"),
                PathBuf::from("/gone/Old"),
            ]
        );
    }

    #[test]
    fn vaults_from_every_list_come_newest_first() {
        let here = tempfile::tempdir().expect("a folder");
        let native = here.path().join("native.json");
        let flatpak = here.path().join("flatpak.json");
        fs::write(
            &native,
            r#"{"vaults":{"a":{"path":"/home/me/Old","ts":1700000000000},"b":{"path":"/home/me/Work","ts":1600000000000}}}"#,
        )
        .expect("the native list");
        fs::write(
            &flatpak,
            r#"{"vaults":{"c":{"path":"/home/me/Notes","ts":1790000000000},"d":{"path":"/home/me/Work","ts":1800000000000}}}"#,
        )
        .expect("the Flatpak's list");

        assert_eq!(
            listed_in(&[native, flatpak]),
            vec![
                PathBuf::from("/home/me/Work"),
                PathBuf::from("/home/me/Notes"),
                PathBuf::from("/home/me/Old"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_name_that_is_not_utf8_is_not_listed_as_one_nobody_can_read() {
        use std::os::unix::ffi::OsStrExt;

        let here = tempfile::tempdir().expect("a folder");
        let vault = here.path();
        fs::write(
            vault.join(std::ffi::OsStr::from_bytes(b"Caf\xe9.md")),
            "# Cafe",
        )
        .expect("a Latin-1 name");
        fs::write(vault.join("Read me.md"), "x").expect("a note");

        let files = files_of(vault);
        let paths: Vec<&str> = files.iter().map(|one| one.path.as_str()).collect();
        assert_eq!(paths, vec!["Read me.md"]);
        for file in &files {
            assert!(file_in(vault, &file.path).is_ok());
        }
    }

    #[test]
    fn only_a_listed_vault_is_read() {
        let listed = vec![PathBuf::from("/home/me/Work")];

        assert!(known("/home/me/Work", &listed).is_ok());
        assert!(known("/home/me/Work/../Work", &listed).is_ok());
        assert!(known("/home/me", &listed).is_err());
        assert!(known("/home/me/Work/Inner", &listed).is_err());
        assert!(known("/etc", &listed).is_err());
    }

    #[test]
    fn a_file_is_read_only_from_inside_the_vault() {
        let here = tempfile::tempdir().expect("a folder");
        let vault = here.path().join("Vault");
        fs::create_dir_all(vault.join("Notes")).expect("folders");
        fs::write(vault.join("Notes/A.md"), "# A").expect("a note");
        fs::write(here.path().join("secret.txt"), "no").expect("a file beside it");

        assert!(file_in(&vault, "Notes/A.md").is_ok());
        assert!(file_in(&vault, "../secret.txt").is_err());
        assert!(file_in(&vault, "/etc/passwd").is_err());
        assert!(file_in(&vault, "Notes").is_err());
        assert!(file_in(&vault, "Missing.md").is_err());
    }

    #[test]
    fn the_walk_leaves_what_is_about_one_machine() {
        let here = tempfile::tempdir().expect("a folder");
        let vault = here.path();
        for folder in [
            ".obsidian/plugins/dataview",
            ".obsidian/themes/Minimal",
            ".obsidian/snippets",
            ".git",
            ".trash",
            "Projects/node_modules/x",
            "Projects/Sub",
        ] {
            fs::create_dir_all(vault.join(folder)).expect("a folder");
        }
        for file in [
            ".obsidian/app.json",
            ".obsidian/templates.json",
            ".obsidian/workspace.json",
            ".obsidian/workspace-mobile.json",
            ".obsidian/workspaces.json",
            ".obsidian/.DS_Store",
            ".obsidian/._app.json",
            ".obsidian/snippets/.DS_Store",
            ".obsidian/snippets/wide.css",
            ".obsidian/plugins/dataview/main.js",
            ".obsidian/themes/Minimal/theme.css",
            ".git/HEAD",
            ".trash/Old.md",
            ".DS_Store",
            "Projects/node_modules/x/index.js",
            "Projects/Sub/Plan.md",
            "Read me.md",
        ] {
            fs::write(vault.join(file), "x").expect("a file");
        }

        let paths: Vec<String> = files_of(vault).into_iter().map(|one| one.path).collect();
        assert_eq!(
            paths,
            vec![
                ".obsidian/app.json",
                ".obsidian/snippets/wide.css",
                ".obsidian/templates.json",
                ".obsidian/workspaces.json",
                "Projects/Sub/Plan.md",
                "Read me.md",
            ]
        );
    }
}
