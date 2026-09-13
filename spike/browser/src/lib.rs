//! A proof that nib can host Chromium, and a measurement of what it costs.
//!
//! This crate is not part of the app. Nothing in `apps/` reads it, no other
//! workflow builds it, and it exists to answer the questions in docs/browser.md
//! with numbers instead of opinions:
//!
//! 1. Do two web tabs share **one browser process**, the way two tabs in Chrome
//!    do? The harness counts the processes; this program only has to make two
//!    browsers and say when they are up.
//! 2. Do Chromium's own pages work - `chrome://settings`, `chrome://extensions`,
//!    `chrome://history`, `chrome://downloads`?
//! 3. Does an unpacked Chrome extension load, run its MV3 service worker and
//!    inject a content script? The extension in `../extension` renames the page's
//!    title to `NIB-EXTENSION-OK ...`, which is how this program can tell.
//! 4. Do DevTools, print and find in page work?
//! 5. What does it weigh, what does it hold in memory with two tabs, and how long
//!    is it from asking for a browser to having one?
//! 6. Is a launch with no web tab untouched? `--no-browser` never initialises CEF,
//!    and `nib-spike-nocef` is the same program with CEF not even linked, so the
//!    difference between the two is the price of *linking* Chromium.
//!
//! Everything it learns it prints as one JSON object per line, which
//! `scripts/measure.py` reads. A line whose `event` is `check` is a claim that
//! passed or failed, and a failed one fails the job.
//!
//! The shape of the program - `load_cef`, `execute_process`, `initialize`,
//! `run_message_loop`, `shutdown`, and the `wrap_*!` handlers - follows cef-rs's
//! own `cefsimple` example, which is the reference for this API and is
//! Apache-2.0 OR MIT like this repository's dependencies.
//! <https://github.com/tauri-apps/cef-rs/tree/dev/examples/cefsimple>

use cef::*;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

#[cfg(target_os = "macos")]
pub mod mac;

/// When this process started, so every line can say how long it has been.
static START: OnceLock<Instant> = OnceLock::new();

/// Whether the page whose title the extension rewrote has been seen.
static EXTENSION_SEEN: AtomicBool = AtomicBool::new(false);

/// Where the two tabs go. The first is an ordinary page, because an extension's
/// content script matches `<all_urls>` and not `chrome://`; the second is the one
/// Emil asked about by name.
const TAB_A: &str = "https://example.com/";
const TAB_B: &str = "chrome://settings/";

/// The Chromium pages the second tab visits in turn. Every one of these is a page
/// nib hands to Chromium rather than drawing itself, so every one of them has to
/// load. See the table in docs/browser.md.
const CHROME_PAGES: &[&str] = &[
    "chrome://settings/",
    "chrome://extensions/",
    "chrome://history/",
    "chrome://downloads/",
    "chrome://version/",
];

/// Milliseconds between one step of the plan and the next.
///
/// A fixed pace rather than a chain of load callbacks, because what this has to
/// be is *legible when it fails*: a run that stops says which step it stopped on,
/// and a runner that was slow shows up as a check that failed rather than as a
/// program that hung.
const STEP_MS: i64 = 2500;

/// Say something, as one line of JSON on stdout.
pub fn say(fields: &str) {
    let at = START
        .get()
        .map(|start| start.elapsed().as_millis())
        .unwrap_or_default();
    println!("{{\"at\":{at},{fields}}}");
    // Unbuffered, because the harness reads this while the program is still
    // running and a buffered line is a line that arrives after the screenshot.
    use std::io::Write;
    let _ = std::io::stdout().flush();
}

/// Say that something happened.
pub fn event(name: &str) {
    say(&format!("\"event\":\"{name}\""));
}

/// Say whether a claim held. A false one fails the job.
pub fn check(name: &str, ok: bool, note: &str) {
    say(&format!(
        "\"event\":\"check\",\"name\":\"{name}\",\"ok\":{ok},\"note\":\"{}\"",
        note.replace('"', "'")
    ));
}

/// Ask the harness for a picture of the screen, and name it.
pub fn shot(name: &str) {
    say(&format!("\"event\":\"shot:{name}\""));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/// What the spike is holding: the two browsers, and what has gone wrong.
#[derive(Default)]
pub struct Spike {
    /// Every browser that has been created, in the order it was created.
    browsers: Vec<Browser>,
    /// The addresses that failed to load, which is how a `chrome://` page that
    /// does not exist in this build is told from one that does.
    failed: Vec<String>,
    /// How far through the plan this is.
    step: usize,
}

impl Spike {
    fn browser(&self, which: usize) -> Option<BrowserHost> {
        self.browsers.get(which).and_then(|browser| browser.host())
    }

    fn load(&self, which: usize, url: &str) {
        let Some(mut browser) = self.browsers.get(which).cloned() else {
            return;
        };
        if let Some(frame) = browser.main_frame() {
            frame.load_url(Some(&CefString::from(url)));
        }
    }
}

/// One step of the plan, and the step after it.
///
/// Each arm does one thing and says what it found. The last arm quits the message
/// loop, which is what lets the program exit 0 and the harness report a number
/// rather than a timeout.
fn step(spike: &Arc<Mutex<Spike>>, n: usize) {
    let mut held = spike.lock().expect("the spike was poisoned");
    held.step = n;

    match n {
        // Both tabs exist by now. This is the moment the harness counts processes
        // and photographs, so nothing else happens on this step.
        0 => {
            check(
                "two browsers",
                held.browsers.len() == 2,
                &format!("{} browsers", held.browsers.len()),
            );
            say(&format!(
                "\"event\":\"ready\",\"pid\":{},\"browsers\":{}",
                std::process::id(),
                held.browsers.len()
            ));
        }

        // The extension. Its content script renamed the first tab's title, which
        // the display handler below noticed; and `chrome://extensions` has to be
        // able to list it.
        1 => {
            check(
                "an unpacked MV3 extension ran",
                EXTENSION_SEEN.load(Ordering::Relaxed),
                "the content script rewrites the page title",
            );
            shot("tab-a-with-extension");
        }

        // Chromium's own pages, one per step from here.
        n if n >= 2 && n < 2 + CHROME_PAGES.len() => {
            let url = CHROME_PAGES[n - 2];
            held.load(1, url);
            say(&format!("\"event\":\"navigating\",\"url\":\"{url}\""));
        }

        // Every page that was asked for, judged by whether a load error came back
        // for it.
        n if n == 2 + CHROME_PAGES.len() => {
            for url in CHROME_PAGES {
                let bad = held.failed.iter().any(|failed| failed.starts_with(url));
                check(url, !bad, if bad { "load error" } else { "loaded" });
            }
            shot("chrome-pages");
        }

        // DevTools, which in the Chrome runtime is Chromium's own window.
        n if n == 3 + CHROME_PAGES.len() => {
            if let Some(host) = held.browser(0) {
                host.show_dev_tools(None, None, None, None);
            }
        }
        n if n == 4 + CHROME_PAGES.len() => {
            let open = held.browser(0).map(|host| host.has_dev_tools() != 0);
            check("DevTools opened", open == Some(true), "has_dev_tools");
            shot("devtools");
            if let Some(host) = held.browser(0) {
                host.close_dev_tools();
            }
        }

        // Find in page. In the Chrome runtime the match count is drawn by
        // Chromium's own find bar, which is the point: nib does not draw one.
        n if n == 5 + CHROME_PAGES.len() => {
            if let Some(host) = held.browser(0) {
                host.find(Some(&CefString::from("Example")), 1, 0, 0);
            }
        }
        n if n == 6 + CHROME_PAGES.len() => {
            shot("find");
            if let Some(host) = held.browser(0) {
                host.stop_finding(1);
            }
        }

        // Print, which is Chromium's own preview and not a dialog nib draws.
        n if n == 7 + CHROME_PAGES.len() => {
            if let Some(host) = held.browser(0) {
                host.print();
            }
        }
        n if n == 8 + CHROME_PAGES.len() => shot("print"),

        // Zoom, because it is the one thing nib's View menu drives rather than
        // keeps a number for.
        n if n == 9 + CHROME_PAGES.len() => {
            if let Some(host) = held.browser(0) {
                host.set_zoom_level(1.0);
                let back = host.zoom_level();
                check("zoom", (back - 1.0).abs() < 0.001, &format!("{back}"));
            }
        }

        // Done. Closing every browser makes the last one's `on_before_close` quit
        // the loop, which is how cefsimple ends and how this ends.
        _ => {
            event("finishing");
            for browser in held.browsers.clone() {
                if let Some(host) = browser.host() {
                    host.close_browser(1);
                }
            }
            return;
        }
    }

    drop(held);
    let mut task = Step::new(spike.clone(), n + 1);
    post_delayed_task(ThreadId::UI, Some(&mut task), STEP_MS);
}

wrap_task! {
    struct Step {
        spike: Arc<Mutex<Spike>>,
        n: usize,
    }

    impl Task {
        fn execute(&self) {
            step(&self.spike, self.n);
        }
    }
}

// ---------------------------------------------------------------------------
// The handlers
// ---------------------------------------------------------------------------

wrap_client! {
    pub struct SpikeClient {
        spike: Arc<Mutex<Spike>>,
    }

    impl Client {
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(SpikeDisplayHandler::new(self.spike.clone()))
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(SpikeLifeSpanHandler::new(self.spike.clone()))
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(SpikeLoadHandler::new(self.spike.clone()))
        }
    }
}

wrap_display_handler! {
    struct SpikeDisplayHandler {
        spike: Arc<Mutex<Spike>>,
    }

    impl DisplayHandler {
        /// The extension proof, and it is worth saying why it is here rather than
        /// in a check of its own. A content script is the only part of an
        /// extension a host program can observe without asking the extension
        /// anything: it runs in the page, and the one thing it changes that
        /// reaches the embedder is the title. So `../extension/content.js`
        /// prefixes the title and this notices.
        fn on_title_change(&self, browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title = title.map(CefString::to_string).unwrap_or_default();
            if title.starts_with("NIB-EXTENSION-OK") {
                EXTENSION_SEEN.store(true, Ordering::Relaxed);
            }
            say(&format!("\"event\":\"title\",\"title\":\"{}\"", title.replace('"', "'")));

            // Keep the window's title honest while a screenshot is being taken.
            let mut browser = browser.cloned();
            if let Some(view) = browser_view_get_for_browser(browser.as_mut()) {
                if let Some(window) = view.window() {
                    window.set_title(Some(&CefString::from(title.as_str())));
                }
            }
        }
    }
}

wrap_life_span_handler! {
    struct SpikeLifeSpanHandler {
        spike: Arc<Mutex<Spike>>,
    }

    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            let Some(browser) = browser.cloned() else { return };
            let mut held = self.spike.lock().expect("the spike was poisoned");
            held.browsers.push(browser);
            say(&format!("\"event\":\"browser-created\",\"n\":{}", held.browsers.len()));
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            let mut held = self.spike.lock().expect("the spike was poisoned");
            let mut browser = browser.cloned().expect("a browser closed without being one");
            if let Some(at) = held
                .browsers
                .iter()
                .position(|one| one.is_same(Some(&mut browser)) != 0)
            {
                held.browsers.remove(at);
            }
            if held.browsers.is_empty() {
                event("all-closed");
                quit_message_loop();
            }
        }
    }
}

wrap_load_handler! {
    struct SpikeLoadHandler {
        spike: Arc<Mutex<Spike>>,
    }

    impl LoadHandler {
        /// The first page to finish is the number worth having: everything before
        /// it is CEF starting, the process tree coming up and the network.
        fn on_load_end(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, status: i32) {
            static ONCE: AtomicBool = AtomicBool::new(false);
            if !ONCE.swap(true, Ordering::Relaxed) {
                event("first-load-end");
            }
            say(&format!("\"event\":\"load-end\",\"status\":{status}"));
        }

        fn on_load_error(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            error_code: Errorcode,
            _error_text: Option<&CefString>,
            failed_url: Option<&CefString>,
        ) {
            // A cancelled navigation is not a failed one: every `load_url` over a
            // page that is still loading reports the one it replaced as aborted.
            if sys::cef_errorcode_t::from(error_code) == sys::cef_errorcode_t::ERR_ABORTED {
                return;
            }
            let url = failed_url.map(CefString::to_string).unwrap_or_default();
            say(&format!("\"event\":\"load-error\",\"url\":\"{url}\""));
            self.spike
                .lock()
                .expect("the spike was poisoned")
                .failed
                .push(url);
        }
    }
}

// ---------------------------------------------------------------------------
// The window the first tab sits in
// ---------------------------------------------------------------------------

wrap_browser_view_delegate! {
    struct SpikeBrowserViewDelegate;

    impl ViewDelegate {}

    impl BrowserViewDelegate {
        /// DevTools and the print preview arrive this way in the Chrome runtime:
        /// as a popup browser view the host is asked to put in a window. Making
        /// one is the whole of what a host has to do for either of them, which is
        /// the argument in docs/browser.md about not reinventing a browser.
        fn on_popup_browser_view_created(
            &self,
            _browser_view: Option<&mut BrowserView>,
            popup_browser_view: Option<&mut BrowserView>,
            _is_devtools: i32,
        ) -> i32 {
            let mut delegate =
                SpikeWindowDelegate::new(RefCell::new(popup_browser_view.cloned()), None);
            window_create_top_level(Some(&mut delegate));
            1
        }
    }
}

wrap_window_delegate! {
    struct SpikeWindowDelegate {
        browser_view: RefCell<Option<BrowserView>>,
        spike: Option<Arc<Mutex<Spike>>>,
    }

    impl ViewDelegate {
        fn preferred_size(&self, _view: Option<&mut View>) -> Size {
            Size { width: 1560, height: 940 }
        }
    }

    impl PanelDelegate {}

    impl WindowDelegate {
        fn on_window_created(&self, window: Option<&mut Window>) {
            let browser_view = self.browser_view.borrow();
            let (Some(window), Some(browser_view)) = (window, browser_view.as_ref()) else {
                return;
            };
            let mut view = View::from(browser_view);
            window.add_child_view(Some(&mut view));
            window.show();
        }

        fn on_window_destroyed(&self, _window: Option<&mut Window>) {
            *self.browser_view.borrow_mut() = None;
        }

        fn can_close(&self, _window: Option<&mut Window>) -> i32 {
            let browser_view = self.browser_view.borrow();
            let Some(browser_view) = browser_view.as_ref() else { return 1 };
            match browser_view.browser().and_then(|browser| browser.host()) {
                Some(host) => host.try_close_browser(),
                None => 1,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

wrap_app! {
    pub struct SpikeApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(SpikeBrowserProcessHandler::new(RefCell::new(None)))
        }

        /// The extension is loaded the way Chrome loads one: a switch on the
        /// command line, read before the browser comes up. There is no host API
        /// for it in the Chrome runtime and there does not need to be - the
        /// management surface is `chrome://extensions`, which is the whole
        /// argument of docs/browser.md in one line of code.
        fn on_before_command_line_processing(
            &self,
            process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            // The browser process only: a renderer is handed its switches by the
            // browser and appending to its line is how a subprocess ends up with
            // two of something.
            let is_browser = process_type.map(CefString::to_string).unwrap_or_default().is_empty();
            let Some(command_line) = command_line else { return };
            if !is_browser {
                return;
            }
            if let Ok(path) = std::env::var("NIB_SPIKE_EXTENSION") {
                command_line.append_switch_with_value(
                    Some(&CefString::from("load-extension")),
                    Some(&CefString::from(path.as_str())),
                );
            }
        }
    }
}

wrap_browser_process_handler! {
    struct SpikeBrowserProcessHandler {
        client: RefCell<Option<Client>>,
    }

    impl BrowserProcessHandler {
        /// Everything the spike does starts here, which is the earliest moment a
        /// browser can be asked for.
        fn on_context_initialized(&self) {
            event("cef-initialised");

            let spike = Arc::new(Mutex::new(Spike::default()));
            let client = SpikeClient::new(spike.clone());
            *self.client.borrow_mut() = Some(client);

            let settings = BrowserSettings::default();

            // Tab A: a page, in a window of nib's own making. Chrome style, which
            // is what gives this browser Chromium's own pages, its own extension
            // machinery, its own print preview and its own find bar - while the
            // window, the strip and the bar stay the host's. That combination is
            // the whole reason CEF is the recommendation in docs/browser.md.
            let mut client_a = self.client.borrow().clone();
            let mut view_delegate = SpikeBrowserViewDelegate::new();
            let browser_view = browser_view_create(
                client_a.as_mut(),
                Some(&CefString::from(TAB_A)),
                Some(&settings),
                None,
                None,
                Some(&mut view_delegate),
            );
            let mut window_delegate =
                SpikeWindowDelegate::new(RefCell::new(browser_view), Some(spike.clone()));
            window_create_top_level(Some(&mut window_delegate));

            // Tab B: a second browser, and the one measurement everything else
            // rests on. Two browsers, and the harness counts how many *browser
            // processes* the tree holds: one means Chrome-like tabs, which is the
            // thing Emil asked about first.
            //
            // A window of its own here rather than a view placed inside tab A's.
            // Placing a browser into a window somebody else owns is the other half
            // of the proof and it is `spike/shell`'s, because that is the shape the
            // recommendation actually takes: a Tauri window, two child webviews,
            // one process. Proving it twice in two different ways would prove the
            // wrong one twice.
            let mut client_b = self.client.borrow().clone();
            let mut view_delegate_b = SpikeBrowserViewDelegate::new();
            let browser_view_b = browser_view_create(
                client_b.as_mut(),
                Some(&CefString::from(TAB_B)),
                Some(&settings),
                None,
                None,
                Some(&mut view_delegate_b),
            );
            let mut window_delegate_b =
                SpikeWindowDelegate::new(RefCell::new(browser_view_b), None);
            window_create_top_level(Some(&mut window_delegate_b));

            let mut task = Step::new(spike, 0);
            post_delayed_task(ThreadId::UI, Some(&mut task), STEP_MS * 2);
        }
    }
}

// ---------------------------------------------------------------------------
// Starting up
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub type Library = library_loader::LibraryLoader;
#[cfg(not(target_os = "macos"))]
pub struct Library;

/// Load the framework, if this platform keeps it in one, and settle the API
/// version. On macOS the framework is not linked but loaded out of the bundle,
/// which is why a macOS app has to be a bundle at all.
pub fn load_cef() -> Library {
    load(false)
}

/// The same, for a subprocess. A helper sits four directories deeper inside the
/// bundle than the application does, so it looks for the framework along a
/// different path - which is the whole difference between the two calls.
pub fn load_cef_helper() -> Library {
    load(true)
}

fn load(helper: bool) -> Library {
    let _ = START.set(Instant::now());

    #[cfg(target_os = "macos")]
    let library = {
        let loader = library_loader::LibraryLoader::new(
            &std::env::current_exe().expect("this process has no path"),
            helper,
        );
        assert!(loader.load(), "the CEF framework would not load");
        loader
    };
    #[cfg(not(target_os = "macos"))]
    let library = {
        let _ = helper;
        Library
    };

    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);

    // A subprocess must not touch AppKit: the application class is the browser
    // process's business, and a helper that made an NSApplication would put an
    // icon in the Dock.
    #[cfg(target_os = "macos")]
    if !helper {
        mac::install_application();
    }

    library
}

/// The browser process, and on Windows and Linux every subprocess as well.
///
/// A subprocess is told what it is by `--type=` on its own command line, and it
/// must return out of `execute_process` without initialising anything. Only the
/// process with no `--type=` goes on to be the browser.
pub fn run(main_args: &MainArgs, command_line: &CommandLine, sandbox: *mut u8) -> i32 {
    let type_switch = CefString::from("type");
    let is_browser = command_line.has_switch(Some(&type_switch)) != 1;

    let code = execute_process(Some(main_args), None, sandbox);
    if !is_browser {
        // A subprocess. Nothing of the spike's runs here.
        return if code >= 0 { code } else { 0 };
    }
    assert_eq!(code, -1, "the browser process was handed a subprocess line");

    // Everything with no web tab open stops here, which is the whole of what
    // `--no-browser` measures: a binary with Chromium linked into it, started and
    // exited without Chromium ever being initialised.
    if command_line.has_switch(Some(&CefString::from("no-browser"))) == 1 {
        event("window-shown");
        event("no-browser");
        return 0;
    }

    let mut app = SpikeApp::new();
    let settings = Settings {
        no_sandbox: 1,
        // A profile of its own, beside the app's and never in it. The same
        // decision web-tabs.md already made, and the same folder name.
        root_cache_path: CefString::from(cache_dir().to_string_lossy().as_ref()),
        ..Default::default()
    };

    event("initialising");
    assert_eq!(
        initialize(Some(main_args), Some(&settings), Some(&mut app), sandbox),
        1,
        "CEF would not initialise"
    );

    run_message_loop();
    shutdown();
    event("shutdown");
    0
}

/// Where the browsing profile goes: a directory of this run's own, so a second run
/// on the same runner is not reading the first one's cookies or its extension
/// list.
fn cache_dir() -> std::path::PathBuf {
    let base = std::env::var_os("NIB_SPIKE_CACHE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("nib-spike-web");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
