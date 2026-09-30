//! The spaces being watched: notify's watcher on every root, the events it hears
//! gathered until the folder is quiet, and each quiet moment settled into answers on a
//! thread of its own.
//!
//! notify's own debouncers were the obvious choice and neither fits. The full one
//! stitches a rename out of its two halves only when the platform names them as a rename,
//! and Windows names a move between two folders as a removal and an addition; it also
//! keeps a file-id cache of its own for macOS and Windows only. So the debouncing is
//! here, it is a few lines (`QUIET`, `LONGEST`), and the answers come from known.rs,
//! which reads the disk rather than the events.
//!
//! **Losing events.** Every platform can drop them under a burst: inotify's queue fills,
//! `FSEvents` says it coalesced too much, Windows' 16 KB buffer overflows. The first two
//! say so, as notify's rescan flag. Windows does not: notify's backend treats the
//! overflow as an unknown error and quietly stops watching the folder. So a burst larger
//! than a buffer's worth (`OVERFLOWING`) is treated as an overflow whether or not one was
//! reported: the root is watched again, read again, and the engine is told to list it
//! with `space_scan`. A `git checkout` of a few hundred notes costs one listing, which is
//! what it needs anyway.
//!
//! **A root that goes.** A space folder deleted or renamed in Explorer is not a space
//! whose every note was deleted, and the watcher must never say it is: Windows keeps
//! watching a renamed folder and reports its files under the old name, which would read
//! as every file gone. So a root that is no longer there is answered `gone` and nothing
//! else, and is no longer watched. Whether each root is still there is asked at every
//! batch and every `ROOT_CHECK` besides, because not every platform says anything when
//! the folder it watches is itself renamed: `FSEvents` watches a path, and the path is
//! simply quiet.

use notify::event::{AccessKind, AccessMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::known::{Seen, Space};

/// How long a space has to be quiet before what happened in it is settled.
const QUIET: Duration = Duration::from_millis(250);

/// How long a burst that never goes quiet waits at most before it is settled anyway, so
/// a long `git checkout` is heard as it goes rather than once at the end.
const LONGEST: Duration = Duration::from_secs(1);

/// The most answers one message to the window carries. A folder of a thousand notes
/// dropped into a space is two messages, not one of a thousand.
pub const MOST_CHANGES: usize = 500;

/// How many events on one root in one batch are treated as an overflow; see the top of
/// this file. Windows' 16 KB buffer holds a few hundred events of ordinary names.
const OVERFLOWING: usize = 256;

/// How often a quiet watch asks whether its roots are still there: one `stat` a root.
const ROOT_CHECK: Duration = Duration::from_secs(2);

/// How often an error from the watcher may make a root be listed again. An error is
/// usually a folder inotify could not add a watch for (past the system's limit), and it
/// comes back every time the root is watched again: a listing for every return would
/// never stop.
const FAILED_GAP: Duration = Duration::from_secs(60);

/// One space folder: as the window named it, which is how every answer names it back,
/// and as the file system resolves it, which is what macOS reports events under.
#[derive(Clone, Debug)]
pub struct Root {
    /// As the window named it.
    pub given: PathBuf,
    /// Every link along the way followed.
    pub real: PathBuf,
}

impl Root {
    /// Where a path the watcher reported is inside this root, if it is.
    fn inside(&self, path: &Path) -> Option<PathBuf> {
        path.strip_prefix(&self.real)
            .or_else(|_| path.strip_prefix(&self.given))
            .ok()
            .map(Path::to_path_buf)
    }
}

/// What happened in one space since the last message: the answers, and whether the
/// space has to be listed again (`scan`) or is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heard {
    /// Which root, by its place in the list the watch was started with.
    pub root: usize,
    /// What the touched paths came to.
    pub seen: Vec<Seen>,
    /// The watch on this root is fresh and knows what is there; list the space with
    /// `space_scan` to catch up on what happened before. Said once for every root when
    /// the watch starts, and again after an overflow.
    pub scan: bool,
    /// The root is not there any more and is no longer watched.
    pub gone: bool,
}

/// Where each message goes. False when nobody is listening any more, which stops the
/// watch.
pub type Sink = Box<dyn FnMut(Heard) -> bool + Send>;

/// A running watch. Dropping it stops it.
pub struct Watch {
    shared: Arc<Shared>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.shared.stop();
    }
}

/// Starts watching `roots`, answering into `sink`.
pub fn watch(roots: Vec<Root>, sink: Sink) -> Result<Watch, String> {
    let roots = Arc::new(roots);
    let shared = Arc::new(Shared::new(roots.len()));

    let heard = Arc::clone(&shared);
    let resolving = Arc::clone(&roots);
    let mut watcher = notify::recommended_watcher(move |event| heard.heard(&resolving, event))
        .map_err(|error| format!("could not watch the spaces: {error}"))?;
    for root in roots.iter() {
        watcher
            .watch(&root.real, RecursiveMode::Recursive)
            .map_err(|error| format!("could not watch {}: {error}", root.given.display()))?;
    }

    let working = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("nib space watch".into())
        .spawn(move || work(&roots, &working, watcher, sink))
        .map_err(|error| format!("could not start watching the spaces: {error}"))?;

    Ok(Watch { shared })
}

/// The thread every answer is settled on: learns each space, says so, then settles each
/// quiet moment until the watch is dropped or nobody listens.
fn work(roots: &[Root], shared: &Shared, mut watcher: RecommendedWatcher, mut sink: Sink) {
    let mut spaces: Vec<Option<Space>> = Vec::with_capacity(roots.len());
    for (at, root) in roots.iter().enumerate() {
        // A space too large to know is still watched; what arrives in it is new to the
        // watcher, and the engine's own listing is what says it is too large.
        spaces.push(Some(Space::read(&root.real).unwrap_or_default()));
        if shared.stopped() || !sink(Heard::scan(at)) {
            shared.stop();
            return;
        }
    }
    let mut released: Vec<BTreeSet<PathBuf>> = vec![BTreeSet::new(); roots.len()];
    let mut failed_at: Vec<Option<Instant>> = vec![None; roots.len()];

    while let Some(batch) = shared.next() {
        for (at, root) in roots.iter().enumerate() {
            let Some(space) = spaces[at].as_mut() else {
                continue;
            };
            let touched = &batch.touched[at];
            let failing =
                batch.failed[at] && failed_at[at].is_none_or(|when| when.elapsed() >= FAILED_GAP);
            if failing {
                failed_at[at] = Some(Instant::now());
            }

            let mut heard = Vec::new();
            if !root.real.is_dir() {
                let _ = watcher.unwatch(&root.real);
                spaces[at] = None;
                heard.push(Heard::gone(at));
            } else if touched.is_empty() && !batch.rescan[at] && !failing {
                continue;
            } else if batch.rescan[at] || failing || batch.raw[at] >= OVERFLOWING {
                // Watched again before it is read again, so nothing that happens in
                // between is missed: it is either in the reading or heard after it.
                let _ = watcher.unwatch(&root.real);
                let _ = watcher.watch(&root.real, RecursiveMode::Recursive);
                *space = Space::read(&root.real).unwrap_or_default();
                released[at].clear();
                heard.push(Heard::scan(at));
            } else {
                let (seen, held) = space.settle(&root.real, touched, batch.cut, &released[at]);
                shared.touch_again(at, &held);
                released[at] = held.into_iter().collect();
                heard.extend(seen.chunks(MOST_CHANGES).map(|some| Heard {
                    root: at,
                    seen: some.to_vec(),
                    scan: false,
                    gone: false,
                }));
            }

            for one in heard {
                // A watch replaced while this batch was settling says nothing more: its
                // listener may still be there, and would hear the same change twice.
                if shared.stopped() || !sink(one) {
                    shared.stop();
                    return;
                }
            }
        }
    }
}

impl Heard {
    fn scan(root: usize) -> Self {
        Self {
            root,
            seen: Vec::new(),
            scan: true,
            gone: false,
        }
    }

    fn gone(root: usize) -> Self {
        Self {
            root,
            seen: Vec::new(),
            scan: false,
            gone: true,
        }
    }
}

/// The roots a set of paths lies in, or every root where the paths name none.
fn named(roots: &[Root], paths: &[PathBuf]) -> Vec<usize> {
    let named: Vec<usize> = (0..roots.len())
        .filter(|at| paths.iter().any(|path| roots[*at].inside(path).is_some()))
        .collect();
    if named.is_empty() {
        (0..roots.len()).collect()
    } else {
        named
    }
}

/// What the watcher's callback and the settling thread share.
struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
}

/// Everything heard since the last batch was taken.
struct Queue {
    touched: Vec<BTreeSet<PathBuf>>,
    raw: Vec<usize>,
    rescan: Vec<bool>,
    failed: Vec<bool>,
    first: Option<Instant>,
    last: Option<Instant>,
    stopped: bool,
}

/// One batch, taken off the queue.
struct Batch {
    touched: Vec<BTreeSet<PathBuf>>,
    raw: Vec<usize>,
    rescan: Vec<bool>,
    /// The roots the watcher reported an error about.
    failed: Vec<bool>,
    /// Whether the burst was still going when the batch was taken.
    cut: bool,
}

impl Batch {
    /// Nothing happened: what a quiet watch settles every `ROOT_CHECK` to ask whether its
    /// roots are still there.
    fn quiet(roots: usize) -> Self {
        Self {
            touched: vec![BTreeSet::new(); roots],
            raw: vec![0; roots],
            rescan: vec![false; roots],
            failed: vec![false; roots],
            cut: false,
        }
    }
}

impl Shared {
    fn new(roots: usize) -> Self {
        Self {
            queue: Mutex::new(Queue {
                touched: vec![BTreeSet::new(); roots],
                raw: vec![0; roots],
                rescan: vec![false; roots],
                failed: vec![false; roots],
                first: None,
                last: None,
                stopped: false,
            }),
            wake: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Queue> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn stop(&self) {
        let mut queue = self.lock();
        queue.stopped = true;
        queue.touched.iter_mut().for_each(BTreeSet::clear);
        self.wake.notify_all();
    }

    fn stopped(&self) -> bool {
        self.lock().stopped
    }

    /// One event from notify: the paths it touched, by root, and whether it asked for a
    /// rescan. An error is a failure of the roots it names, or of every root where it
    /// names none; see `FAILED_GAP`.
    fn heard(&self, roots: &[Root], event: notify::Result<notify::Event>) {
        let mut queue = self.lock();
        if queue.stopped {
            return;
        }

        match event {
            Err(error) => {
                for at in named(roots, &error.paths) {
                    queue.failed[at] = true;
                }
            }
            Ok(event) => {
                // A file opened or read is nobody's writing; a file closed after a write
                // is, and is the moment inotify knows the write is whole.
                if matches!(
                    event.kind,
                    EventKind::Access(kind) if kind != AccessKind::Close(AccessMode::Write)
                ) {
                    return;
                }
                if event.need_rescan() {
                    for at in named(roots, &event.paths) {
                        queue.rescan[at] = true;
                    }
                }
                for path in &event.paths {
                    if let Some((at, rel)) = roots
                        .iter()
                        .enumerate()
                        .find_map(|(at, root)| root.inside(path).map(|rel| (at, rel)))
                    {
                        queue.touched[at].insert(rel);
                        queue.raw[at] += 1;
                    }
                }
            }
        }

        let now = Instant::now();
        queue.first.get_or_insert(now);
        queue.last = Some(now);
        self.wake.notify_one();
    }

    /// Paths whose removal is waiting for the next batch, touched again so there is one.
    fn touch_again(&self, root: usize, paths: &[PathBuf]) {
        if paths.is_empty() {
            return;
        }
        let mut queue = self.lock();
        queue.touched[root].extend(paths.iter().cloned());
        let now = Instant::now();
        queue.first.get_or_insert(now);
        queue.last.get_or_insert(now);
    }

    /// The next batch, once the spaces have been quiet for `QUIET` or a burst has gone
    /// on for `LONGEST`, or an empty one every `ROOT_CHECK` while nothing happens; None
    /// once the watch has stopped.
    fn next(&self) -> Option<Batch> {
        let mut queue = self.lock();
        loop {
            if queue.stopped {
                return None;
            }
            let (Some(first), Some(last)) = (queue.first, queue.last) else {
                let (waited, timed) = self
                    .wake
                    .wait_timeout(queue, ROOT_CHECK)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                queue = waited;
                if timed.timed_out() && queue.first.is_none() && !queue.stopped {
                    return Some(Batch::quiet(queue.touched.len()));
                }
                continue;
            };

            let now = Instant::now();
            let quiet = last + QUIET;
            let longest = first + LONGEST;
            if now >= quiet || now >= longest {
                let roots = queue.touched.len();
                let batch = Batch {
                    touched: std::mem::replace(&mut queue.touched, vec![BTreeSet::new(); roots]),
                    raw: std::mem::replace(&mut queue.raw, vec![0; roots]),
                    rescan: std::mem::replace(&mut queue.rescan, vec![false; roots]),
                    failed: std::mem::replace(&mut queue.failed, vec![false; roots]),
                    cut: now < quiet,
                };
                queue.first = None;
                queue.last = None;
                return Some(batch);
            }

            queue = self
                .wake
                .wait_timeout(queue, quiet.min(longest) - now)
                .map_or_else(|poisoned| poisoned.into_inner().0, |(queue, _)| queue);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{watch, Heard, Root, MOST_CHANGES};
    use crate::space_watch::known::Seen;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, Instant};

    /// Every message until the watch has been silent for a second and a half, or ten
    /// seconds have passed: long enough for a slow runner's watcher, short enough that a
    /// test that hears nothing ends.
    fn until_quiet(heard: &Receiver<Heard>) -> Vec<Heard> {
        let mut all = Vec::new();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(10) {
            match heard.recv_timeout(Duration::from_millis(1500)) {
                Ok(one) => all.push(one),
                Err(_) => break,
            }
        }
        all
    }

    fn said(heard: &[Heard]) -> Vec<String> {
        heard
            .iter()
            .flat_map(|one| one.seen.iter())
            .map(|one| match one {
                Seen::Created(to) => format!("created {}", slash(&to.rel)),
                Seen::Modified(to) => format!("modified {}", slash(&to.rel)),
                Seen::Removed { rel, .. } => format!("removed {}", slash(rel)),
                Seen::Renamed { from, to } => format!("renamed {} {}", slash(from), slash(&to.rel)),
            })
            .collect()
    }

    fn slash(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn watching(dir: &Path) -> (super::Watch, Receiver<Heard>) {
        let (tell, heard) = channel();
        let root = Root {
            given: dir.to_path_buf(),
            real: fs::canonicalize(dir).expect("a real path"),
        };
        let watch =
            watch(vec![root], Box::new(move |one| tell.send(one).is_ok())).expect("watching");
        (watch, heard)
    }

    /// The whole life of a note as another program lives it, one step at a time, each
    /// heard as what it was: made, written, renamed, moved into a folder, deleted.
    #[test]
    fn a_note_is_heard_through_its_whole_life() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::write(root.join("Plan.md"), "words").expect("a note");
        let (_watch, heard) = watching(root);

        let first = until_quiet(&heard);
        assert_eq!(first.len(), 1);
        assert!(first[0].scan, "the watch says it is ready to be caught up");

        fs::write(root.join("Idea.md"), "new").expect("made");
        assert_eq!(said(&until_quiet(&heard)), ["created Idea.md"]);

        fs::write(root.join("Idea.md"), "new, and longer").expect("written");
        assert_eq!(said(&until_quiet(&heard)), ["modified Idea.md"]);

        fs::rename(root.join("Idea.md"), root.join("Thought.md")).expect("renamed");
        assert_eq!(said(&until_quiet(&heard)), ["renamed Idea.md Thought.md"]);

        fs::create_dir(root.join("Box")).expect("a folder");
        assert_eq!(said(&until_quiet(&heard)), ["created Box"]);
        fs::rename(root.join("Thought.md"), root.join("Box").join("Thought.md")).expect("moved");
        let moved = until_quiet(&heard);
        assert_eq!(said(&moved), ["renamed Thought.md Box/Thought.md"]);

        fs::remove_file(root.join("Box").join("Thought.md")).expect("deleted");
        assert_eq!(said(&until_quiet(&heard)), ["removed Box/Thought.md"]);
    }

    /// A thousand files written as fast as the disk takes them: heard in a few
    /// messages of a bounded size rather than a thousand, and every one of them
    /// accounted for, either named or covered by a listing the watcher asks for.
    #[test]
    fn a_burst_is_heard_in_bounded_batches() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        let (_watch, heard) = watching(root);
        assert!(until_quiet(&heard)[0].scan);

        for at in 0..1000 {
            fs::write(root.join(format!("note-{at:04}.md")), format!("note {at}")).expect("a note");
        }
        let burst = until_quiet(&heard);

        assert!(burst.len() <= 12, "{} messages", burst.len());
        for one in &burst {
            assert!(
                one.seen.len() <= MOST_CHANGES,
                "{} in one message",
                one.seen.len()
            );
        }
        let named: Vec<PathBuf> = burst
            .iter()
            .flat_map(|one| one.seen.iter())
            .filter_map(|one| match one {
                Seen::Created(to) => Some(to.rel.clone()),
                _ => None,
            })
            .collect();
        let listed = burst.iter().any(|one| one.scan);
        assert!(
            listed || named.len() == 1000,
            "{} named, no listing",
            named.len()
        );
    }

    #[test]
    fn a_root_that_goes_is_gone_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path().join("Space");
        fs::create_dir_all(&root).expect("a space");
        fs::write(root.join("Plan.md"), "words").expect("a note");
        let (_watch, heard) = watching(&root);
        assert!(until_quiet(&heard)[0].scan);

        // Renamed in Explorer, and then written in: Windows goes on watching the folder
        // under its new name and reports the new file under the old one, which read off
        // the paths alone is a space whose note was deleted and another one made. macOS
        // says nothing at all, and the next look at the roots is what finds it gone.
        let renamed = dir.path().join("Renamed");
        fs::rename(&root, &renamed).expect("the space renamed");
        fs::write(renamed.join("Idea.md"), "new").expect("written in");

        let mut after = Vec::new();
        let started = Instant::now();
        while !after.iter().any(|one: &Heard| one.gone)
            && started.elapsed() < Duration::from_secs(10)
        {
            if let Ok(one) = heard.recv_timeout(Duration::from_millis(500)) {
                after.push(one);
            }
        }
        assert!(after.iter().all(|one| one.seen.is_empty()), "{after:?}");
        assert!(after.iter().any(|one| one.gone), "{after:?}");
    }
}
