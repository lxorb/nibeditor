//! The words of an Apple Notes note, out of the shape Notes keeps them in.
//!
//! A note's body is not text on a row. It is a gzipped protobuf in
//! `ZICNOTEDATA.ZDATA`, holding the note's plain text once and a list of runs
//! over it saying what each stretch of it is: a heading, an item of a list, a
//! box, bold, a link, or the place an attachment sits.
//!
//! That is the shape Obsidian's importer reads, and this is a port of the reading
//! into Rust - the same field numbers, the same style numbers. The importer is
//! MIT; the protobuf shape it carries is Ciofeca Forensics' reverse engineering of
//! the format, MIT as well.
//!
//! Nothing here opens a database or a file, which is the point: a Mac is the only
//! machine that has the database, and the reading of what is on a row is bytes and
//! arithmetic. So this is built and tested on every platform the app is built for,
//! and only the store reader beside it is a Mac's own; see `lib.rs`.
//!
//! What a run becomes is nib's own markdown rather than Obsidian's: `==marked==`
//! for a highlight with no coloured circle in front of it, `^up^` and `~down~`
//! for a raised and a lowered run, `- [x]` for a ticked box.

use std::collections::HashMap;
use std::io::Read;

use flate2::read::{GzDecoder, ZlibDecoder};

/// Where an attachment sits in the words. Notes writes one of these per
/// attachment and says what it is in a run beside it.
const OBJECT: char = '\u{fffc}';

/// A line break inside a paragraph, which is what Notes writes for a return held
/// with shift. The paragraph's style does not start again after one.
const SOFT: char = '\u{2028}';

/// The style of a paragraph that is only a paragraph.
const PLAIN: i32 = -1;
/// The note's own title, which is its first line.
const TITLE: i32 = 0;
const HEADING: i32 = 1;
const SUBHEADING: i32 = 2;
/// A monospaced paragraph, which is a code block one line at a time.
const CODE: i32 = 4;
const DOTTED: i32 = 100;
const DASHED: i32 = 101;
const NUMBERED: i32 = 102;
const CHECKBOX: i32 = 103;

/// Bold, italic, and the two at once, as `fontWeight` counts them.
const BOLD: i32 = 1;
const ITALIC: i32 = 2;
const BOLD_ITALIC: i32 = 3;

/// How far a run is raised or lowered.
const SUPER: i32 = 1;
const SUB: i32 = -1;

/// How many spaces one level of a list is indented by, which is what nib's own
/// markdown writes: the width of `- `, so a nested line lines up under the words
/// above it.
const STEP: &str = "  ";

/// How deep a line may say it sits. The depth is a number out of the blob and
/// `prefix` writes a step for each of it, so a line claiming four billion levels
/// is eight gigabytes of indent - which is not a deeply nested note but an import
/// that runs the machine out of memory. Deeper than anybody nests a list.
const DEEPEST: u32 = 32;

/// The most one row may inflate to. A few megabytes of gzip can name gigabytes of
/// nothing, and what comes of reading that is not an error but the import taking
/// the machine with it. Far more words than Notes lets one note hold.
const MOST_BYTES: u64 = 64 * 1024 * 1024;

/// What Notes says about one stretch of a note's text.
struct Run {
    /// How many UTF-16 units of the text this run covers, which is how Notes
    /// counts: an emoji is two.
    length: usize,
    /// Which paragraph this is, as `styleType` numbers them.
    style: i32,
    /// How deep in a list, counting from zero.
    indent: u32,
    /// Whether a box is ticked, for a paragraph that is one.
    done: Option<bool>,
    quote: bool,
    /// Bold, italic or both, as `fontWeight` counts them.
    weight: i32,
    underlined: bool,
    /// Notes stores this as a number rather than a flag, and so does this.
    struck: i32,
    /// Raised, lowered, or neither.
    baseline: i32,
    /// One of the five colours a highlight can be. Which one is not carried
    /// over: nib has one highlight, and a note full of coloured circles is not
    /// a note anybody wrote.
    emphasis: i32,
    link: Option<String>,
    /// The attachment sitting here: its identifier, and what kind it is.
    attachment: Option<(String, String)>,
}

impl Default for Run {
    fn default() -> Self {
        Self {
            length: 0,
            // Not zero: zero is the title, and a run that says nothing about its
            // paragraph is a paragraph.
            style: PLAIN,
            indent: 0,
            done: None,
            quote: false,
            weight: 0,
            underlined: false,
            struck: 0,
            baseline: 0,
            emphasis: 0,
            link: None,
            attachment: None,
        }
    }
}

/// A note as Notes stored it: its plain text, and the runs over it. An empty one
/// is a row Notes wrote nothing into, which is what a note made and never typed
/// in leaves behind.
#[derive(Default)]
pub struct Body {
    /// UTF-16 units, because that is what a run's length counts.
    text: Vec<u16>,
    /// In the order they cover the text.
    runs: Vec<Run>,
}

/// What an attachment becomes in the words. The words are the only thing this
/// module knows about an attachment; which file it is and whether that file is
/// on the disk is the database's business.
pub trait Parts {
    /// What sits at this attachment, or nothing at all for one that has no words
    /// and no file.
    fn attachment(&mut self, id: &str, uti: &str) -> Option<String>;
}

/// One note's body, out of the bytes on its row. None for bytes that are not a
/// note: a row Notes left empty, or one written by a version this cannot read.
pub fn decode(data: &[u8]) -> Option<Body> {
    let bytes = inflate(data)?;
    let note = held(&bytes, 2).and_then(|document| held(document, 3));

    // A `NoteStoreProto` holds a `Document` under field 2, which holds the `Note`
    // under field 3, and the note is the text and the runs over it. A row that is
    // a `Document` already is read as one as well: the two are told apart by which
    // field is there, and a reader that insisted on the wrapper would answer
    // nothing at all for a row written without it.
    let note = note.or_else(|| held(&bytes, 3))?;

    Some(note_of(note))
}

/// The bytes of one length-delimited field of a message, or None where the message
/// has no such field or holds something else under it.
fn held(bytes: &[u8], number: u32) -> Option<&[u8]> {
    Fields::new(bytes).find_map(|(held, value)| match value {
        Value::Bytes(inside) if held == number => Some(inside),
        _ => None,
    })
}

/// The note's own first line, which is the title Notes shows in its list. The
/// title on the row is the same words cut short, so this is the one to use.
pub fn title(body: &Body) -> Option<String> {
    let text = String::from_utf16_lossy(&body.text);

    for line in text.split(['\n', SOFT]) {
        let said = line.replace(OBJECT, "").trim().to_string();
        if !said.is_empty() {
            return Some(said);
        }
    }

    None
}

/// The note, as markdown.
pub fn markdown(body: &Body, parts: &mut dyn Parts) -> String {
    let mut out = String::new();
    let mut fenced = false;
    let mut counted = 0_u32;
    let mut counting = (PLAIN, 0_u32);

    for line in lines_of(body) {
        let run = line.run().unwrap_or(&DEFAULT);
        // A line with nothing on it carries no run of its own, so what it is is
        // what it sits in: a blank line between two monospaced paragraphs is part
        // of the code, and closing the fence over it and opening another would cut
        // one block of code into two.
        let code = line.run().map_or(fenced, |one| one.style == CODE);

        // A fence is opened once for however many monospaced paragraphs follow
        // each other, which is what they were on screen: one block of code.
        if code != fenced {
            out.push_str("```\n");
            fenced = code;
        }

        // The second half of a paragraph is the same item: it carries no number of
        // its own, so it does not take the next one either.
        if !line.soft {
            if run.style == NUMBERED && counting == (NUMBERED, run.indent) {
                counted += 1;
            } else {
                counted = 1;
                counting = (run.style, run.indent);
            }
        }

        let words = inline(&line, parts);

        if fenced {
            out.push_str(&words);
        } else {
            out.push_str(&prefix(run, line.soft, counted));
            // Not the line breaks: those are an attachment that is a block of its own,
            // a table or a scan, asking for the blank line a block needs above it.
            out.push_str(words.trim_start_matches(|one: char| one.is_whitespace() && one != '\n'));
        }

        out.push('\n');
    }

    if fenced {
        out.push_str("```\n");
    }

    tidy(&out)
}

/// A run that says nothing, for a line with nothing in it at all.
const DEFAULT: Run = Run {
    length: 0,
    style: PLAIN,
    indent: 0,
    done: None,
    quote: false,
    weight: 0,
    underlined: false,
    struck: 0,
    baseline: 0,
    emphasis: 0,
    link: None,
    attachment: None,
};

/// One line of the note: the pieces it is made of, each with the run it came
/// out of.
struct Line<'a> {
    pieces: Vec<(&'a Run, String)>,
    /// Whether this line is the second half of a paragraph rather than a
    /// paragraph of its own, which is what a return held with shift makes.
    soft: bool,
}

impl<'a> Line<'a> {
    /// The run the line's style comes from, which is its first: Notes styles a
    /// paragraph, and the first run of one carries what that style is.
    fn run(&self) -> Option<&'a Run> {
        self.pieces.first().map(|(run, _)| *run)
    }
}

/// The note's text cut into lines, with each line's pieces still knowing which
/// run they came from.
fn lines_of(body: &Body) -> Vec<Line<'_>> {
    let mut lines = vec![Line {
        pieces: Vec::new(),
        soft: false,
    }];
    let mut at = 0_usize;

    for run in &body.runs {
        let end = at.saturating_add(run.length).min(body.text.len());
        let said = String::from_utf16_lossy(&body.text[at..end]);
        at = end;

        let mut first = true;
        let mut soft = false;

        for part in said.split_inclusive(['\n', SOFT]) {
            if !first {
                lines.push(Line {
                    pieces: Vec::new(),
                    soft,
                });
            }
            first = false;

            soft = part.ends_with(SOFT);
            let words = part.trim_end_matches(['\n', SOFT]);

            if let Some(line) = lines.last_mut() {
                if !words.is_empty() {
                    line.pieces.push((run, words.to_string()));
                }
            }
        }

        // A run that ends on a break leaves the next line to the run after it.
        if said.ends_with('\n') || said.ends_with(SOFT) {
            lines.push(Line {
                pieces: Vec::new(),
                soft: said.ends_with(SOFT),
            });
        }
    }

    // A note ending on a break leaves a line with nothing on it, and that is not a
    // line of the note: the words end where the last of them are. Dropped here
    // rather than trimmed afterwards, because a note ending in a block of code
    // would otherwise hold its fence open over it.
    if lines.last().is_some_and(|line| line.pieces.is_empty()) {
        lines.pop();
    }

    lines
}

/// What a line starts with: its box, its bullet, its hashes, its quote mark and
/// however deep in a list it sits.
fn prefix(run: &Run, soft: bool, counted: u32) -> String {
    let step = usize::try_from(run.indent).unwrap_or(0);
    let pad = STEP.repeat(step);
    let quote = if run.quote { "> " } else { "" };

    // The second half of a paragraph carries no marker: it is the same item, so
    // it is indented under the words above it instead.
    if soft {
        let listed = matches!(run.style, DOTTED | DASHED | NUMBERED | CHECKBOX);
        return format!("{quote}{pad}{}", if listed { STEP } else { "" });
    }

    match run.style {
        TITLE => format!("{quote}# "),
        HEADING => format!("{quote}## "),
        SUBHEADING => format!("{quote}### "),
        DOTTED | DASHED => format!("{quote}{pad}- "),
        NUMBERED => format!("{quote}{pad}{counted}. "),
        CHECKBOX => {
            let box_ = if run.done == Some(true) { 'x' } else { ' ' };
            format!("{quote}{pad}- [{box_}] ")
        }
        _ => format!("{quote}{pad}"),
    }
}

/// One line's words, with what each run says about them written around them.
fn inline(line: &Line, parts: &mut dyn Parts) -> String {
    let mut out = String::new();

    for (run, said) in &line.pieces {
        if let Some((id, uti)) = &run.attachment {
            if let Some(words) = parts.attachment(id, uti) {
                out.push_str(&words);
            }
            continue;
        }

        out.push_str(&wrapped(run, said));
    }

    out
}

/// One piece of a line, with its marks around it.
///
/// The spaces at either end stay outside the marks, because `** bold **` is not
/// bold in any reader: a run of Apple's is as likely to start with a space as
/// not, since it ends wherever the formatting changes.
fn wrapped(run: &Run, said: &str) -> String {
    let said = said.replace(OBJECT, "");
    if said.trim().is_empty() {
        return said;
    }

    let front = said.len() - said.trim_start().len();
    let back = said.len() - said.trim_end().len();
    let (before, rest) = said.split_at(front);
    let (words, after) = rest.split_at(rest.len() - back);

    let mut marked = escaped(words);

    marked = match run.weight {
        BOLD => format!("**{marked}**"),
        ITALIC => format!("*{marked}*"),
        BOLD_ITALIC => format!("***{marked}***"),
        _ => marked,
    };

    if run.struck != 0 {
        marked = format!("~~{marked}~~");
    }

    if run.underlined {
        // nib has no mark of its own for an underline, and this is the one every
        // markdown reader draws as one.
        marked = format!("<u>{marked}</u>");
    }

    marked = match run.baseline {
        SUPER => format!("^{marked}^"),
        SUB => format!("~{marked}~"),
        _ => marked,
    };

    if let Some(link) = &run.link {
        if link != &marked {
            marked = format!("[{marked}]({link})");
        }
    }

    if run.emphasis != 0 {
        marked = format!("=={marked}==");
    }

    format!("{before}{marked}{after}")
}

/// The two characters a note's own words would otherwise become a link with.
/// Everything else is left as it was: a note that says `5 * 3` says that.
fn escaped(words: &str) -> String {
    words.replace('[', "\\[").replace(']', "\\]")
}

/// Blank lines collapsed and the ends trimmed, which is what every other reader
/// in the import hands over.
fn tidy(markdown: &str) -> String {
    let mut out = String::new();
    let mut blank = 0_u32;

    for line in markdown.lines() {
        let said = line.trim_end();
        if said.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }

        out.push_str(said);
        out.push('\n');
    }

    out.trim().to_string()
}

// ── Tables and scans ──────────────────────────────────────────────────

/// A table inside a note, as a markdown table, or None for bytes that are not one.
///
/// A table is not on the note's row. It is an attachment with a row of its own, whose
/// `ZMERGEABLEDATA1` is a gzipped `MergableDataProto`: the document Notes merges when two
/// devices edit the same table at once. So nothing in it is where it is drawn. There is a
/// list of objects, and every reference is an index into it; the rows and the columns are
/// two ordered sets of identifiers, each saying where an identifier sits; and the cells
/// are a dictionary from a column's identifier to a dictionary from a row's identifier to
/// a note of its own - which is a `Body` like any other, so its words are written the way
/// a note's are. This is Obsidian's importer's reading (`convert-table.ts`), field for
/// field.
///
/// The first row is the header, because markdown's table has one and Notes' does not:
/// that is what every table somebody makes in Notes looks like anyway. A cell's line
/// breaks become `<br>` and its pipes are escaped, so a row stays one row. Notes cannot
/// merge two cells, so there is nothing to flatten.
pub fn table(data: &[u8], parts: &mut dyn Parts) -> Option<String> {
    let bytes = inflate(data)?;
    let store = Store::of(&bytes)?;
    let root = store.objects.iter().find_map(|one| {
        one.map
            .as_ref()
            .filter(|map| store.type_is(map.kind, TABLE_TYPE))
    })?;

    let (mut rows, mut columns, mut cells) = (None, None, None);
    for (key, value) in &root.entries {
        let object = value.object.and_then(|at| store.objects.get(at));
        match store.key(*key) {
            Some(ROWS) => rows = object.and_then(|one| store.places(one)),
            Some(COLUMNS) => columns = object.and_then(|one| store.places(one)),
            Some(CELLS) => cells = object,
            _ => {}
        }
    }

    let ((rows, height), (columns, width)) = (rows?, columns?);
    if height == 0 || width == 0 {
        return None;
    }

    let mut grid = vec![vec![String::new(); width]; height];
    for (column, held) in &cells?.dictionary {
        let Some(across) = store
            .target(column)
            .and_then(|id| columns.get(&id).copied())
        else {
            continue;
        };
        let Some(column) = held.object.and_then(|at| store.objects.get(at)) else {
            continue;
        };

        for (row, cell) in &column.dictionary {
            let Some(down) = store.target(row).and_then(|id| rows.get(&id).copied()) else {
                continue;
            };
            let body = cell
                .object
                .and_then(|at| store.objects.get(at))
                .and_then(|one| one.note.as_ref());
            if let (Some(body), Some(slot)) = (
                body,
                grid.get_mut(down).and_then(|line| line.get_mut(across)),
            ) {
                *slot = cell_words(body, parts);
            }
        }
    }

    Some(grid_markdown(&grid))
}

/// The pages a scan holds, in order: the identifier of each page's own image attachment,
/// whose file the database says where to find. A scan is a gallery in `ZMERGEABLEDATA1`,
/// like a table, and each of its objects that is a map names one page as its first
/// entry's string; see Obsidian's importer, `convert-scan.ts`.
pub fn gallery(data: &[u8]) -> Vec<String> {
    let Some(store) = inflate(data).and_then(|bytes| Store::of(&bytes)) else {
        return Vec::new();
    };

    store
        .objects
        .into_iter()
        .filter_map(|one| one.map?.entries.into_iter().next()?.1.text)
        .filter(|id| !id.is_empty())
        .collect()
}

/// The type the root of a table's document has.
const TABLE_TYPE: &str = "com.apple.notes.ICTable";
/// The root's three keys: where each row sits, where each column sits, and the cells.
const ROWS: &str = "crRows";
const COLUMNS: &str = "crColumns";
const CELLS: &str = "cellColumns";

/// The most rows or columns a table is read with. Notes stops long before this; a set
/// claiming millions is a blob somebody wrote by hand, and a grid that size would be the
/// import running out of memory rather than a table.
const MOST_CELLS: usize = 1024;

/// One cell's words, on one line.
fn cell_words(body: &Body, parts: &mut dyn Parts) -> String {
    markdown(body, parts)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("<br>")
        .replace('|', "\\|")
}

/// The grid as a markdown table, the first row its header.
fn grid_markdown(grid: &[Vec<String>]) -> String {
    let mut out = Vec::with_capacity(grid.len() + 1);

    for (at, cells) in grid.iter().enumerate() {
        out.push(format!("| {} |", cells.join(" | ")));
        if at == 0 {
            out.push(format!("|{}", " --- |".repeat(cells.len())));
        }
    }

    out.join("\n")
}

/// A reference in the merged document: a number, a string, or an index into its list
/// of objects.
#[derive(Default)]
struct Id {
    number: Option<u64>,
    text: Option<String>,
    object: Option<usize>,
}

/// A map in the document: its type, as an index into the types, and its entries, each
/// an index into the keys and a reference.
struct Map {
    kind: usize,
    entries: Vec<(usize, Id)>,
}

/// One object of the document: the parts of one a table or a scan is made of.
#[derive(Default)]
struct Object {
    map: Option<Map>,
    dictionary: Vec<(Id, Id)>,
    /// An ordered set's identifiers in the order they are drawn.
    order: Vec<Vec<u8>>,
    /// And which identifier each element of the set is.
    placed: Vec<(Id, Id)>,
    note: Option<Body>,
}

/// A merged document, read: its objects, and the three lists they index into.
#[derive(Default)]
struct Store {
    objects: Vec<Object>,
    keys: Vec<String>,
    types: Vec<String>,
    uuids: Vec<Vec<u8>>,
}

impl Store {
    /// A `MergableDataProto`: field 2 holds the object, whose field 3 holds the data.
    fn of(bytes: &[u8]) -> Option<Self> {
        let data = held(held(bytes, 2)?, 3)?;
        let mut store = Self::default();

        for (number, value) in Fields::new(data) {
            if let Value::Bytes(said) = value {
                match number {
                    3 => store.objects.push(object_of(said)),
                    4 => store.keys.push(text_of(said)),
                    5 => store.types.push(text_of(said)),
                    6 => store.uuids.push(said.to_vec()),
                    _ => {}
                }
            }
        }

        Some(store)
    }

    fn key(&self, at: usize) -> Option<&str> {
        self.keys.get(at).map(String::as_str)
    }

    fn type_is(&self, at: usize, name: &str) -> bool {
        self.types.get(at).is_some_and(|one| one == name)
    }

    /// The identifier a reference ends at: the object it names is a map whose first
    /// entry is an index into the identifiers.
    fn target(&self, reference: &Id) -> Option<Vec<u8>> {
        let object = self.objects.get(reference.object?)?;
        let first = &object.map.as_ref()?.entries.first()?.1;
        let at = usize::try_from(first.number?).ok()?;
        self.uuids.get(at).cloned()
    }

    /// Where each row or column sits, by its identifier, and how many there are.
    fn places(&self, object: &Object) -> Option<(HashMap<Vec<u8>, usize>, usize)> {
        let count = object.order.len();
        if count > MOST_CELLS {
            return None;
        }

        let mut places = HashMap::new();
        for (key, value) in &object.placed {
            let (Some(key), Some(value)) = (self.target(key), self.target(value)) else {
                continue;
            };
            if let Some(at) = object.order.iter().position(|one| *one == key) {
                places.insert(value, at);
            }
        }

        Some((places, count))
    }
}

/// One `MergeableDataObjectEntry`.
fn object_of(bytes: &[u8]) -> Object {
    let mut object = Object::default();

    for (number, value) in Fields::new(bytes) {
        let Value::Bytes(said) = value else { continue };
        match number {
            6 => object.dictionary = elements_of(said),
            10 => object.note = Some(note_of(said)),
            13 => object.map = Some(map_of(said)),
            16 => ordered_of(said, &mut object),
            _ => {}
        }
    }

    object
}

/// An index out of the blob, or one that indexes nothing where it does not fit.
fn index(said: u64) -> usize {
    usize::try_from(said).unwrap_or(usize::MAX)
}

/// A `MergeableDataObjectMap`.
fn map_of(bytes: &[u8]) -> Map {
    let mut map = Map {
        kind: usize::MAX,
        entries: Vec::new(),
    };

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => map.kind = index(said),
            (3, Value::Bytes(entry)) => {
                let mut key = usize::MAX;
                let mut id = Id::default();
                for (number, value) in Fields::new(entry) {
                    match (number, value) {
                        (1, Value::Number(at)) => key = index(at),
                        (2, Value::Bytes(inside)) => id = id_of(inside),
                        _ => {}
                    }
                }
                map.entries.push((key, id));
            }
            _ => {}
        }
    }

    map
}

/// An `ObjectID`.
fn id_of(bytes: &[u8]) -> Id {
    let mut id = Id::default();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (2, Value::Number(said)) => id.number = Some(said),
            (4, Value::Bytes(said)) => id.text = Some(text_of(said)),
            (6, Value::Number(said)) => id.object = usize::try_from(said).ok(),
            _ => {}
        }
    }

    id
}

/// A `Dictionary`: its elements, each a key and a value.
fn elements_of(bytes: &[u8]) -> Vec<(Id, Id)> {
    let mut elements = Vec::new();

    for (number, value) in Fields::new(bytes) {
        let (1, Value::Bytes(element)) = (number, value) else {
            continue;
        };
        let (mut key, mut value) = (Id::default(), Id::default());
        for (number, inside) in Fields::new(element) {
            match (number, inside) {
                (1, Value::Bytes(said)) => key = id_of(said),
                (2, Value::Bytes(said)) => value = id_of(said),
                _ => {}
            }
        }
        elements.push((key, value));
    }

    elements
}

/// An `OrderedSet`: its ordering's array of identifiers, and its ordering's contents,
/// which say which identifier each element is.
fn ordered_of(bytes: &[u8], object: &mut Object) {
    let Some(ordering) = held(bytes, 1) else {
        return;
    };

    if let Some(array) = held(ordering, 1) {
        for (number, value) in Fields::new(array) {
            if let (2, Value::Bytes(attachment)) = (number, value) {
                if let Some(uuid) = held(attachment, 2) {
                    object.order.push(uuid.to_vec());
                }
            }
        }
    }

    if let Some(contents) = held(ordering, 2) {
        object.placed = elements_of(contents);
    }
}

// ── The protobuf ──────────────────────────────────────────────────────

/// One field of a message: a number, or the bytes of a string or a message
/// inside it.
enum Value<'a> {
    Number(u64),
    Bytes(&'a [u8]),
}

/// A message being walked, a field at a time. Enough protobuf to read what
/// Notes wrote and no more: the two wire types it uses, plus the two fixed
/// widths, stepped over rather than read.
struct Fields<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Fields<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    /// The next variable-width number, or nothing where the bytes run out.
    fn varint(&mut self) -> Option<u64> {
        let mut value = 0_u64;
        let mut shift = 0_u32;

        while let Some(byte) = self.bytes.get(self.at) {
            self.at += 1;
            value |= u64::from(byte & 0x7f) << shift;

            if byte & 0x80 == 0 {
                return Some(value);
            }

            shift += 7;
            if shift > 63 {
                return None;
            }
        }

        None
    }

    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(count)?;
        let taken = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(taken)
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = (u32, Value<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        let tag = self.varint()?;
        let number = u32::try_from(tag >> 3).ok()?;

        match tag & 7 {
            0 => Some((number, Value::Number(self.varint()?))),
            1 => Some((number, Value::Number(number_of(self.take(8)?)))),
            2 => {
                let count = usize::try_from(self.varint()?).ok()?;
                Some((number, Value::Bytes(self.take(count)?)))
            }
            5 => Some((number, Value::Number(number_of(self.take(4)?)))),
            _ => None,
        }
    }
}

/// A fixed-width field as a number. Nothing read here is one - a font's size is
/// the only float Notes writes and nothing needs it - so this exists to step
/// over them without losing the fields after.
fn number_of(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .rev()
        .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte))
}

/// A signed field, which protobuf writes as the same bits an unsigned one has.
/// `styleType` is the reason its sign matters: a run that says nothing about its
/// paragraph means -1, and -1 is written as the widest number there is.
fn signed(value: u64) -> i32 {
    let low = u32::try_from(value & 0xffff_ffff).unwrap_or(0);
    i32::from_ne_bytes(low.to_ne_bytes())
}

fn text_of(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

/// The note inside a `Document`: its text once, and a run per stretch of it.
fn note_of(bytes: &[u8]) -> Body {
    let mut text = Vec::new();
    let mut runs = Vec::new();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (2, Value::Bytes(said)) => text = text_of(said).encode_utf16().collect(),
            (5, Value::Bytes(run)) => runs.push(run_of(run)),
            _ => {}
        }
    }

    Body { text, runs }
}

/// One `AttributeRun`.
fn run_of(bytes: &[u8]) -> Run {
    let mut run = Run::default();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => run.length = usize::try_from(said).unwrap_or(0),
            (2, Value::Bytes(said)) => paragraph_of(said, &mut run),
            (5, Value::Number(said)) => run.weight = signed(said),
            (6, Value::Number(said)) => run.underlined = said != 0,
            (7, Value::Number(said)) => run.struck = signed(said),
            (8, Value::Number(said)) => run.baseline = signed(said),
            (9, Value::Bytes(said)) => run.link = Some(text_of(said)),
            (12, Value::Bytes(said)) => run.attachment = attachment_of(said),
            (14, Value::Number(said)) => run.emphasis = signed(said),
            _ => {}
        }
    }

    run
}

/// One `ParagraphStyle`, which is what says a line is a heading, an item or a
/// box, and how deep it sits.
fn paragraph_of(bytes: &[u8], run: &mut Run) {
    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => run.style = signed(said),
            (4, Value::Number(said)) => {
                run.indent = u32::try_from(said).unwrap_or(0).min(DEEPEST);
            }
            (5, Value::Bytes(said)) => run.done = Some(ticked(said)),
            (8, Value::Number(said)) => run.quote = said != 0,
            _ => {}
        }
    }
}

/// Whether a box is ticked. A `Checklist` carries the box's own id as well,
/// which nothing here needs.
fn ticked(bytes: &[u8]) -> bool {
    for (number, value) in Fields::new(bytes) {
        if number == 2 {
            if let Value::Number(done) = value {
                return done != 0;
            }
        }
    }

    false
}

/// One `AttachmentInfo`: which attachment, and what kind of thing it is.
fn attachment_of(bytes: &[u8]) -> Option<(String, String)> {
    let mut id = String::new();
    let mut uti = String::new();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Bytes(said)) => id = text_of(said),
            (2, Value::Bytes(said)) => uti = text_of(said),
            _ => {}
        }
    }

    if id.is_empty() {
        return None;
    }

    Some((id, uti))
}

/// The bytes under the gzip, or under the zlib wrapper where a row has one.
///
/// Held to `MOST_BYTES`, because how much is under a gzip is whatever the gzip
/// says: a row that names more than a note can hold is a row this reads nothing
/// out of rather than a reason for the import to run out of memory.
fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();

    let read = match data.first().copied() {
        Some(0x1f) => GzDecoder::new(data)
            .take(MOST_BYTES)
            .read_to_end(&mut out)
            .ok()?,
        Some(0x78) => ZlibDecoder::new(data)
            .take(MOST_BYTES)
            .read_to_end(&mut out)
            .ok()?,
        _ => return None,
    };

    // Filled to the brim is a row that holds more than the cap, and half a note is
    // not a note.
    if u64::try_from(read).ok()? >= MOST_BYTES {
        return None;
    }

    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{decode, markdown, title, Parts};

    /// Names an attachment by its identifier, the way the database would.
    struct Named;

    impl Parts for Named {
        fn attachment(&mut self, id: &str, uti: &str) -> Option<String> {
            if uti == "com.apple.notes.table" {
                return None;
            }

            Some(format!("![](assets/{id}.png)"))
        }
    }

    /// A varint, as protobuf writes one.
    fn varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();

        loop {
            let byte = u8::try_from(value & 0x7f).unwrap_or(0);
            value >>= 7;

            if value == 0 {
                out.push(byte);
                return out;
            }

            out.push(byte | 0x80);
        }
    }

    fn number(field: u32, value: u64) -> Vec<u8> {
        let mut out = varint(u64::from(field) << 3);
        out.extend(varint(value));
        out
    }

    fn bytes(field: u32, value: &[u8]) -> Vec<u8> {
        let mut out = varint((u64::from(field) << 3) | 2);
        out.extend(varint(u64::try_from(value.len()).unwrap_or(0)));
        out.extend_from_slice(value);
        out
    }

    /// A `ParagraphStyle`.
    fn style(kind: u64, indent: u64, done: Option<bool>) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(number(1, kind));

        if indent > 0 {
            out.extend(number(4, indent));
        }

        if let Some(ticked) = done {
            out.extend(bytes(5, &number(2, u64::from(ticked))));
        }

        out
    }

    /// One `AttributeRun` over `length` UTF-16 units.
    fn run(length: u64, parts: &[Vec<u8>]) -> Vec<u8> {
        let mut body = number(1, length);
        for part in parts {
            body.extend_from_slice(part);
        }

        bytes(5, &body)
    }

    /// A whole note's row: a `NoteStoreProto` holding a `Document` holding a
    /// `Note`, gzipped, which is the shape Notes writes on the row.
    fn note(text: &str, runs: &[Vec<u8>]) -> Vec<u8> {
        let mut inner = bytes(2, text.as_bytes());
        for one in runs {
            inner.extend_from_slice(one);
        }

        zipped(&bytes(2, &bytes(3, &inner)))
    }

    /// The same bytes under a gzip, which is how a row carries any of this.
    fn zipped(said: &[u8]) -> Vec<u8> {
        let mut gzipped = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gzipped, said).expect("gzip");
        gzipped.finish().expect("gzip")
    }

    fn as_markdown(text: &str, runs: &[Vec<u8>]) -> String {
        let body = decode(&note(text, runs)).expect("a note");
        markdown(&body, &mut Named)
    }

    #[test]
    fn a_title_and_a_paragraph() {
        let text = "Groceries\nMilk and eggs\n";
        let said = as_markdown(
            text,
            &[run(10, &[bytes(2, &style(0, 0, None))]), run(14, &[])],
        );

        assert_eq!(said, "# Groceries\nMilk and eggs");
    }

    #[test]
    fn the_title_is_the_first_line_rather_than_the_row() {
        let body = decode(&note("Groceries\nMilk\n", &[run(15, &[])])).expect("a note");
        assert_eq!(title(&body).as_deref(), Some("Groceries"));
    }

    #[test]
    fn boxes_come_over_in_the_state_they_were_left_in() {
        let text = "Packing\nPassport\nCharger\n";
        let said = as_markdown(
            text,
            &[
                run(8, &[bytes(2, &style(0, 0, None))]),
                run(9, &[bytes(2, &style(103, 0, Some(true)))]),
                run(8, &[bytes(2, &style(103, 0, Some(false)))]),
            ],
        );

        assert_eq!(said, "# Packing\n- [x] Passport\n- [ ] Charger");
    }

    #[test]
    fn a_numbered_list_counts_itself_and_a_nested_one_is_indented() {
        let text = "One\nTwo\nUnder\n";
        let said = as_markdown(
            text,
            &[
                run(4, &[bytes(2, &style(102, 0, None))]),
                run(4, &[bytes(2, &style(102, 0, None))]),
                run(6, &[bytes(2, &style(101, 1, None))]),
            ],
        );

        assert_eq!(said, "1. One\n2. Two\n  - Under");
    }

    #[test]
    fn marks_go_around_the_words_and_not_around_the_spaces() {
        // `Bold ` is one run and `words` another, which is what Notes stores for
        // a sentence with two words of it in bold.
        let said = as_markdown("Bold words", &[run(5, &[number(5, 1)]), run(5, &[])]);

        assert_eq!(said, "**Bold** words");
    }

    #[test]
    fn a_highlight_is_nibs_own_mark_with_no_circle_in_front_of_it() {
        let said = as_markdown("Marked", &[run(6, &[number(14, 3)])]);

        assert_eq!(said, "==Marked==");
    }

    #[test]
    fn a_link_keeps_the_words_it_was_written_on() {
        let said = as_markdown(
            "nibeditor",
            &[run(9, &[bytes(9, b"https://nibeditor.com")])],
        );

        assert_eq!(said, "[nibeditor](https://nibeditor.com)");
    }

    #[test]
    fn monospaced_paragraphs_become_one_block_of_code() {
        let text = "let a = 1\nlet b = 2\nafter\n";
        let said = as_markdown(
            text,
            &[
                run(10, &[bytes(2, &style(4, 0, None))]),
                run(10, &[bytes(2, &style(4, 0, None))]),
                run(6, &[]),
            ],
        );

        assert_eq!(said, "```\nlet a = 1\nlet b = 2\n```\nafter");
    }

    #[test]
    fn an_attachment_becomes_what_the_database_says_it_is() {
        // The run over the object character is the attachment's own.
        let said = as_markdown(
            "Look \u{fffc}",
            &[
                run(5, &[]),
                run(1, &[bytes(12, &attachment("abc", "public.jpeg"))]),
            ],
        );

        assert_eq!(said, "Look ![](assets/abc.png)");
    }

    #[test]
    fn an_attachment_with_nothing_behind_it_leaves_no_words() {
        let said = as_markdown(
            "\u{fffc}",
            &[run(
                1,
                &[bytes(12, &attachment("t1", "com.apple.notes.table"))],
            )],
        );

        assert_eq!(said, "");
    }

    #[test]
    fn a_return_held_with_shift_stays_in_the_same_item() {
        let text = "First\u{2028}second\n";
        let said = as_markdown(text, &[run(13, &[bytes(2, &style(101, 0, None))])]);

        assert_eq!(said, "- First\n  second");
    }

    #[test]
    fn an_emoji_is_two_units_long_the_way_notes_counts() {
        // The run covers `Hi 🙂`, which is five UTF-16 units and not four.
        let said = as_markdown("Hi 🙂 there", &[run(5, &[number(5, 1)]), run(6, &[])]);

        assert_eq!(said, "**Hi 🙂** there");
    }

    #[test]
    fn bytes_that_are_not_a_note_are_not_read_as_one() {
        assert!(decode(b"not gzip at all").is_none());
    }

    /// The row carries a `NoteStoreProto` around a `Document` around the note, so
    /// the note is two hops in rather than one: a reader that looked one hop in
    /// found nothing in any note anybody has. A `Document` on its own is read as
    /// well, so a row written without the wrapper is still a note.
    #[test]
    fn a_note_is_found_through_the_wrapper_it_arrives_in() {
        let inner = bytes(2, "Words".as_bytes());

        let wrapped = decode(&zipped(&bytes(2, &bytes(3, &inner)))).expect("the row Notes writes");
        assert_eq!(title(&wrapped).as_deref(), Some("Words"));

        let bare = decode(&zipped(&bytes(3, &inner))).expect("a document on its own");
        assert_eq!(title(&bare).as_deref(), Some("Words"));

        // And a message holding neither is not a note.
        assert!(decode(&zipped(&bytes(9, &inner))).is_none());
    }

    /// A blank line between two monospaced paragraphs is part of the code: it
    /// carries no run of its own, and closing the fence over it and opening another
    /// would cut one block of code into two.
    #[test]
    fn a_blank_line_does_not_cut_a_block_of_code_in_two() {
        let said = as_markdown(
            "one\n\ntwo\n",
            &[
                run(4, &[bytes(2, &style(4, 0, None))]),
                run(1, &[]),
                run(4, &[bytes(2, &style(4, 0, None))]),
            ],
        );

        assert_eq!(said, "```\none\n\ntwo\n```");
    }

    /// The second half of an item is the same item, so the item after it takes the
    /// next number rather than the one after that.
    #[test]
    fn a_return_held_with_shift_does_not_take_the_next_number() {
        let said = as_markdown(
            "One\u{2028}still one\nTwo\n",
            &[
                run(13, &[bytes(2, &style(102, 0, None))]),
                run(4, &[bytes(2, &style(102, 0, None))]),
            ],
        );

        assert_eq!(said, "1. One\n  still one\n2. Two");
    }

    /// A depth is a number out of the blob and `prefix` writes a step for each of
    /// it, so a line saying it sits four billion levels in is eight gigabytes of
    /// indent. Held to a depth a note can have, it is an item like any other.
    #[test]
    fn a_depth_nobody_wrote_is_held_to_one_a_note_can_have() {
        let said = as_markdown(
            "deep\n",
            &[run(5, &[bytes(2, &style(101, u64::from(u32::MAX), None))])],
        );

        assert!(said.len() < 200, "{} characters of indent", said.len());
        assert!(said.trim_start().starts_with("- "), "{said}");
    }

    // ── Tables and scans ──

    /// An `ObjectID` naming one object of the document.
    fn object(at: u64) -> Vec<u8> {
        number(6, at)
    }

    /// A dictionary element from one object to another.
    fn element(key: u64, value: u64) -> Vec<u8> {
        let mut inner = bytes(1, &object(key));
        inner.extend(bytes(2, &object(value)));
        bytes(1, &inner)
    }

    /// A map of the given type, its entries each a key and an `ObjectID`.
    fn map(kind: u64, entries: &[(u64, Vec<u8>)]) -> Vec<u8> {
        let mut inner = number(1, kind);
        for (key, id) in entries {
            let mut entry = number(1, *key);
            entry.extend(bytes(2, id));
            inner.extend(bytes(3, &entry));
        }
        bytes(13, &inner)
    }

    /// An ordered set: the identifiers in their order, and each element pointing at
    /// the object that names its identifier.
    fn ordered(order: &[&[u8]], elements: &[(u64, u64)]) -> Vec<u8> {
        let mut array = Vec::new();
        for (at, uuid) in order.iter().enumerate() {
            let mut attachment = number(1, u64::try_from(at).unwrap_or(0));
            attachment.extend(bytes(2, uuid));
            array.extend(bytes(2, &attachment));
        }
        let mut contents = Vec::new();
        for (key, value) in elements {
            contents.extend(element(*key, *value));
        }
        let mut ordering = bytes(1, &array);
        ordering.extend(bytes(2, &contents));
        bytes(16, &bytes(1, &ordering))
    }

    fn dictionary(elements: &[(u64, u64)]) -> Vec<u8> {
        let mut inner = Vec::new();
        for (key, value) in elements {
            inner.extend(element(*key, *value));
        }
        bytes(6, &inner)
    }

    /// A cell: a note of its own, with one run over all of it saying what it is.
    fn cell(text: &str, marks: &[Vec<u8>]) -> Vec<u8> {
        let length = u64::try_from(text.encode_utf16().count()).unwrap_or(0);
        let mut inner = bytes(2, text.as_bytes());
        inner.extend(run(length, marks));
        bytes(10, &inner)
    }

    /// A merged document, the way a table's or a scan's row carries it.
    fn merged(objects: &[Vec<u8>], keys: &[&str], types: &[&str], uuids: &[&[u8]]) -> Vec<u8> {
        let mut data = Vec::new();
        for one in objects {
            data.extend(bytes(3, one));
        }
        for one in keys {
            data.extend(bytes(4, one.as_bytes()));
        }
        for one in types {
            data.extend(bytes(5, one.as_bytes()));
        }
        for one in uuids {
            data.extend(bytes(6, one));
        }
        zipped(&bytes(2, &bytes(3, &data)))
    }

    /// Two rows and two columns, the columns stored the other way round from how they
    /// are drawn, which is what a column dragged to the front leaves behind.
    fn shopping() -> Vec<u8> {
        let (r0, r1, c0, c1): (&[u8], &[u8], &[u8], &[u8]) =
            (b"row-0", b"row-1", b"col-0", b"col-1");
        let uuid = |at: u64| map(1, &[(3, number(2, at))]);

        let objects = vec![
            // 0: the table, and where its three parts are.
            map(0, &[(0, object(1)), (1, object(2)), (2, object(3))]),
            // 1: the rows, in order; 2: the columns, the second first.
            ordered(&[r0, r1], &[(4, 4), (5, 5)]),
            ordered(&[c1, c0], &[(6, 6), (7, 7)]),
            // 3: the cells, by column.
            dictionary(&[(6, 8), (7, 9)]),
            // 4 to 7: the four identifiers.
            uuid(0),
            uuid(1),
            uuid(2),
            uuid(3),
            // 8 and 9: each column's cells, by row.
            dictionary(&[(4, 10), (5, 11)]),
            dictionary(&[(4, 12), (5, 13)]),
            // 10 to 13: the cells themselves.
            cell("Item", &[]),
            cell("Milk", &[number(5, 1)]),
            cell("How much", &[]),
            cell("2 | two\nlitres", &[]),
        ];

        merged(
            &objects,
            &["crRows", "crColumns", "cellColumns", "UUIDIndex"],
            &["com.apple.notes.ICTable", "com.apple.CRDT.NSUUID"],
            &[r0, r1, c0, c1],
        )
    }

    #[test]
    fn a_table_is_a_markdown_table_with_its_columns_where_they_are_drawn() {
        let said = super::table(&shopping(), &mut Named).expect("a table");

        assert_eq!(
            said,
            "| How much | Item |\n| --- | --- |\n| 2 \\| two<br>litres | **Milk** |"
        );
    }

    /// A table is a block: whatever line it sat on in Notes, it arrives with a blank
    /// line on either side, which is what markdown needs to see a table at all.
    #[test]
    fn a_table_in_a_note_stands_apart_from_the_lines_around_it() {
        struct Tabled;
        impl Parts for Tabled {
            fn attachment(&mut self, _id: &str, _uti: &str) -> Option<String> {
                Some("\n\n| a |\n| --- |\n| b |\n\n".to_string())
            }
        }

        let body = decode(&note(
            "Before\n\u{fffc}\nAfter",
            &[
                run(7, &[]),
                run(1, &[bytes(12, &attachment("t1", "com.apple.notes.table"))]),
                run(6, &[]),
            ],
        ))
        .expect("a note");

        assert_eq!(
            markdown(&body, &mut Tabled),
            "Before\n\n| a |\n| --- |\n| b |\n\nAfter"
        );
    }

    #[test]
    fn bytes_that_are_not_a_table_are_no_table() {
        assert!(super::table(b"not gzip", &mut Named).is_none());

        // A merged document with no table at its root, which is what a scan is.
        let scan = merged(
            &[map(0, &[(0, Vec::new())])],
            &["self"],
            &["com.apple.notes.gallery"],
            &[],
        );
        assert!(super::table(&scan, &mut Named).is_none());
    }

    #[test]
    fn a_scan_names_its_pages_in_order() {
        let page = |id: &str| {
            let mut said = Vec::new();
            said.extend(bytes(4, id.as_bytes()));
            map(0, &[(0, said)])
        };
        let scan = merged(
            &[page("PAGE-1"), page("PAGE-2")],
            &["self"],
            &["gallery"],
            &[],
        );

        assert_eq!(super::gallery(&scan), vec!["PAGE-1", "PAGE-2"]);
        assert!(super::gallery(b"nothing").is_empty());
    }

    fn attachment(id: &str, uti: &str) -> Vec<u8> {
        let mut out = bytes(1, id.as_bytes());
        out.extend(bytes(2, uti.as_bytes()));
        out
    }
}
