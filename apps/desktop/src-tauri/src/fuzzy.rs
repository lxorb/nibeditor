//! Matching a query loosely: the letters in order but not next to each other,
//! so a typo or a half-remembered word still finds the line.
//!
//! A term is matched against one line rather than against a whole note. Letters
//! gathered from across a megabyte are not a match anybody meant, and a line is
//! also what the panel shows, so the span that scored is the span it emphasises.
//!
//! The score is fzf's shape: a run of letters next to each other is worth much
//! more than the same letters apart, a letter that opens a word is worth more
//! than one inside it, and a gap costs. Which of the several ways a term fits a
//! line is the one that counts is settled by trying each place its first letter
//! sits and keeping the best, so `rdm` prefers `read me` to `nerd model`.
//!
//! search/fuzzy.ts is the twin of this, down to the cases its tests use. The
//! desktop's notes are on disk behind this crate and the browser's are in front
//! of it, so the scan has to live at both ends: two files that score the same
//! way are the price of not sending a space of notes across the bridge on every
//! keystroke.
//!
//! Nothing here allocates per line. A note is folded once and then read through
//! offsets, and the arrays a line needs belong to the note and are reused down
//! it, because a space of ten thousand notes is fifty megabytes and a string per
//! line of it is the whole budget.
//!
//! Offsets are bytes, the way matcher.rs counts them, because that is what a
//! `str` is indexed by. Only what leaves is counted otherwise: a range inside a
//! shown line is in UTF-16 units, which is how the app measures the string it is
//! handed.
//!
//! What it costs, over 10,000 notes and 47.6 MB held in memory, release build,
//! best of five, on the machine this was written on. `before` is with the two
//! passes each folding the note and the matcher indexing every note's lines
//! whether or not it answered; `now` is with one fold shared between them and
//! the lines indexed only once something has matched. See `Note::folded` and
//! `Facts::starts` in matcher.rs.
//!
//! | | before | now |
//! | --- | --- | --- |
//! | the exact pass alone, a word every note holds | 83 ms | 77 ms |
//! | the exact pass alone, a typo no note holds | 71 ms | 49 ms |
//! | the exact pass alone, a word no note holds | 70 ms | 47 ms |
//! | one loose term, every note answering | 165 ms | 104 ms |
//! | two loose terms | 189 ms | 126 ms |
//! | a loose term nothing holds | 104 ms | 50 ms |
//!
//! The one loose term with every note answering is the worst there is: every
//! note in the space is a near miss, so every line of all fifty megabytes is
//! walked and every note comes back with a row to build. A query that does not
//! nearly match everything is the 50 ms row. What is left is almost all the one
//! fold: lowercasing fifty megabytes is a copy of the space, and both passes now
//! read the same one.
//!
//! The browser's twin does the same, in search/fuzzy.ts, and comes out at 92 ms
//! for the exact pass and 129 ms for one loose term on the same corpus. Sharing
//! the fold is worth less there and sits inside the run-to-run spread: V8's
//! lowercase is a good deal quicker than a fresh `String` per note, and the
//! browser side never had the eager line index to lose. It is written the same
//! way regardless, because the two are twins and a difference nobody meant is
//! how they stop being.

use serde::Serialize;

use crate::matcher::{fold, utf16_at, Note, Range};
use crate::query::Query;

/// What a matched letter is worth before any bonus, which is fzf's own base. It
/// keeps a real match's score above zero, so a list cut short reads as the best
/// of what was found rather than as a column of minus signs.
const LETTER: i32 = 16;

/// A letter next to the one before it. The big bonus, and deliberately worth
/// more than a word start: a term found whole in one word has to beat the same
/// letters picked one from each of six words, or `quater plan` would rank
/// `q u a t e r and a plan` alongside `The quarter plan`.
const RUN: i32 = 12;

/// A letter that opens a word. What lets initials work: `rdm` finds `read me` by
/// its word starts rather than by three letters in a row.
const START: i32 = 8;

/// What the term's own first letter's word start is multiplied by, the way fzf
/// weighs it, because where a term begins says more about the line than where it
/// goes on.
const FIRST: i32 = 2;

/// What the first missing letter of a gap costs. Two rates rather than one, so a
/// term broken in two places is worse than a term broken once by twice as much:
/// fzf's weighting, and the reason `meting` finds `Meeting` rather than losing to
/// a line that merely holds the letters.
const GAP: i32 = 3;

/// What each missing letter after the first of a gap costs.
const GAP_ON: i32 = 1;

/// Past this a gap is as bad as it gets. Without a floor a match near the end of
/// a long line would score worse than one that is not a match at all.
const WORST: usize = 12;

/// What ends a word, so the letter after it opens one. A newline is here because
/// offsets are into the whole note: the first letter of a line opens a word like
/// the first letter of the note does.
const BOUNDARY: [char; 20] = [
    '\n', '\r', ' ', '\t', '/', '\\', '_', '-', '.', ',', ':', ';', '(', '[', '{', '#', '*', '>',
    '"', '\'',
];

/// How many of a line's letters are worth scoring. A line longer than this is a
/// paragraph nobody wrapped, and the letters at its far end are not what the reader
/// is pointing at. The panel cuts its preview at `SHOWN` for the same reason; this
/// is wider, so a match just past the preview is still found.
///
/// Letters rather than bytes, which is why the unit is said out loud: `SHOWN` is
/// letters, so a cut counted in bytes is only as wide as it claims in ASCII.
const SCORED: usize = 400;

/// How many of a matching line's letters a row shows. The same cut the exact side
/// makes, so two rows of one list are trimmed the same way.
const SHOWN: usize = 200;

/// One term, folded, as the walk reads it.
struct Word {
    /// The letters, looked for one at a time.
    letters: Vec<char>,
    /// The first of them, which is where every attempt at a fit starts and what
    /// the cursor down a note follows.
    head: char,
}

/// Where one match sits in the text it was found in, in bytes.
struct Span {
    from: usize,
    to: usize,
}

/// The best a term did on a line: what it scored, and where its first letter
/// next sits after the place that scored.
struct Fit {
    score: i32,
    /// None when the letter is gone from the rest of the text, which is what
    /// tells the caller no later line can hold the term either.
    next: Option<usize>,
}

/// A term as the letters the walk looks for, folded. Cut up once rather than per
/// walk, and empty when the term was.
fn letters_of(term: &str) -> Vec<char> {
    fold(term).chars().collect()
}

/// The letter at a byte offset, or None past the end of the text.
fn letter_at(body: &str, at: usize) -> Option<char> {
    body.get(at..).and_then(|rest| rest.chars().next())
}

/// The letter before a byte offset, or None at the very start.
fn letter_before(body: &str, at: usize) -> Option<char> {
    body.get(..at).and_then(|head| head.chars().next_back())
}

/// Whether `letter` is one with a small and a capital form, and is the small one.
/// Reading the pair rather than a range, so it holds outside ASCII.
fn is_lower(letter: char) -> bool {
    let mut lower = letter.to_lowercase();
    let unchanged = lower.next() == Some(letter) && lower.next().is_none();

    let mut upper = letter.to_uppercase();
    let changes = upper.next() != Some(letter) || upper.next().is_some();

    unchanged && changes
}

/// Whether the letter at `at` opens a word: the start of the note, a letter after
/// something that ends a word, or a capital after a small letter, so `readMe` has
/// two word starts. Read off the note as written, not the folded copy, which is
/// why the fold keeps its length.
///
/// The app reads the same rule off character codes wherever it can, because there
/// a character is a string and four of them a letter is what a space of notes
/// cannot afford. Here a `char` is a number already, so the rule is written once.
fn opens(body: &str, at: usize) -> bool {
    let Some(before) = letter_before(body, at) else {
        return true;
    };

    if BOUNDARY.contains(&before) {
        return true;
    }

    is_lower(before) && !letter_at(body, at).is_some_and(is_lower)
}

/// The next place `letter` sits in `folded` at or after `at`.
fn find_from(folded: &str, letter: char, at: usize) -> Option<usize> {
    folded
        .get(at..)
        .and_then(|rest| rest.find(letter))
        .map(|found| at + found)
}

/// The next place `letter` sits in `folded` between `at` and `to`.
///
/// Bounded rather than reaching to the end of the note, and that is the whole
/// point: `to` is the end of the line being scored, and a letter further down the
/// note is not on this line whatever finding it would cost. Looking for it there
/// is a pass over the rest of the note per line of it, so a note whose second
/// letter is nowhere in it costs its own length squared - which for a megabyte of
/// short lines is a keystroke that does not come back.
fn find_within(folded: &str, letter: char, at: usize, to: usize) -> Option<usize> {
    folded
        .get(at..to)
        .and_then(|region| region.find(letter))
        .map(|found| at + found)
}

/// Where the scored part of a line ends: `SCORED` letters along it, or the end of
/// the line when it holds fewer than that.
///
/// Letters, because `SHOWN` is letters. The part scored has to reach at least as far
/// as the part the row goes on to show, or a match a reader can see in front of them
/// is a match nothing found - and counted in bytes it reached four hundred letters
/// of English and a hundred and thirty-three of Japanese, so on a CJK line the
/// scoring stopped well inside the preview.
///
/// A line no longer in bytes than the cut is no longer in letters either, which is
/// nearly every line of every note and is answered without counting anything.
fn cut(body: &str, from: usize, end: usize) -> usize {
    if end.saturating_sub(from) <= SCORED {
        return end;
    }

    body.get(from..end)
        .and_then(|line| line.char_indices().nth(SCORED))
        .map_or(end, |(at, _)| from + at)
}

/// Where `word`'s letters sit in `folded`, starting at `at` and staying inside
/// `to`: each letter at the first place it sits after the last. False when one of
/// them is not there, and `out` is scratch either way.
///
/// Greedy is what makes this cheap, and the loop in `fit_at` is what makes it
/// right: every place the first letter sits is tried, so the run the reader meant
/// is among the ones weighed.
fn walk(word: &Word, folded: &str, at: usize, to: usize, out: &mut Vec<usize>) -> bool {
    out.clear();
    out.push(at);
    let mut cursor = at + word.head.len_utf8();

    for &letter in word.letters.iter().skip(1) {
        // Inside the region only. A letter the rest of the note holds somewhere is
        // not a letter on this line; see `find_within`.
        let Some(found) = find_within(folded, letter, cursor, to) else {
            return false;
        };

        out.push(found);
        cursor = found + letter.len_utf8();
    }

    true
}

/// How many letters were skipped between two matches. Counted in letters rather
/// than in bytes, so a note outside ASCII is scored the way the app scores it,
/// and counting stops at `WORST`, past which a gap costs the same however wide it
/// is.
fn missed(body: &str, from: usize, to: usize) -> usize {
    body.get(from..to)
        .map_or(0, |skipped| skipped.chars().take(WORST).count())
}

/// What `missing` letters skipped between two matches cost.
fn gap(missing: usize) -> i32 {
    if missing == 0 {
        return 0;
    }

    // Held to `WORST`, which is small, so the count always fits. A gap of one is
    // the least there is, and what stands in if it somehow did not.
    let counted = i32::try_from(missing.min(WORST)).unwrap_or(1);
    GAP + (counted - 1) * GAP_ON
}

/// What one set of positions is worth.
///
/// Where in the line the term sits is deliberately not in the number. It is a
/// tiebreak instead, `fit_at` keeps the earliest of the places that score alike,
/// the way fzf settles it, because a penalty for sitting late in a line is a
/// penalty on the second word of every two-word query, and that drowns out what
/// the bonuses are trying to say.
fn worth(body: &str, at: &[usize]) -> i32 {
    let mut score = 0;
    // Where the letter before this one ended, which is where a run would carry on
    // and where a gap would begin. None before the term's first letter.
    let mut after: Option<usize> = None;

    for (index, &position) in at.iter().enumerate() {
        score += LETTER;

        if after == Some(position) {
            score += RUN;
        } else if opens(body, position) {
            score += START * if index == 0 { FIRST } else { 1 };
        }

        if let Some(ended) = after {
            score -= gap(missed(body, ended, position));
        }

        after = Some(position + letter_at(body, position).map_or(1, char::len_utf8));
    }

    score
}

/// The best `word` does in `body` up to `to`, given the note already folded, or
/// None when its letters are not all there in order.
///
/// `first` is where the term's first letter next sits at or after the region; the
/// caller keeps it, because looking it up per line is what turns a long note into
/// a quadratic one. `next` in the answer is the position it stopped at, so the
/// caller's next line starts from there rather than from its own beginning.
///
/// `kept` is where the winning positions are left, and `tried` is scratch. Both
/// belong to the caller and are reused down a whole note: this runs once per line
/// per term over a space of notes, and two arrays a call is most of what a loose
/// search would spend.
fn fit_at(
    word: &Word,
    body: &str,
    folded: &str,
    to: usize,
    first: usize,
    kept: &mut Vec<usize>,
    tried: &mut Vec<usize>,
) -> Option<Fit> {
    let mut score: Option<i32> = None;
    let mut at = Some(first);
    let mut next = Some(first);

    while let Some(start) = at {
        if start >= to {
            break;
        }

        // No fit from here means none from any later start either: a later one
        // has fewer letters left in front of it.
        if !walk(word, folded, start, to, tried) {
            break;
        }

        let worth_it = worth(body, tried);
        // Strictly better, so the earliest of the places that score alike is the
        // one kept; see `worth`.
        if score.is_none_or(|best| worth_it > best) {
            score = Some(worth_it);
            kept.clone_from(tried);
        }

        at = find_from(folded, word.head, start + word.head.len_utf8());
        next = at;
    }

    score.map(|score| Fit { score, next })
}

/// Positions next to each other gathered into the ranges the panel marks, in the
/// bytes of the text they were found in.
fn ranges(body: &str, at: &[usize]) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();

    for &position in at {
        let to = position + letter_at(body, position).map_or(1, char::len_utf8);
        match out.last_mut() {
            Some(last) if last.to == position => last.to = to,
            _ => out.push(Span { from: position, to }),
        }
    }

    out
}

/// The bare words of a query, folded, when the query is one loose matching can be
/// asked about at all.
///
/// Nothing is relaxed that the reader asked to be exact. A phrase in quotes, a
/// `/re/`, a `-` that excludes, an `OR`, a nearness group, `content:` and `case:`
/// are each somebody being precise, and a loose answer under a precise question is
/// noise.
/// What is left, bare words with `path:` `file:` `tag:` and `[key]` narrowing
/// them, is the ordinary search, and the one a typo lands in.
///
/// The app works the terms out for itself and hands them over, so nothing here
/// calls this outside the tests. It is the twin of `fuzzyTerms` all the same:
/// which queries may be relaxed at all is one rule, and a rule with a copy on one
/// side only is a rule that drifts.
#[allow(
    dead_code,
    reason = "the twin of the app's fuzzyTerms, which is what sends the terms over; the tests hold the two to the same table"
)]
#[must_use]
pub fn fuzzy_terms(query: &Query) -> Vec<String> {
    let mut out = Vec::new();
    if gather(query, &mut out) {
        out
    } else {
        Vec::new()
    }
}

/// Fills `out` while the query is still one that can be relaxed. A quoted phrase
/// and a bare word are both `text` to the parser; the space in one is what tells
/// them apart.
fn gather(query: &Query, out: &mut Vec<String>) -> bool {
    match query {
        Query::All { of } => of.iter().all(|one| gather(one, out)),

        Query::Text { text, fold: folded } => {
            if !folded || text.chars().any(char::is_whitespace) {
                return false;
            }

            out.push(fold(text));
            true
        }

        // These ask about the note rather than about its words, so they go on
        // asking exactly while the words beside them are relaxed.
        Query::Path { .. } | Query::File { .. } | Query::Tag { .. } | Query::Property { .. } => {
            true
        }

        // `content:` is somebody saying where to look, and a loose answer under it
        // would be a word the note does not hold, found outside the body they asked
        // about. So it is exact, like the rest of these.
        Query::Any { .. }
        | Query::Not { .. }
        | Query::Regex { .. }
        | Query::Scope { .. }
        | Query::Content { .. } => false,
    }
}

/// The same query with its bare words taken out: what a note has to answer before
/// its lines are worth scoring. `path:` and its kind stay, so a narrowed search
/// stays narrowed; a query of nothing but words becomes the empty `all`, which
/// every note answers.
#[must_use]
pub fn without_words(query: &Query) -> Query {
    match query {
        Query::Text { .. } => Query::All { of: Vec::new() },

        Query::All { of } => Query::All {
            of: of
                .iter()
                .filter(|one| !matches!(one, Query::Text { .. }))
                .map(without_words)
                .collect(),
        },

        other => other.clone(),
    }
}

/// A note's best loose line, ready for a row in the panel. The same shape the
/// exact side sends, with the score that ordered it.
#[derive(Serialize, Clone)]
pub struct FuzzyHit {
    path: String,
    name: String,
    line: usize,
    text: String,
    ranges: Vec<Range>,
    score: i32,
}

impl FuzzyHit {
    /// What the loose match was worth, which is the order the rows are sent in.
    #[must_use]
    pub fn score(&self) -> i32 {
        self.score
    }
}

/// A query's loose terms, asked about one note at a time.
///
/// Built once per search, with the terms already folded, so a space of ten
/// thousand notes folds a handful of words rather than folding them ten thousand
/// times.
pub struct Fuzzy {
    words: Vec<Word>,
}

impl Fuzzy {
    /// Reads the terms in, ready to be asked about note after note. They arrive
    /// folded, from `fuzzy_terms` here or from `fuzzyTerms` in the app, and a term
    /// with no letters in it is not one to look for.
    #[must_use]
    pub fn new(terms: &[String]) -> Self {
        Self {
            words: terms
                .iter()
                .filter_map(|term| {
                    let letters = letters_of(term);
                    let head = *letters.first()?;
                    Some(Word { letters, head })
                })
                .collect(),
        }
    }

    /// Whether there is anything to ask at all, which a query the reader asked to
    /// be exact leaves nothing of.
    #[must_use]
    pub fn asks(&self) -> bool {
        !self.words.is_empty()
    }

    /// The note's best line, or None when no single line holds every term.
    ///
    /// One line rather than all of them: a loose match is a guess, and a guess is
    /// worth one row. A note that deserves more rows is one the exact search has
    /// already found.
    #[must_use]
    pub fn best(&self, note: &Note) -> Option<FuzzyHit> {
        let words = &self.words;
        if words.is_empty() {
            return None;
        }

        let body = note.body;
        // The copy the exact pass already made, when it made one; see
        // `Note::folded`. Folding a space of notes twice over was most of what a
        // loose search spent.
        let folded = note.folded();

        // Where each term's first letter next sits. Only ever moves forward, so
        // the whole note costs one pass per term rather than one pass per line.
        let mut next = Vec::with_capacity(words.len());
        for word in words {
            // A letter the note does not hold at all takes the note out before a
            // single line of it has been scored.
            next.push(folded.find(word.head)?);
        }

        let mut best_score = 0;
        let mut best_line = None;
        let mut best_from = 0;
        let mut best_end = 0;
        let mut best_positions = Vec::new();

        // The lines are walked rather than gathered first, and the arrays a line
        // needs are reused down the whole note: a space of ten thousand notes is a
        // million and a half lines, and an array of where each one starts is a
        // million and a half numbers written down to be read once.
        let mut positions = Vec::new();
        let mut kept = Vec::new();
        let mut tried = Vec::new();

        let mut line = 0;
        let mut from = 0;

        while from <= body.len() {
            let broke = find_from(folded, '\n', from);
            let end = broke.unwrap_or(body.len());

            if end > from {
                let to = cut(body, from, end);
                positions.clear();
                let mut score = 0;
                let mut all = true;

                for (which, word) in words.iter().enumerate() {
                    let mut at = next[which];

                    if at < from {
                        let Some(moved) = find_from(folded, word.head, from) else {
                            // Gone for the rest of the note, so no later line can
                            // hold the term either and the note is answered.
                            return done(
                                note,
                                best_line,
                                best_from,
                                best_end,
                                best_score,
                                &best_positions,
                            );
                        };

                        at = moved;
                        next[which] = moved;
                    }

                    if at >= to {
                        all = false;
                        break;
                    }

                    let Some(found) = fit_at(word, body, folded, to, at, &mut kept, &mut tried)
                    else {
                        all = false;
                        break;
                    };

                    next[which] = found.next.unwrap_or(body.len());
                    score += found.score;
                    positions.extend_from_slice(&kept);
                }

                if all && (best_line.is_none() || score > best_score) {
                    best_score = score;
                    best_line = Some(line);
                    best_from = from;
                    best_end = end;
                    // Copied only when this line is the best so far, which is
                    // rare.
                    best_positions.clone_from(&positions);
                }
            }

            let Some(broke) = broke else {
                break;
            };
            from = broke + 1;
            line += 1;
        }

        done(
            note,
            best_line,
            best_from,
            best_end,
            best_score,
            &best_positions,
        )
    }
}

/// What `best` hands back once it has read as much of the note as it needs to.
///
/// A free function rather than a method, because everything it needs is in front
/// of it and the terms are not among it.
fn done(
    note: &Note,
    line: Option<usize>,
    from: usize,
    end: usize,
    score: i32,
    positions: &[usize],
) -> Option<FuzzyHit> {
    Some(row(note, line?, from, end, score, positions))
}

/// The line as a row shows it, with the marks moved to where trimming left them.
/// The exact side's `row` does the same for its own hits, cutting at the same
/// place, so one list reads as one list.
fn row(
    note: &Note,
    line: usize,
    from: usize,
    end: usize,
    score: i32,
    positions: &[usize],
) -> FuzzyHit {
    let raw = note.body.get(from..end).unwrap_or_default();
    let lead = raw.len() - raw.trim_start().len();
    let text: String = raw.trim().chars().take(SHOWN).collect();

    let mut found = positions.to_vec();
    found.sort_unstable();

    let mut moved: Vec<Span> = Vec::new();
    for span in ranges(note.body, &found) {
        let start = span.from.saturating_sub(from + lead);
        let to = span.to.saturating_sub(from + lead).min(text.len());
        if start >= to {
            continue;
        }

        match moved.last_mut() {
            Some(last) if last.to >= start => last.to = last.to.max(to),
            _ => moved.push(Span { from: start, to }),
        }
    }

    let ranges = moved
        .iter()
        .map(|span| Range {
            from: utf16_at(&text, span.from),
            to: utf16_at(&text, span.to),
        })
        .collect();

    FuzzyHit {
        path: note.path.to_string(),
        name: note.name.to_string(),
        line,
        text,
        ranges,
        score,
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Reverse;

    use super::{
        fit_at, fuzzy_terms, letters_of, ranges, without_words, Fuzzy, FuzzyHit, Word, SCORED,
    };
    use crate::matcher::Note;
    use crate::query::Query;

    /// The twin of these cases is fuzzy.test.ts: the same terms, the same lines,
    /// the same order. A case added there belongs here too.
    ///
    /// The tree the app's parser would have sent is written as the JSON that
    /// crosses the wire, so what is tested is what actually arrives.
    fn query(json: &str) -> Query {
        serde_json::from_str(json).expect("a query the app could have sent")
    }

    fn text(word: &str) -> String {
        format!(r#"{{"kind":"text","text":"{word}","fold":true}}"#)
    }

    fn exact(word: &str) -> String {
        format!(r#"{{"kind":"text","text":"{word}","fold":false}}"#)
    }

    fn all(parts: &[String]) -> String {
        format!(r#"{{"kind":"all","of":[{}]}}"#, parts.join(","))
    }

    fn any(parts: &[String]) -> String {
        format!(r#"{{"kind":"any","of":[{}]}}"#, parts.join(","))
    }

    fn without(part: &str) -> String {
        format!(r#"{{"kind":"not","of":{part}}}"#)
    }

    fn scope(unit: &str, part: &str) -> String {
        format!(r#"{{"kind":"scope","unit":"{unit}","of":{part}}}"#)
    }

    fn pattern(source: &str) -> String {
        format!(r#"{{"kind":"regex","source":"{source}","fold":false}}"#)
    }

    fn path(one: &str) -> String {
        format!(r#"{{"kind":"path","text":"{one}","fold":true}}"#)
    }

    fn file(one: &str) -> String {
        format!(r#"{{"kind":"file","text":"{one}","fold":true}}"#)
    }

    fn tag(one: &str) -> String {
        format!(r#"{{"kind":"tag","tag":"{one}"}}"#)
    }

    fn property(one: &str) -> String {
        format!(r#"{{"kind":"property","name":"{one}","value":null}}"#)
    }

    /// One term against one line: what it scored and where its letters sat. The
    /// twin of the `fit` fuzzy.ts exports, and for the same reason: the ranking
    /// rules are worth checking without a note around them.
    fn fit(term: &str, line: &str) -> Option<(i32, Vec<usize>)> {
        let letters = letters_of(term);
        let head = *letters.first()?;
        let word = Word { letters, head };

        let cropped = line.get(..super::cut(line, 0, line.len()))?;
        let folded = super::fold(cropped);
        let first = folded.find(head)?;

        let mut kept = Vec::new();
        let found = fit_at(
            &word,
            cropped,
            &folded,
            cropped.len(),
            first,
            &mut kept,
            &mut Vec::new(),
        )?;

        Some((found.score, kept))
    }

    /// What a term scores on a line, or None when its letters are not all there.
    fn score(term: &str, line: &str) -> Option<i32> {
        fit(term, line).map(|(score, _)| score)
    }

    /// The letters a term marks on a line, in order, so a ranking case can say
    /// what it thinks matched as well as how well.
    fn marked(term: &str, line: &str) -> String {
        let Some((_, at)) = fit(term, line) else {
            return String::new();
        };

        ranges(line, &at)
            .iter()
            .filter_map(|span| line.get(span.from..span.to))
            .collect()
    }

    /// Which of two lines a term prefers.
    fn better<'a>(term: &str, one: &'a str, other: &'a str) -> &'a str {
        match (score(term, one), score(term, other)) {
            (None, _) => other,
            (_, None) => one,
            (Some(first), Some(second)) => {
                if first >= second {
                    one
                } else {
                    other
                }
            }
        }
    }

    /// The terms a query is relaxed to.
    fn terms(json: &str) -> Vec<String> {
        fuzzy_terms(&query(json))
    }

    const NOTE: &str = "# Meeting notes\n\nAlpha met Beta on Monday.\n\n## The quarter plan\n\nBeta wrote it up.\n";

    fn note<'a>(path: &'a str, body: &'a str) -> Note<'a> {
        Note::new(path, "Work/Meeting.md", "Meeting.md", body)
    }

    /// A note's best loose line under a query, as the panel would list it.
    fn best(json: &str, body: &str) -> Option<FuzzyHit> {
        Fuzzy::new(&terms(json)).best(&note("/space/Work/Meeting.md", body))
    }

    /// What a hit emphasises, sliced the way the app slices it.
    fn lit(hit: &FuzzyHit) -> String {
        let units: Vec<u16> = hit.text.encode_utf16().collect();
        hit.ranges
            .iter()
            .map(|range| {
                String::from_utf16_lossy(units.get(range.from..range.to).unwrap_or_default())
            })
            .collect()
    }

    #[test]
    fn matches_its_letters_in_order_wherever_they_sit() {
        assert!(score("rdm", "read me").is_some());
        assert!(score("read", "read me").is_some());
        // Out of order is not a match: the letters have to come in the order
        // typed.
        assert!(score("mdr", "read me").is_none());
        assert!(score("zq", "read me").is_none());
    }

    #[test]
    fn matches_a_typo_which_is_the_point() {
        // A letter left out.
        assert!(score("meting", "Meeting notes").is_some());
        // Letters typed the wrong way round lose their second one and still
        // match.
        assert!(score("recieve", "i before e receipt").is_none());
        assert!(score("recept", "i before e receipt").is_some());
    }

    #[test]
    fn folds_case_both_ways() {
        assert_eq!(score("RDM", "read me"), score("rdm", "read me"));
        assert!(score("rdm", "READ ME").is_some());
    }

    #[test]
    fn marks_the_letters_it_found_and_nothing_else() {
        assert_eq!(marked("rdm", "read me"), "rdm");
        assert_eq!(marked("read", "read me"), "read");
    }

    #[test]
    fn is_nothing_at_all_for_an_empty_term() {
        assert!(fit("", "read me").is_none());
    }

    #[test]
    fn letters_next_to_each_other_over_letters_apart() {
        assert_eq!(
            better("run", "a run of it", "rather unusual number"),
            "a run of it"
        );
        // And a run beats a word start, or a term found whole in one word would
        // rank level with the same letters picked one from each of six.
        assert_eq!(
            better("quater", "The quarter plan", "q u a t e r"),
            "The quarter plan"
        );
    }

    #[test]
    fn a_word_start_over_the_middle_of_a_word() {
        assert!(score("me", "me first") > score("me", "somewhere"));
        // Initials work by their word starts, which is what earns the bonus.
        assert!(score("rdm", "read me") > score("rdm", "a random thing"));
    }

    #[test]
    fn a_capital_after_a_small_letter_as_a_word_start_too() {
        assert!(score("rm", "readMe") > score("rm", "rummage"));
    }

    /// Where in a line a term sits is not in the score; it settles a tie. Two
    /// places that score alike leave the earlier one marked, which is what a
    /// reader glancing at the row expects to see lit up.
    #[test]
    fn and_where_it_sits_only_settles_a_tie() {
        assert_eq!(score("plan", "plan and plan"), score("plan", "plan"));

        let (_, at) = fit("plan", "plan and plan").expect("a fit");
        let marks = ranges("plan and plan", &at);
        assert_eq!(marks.len(), 1);
        assert_eq!(marks.first().map(|span| (span.from, span.to)), Some((0, 4)));
    }

    #[test]
    fn the_whole_word_over_the_initials_of_it() {
        assert!(score("meeting", "Meeting notes") > score("mn", "Meeting notes"));
    }

    #[test]
    fn and_picks_the_best_place_the_term_fits_not_the_first() {
        // The first `p` is in `paper`; the run in `plan` is worth more, so that
        // is what is marked.
        assert_eq!(marked("plan", "paper: the plan"), "plan");
    }

    #[test]
    fn bare_words_are_relaxed_folded() {
        assert_eq!(
            terms(&all(&[text("meting"), text("notes")])),
            ["meting", "notes"]
        );
        assert_eq!(terms(&text("MeTing")), ["meting"]);
    }

    #[test]
    fn and_words_narrowed_by_an_operator_that_asks_about_the_note() {
        assert_eq!(terms(&all(&[text("meting"), path("Work")])), ["meting"]);
        assert_eq!(
            terms(&all(&[
                text("meting"),
                tag("work"),
                file("a"),
                property("status")
            ])),
            ["meting"]
        );
    }

    #[test]
    fn but_nothing_the_reader_asked_to_be_exact() {
        assert!(terms(&text("a phrase")).is_empty());
        assert!(terms(&pattern("re")).is_empty());
        assert!(terms(&all(&[text("a"), without(&text("b"))])).is_empty());
        assert!(terms(&any(&[text("a"), text("b")])).is_empty());
        assert!(terms(&scope("line", &all(&[text("a"), text("b")]))).is_empty());
        assert!(terms(&exact("Alpha")).is_empty());
        assert!(terms(r#"{"kind":"content","text":"meting","fold":true}"#).is_empty());
        // One precise term takes the whole query out: half a loose answer under
        // a precise question is still noise.
        assert!(terms(&all(&[text("meting"), text("a phrase")])).is_empty());
    }

    #[test]
    fn and_not_an_empty_field() {
        assert!(terms(&all(&[])).is_empty());
        assert!(terms(&path("Work")).is_empty());
    }

    #[test]
    fn a_note_answers_nothing_exactly_when_the_query_was_only_words() {
        let left = without_words(&query(&all(&[text("meting"), text("notes")])));
        assert_eq!(left, Query::All { of: Vec::new() });
    }

    #[test]
    fn a_note_still_answers_the_operators_when_there_were_any() {
        let left = without_words(&query(&all(&[text("meting"), path("Work")])));
        assert_eq!(
            left,
            Query::All {
                of: vec![Query::Path {
                    text: "Work".to_string(),
                    fold: true,
                }],
            }
        );
    }

    #[test]
    fn a_note_offers_its_best_line_and_says_what_matched() {
        let found = best(&all(&[text("quater"), text("plan")]), NOTE).expect("a hit");
        assert_eq!(found.text, "## The quarter plan");
        assert_eq!(found.line, 4);
        assert!(!found.ranges.is_empty());
    }

    #[test]
    fn one_row_and_no_more_because_a_guess_is_worth_one() {
        // Both the heading and the last line hold every letter of `bta`.
        let found = best(&text("bta"), NOTE).expect("a hit");
        assert!(found.score() > 0);
    }

    #[test]
    fn a_note_needs_every_term_on_one_line() {
        // `alpha` is on one line and `plan` on another, so no line holds both.
        assert!(best(&all(&[text("alpha"), text("plan")]), NOTE).is_none());
        assert!(best(&all(&[text("alpha"), text("monday")]), NOTE).is_some());
    }

    #[test]
    fn a_note_answers_nothing_when_a_letter_is_missing_from_it() {
        assert!(best(&text("zzz"), NOTE).is_none());
    }

    #[test]
    fn and_nothing_at_all_when_the_query_is_not_one_to_relax() {
        assert!(best(&text("quarter plan"), NOTE).is_none());
    }

    #[test]
    fn marks_where_the_letters_are_in_the_row_not_in_the_note() {
        let found = best(&text("meting"), NOTE).expect("a hit");
        assert_eq!(found.text, "# Meeting notes");

        let units = found.text.encode_utf16().count();
        for range in &found.ranges {
            assert!(range.to <= units);
        }
        assert_eq!(lit(&found), "Meting");
    }

    /// The paths of some notes in the order a loose search would list them.
    fn ranked(json: &str, bodies: &[(&str, &str)]) -> Vec<String> {
        let fuzzy = Fuzzy::new(&terms(json));
        let mut found: Vec<FuzzyHit> = bodies
            .iter()
            .filter_map(|(one, body)| fuzzy.best(&note(one, body)))
            .collect();

        found.sort_by_key(|hit| Reverse(hit.score()));
        found.into_iter().map(|hit| hit.path).collect()
    }

    #[test]
    fn puts_the_note_that_says_the_words_first() {
        assert_eq!(
            ranked(
                &all(&[text("quater"), text("plan")]),
                &[
                    ("/exact.md", "The quarter plan for the year"),
                    ("/scattered.md", "q u a t e r and a plan"),
                    ("/middle.md", "inequater complan"),
                ]
            ),
            ["/exact.md", "/middle.md", "/scattered.md"]
        );
    }

    #[test]
    fn and_a_note_that_answers_nothing_is_not_in_the_list() {
        assert_eq!(
            ranked(
                &text("quater"),
                &[
                    ("/yes.md", "the quarter"),
                    ("/no.md", "nothing of the kind here"),
                ]
            ),
            ["/yes.md"]
        );
    }

    /// A term whose first letter is on every line and whose second is nowhere in
    /// the note at all. Each line looks for that second letter, and looking for it
    /// past the line is a pass over the rest of the note per line of it: a
    /// megabyte of short lines is half a million passes, which is a keystroke that
    /// never comes back. Bounded to the line, this note is one memchr per line.
    ///
    /// Timed rather than counted, because what went wrong was the work and not the
    /// answer: the same `None` came back either way. The bound is a hundred times
    /// what a warm run costs here and a fraction of what it cost before, so the
    /// slowest runner still passes and the shape that failed still fails.
    #[test]
    fn a_letter_the_note_has_not_got_is_looked_for_on_the_line_only() {
        let body = "a\n".repeat(400_000);
        let fuzzy = Fuzzy::new(&terms(&text("az")));

        let started = std::time::Instant::now();
        let found = fuzzy.best(&note("/long.md", &body));
        let spent = started.elapsed();

        assert!(found.is_none(), "no line holds the term");
        assert!(spent.as_secs() < 5, "{spent:?} for 800 KB of lines");
    }

    /// The cut into a long line falls between letters and not inside one. A line
    /// of nothing but three-byte letters puts a letter across every offset that is
    /// not a multiple of three, `SCORED` among them.
    #[test]
    fn a_long_line_outside_ascii_is_still_scored() {
        let line = "の".repeat(SCORED);
        let body = format!("{line}\n");

        assert_eq!(super::cut(&body, 0, body.len() - 1) % "の".len(), 0);
        // The letters a term wants are inside the first `SCORED` of them.
        assert!(best(&text("のの"), &body).is_some());
    }

    /// How far a line is scored is counted the way how far it is shown is, so the
    /// scored part reaches at least as far as the row does. In bytes it did not: a
    /// line of Japanese was scored for a third of what the row went on to show, and
    /// a match a reader could see in front of them was a match nothing had found.
    #[test]
    fn a_long_line_is_scored_as_far_as_it_is_shown() {
        // The term sits past the four hundredth byte of the line and well inside its
        // two hundredth letter, which is where the row is cut.
        let line = format!("{}めも{}", "の".repeat(150), "の".repeat(300));

        let found = best(&text("めも"), &line).expect("the letters are on the line");
        assert!(found.text.contains('め'), "{}", found.text);
    }
}
