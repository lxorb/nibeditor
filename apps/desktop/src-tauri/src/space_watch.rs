//! The space folders, watched for what other programs write into them: git, Obsidian, a
//! text editor, a file dragged in from Explorer. With nib opening nothing outside a space,
//! this is the one road a foreign edit takes into sync (docs/sync-v2.md section 5.5).
//!
//! Four commands. `space_watch` watches every space root and streams what happened in
//! each quiet moment to the window: created, modified, removed and renamed, each with the
//! path, the size, the time and the file's identity (see `space_watch/identity.rs`), which
//! is what makes a rename in Explorer a rename rather than a note deleted and a stranger
//! made. `space_scan` lists a space the same way, streamed in chunks, for the engine to
//! catch up with once a launch and whenever the watcher says it lost track. `space_unwatch`
//! stops. `file_identity` answers one path's identity.
//!
//! Everything is reported, nib's own writes included: the engine knows what it wrote
//! (the store's `written_hash`), and a watcher that guessed which writes were whose would
//! guess wrong the one time two programs wrote at once.
//!
//! The same judges as every other command: a root is `a_space`, a path is `in_spaces`,
//! and the walk keeps to the bounds and the hidden-name rule of the file tree; see
//! `space_watch/walk.rs`.

mod identity;
mod known;
mod walk;
mod watching;

use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::paths::{a_space, cannot, in_spaces};
use crate::tree::MAX_ENTRIES;
use known::Seen;
use walk::Found;
use watching::{watch, Heard, Root, Watch, MOST_CHANGES};

/// The watch that is running, if one is.
#[derive(Default)]
pub struct Watching(Mutex<Option<Watch>>);

impl Watching {
    fn lock(&self) -> MutexGuard<'_, Option<Watch>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// One file or folder as the window is told about it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    /// Where it is, spelled the way the root was given.
    path: String,
    /// Whether it is a folder.
    dir: bool,
    /// Its size in bytes, 0 for a folder.
    size: u64,
    /// When it was last written, in milliseconds since the epoch.
    mtime: u64,
    /// What it is apart from where it is, or null where the file system would not say.
    id: Option<String>,
}

/// One answer about one path.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Change {
    /// New; a new folder's contents follow it, each created too.
    Created(Listed),
    /// Written again, or replaced by another file under the same name.
    Modified(Listed),
    /// Gone, with what it was.
    Removed {
        /// Where it was.
        path: String,
        /// Whether it was a folder.
        dir: bool,
        /// Its identity, for matching against what the engine keeps.
        id: Option<String>,
    },
    /// Moved or renamed. A folder is one answer for everything in it.
    Renamed {
        /// Where it was.
        from: String,
        /// Where it is now, and what it is.
        #[serde(flatten)]
        to: Listed,
    },
}

/// What happened in one space since the last message.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct News {
    /// The space, spelled as `space_watch` was given it.
    root: String,
    /// What happened, in the order to apply it; at most `MOST_CHANGES`.
    changes: Vec<Change>,
    /// The watch knows this space afresh; list it with `space_scan` to catch up. Said
    /// once for every space as the watch starts, and after the watcher lost events.
    scan: bool,
    /// The folder is not there any more (deleted, or renamed outside nib) and is no
    /// longer watched. Never a reason to delete anything.
    gone: bool,
}

/// One chunk of a listing. The last one says `done`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// Up to `MOST_CHANGES` files and folders, each folder before what is in it.
    listed: Vec<Listed>,
    /// Whether this is the end of the listing.
    done: bool,
}

fn listed(root: &Path, one: Found) -> Listed {
    Listed {
        path: spelled(root, &one.rel),
        dir: one.dir,
        size: one.size,
        mtime: one.mtime,
        id: one.id,
    }
}

fn spelled(root: &Path, rel: &Path) -> String {
    root.join(rel).to_string_lossy().into_owned()
}

fn change(root: &Path, seen: Seen) -> Change {
    match seen {
        Seen::Created(one) => Change::Created(listed(root, one)),
        Seen::Modified(one) => Change::Modified(listed(root, one)),
        Seen::Removed { rel, dir, id } => Change::Removed {
            path: spelled(root, &rel),
            dir,
            id,
        },
        Seen::Renamed { from, to } => Change::Renamed {
            from: spelled(root, &from),
            to: listed(root, to),
        },
    }
}

fn news(roots: &[Root], heard: Heard) -> News {
    let root = &roots[heard.root].given;
    News {
        root: root.to_string_lossy().into_owned(),
        changes: heard
            .seen
            .into_iter()
            .map(|one| change(root, one))
            .collect(),
        scan: heard.scan,
        gone: heard.gone,
    }
}

/// A root the window named, judged: a space, and a folder that is there.
fn judged_root(app: &AppHandle, root: &str) -> Result<Root, String> {
    let given = a_space(app, root)?;
    let real = std::fs::canonicalize(&given).map_err(|error| cannot("watch", &given, &error))?;
    if !real.is_dir() {
        return Err(format!("{root} is not a folder"));
    }
    Ok(Root { given, real })
}

/// Watches every space in `roots` and streams what happens in them to `news`, one
/// message per space per quiet moment. Replaces whatever watch was running; an empty
/// list stops it.
#[tauri::command(async)]
pub fn space_watch(app: AppHandle, roots: Vec<String>, news: Channel<News>) -> Result<(), String> {
    let judged = roots
        .iter()
        .map(|root| judged_root(&app, root))
        .collect::<Result<Vec<_>, _>>()?;

    let watching = app.state::<Watching>();
    let mut running = watching.lock();
    // The old one stops before the new one starts, so no space is ever watched twice.
    *running = None;
    if judged.is_empty() {
        return Ok(());
    }

    let spelled = judged.clone();
    *running = Some(watch(
        judged,
        Box::new(move |heard| news.send(self::news(&spelled, heard)).is_ok()),
    )?);
    Ok(())
}

/// Stops watching.
#[tauri::command(async)]
pub fn space_unwatch(app: AppHandle) {
    *app.state::<Watching>().lock() = None;
}

/// Lists everything in a space, streamed to `listing` in chunks, the last one `done`.
/// Refuses a space larger than `MAX_ENTRIES`, after whatever it had already sent.
#[tauri::command(async)]
pub fn space_scan(app: AppHandle, root: String, listing: Channel<Listing>) -> Result<(), String> {
    let root = judged_root(&app, &root)?;
    let mut chunk = Vec::with_capacity(MOST_CHANGES);
    let mut left = MAX_ENTRIES;
    let mut sent = Ok(());

    walk::walk(&root.real, Path::new(""), &mut left, &mut |one| {
        chunk.push(listed(&root.given, one));
        if chunk.len() == MOST_CHANGES && sent.is_ok() {
            let full = std::mem::replace(&mut chunk, Vec::with_capacity(MOST_CHANGES));
            sent = listing.send(Listing {
                listed: full,
                done: false,
            });
        }
    })?;
    sent.map_err(|error| error.to_string())?;

    listing
        .send(Listing {
            listed: chunk,
            done: true,
        })
        .map_err(|error| error.to_string())
}

/// The identity of the file or folder at `path` in a space, or null when nothing is
/// there: what the engine asks when it has to tell a rename from a new note itself.
#[tauri::command(async)]
pub fn file_identity(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(identity::identity(&in_spaces(&app, &path)?))
}

#[cfg(test)]
mod tests {
    use super::{change, Change, Listed};
    use crate::space_watch::known::Seen;
    use crate::space_watch::walk::Found;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    /// The shapes the window reads, word for word: `src/lib/space-watch.ts` checks
    /// these and nothing else.
    #[test]
    fn what_the_window_is_told() {
        let root = Path::new("/spaces/Work");
        let found = |rel: &str| Found {
            rel: PathBuf::from(rel),
            dir: false,
            size: 5,
            mtime: 1_700_000_000_000,
            id: Some("2a:1f".into()),
        };

        let renamed = change(
            root,
            Seen::Renamed {
                from: PathBuf::from("Old.md"),
                to: found("New.md"),
            },
        );
        let spelled = |rel: &str| root.join(rel).to_string_lossy().into_owned();
        assert_eq!(
            serde_json::to_value(&renamed).expect("json"),
            json!({ "kind": "renamed", "from": spelled("Old.md"), "path": spelled("New.md"),
                    "dir": false, "size": 5, "mtime": 1_700_000_000_000_u64, "id": "2a:1f" })
        );

        let removed = change(
            root,
            Seen::Removed {
                rel: PathBuf::from("Gone"),
                dir: true,
                id: None,
            },
        );
        assert_eq!(
            serde_json::to_value(&removed).expect("json"),
            json!({ "kind": "removed", "path": spelled("Gone"), "dir": true, "id": null })
        );

        let created = Change::Created(Listed {
            path: "p".into(),
            dir: false,
            size: 0,
            mtime: 0,
            id: None,
        });
        assert_eq!(
            serde_json::to_value(&created).expect("json")["kind"],
            "created"
        );
    }
}
