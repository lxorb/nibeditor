//! The file tree the sidebar draws: one space read into the shape the window
//! renders, sorted here so that every window agrees on the order.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, in_spaces, inside, is_canvas, is_markdown, is_pages, is_pdf, is_shortcut, space_root,
    spaces_dir, Seen, MAX_DEPTH,
};

/// How many notes and folders one read may put in the tree.
///
/// The two bounds above it answer different questions: `MAX_DEPTH` bounds one
/// chain of folders, `Seen` bounds how many chains there are, and neither bounds
/// how wide a space is. A folder holding a million files is one folder at depth
/// one, read once, and building a tree of it is a window that never paints.
///
/// Far more than any space anybody writes notes in, so a reader never meets it;
/// and when something does - a space pointed at a build directory, a link the
/// walk is right to have followed into something enormous - the read stops and
/// says why. A tree quietly missing half of itself is the answer to avoid: the
/// sidebar would look finished and be wrong.
const MAX_ENTRIES: usize = 100_000;

/// A note or a folder, and everything under it if it is a folder.
#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    /// Milliseconds since the epoch, so the tree can sort by age.
    modified: u64,
    created: u64,
    children: Vec<Entry>,
}

/// How the window would like the tree read, which is whatever its own settings
/// say. All three have a default, so a window that sends nothing still gets a
/// tree.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TreeOptions {
    /// Files and folders beginning with a dot.
    pub show_hidden: bool,
    /// `name`, `modified` or `created`.
    pub sort: String,
    pub descending: bool,
}

/// Reads a space into a tree of notes and folders.
#[tauri::command(async)]
pub fn read_tree(
    app: AppHandle,
    root: String,
    options: Option<TreeOptions>,
) -> Result<Entry, String> {
    let spaces = spaces_dir(&app)?;
    let path = in_spaces(&app, &root)?;
    if !path.is_dir() {
        return Err("root is not a directory".into());
    }

    // What a link in this tree may point into: the space being read, whether the
    // read starts at its top or at a folder inside it - one note linked to from
    // the folder beside it is somebody arranging their own space.
    //
    // Resolved, and resolved here rather than per folder: every link the walk
    // judges is resolved before it is compared, so the space has to be resolved
    // too or the two sides would be two different spellings of the same folder and
    // nothing would match. Said as an error rather than fallen back on for that
    // reason - a space whose real path cannot be read would otherwise read as a
    // space whose every folder is a link out of it, which is an empty sidebar and
    // no reason given. The folder was a directory a line ago, so this does not
    // happen; if it ever does it says so.
    let space = space_root(&spaces, &path).unwrap_or_else(|| path.clone());
    let space = fs::canonicalize(&space).map_err(|error| cannot("resolve", &space, &error))?;
    let mut left = MAX_ENTRIES;

    let tree = walk(
        &space,
        &path,
        &options.unwrap_or_default(),
        0,
        &mut Seen::default(),
        &mut left,
    );

    // Which half of a slow launch this is. The window times the round trip; this times
    // the walk inside it, so the two numbers say whether a space takes its time on the
    // disk or on the way back through the bridge. The count goes in the name because a
    // space being opened later marks again and a row that cannot be told from the
    // launch's own is a row nobody can read. See lib/trace.ts, and `loadTree`.
    crate::trace::mark(&format!("tree walked: {} entries", MAX_ENTRIES - left));

    tree
}

/// One folder and its children.
///
/// Three things make a folder read as empty rather than read at all, and all
/// three are a link: one nested deeper than `MAX_DEPTH`, one the read has already
/// been inside, and one whose real path is not in the space. The first two are a
/// link pointing back at one of its own parents, and following those is how a file
/// tree never finishes loading; the third is a link pointing off into the rest of
/// the disk, and following that is how a sidebar comes to list somebody's home
/// folder. In every case the folder itself stays in the tree - it is a folder, the
/// reader made it - and only its children are left to the one place they live. See
/// `Seen` and `in_the_space`.
///
/// `left` is what is still allowed in the tree. A read that runs out says so
/// rather than answering with half a space; see `MAX_ENTRIES`.
fn walk(
    space: &Path,
    path: &Path,
    options: &TreeOptions,
    depth: usize,
    seen: &mut Seen,
    left: &mut usize,
) -> Result<Entry, String> {
    let mut children = Vec::new();

    if depth < MAX_DEPTH && seen.first_time(path) {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let child = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                if name.starts_with('.') && !options.show_hidden {
                    continue;
                }

                if child.is_dir() {
                    room(left)?;
                    children.push(if in_the_space(space, &child) {
                        walk(space, &child, options, depth + 1, seen, left)?
                    } else {
                        folder(&child, name)
                    });
                } else if is_markdown(&child)
                    || is_pdf(&child)
                    || is_canvas(&child)
                    || is_pages(&child)
                    || is_shortcut(&child)
                {
                    // The notes, the PDFs beside them, the canvases, the stacks
                    // of paper and the websites: the things a tab can hold.
                    // Everything else in a space belongs to a note rather than
                    // standing on its own - a picture, a PDF's own highlights -
                    // and a file list nobody can act on is noise.
                    room(left)?;
                    children.push(listed(&child, name, false, entry.metadata().ok()));
                }
            }
        }
    }

    sort_children(&mut children, options);

    let mut here = folder(
        path,
        path.file_name().map_or_else(
            || path.to_string_lossy().to_string(),
            |name| name.to_string_lossy().to_string(),
        ),
    );
    here.children = children;
    Ok(here)
}

/// One folder with no children yet, off one `stat` of the folder itself.
fn folder(path: &Path, name: String) -> Entry {
    listed(path, name, true, fs::metadata(path).ok())
}

/// One entry with no children. The listing is a listing: a name, a kind and two
/// times off the `stat` the caller already had, and not one byte of any note.
fn listed(path: &Path, name: String, is_dir: bool, meta: Option<fs::Metadata>) -> Entry {
    Entry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        modified: clock::of(meta.as_ref().and_then(|one| one.modified().ok())),
        created: clock::of(meta.as_ref().and_then(|one| one.created().ok())),
        children: Vec::new(),
    }
}

/// Room in the tree for one more entry, or the error that says the space is
/// larger than a tree.
fn room(left: &mut usize) -> Result<(), String> {
    *left = left
        .checked_sub(1)
        .ok_or_else(|| format!("this space holds more than {MAX_ENTRIES} notes and folders"))?;

    Ok(())
}

/// Whether a folder the walk reached is one it may read into: its real path, once
/// every link along the way has been followed, is inside the space.
///
/// `space` is already resolved, so this is one `canonicalize` for the folder and
/// nothing else. A folder whose real path cannot be read - a link to nowhere, a
/// folder this user may not look inside - is not one to step into, which is the
/// cautious answer and the same one `outside_spaces` gives.
fn in_the_space(space: &Path, child: &Path) -> bool {
    fs::canonicalize(child).is_ok_and(|real| inside(space, &real))
}

/// Folders always come first; the chosen key only orders within each group.
fn sort_children(children: &mut [Entry], options: &TreeOptions) {
    children.sort_by(|a, b| {
        let grouped = b.is_dir.cmp(&a.is_dir);
        if grouped != Ordering::Equal {
            return grouped;
        }

        let order = match options.sort.as_str() {
            "modified" => a.modified.cmp(&b.modified),
            "created" => a.created.cmp(&b.created),
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        };

        if options.descending {
            order.reverse()
        } else {
            order
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{sort_children, walk, Entry, TreeOptions, MAX_ENTRIES};
    use crate::paths::{link_to, Seen};
    use std::path::Path;

    /// One read of one space, the way `read_tree` does it: the space resolved
    /// once so that the links under it are judged against a real path, and the
    /// whole ceiling to spend.
    fn read(here: &Path, options: &TreeOptions) -> Entry {
        tree_of(here, options, MAX_ENTRIES).expect("a tree")
    }

    /// The same with a ceiling of its own, so the test that measures one does not
    /// have to write a hundred thousand files to reach it.
    fn tree_of(here: &Path, options: &TreeOptions, most: usize) -> Result<Entry, String> {
        let space = std::fs::canonicalize(here).expect("a real path");
        let mut left = most;
        walk(&space, here, options, 0, &mut Seen::default(), &mut left)
    }

    fn entry(name: &str, is_dir: bool, modified: u64) -> Entry {
        Entry {
            name: name.into(),
            path: format!("/notes/{name}"),
            is_dir,
            modified,
            created: modified,
            children: Vec::new(),
        }
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|one| one.name.as_str()).collect()
    }

    fn options(sort: &str, descending: bool) -> TreeOptions {
        TreeOptions {
            show_hidden: false,
            sort: sort.into(),
            descending,
        }
    }

    #[test]
    fn folders_come_before_notes() {
        let mut children = vec![
            entry("beta.md", false, 1),
            entry("Alpha", true, 2),
            entry("alpha.md", false, 3),
            entry("Beta", true, 4),
        ];

        sort_children(&mut children, &options("name", false));
        assert_eq!(names(&children), ["Alpha", "Beta", "alpha.md", "beta.md"]);
    }

    #[test]
    fn a_name_sorts_the_same_in_either_case() {
        let mut children = vec![entry("b.md", false, 1), entry("A.md", false, 2)];

        sort_children(&mut children, &options("name", false));
        assert_eq!(names(&children), ["A.md", "b.md"]);
    }

    #[test]
    fn the_newest_first_is_the_other_direction() {
        let mut children = vec![
            entry("old.md", false, 1),
            entry("new.md", false, 9),
            entry("middle.md", false, 5),
        ];

        sort_children(&mut children, &options("modified", true));
        assert_eq!(names(&children), ["new.md", "middle.md", "old.md"]);
    }

    #[test]
    fn a_space_lists_what_a_tab_can_hold_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Board.canvas"), "{}").expect("a canvas");
        std::fs::write(here.join("Journal.pages"), "{}").expect("a page note");
        std::fs::write(here.join("Svelte docs.url"), "[InternetShortcut]").expect("a website");
        std::fs::write(here.join("paper.pdf"), "").expect("a pdf");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("its highlights");
        std::fs::write(here.join("shot.png"), "").expect("a picture");
        std::fs::write(here.join("Reading").join("Deep.PDF"), "").expect("a nested pdf");

        let top = read(here, &options("name", false));
        assert_eq!(
            names(&top.children),
            [
                "Reading",
                "Board.canvas",
                "Idea.md",
                "Journal.pages",
                // After the paper, because the list folds case before it sorts.
                "paper.pdf",
                "Svelte docs.url"
            ]
        );

        let nested = &top.children[0];
        assert_eq!(names(&nested.children), ["Deep.PDF"]);
    }

    /// A folder holding two symlinks back to the folder above it. Reading each
    /// folder once is what makes that finish at all: the two links double the work
    /// at every level otherwise, which is two billion folders to read and a
    /// sidebar that never appears. Both links stay in the tree, and neither
    /// reopens the tree above them.
    #[test]
    fn a_folder_already_read_is_read_as_empty() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");
        std::fs::write(inner.join("Idea.md"), "").expect("a note");

        assert!(link_to(here, &inner.join("up")), "one link back up");
        assert!(link_to(here, &inner.join("over")), "a second link back up");

        let top = read(here, &options("name", false));
        assert_eq!(names(&top.children), ["Notes"]);

        let notes = &top.children[0];
        assert_eq!(names(&notes.children), ["over", "up", "Idea.md"]);
        for link in notes.children.iter().filter(|child| child.is_dir) {
            assert!(link.children.is_empty(), "{} was read twice", link.name);
        }
    }

    /// The listing is a listing: names, kinds and two times off one `stat` each,
    /// and not one byte of any note.
    ///
    /// Which is the whole of why the file list can be on screen before anything
    /// else has happened, so it is worth a test that would fail the moment a field
    /// arrived here that had to be read out of a body - an icon, a title, a tag.
    /// A note whose bytes are not text is how that is said without stubbing a
    /// filesystem: every way Rust has of reading a file as a string fails on it, so
    /// a walk that lists it is a walk that did not open it. See `scan_links` in
    /// links.rs, which is where reading every note belongs.
    #[test]
    fn a_listing_reads_no_note() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        // A lone continuation byte, which is not valid UTF-8 anywhere in it.
        std::fs::write(here.join("Unreadable.md"), [0x80, 0x80, 0x80]).expect("a note");
        std::fs::write(here.join("Plain.md"), "icon: rocket\n").expect("a second note");

        let top = read(here, &options("name", false));

        assert_eq!(names(&top.children), ["Plain.md", "Unreadable.md"]);
        for child in &top.children {
            assert!(child.modified > 0, "{} has no time", child.name);
        }
    }

    /// A link pointing out of the space, which is the shape of every escape: a
    /// folder in the space whose real path is the home folder, the top of a disk,
    /// somebody else's space. The link is listed, because the reader made it and
    /// it is a folder; nothing under it is, because the tree says what is in this
    /// space and the rest of the machine is not in this space.
    #[test]
    fn a_link_out_of_the_space_is_not_read() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let space = dir.path().join("Space");
        let elsewhere = dir.path().join("Elsewhere");
        std::fs::create_dir_all(&space).expect("a space");
        std::fs::create_dir_all(elsewhere.join("Deeper")).expect("somewhere else");
        std::fs::write(elsewhere.join("Elsewhere.md"), "").expect("a note nobody asked for");
        std::fs::write(space.join("Idea.md"), "").expect("a note");

        assert!(link_to(&elsewhere, &space.join("out")), "a link out");

        let top = read(&space, &options("name", false));
        assert_eq!(names(&top.children), ["out", "Idea.md"]);

        let out = &top.children[0];
        assert!(out.is_dir, "a folder is what it is");
        assert!(out.children.is_empty(), "the walk left the space");
    }

    /// The tightest loop there is: a folder holding a link to itself. The link is
    /// in the space, so the walk is allowed to follow it, and it ends anyway
    /// because each folder is read once - which is the difference between a
    /// sidebar and a walk that never returns. See also
    /// `a_folder_already_read_is_read_as_empty`, which is the same loop one level
    /// up and twice over.
    #[test]
    fn a_folder_linked_to_itself_still_finishes() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");

        assert!(link_to(&inner, &inner.join("itself")), "a link to itself");

        let top = read(here, &options("name", false));
        let notes = &top.children[0];
        assert_eq!(names(&notes.children), ["itself"]);
        assert!(notes.children[0].children.is_empty(), "read twice");
    }

    /// A space larger than a tree is refused in words. Half a tree is the answer
    /// to avoid: the sidebar would look finished and be missing notes.
    #[test]
    fn a_space_larger_than_the_tree_says_so() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(here.join("Reading").join("Deep.md"), "").expect("a nested note");
        std::fs::write(here.join("Idea.md"), "").expect("a note");

        // The folder, the note inside it and the note beside it: three entries.
        let whole = tree_of(here, &options("name", false), 3).expect("a tree");
        assert_eq!(names(&whole.children), ["Reading", "Idea.md"]);

        // The number the refusal names is the real ceiling; this read was given a
        // smaller one so that the test is three files rather than a hundred
        // thousand.
        //
        // Taken apart by hand rather than with `expect_err`, which would want an
        // `Entry` it can print - and a tree of a space is not something to derive
        // `Debug` on for the sake of one line of one test.
        let Err(refused) = tree_of(here, &options("name", false), 2) else {
            panic!("a space larger than the tree was read anyway");
        };
        assert!(refused.contains("notes and folders"), "{refused}");
    }

    #[test]
    fn an_unknown_key_sorts_by_name() {
        let mut children = vec![entry("b.md", false, 9), entry("a.md", false, 1)];

        sort_children(&mut children, &options("", false));
        assert_eq!(names(&children), ["a.md", "b.md"]);
    }
}
