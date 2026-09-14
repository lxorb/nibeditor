//! The measuring gate: what nib on its own Chromium costs, said by the app itself.
//!
//! Batch 1 of docs/browser.md is allowed to answer "not yet", and a batch that may
//! answer no needs numbers rather than opinions. This is how the flagged build says
//! them: with `NIB_CEF_GATE` set it opens a web tab and a `chrome://` page, prints
//! one JSON object per line as it goes, waits long enough for the harness beside it
//! to count processes and photograph the screen, and quits.
//!
//! `apps/desktop/src-tauri/cef/gate.py` is that harness and
//! `.github/workflows/cef.yml` is what runs the pair on all three desktops. The
//! protocol is the one `spike/browser/scripts/measure.py` already reads - `{"at":
//! <ms>, "event": "..."}` - because the spike's numbers and these have to be
//! readable against each other.
//!
//! None of this is in the app that ships: the whole module is behind the `cef`
//! feature, and with the flag off there is no gate, no clock and no thread.

use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Listener, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// The variable that turns the gate on, and how many web tabs it asks for.
///
/// `NIB_CEF_GATE=0` is a launch with no web tab at all, which is the number
/// somebody who never opens one pays; `1` and `2` are the memory rows.
const SWITCH: &str = "NIB_CEF_GATE";

/// The sites the web tabs are sent to. Real pages over TLS, because a browser that
/// only works on `about:blank` has not been measured; two different sites, because
/// Chromium gives one renderer per site and two tabs on one site would understate
/// what two tabs cost.
const SITES: [&str; 2] = ["https://example.com/", "https://example.net/"];

/// The engine's own pages the gate opens, in order.
///
/// `chrome://settings` is the one Emil asked for by name and the one a `WebView2`
/// host is documented to be refused; `chrome://extensions` is the management surface
/// every later batch rests on.
const PAGES: [&str; 2] = ["chrome://settings/", "chrome://extensions/"];

/// The page the gate opens in a window of its own, in the engine's primary profile,
/// to see whether the extension is in that profile.
///
/// **Why the gate opens a website of its own.** Criterion 4 of docs/browser.md section
/// 8 has two halves - the extension reaches a web page, and the extension does *not*
/// reach nib's own interface - and batch 1 could only see the second one. A web tab's
/// title arrives through the event `web_tabs.rs` emits, which is a file this batch does
/// not touch and which carried no title on either engine. See [`probe_window`] for why
/// it is a window rather than a webview beside the tabs.
const PROBE: &str = "https://example.org/";

/// What the content script of the gate's test extension writes into a title. The
/// extension is `spike/browser/extension`, which already does exactly this.
const EXTENSION_MARK: &str = "NIB-EXTENSION-OK";

/// How long to hold still after each step, so the harness can read the process tree
/// and take a picture of a window that has finished painting.
const SETTLE: Duration = Duration::from_secs(6);

/// How long a web tab is given to open before the gate calls it a failure and carries
/// on.
///
/// **A hang has to be a row rather than the end of the run.** On Windows the second web
/// tab did not come back at all - the runtime's own `add_child` never returned, with
/// CEF logging *"Timeout of new browser info response for frame"* first - and batch
/// 1.5's first run spent its whole four hundred seconds inside that call and then had
/// nothing to say about the engine's own pages, the extension or the profiles. Beyond
/// this the gate gives up on that one tab, says so, and measures everything else.
const PATIENCE: Duration = Duration::from_secs(90);

/// When the process started, as near as a line of our own code can be to it.
static STARTED: LazyLock<Instant> = LazyLock::new(Instant::now);

/// Whether the gate was asked for, and for how many tabs.
static TABS: LazyLock<Option<usize>> = LazyLock::new(|| {
    std::env::var(SWITCH).ok().and_then(|value| {
        if value.is_empty() || value == "off" {
            None
        } else {
            value.trim().parse().ok().or(Some(2))
        }
    })
});

/// So the sequence runs once even if the app is set up twice.
static RUNNING: AtomicBool = AtomicBool::new(false);

/// Every title the app has been told about, by webview label. A content script that
/// ran in a webview renamed it, which is how the gate can tell which profile the
/// extension is in without asking the extension anything.
static TITLES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Starts the clock. Called before anything else so `at` means what it says.
pub(crate) fn begin() {
    let _ = *STARTED;
}

/// Whether this launch is a measured one.
pub(crate) fn wanted() -> bool {
    TABS.is_some()
}

/// One line of the report: a JSON object with the milliseconds on it.
///
/// Flushed at once, because a run that is killed for outrunning its timeout is a run
/// whose last line is the interesting one.
pub(crate) fn say(fields: &str) {
    if !wanted() {
        return;
    }
    println!("{{\"at\":{},{fields}}}", STARTED.elapsed().as_millis());
    let _ = std::io::stdout().flush();
}

/// A check, with its answer. The harness fails the job on any `ok: false`.
fn check(name: &str, ok: bool, note: &str) {
    say(&format!(
        "\"event\":\"check\",\"name\":\"{name}\",\"ok\":{ok},\"note\":\"{note}\""
    ));
}

/// A title the app was told about. Recorded rather than printed, because a page
/// renames itself several times while it loads.
pub(crate) fn title_seen(label: &str, title: &str) {
    if !wanted() {
        return;
    }
    if let Ok(mut titles) = TITLES.lock() {
        titles.push((label.to_owned(), title.to_owned()));
    }
}

/// Whether anything the extension's content script ran in was labelled like this.
fn extension_ran_in(label: &str) -> bool {
    TITLES.lock().is_ok_and(|titles| {
        titles
            .iter()
            .any(|(seen, title)| seen == label && title.contains(EXTENSION_MARK))
    })
}

/// Runs the gate, if it was asked for. Called once the window is on screen.
pub(crate) fn start(app: &AppHandle) {
    let Some(tabs) = *TABS else { return };
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    // What a web tab calls itself arrives the way it arrives for the window: on the
    // event `web_tabs.rs` emits whenever a page moves or renames itself. Listening
    // to it rather than adding a handler of our own is what keeps the gate outside
    // the file being reworked next door.
    app.listen("nib://web-tab", |event| {
        let Ok(moved) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        let (Some(tab), Some(title)) = (moved["tab"].as_str(), moved["title"].as_str()) else {
            return;
        };
        title_seen(&format!("web-{tab}"), title);
    });

    let app = app.clone();
    std::thread::spawn(move || {
        walk(&app, tabs);
        // The harness reads `finishing` and expects the process to go; a gate that
        // hangs on the way out is a finding of its own and the exit code says so.
        say("\"event\":\"finishing\"");
        app.exit(0);
    });
}

/// The sequence, in the order the numbers are wanted: a launch with nothing open, then
/// one web tab, then two, then a website of the gate's own - and the engine's own pages
/// last, because that is the step that can take the process with it.
fn walk(app: &AppHandle, tabs: usize) {
    say("\"event\":\"tabs\",\"count\":0");
    pulse(app, "the window");
    std::thread::sleep(SETTLE);

    let mut tab_labels: Vec<String> = Vec::new();

    for at in 0..tabs {
        let site = SITES[at % SITES.len()];
        // Said before the call and not only after it, so a run that stops inside the
        // app's own command is told apart from one that stopped before reaching it.
        say(&format!(
            "\"event\":\"opening\",\"tab\":{at},\"url\":\"{site}\""
        ));
        match opened_within(app, at, site) {
            Ok(label) => {
                say(&format!(
                    "\"event\":\"tab\",\"label\":\"{label}\",\"url\":\"{site}\""
                ));
                tab_labels.push(label);
            }
            Err(error) => check(
                &format!("web tab {at} opens through the app's own command"),
                false,
                &error,
            ),
        }
        say(&format!("\"event\":\"tabs\",\"count\":{}", at + 1));
        pulse(app, &format!("tab {at}"));
        std::thread::sleep(SETTLE);
    }

    // The moment the harness counts processes and photographs: every tab is up and
    // has painted, which is the one claim a table cannot carry on its own.
    say(&format!(
        "\"event\":\"ready\",\"pid\":{}",
        std::process::id()
    ));
    std::thread::sleep(SETTLE);
    say("\"event\":\"shot:app-and-tabs\"");
    std::thread::sleep(Duration::from_secs(2));

    // A website of the gate's own, in a window of its own: the half of criterion 4
    // batch 1 could not see. **Before the engine's own pages, deliberately**, because
    // those can take the process with them - `chrome://settings` is refused in an
    // Alloy-style browser and the refusal segfaults - and a crash in the last step of
    // the walk costs one row rather than every row.
    let probe = "gate-web-0";
    match probe_window(app, probe, PROBE) {
        Ok(()) => say(&format!(
            "\"event\":\"page\",\"label\":\"{probe}\",\"url\":\"{}\"",
            PROBE
        )),
        Err(error) => check(
            "a website opens in a window of the gate's own",
            false,
            &error,
        ),
    }

    std::thread::sleep(SETTLE);
    say("\"event\":\"shot:app-and-a-page\"");
    pulse(app, "the gate's own page");

    answers(app, tabs, &tab_labels, probe);

    // And last of all the engine's own pages, each in a webview of its own, because a
    // page that cannot be reached is the row that decides batch 3.
    let mut pages: Vec<String> = Vec::new();
    for (at, address) in PAGES.iter().enumerate() {
        let label = format!("gate-page-{at}");
        match page(app, &label, address, if at % 2 == 0 { 60.0 } else { 330.0 }) {
            Ok(()) => {
                say(&format!(
                    "\"event\":\"page\",\"label\":\"{label}\",\"url\":\"{address}\""
                ));
                pages.push(label);
            }
            Err(error) => check(&format!("{address} opens in a webview"), false, &error),
        }
    }
    std::thread::sleep(SETTLE);
    say("\"event\":\"shot:chrome-pages\"");
    pulse(app, "the pages");
    check(
        "every one of the engine's own pages opened",
        pages.len() == PAGES.len(),
        &format!("{} of {}", pages.len(), PAGES.len()),
    );
}

/// The checks, once everything that was going to happen has happened.
fn answers(app: &AppHandle, tabs: usize, tab_labels: &[String], probe: &str) {
    let webviews = app.webviews().len();
    // The interface and every web tab in the one window, plus the gate's own website,
    // which is a window of its own and is counted with them because `webviews()` is the
    // app's and not the window's. The engine's own pages come after this.
    let asked = 1 + tabs + 1;
    check(
        "the interface and every tab are webviews of one window",
        webviews >= asked,
        &format!("{webviews} webviews, {asked} asked for"),
    );

    check(
        "every web tab opened",
        tab_labels.len() == tabs,
        &format!("{} of {tabs}", tab_labels.len()),
    );
    // The whole reason there are two profiles. An extension is installed into a
    // profile, so an extension in the browsing profile has no way to reach the
    // app's own document - and with one profile the spike's screenshot showed it
    // reaching it. If the mark is in the interface's title, the profiles are not
    // doing their job and batch 2 does not start.
    //
    // Both halves are read off a webview's own title handler: the interface's, which
    // `engine::open_ui_window` installs, and the gate's own website, which `page`
    // installs. A web tab's title is reported as well where it arrived, and on neither
    // engine has it - which is why it is a note rather than the measurement.
    let in_the_app = extension_ran_in("main");
    let in_the_probe = extension_ran_in(probe);
    let in_a_tab = tab_labels.iter().any(|label| extension_ran_in(label));
    check(
        "an extension's content script never reaches the app's own interface",
        !in_the_app,
        if in_the_app {
            "the mark is in the interface's own title"
        } else {
            "the interface was not renamed"
        },
    );
    check(
        "an extension's content script reaches a page in the browsing profile",
        in_the_probe,
        if in_the_probe {
            "the gate's own page carries the mark"
        } else {
            "the gate's own page was not renamed; the extension may not be loaded at all"
        },
    );
    say(&format!(
        "\"event\":\"note\",\"extension_in_a_web_tab\":{in_a_tab}"
    ));

    if let Ok(titles) = TITLES.lock() {
        for (label, title) in &*titles {
            let title = title.replace('"', "'");
            say(&format!(
                "\"event\":\"title\",\"label\":\"{label}\",\"title\":\"{title}\""
            ));
        }
    }
}

/// How long the main thread is given to answer a round trip before the gate calls it
/// blocked.
const PULSE: Duration = Duration::from_secs(10);

/// Round-trips the main thread and says how long it took, or that it never came back.
///
/// **The one question a hang leaves open.** When the second web tab did not come back
/// on Windows, there was no way to tell whether the runtime was waiting for something
/// or whether the whole main thread had stopped - and those have different owners: a
/// blocked main thread cannot pump CEF's own work queue, which is exactly what CEF
/// logged when it said *"Timeout of new browser info response for frame"*. So the gate
/// asks the main thread to say hello at each step, and a step where it does not is the
/// finding.
fn pulse(app: &AppHandle, after: &str) {
    let (sending, waiting) = std::sync::mpsc::channel::<()>();
    let asked = Instant::now();
    if let Err(error) = app.run_on_main_thread(move || {
        let _ = sending.send(());
    }) {
        say(&format!(
            "\"event\":\"pulse\",\"after\":\"{after}\",\"main_thread\":\"not asked: {error}\""
        ));
        return;
    }
    match waiting.recv_timeout(PULSE) {
        Ok(()) => say(&format!(
            "\"event\":\"pulse\",\"after\":\"{after}\",\"main_thread_ms\":{}",
            asked.elapsed().as_millis()
        )),
        Err(_) => say(&format!(
            "\"event\":\"pulse\",\"after\":\"{after}\",\"main_thread\":\"blocked for more than {} seconds\"",
            PULSE.as_secs()
        )),
    }
}

/// `web_tab`, given up on after [`PATIENCE`].
///
/// The call happens on a thread of its own so that a call which never comes back
/// costs one thread rather than the whole run: the thread is left where it is - the
/// process is about to be asked to quit either way - and the gate carries on to the
/// engine's own pages, the extension and the profiles. See [`PATIENCE`] for the run
/// that made this necessary.
fn opened_within(app: &AppHandle, at: usize, site: &str) -> Result<String, String> {
    let (sending, waiting) = std::sync::mpsc::channel();
    let app = app.clone();
    let site = site.to_owned();
    std::thread::spawn(move || {
        let _ = sending.send(web_tab(&app, at, &site));
    });
    waiting.recv_timeout(PATIENCE).unwrap_or_else(|_| {
        Err(format!(
            "the app's own command did not come back in {} seconds",
            PATIENCE.as_secs()
        ))
    })
}

/// A web tab, through the app's own command rather than beside it.
///
/// This is the point of running the gate inside nib instead of in a program of its
/// own: `web_open` is the code that ships, and a measurement of anything else is a
/// measurement of something nobody runs. The call is the one line here that the
/// rework of `web_tabs.rs` next door can move under; if the signature changes, this
/// is the only place in the crate that follows it.
fn web_tab(app: &AppHandle, at: usize, site: &str) -> Result<String, String> {
    let webview = app
        .get_webview("main")
        .ok_or_else(|| "the app's own webview is not there".to_string())?;
    // Inside a 1024 by 768 screen, which is what the runners have: batch 1.5's first
    // pictures put the engine's own pages at x = 1180 and photographed the desktop
    // beside them, so a screenshot corroborated nothing. Everything the gate opens is
    // in the top-left 1024 by 768 now, tabs on one column and pages on the next.
    let y = if at % 2 == 0 { 60.0 } else { 330.0 };
    let pane: crate::web_tabs::Pane = serde_json::from_value(serde_json::json!({
        "x": 400.0, "y": y, "width": 300.0, "height": 260.0
    }))
    .map_err(|error| error.to_string())?;

    // A fresh page, not a revived one: no place to restore and an empty trail. Built
    // from JSON because the fields are the web-tab module's own to keep private.
    let revived: crate::web_tabs::Revived =
        serde_json::from_value(serde_json::json!({ "trail": [], "at": 0 }))
            .map_err(|error| error.to_string())?;

    let tab = format!("gate-{at}");
    let state = app.state::<crate::web_tabs::WebTabs>();
    tauri::async_runtime::block_on(crate::web_tabs::web_open(
        webview,
        state,
        tab.clone(),
        site.to_owned(),
        pane,
        revived,
    ))?;

    Ok(format!("web-{tab}"))
}

/// One of the engine's own pages, in a webview beside the others.
///
/// Not through `web_open`, because that command judges an address first and only
/// the web is an address a reader may type - `chrome://settings` is a page nib
/// opens, never a page a page can reach. Batch 3 is where it becomes a tab with a
/// gear on it; here it only has to load.
fn page(app: &AppHandle, label: &str, url: &str, y: f64) -> Result<(), String> {
    let at: tauri::Url = url.parse().map_err(|_| format!("{url} is not a URL"))?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "there is no window to put a page in".to_string())?;

    let label = label.to_owned();
    let watching = label.clone();
    let (sending, waiting) = std::sync::mpsc::channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(at))
            .on_document_title_changed(move |_view, title| title_seen(&watching, &title));
        let made = window
            .add_child(
                builder,
                LogicalPosition::new(710.0, y),
                LogicalSize::new(300.0, 260.0),
            )
            .map(|_| ())
            .map_err(|error| error.to_string());
        let _ = sending.send(made);
    })
    .map_err(|error| error.to_string())?;

    waiting
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "the window never answered".to_string())?
}

/// A website in a window of its own, in the engine's primary profile.
///
/// **Why a window rather than a webview beside the others.** Two reasons, and the
/// second one only became visible once the first run of batch 1.5 got this far. A
/// window's own title handler is the one channel this runtime is known to call - the
/// interface's title arrived with the extension's mark on it - while the handlers on
/// the webviews `add_child` made were never called, although those two webviews were
/// also the two whose navigation CEF refused, so which of the two explains the silence
/// is not yet settled. And on macOS a webview given a native parent is forced to Alloy
/// style, where a `chrome://` page is refused; a window of its own is Chrome style, so
/// this is also the shape a page Chromium reserves for itself can be put in there.
///
/// It sets no storage of its own, which is what leaves it in the primary profile: the
/// browsing one, where an extension a reader installs lands. Small and out of the way,
/// because a picture of the screen is part of what the gate produces.
fn probe_window(app: &AppHandle, label: &str, url: &str) -> Result<(), String> {
    let at: tauri::Url = url.parse().map_err(|_| format!("{url} is not a URL"))?;
    let label = label.to_owned();
    let watching = label.clone();
    let app = app.clone();
    let (sending, waiting) = std::sync::mpsc::channel::<Result<(), String>>();

    let handle = app.clone();
    app.run_on_main_thread(move || {
        let made = tauri::WebviewWindowBuilder::new(&handle, &label, WebviewUrl::External(at))
            .title("the gate's own page")
            // Small, and inside a 1024 by 768 screen like everything else the gate
            // opens, so a picture of the screen has it in it.
            .inner_size(320.0, 200.0)
            .position(30.0, 500.0)
            .on_document_title_changed(move |_window, title| title_seen(&watching, &title))
            .build()
            .map(|_| ())
            .map_err(|error| error.to_string());
        let _ = sending.send(made);
    })
    .map_err(|error| error.to_string())?;

    waiting
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "the window never answered".to_string())?
}
