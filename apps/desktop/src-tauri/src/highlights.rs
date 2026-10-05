//! The highlights someone has drawn on a PDF, in a file beside it.
//!
//! Never inside the PDF: a PDF in a space is the file the reader put there, and
//! Nib does not rewrite it. The marks live in `paper.pdf.highlights.json`, which
//! syncs like a note, travels with the PDF when it is renamed or moved, and goes
//! when the PDF goes - see `move_highlights` in `paths`.
//!
//! This module owns the two commands that read and write that one file. What is
//! in it belongs to the window, which is the only thing that reads it; here it is
//! text, judged only by where it may be written.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{cannot, highlights_of, in_spaces, is_pdf, write_in_place};

/// How much a sidecar may hold. Tens of thousands of highlights, and a ceiling so
/// that a file which is not what it claims to be cannot be read whole into the
/// window's memory.
const LIMIT: u64 = 8 * 1024 * 1024;

/// The sidecar beside a PDF. `pdf` has already been judged to be inside a space;
/// this is the other half of the question, which is whether it is a PDF at all.
///
/// The window names the PDF and never the sidecar, so how the marks are stored
/// stays this module's business and nothing outside it can point the commands at
/// a file of its own choosing.
fn sidecar_of(pdf: &Path) -> Result<PathBuf, String> {
    if !is_pdf(pdf) {
        return Err(format!("{} is not a PDF", pdf.display()));
    }

    Ok(highlights_of(pdf))
}

/// What has been highlighted on a PDF. Empty when nothing has: a PDF nobody has
/// marked yet is the ordinary case, not a failure.
fn read_sidecar(target: &Path) -> Result<String, String> {
    match fs::metadata(target) {
        Err(_) => return Ok(String::new()),
        Ok(meta) if meta.len() > LIMIT => {
            return Err(format!("{} holds too much", target.display()))
        }
        Ok(_) => {}
    }

    fs::read_to_string(target).or_else(|error| {
        // Gone between the two calls, which is another window deleting the PDF
        // rather than anything this one can report.
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(String::new())
        } else {
            Err(cannot("read", target, &error))
        }
    })
}

/// Writes the sidecar whole, the way a note is written (`write_in_place`): a crash
/// mid write leaves the marks that were there rather than half of the new ones.
///
/// Nothing left to keep takes the file with it, so a PDF whose last highlight was
/// deleted is a PDF with no sidecar rather than one with an empty one.
fn write_sidecar(target: &Path, content: &str) -> Result<(), String> {
    // The same ceiling the reader is held to. Writing past it would leave a
    // sidecar the reader refuses, so the marks would be on disk and never come
    // back - which is worse than not taking them.
    if content.len() > usize::try_from(LIMIT).unwrap_or(usize::MAX) {
        return Err(format!("{} would hold too much", target.display()));
    }

    if content.is_empty() {
        return match fs::remove_file(target) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(cannot("delete", target, &error))
            }
            _ => Ok(()),
        };
    }

    write_in_place(target, content.as_bytes())
}

/// What has been highlighted on a PDF in a space, as the text of its sidecar.
#[tauri::command(async)]
pub fn read_highlights(app: AppHandle, path: String) -> Result<String, String> {
    read_sidecar(&sidecar_of(&in_spaces(&app, &path)?)?)
}

/// The highlights on a PDF in a space, written down.
#[tauri::command(async)]
pub fn write_highlights(app: AppHandle, path: String, content: String) -> Result<(), String> {
    write_sidecar(&sidecar_of(&in_spaces(&app, &path)?)?, &content)
}

#[cfg(test)]
mod tests {
    use super::{read_sidecar, sidecar_of, write_sidecar, LIMIT};
    use std::path::Path;

    #[test]
    fn the_sidecar_of_a_pdf_is_named_after_it() {
        assert_eq!(
            sidecar_of(Path::new("Notes/paper.pdf")),
            Ok(Path::new("Notes/paper.pdf.highlights.json").to_path_buf())
        );
    }

    #[test]
    fn nothing_that_is_not_a_pdf_has_one() {
        assert!(sidecar_of(Path::new("Notes/Idea.md")).is_err());
        assert!(sidecar_of(Path::new("Notes/shot.png")).is_err());
        // Nor the sidecar itself, so no round of writing can point at another.
        assert!(sidecar_of(Path::new("Notes/paper.pdf.highlights.json")).is_err());
    }

    #[test]
    fn a_pdf_nobody_has_marked_reads_as_nothing() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        assert_eq!(read_sidecar(&target), Ok(String::new()));
    }

    #[test]
    fn what_is_written_is_what_is_read_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");
        let marks = r#"{"version":1,"highlights":[{"page":3,"text":"Bücher"}]}"#;

        write_sidecar(&target, marks).expect("the write");
        assert_eq!(read_sidecar(&target), Ok(marks.to_string()));

        // And nothing but the sidecar is left behind by the write.
        let left: Vec<String> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["paper.pdf.highlights.json".to_string()]);
    }

    #[test]
    fn the_last_highlight_removed_takes_the_sidecar_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        write_sidecar(&target, "{}").expect("the write");
        write_sidecar(&target, "").expect("the clearing");

        assert!(!target.exists());
        // And clearing one that is already gone is not a failure.
        assert_eq!(write_sidecar(&target, ""), Ok(()));
    }

    /// The writer is held to the reader's ceiling. Without that, a window could
    /// write marks that come back as an error for ever after.
    #[test]
    fn marks_too_large_to_read_back_are_refused_on_the_way_in() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        let too_much = "x".repeat(usize::try_from(LIMIT).unwrap_or(usize::MAX) + 1);
        assert!(write_sidecar(&target, &too_much).is_err());
        assert!(!target.exists(), "and nothing was written");

        // What fits still lands, and still reads back.
        write_sidecar(&target, "{}").expect("the write");
        assert_eq!(read_sidecar(&target), Ok("{}".to_string()));
    }

    #[test]
    fn a_sidecar_too_large_to_be_one_is_refused() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        let big = vec![b'x'; usize::try_from(LIMIT).unwrap_or(usize::MAX) + 1];
        std::fs::write(&target, big).expect("something far too big");

        assert!(read_sidecar(&target).is_err());
    }
}
