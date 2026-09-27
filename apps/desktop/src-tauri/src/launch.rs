//! Starting up and opening windows: the files the app was launched with, and the
//! extra windows someone asks for while it is running.
//!
//! A launch argument is the one way a note reaches the app before the window is
//! even there, so the files wait here until the window is ready to ask for them.

use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::paths::is_markdown;

/// Windows are labelled in the order they were opened, and a label is never
/// reused: counting the open ones would hand out a label that a window closed
/// earlier has already had, and the second window with that label cannot be
/// built.
static WINDOWS: AtomicU32 = AtomicU32::new(0);

/// Files named on the command line, waiting for the window to ask for them.
#[derive(Default)]
pub struct Pending(pub Mutex<Vec<String>>);

/// Picks the markdown paths out of a command line, ignoring flags and anything
/// that is not a file the app can open.
pub fn markdown_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .filter(|argument| {
            let path = Path::new(argument);
            path.is_file() && is_markdown(path)
        })
        .collect()
}

/// Handed to the window once it is ready; clearing them stops a reload from
/// reopening the same files a second time.
#[tauri::command]
pub fn take_startup_files(pending: tauri::State<'_, Pending>) -> Vec<String> {
    let Ok(mut files) = pending.0.lock() else {
        return Vec::new();
    };

    std::mem::take(&mut *files)
}

/// A second window onto the same spaces. Each gets its own label, so several can
/// be open at once; closing one leaves the others alone.
#[tauri::command]
pub fn new_window(app: AppHandle) -> Result<(), String> {
    let label = free_label(&app);

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Nib")
        .inner_size(1180.0, 760.0)
        .min_inner_size(520.0, 400.0);

    crate::appearance::own_frame(builder)
        .build()
        .map(|_| ())
        .map_err(|error| format!("could not open another window: {error}"))
}

/// A label no window has. The counter alone is enough within one run; the loop is
/// there because a label is also a name a window built elsewhere could hold.
fn free_label(app: &AppHandle) -> String {
    loop {
        let label = format!("nib-{}", WINDOWS.fetch_add(1, Ordering::Relaxed) + 2);
        // The window, not the webview window: a window that holds a page in a tab
        // is not one, and a label it holds would be handed out again. See
        // web_tabs.rs.
        if app.get_window(&label).is_none() {
            return label;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::markdown_paths;

    #[test]
    fn skips_the_executable_and_flags() {
        let args = vec!["nib.exe".to_string(), "--debug".to_string()];
        assert!(markdown_paths(args).is_empty());
    }

    #[test]
    fn ignores_paths_that_are_not_files() {
        let args = vec!["nib.exe".to_string(), "not-a-real-file.md".to_string()];
        assert!(markdown_paths(args).is_empty());
    }

    #[test]
    fn takes_the_markdown_files_that_are_really_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Idea.md");
        let other = dir.path().join("notes.txt");
        let folder = dir.path().join("Work.md");
        std::fs::write(&note, "# Idea").expect("a note");
        std::fs::write(&other, "plain").expect("a text file");
        // A folder that happens to be named like a note is not a note.
        std::fs::create_dir_all(&folder).expect("a folder");

        let args = vec![
            "nib.exe".to_string(),
            note.to_string_lossy().to_string(),
            other.to_string_lossy().to_string(),
            folder.to_string_lossy().to_string(),
        ];

        assert_eq!(
            markdown_paths(args),
            vec![note.to_string_lossy().to_string()]
        );
    }

    #[test]
    fn the_extension_may_be_written_in_any_case() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Idea.MARKDOWN");
        std::fs::write(&note, "# Idea").expect("a note");

        let args = vec!["nib.exe".to_string(), note.to_string_lossy().to_string()];
        assert_eq!(markdown_paths(args).len(), 1);
    }
}
