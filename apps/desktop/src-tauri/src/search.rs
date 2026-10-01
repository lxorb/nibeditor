//! Looking through a whole space rather than at one note: the search behind
//! the search field, and the tag list the sidebar offers. Both read every note
//! in the space, so both walk it the same way.
//!
//! The query arrives already parsed, as the tree in query.rs, so a space of two
//! thousand notes is answered in one pass with every operator in hand rather
//! than in one pass per operator. What each note answers is worked out in
//! matcher.rs; this module is only the walk.
//!
//! Hits leave as they are found rather than at the end. A reader watching a
//! list fill is not waiting, and the disk is what a search spends its time on.
//!
//! Loose hits are the exception to that: a note the query does not answer is
//! guessed about instead, and a guess is worth showing in the order its score
//! puts it rather than in the order the disk handed it over. The scores are not
//! all in until the space has been read, so they go out with the last handful.
//! The scoring is in fuzzy.rs, and web/search.ts is the twin of this walk.
//!
//! The space itself is held between two searches. Reading five thousand files to
//! answer a word somebody has not finished typing is almost all of what a search
//! used to spend, and none of it was the search: the same bytes came off the disk
//! per keystroke. So a note read here stays here with the stamp the file had when
//! it was read, and a search asks the disk only what it cannot answer from that:
//! which files are now newer than what is held, and what is in those. A stamp
//! rather than a message from the window, because these files are not only the
//! app's - a sync, a script, a branch being checked out or another editor writes
//! them too, and one `stat` call catches all four where a notification catches
//! none. See `warm_search` below, and web/space-cache.ts, which holds the same
//! space in the browser's worker and hears about its rows instead.

use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use tauri::{AppHandle, Emitter};

use crate::fuzzy::{without_words, Fuzzy, FuzzyHit};
use crate::matcher::{Hit, Matcher, Note};
use crate::notes::{stamp_of, words_of, Stamp};
use crate::paths::{files_in, in_spaces, is_shortcut, relative_to};
use crate::query::Query;
use crate::tags::tags_in;

/// How much note text the crate holds, in bytes. The same ceiling the browser's
/// worker keeps, said in the unit a `String` is measured in: a space of five
/// thousand ordinary notes several times over, and tens of megabytes rather than
/// hundreds for a space somebody keeps a library in.
const CAP: usize = 24_000_000;

/// One note as it was read, and the stamp the file had when it was.
struct Kept {
    stamp: Stamp,
    /// Shared, so a search can take the words out of the cache and let the lock go
    /// before it starts matching against them.
    body: Arc<str>,
}

/// The space the searches are holding.
struct Warm {
    /// Which space was read whole, where one has been.
    root: Option<PathBuf>,
    notes: HashMap<PathBuf, Kept>,
    /// The same notes by size, the largest first, which is the order the cap lets
    /// them go in; see `hold`.
    by_size: BTreeSet<(Reverse<usize>, PathBuf)>,
    /// How many notes that space had when it was last read whole.
    of: usize,
    characters: usize,
    dropped: usize,
    read: usize,
    whole: bool,
    /// What it is held to. `CAP` everywhere but in the tests below, which would
    /// otherwise have to build twenty-four megabytes of notes to cross it.
    cap: usize,
}

impl Default for Warm {
    fn default() -> Self {
        Self {
            root: None,
            notes: HashMap::new(),
            by_size: BTreeSet::new(),
            of: 0,
            characters: 0,
            dropped: 0,
            read: 0,
            whole: false,
            cap: CAP,
        }
    }
}

/// What the search is holding, as the window reads it. The twin of `Warmth` in
/// search/warmth.ts, field for field, so one line of diagnostics says the same
/// thing on both builds.
#[derive(Serialize)]
pub struct Warmth {
    /// Notes held with their words.
    notes: usize,
    /// Notes the space has, whether they are held or not.
    of: usize,
    /// Bytes of note text held, which for the notes people write is the same
    /// number as characters.
    characters: usize,
    /// The most it will hold.
    cap: usize,
    /// Notes the cap has pushed out since the space was opened.
    dropped: usize,
    /// Notes read off the disk since then: the space once, and after that only the
    /// ones that changed.
    read: usize,
    /// Whether a whole pass over the space has finished.
    warm: bool,
}

impl Warm {
    /// One note into the cache, replacing whatever was held under its path.
    fn keep(&mut self, path: &Path, stamp: Stamp, body: &Arc<str>) {
        if let Some(was) = self.notes.insert(
            path.to_path_buf(),
            Kept {
                stamp,
                body: Arc::clone(body),
            },
        ) {
            self.characters = self.characters.saturating_sub(was.body.len());
            self.by_size
                .remove(&(Reverse(was.body.len()), path.to_path_buf()));
        }

        self.characters += body.len();
        self.by_size
            .insert((Reverse(body.len()), path.to_path_buf()));
        self.hold();
    }

    /// Held to the cap, the largest notes first: one long note costs what a
    /// hundred ordinary ones cost, so letting it go buys the most room for the
    /// fewest notes read again. One that was let go is read again the next time a
    /// search reaches it.
    ///
    /// Off an index kept in that order rather than a sort of everything held. The
    /// sort ran once for every note read past the cap, which is every note a search
    /// reads again in a space larger than the cap, so a search there cost the
    /// square of the space rather than the space.
    fn hold(&mut self) {
        while self.characters > self.cap {
            let Some((Reverse(len), path)) = self.by_size.pop_first() else {
                return;
            };
            if self.notes.remove(&path).is_some() {
                self.characters = self.characters.saturating_sub(len);
                self.dropped += 1;
            }
        }
    }

    fn warmth(&self) -> Warmth {
        Warmth {
            notes: self.notes.len(),
            of: self.of.max(self.notes.len()),
            characters: self.characters,
            cap: self.cap,
            dropped: self.dropped,
            read: self.read,
            warm: self.whole,
        }
    }
}

fn cache() -> &'static Mutex<Warm> {
    static WARM: OnceLock<Mutex<Warm>> = OnceLock::new();
    WARM.get_or_init(|| Mutex::new(Warm::default()))
}

/// The cache, however it was left. A panic while a note was being written into it
/// must not take every later search with it: what is held is a copy of what is on
/// disk, and the worst a poisoned one holds is a note that will be read again.
fn held() -> MutexGuard<'static, Warm> {
    cache().lock().unwrap_or_else(PoisonError::into_inner)
}

/// The words of one note: from the cache when the file on disk is still the file
/// that was read, and off the disk when it is not.
///
/// Nothing is held while the file is being read, because that is the slow part and
/// a second search should not wait behind it. The stamp is taken before the read
/// rather than after, so a file written while it was being read comes back as
/// changed on the next search rather than being trusted as current.
fn body_of(path: &Path) -> Option<Arc<str>> {
    let stamp = stamp_of(path)?;

    {
        let warm = held();
        // The file on disk is the authority: what is held answers only while the
        // stamp it was read at is still the stamp the file has.
        if let Some(kept) = warm.notes.get(path).filter(|kept| kept.stamp == stamp) {
            return Some(Arc::clone(&kept.body));
        }
    }

    // A note that cannot be read is not a search failure: the rest of the space
    // still has answers. Nor is a file too large to be a note, which is left out
    // rather than read whole; see `MOST_NOTE_BYTES`.
    let body: Arc<str> = Arc::from(words_of(path).ok()?);

    let mut warm = held();
    warm.read += 1;
    warm.keep(path, stamp, &body);
    Some(body)
}

/// Reads a space and keeps it, so that the keystroke after this reads nothing.
///
/// Asked for at the search stage of the launch, which is after the file list is on
/// screen and after the link index has had its turn; see startup.svelte.ts and
/// search/warm.svelte.ts. One space at a time, the way the browser's worker holds
/// one: another space's notes are memory nobody is about to ask about.
#[tauri::command(async)]
pub fn warm_search(app: AppHandle, root: String) -> Result<Warmth, String> {
    let dir = in_spaces(&app, &root)?;
    let paths = notes_in(&dir);

    {
        let mut warm = held();
        if warm.root.as_deref() != Some(dir.as_path()) {
            *warm = Warm::default();
            warm.root = Some(dir);
        }
        warm.of = paths.len();
        warm.whole = false;
    }

    // A note that cannot be read is one the search will not answer about, which is
    // the walk's own rule; nothing here is worth failing the warm pass over.
    for path in &paths {
        let _ = body_of(path);
    }

    let mut warm = held();
    warm.whole = true;
    Ok(warm.warmth())
}

/// How many hits are worth sending at once. Small enough that the first rows
/// are on screen while the rest of the space is still being read, large enough
/// that a space full of matches is not one message per line.
const BATCH: usize = 24;

/// What the window listens on while a search is running.
const HITS: &str = "nib://search-hits";

/// A tag and how often the space uses it.
#[derive(Serialize)]
pub struct Tag {
    tag: String,
    count: usize,
}

/// One handful of hits, marked with the search that asked for them. Typing
/// outruns the disk, and answers to a word that is no longer in the field are
/// dropped by the window rather than shown.
#[derive(Serialize, Clone)]
struct Batch {
    id: u32,
    /// Hits that answer the query as asked, in the order the notes were read.
    hits: Vec<Hit>,
    /// Notes that answer it only loosely, each with its best line and a score,
    /// highest first. Only ever in the last handful.
    loose: Vec<FuzzyHit>,
}

/// Searches every note in a space, sending hits to the window as they are
/// found. Stops at `limit` of them, which is what keeps a one-letter query
/// from answering with the whole space.
///
/// `terms` are the query's bare words, to be matched loosely against notes the
/// query itself does not answer; empty when the query is not one to relax. The
/// app works them out, because the browser build needs them in front of the
/// bridge anyway; see fuzzy.rs for the rule they follow.
///
/// `excluded` are the notes and folders the space leaves out, relative to it. They
/// are skipped before the file is read, which is the whole point of leaving one
/// out: an archive of two thousand notes should cost a search nothing rather than
/// cost it a read and then a filter.
#[tauri::command(async)]
pub fn search_space(
    app: AppHandle,
    root: String,
    query: Query,
    terms: Vec<String>,
    limit: usize,
    id: u32,
    excluded: Vec<String>,
) -> Result<(), String> {
    let dir = in_spaces(&app, &root)?;
    let left: HashSet<&str> = excluded.iter().map(String::as_str).collect();
    let fuzzy = Fuzzy::new(&terms);
    // What a note has to answer before its lines are worth guessing about: the
    // query with its bare words taken out. A query of nothing but words leaves
    // nothing to answer, which every note does. Read before the exact matcher
    // takes the query for itself.
    let narrowed = fuzzy.asks().then(|| Matcher::new(without_words(&query)));
    let matcher = Matcher::new(query);

    let mut pending: Vec<Hit> = Vec::new();
    let mut loose: Vec<FuzzyHit> = Vec::new();
    let mut found = 0;

    for path in notes_in(&dir) {
        if found >= limit {
            break;
        }

        let relative = relative_to(&dir, &path);
        if left_out(&relative, &left) {
            continue;
        }

        // From what the crate is holding, and off the disk only for a file that
        // has changed since it was read; see `body_of`.
        let Some(body) = body_of(&path) else {
            continue;
        };

        let shown = path.to_string_lossy();
        let name = path
            .file_name()
            .map_or_else(String::new, |one| one.to_string_lossy().to_string());

        let note = Note::new(&shown, &relative, &name, &body);

        let mut hits = matcher.hits(&note, limit.saturating_sub(found));
        if !hits.is_empty() {
            found += hits.len();
            pending.append(&mut hits);

            if pending.len() >= BATCH {
                send(&app, id, &mut pending, Vec::new());
            }
            continue;
        }

        // Only a note the query does not answer is worth guessing about, which
        // is also what keeps the loose pass off every note that already has a
        // row. It still has to sit where `path:` and its kind said it does.
        let Some(narrowed) = narrowed.as_ref() else {
            continue;
        };
        if narrowed.hits(&note, 1).is_empty() {
            continue;
        }

        if let Some(guess) = fuzzy.best(&note) {
            loose.push(guess);
        }

        // Kept to the best of them as the walk goes, so a space where everything
        // matches loosely does not become a list of the whole space. Trimmed at
        // twice the limit rather than at it, so the sort happens once in a while
        // rather than once a note. Saturating, because the limit crosses from the
        // window and doubling one near the top of a `usize` would wrap.
        if loose.len() > limit.saturating_mul(2) {
            loose = best(loose, limit);
        }
    }

    send(&app, id, &mut pending, best(loose, limit));
    Ok(())
}

/// The `most` best-scoring of them, highest first.
fn best(mut loose: Vec<FuzzyHit>, most: usize) -> Vec<FuzzyHit> {
    loose.sort_by_key(|hit| Reverse(hit.score()));
    loose.truncate(most);
    loose
}

/// Hands whatever has been found to the window. A window that has gone is not
/// a search failure, so a send that fails is let go.
fn send(app: &AppHandle, id: u32, pending: &mut Vec<Hit>, loose: Vec<FuzzyHit>) {
    if pending.is_empty() && loose.is_empty() {
        return;
    }

    let _ = app.emit(
        HITS,
        Batch {
            id,
            hits: std::mem::take(pending),
            loose,
        },
    );
}

/// Every `#tag` used in a space, most-used first.
///
/// Nothing in the app asks any more: the tag tree is built from the link index,
/// which already holds each note's tags from the one pass that reads the space.
/// The contract there is not this one - the number beside a tag is the notes
/// carrying it, deduped and folded, rather than the uses of it, and the spelling
/// is folded too. This still counts uses and keeps the spelling. Bringing the two
/// together, or taking this away, is a follow-up; see `tagCounts` in
/// link-index.svelte.ts and `spaceTags` in web/commands.ts, which carries the same
/// note.
#[tauri::command(async)]
pub fn space_tags(app: AppHandle, root: String) -> Result<Vec<Tag>, String> {
    let dir = in_spaces(&app, &root)?;
    let mut counts: HashMap<String, usize> = HashMap::new();

    for path in notes_in(&dir) {
        // The same notes the search is holding: a space read for its tags is a
        // space the next search does not have to read, and the other way round.
        let Some(body) = body_of(&path) else {
            continue;
        };

        for tag in tags_in(&body) {
            *counts.entry(tag).or_default() += 1;
        }
    }

    let mut tags: Vec<Tag> = counts
        .into_iter()
        .map(|(tag, count)| Tag { tag, count })
        .collect();

    // Most used first, and alphabetical within a count so the list holds still.
    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    Ok(tags)
}

/// Whether a note is one the space leaves out: the path itself, or something
/// inside a folder that is.
///
/// Asked of the note's own ancestors rather than of the list, so leaving things out
/// costs a handful of lookups per note however long the list is. The twin of
/// `leftOut` in web/search.ts and of `has` in workspace/excluded.svelte.ts.
fn left_out(relative: &str, excluded: &HashSet<&str>) -> bool {
    if excluded.is_empty() {
        return false;
    }
    if excluded.contains(relative) {
        return true;
    }

    let mut at = relative.len();
    while let Some(cut) = relative.get(..at).and_then(|part| part.rfind('/')) {
        if cut == 0 {
            break;
        }
        if excluded.contains(&relative[..cut]) {
            return true;
        }
        at = cut;
    }

    false
}

/// Every note in a space, in a stable order so two searches of an unchanged
/// space read the same. The walk itself lives in `paths`, which is also where
/// `links` gets it from.
fn notes_in(dir: &Path) -> Vec<PathBuf> {
    let (mut notes, others) = files_in(dir);

    // The websites as well. A shortcut is three lines of text with an address in
    // one of them, so a search for a site by its address is a search for the words
    // in that file and needs nothing here to know what the format is; its title is
    // its name, which the file search already reads. See web-tab/shortcut.ts.
    notes.extend(others.into_iter().filter(|path| is_shortcut(path)));
    notes.sort();
    notes
}

#[cfg(test)]
mod tests {
    // A test module is its own scope: everything it touches is named here rather
    // than borrowed from the module above.
    use super::{body_of, held, left_out, Warm};
    use crate::notes::{Stamp, MOST_NOTE_BYTES};
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;

    fn words(of: usize) -> Arc<str> {
        Arc::from("ink ".repeat(of).as_str())
    }

    fn stamp(len: u64) -> Stamp {
        Stamp { modified: 1, len }
    }

    #[test]
    fn what_is_held_is_counted_once_per_note() {
        let mut warm = Warm::default();
        let plan = Path::new("Plan.md");

        warm.keep(plan, stamp(8), &words(2));
        assert_eq!(warm.notes.len(), 1);
        assert_eq!(warm.characters, 8);

        // The same note again is the same note, not a second one.
        warm.keep(plan, stamp(16), &words(4));
        assert_eq!(warm.notes.len(), 1);
        assert_eq!(warm.characters, 16);
    }

    #[test]
    fn the_cap_lets_the_largest_notes_go_first() {
        // The cap given at the start rather than assigned after, which is what
        // `Default` is for: a field written over a fresh default is the same value
        // twice and clippy says so.
        let mut warm = Warm {
            cap: 100,
            ..Warm::default()
        };

        warm.keep(Path::new("Plan.md"), stamp(20), &words(5));
        warm.keep(Path::new("Ink.md"), stamp(20), &words(5));
        assert_eq!(warm.notes.len(), 2);
        assert_eq!(warm.dropped, 0);

        // A novel, which on its own is more than the cap: it goes, and the two
        // short notes stay.
        warm.keep(Path::new("Novel.md"), stamp(400), &words(100));
        assert_eq!(warm.dropped, 1);
        assert!(warm.characters <= warm.cap);
        assert!(!warm.notes.contains_key(Path::new("Novel.md")));
        assert!(warm.notes.contains_key(Path::new("Plan.md")));
    }

    /// A note written again is held at its new size, and the cap judges it by that
    /// size rather than by the one it was first read at.
    #[test]
    fn a_note_rewritten_is_held_at_its_new_size() {
        let mut warm = Warm {
            cap: 100,
            ..Warm::default()
        };

        warm.keep(Path::new("Draft.md"), stamp(80), &words(20));
        warm.keep(Path::new("Draft.md"), stamp(8), &words(2));
        warm.keep(Path::new("Plan.md"), stamp(60), &words(15));

        assert_eq!(warm.characters, 68);
        assert_eq!(warm.dropped, 0);

        // Past the cap, the largest goes - which is Plan now, not Draft.
        warm.keep(Path::new("Ink.md"), stamp(40), &words(10));
        assert_eq!(warm.dropped, 1);
        assert!(!warm.notes.contains_key(Path::new("Plan.md")));
        assert!(warm.notes.contains_key(Path::new("Draft.md")));
        assert_eq!(warm.characters, 48);
    }

    /// The one test that touches the cache the searches share, so that nothing
    /// else here has to run after it.
    #[test]
    fn a_note_is_read_once_and_held_until_the_file_changes() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Plan.md");
        fs::write(&note, "the quarter plan").expect("the note written");

        let first = body_of(&note).expect("the words");
        assert_eq!(&*first, "the quarter plan");
        let read = held().read;

        // Asked again with the file untouched: the same words, and nothing read.
        assert_eq!(&*body_of(&note).expect("the words"), "the quarter plan");
        assert_eq!(held().read, read);

        // Written again, and what comes back is what was written. The length is
        // part of the stamp, so this is caught however coarse the clock is.
        fs::write(&note, "the quarter plan, rewritten").expect("the rewrite");
        assert_eq!(
            &*body_of(&note).expect("the words"),
            "the quarter plan, rewritten"
        );
        assert_eq!(held().read, read + 1);

        // And a note that is not there is not an error to report.
        fs::remove_file(&note).expect("the note removed");
        assert!(body_of(&note).is_none());

        // Nor is a file too large to be a note, which is skipped without a byte of it
        // read: a search that read it whole is an app that could not hold it. Sparse,
        // so the test writes nothing.
        let huge = dir.path().join("Dump.md");
        fs::File::create(&huge)
            .and_then(|file| file.set_len(MOST_NOTE_BYTES + 1))
            .expect("a file past the ceiling");
        assert!(body_of(&huge).is_none());
        assert_eq!(held().read, read + 1, "the file was read");
    }

    #[test]
    fn a_space_leaves_out_a_note_and_everything_in_a_folder_it_leaves_out() {
        let left: HashSet<&str> = ["Archive", "Old/Plan.md"].into_iter().collect();

        assert!(left_out("Archive", &left));
        assert!(left_out("Archive/Deep/Note.md", &left));
        assert!(left_out("Old/Plan.md", &left));
        assert!(!left_out("Old", &left));
        assert!(!left_out("Archived.md", &left));
        assert!(!left_out("Plan.md", &HashSet::new()));
    }
}
