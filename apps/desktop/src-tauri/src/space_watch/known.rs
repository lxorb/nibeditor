//! What the watcher knows a space holds, and what a batch of touched paths means
//! against it.
//!
//! The file system's events are hints, not facts: Syncthing's rule, and the one this
//! follows. An event says a path was touched; what happened to it is read off the disk
//! when the batch settles, against what was there before. That is what makes the answer
//! the same on every platform, whatever each one reports: Windows names a move between
//! two folders as a removal and an addition, macOS coalesces a burst into one flag
//! word, inotify pairs a rename by a cookie. Here all three are a path that is gone and a
//! path that is new with the gone one's identity, which is a rename.
//!
//! Four answers, and the rules that pick them:
//!
//! - **renamed**: something is at a path that was empty, and its identity was known at a
//!   path that holds something else now or nothing. A folder renamed is one answer for
//!   the whole folder, not one per file in it.
//! - **created**: something is at a path that was empty, and its identity is new. A
//!   folder that arrives whole is created with everything in it.
//! - **removed**: a known path holds nothing now. A folder removed is one answer.
//! - **modified**: a known path still holds a file, and its size, its time or its
//!   identity moved. A path that holds a file before and after is always this, even when
//!   the file is another one now: that is how every editor saves (a temp file renamed
//!   over the note), and `mv B.md A.md` is A written with B's words and B removed. Neither
//!   loses A's history.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use super::walk::{found, ignored_path, present, walk, Found};
use crate::tree::MAX_ENTRIES;

/// What one settled path came to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Seen {
    /// New, with everything a new folder held listed after it.
    Created(Found),
    /// Still here, written again or replaced.
    Modified(Found),
    /// Gone. The identity is what it had, so the engine can match it against what it
    /// keeps even without the path.
    Removed {
        /// Where it was.
        rel: PathBuf,
        /// Whether it was a folder.
        dir: bool,
        /// What it was.
        id: Option<String>,
    },
    /// Moved or renamed, and now what `to` says.
    Renamed {
        /// Where it was.
        from: PathBuf,
        /// Where it is and what it is.
        to: Found,
    },
}

/// One entry of what is known.
#[derive(Clone, Debug)]
struct Known {
    dir: bool,
    size: u64,
    stamp: u128,
    id: Option<String>,
}

impl From<&Found> for Known {
    fn from(one: &Found) -> Self {
        Self {
            dir: one.dir,
            size: one.size,
            stamp: one.stamp,
            id: one.id.clone(),
        }
    }
}

/// Everything known to be in one space, by path and by identity.
///
/// Ordered by path, which puts everything inside a folder straight after the folder
/// (paths compare part by part), so a folder moved or removed is one range.
#[derive(Default, Debug)]
pub struct Space {
    paths: BTreeMap<PathBuf, Known>,
    ids: HashMap<String, PathBuf>,
}

impl Space {
    /// A space as it is on the disk now.
    pub fn read(root: &Path) -> Result<Self, String> {
        let mut space = Self::default();
        let mut left = MAX_ENTRIES;
        walk(root, Path::new(""), &mut left, &mut |one| {
            space.insert(&one);
        })?;
        Ok(space)
    }

    /// How many files and folders are known.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    fn insert(&mut self, one: &Found) {
        if let Some(id) = &one.id {
            self.ids.insert(id.clone(), one.rel.clone());
        }
        self.paths.insert(one.rel.clone(), Known::from(one));
    }

    /// Forgets `rel` and everything under it, and answers what `rel` was.
    fn remove_tree(&mut self, rel: &Path) -> Option<Known> {
        let under: Vec<PathBuf> = self.under(rel).collect();
        let mut was = None;
        for path in under {
            if let Some(known) = self.paths.remove(&path) {
                if let Some(id) = &known.id {
                    if self.ids.get(id) == Some(&path) {
                        self.ids.remove(id);
                    }
                }
                if path == rel {
                    was = Some(known);
                }
            }
        }
        was
    }

    /// Moves `from` and everything under it to `to`.
    fn move_tree(&mut self, from: &Path, to: &Path) {
        let under: Vec<PathBuf> = self.under(from).collect();
        for path in under {
            let Some(known) = self.paths.remove(&path) else {
                continue;
            };
            let rest = path.strip_prefix(from).unwrap_or(Path::new(""));
            let moved = if rest.as_os_str().is_empty() {
                to.to_path_buf()
            } else {
                to.join(rest)
            };
            if let Some(id) = &known.id {
                self.ids.insert(id.clone(), moved.clone());
            }
            self.paths.insert(moved, known);
        }
    }

    /// `rel` and every known path inside it.
    fn under<'a>(&'a self, rel: &'a Path) -> impl Iterator<Item = PathBuf> + 'a {
        self.paths
            .range(rel.to_path_buf()..)
            .map(|(path, _)| path)
            .take_while(move |path| path.starts_with(rel))
            .cloned()
    }

    /// What the touched paths came to, in the order the engine should apply them: every
    /// arrival first (so a move is seen as one before its old half could be read as a
    /// removal), then every removal, then what was written in place.
    ///
    /// `hold` asks for removals to wait for the next batch, except for the paths in
    /// `released`, which already waited once. A batch cut short by a burst that is
    /// still going can separate the two halves of one move; holding the half that left
    /// lets the half that arrives in the next batch find it. The held paths are
    /// answered so the caller can touch them again.
    pub fn settle(
        &mut self,
        root: &Path,
        touched: &BTreeSet<PathBuf>,
        hold: bool,
        released: &BTreeSet<PathBuf>,
    ) -> (Vec<Seen>, Vec<PathBuf>) {
        let mut order: Vec<&PathBuf> = touched
            .iter()
            .filter(|rel| !rel.as_os_str().is_empty() && !ignored_path(rel))
            .collect();
        // A folder before what is in it, so that a folder that moved or went has taken
        // its contents with it before any of them is looked at.
        order.sort_by_key(|rel| (rel.components().count(), (*rel).clone()));

        let mut seen = Vec::new();
        let mut waiting = Vec::new();

        // Twice: a rename can empty a path that was known when the first round reached
        // it (Plan.md renamed to Old.md and a new Plan.md written in the same moment),
        // and the second round is what sees the new file there.
        for _ in 0..2 {
            for rel in &order {
                self.arrived(root, rel, &mut seen);
            }
        }

        for rel in &order {
            if !self.paths.contains_key(*rel) || present(root, rel) {
                continue;
            }
            if hold && !released.contains(*rel) {
                waiting.push((*rel).clone());
                continue;
            }
            if let Some(was) = self.remove_tree(rel) {
                seen.push(Seen::Removed {
                    rel: (*rel).clone(),
                    dir: was.dir,
                    id: was.id,
                });
            }
        }

        for rel in &order {
            self.stayed(root, rel, &mut seen);
        }

        (seen, waiting)
    }

    /// Something at a path that was empty. Its folders come first where nothing said
    /// they arrived, so no answer names a place the engine has not heard of.
    fn arrived(&mut self, root: &Path, rel: &Path, seen: &mut Vec<Seen>) {
        if self.paths.contains_key(rel) {
            return;
        }
        let Some(now) = found(root, rel) else {
            return;
        };

        let mut above = PathBuf::new();
        for part in rel.parent().into_iter().flat_map(Path::components) {
            above.push(part);
            if !self.paths.contains_key(&above) {
                if let Some(folder) = found(root, &above) {
                    self.insert(&folder);
                    seen.push(Seen::Created(folder));
                }
            }
        }

        self.arriving(root, now, seen);
    }

    /// Something at a path that was empty, whose folders are known: the arriving half of
    /// a move, or new. A new folder is walked, and everything in it is placed the same
    /// way, because a folder made and a note moved into it in one moment is a note moved,
    /// not a note made.
    fn arriving(&mut self, root: &Path, now: Found, seen: &mut Vec<Seen>) {
        let rel = now.rel.clone();
        if !self.placed(root, now, seen) {
            return;
        }

        let mut inside = Vec::new();
        let mut left = MAX_ENTRIES.saturating_sub(self.paths.len());
        // A folder larger than what is left is listed as far as it goes; the engine's
        // own scan of the space is what says the space is too large.
        let _ = walk(root, &rel, &mut left, &mut |one| inside.push(one));
        for one in inside {
            // A folder that moved here took what was in it along, and the walk reaches
            // those after it: they are known at their new places by then.
            if !self.paths.contains_key(&one.rel) {
                self.placed(root, one, seen);
            }
        }
    }

    /// One arrival on its own: renamed from wherever its identity was known, if that
    /// place holds something else now or nothing, and otherwise created. Answers whether
    /// it is a new folder, whose contents are new too.
    fn placed(&mut self, root: &Path, now: Found, seen: &mut Vec<Seen>) -> bool {
        let from = now
            .id
            .as_ref()
            .and_then(|id| self.ids.get(id))
            .filter(|old| {
                old.as_path() != now.rel && found(root, old).and_then(|there| there.id) != now.id
            })
            .cloned();

        if let Some(from) = from {
            self.move_tree(&from, &now.rel);
            self.insert(&now);
            seen.push(Seen::Renamed { from, to: now });
            false
        } else {
            let dir = now.dir;
            self.insert(&now);
            seen.push(Seen::Created(now));
            dir
        }
    }

    /// A known path that still holds something: written again, replaced, or a file
    /// that became a folder or the other way round.
    fn stayed(&mut self, root: &Path, rel: &Path, seen: &mut Vec<Seen>) {
        let Some(known) = self.paths.get(rel).cloned() else {
            return;
        };
        let Some(now) = found(root, rel) else {
            return;
        };

        if now.dir != known.dir {
            self.remove_tree(rel);
            seen.push(Seen::Removed {
                rel: rel.to_path_buf(),
                dir: known.dir,
                id: known.id,
            });
            self.arriving(root, now, seen);
            return;
        }
        // A folder's own time moves whenever anything in it does, which is news about
        // what is in it and not about the folder.
        if known.dir || (now.size == known.size && now.stamp == known.stamp && now.id == known.id) {
            return;
        }

        if let Some(old) = &known.id {
            if self.ids.get(old).is_some_and(|there| there == rel) {
                self.ids.remove(old);
            }
        }
        self.insert(&now);
        seen.push(Seen::Modified(now));
    }
}

#[cfg(test)]
mod tests {
    use super::{Seen, Space};
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Settles a batch the way the watcher does once the space is quiet.
    fn settle(space: &mut Space, root: &Path, touched: &[&str]) -> Vec<Seen> {
        let touched: BTreeSet<PathBuf> = touched.iter().map(PathBuf::from).collect();
        space.settle(root, &touched, false, &BTreeSet::new()).0
    }

    /// Each answer as a word and its path, which is what these tests are about.
    fn said(seen: &[Seen]) -> Vec<String> {
        seen.iter()
            .map(|one| match one {
                Seen::Created(to) => format!("created {}", slash(&to.rel)),
                Seen::Modified(to) => format!("modified {}", slash(&to.rel)),
                Seen::Removed { rel, .. } => format!("removed {}", slash(rel)),
                Seen::Renamed { from, to } => {
                    format!("renamed {} {}", slash(from), slash(&to.rel))
                }
            })
            .collect()
    }

    fn slash(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn space_with(files: &[&str]) -> (tempfile::TempDir, Space) {
        let dir = tempfile::tempdir().expect("a folder");
        for file in files {
            let path = dir.path().join(file);
            if let Some(folder) = path.parent() {
                fs::create_dir_all(folder).expect("its folder");
            }
            fs::write(path, "words").expect("a file");
        }
        let space = Space::read(dir.path()).expect("read");
        (dir, space)
    }

    #[test]
    fn a_new_file_and_a_new_folder_with_everything_in_it() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join("Idea.md"), "new").expect("a note");
        fs::create_dir_all(root.join("Trip").join("Days")).expect("folders");
        fs::write(root.join("Trip").join("Days").join("One.md"), "").expect("a note inside");

        assert_eq!(
            said(&settle(&mut space, root, &["Idea.md", "Trip"])),
            [
                "created Idea.md",
                "created Trip",
                "created Trip/Days",
                "created Trip/Days/One.md"
            ]
        );
    }

    #[test]
    fn written_again_is_modified_and_touched_alone_is_nothing() {
        let (dir, mut space) = space_with(&["Plan.md", "Other.md"]);
        let root = dir.path();
        fs::write(root.join("Plan.md"), "words, and more of them").expect("edited");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md", "Other.md"])),
            ["modified Plan.md"]
        );
        assert!(
            settle(&mut space, root, &["Plan.md"]).is_empty(),
            "nothing moved since"
        );
    }

    #[test]
    fn a_rename_and_a_move_into_a_folder_keep_their_identity() {
        let (dir, mut space) = space_with(&["Plan.md", "Idea.md", "Projects/Keep.md"]);
        let root = dir.path();
        let plan = space
            .ids
            .iter()
            .find(|(_, rel)| rel.as_path() == Path::new("Plan.md"));
        let plan = plan.map(|(id, _)| id.clone()).expect("an identity");

        fs::rename(root.join("Plan.md"), root.join("Roadmap.md")).expect("renamed");
        fs::rename(root.join("Idea.md"), root.join("Projects").join("Idea.md")).expect("moved");

        let seen = settle(
            &mut space,
            root,
            &["Plan.md", "Roadmap.md", "Idea.md", "Projects/Idea.md"],
        );
        assert_eq!(
            said(&seen),
            [
                "renamed Plan.md Roadmap.md",
                "renamed Idea.md Projects/Idea.md"
            ]
        );
        let Seen::Renamed { to, .. } = &seen[0] else {
            panic!("not a rename");
        };
        assert_eq!(to.id.as_ref(), Some(&plan));
    }

    #[test]
    fn a_folder_renamed_is_one_answer_and_its_notes_follow_it() {
        let (dir, mut space) = space_with(&["Projects/One.md", "Projects/Deep/Two.md"]);
        let root = dir.path();
        fs::rename(root.join("Projects"), root.join("Archive")).expect("renamed");

        // Windows names the folder; inotify and FSEvents may name what is in it too.
        let seen = settle(
            &mut space,
            root,
            &["Projects", "Archive", "Projects/One.md", "Archive/One.md"],
        );
        assert_eq!(said(&seen), ["renamed Projects Archive"]);

        // Longer, and not only later: Linux stamps a write with a clock that moves every
        // few milliseconds, and this one lands straight after the space was read.
        fs::write(
            root.join("Archive").join("Deep").join("Two.md"),
            "later, and longer",
        )
        .expect("edited");
        assert_eq!(
            said(&settle(&mut space, root, &["Archive/Deep/Two.md"])),
            ["modified Archive/Deep/Two.md"],
            "what was in it is known at its new place"
        );
    }

    #[test]
    fn a_folder_removed_is_one_answer() {
        let (dir, mut space) = space_with(&["Old/One.md", "Old/Two.md", "Keep.md"]);
        let root = dir.path();
        fs::remove_dir_all(root.join("Old")).expect("removed");

        assert_eq!(
            said(&settle(
                &mut space,
                root,
                &["Old/One.md", "Old/Two.md", "Old"]
            )),
            ["removed Old"]
        );
        assert_eq!(space.len(), 1);
    }

    /// How every editor saves: the words go into a temp file, and the temp file is
    /// renamed over the note. The note is another file now, and still the note.
    #[test]
    fn a_save_by_rename_is_modified() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join("Plan.md.tmp"), "saved by another editor").expect("the temp file");
        fs::rename(root.join("Plan.md.tmp"), root.join("Plan.md")).expect("renamed over");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md.tmp", "Plan.md"])),
            ["modified Plan.md"]
        );
    }

    #[test]
    fn a_rename_over_another_note_is_that_note_written_and_the_first_removed() {
        let (dir, mut space) = space_with(&["A.md", "B.md"]);
        let root = dir.path();
        fs::write(root.join("B.md"), "B's longer words").expect("B edited");
        let _ = settle(&mut space, root, &["B.md"]);
        fs::rename(root.join("B.md"), root.join("A.md")).expect("B over A");

        assert_eq!(
            said(&settle(&mut space, root, &["B.md", "A.md"])),
            ["removed B.md", "modified A.md"]
        );
    }

    #[test]
    fn a_note_renamed_away_and_made_again_is_both() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::rename(root.join("Plan.md"), root.join("Plan (old).md")).expect("renamed");
        fs::write(root.join("Plan.md"), "new").expect("made again");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md", "Plan (old).md"])),
            ["renamed Plan.md Plan (old).md", "created Plan.md"]
        );
    }

    /// Two halves of one move in two batches, the first cut short by a burst: the half
    /// that left waits, once, for the half that arrives.
    #[test]
    fn a_move_split_across_two_batches_is_still_a_move() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::create_dir_all(root.join("Later")).expect("a folder");
        fs::rename(root.join("Plan.md"), root.join("Later").join("Plan.md")).expect("moved");

        let first: BTreeSet<PathBuf> = [PathBuf::from("Plan.md")].into();
        let (seen, held) = space.settle(root, &first, true, &BTreeSet::new());
        assert!(seen.is_empty());
        assert_eq!(held, [PathBuf::from("Plan.md")]);

        let second: BTreeSet<PathBuf> =
            [PathBuf::from("Plan.md"), Path::new("Later").join("Plan.md")].into();
        let released: BTreeSet<PathBuf> = held.into_iter().collect();
        let (seen, held) = space.settle(root, &second, true, &released);
        assert!(held.is_empty());
        assert_eq!(
            said(&seen),
            ["created Later", "renamed Plan.md Later/Plan.md"]
        );
    }

    #[test]
    fn what_sync_leaves_alone_is_never_an_answer() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join(".Plan.md.1-0.nib-tmp"), "half").expect("a temp file");
        fs::create_dir_all(root.join(".git")).expect("a repository");

        assert!(settle(
            &mut space,
            root,
            &[".Plan.md.1-0.nib-tmp", ".git", ".git/HEAD"]
        )
        .is_empty());
    }
}
