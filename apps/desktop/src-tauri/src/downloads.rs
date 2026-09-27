//! What a web tab saves: the file a link, a script or a server hands over, in the
//! Downloads folder under the server's own name, the way a browser saves it.
//!
//! Emil, 2026-09-27: *"downloads currently don't work, please fix"*. They did save.
//! wry answers a download nobody has a handler for by accepting it silently - the
//! engine's own bubble switched off and the file written to the engine's default path -
//! so a course PDF on Moodle was pressed, arrived in Downloads, and nothing on screen
//! ever said so. From where the reader sat, nothing happened. This module is the
//! handler: it decides where the file goes, keeps the list of what this run has
//! saved, and tells the window as each one starts, moves and ends, so the bar can
//! show it and the reader can open it.
//!
//! **The engine does the fetching, not this crate.** A download is the engine's own
//! request from the page's own webview, so it goes out with the cookies, the login
//! and the profile the page has - whichever store `engine::web_store` put that
//! webview on. A file behind a sign-in (Moodle's `pluginfile.php`) therefore arrives
//! exactly when the page itself could open it, and nothing here has to know where the
//! session is kept.
//!
//! Where the file goes is a browser's rule, and Chrome's in particular: the Downloads
//! folder, the name the server or the link gave it, and `name (1).ext` beside a file
//! that is already there - never a dialog, and never over the top of anything. The
//! window can open a file or show it in its folder, but only by the id this module
//! gave it: a path the window names is never opened. See `lib/web-tab/downloads.svelte.ts`.
//!
//! One mechanism on every desktop. `WebviewBuilder::on_download` is the same hook on
//! `WebView2`, `WKWebView` and `WebKitGTK`; the one thing only `WebView2` can say is how
//! far along a file is, and `progress` adds that where it can. A phone has no web tabs
//! - a site there opens in the system browser, whose downloads are its own.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewBuilder};

/// The event the window hears whenever a download starts, moves or ends. It carries
/// the whole download each time, so the window never has to put one together.
const MOVED: &str = "nib://web-download";

/// The variable a probe names its own downloads folder in, so a run never writes into
/// anybody's Downloads; the same rule as `NIB_SPACES_DIR`. See
/// scripts/web-downloads-probe.py.
const DOWNLOADS_DIR: &str = "NIB_DOWNLOADS_DIR";

/// The longest name a file is saved under, in characters. Every file system nib runs on
/// allows 255 bytes, and a name that is mostly one server's idea of a title is still
/// read as that title at this length.
const LONGEST_NAME: usize = 180;

/// The names Windows keeps for devices, which no file may be called whatever its
/// extension. A file saved as `CON.pdf` is a file nobody can open, move or delete.
const DEVICES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Where a download has got to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// On its way.
    Going,
    /// In the folder.
    Done,
    /// It stopped, and there is no file.
    Failed,
    /// The reader stopped it.
    Cancelled,
}

/// One download, as the window is told about it.
///
/// The path is not in it. The window only ever names a download by its id, and the
/// crate is the one that turns that back into a file; see `web_download_open`.
#[derive(Clone, Debug, Serialize)]
pub struct Download {
    id: u64,
    /// The tab whose page asked for it.
    tab: String,
    url: String,
    /// What the file was saved as, which is what the list shows.
    name: String,
    state: State,
    received: u64,
    /// How large it is, when the server said.
    total: Option<u64>,
    #[serde(skip)]
    path: PathBuf,
}

/// Everything this run has downloaded, newest last.
///
/// For as long as the app runs and no longer: Chrome's bubble is about what has just
/// happened, and a list of every file ever saved is the Downloads folder itself.
#[derive(Default)]
pub struct Downloads {
    held: Mutex<Vec<Download>>,
    /// The tabs closed while a file was still on its way, whose webview is kept out of
    /// sight until the file is in; see `linger`.
    lingering: Mutex<HashSet<String>>,
}

impl Downloads {
    /// Whether a page in this tab is fetching a file at the moment.
    fn busy(&self, tab: &str) -> bool {
        self.held.lock().is_ok_and(|held| {
            held.iter()
                .any(|one| one.tab == tab && one.state == State::Going)
        })
    }

    /// A download the engine is about to start, given its place in `folder`: the name
    /// the engine suggests, made safe, and numbered past any file already there and
    /// any download still on its way to the same name. The engine writes somewhere
    /// else until it is done, so the folder alone cannot say a name is taken.
    fn start(&self, tab: &str, url: &str, suggested: &Path, folder: &Path) -> Option<Download> {
        let name = clean_name(suggested.file_name().unwrap_or_default());
        let mut held = self.held.lock().ok()?;

        let path = free_path(folder, &name, |one| {
            one.exists()
                || held
                    .iter()
                    .any(|other| other.state == State::Going && same_path(&other.path, one))
        });

        let made = Download {
            id: held.last().map_or(1, |last| last.id + 1),
            tab: tab.to_string(),
            url: url.to_string(),
            name: path
                .file_name()
                .map_or_else(|| name.clone(), |one| one.to_string_lossy().into_owned()),
            state: State::Going,
            received: 0,
            total: None,
            path,
        };

        held.push(made.clone());
        Some(made)
    }

    /// A download that has ended. Found by the path it was written to, or - where the
    /// engine does not say, which is `WKWebView` - by the oldest one still going from
    /// the same address. One the reader already stopped stays stopped.
    fn finish(&self, url: &str, path: Option<&Path>, success: bool) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held.iter_mut().find(|one| {
            one.state == State::Going
                && match path {
                    Some(path) => same_path(&one.path, path),
                    None => one.url == url,
                }
        })?;

        one.state = if success { State::Done } else { State::Failed };
        if success {
            one.received = one.total.unwrap_or(one.received);
        }
        Some(one.clone())
    }

    /// How far a download has got, by the path it is being written to.
    #[cfg_attr(
        not(all(windows, not(feature = "cef"))),
        allow(dead_code, reason = "only WebView2 says how far a download has got")
    )]
    fn moved(&self, path: &Path, received: u64, total: Option<u64>) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held
            .iter_mut()
            .find(|one| one.state == State::Going && same_path(&one.path, path))?;

        one.received = received;
        one.total = total.or(one.total);
        Some(one.clone())
    }

    /// The reader stopped one. Marked here first, so the engine's own word that it
    /// ended is not taken for a failure.
    fn cancelled(&self, id: u64) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held
            .iter_mut()
            .find(|one| one.id == id && one.state == State::Going)?;

        one.state = State::Cancelled;
        Some(one.clone())
    }

    /// The file a finished download was saved as, for the window to open or show.
    fn saved(&self, id: u64) -> Result<PathBuf, String> {
        self.held
            .lock()
            .ok()
            .and_then(|held| {
                held.iter()
                    .find(|one| one.id == id && one.state == State::Done)
                    .map(|one| one.path.clone())
            })
            .ok_or_else(|| "that download is not in the folder".to_string())
    }

    /// The id of the download being written to a path, for the engine's own events,
    /// which name a download by its path.
    #[cfg_attr(
        not(all(windows, not(feature = "cef"))),
        allow(
            dead_code,
            reason = "only WebView2 hands a download over to be cancelled"
        )
    )]
    fn id_of(&self, path: &Path) -> Option<u64> {
        self.held.lock().ok().and_then(|held| {
            held.iter()
                .find(|one| one.state == State::Going && same_path(&one.path, path))
                .map(|one| one.id)
        })
    }
}

/// The list, made the first time anything asks for it. Kept by this module rather than
/// registered with the builder, because nothing needs it until a page downloads
/// something, and a launch that never opens a website never makes it.
fn held(app: &AppHandle) -> tauri::State<'_, Downloads> {
    if app.try_state::<Downloads>().is_none() {
        app.manage(Downloads::default());
    }
    app.state::<Downloads>()
}

/// Whether two paths are one file. Case does not tell two files apart on the file
/// systems Windows and macOS use, and a download numbered past `Report.pdf` because
/// `report.pdf` is on its way is the right answer on Linux too.
fn same_path(one: &Path, other: &Path) -> bool {
    one.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&other.as_os_str().to_string_lossy())
}

/// A name a file can be saved under on every desktop, out of whatever the server or
/// the link said.
///
/// The engine has already cleaned it for its own platform; this is the rule that does
/// not depend on that. Nothing that is a path (`/`, `\`, `..` at the front), nothing a
/// file system refuses (`<>:"|?*` and control characters), no dot or space at the end,
/// which Windows drops without saying, no dot at the front, which hides a file on the
/// other two, and no device name. A name with nothing left is `download`, which is
/// Chrome's word for it.
fn clean_name(suggested: &OsStr) -> String {
    let replaced: String = suggested
        .to_string_lossy()
        .chars()
        .map(|one| {
            if one.is_control()
                || matches!(one, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                one
            }
        })
        .collect();

    let trimmed = replaced
        .trim()
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' ']);
    let name = if trimmed.is_empty() {
        "download"
    } else {
        trimmed
    };

    let (stem, ext) = split_extension(name);
    let device = DEVICES.iter().any(|one| {
        stem.split('.')
            .next()
            .unwrap_or(stem)
            .eq_ignore_ascii_case(one)
    });
    let stem = if device {
        format!("_{stem}")
    } else {
        stem.to_string()
    };

    // Shortened from the middle of the name's own words rather than the end of the
    // file, so the extension - which is what opens it - survives.
    let room = LONGEST_NAME.saturating_sub(ext.chars().count()).max(1);
    if stem.chars().count() <= room {
        return format!("{stem}{ext}");
    }
    let cut: String = stem.chars().take(room).collect();
    format!("{}{ext}", cut.trim_end_matches(['.', ' ']))
}

/// A name split before its extension, the way Chrome numbers a name: `report` and
/// `.pdf`, and `backup` and `.tar.gz` for the archives whose extension is two. A name
/// whose only dot is its first character has no extension.
fn split_extension(name: &str) -> (&str, &str) {
    let Some(dot) = name.rfind('.').filter(|&at| at > 0) else {
        return (name, "");
    };

    let (stem, ext) = name.split_at(dot);
    let compressed = [".gz", ".bz2", ".xz", ".z", ".zst"]
        .iter()
        .any(|one| ext.eq_ignore_ascii_case(one));

    if compressed {
        if let Some(inner) = stem.rfind('.').filter(|&at| at > 0) {
            if stem[inner..].eq_ignore_ascii_case(".tar") {
                return name.split_at(inner);
            }
        }
    }

    (stem, ext)
}

/// The first of `name`, `name (1)`, `name (2)` ... in `folder` that nothing has taken,
/// the numbering Chrome uses.
fn free_path(folder: &Path, name: &str, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let first = folder.join(name);
    if !taken(&first) {
        return first;
    }

    let (stem, ext) = split_extension(name);
    (1..=u32::MAX)
        .map(|count| folder.join(format!("{stem} ({count}){ext}")))
        .find(|one| !taken(one))
        .unwrap_or(first)
}

/// The folder downloads go to: the one a probe named, or the system's Downloads
/// folder, or the home folder on a system that has none.
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(named) = crate::paths::folder_named(std::env::var_os(DOWNLOADS_DIR).as_deref()) {
        return Ok(named);
    }

    app.path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the downloads folder: {error}"))
}

/// A web tab's builder, with its downloads answered by `heard`. The engine fetches the
/// file on the profile the page is on, so a file behind the page's login arrives with
/// the page's own cookies whichever store `engine::web_store` chose.
pub fn saving<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    tab: &str,
    window: &str,
) -> WebviewBuilder<R> {
    let app = app.clone();
    let tab = tab.to_string();
    let window = window.to_string();
    builder.on_download(move |_view, event| heard(&app, &tab, &window, event))
}

/// A download the page in `tab` started or ended, answered and said to the window that
/// holds the tab. The answer is whether the engine goes ahead.
///
/// A download is never refused here. What a site may start is the engine's own
/// question - several at once is the "automatic downloads" permission, asked in the
/// bubble like any other - and a download that cannot be placed is left where the
/// engine would have put it rather than lost.
fn heard(app: &AppHandle, tab: &str, window: &str, event: DownloadEvent<'_>) -> bool {
    let downloads = held(app);
    let said = match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(folder) = folder(app) else {
                return true;
            };
            let _ = std::fs::create_dir_all(&folder);

            let made = downloads.start(tab, url.as_str(), destination, &folder);
            if let Some(made) = &made {
                destination.clone_from(&made.path);
            }
            made
        }
        DownloadEvent::Finished { url, path, success } => {
            let ended = downloads.finish(url.as_str(), path.as_deref(), success);
            if let Some(one) = &ended {
                let _ = settle(app, &one.tab);
            }
            ended
        }
        // A kind of event a later Tauri adds is one nothing here answers.
        _ => None,
    };

    if let Some(one) = said {
        let _ = app.emit_to(window, MOVED, one);
    }
    true
}

/// Whether the page in a tab being closed has to stay, out of sight, until the files
/// it is fetching are in - and if so, keeps it.
///
/// The engine goes on fetching a file after the webview that asked for it has gone - the
/// browser process holds it - but it stops saying anything about it, so the bar would
/// turn its ring for a file that had long since arrived. A browser keeps a download
/// going after its tab has closed and keeps showing it; this is how that holds here.
/// Called by `web_close`, which hides the page instead of closing it when this says so.
pub fn linger(app: &AppHandle, tab: &str) -> bool {
    let downloads = held(app);
    if !downloads.busy(tab) {
        return false;
    }

    if let Ok(mut lingering) = downloads.lingering.lock() {
        lingering.insert(tab.to_string());
    }
    true
}

/// Takes a tab's page back from lingering, for a tab that is opened again while its
/// last file is still on its way: the page is still there, so it is the page. True
/// when there was one to take back.
pub fn revive(app: &AppHandle, tab: &str) -> bool {
    held(app)
        .lingering
        .lock()
        .is_ok_and(|mut lingering| lingering.remove(tab))
}

/// Closes a lingering page once nothing it was fetching is still on its way. After the
/// engine's own handler has returned, because this is called from inside it and a
/// webview is not closed from inside one of its own events.
fn settle(app: &AppHandle, tab: &str) -> bool {
    let downloads = held(app);
    if downloads.busy(tab) || !revive(app, tab) {
        return false;
    }

    let closing = app.clone();
    let tab = tab.to_string();
    let _ = app.run_on_main_thread(move || crate::web_tabs::close_page(&closing, &tab));
    true
}

/// Starts listening to how far each download of this webview has got. `WebView2` only,
/// through `progress`; elsewhere a download says when it starts and when it ends.
pub fn listen(platform: &tauri::webview::PlatformWebview, app: AppHandle, window: String) {
    progress::listen(platform, app, window);
}

/// Everything this run has downloaded, for a window that was reloaded while a
/// download was on its way, and for a probe.
#[tauri::command]
pub fn web_downloads(app: AppHandle) -> Vec<Download> {
    held(&app)
        .held
        .lock()
        .map(|held| held.clone())
        .unwrap_or_default()
}

/// Opens a downloaded file the way the system opens it, by the id the list gave it.
#[tauri::command]
pub fn web_download_open(app: AppHandle, id: u64) -> Result<(), String> {
    let path = held(&app).saved(id)?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|error| format!("that file could not be opened: {error}"))
}

/// Shows a downloaded file in its folder, selected, by the id the list gave it.
#[tauri::command]
pub fn web_download_show(app: AppHandle, id: u64) -> Result<(), String> {
    let path = held(&app).saved(id)?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|error| format!("that file could not be shown: {error}"))
}

/// Stops a download on its way. The engine's own operation is on the window's thread,
/// which is the only one it may be touched from; see `progress`.
#[tauri::command]
pub fn web_download_cancel(webview: tauri::Webview, id: u64) {
    let app = webview.app_handle();
    let Some(stopped) = held(app).cancelled(id) else {
        return;
    };

    let _ = app.run_on_main_thread(move || progress::cancel(id));
    let _ = settle(app, &stopped.tab);
    let _ = app.emit_to(webview.window().label(), MOVED, stopped);
}

/// How far a download has got, from `WebView2`'s own operation.
///
/// wry hands the engine's `DownloadStarting` to `heard` and keeps the operation to
/// itself, so this listens to the same event a second time. It is registered after
/// wry's, and the engine calls its handlers in that order, so by the time it runs the
/// file already has the path `heard` gave it - which is how the two are matched.
///
/// The operations still going are kept on the window's thread, the only one they may
/// be touched from, so Cancel can reach them; the shape `ask` in `web_tabs.rs` uses for
/// the requests it holds open.
#[cfg(all(windows, not(feature = "cef")))]
mod progress {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2DownloadOperation, ICoreWebView2_4, COREWEBVIEW2_DOWNLOAD_STATE,
        COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS,
    };
    use webview2_com::{
        BytesReceivedChangedEventHandler, DownloadStartingEventHandler, StateChangedEventHandler,
    };
    use windows_core::Interface;

    use super::MOVED;

    /// How often the window hears how far a file has got. Often enough that the ring
    /// turns smoothly, and not the thousand times a second a fast file would say it.
    const EVERY: Duration = Duration::from_millis(120);

    thread_local! {
        /// The operations still going, by the id the list gave them.
        static GOING: RefCell<HashMap<u64, ICoreWebView2DownloadOperation>> =
            RefCell::new(HashMap::new());
    }

    #[allow(
        unsafe_code,
        reason = "a download's progress is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, window: String) {
        // Safe: the controller is this window's, every object below is used only on
        // this thread, and WebView2 holds each handler for as long as it can fire.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(core) = core.cast::<ICoreWebView2_4>() else {
                return;
            };

            let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };

                let mut cancelled = windows_core::BOOL::default();
                if args.Cancel(&raw mut cancelled).is_ok() && cancelled.as_bool() {
                    return Ok(());
                }

                let mut path = windows_core::PWSTR::null();
                args.ResultFilePath(&raw mut path)?;
                let path = PathBuf::from(webview2_com::take_pwstr(path));
                let operation = args.DownloadOperation()?;

                let Some(id) = super::held(&app).id_of(&path) else {
                    return Ok(());
                };
                GOING.with_borrow_mut(|going| going.insert(id, operation.clone()));

                let moving = app.clone();
                let told = window.clone();
                let writing = path.clone();
                let mut last = Instant::now();
                let moved =
                    BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                        let Some(operation) = operation else {
                            return Ok(());
                        };
                        if last.elapsed() < EVERY {
                            return Ok(());
                        }
                        last = Instant::now();

                        let mut received = 0i64;
                        operation.BytesReceived(&raw mut received)?;
                        let mut total = 0i64;
                        operation.TotalBytesToReceive(&raw mut total)?;

                        let said = super::held(&moving).moved(
                            &writing,
                            u64::try_from(received).unwrap_or(0),
                            u64::try_from(total).ok().filter(|&one| one > 0),
                        );
                        if let Some(one) = said {
                            let _ = moving.emit_to(told.as_str(), MOVED, one);
                        }
                        Ok(())
                    }));
                let mut token = 0i64;
                operation.add_BytesReceivedChanged(&moved, &raw mut token)?;

                // Out of the list of what Cancel can reach once it has ended, however it
                // ended. What it ended as is wry's to report, through `heard`.
                let ended = StateChangedEventHandler::create(Box::new(move |operation, _| {
                    let Some(operation) = operation else {
                        return Ok(());
                    };
                    let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                    operation.State(&raw mut state)?;
                    if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                        GOING.with_borrow_mut(|going| going.remove(&id));
                    }
                    Ok(())
                }));
                let mut token = 0i64;
                operation.add_StateChanged(&ended, &raw mut token)?;

                Ok(())
            }));

            let mut token = 0i64;
            let _ = core.add_DownloadStarting(&handler, &raw mut token);
        }
    }

    /// Stops a download on its way. On the window's thread, where it was kept.
    #[allow(
        unsafe_code,
        reason = "a download operation is one of WebView2's own objects"
    )]
    pub fn cancel(id: u64) {
        let Some(operation) = GOING.with_borrow_mut(|going| going.remove(&id)) else {
            return;
        };

        // Safe: the operation came from this thread's own event and is used here and
        // nowhere else.
        unsafe {
            let _ = operation.Cancel();
        }
    }
}

// Every build but `WebView2`'s: the other two desktops, whose engines say nothing about
// a download between its start and its end through what wry hands out, and nib's own
// Chromium, whose erased webview has no controller to reach through.
#[cfg(any(not(windows), feature = "cef"))]
mod progress {
    use tauri::webview::PlatformWebview;
    use tauri::AppHandle;

    pub fn listen(_webview: &PlatformWebview, _app: AppHandle, _window: String) {}

    /// Nothing is kept to stop. The list says it was cancelled, and the file arrives
    /// anyway; see docs/web-tabs.md.
    pub fn cancel(_id: u64) {}
}

#[cfg(test)]
mod tests {
    use super::{clean_name, free_path, split_extension, Downloads, State};
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    fn name(said: &str) -> String {
        clean_name(OsStr::new(said))
    }

    #[test]
    fn a_server_name_is_kept_as_it_is() {
        assert_eq!(name("Lecture 3 - Sorting.pdf"), "Lecture 3 - Sorting.pdf");
        assert_eq!(name("Übung (1).zip"), "Übung (1).zip");
    }

    #[test]
    fn a_name_is_never_a_path() {
        assert_eq!(name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(name(r"..\..\Windows\win.ini"), r"_.._Windows_win.ini");
        assert_eq!(name("a/b.pdf"), "a_b.pdf");
    }

    #[test]
    fn what_a_file_system_refuses_is_replaced() {
        assert_eq!(name("what: a \"title\"?.pdf"), "what_ a _title__.pdf");
        assert_eq!(name("tab\there.txt"), "tab_here.txt");
        assert_eq!(name("report.pdf. . "), "report.pdf");
        assert_eq!(name(".hidden"), "hidden");
    }

    #[test]
    fn a_device_name_is_not_a_file_name() {
        assert_eq!(name("CON.pdf"), "_CON.pdf");
        assert_eq!(name("nul"), "_nul");
        assert_eq!(name("com1.tar.gz"), "_com1.tar.gz");
        assert_eq!(name("CONSOLE.pdf"), "CONSOLE.pdf");
    }

    #[test]
    fn nothing_left_is_download() {
        assert_eq!(name(""), "download");
        assert_eq!(name(" . "), "download");
    }

    #[test]
    fn a_long_name_keeps_its_extension() {
        let long = format!("{}.pdf", "a".repeat(400));
        let kept = name(&long);
        assert!(Path::new(&kept)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")));
        assert_eq!(kept.chars().count(), super::LONGEST_NAME);
    }

    #[test]
    fn an_extension_is_the_last_one_except_for_a_compressed_archive() {
        assert_eq!(split_extension("report.pdf"), ("report", ".pdf"));
        assert_eq!(split_extension("v1.2.notes.txt"), ("v1.2.notes", ".txt"));
        assert_eq!(split_extension("backup.tar.gz"), ("backup", ".tar.gz"));
        assert_eq!(split_extension("backup.TAR.XZ"), ("backup", ".TAR.XZ"));
        assert_eq!(split_extension("data.gz"), ("data", ".gz"));
        assert_eq!(split_extension("README"), ("README", ""));
        assert_eq!(split_extension(".profile"), (".profile", ""));
    }

    fn folder() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Downloads")
        } else {
            PathBuf::from("/Downloads")
        }
    }

    #[test]
    fn a_name_already_there_is_numbered_the_way_chrome_numbers_it() {
        let there: HashSet<PathBuf> = ["report.pdf", "report (1).pdf", "backup.tar.gz"]
            .iter()
            .map(|one| folder().join(one))
            .collect();
        let taken = |one: &Path| there.contains(one);

        assert_eq!(
            free_path(&folder(), "slides.pdf", taken),
            folder().join("slides.pdf")
        );
        assert_eq!(
            free_path(&folder(), "report.pdf", taken),
            folder().join("report (2).pdf")
        );
        assert_eq!(
            free_path(&folder(), "backup.tar.gz", taken),
            folder().join("backup (1).tar.gz")
        );
    }

    fn tmp() -> PathBuf {
        std::env::temp_dir().join("nib-downloads-test-that-does-not-exist")
    }

    #[test]
    fn two_downloads_of_one_name_at_once_get_two_files() {
        let downloads = Downloads::default();
        let one = downloads
            .start(
                "a",
                "https://x.example/f",
                Path::new("C:/elsewhere/Report.pdf"),
                &tmp(),
            )
            .expect("the first");
        let two = downloads
            .start(
                "a",
                "https://x.example/f",
                Path::new("C:/elsewhere/report.pdf"),
                &tmp(),
            )
            .expect("the second");

        assert_eq!(one.name, "Report.pdf");
        assert_eq!(two.name, "report (1).pdf");
        assert_eq!(two.id, one.id + 1);
        assert_eq!(one.path, tmp().join("Report.pdf"));
    }

    #[test]
    fn a_download_is_followed_from_start_to_end() {
        let downloads = Downloads::default();
        let made = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("started");
        assert_eq!(made.state, State::Going);
        assert!(downloads.saved(made.id).is_err());

        let moved = downloads.moved(&made.path, 10, Some(40)).expect("moving");
        assert_eq!((moved.received, moved.total), (10, Some(40)));

        let done = downloads
            .finish("https://x.example/f", Some(&made.path), true)
            .expect("done");
        assert_eq!(done.state, State::Done);
        assert_eq!(done.received, 40);
        assert_eq!(downloads.saved(made.id).expect("saved"), made.path);

        // The name is free once the file itself is what holds it.
        let again = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("again");
        assert_eq!(again.name, "f.pdf");
    }

    #[test]
    fn an_engine_that_names_no_path_is_matched_by_address() {
        let downloads = Downloads::default();
        let one = downloads
            .start("a", "https://x.example/one", Path::new("one.pdf"), &tmp())
            .expect("one");
        let two = downloads
            .start("a", "https://x.example/two", Path::new("two.pdf"), &tmp())
            .expect("two");

        let ended = downloads
            .finish("https://x.example/two", None, false)
            .expect("ended");
        assert_eq!(ended.id, two.id);
        assert_eq!(ended.state, State::Failed);
        assert!(downloads.saved(one.id).is_err());
    }

    #[test]
    fn a_download_the_reader_stopped_stays_stopped() {
        let downloads = Downloads::default();
        let made = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("started");

        assert_eq!(
            downloads.cancelled(made.id).map(|one| one.state),
            Some(State::Cancelled)
        );
        assert!(downloads
            .finish("https://x.example/f", Some(&made.path), false)
            .is_none());
        assert!(downloads.cancelled(made.id).is_none());
        assert!(downloads.id_of(&made.path).is_none());
    }
}
