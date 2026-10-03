//! A task item, as a line of markdown says it is.
//!
//! `- [ ] buy milk` and `- [x] buy milk`, in every marker a list is written with:
//! the three bullets and the two ways a number is followed. What is inside the
//! brackets decides the state, and the rule is the checkbox's own: a space is not
//! done and anything else is, which takes in the marks a theme gives a task of its
//! own - `[-]` for cancelled, `[/]` for started - all of which mean a task nobody
//! is waiting on any more.
//!
//! The twin of this is tasks.ts in `@nib/markdown`, and the tests at the bottom
//! are the twin of tasks.test.ts: the same lines, the same answers. Read by hand
//! rather than with a pattern, because the `task:` operator asks it of every line
//! of every note in a space.

/// The state and the marker. Offsets are bytes from the start of the line,
/// which is what the matcher counts in.
///
/// Where the box sits is not here, though the twin says it: writing a tick is
/// the app's own path through a note and never a search's, so the offset would
/// be a field nothing on this side ever reads. What is in the box and how far the
/// line is indented are here, because the scan of a space hands every task line on
/// to the rows the window builds; see `prose` in links.rs.
pub struct TaskItem {
    /// Whether the box counts as ticked: anything but a space does.
    pub done: bool,
    /// What is between the brackets, as written: `x`, `/`, `-`, or whatever a
    /// theme gave a meaning of its own.
    pub mark: char,
    /// How far the line is indented, in characters, which is what makes a task a
    /// sub-task of the one above it.
    pub indent: usize,
    /// How much of the line is the marker, its indentation and the space after
    /// the box included, which is where the task's own words start.
    pub marker: usize,
}

/// How many digits a numbered list marker may have before it stops being one.
const DIGITS: usize = 9;

/// The task this line is, or None for a line that is not one.
#[must_use]
pub fn task_at(line: &str) -> Option<TaskItem> {
    let bytes = line.as_bytes();
    let mut at = 0;

    while matches!(bytes.get(at), Some(b' ' | b'\t')) {
        at += 1;
    }
    let indent = at;

    // A bullet, or a number followed by a dot or a bracket.
    match bytes.get(at)? {
        b'-' | b'*' | b'+' => at += 1,
        b'0'..=b'9' => {
            let from = at;
            while matches!(bytes.get(at), Some(b'0'..=b'9')) && at - from < DIGITS {
                at += 1;
            }
            if !matches!(bytes.get(at), Some(b'.' | b')')) {
                return None;
            }
            at += 1;
        }
        _ => return None,
    }

    // At least one space between the marker and the box.
    let gap = at;
    while matches!(bytes.get(at), Some(b' ' | b'\t')) {
        at += 1;
    }
    if at == gap {
        return None;
    }

    if bytes.get(at) != Some(&b'[') {
        return None;
    }

    // One character inside, which may be more than one byte.
    let mark = line.get(at + 1..)?.chars().next()?;
    if mark == ']' {
        return None;
    }

    let close = at + 1 + mark.len_utf8();
    if bytes.get(close) != Some(&b']') {
        return None;
    }

    // A space after the box, or the end of the line: `- [ ]` with nothing written
    // yet is a task somebody is about to write.
    let mut end = close + 1;
    let after = end;
    while matches!(bytes.get(end), Some(b' ' | b'\t')) {
        end += 1;
    }
    if end == after && bytes.get(end).is_some() {
        return None;
    }

    Some(TaskItem {
        done: mark != ' ',
        mark,
        indent,
        marker: end,
    })
}

#[cfg(test)]
mod tests {
    use super::task_at;

    /// The task's own words, which is what `marker` is for.
    fn words(line: &str) -> Option<&str> {
        task_at(line).map(|task| &line[task.marker..])
    }

    #[test]
    fn a_task_is_a_marker_a_box_and_what_comes_after_it() {
        let task = task_at("- [ ] buy milk").expect("a task");

        assert!(!task.done);
        assert_eq!(task.marker, 6);
        assert_eq!(words("- [ ] buy milk"), Some("buy milk"));
    }

    #[test]
    fn a_box_holding_anything_but_a_space_is_done() {
        for line in ["- [x] a", "- [X] a", "- [-] a", "- [/] a"] {
            assert!(task_at(line).expect(line).done, "{line}");
        }
        assert!(!task_at("- [ ] a").expect("a task").done);
    }

    #[test]
    fn every_marker_a_list_is_written_with() {
        for line in ["- [ ] a", "* [ ] a", "+ [ ] a", "1. [ ] a", "2) [ ] a"] {
            assert!(task_at(line).is_some(), "{line}");
        }
    }

    #[test]
    fn indentation_is_kept_however_deep() {
        let task = task_at("    - [x] nested").expect("a task");

        assert_eq!(task.indent, 4);
        assert_eq!(task.marker, 10);
        assert_eq!(words("    - [x] nested"), Some("nested"));
    }

    #[test]
    fn the_box_says_what_is_in_it_as_written() {
        for (line, mark) in [
            ("- [ ] a", ' '),
            ("- [/] a", '/'),
            ("- [-] a", '-'),
            ("- [é] a", 'é'),
        ] {
            assert_eq!(task_at(line).expect(line).mark, mark, "{line}");
        }
        assert_eq!(task_at("\t- [x] a").expect("a task").indent, 1);
    }

    #[test]
    fn a_box_with_nothing_written_in_it_yet_is_a_task() {
        assert_eq!(words("- [ ]"), Some(""));
    }

    #[test]
    fn and_a_list_a_sentence_or_an_empty_box_is_not_one() {
        for line in [
            "- buy milk",
            "a [x] in a sentence",
            "- [] buy milk",
            "- [xx] buy milk",
            "-[ ] buy milk",
            "",
        ] {
            assert!(task_at(line).is_none(), "{line}");
        }
    }
}
