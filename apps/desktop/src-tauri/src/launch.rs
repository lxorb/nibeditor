//! Starting up and opening windows: the files the app is handed, and the extra
//! windows someone asks for while it is running.
//!
//! A file reaches the app three ways, and all three end here. A command line,
//! which is how Windows and Linux open a note from the file manager. A second
//! launch, which is the same thing reaching an app that is already open. And on a
//! Mac, where the Finder never puts a document on a command line, the system's own
//! "open these" - a double click, Open With, a note dropped on the Dock icon; see
//! lifecycle.rs.
//!
//! Whichever way, a file arriving before a window can open it waits here until one
//! asks, and a file arriving after goes to the window in front, the way a second
//! document double-clicked in the Finder lands in the window being worked in
//! rather than in every window at once.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::paths::is_markdown;

/// Windows are labelled in the order they were opened, and a label is never
/// reused: counting the open ones would hand out a label that a window closed
/// earlier has already had, and the second window with that label cannot be
/// built.
static WINDOWS: AtomicU32 = AtomicU32::new(0);

/// What a window is told when files arrive for it while it is running.
const OPEN_FILES: &str = "nib://open-files";

/// The label of the window the app starts with.
const MAIN: &str = "main";

/// Files handed to the app that no window has taken yet, and which windows are
/// listening for more.
#[derive(Default)]
pub struct Pending(Mutex<Waiting>);

/// What `Pending` holds, behind one lock so the three are always read together.
#[derive(Default)]
struct Waiting {
    /// Files for the next window that asks.
    files: Vec<String>,
    /// The windows whose page has asked for its files, and so has its listener
    /// up: a window still loading would drop an event on the floor.
    listening: HashSet<String>,
    /// Whether the launch has built its own window. Until it has, a file that
    /// finds no window waits for that one rather than opening another.
    launched: bool,
}

impl Pending {
    /// Puts files aside for the next window that asks.
    pub fn hold(&self, files: Vec<String>) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.files.extend(files);
        }
    }

    /// Says the launch has built its window, so a file that finds none from now on
    /// is one that has to open one.
    pub fn launched(&self) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.launched = true;
        }
    }

    /// Forgets a window that has gone. Its label can come back - the first window
    /// reopened from the Dock is `main` again - and the new one is not listening
    /// until it says so.
    pub fn forget(&self, label: &str) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.listening.remove(label);
        }
    }

    /// Whether a window's page is up and listening.
    pub fn is_listening(&self, label: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|waiting| waiting.listening.contains(label))
    }
}

/// Picks the markdown paths out of a command line, ignoring flags and anything
/// that is not a file the app can open.
pub fn markdown_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    markdown_files(
        args.into_iter()
            .skip(1)
            .filter(|argument| !argument.starts_with('-')),
    )
}

/// The paths among these that are markdown files really there: not a folder
/// named like a note, not a file of another kind, not a path to nothing.
pub fn markdown_files<I: IntoIterator<Item = String>>(paths: I) -> Vec<String> {
    paths
        .into_iter()
        .filter(|one| {
            let path = Path::new(one);
            path.is_file() && is_markdown(path)
        })
        .collect()
}

/// Handed to the window once it is ready; clearing them stops a reload from
/// reopening the same files a second time. Asking is also how a window says it is
/// listening for the files that arrive later, which is why the page listens first
/// and asks second.
#[tauri::command]
pub fn take_startup_files(
    window: tauri::Window,
    pending: tauri::State<'_, Pending>,
) -> Vec<String> {
    let Ok(mut waiting) = pending.0.lock() else {
        return Vec::new();
    };

    waiting.listening.insert(window.label().to_owned());
    std::mem::take(&mut waiting.files)
}

/// A second launch of the app, which belongs to the one already open: its window
/// comes forward and takes whatever file the launch was asked to open.
pub fn second_launch(app: &AppHandle, argv: Vec<String>, _cwd: String) {
    // The window, not the webview window, which a window holding a page in a tab
    // is not; see web_tabs.rs.
    if let Some(window) = app.get_window(MAIN) {
        bring_forward(&window);
    }

    hand_over(app, markdown_paths(argv));
}

/// Files for the app, from whichever way they came, opened in the window in front.
///
/// What a Mac does with a document double-clicked in the Finder while its app is
/// open (`TextEdit`, Typora, Obsidian): one window takes it, and that window comes
/// forward. When no window is listening yet the files wait for the first that
/// asks, and when there is no window at all - a Mac app lives on in the Dock with
/// every window closed - one is opened for them.
pub fn hand_over(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    crate::remember(app, &files);

    let Some(pending) = app.try_state::<Pending>() else {
        return;
    };
    let seen = seen(app, &pending);
    let launched = pending.0.lock().is_ok_and(|waiting| waiting.launched);

    match receiver(&seen, launched) {
        Handover::To(label) => {
            if let Some(window) = app.get_window(&label) {
                bring_forward(&window);
            }
            let _ = app.emit_to(label.as_str(), OPEN_FILES, files);
        }
        Handover::Hold => pending.hold(files),
        Handover::HoldAndOpen => {
            pending.hold(files);
            let _ = open_window(app, &reopened_label(app));
        }
    }
}

/// What the Dock icon means when it is clicked with no window on screen: a window,
/// the way VS Code, `TextEdit` and Obsidian answer it. One that is only minimised
/// or hidden comes back rather than a second one being opened beside it.
#[cfg(target_os = "macos")]
pub fn reopen(app: &AppHandle) {
    let windows = document_windows(app);
    let waiting = windows
        .iter()
        .find(|window| window.label() == MAIN)
        .or_else(|| windows.first());

    match waiting {
        Some(window) => {
            let _ = window.show();
            bring_forward(window);
        }
        None => {
            let _ = open_window(app, &reopened_label(app));
        }
    }
}

/// A second window onto the same spaces. Each gets its own label, so several can
/// be open at once; closing one leaves the others alone.
#[tauri::command]
pub fn new_window(app: AppHandle) -> Result<(), String> {
    open_window(&app, &free_label(&app))
}

/// A window with this label, built the way the first one is described in
/// tauri.conf.json: the same size, the same frame, and see-through, so the
/// platform's material shows behind the page in this window as it does in that
/// one.
fn open_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Nib")
        .inner_size(1180.0, 760.0)
        .min_inner_size(520.0, 400.0);

    // Not a Mac: Tauri only offers a Mac a see-through window behind its
    // `macos-private-api` feature, and the first window's `transparent` in the
    // config is dropped there for the same reason, so the two stay alike.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    // A Mac's is shown once it stands where it should; see `show_where_left`.
    #[cfg(target_os = "macos")]
    let builder = builder.visible(false);

    // The same switches as the first window, which is running on the same user data
    // folder and would refuse a webview started any other way; see `engine::BROWSER_ARGS`.
    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(crate::engine::BROWSER_ARGS);

    let window = crate::appearance::own_frame(builder)
        .build()
        .map_err(|error| format!("could not open another window: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        crate::lights::hold(&window);
        crate::document_window::show_where_left(&window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(())
}

/// The label a window opened because there was none gets: `main` again when it is
/// free, so the window that comes back from the Dock is the one the app started
/// with - its size and place remembered, and everything that looks for the first
/// window finding it.
fn reopened_label(app: &AppHandle) -> String {
    if app.get_window(MAIN).is_none() {
        MAIN.to_owned()
    } else {
        free_label(app)
    }
}

/// Every window that holds the app's own page: `main` and the `nib-2`, `nib-3`
/// that `new_window` hands out. Not the presenter's window, which draws a deck and
/// has no notes to open or lose.
pub fn document_windows(app: &AppHandle) -> Vec<tauri::Window> {
    app.windows()
        .into_values()
        .filter(|window| is_document_window(window.label()))
        .collect()
}

/// Whether a label is one of the app's own windows, by the two shapes
/// capabilities/default.json names.
fn is_document_window(label: &str) -> bool {
    label == MAIN
        || label
            .strip_prefix("nib-")
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

/// Up from the Dock and in front of everything else.
fn bring_forward(window: &tauri::Window) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// One of the app's windows as `receiver` weighs it.
struct Seen {
    label: String,
    focused: bool,
    listening: bool,
}

/// The app's windows, as `receiver` needs to see them.
fn seen(app: &AppHandle, pending: &Pending) -> Vec<Seen> {
    document_windows(app)
        .into_iter()
        .map(|window| Seen {
            focused: window.is_focused().unwrap_or(false),
            listening: pending.is_listening(window.label()),
            label: window.label().to_owned(),
        })
        .collect()
}

/// Where arriving files go.
#[derive(Debug, PartialEq, Eq)]
enum Handover {
    /// To this window, which is listening.
    To(String),
    /// Nowhere yet: a window is on its way and will ask for them.
    Hold,
    /// Nowhere yet, and there is no window to ask, so one has to be opened.
    HoldAndOpen,
}

/// Which window takes arriving files: the one in front if it is listening, else
/// the first window if that is, else any window that is. None listening means one
/// is still loading, or the launch has not built its window yet, and the files
/// wait; no window at all after the launch means opening one.
fn receiver(windows: &[Seen], launched: bool) -> Handover {
    let listening = || windows.iter().filter(|one| one.listening);
    let chosen = listening()
        .find(|one| one.focused)
        .or_else(|| listening().find(|one| one.label == MAIN))
        .or_else(|| listening().next());

    match chosen {
        Some(one) => Handover::To(one.label.clone()),
        None if windows.is_empty() && launched => Handover::HoldAndOpen,
        None => Handover::Hold,
    }
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
    use super::{is_document_window, markdown_paths, receiver, Handover, Seen};

    fn window(label: &str, focused: bool, listening: bool) -> Seen {
        Seen {
            label: label.to_owned(),
            focused,
            listening,
        }
    }

    #[test]
    fn files_go_to_the_window_in_front() {
        let windows = [window("main", false, true), window("nib-2", true, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-2".into()));
    }

    #[test]
    fn with_nothing_in_front_the_first_window_takes_them() {
        let windows = [window("nib-3", false, true), window("main", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("main".into()));

        let windows = [window("nib-3", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-3".into()));
    }

    #[test]
    fn a_window_still_loading_is_not_handed_anything() {
        // In front, but its page has not asked for its files yet: it would drop an
        // event, so the files wait for it to ask instead.
        let windows = [window("main", true, false)];
        assert_eq!(receiver(&windows, true), Handover::Hold);

        let windows = [window("main", true, false), window("nib-2", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-2".into()));
    }

    #[test]
    fn with_no_window_at_all_one_is_opened_once_the_launch_is_through() {
        // Before the launch has built its own, the files wait for that one: this is
        // a Finder double click starting the app.
        assert_eq!(receiver(&[], false), Handover::Hold);
        // After, it is an app living on in the Dock with every window closed.
        assert_eq!(receiver(&[], true), Handover::HoldAndOpen);
    }

    #[test]
    fn a_document_window_is_main_or_a_numbered_one() {
        assert!(is_document_window("main"));
        assert!(is_document_window("nib-2"));
        assert!(is_document_window("nib-12"));
        assert!(!is_document_window("nib-presenter"));
        assert!(!is_document_window("nib-"));
        assert!(!is_document_window("web-1"));
    }

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
