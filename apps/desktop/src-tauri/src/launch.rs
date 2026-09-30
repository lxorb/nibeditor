//! Starting up and opening windows: what the app is handed, and the extra windows
//! someone asks for while it is running.
//!
//! What is handed to the app is web pages, because nib can be the browser: a link
//! clicked in another program arrives on a command line, which is how Windows and Linux
//! hand one over; as a second launch, which is the same thing reaching an app that is
//! already open; and on a Mac as the system's own "open these"; see lifecycle.rs. Which
//! of what arrived is a page is `web_handed.rs`.
//!
//! Never a file. nib opens nothing from outside its spaces, so it claims no file type
//! anywhere, and a path that reaches it all the same - an "Open with" the system still
//! remembers, a note dropped on the Dock icon, a path typed after `nib` in a terminal -
//! is nothing to open. A note is reached through the app itself, or through a `nib://`
//! link, which names it inside a space; see uris.rs.
//!
//! What arrives before a window can take it waits here until one asks, and what arrives
//! after goes to the window in front, the way a link clicked elsewhere lands in the
//! browser window being worked in rather than in every window at once.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Windows are labelled in the order they were opened, and a label is never
/// reused: counting the open ones would hand out a label that a window closed
/// earlier has already had, and the second window with that label cannot be
/// built.
static WINDOWS: AtomicU32 = AtomicU32::new(0);

/// The label of the window the app starts with.
const MAIN: &str = "main";

/// The kinds of thing the system hands the app, which is one: a file is never among
/// them (see the top of this file).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handed {
    /// Web pages to show in tabs of their own; see `web_handed.rs`.
    Pages,
}

impl Handed {
    /// What a window is told when some arrive for it while it is running.
    fn event(self) -> &'static str {
        match self {
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
    /// loading would drop an event on the floor. The listener is fetched after the
    /// first paint; see lib/web-tab/handed.ts.
    listening: HashSet<String>,
}

impl Waiting {
    fn road(&mut self, handed: Handed) -> &mut Road {
        match handed {
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
            waiting.pages.listening.remove(label);
        }
    }

    /// Whether a window's page is up: its pages are the first thing it asks for once
    /// its space has restored; see automation/start.ts.
    pub fn is_listening(&self, label: &str) -> bool {
        self.hears(Handed::Pages, label)
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

/// What a command line hands the app: the pages it asks for, and nothing else. A path
/// on it is no note to open; see the top of this file. And a launch Windows made for a
/// link is about that one address, which `pages_in` reads whole; see `for_a_link` in
/// `web_handed.rs`.
pub fn handed_by(args: &[String]) -> Vec<String> {
    crate::web_handed::pages_in(args)
}

/// Handed to the window once it is ready: the links the app was started for, and from
/// now on the ones that arrive while it runs. Clearing them stops a reload from opening
/// the same pages a second time. Asking is also how a window says it is listening, and
/// that its page is up, which is why the page listens first and asks second.
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

    hand_over(app, Handed::Pages, handed_by(&argv));
}

/// What arrived for the app, from whichever way it came, opened in the window in
/// front.
///
/// What a browser does with a link clicked elsewhere (Chrome, Edge): one window takes
/// it, and that window comes forward. When
/// no window is listening yet it waits for the first that asks, and when there is no
/// window at all - a Mac app lives on in the Dock with every window closed - one is
/// opened for it.
pub fn hand_over(app: &AppHandle, handed: Handed, arrived: Vec<String>) {
    if arrived.is_empty() {
        return;
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

/// A window because there was none - the Dock icon clicked, a link handed over with
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
        .title("nibeditor")
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
    use super::{handed_by, is_document_window, receiver, Handed, Handover, Pending, Seen};

    fn window(label: &str, focused: bool, listening: bool) -> Seen {
        Seen {
            label: label.to_owned(),
            focused,
            listening,
        }
    }

    #[test]
    fn pages_go_to_the_window_in_front() {
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
        // In front, but its page has not asked for its pages yet: it would drop an
        // event, so the pages wait for it to ask instead.
        let windows = [window("main", true, false)];
        assert_eq!(receiver(&windows, true), Handover::Hold);

        let windows = [window("main", true, false), window("nib-2", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-2".into()));
    }

    #[test]
    fn with_no_window_at_all_one_is_opened_once_the_launch_is_through() {
        // Before the launch has built its own, the pages wait for that one: this is
        // a link clicked elsewhere starting the app.
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
    fn a_window_is_up_once_it_has_asked_for_its_pages() {
        let pending = Pending::default();
        pending.hold(Handed::Pages, vec!["https://example.com/".into()]);

        // Until it asks, a page is held rather than sent, and the window is still
        // coming up: a quit destroys it rather than asking it anything.
        assert!(!pending.is_listening("main"));

        assert_eq!(
            pending.take(Handed::Pages, "main"),
            vec!["https://example.com/".to_owned()]
        );
        assert!(pending.is_listening("main"));
        // A reload asks again and follows nothing a second time.
        assert!(pending.take(Handed::Pages, "main").is_empty());
    }

    #[test]
    fn a_window_that_went_listens_for_nothing() {
        let pending = Pending::default();
        pending.take(Handed::Pages, "nib-2");

        pending.forget("nib-2");
        assert!(!pending.is_listening("nib-2"));
    }

    /// nib opens nothing from outside its spaces, so a path on a command line is no
    /// note: not on its own, not beside a page, and not smuggled into a link's.
    #[test]
    fn a_command_line_hands_over_pages_and_never_a_file() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Idea.md");
        std::fs::write(&note, "# Idea").expect("a note");
        let note = note.to_string_lossy().to_string();

        assert!(handed_by(&["nib.exe".into(), note.clone()]).is_empty());
        assert_eq!(
            handed_by(&["nib.exe".into(), note.clone(), "https://example.com".into()]),
            vec!["https://example.com/".to_owned()]
        );

        // The same path smuggled into a link's command line is part of the address.
        let pages = handed_by(&[
            "nib.exe".into(),
            "--url".into(),
            "https://example.com/".into(),
            note,
        ]);
        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("https://example.com/"));
    }
}
