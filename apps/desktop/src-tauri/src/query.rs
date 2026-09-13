//! What the search field means, as a small tree.
//!
//! The field itself is parsed in the app rather than here, because the browser
//! build runs the same grammar over its own storage and one grammar cannot
//! live in two parsers. What crosses to this side is the tree that parse made,
//! which is why every shape below is nothing but serde: search/query.ts writes
//! exactly these, and matcher.rs walks them.

use serde::Deserialize;

/// What a group of terms is held inside.
///
/// The first three are nearness: how near two terms have to be for a `line:`,
/// `block:` or `section:` group. The last three are a kind of line rather than a
/// distance, and they are units for the same reason - a note answers when one unit
/// of it answers every term.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Both on one line.
    Line,
    /// Both in one paragraph.
    Block,
    /// Both under one heading.
    Section,
    /// Both in one task item, whatever state its box is in.
    Task,
    /// Both in one task item whose box is empty.
    #[serde(rename = "task-todo")]
    TaskTodo,
    /// Both in one task item whose box is not.
    #[serde(rename = "task-done")]
    TaskDone,
}

/// How a front matter value is held against what was asked.
///
/// `Has` is the one that was always here: the value says this, somewhere in it.
/// The rest are what a number or a date wants, plus `Is` for a value that is
/// exactly this and `Null` for a key the note has not got.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Compare {
    /// The value says this somewhere in it.
    #[default]
    Has,
    /// The value is exactly this.
    Is,
    /// The note has no such key.
    Null,
    /// Less than.
    Lt,
    /// Less than or the same.
    Lte,
    /// More than.
    Gt,
    /// More than or the same.
    Gte,
    /// Between this and `upto`, both ends in.
    Range,
}

/// One node of a parsed query. `fold` is case folded, which is the default
/// everywhere the reader has not said `case:`.
///
/// Cloneable because one search asks two questions of it: what the note says
/// exactly, and, when nothing answers that, what it says loosely with the bare
/// words taken out. See fuzzy.rs.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Query {
    /// Every branch answers, which is what a space between two words means.
    All {
        /// The branches.
        of: Vec<Query>,
    },
    /// Any branch answers, which is what `OR` means.
    Any {
        /// The branches.
        of: Vec<Query>,
    },
    /// The branch does not answer, which is what a leading `-` means.
    Not {
        /// The branch that must not answer.
        of: Box<Query>,
    },
    /// Words in the note.
    Text {
        /// The word or the phrase, as it was typed.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// Words in the note's body, which is the note past its front matter. What
    /// `content:` asks, where a bare word reads the whole file.
    Content {
        /// The word or the phrase, as it was typed.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// A `/pattern/`.
    Regex {
        /// The pattern between the slashes.
        source: String,
        /// Whether the `i` flag was given.
        fold: bool,
    },
    /// Where the note is, relative to the space.
    Path {
        /// What the path has to hold.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// The note's own name.
    File {
        /// What the name has to hold.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// A tag. It stands for its children too, so `work` finds `work/2026`.
    Tag {
        /// The tag without its hash.
        tag: String,
    },
    /// Front matter: the key alone, or the key and what its value has to be.
    Property {
        /// The key, lowercased.
        name: String,
        /// What the value has to be, or nothing to ask only for the key - and for
        /// `null`, which asks for its absence.
        value: Option<String>,
        /// How the value is held against what was asked. Defaulted, so a build of
        /// the app older than this one still asks the question it meant to.
        #[serde(default)]
        compare: Compare,
        /// The far end of a range, and nothing otherwise.
        #[serde(default)]
        upto: Option<String>,
    },
    /// The branch, looked for inside one line, paragraph or section.
    Scope {
        /// How near the branch's terms have to be.
        unit: Unit,
        /// The branch, answered within one unit at a time.
        of: Box<Query>,
    },
}
