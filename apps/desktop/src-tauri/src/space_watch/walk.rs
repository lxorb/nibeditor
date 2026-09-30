//! Every file and folder in a space, as sync sees them: what `space_scan` lists, what
//! the watcher learns a space from before it watches, and what it reads a folder that
//! arrived whole with.
//!
//! The same bounds as the file tree's walk (tree.rs), for the same reasons: no deeper
//! than `MAX_DEPTH`, no more than `MAX_ENTRIES`, and a space larger than that says so
//! rather than answering with half of itself. Two rules differ, and both are about what
//! a second computer should be handed:
//!
//! - Links are left alone, not followed. The tree follows a link into a folder of the
//!   same space, which draws one note in two places; sync would send it twice, under two
//!   names, and a link is a thing about this disk that means nothing on another one.
//!   Syncthing makes the same choice.
//! - Hidden names are left out, as the tree leaves them out: `.git`, `.obsidian`, and
//!   nib's own half-written temp files, which are hidden so that no list ever shows one.
//!   So is what an operating system leaves in every folder it opens (`Thumbs.db`,
//!   `desktop.ini`, an open Office file's `~$` owner file): a folder full of those
//!   arriving on a Mac is noise, and none of them is anybody's writing.

use std::fs;
use std::path::{Path, PathBuf};

use super::identity::identity;
use crate::clock;
use crate::paths::MAX_DEPTH;
use crate::tree::MAX_ENTRIES;

/// One file or folder: where it is inside its space, and what it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    /// Inside the space, with the platform's separators.
    pub rel: PathBuf,
    /// Whether it is a folder.
    pub dir: bool,
    /// Its size in bytes; nothing for a folder.
    pub size: u64,
    /// When it was last written, in milliseconds since the epoch.
    pub mtime: u64,
    /// What it is apart from where it is; see identity.rs. None where the file system
    /// would not say, which a file that vanished between the listing and the question
    /// also answers.
    pub id: Option<String>,
}

/// Whether sync leaves a name alone; see the top of this file.
pub fn ignored(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with("~$")
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name == "Icon\r"
}

/// Whether any part of a path inside a space is a name sync leaves alone.
pub fn ignored_path(rel: &Path) -> bool {
    rel.components()
        .any(|part| part.as_os_str().to_str().is_none_or(ignored))
}

/// What is at `rel` inside `root` now, or None where nothing sync keeps is there: no
/// file, a link, a name it leaves alone, a name that is not text.
pub fn found(root: &Path, rel: &Path) -> Option<Found> {
    if rel.as_os_str().is_empty() || ignored_path(rel) {
        return None;
    }
    let path = root.join(rel);
    let meta = fs::symlink_metadata(&path).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }

    Some(Found {
        rel: rel.to_path_buf(),
        dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime: clock::of(meta.modified().ok()),
        id: identity(&path),
    })
}

/// Whether anything sync keeps is at `rel` inside `root` now: `found` without asking
/// what it is, which on Windows is a handle opened and closed.
pub fn present(root: &Path, rel: &Path) -> bool {
    !rel.as_os_str().is_empty()
        && !ignored_path(rel)
        && fs::symlink_metadata(root.join(rel)).is_ok_and(|meta| !meta.file_type().is_symlink())
}

/// Everything under `rel` inside `root`, `rel` itself left out, handed to `visit` a
/// folder before what is in it and each folder's names in order. `left` is what the
/// walk may still list; a walk that runs out answers the sentence that says so.
pub fn walk(
    root: &Path,
    rel: &Path,
    left: &mut usize,
    visit: &mut dyn FnMut(Found),
) -> Result<(), String> {
    let depth = rel.components().count();
    if depth >= MAX_DEPTH {
        return Ok(());
    }
    let Ok(listing) = fs::read_dir(root.join(rel)) else {
        return Ok(());
    };

    let mut names: Vec<String> = listing
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !ignored(name))
        .collect();
    names.sort_unstable();

    for name in names {
        let child = rel.join(&name);
        let Some(one) = found(root, &child) else {
            continue;
        };
        *left = left
            .checked_sub(1)
            .ok_or_else(|| format!("this space holds more than {MAX_ENTRIES} files and folders"))?;

        let dir = one.dir;
        visit(one);
        if dir {
            walk(root, &child, left, visit)?;
        }
    }

    Ok(())
}

/// Everything in a space, in the walk's order.
#[cfg(test)]
pub fn everything(root: &Path) -> Result<Vec<Found>, String> {
    let mut all = Vec::new();
    let mut left = MAX_ENTRIES;
    walk(root, Path::new(""), &mut left, &mut |one| all.push(one))?;
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::{everything, ignored, walk};
    use crate::paths::link_to;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn rels(root: &Path) -> Vec<PathBuf> {
        everything(root)
            .expect("a walk")
            .into_iter()
            .map(|one| one.rel)
            .collect()
    }

    #[test]
    fn a_space_is_every_file_in_it_but_what_sync_leaves_alone() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::create_dir_all(root.join("Reading").join(".obsidian")).expect("folders");
        fs::create_dir_all(root.join(".git")).expect("a repository");
        fs::write(root.join(".git").join("HEAD"), "ref").expect("its head");
        fs::write(root.join("Plan.md"), "words").expect("a note");
        fs::write(root.join("shot.png"), [1, 2, 3]).expect("a picture");
        fs::write(root.join(".Plan.md.123-0.nib-tmp"), "half").expect("a temp file");
        fs::write(root.join("Thumbs.db"), "").expect("clutter");
        fs::write(root.join("~$Report.docx"), "").expect("an owner file");
        fs::write(root.join("Reading").join("Deep.md"), "").expect("a nested note");

        assert_eq!(
            rels(root),
            [
                PathBuf::from("Plan.md"),
                PathBuf::from("Reading"),
                Path::new("Reading").join("Deep.md"),
                PathBuf::from("shot.png"),
            ]
        );

        let all = everything(root).expect("a walk");
        let picture = all
            .iter()
            .find(|one| one.rel == Path::new("shot.png"))
            .expect("listed");
        assert_eq!(picture.size, 3);
        assert!(picture.mtime > 0);
        assert!(picture.id.is_some());
        assert!(all[1].dir && all[1].id.is_some());
    }

    #[test]
    fn a_link_is_not_followed_or_listed() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path().join("Space");
        let elsewhere = dir.path().join("Elsewhere");
        fs::create_dir_all(&root).expect("a space");
        fs::create_dir_all(&elsewhere).expect("somewhere else");
        fs::write(elsewhere.join("Other.md"), "").expect("a note elsewhere");
        fs::write(root.join("Plan.md"), "").expect("a note");
        if !link_to(&elsewhere, &root.join("out")) || !link_to(&root, &root.join("loop")) {
            return;
        }

        assert_eq!(rels(&root), [PathBuf::from("Plan.md")]);
    }

    #[test]
    fn a_space_larger_than_the_walk_says_so() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::write(root.join("a.md"), "").expect("a note");
        fs::write(root.join("b.md"), "").expect("a note");

        let mut left = 1;
        let refused = walk(root, Path::new(""), &mut left, &mut |_| {});
        assert!(refused.expect_err("too many").contains("files and folders"));
    }

    #[test]
    fn clutter_is_named_as_such() {
        for name in [
            ".DS_Store",
            "desktop.ini",
            "Thumbs.db",
            "~$Plan.docx",
            "Icon\r",
        ] {
            assert!(ignored(name), "{name:?}");
        }
        for name in ["Plan.md", "Icon.png", "thumbs.md", "a~$b"] {
            assert!(!ignored(name), "{name:?}");
        }
    }
}
