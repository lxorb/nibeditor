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

/// What the content script of the gate's test extension writes into a title. The
/// extension is `spike/browser/extension`, which already does exactly this.
const EXTENSION_MARK: &str = "NIB-EXTENSION-OK";

/// How long to hold still after each step, so the harness can read the process tree
/// and take a picture of a window that has finished painting.
const SETTLE: Duration = Duration::from_secs(6);

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

/// The sequence, in the order the numbers are wanted: a launch with nothing open,
/// then one web tab, then two, then the engine's own pages.
fn walk(app: &AppHandle, tabs: usize) {
    say("\"event\":\"tabs\",\"count\":0");
    std::thread::sleep(SETTLE);

    let mut tab_labels: Vec<String> = Vec::new();

    for at in 0..tabs {
        let site = SITES[at % SITES.len()];
        match web_tab(app, at, site) {
            Ok(label) => {
                say(&format!(
                    "\"event\":\"tab\",\"label\":\"{label}\",\"url\":\"{site}\""
                ));
                tab_labels.push(label);
            }
            Err(error) => check(
                "a web tab opens through the app's own command",
                false,
                &error,
            ),
        }
        say(&format!("\"event\":\"tabs\",\"count\":{}", at + 1));
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

    // Then the engine's own pages, each in a webview of its own, because a page
    // that cannot be reached is the row that decides batch 3.
    let mut pages: Vec<String> = Vec::new();
    for (at, address) in PAGES.iter().enumerate() {
        let label = format!("gate-page-{at}");
        match page(app, &label, address) {
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

    answers(app, tabs, &tab_labels, &pages);
}

/// The checks, once everything that was going to happen has happened.
fn answers(app: &AppHandle, tabs: usize, tab_labels: &[String], pages: &[String]) {
    let webviews = app.webviews().len();
    let asked = 1 + tabs + PAGES.len();
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
    check(
        "every one of the engine's own pages opened",
        pages.len() == PAGES.len(),
        &format!("{} of {}", pages.len(), PAGES.len()),
    );

    // The whole reason there are two profiles. An extension is installed into a
    // profile, so an extension in the browsing profile has no way to reach the
    // app's own document - and with one profile the spike's screenshot showed it
    // reaching it. If the mark is in the interface's title, the profiles are not
    // doing their job and batch 2 does not start.
    let in_the_app = extension_ran_in("main");
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
        "an extension's content script reaches a web tab",
        in_a_tab,
        if in_a_tab {
            "a tab carries the mark"
        } else {
            "no tab was renamed; the extension may be in another profile or not loaded"
        },
    );

    if let Ok(titles) = TITLES.lock() {
        for (label, title) in &*titles {
            let title = title.replace('"', "'");
            say(&format!(
                "\"event\":\"title\",\"label\":\"{label}\",\"title\":\"{title}\""
            ));
        }
    }
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
    let x = if at % 2 == 0 { 520.0 } else { 860.0 };
    let pane: crate::web_tabs::Pane = serde_json::from_value(serde_json::json!({
        "x": x, "y": 96.0, "width": 320.0, "height": 620.0
    }))
    .map_err(|error| error.to_string())?;

    let tab = format!("gate-{at}");
    let state = app.state::<crate::web_tabs::WebTabs>();
    tauri::async_runtime::block_on(crate::web_tabs::web_open(
        webview,
        state,
        tab.clone(),
        site.to_owned(),
        pane,
        Vec::new(),
    ))?;

    Ok(format!("web-{tab}"))
}

/// One of the engine's own pages, in a webview beside the others.
///
/// Not through `web_open`, because that command judges an address first and only
/// the web is an address a reader may type - `chrome://settings` is a page nib
/// opens, never a page a page can reach. Batch 3 is where it becomes a tab with a
/// gear on it; here it only has to load.
fn page(app: &AppHandle, label: &str, url: &str) -> Result<(), String> {
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
                LogicalPosition::new(1180.0, 96.0),
                LogicalSize::new(360.0, 620.0),
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
