//! Starting up and opening windows: what the app is handed, and the extra windows
//! someone asks for while it is running.
//!
//! Two kinds of thing are handed to the app, and both end here.
//!
//! Notes. A file reaches the app three ways: a command line, which is how Windows and
//! Linux open a note from the file manager; a second launch, which is the same thing
//! reaching an app that is already open; and on a Mac, where the Finder never puts a
//! document on a command line, the system's own "open these" - a double click, Open
//! With, a note dropped on the Dock icon; see lifecycle.rs.
//!
//! And web pages, because nib can be the browser: a link clicked in another program
//! arrives by the same three ways. Which of what arrived is a page is `web_handed.rs`;
//! which window shows it is the same question as for a note, answered here the same
//! way.
//!
//! Whichever kind, what arrives before a window can take it waits here until one
//! asks, and what arrives after goes to the window in front, the way a second
//! document double-clicked in the Finder lands in the window being worked in rather
//! than in every window at once.

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

/// The label of the window the app starts with.
const MAIN: &str = "main";

/// The two kinds of thing the system hands the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handed {
    /// Notes to open.
    Files,
    /// Web pages to show in tabs of their own; see `web_handed.rs`.
    Pages,
}

impl Handed {
    /// What a window is told when some arrive for it while it is running.
    fn event(self) -> &'static str {
        match self {
            Self::Files => "nib://open-files",
            Self::Pages => "nib://open-pages",
        }
    }
}

/// What was handed to the app that no window has taken yet, and which windows are
/// listening for more.
#[derive(Default)]
pub struct Pending(Mutex<Waiting>);

/// What `Pending` holds, behind one lock so it is always read together.
#[derive(Default)]
struct Waiting {
    files: Road,
    pages: Road,
    /// Whether the launch has built its own window. Until it has, whatever finds no
    /// window waits for that one rather than opening another.
    launched: bool,
}

/// One kind of thing on its way to a window.
#[derive(Default)]
struct Road {
    /// For the next window that asks.
    waiting: Vec<String>,
    /// The windows whose page has asked, and so has its listener up: a window still
    /// loading would drop an event on the floor. A set per kind, because a page
    /// listens for pages later than for files - that listener is fetched after the
    /// first paint; see lib/web-tab/handed.ts.
    listening: HashSet<String>,
}

impl Waiting {
    fn road(&mut self, handed: Handed) -> &mut Road {
        match handed {
            Handed::Files => &mut self.files,
            Handed::Pages => &mut self.pages,
        }
    }
}

impl Pending {
    /// Puts what arrived aside for the next window that asks.
    pub fn hold(&self, handed: Handed, arrived: Vec<String>) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.road(handed).waiting.extend(arrived);
        }
    }

    /// Says the launch has built its window, so what finds none from now on has to
    /// open one.
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
            waiting.files.listening.remove(label);
            waiting.pages.listening.remove(label);
        }
    }

    /// Whether a window's page is up: its files are the first thing it asks for, as
    /// its launch begins; see start.ts.
    pub fn is_listening(&self, label: &str) -> bool {
        self.hears(Handed::Files, label)
    }

    /// Whether a window is listening for this kind.
    fn hears(&self, handed: Handed, label: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|mut waiting| waiting.road(handed).listening.contains(label))
    }

    /// Everything of a kind waiting, for the window asking, which is listening for more
    /// from now on.
    fn take(&self, handed: Handed, label: &str) -> Vec<String> {
        let Ok(mut waiting) = self.0.lock() else {
            return Vec::new();
        };

        let road = waiting.road(handed);
        road.listening.insert(label.to_owned());
        std::mem::take(&mut road.waiting)
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

/// What a command line hands the app: the notes it names, and the pages it asks
/// for. A launch Windows made for a link is about that link alone, so nothing else
/// on it is read as a note; see `for_a_link` in `web_handed.rs`.
pub fn handed_by(args: Vec<String>) -> (Vec<String>, Vec<String>) {
    let pages = crate::web_handed::pages_in(&args);
    let files = if crate::web_handed::for_a_link(&args) {
        Vec::new()
    } else {
        markdown_paths(args)
    };

    (files, pages)
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
    pending.take(Handed::Files, window.label())
}

/// The same for web pages: the links the app was started for, and from now on the
/// ones that arrive while it runs.
#[tauri::command]
pub fn take_startup_pages(
    window: tauri::Window,
    pending: tauri::State<'_, Pending>,
) -> Vec<String> {
    pending.take(Handed::Pages, window.label())
}

/// A second launch of the app, which belongs to the one already open: its window
/// comes forward and takes whatever the launch was asked to open.
pub fn second_launch(app: &AppHandle, argv: Vec<String>, _cwd: String) {
    // The window, not the webview window, which a window holding a page in a tab
    // is not; see web_tabs.rs.
    if let Some(window) = app.get_window(MAIN) {
        bring_forward(&window);
    }

    let (files, pages) = handed_by(argv);
    hand_over(app, Handed::Files, files);
    hand_over(app, Handed::Pages, pages);
}

/// What arrived for the app, from whichever way it came, opened in the window in
/// front.
///
/// What a Mac does with a document double-clicked in the Finder while its app is
/// open (`TextEdit`, Typora, Obsidian), and what a browser does with a link clicked
/// elsewhere (Chrome, Edge): one window takes it, and that window comes forward. When
/// no window is listening yet it waits for the first that asks, and when there is no
/// window at all - a Mac app lives on in the Dock with every window closed - one is
/// opened for it.
pub fn hand_over(app: &AppHandle, handed: Handed, arrived: Vec<String>) {
    if arrived.is_empty() {
        return;
    }
    if handed == Handed::Files {
        crate::remember(app, &arrived);
    }

    let Some(pending) = app.try_state::<Pending>() else {
        return;
    };
    let seen = seen(app, &pending, handed);
    let launched = pending.0.lock().is_ok_and(|waiting| waiting.launched);

    match receiver(&seen, launched) {
        Handover::To(label) => {
            if let Some(window) = app.get_window(&label) {
                bring_forward(&window);
            }
            let _ = app.emit_to(label.as_str(), handed.event(), arrived);
        }
        Handover::Hold => pending.hold(handed, arrived),
        Handover::HoldAndOpen => {
            pending.hold(handed, arrived);
            let _ = open_again(app);
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
            let _ = open_again(app);
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
    opened(window_builder(app, label))
}

/// A window because there was none - the Dock icon clicked, a file handed over with
/// nothing open - which is the first window again where that label is free, and
/// then opens where the first window was left, the way a launch opens it; see
/// placement.rs. Apart from `open_window`, because that is also a new window's, and
/// finding the place reads a file, which a command answering on the window's own
/// thread may not.
fn open_again(app: &AppHandle) -> Result<(), String> {
    let label = reopened_label(app);
    if label != MAIN {
        return open_window(app, &label);
    }
    opened(crate::placement::reopened(app, window_builder(app, MAIN)))
}

fn window_builder<'a>(
    app: &'a AppHandle,
    label: &str,
) -> WebviewWindowBuilder<'a, crate::Engine, AppHandle> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Nib")
        .inner_size(1180.0, 760.0)
        .min_inner_size(520.0, 400.0);

    // Not a Mac: Tauri only offers a Mac a see-through window behind its
    // `macos-private-api` feature, and the first window's `transparent` in the
    // config is dropped there for the same reason, so the two stay alike.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    // A Mac's is shown once its traffic lights are in place; see lights.rs.
    #[cfg(target_os = "macos")]
    let builder = builder.visible(false);

    // The same switches as the first window, which is running on the same user data
    // folder and would refuse a webview started any other way; see `engine::BROWSER_ARGS`.
    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(crate::engine::BROWSER_ARGS);

    builder
}

fn opened(builder: WebviewWindowBuilder<'_, crate::Engine, AppHandle>) -> Result<(), String> {
    let building = crate::appearance::own_frame(builder);
    // Where the first window was sent off the screen, every other goes after it.
    let window = match crate::placement::away() {
        Some(at) => crate::placement::built_away(building, at),
        None => building.build(),
    }
    .map_err(|error| format!("could not open another window: {error}"))?;

    // Shown here only where it was not sent away: `built_away` has shown it already,
    // without bringing it forward, which showing it again would.
    #[cfg(target_os = "macos")]
    {
        crate::lights::hold(&window);
        if crate::placement::away().is_none() {
            window
                .show()
                .map_err(|error| format!("could not show the window: {error}"))?;
        }
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
pub(crate) fn is_document_window(label: &str) -> bool {
    label == MAIN
        || label
            .strip_prefix("nib-")
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

/// Up from the Dock and in front of everything else, unless this run's windows were
/// sent off the screen; see `raised` in placement.rs.
fn bring_forward(window: &tauri::Window) {
    crate::placement::raised(window);
}

/// One of the app's windows as `receiver` weighs it.
struct Seen {
    label: String,
    focused: bool,
    listening: bool,
}

/// The app's windows, as `receiver` needs to see them for one kind of thing.
fn seen(app: &AppHandle, pending: &Pending, handed: Handed) -> Vec<Seen> {
    document_windows(app)
        .into_iter()
        .map(|window| Seen {
            focused: window.is_focused().unwrap_or(false),
            listening: pending.hears(handed, window.label()),
            label: window.label().to_owned(),
        })
        .collect()
}

/// Where what arrived goes.
#[derive(Debug, PartialEq, Eq)]
enum Handover {
    /// To this window, which is listening.
    To(String),
    /// Nowhere yet: a window is on its way and will ask for it.
    Hold,
    /// Nowhere yet, and there is no window to ask, so one has to be opened.
    HoldAndOpen,
}

/// Which window takes what arrived: the one in front if it is listening, else the
/// first window if that is, else any window that is. None listening means one is
/// still loading, or the launch has not built its window yet, and it waits; no
/// window at all after the launch means opening one.
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
    use super::{
        handed_by, is_document_window, markdown_paths, receiver, Handed, Handover, Pending, Seen,
    };

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

    #[test]
    fn a_window_listens_for_pages_apart_from_files() {
        let pending = Pending::default();
        pending.hold(Handed::Pages, vec!["https://example.com/".into()]);

        // The page asks for its files first, as its launch begins, and for its pages
        // once that listener has been fetched: until then a page is held, not sent.
        assert!(pending.take(Handed::Files, "main").is_empty());
        assert!(pending.is_listening("main"));
        assert!(!pending.hears(Handed::Pages, "main"));

        assert_eq!(
            pending.take(Handed::Pages, "main"),
            vec!["https://example.com/".to_owned()]
        );
        assert!(pending.hears(Handed::Pages, "main"));
        // A reload asks again and follows nothing a second time.
        assert!(pending.take(Handed::Pages, "main").is_empty());
    }

    #[test]
    fn a_window_that_went_listens_for_nothing() {
        let pending = Pending::default();
        pending.take(Handed::Files, "nib-2");
        pending.take(Handed::Pages, "nib-2");

        pending.forget("nib-2");
        assert!(!pending.hears(Handed::Files, "nib-2"));
        assert!(!pending.hears(Handed::Pages, "nib-2"));
    }

    #[test]
    fn a_link_launch_hands_over_its_page_and_no_note() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Idea.md");
        std::fs::write(&note, "# Idea").expect("a note");
        let note = note.to_string_lossy().to_string();

        // A note on an ordinary command line is a note, and a page beside it a page.
        let (files, pages) = handed_by(vec![
            "nib.exe".into(),
            note.clone(),
            "https://example.com".into(),
        ]);
        assert_eq!(files, vec![note.clone()]);
        assert_eq!(pages, vec!["https://example.com/".to_owned()]);

        // The same path smuggled into a link's command line is part of the address.
        let (files, pages) = handed_by(vec![
            "nib.exe".into(),
            "--url".into(),
            "https://example.com/".into(),
            note,
        ]);
        assert!(files.is_empty());
        assert_eq!(pages.len(), 1);
    }
}
