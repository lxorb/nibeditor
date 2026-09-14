//! The links between notes, read off a whole space in one pass.
//!
//! What this exists for: the Links panel wants the backlinks of the open note,
//! the autocomplete wants every note's name and headings, and both want them for
//! a space that may hold thousands of notes. Asking the window to read each note
//! through `read_note` would be one round trip per file plus a JSON copy of every
//! note's text; here each file is read once, its links and headings are taken out
//! of it, and only that comes back.
//!
//! The grammar is Obsidian's, and it is the same grammar `@nib/markdown/links`
//! reads on the other side. Two languages cannot share one parser, so the tests
//! at the bottom are what keep the two readings from drifting: every case here
//! has a twin in `packages/markdown/src/links.test.ts`.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs;
use tauri::AppHandle;

use crate::front_matter;
use crate::paths::{files_in, in_spaces, is_canvas, is_shortcut, relative_to};
use crate::tags::tags_in;

/// How much of a line is worth keeping as the context a result is read in. The
/// same as a search hit shows, so the two panels read alike.
const LINE: usize = 200;

/// How far a `[label](target)` may run before it is not one. A label is a phrase
/// and a target is a path - three hundred characters at the outside, the same
/// ceiling a stored path has - so this is room and then some. See `markdown_link`,
/// where it is also what keeps one line's walk linear.
const LONGEST_LINK: usize = 1000;

/// How many links one note is read for.
///
/// A note that points at more places than this is not a note anybody is reading,
/// and each link kept carries the line it sits on: a megabyte of `[[A]]` is two
/// hundred thousand links with two hundred characters of context each, which is
/// forty megabytes for one file - and the answer is held for every note of the
/// space at once. A note arrives from a share, a room or a folder somebody synced,
/// so the ceiling is what stops one of them from being the whole index.
const MOST_LINKS: usize = 5000;

/// One link out of a note.
#[derive(Serialize)]
pub struct Link {
    /// `wikilink` for `[[Note]]`, `markdown` for `[label](Note.md)`.
    kind: &'static str,
    /// The note it names, as written. Empty for a link inside its own note.
    target: String,
    heading: Option<String>,
    block: Option<String>,
    alias: Option<String>,
    /// `![[…]]` or `![…](…)`: the target's content rather than a link to it.
    embed: bool,
    /// The line it sits on, counting from zero.
    line: usize,
    /// The line itself, so a result reads like the note.
    text: String,
}

/// One note as the link index sees it.
#[derive(Serialize)]
pub struct Note {
    /// Path relative to the space, with `/` separators.
    path: String,
    /// The file's name without its extension, which is what a link uses.
    name: String,
    headings: Vec<String>,
    /// The `^abc123` names blocks in this note carry.
    blocks: Vec<String>,
    links: Vec<Link>,
    /// The tags the note carries, folded and without the hash, each once. Read on
    /// this pass because the space is already being read, and because the picture
    /// of the space colours and filters by them: a graph that had to ask the disk
    /// which notes are tagged `#work` would ask once per note.
    tags: Vec<String>,
    /// What the note's front matter says it wears in the file list, as written:
    /// `file-text`, Iconize's `LiFileText` or an emoji. None where it says
    /// nothing, which is almost every note. Read here because the pass over the
    /// space is already reading every note, and reading them a second time for
    /// one line of metadata would be a second pass over the disk.
    icon: Option<String>,
    /// The colour that icon is drawn in, as written: an accent's own id, or None.
    /// A second key rather than part of the first, so another app reading the note
    /// still finds the icon; see icons.ts in the app.
    #[serde(rename = "iconColor")]
    icon_color: Option<String>,
    /// The other names the note gave itself, as its front matter lists them. On
    /// the same pass and for the same reason as the icon: the space is already
    /// being read, and a link may use any of them.
    aliases: Vec<String>,
    /// The address a note points at, for a note written when a website in a space
    /// was a note: `url:` in its front matter. None for every ordinary note, which
    /// is almost all of them, and None for a website written since - that is a
    /// shortcut file, `Svelte docs.url`, and its name says what it is.
    ///
    /// So this is what says a note wants converting, and the only thing it says.
    /// Read on this pass for the reason the icon is: the space is already being
    /// read. See web-tab/shortcut.ts and docs/web-tabs.md.
    url: Option<String>,
    /// The site's own mark, as an address: a website's `Nib-Icon`, so the file list
    /// draws the favicon in front of the row rather than the plain globe - before the
    /// page has loaded, and on a machine that has never opened the site. None for
    /// every note and canvas, and for a website nobody has followed a link out of yet.
    /// Read on this pass for the reason the icon is. See web-tab/shortcut.ts.
    favicon: Option<String>,
    /// The picture across the top of the note, as its front matter says it under
    /// `cover:`. None for a note with no cover, which is almost every note.
    ///
    /// Read on this pass for the reason the icon is: the space is already being
    /// read, and the row's own menu has to know whether there is a cover to change
    /// or to take away. Where the band is taken from - `cover-position:` - is not
    /// read, because no list asks it; the surface that draws the banner reads it
    /// out of the note itself. See cover.ts in @nib/markdown.
    cover: Option<String>,
}

/// A whole space's links.
#[derive(Serialize)]
pub struct SpaceLinks {
    notes: Vec<Note>,
    /// Every file in the space that is not a note, relative to it, so
    /// `![[picture.png]]` finds a picture wherever it lives - as Obsidian does.
    files: Vec<String>,
}

/// Reads every note in a space and returns what links out of each, the headings
/// and block names inside each, and the other files beside them.
#[tauri::command(async)]
pub fn scan_links(app: AppHandle, root: String) -> Result<SpaceLinks, String> {
    let dir = in_spaces(&app, &root)?;
    let (notes, others) = files_in(&dir);

    let mut out = Vec::with_capacity(notes.len());
    for path in notes {
        // A note that cannot be read is not a failure of the whole space: the
        // rest of it still has links worth knowing about.
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };

        out.push(note_at(relative_to(&dir, &path), &body));
    }

    // The canvases too, for the icon each one wears. A canvas is a file rather
    // than a note and stays among `files`, which is how `![[Board.canvas]]`
    // resolves; it is read here as well because every row of the tree wants the
    // icon, and a scan that skipped it would leave a canvas wearing the plain
    // mark until somebody opened it.
    for path in others.iter().filter(|path| is_canvas(path)) {
        let Ok(body) = fs::read_to_string(path) else {
            continue;
        };

        out.push(canvas_note(relative_to(&dir, path), &body));
    }

    // And the websites, so a link can be made to one. A shortcut is a file rather
    // than a note - `Svelte docs.url` - and it stays among `files` like a canvas;
    // it is here as well because `[[Svelte docs]]` resolves by name against this
    // list, and a website is a document in the space that a note may point at. Its
    // one line worth reading is the favicon the file list draws in front of the row:
    // an address is not a link out of the graph, and the words of it are the search's
    // business, but the site's own mark is the row's. See shortcut.ts.
    for path in others.iter().filter(|path| is_shortcut(path)) {
        let body = fs::read_to_string(path).unwrap_or_default();
        out.push(shortcut_note(relative_to(&dir, path), &body));
    }

    // By path, so the order is the browser's order too: there the notes, the
    // canvases and the websites are sorted together, and the readings have to
    // agree.
    out.sort_by(|one, other| one.path.cmp(&other.path));

    Ok(SpaceLinks {
        notes: out,
        files: others.iter().map(|path| relative_to(&dir, path)).collect(),
    })
}

/// A note as the link index sees it, off the one reading of it the scan makes.
///
/// Everything the index knows about a note is taken out here, so the walk above is
/// the walk and nothing else - and so that what a note answers can be tested
/// without a space on disk to walk.
fn note_at(relative: String, body: &str) -> Note {
    // The name a link uses, which is the file's own name without its extension.
    let file = relative.rsplit('/').next().unwrap_or(&relative);
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let name = stem.to_string();

    let read = prose(body);

    // Where the note's metadata sits, found once for every key read out of it - the
    // icon, its colour, the aliases, `url:` and `cover:`: a note that opens with a
    // fence nothing closes is a note whose whole body the search for that block
    // reads, and a key each would have been one of those each.
    let block = front_matter::block(body);
    let said = |key: &str| {
        block
            .as_ref()
            .and_then(|one| front_matter::value(body, one, key))
    };

    Note {
        path: relative,
        name,
        headings: read.headings,
        blocks: read.blocks,
        links: read.links,
        tags: note_tags(body),
        icon: said("icon"),
        icon_color: said("icon-color"),
        aliases: block
            .as_ref()
            .map_or_else(Vec::new, |one| front_matter::list(body, one, "aliases")),
        url: said("url"),
        // A note wears its own front-matter icon, not a site's favicon; that is a
        // website's, read in `shortcut_note`.
        favicon: None,
        cover: said("cover"),
    }
}

/// What a canvas file says that the index cares about.
///
/// A struct and not the whole of the JSON, so a plane of five thousand strokes is
/// read past rather than built in memory: the ink sits under `nib` beside the
/// icon, and serde walks over everything nothing here asks for.
///
/// The twin of `scanCanvas` in `apps/desktop/src/lib/scan-note.ts`. The format
/// itself is `packages/markdown/src/canvas.ts`; these are the two things a file
/// list and a Links panel need out of it.
#[derive(Default, Deserialize)]
struct CanvasFile {
    #[serde(default)]
    nodes: Vec<CanvasCard>,
    #[serde(default)]
    nib: CanvasNib,
}

/// The key the spec has no place for, which is where a canvas keeps its icon.
#[derive(Default, Deserialize)]
struct CanvasNib {
    #[serde(default)]
    icon: Option<String>,
    #[serde(default, rename = "iconColor")]
    icon_color: Option<String>,
}

/// One card, as far as this cares: the four kinds the spec names share these
/// fields, and only a `file` card points at anything.
#[derive(Deserialize)]
struct CanvasCard {
    #[serde(rename = "type")]
    kind: Option<String>,
    file: Option<String>,
    subpath: Option<String>,
}

/// A value with the spaces trimmed off, or None where nothing is left of it. What
/// the words themselves may say is read in the app's icons.ts.
fn said(value: Option<String>) -> Option<String> {
    value
        .map(|one| one.trim().to_string())
        .filter(|one| !one.is_empty())
}

/// A canvas as the link index sees it: the icon its `nib` key carries, and one
/// link for every card that names a file.
///
/// Nothing else. A canvas has no words of its own to index - the JSON is a
/// drawing, not prose - so there are no headings and no blocks, and nothing
/// points into one.
fn canvas_note(relative: String, body: &str) -> Note {
    let read: CanvasFile = serde_json::from_str(body).unwrap_or_default();

    // The extension is part of a canvas's name, the way it is for a PDF: a link to
    // one is written `[[Board.canvas]]`.
    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();

    let links: Vec<Link> = read
        .nodes
        .iter()
        .filter(|card| card.kind.as_deref() == Some("file"))
        .filter_map(|card| {
            let file = card.file.clone()?;
            let subpath = card.subpath.as_deref().unwrap_or_default();

            Some(Link {
                kind: "wikilink",
                target: file.clone(),
                // A card's subpath is a heading or a block, written with the `#`
                // a wikilink writes it with.
                heading: subpath
                    .strip_prefix('#')
                    .filter(|_| !subpath.starts_with("#^"))
                    .map(str::to_string),
                block: subpath.strip_prefix("#^").map(str::to_string),
                alias: None,
                embed: false,
                // A canvas has no lines, so every row reads as the card it came
                // from.
                line: 0,
                text: file,
            })
        })
        .collect();

    Note {
        name,
        path: relative,
        headings: Vec::new(),
        blocks: Vec::new(),
        links,
        // A drawing carries no tags: `#work` in a card is a word somebody wrote
        // on the plane, not a tag the space is filed under.
        tags: Vec::new(),
        // A value that is nothing but spaces is not an icon; what the words
        // themselves may say is read in the app's icons.ts.
        icon: said(read.nib.icon),
        icon_color: said(read.nib.icon_color),
        aliases: Vec::new(),
        // A plane of cards is never a website: a canvas has no front matter to say
        // so, and JSON Canvas has no key for one.
        url: None,
        favicon: None,
        // And a plane has no cover: the whole of it is a picture already.
        cover: None,
    }
}

/// A website as the link index sees it: a name, and the site's own mark.
///
/// A shortcut holds one address and no words: no links out, no headings, no blocks,
/// no tags, and no front-matter icon of its own. It is in the index so that a link
/// can be made to it and so that the graph has a node for it, which is what a website
/// in a space is - and it carries the one thing the file list wants that the name
/// cannot give, the favicon out of its `Nib-Icon` key.
fn shortcut_note(relative: String, content: &str) -> Note {
    // The extension is part of the name, the way it is for a canvas: a link may be
    // written `[[Svelte docs.url]]` as well as `[[Svelte docs]]`.
    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();

    Note {
        name,
        path: relative,
        headings: Vec::new(),
        blocks: Vec::new(),
        links: Vec::new(),
        tags: Vec::new(),
        icon: None,
        icon_color: None,
        aliases: Vec::new(),
        // What `url:` means here is a note that is a website in the old format and
        // wants converting; a shortcut is already one. See shortcut.ts.
        url: None,
        favicon: favicon_of(content),
        cover: None,
    }
}

/// The site's own mark out of a shortcut, as an address: the `Nib-Icon` line the app
/// writes into a `.url`. None for a `.webloc`, which has no such key, and for a
/// shortcut nobody has followed a link out of yet. A twenty-line reader for a
/// twenty-line file, so the whole INI parser the app has is not asked for on a pass
/// that wants one line; see web-tab/shortcut.ts, which writes it and reads it there.
fn favicon_of(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if !key.trim().eq_ignore_ascii_case("nib-icon") {
            return None;
        }

        let value = value.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// The tags of one note as the index keeps them: each once, folded, and without
/// the hash, which is what the `tag:` operator compares against.
///
/// `tags_in` answers once per use and with the hash, because the tag tree counts
/// uses; a picture of the space asks whether a note carries a tag at all.
fn note_tags(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    for tag in tags_in(body) {
        let folded = tag.trim_start_matches('#').to_lowercase();
        if !folded.is_empty() && !out.contains(&folded) {
            out.push(folded);
        }
    }

    out
}

/// Whether a line opens or closes a fenced code block.
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    line.len() - trimmed.len() <= 3 && (trimmed.starts_with("```") || trimmed.starts_with("~~~"))
}

/// Every line of a note that is not code, with the number it is on. Both
/// delimiters of a fence are code as well: neither can hold a link, a heading or a
/// block name.
///
/// Handed to a closure rather than gathered into a list, because all three readers
/// walk a note straight down and none of them looks back: a space of ten thousand
/// notes is a million and a half lines, and this is asked of every one of them
/// three times over.
fn prose_lines(body: &str, mut each: impl FnMut(usize, &str)) {
    let mut fenced = false;

    for (index, line) in body.lines().enumerate() {
        let fence = is_fence(line);
        if fence {
            fenced = !fenced;
        }
        if fenced || fence {
            continue;
        }

        each(index, line);
    }
}

/// What one pass down a note's prose takes out of it: the two things a link can
/// point at inside it, and the links out of it.
struct Prose {
    headings: Vec<String>,
    blocks: Vec<String>,
    links: Vec<Link>,
}

/// That pass. One rather than three, because all three lists are filled line by
/// line and in the order the lines come: three were three splittings of every note
/// in a space into lines and three rounds of fence bookkeeping down each of them,
/// for one answer.
fn prose(body: &str) -> Prose {
    let mut headings = Vec::new();
    let mut blocks = Vec::new();
    let mut links = Vec::new();

    prose_lines(body, |index, line| {
        if let Some(text) = heading_of(line) {
            headings.push(text);
        }
        if let Some(id) = block_id_of(line) {
            blocks.push(id);
        }

        // Every link is written inside brackets, so a line that holds none holds
        // no link - and that is nearly every line of a space. Read off the line as
        // it was written, because blanking a code span below can only ever take a
        // bracket away.
        //
        // What this skips is the pass that reads the line as characters, which is
        // an array as long as the line for every line of every note: the walk that
        // follows cannot start without one. 4.8 MB of prose with no link in it,
        // release build: 19.6 ms before, 6.1 ms now.

        if !line.as_bytes().contains(&b'[') {
            return;
        }

        // And a note that has said where it points five thousand times has said it;
        // see `MOST_LINKS`. The lines after this one are still read, because the
        // headings and the blocks in them are what the rest of this pass is for.
        if links.len() >= MOST_LINKS {
            return;
        }

        // Inline code spans are blanked rather than removed, so what is left
        // still lines up with the line the context is taken from.
        let mut found = links_on(&without_code(line), MOST_LINKS - links.len());
        if found.is_empty() {
            return;
        }

        // The words the link is read in, built only for a line that holds one: a
        // space of notes is mostly lines that hold none.
        let context: String = line.trim().chars().take(LINE).collect();
        for link in &mut found {
            link.line = index;
            link.text.clone_from(&context);
        }

        links.append(&mut found);
    });

    Prose {
        headings,
        blocks,
        links,
    }
}

/// The words of a heading line, or nothing when the line is not one.
fn heading_of(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }

    let hashes = trimmed.chars().take_while(|one| *one == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }

    let rest = &trimmed[hashes..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }

    // A closing run of hashes is a style of writing a heading, not part of it.
    Some(rest.trim().trim_end_matches('#').trim().to_string())
}

/// The name a line ends by giving its block, if it gives one.
fn block_id_of(line: &str) -> Option<String> {
    let trimmed = line.trim_end_matches([' ', '\t']);
    let caret = trimmed.rfind('^')?;

    // A name starts a word, so what comes before the caret is a space or nothing.
    let opens = caret == 0
        || trimmed[..caret]
            .chars()
            .next_back()
            .is_some_and(|one| one == ' ' || one == '\t');
    if !opens {
        return None;
    }

    let id = &trimmed[caret + 1..];
    if id.is_empty()
        || !id
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '-')
    {
        return None;
    }

    Some(id.to_string())
}

/// The same line with every inline code span replaced by spaces of the same
/// length, so `[[Note]]` inside backticks is left alone and the offsets hold.
///
/// The line itself where there is no code span in it, which is nearly every line
/// of nearly every note: a copy of one costs what the line is long, and this is
/// asked of every line of a space.
fn without_code(line: &str) -> Cow<'_, str> {
    if !line.contains('`') {
        return Cow::Borrowed(line);
    }

    let letters: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut at = 0;

    while at < letters.len() {
        if letters[at] != '`' {
            out.push(letters[at]);
            at += 1;
            continue;
        }

        // A span is closed by a run of backticks as long as the one that opened
        // it, which is how `` ` `` holds a backtick.
        let mut open_end = at;
        while open_end < letters.len() && letters[open_end] == '`' {
            open_end += 1;
        }
        let marks = open_end - at;

        let mut close = None;
        let mut scan = open_end;
        while scan < letters.len() {
            if letters[scan] == '`' {
                let mut run = scan;
                while run < letters.len() && letters[run] == '`' {
                    run += 1;
                }
                if run - scan == marks {
                    close = Some(scan);
                    break;
                }
                scan = run;
                continue;
            }
            scan += 1;
        }

        match close {
            // Nothing closes it, so the backticks are text like anything else.
            None => {
                for one in &letters[at..] {
                    out.push(*one);
                }
                break;
            }
            Some(end) => {
                for _ in at..end + marks {
                    out.push(' ');
                }
                at = end + marks;
            }
        }
    }

    Cow::Owned(out)
}

/// Every link on one line of prose, in the order they were written, and at most
/// `most` of them: what is left of the note's own ceiling by the time this line is
/// reached. See `MOST_LINKS`.
fn links_on(line: &str, most: usize) -> Vec<Link> {
    let letters: Vec<char> = line.chars().collect();
    let mut found = Vec::new();
    let mut at = 0;

    while at < letters.len() && found.len() < most {
        // A backslash escapes the bracket, and a link nobody wrote is not one.
        if letters[at] != '[' || (at > 0 && letters[at - 1] == '\\') {
            at += 1;
            continue;
        }

        let embed = at > 0 && letters[at - 1] == '!';

        if letters.get(at + 1) == Some(&'[') {
            if let Some(end) = closing_brackets(&letters, at + 2) {
                let inner: String = letters[at + 2..end].iter().collect();
                if let Some(link) = wikilink(&inner, embed) {
                    found.push(link);
                }
                at = end + 2;
                continue;
            }
            at += 1;
            continue;
        }

        if let Some((end, label, target)) = markdown_link(&letters, at) {
            if let Some(link) = note_link(&label, &target, embed) {
                found.push(link);
            }
            at = end;
            continue;
        }

        at += 1;
    }

    found
}

/// Where the `]]` that closes a wikilink is, or nothing when the line holds no
/// such thing: a link takes one line and no brackets of its own.
fn closing_brackets(letters: &[char], from: usize) -> Option<usize> {
    let mut at = from;
    while at < letters.len() {
        match letters[at] {
            // A bracket of its own ends the search: `[[a]b]]` is not a link, and
            // neither is `[[]]`, which is what the emptiness check below says.
            '[' => return None,
            ']' => {
                let closed = letters.get(at + 1) == Some(&']');
                return if closed && at > from { Some(at) } else { None };
            }
            _ => at += 1,
        }
    }
    None
}

/// A `[label](target)` starting at `at`: where it ends, what it is labelled, and
/// where it points. Titles and `<>` around the target are both understood.
fn markdown_link(letters: &[char], at: usize) -> Option<(usize, String, String)> {
    // Every scan below stops here rather than at the end of the line, and that is
    // what keeps the walk over a line linear. A `[` that turns out not to open a
    // link moves the walk on by one character and the next `[` is read from there,
    // so a scan that runs to the end of the line is a scan repeated for every `[`
    // on it: `[a](` written two hundred thousand times - which is one line of a
    // note somebody shared - is a line read a hundred billion times over, with a
    // string of half the line built and thrown away at each step. A link longer
    // than this is not one anybody wrote: the target is a path, and a path is
    // three hundred characters at the outside.
    let stop = letters.len().min(at + LONGEST_LINK);

    let mut close = at + 1;
    while close < stop && letters[close] != ']' {
        if letters[close] == '[' {
            return None;
        }
        close += 1;
    }
    if close >= stop || letters.get(close + 1) != Some(&'(') {
        return None;
    }

    let mut scan = close + 2;
    while scan < stop && (letters[scan] == ' ' || letters[scan] == '\t') {
        scan += 1;
    }

    let angled = letters.get(scan) == Some(&'<');
    if angled {
        scan += 1;
    }

    let mut target = String::new();
    while scan < stop {
        let one = letters[scan];
        if angled && one == '>' {
            scan += 1;
            break;
        }
        if !angled && (one == ')' || one == ' ' || one == '\t') {
            break;
        }
        if one == '\n' {
            return None;
        }
        target.push(one);
        scan += 1;
    }

    // Whatever is left has to close the link, with room for a title.
    while scan < stop && letters[scan] != ')' {
        scan += 1;
    }
    if scan >= stop || letters[scan] != ')' {
        return None;
    }

    let label: String = letters[at + 1..close].iter().collect();
    Some((scan + 1, label, target))
}

/// The note, heading and block a target names: `folder/Note#Heading`, or
/// `folder/Note#^blockid`.
fn split_target(named: &str) -> (String, Option<String>, Option<String>) {
    let (target, fragment) = match named.split_once('#') {
        Some((target, rest)) => (target.trim().to_string(), rest.trim()),
        None => (named.trim().to_string(), ""),
    };

    let block = fragment.strip_prefix('^').map(str::to_string);
    let heading = if block.is_none() && !fragment.is_empty() {
        Some(fragment.to_string())
    } else {
        None
    };

    (target, heading, block)
}

/// What is between the brackets, as a link. Nothing when it names nothing to
/// point at.
fn wikilink(inner: &str, embed: bool) -> Option<Link> {
    let (named, alias) = match inner.split_once('|') {
        // Everything after the first bar, so an alias may hold one itself.
        Some((named, alias)) => (named, Some(alias.trim()).filter(|one| !one.is_empty())),
        None => (inner, None),
    };

    let (target, heading, block) = split_target(named);
    if target.is_empty() && heading.is_none() && block.is_none() {
        return None;
    }

    Some(Link {
        kind: "wikilink",
        target,
        heading,
        block,
        alias: alias.map(str::to_string),
        embed,
        line: 0,
        text: String::new(),
    })
}

/// A markdown link, when its target names a note rather than a page on the web.
fn note_link(label: &str, written: &str, embed: bool) -> Option<Link> {
    if !is_note_target(written) {
        return None;
    }

    let (target, heading, block) = split_target(&decode(written));
    if target.is_empty() && heading.is_none() && block.is_none() {
        return None;
    }

    Some(Link {
        kind: "markdown",
        target,
        heading,
        block,
        alias: Some(label.to_string()),
        embed,
        line: 0,
        text: String::new(),
    })
}

/// Whether a markdown target points inside the space rather than out at the web.
fn is_note_target(target: &str) -> bool {
    if target.starts_with("//") {
        return false;
    }

    let Some(colon) = target.find(':') else {
        return true;
    };

    // A scheme is letters, digits and a few marks, and starts with a letter.
    let scheme = &target[..colon];
    !scheme.starts_with(|one: char| one.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || matches!(one, '+' | '.' | '-'))
}

/// A markdown target as the name it stands for: `My%20Note.md` links to
/// `My Note.md`, and the index has to recognise it as one.
fn decode(target: &str) -> String {
    let bytes = target.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;

    while at < bytes.len() {
        if let Some(byte) = escape_at(bytes, at) {
            out.push(byte);
            at += 3;
            continue;
        }
        out.push(bytes[at]);
        at += 1;
    }

    // Not valid encoding means the characters are the name.
    String::from_utf8(out).unwrap_or_else(|_| target.to_string())
}

/// The byte a `%xx` at this position stands for, or nothing when what is there is
/// not one.
///
/// Read as bytes rather than as a slice of the note. A character wider than the
/// two bytes an escape is spelled in - `%€` in a link somebody wrote - puts the
/// second of them inside that character, and slicing a `str` between the bytes of
/// one character is a panic.
fn escape_at(bytes: &[u8], at: usize) -> Option<u8> {
    if bytes.get(at) != Some(&b'%') {
        return None;
    }

    let high = hex(*bytes.get(at.checked_add(1)?)?)?;
    let low = hex(*bytes.get(at.checked_add(2)?)?)?;
    Some((high << 4) | low)
}

/// One hexadecimal digit as its value, in either case. By hand rather than
/// through `from_str_radix`, which also takes a sign: `%+1` is not an escape.
fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        block_id_of, canvas_note, decode, favicon_of, heading_of, note_at, note_tags, prose,
        shortcut_note, without_code, Link,
    };

    /// The links out of one note, which is one of the three lists the pass down it
    /// fills. Named for what it answers, so a case reads as the note it is about.
    fn links_in(body: &str) -> Vec<Link> {
        prose(body).links
    }

    /// The headings in one note, off the same pass.
    fn headings_in(body: &str) -> Vec<String> {
        prose(body).headings
    }

    /// One note as the index sees it, which is everything the scan takes out of
    /// the one reading it makes.
    #[test]
    fn reads_a_note_into_what_the_index_holds() {
        let read = note_at(
            "Work/Meeting Notes.md".to_string(),
            "---\nicon: rocket\nicon-color: blue\naliases: [Standup]\n---\n\n# Later\n\nSee [[Plan]] #work ^abc123\n",
        );

        assert_eq!(read.path, "Work/Meeting Notes.md");
        assert_eq!(read.name, "Meeting Notes");
        assert_eq!(read.headings, ["Later"]);
        assert_eq!(read.blocks, ["abc123"]);
        assert_eq!(read.tags, ["work"]);
        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.icon_color.as_deref(), Some("blue"));
        assert_eq!(read.aliases, ["Standup"]);
        assert!(read.url.is_none());
        assert_eq!(read.links.len(), 1);
        assert_eq!(read.links[0].target, "Plan");
    }

    /// A website in the space is a note whose front matter says where it points.
    /// The index is what tells the file list and the tab strip, so it has to come
    /// back off the same one reading.
    #[test]
    fn a_note_that_is_a_website_says_where_it_points() {
        let read = note_at(
            "Reading/Svelte.md".to_string(),
            "---\nurl: https://svelte.dev/docs\ntitle: Svelte docs\n---\n\n# Svelte docs\n",
        );

        assert_eq!(read.url.as_deref(), Some("https://svelte.dev/docs"));
    }

    /// The picture across the top of a note, read on the same pass as the icon: the
    /// row's own menu has to know whether there is a cover to change or to take away,
    /// and asking the disk per row would be a read per row. The twin of `scanNote` in
    /// the app; see cover.ts in @nib/markdown for what the key means.
    #[test]
    fn a_note_says_which_picture_is_across_the_top_of_it() {
        let read = note_at(
            "Trips/Iceland.md".to_string(),
            "---\ncover: assets/wide.jpg\ncover-position: 20\n---\n\n# Iceland\n",
        );

        assert_eq!(read.cover.as_deref(), Some("assets/wide.jpg"));
        // Where the band is taken from is nobody's business here: no list asks it, and
        // the surface that draws the banner reads it out of the note itself.
        assert!(read.icon.is_none());
    }

    /// And a note that names none says so, which is almost every note.
    #[test]
    fn and_a_note_with_no_cover_carries_none() {
        let read = note_at("Trips/Plan.md".to_string(), "# Plan\n\nWords.\n");

        assert!(read.cover.is_none());
    }

    /// A website carries the site's own mark for the file list, out of its `Nib-Icon`
    /// key. Emil, 2026-09-13: *"the website favicon should also be used in the
    /// sidebar."* Read on the same pass as everything else, so a row has the favicon
    /// before the file has been opened and on a machine that never has.
    #[test]
    fn a_website_carries_its_favicon_for_the_file_list() {
        let read = shortcut_note(
            "Reading/Svelte docs.url".to_string(),
            "[InternetShortcut]\nURL=https://svelte.dev/docs\nNib-Icon=https://svelte.dev/favicon.png\n",
        );

        assert_eq!(read.name, "Svelte docs.url");
        assert_eq!(
            read.favicon.as_deref(),
            Some("https://svelte.dev/favicon.png")
        );
        // A shortcut is a name and a mark and nothing else the index reads off it.
        assert!(read.url.is_none());
        assert!(read.icon.is_none());
    }

    /// A shortcut nobody has followed a link out of has no mark yet, and a `.webloc`
    /// never carries one, so the row falls back to the globe.
    #[test]
    fn a_shortcut_with_no_mark_has_no_favicon() {
        let bare = shortcut_note(
            "A.url".to_string(),
            "[InternetShortcut]\nURL=https://a.example/\n",
        );
        assert!(bare.favicon.is_none());

        // The key is matched however it is cased, and a value of nothing is nothing.
        assert_eq!(
            favicon_of("nib-icon=https://a.example/i.png").as_deref(),
            Some("https://a.example/i.png")
        );
        assert!(favicon_of("Nib-Icon=   ").is_none());
        assert!(favicon_of("URL=https://a.example/").is_none());
    }

    #[test]
    fn a_notes_name_is_its_own_and_loses_only_its_extension() {
        // The extension is what follows the last dot, so a name that holds one of
        // its own keeps it.
        let dotted = note_at("Work/v1.2 plan.md".to_string(), "");
        assert_eq!(dotted.name, "v1.2 plan");
        assert_eq!(note_at("Idea.md".to_string(), "").name, "Idea");
    }

    fn targets(body: &str) -> Vec<String> {
        links_in(body).into_iter().map(|one| one.target).collect()
    }

    /// A percent followed by a character wider than the two bytes an escape is
    /// spelled in. The two bytes after the percent are a slice of the note, and
    /// the second of them falls inside that character rather than after it.
    ///
    /// This is a note's own text, so it reaches here from a file: one written in
    /// Nib, one that arrived by sync, one somebody sent. The release build aborts
    /// on a panic, so the whole app went with the scan.
    #[test]
    fn a_percent_before_a_wide_character_is_text() {
        assert_eq!(decode("%€"), "%€");
        assert_eq!(decode("a%€b"), "a%€b");
        assert_eq!(decode("%😀 and more"), "%😀 and more");
        assert_eq!(targets("see [x](%€) now"), vec!["%€"]);

        // And the escapes that are escapes still are.
        assert_eq!(decode("My%20Note.md"), "My Note.md");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(decode("%zz"), "%zz");
        assert_eq!(decode("%2f"), "/");
        assert_eq!(decode("%2F"), "/");
        // A sign is not a hexadecimal digit, whatever `from_str_radix` takes.
        assert_eq!(decode("%+1"), "%+1");
        assert_eq!(decode("%-1"), "%-1");
    }

    #[test]
    fn finds_a_wikilink_in_every_spelling() {
        assert_eq!(targets("see [[Other Note]] now"), vec!["Other Note"]);
        assert_eq!(targets("[[Note|shown]]"), vec!["Note"]);
        assert_eq!(targets("[[Note#Heading]]"), vec!["Note"]);
        assert_eq!(targets("[[folder/Note.md]]"), vec!["folder/Note.md"]);
        assert_eq!(targets("[[ Note ]]"), vec!["Note"]);
    }

    #[test]
    fn reads_what_a_wikilink_says() {
        let links = links_in("![[Note#Heading|shown]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].heading.as_deref(), Some("Heading"));
        assert_eq!(links[0].alias.as_deref(), Some("shown"));
        assert!(links[0].embed);

        let block = links_in("[[Note#^abc123]]");
        assert_eq!(block[0].block.as_deref(), Some("abc123"));
        assert_eq!(block[0].heading, None);
    }

    #[test]
    fn an_empty_link_is_not_one() {
        assert!(targets("[[]]").is_empty());
        assert!(targets("[[a]b]]").is_empty());
        assert!(targets("[[|only an alias]]").is_empty());
    }

    #[test]
    fn a_same_note_anchor_has_no_target() {
        let links = links_in("[[#Heading]]");
        assert_eq!(links[0].target, "");
        assert_eq!(links[0].heading.as_deref(), Some("Heading"));
    }

    #[test]
    fn an_escaped_bracket_is_text() {
        assert!(targets("\\[[Note]]").is_empty());
    }

    #[test]
    fn code_holds_no_links() {
        assert!(targets("write `[[Note]]` to link").is_empty());
        assert_eq!(targets("```\n[[Note]]\n```\n[[Real]]"), vec!["Real"]);
        assert_eq!(targets("`` ` [[Note]] `` [[Real]]"), vec!["Real"]);
    }

    #[test]
    fn a_code_span_that_never_closes_is_text() {
        assert_eq!(targets("` [[Note]]"), vec!["Note"]);
    }

    #[test]
    fn blanking_code_keeps_the_line_the_same_length() {
        let line = "a `b c` d";
        assert_eq!(without_code(line).chars().count(), line.chars().count());
        // And a line with no span in it at all is the line itself rather than a
        // copy of it, which is nearly every line of a space.
        assert!(matches!(
            without_code("see [[Note]] now"),
            std::borrow::Cow::Borrowed(_)
        ));
    }

    #[test]
    fn an_internal_markdown_link_counts_and_a_web_one_does_not() {
        assert_eq!(
            targets("see [the note](notes/Other.md) here"),
            vec!["notes/Other.md"]
        );
        assert!(targets("[x](https://x.dev) [y](mailto:a@b.dev)").is_empty());
        assert!(targets("[y](//x.dev/a)").is_empty());
    }

    #[test]
    fn a_markdown_target_loses_its_encoding_and_keeps_its_heading() {
        let links = links_in("[x](My%20Note.md#a-heading)");
        assert_eq!(links[0].target, "My Note.md");
        assert_eq!(links[0].heading.as_deref(), Some("a-heading"));
    }

    #[test]
    fn an_angled_markdown_target_holds_spaces() {
        assert_eq!(targets("[x](<My Note.md>)"), vec!["My Note.md"]);
    }

    #[test]
    fn a_markdown_title_does_not_end_up_in_the_target() {
        assert_eq!(targets("[x](Note.md \"A title\")"), vec!["Note.md"]);
    }

    #[test]
    fn several_links_on_one_line_all_count() {
        assert_eq!(targets("[[A]] and [[B|b]] and ![[C]]"), vec!["A", "B", "C"]);
    }

    /// A note arrives from a share, a room or a folder somebody synced, and every
    /// note of a space is read on one pass whose answer is held whole. Both halves
    /// of this were a line: the work done per `[` and the links kept per note.
    ///
    /// What the reading does is bounded rather than timed. A `[` that turns out not
    /// to open a link moves the walk on by one character, so a scan that runs to the
    /// end of the line is a scan repeated for every `[` on it - and a line of
    /// `[a](` with no `)` anywhere is that line read once per character, with a
    /// string of half of it built and dropped each time. A stopwatch would say the
    /// same thing and say it differently on a busy machine; this says which links
    /// there are.
    #[test]
    fn a_link_longer_than_any_link_is_not_one() {
        let target = "x".repeat(super::LONGEST_LINK);
        assert!(links_in(&format!("[a]({target}.md)")).is_empty());

        // A label nobody would write, for the same reason.
        let label = "y".repeat(super::LONGEST_LINK);
        assert!(links_in(&format!("[{label}](Note.md)")).is_empty());

        // And a link of a size anybody writes is still a link.
        let path = "x".repeat(200);
        assert_eq!(links_in(&format!("[a]({path}.md)")).len(), 1);
    }

    #[test]
    fn a_line_of_half_written_links_is_a_line_of_none() {
        assert!(links_in(&"[a](".repeat(5_000)).is_empty());
        assert!(links_in(&"[[a".repeat(5_000)).is_empty());
    }

    #[test]
    fn a_note_says_where_it_points_only_so_many_times() {
        let many = "[[A]] ".repeat(20_000);
        let found = links_in(&many);

        assert_eq!(found.len(), super::MOST_LINKS);
        // And the line each is read in is still there, which is what makes the
        // ceiling worth having.
        assert!(found[0].text.len() <= super::LINE);
    }

    /// The ceiling is per note rather than per line, and the lines after it are
    /// still read for their headings and their blocks.
    #[test]
    fn what_is_past_the_ceiling_is_the_links_and_nothing_else() {
        let body = format!("{}\n## Later\n", "[[A]] ".repeat(6000));
        let read = prose(&body);

        assert_eq!(read.links.len(), super::MOST_LINKS);
        assert_eq!(read.headings, vec!["Later"]);
    }

    #[test]
    fn a_link_carries_its_line_and_the_words_around_it() {
        let links = links_in("first\nsecond [[Note]] third");
        assert_eq!(links[0].line, 1);
        assert_eq!(links[0].text, "second [[Note]] third");
    }

    #[test]
    fn finds_the_headings_and_nothing_else() {
        assert_eq!(headings_in("# One\ntext\n## Two ##"), vec!["One", "Two"]);
        assert_eq!(
            headings_in("#notatag\n####### too many"),
            Vec::<String>::new()
        );
        assert_eq!(headings_in("```\n# In code\n```"), Vec::<String>::new());
    }

    #[test]
    fn a_heading_may_be_indented_up_to_three_spaces() {
        assert_eq!(heading_of("   # Three").as_deref(), Some("Three"));
        assert_eq!(heading_of("    # Four"), None);
    }

    #[test]
    fn a_block_name_ends_a_line_and_starts_a_word() {
        assert_eq!(
            block_id_of("Some paragraph. ^abc123").as_deref(),
            Some("abc123")
        );
        assert_eq!(block_id_of("^on-its-own").as_deref(), Some("on-its-own"));
        assert_eq!(block_id_of("a^b"), None);
        assert_eq!(block_id_of("^abc in the middle"), None);
        assert_eq!(block_id_of("x^2^ is a superscript"), None);
    }

    /// A canvas keeps its icon under `nib`, since a JSON file has no front matter.
    /// Every case here has its twin in `apps/desktop/src/lib/scan-note.test.ts`.
    #[test]
    fn reads_the_icon_a_canvas_wears() {
        let read = canvas_note(
            "boards/Board.canvas".to_string(),
            r#"{"nodes":[],"edges":[],"nib":{"version":1,"icon":"rocket"}}"#,
        );

        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.name, "Board.canvas");
        assert_eq!(read.path, "boards/Board.canvas");
    }

    #[test]
    fn a_canvas_that_says_nothing_wears_nothing() {
        let plain = canvas_note("Board.canvas".to_string(), r#"{"nodes":[],"edges":[]}"#);
        assert_eq!(plain.icon, None);

        let blank = canvas_note(
            "Board.canvas".to_string(),
            r#"{"nodes":[],"nib":{"icon":"   "}}"#,
        );
        assert_eq!(blank.icon, None);

        // A file that is not JSON at all is a canvas nobody has drawn on yet.
        let broken = canvas_note("Board.canvas".to_string(), "not json");
        assert_eq!(broken.icon, None);
        assert!(broken.links.is_empty());
    }

    #[test]
    fn a_card_that_names_a_file_is_a_link_out_of_the_canvas() {
        let read = canvas_note(
            "Board.canvas".to_string(),
            concat!(
                r##"{"nodes":["##,
                r##"{"id":"a","type":"file","file":"Plan.md"},"##,
                r##"{"id":"b","type":"file","file":"Plan.md","subpath":"#Later"},"##,
                r##"{"id":"c","type":"file","file":"Plan.md","subpath":"#^abc123"},"##,
                r##"{"id":"d","type":"text","text":"[[Not a link out of here]]"}"##,
                r##"],"edges":[]}"##
            ),
        );

        let targets: Vec<&str> = read.links.iter().map(|link| link.target.as_str()).collect();
        assert_eq!(targets, vec!["Plan.md", "Plan.md", "Plan.md"]);
        assert_eq!(read.links[0].heading, None);
        assert_eq!(read.links[1].heading.as_deref(), Some("Later"));
        assert_eq!(read.links[2].block.as_deref(), Some("abc123"));
        assert!(read.headings.is_empty());
    }

    #[test]
    fn the_index_keeps_each_tag_once_folded_and_without_the_hash() {
        assert_eq!(
            note_tags("#Work/Nib twice: #work/nib and #plans"),
            vec!["work/nib".to_string(), "plans".to_string()]
        );
        assert!(note_tags("nothing here").is_empty());
    }

    #[test]
    fn a_canvas_carries_no_tags() {
        let read = canvas_note(
            "Board.canvas".to_string(),
            r##"{"nodes":[{"id":"a","type":"text","text":"#work"}],"edges":[]}"##,
        );

        assert!(read.tags.is_empty());
    }
}
