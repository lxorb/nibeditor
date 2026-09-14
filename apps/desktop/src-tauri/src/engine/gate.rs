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

/// How long batch 2's rows are given, all of them together.
///
/// They sleep about a third of it on purpose - a page has to load, a scroll has to
/// happen, a tab has to be closed and opened again - and the rest is the room the calls
/// themselves get. Past this the walk carries on without them; see [`walk`].
const ROWS: Duration = Duration::from_secs(240);

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

/// A check, with its answer. The harness reads these off the run's own output.
///
/// The note is quoted out: it is a sentence somebody else's error may have written - a
/// Windows path, a URL, a message from the engine - and this line is JSON, where a quote
/// or a backslash in the middle of a string is a line the harness cannot read at all.
fn check(name: &str, ok: bool, note: &str) {
    let note = note.replace('\\', "/").replace('"', "'");
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

/// Whether a webview with this label ever told the app about a title.
///
/// The positive control for [`extension_ran_in`]: without it, "no mark in the title"
/// and "no title" are the same answer, and they are not the same answer.
fn spoke(label: &str) -> bool {
    TITLES
        .lock()
        .is_ok_and(|titles| titles.iter().any(|(seen, _)| seen == label))
}

/// How many titles a webview with this label has told the app about.
fn titles_for(label: &str) -> usize {
    TITLES
        .lock()
        .map(|titles| titles.iter().filter(|(seen, _)| seen == label).count())
        .unwrap_or_default()
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
        let Some(tab) = moved["tab"].as_str() else {
            return;
        };

        if let Some(title) = moved["title"].as_str() {
            title_seen(&format!("web-{tab}"), title);
        }

        // The site's own mark, on the same event and under a label of its own, so that
        // "the tab has a favicon" is a question the gate can ask later. Batch 2, and the
        // one thing about a tab's bar that a runner can see without a picture.
        if let Some(icon) = moved["icon"].as_str().filter(|one| !one.is_empty()) {
            title_seen(&format!("icon-{tab}"), icon);
        }
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

    // **Batch 2's own rows, before anything else is opened.** They were after the
    // counting until a round proved they cannot be: every browser this process opens
    // after the first two is a browser the runtime does not bring up - on Windows the
    // call that makes it never comes back and the main thread stops answering from that
    // moment, which is the batch 1.5 finding - so a row measured *after* the gate's own
    // window is a row measured on a dead main thread. Everything below this line is
    // allowed to cost the process; nothing above it is.
    //
    // **With an end of their own**, because an answer that never comes is a state this
    // engine has: the first flagged run to reach these rows stopped inside the third of
    // them and said nothing about the profiles or the engine's own pages afterwards.
    // Every row prints as it is measured, so a run that gives up here keeps the rows it
    // already got.
    let rows = app.clone();
    let labels = tab_labels.clone();
    let (sending, waiting) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        web_tab_rows(&rows, &labels);
        let _ = sending.send(());
    });
    if waiting.recv_timeout(ROWS).is_err() {
        check(
            "batch 2's rows all came back",
            false,
            &format!(
                "one of them did not answer in {} seconds; the rows above are the measured ones",
                ROWS.as_secs()
            ),
        );
    }
    pulse(app, "batch 2's rows");

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
    // **A title that never arrived is not a title without the mark in it.** One Windows
    // run reported no title at all - the main thread had stopped before the interface
    // renamed itself - and this check read the silence as "the interface was not
    // renamed", which is a pass nobody earned. So it asks first whether the interface
    // said anything, and says "not measured" in as many words when it did not; the
    // harness reads that phrase and leaves criterion 4 unanswered.
    let interface_spoke = spoke("main");
    check(
        "an extension's content script never reaches the app's own interface",
        !in_the_app && interface_spoke,
        if in_the_app {
            "the mark is in the interface's own title"
        } else if interface_spoke {
            "the interface renamed itself and never carried the mark"
        } else {
            "not measured: no title arrived from the interface at all"
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
    let pane = pane(at)?;

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

/// The pane a gate tab sits in, which is where `web_place` is told to put it.
///
/// Inside a 1024 by 768 screen, which is what the runners have: batch 1.5's first
/// pictures put the engine's own pages at x = 1180 and photographed the desktop beside
/// them, so a screenshot corroborated nothing. Everything the gate opens is in the
/// top-left 1024 by 768, tabs on one column and pages on the next.
fn pane(at: usize) -> Result<crate::web_tabs::Pane, String> {
    let y = if at % 2 == 0 { 60.0 } else { 330.0 };
    serde_json::from_value(serde_json::json!({
        "x": 400.0, "y": y, "width": 300.0, "height": 260.0
    }))
    .map_err(|error| error.to_string())
}

/// **Batch 2's own rows.** What a web tab on nib's own Chromium has to do, measured by
/// the app on itself rather than claimed in a table.
///
/// In the order a reader would do them, and every one of them through the command that
/// ships rather than beside it:
///
/// * **the switch**, which is the row the round-six drive turned on WebView2: hiding a
///   page and showing another is two calls into the engine and no rebuild, so it has to
///   be milliseconds and the webview has to still be there afterwards. Both are asked.
/// * **the two channels to a page**, asked apart, because they fail apart: a script the
///   app runs in a page needs nothing but the engine's message queue, and an *answer* out
///   of one travels the engine's `DevTools` protocol. `web_look` and the favicon are the
///   second kind, so a build where only the first works is a finding worth a row of its
///   own rather than two mysterious noes.
/// * **back and forward**, which under this engine are the engine's own: a tab sent
///   somewhere new can go back, and after the step it is where it was.
/// * **the place**, scrolled and read back, which is what keeps a revived tab where the
///   reading was.
/// * **`localStorage`**, written here and read on the *next run of the process*, which
///   is the session criterion: the mark is looked for before it is written, so the
///   second run of the same binary is the one that answers yes.
/// * **one browser process**, which `gate.py` counts off the process tree; this only
///   says how many tabs were open when it counted.
fn web_tab_rows(app: &AppHandle, tabs: &[String]) {
    let Some(first) = tabs.first() else {
        check("batch 2's rows", false, "no web tab to measure");
        return;
    };
    // The tab's own id, which is what every command below takes: the label is
    // `web-<tab>` and the gate named it `gate-<n>`.
    let tab = first.trim_start_matches("web-").to_owned();

    // Which folder nib's own interface asked the engine for, said out loud. Batch 1.5
    // found a *third* profile on Windows that nothing in nib asks for by name, and the
    // runtime only derives one of those when a webview's `data_directory` does not
    // resolve under the cache root - so the path this build handed it is the one thing
    // that was missing from the picture. Slashes the other way round, because a
    // backslash in a JSON string is an escape.
    if let Ok(profile) = super::app_profile(app) {
        say(&format!(
            "\"event\":\"profile\",\"interface\":\"{}\"",
            profile.display().to_string().replace('\\', "/")
        ));
    }

    // The switch. Hidden and shown again, timed, and then asked whether the page is
    // still there - which is the whole of what round six fixed on the other engine.
    let switch = Instant::now();
    let hidden =
        pane(0).and_then(|one| crate::web_tabs::web_place(app.clone(), tab.clone(), one, false));
    let away = switch.elapsed().as_micros();

    let back_on = Instant::now();
    let shown =
        pane(0).and_then(|one| crate::web_tabs::web_place(app.clone(), tab.clone(), one, true));
    let to_web = back_on.elapsed().as_micros();

    let alive = app.get_webview(first).is_some();
    check(
        "a switch away from a web tab and back keeps the page",
        hidden.is_ok() && shown.is_ok() && alive,
        &format!(
            "hidden in {away} us, shown in {to_web} us, the webview {}",
            if alive { "is still there" } else { "is gone" }
        ),
    );
    say(&format!(
        "\"event\":\"switch\",\"away_us\":{away},\"to_web_us\":{to_web},\"kept\":{alive}"
    ));
    pulse(app, "the switch");

    // **The two ways a page can be talked to, told apart.** Running a script in a page
    // needs nothing but the engine's own message queue; getting an *answer* back out of
    // one travels the engine's DevTools protocol, and under this engine those are
    // different channels with different failure modes - a page that never answers is why
    // these rows have an end at all. So the gate asks the same page the same question
    // twice: once through its own address, which only needs the script to run, and once
    // through the answer channel the app's own commands use. A yes on the first and a no
    // on the second is a finding about the engine rather than about the page.
    let ran = page_says(app, &tab, "'ok'");
    check(
        "a script the app runs in a page runs",
        ran.as_deref() == Some("ok"),
        "the page put the answer in its own address, which needs no answer channel",
    );
    let answered = ask_page(app, &tab, "'ok'");
    check(
        "a page's answer comes back through the engine's own channel",
        answered.as_deref() == Some("ok"),
        "what web_look and the favicon are read with",
    );
    pulse(app, "the page's answer");

    // Back and forward, which on this engine are the engine's own. The tab is sent
    // somewhere new, which is what gives it somewhere to go back to, and then stepped.
    // Where it landed is read off the engine rather than out of the page: the history is
    // the engine's under this build, so the engine is the one to ask, and its answer
    // needs nothing of the page.
    let sent = crate::web_tabs::web_navigate(app.clone(), tab.clone(), SITES[1].to_owned());
    std::thread::sleep(SETTLE);
    let stepped = step_back(app, &tab);
    std::thread::sleep(SETTLE);

    let landed = where_now(app, &tab);
    let went_back = landed.starts_with(SITES[0].trim_end_matches('/'));
    check(
        "back is the engine's own history and lands where the tab was",
        sent.is_ok() && stepped.is_ok() && went_back,
        &format!("after a step back the tab is at {landed}"),
    );
    pulse(app, "the step back");

    // The place: scrolled, then read out of the page the way `web_look` does when a tab
    // is left. A number rather than a yes, because "the place is kept" is a claim about
    // a number being the same twice.
    //
    // The page is made tall first, and that is not cheating: `example.com` is one screen
    // high and a scroll to 900 on a page with nowhere to go is a scroll to 0, which
    // would have measured the site rather than the mechanism. What is being asked is
    // whether an offset set in the page comes back through `web_look`.
    if let Some(view) = app.get_webview(first) {
        let _ = view.eval("document.documentElement.style.minHeight = '4000px'");
    }
    std::thread::sleep(Duration::from_secs(1));
    let scrolled = crate::web_tabs::web_scroll(app.clone(), tab.clone(), 0.0, 900.0);
    std::thread::sleep(Duration::from_secs(2));
    let read = place(app, &tab);
    check(
        "the place on the page is read back out of it",
        scrolled.is_ok() && read.as_ref().is_ok_and(|y| *y > 0.0),
        &match &read {
            Ok(y) => format!("the reading is {y} down the page, where 900 was asked for"),
            Err(error) => format!("the page could not be read: {error}"),
        },
    );

    // What the bar over the tab is drawn from: the page's own name and the site's own
    // mark, both of which arrive on the event `web_tabs.rs` emits. A runner cannot see a
    // favicon in a picture of a 300-pixel pane, but it can see whether the window was
    // ever told about one.
    check(
        "a web tab tells the window what the page is called",
        spoke(first),
        &format!("{} titles for {first}", titles_for(first)),
    );
    check(
        "a web tab tells the window the site's own mark",
        spoke(&format!("icon-{tab}")),
        "the favicon the tab and the sidebar are drawn with",
    );

    // The session, across runs of the process. Looked for first: on the first run of
    // this binary there is nothing to find, and on the second there is - which is what
    // "a login survives a relaunch" means when the login is a value in a profile on
    // disk.
    let (kept, baked) = read_mark(app, &tab);
    write_mark(app, &tab);
    check(
        "localStorage from an earlier run of the app is still there",
        kept.as_deref() == Some(MARK),
        &match kept {
            Some(one) if one == MARK => "the mark this binary wrote last time".to_string(),
            Some(one) => format!("something else was there: {one}"),
            None => "nothing yet, which is what a first run says".to_string(),
        },
    );
    check(
        "a session cookie from an earlier run of the app is still there",
        baked.as_deref() == Some(MARK),
        &match baked {
            Some(one) if one == MARK => "the session cookie this binary set last time".to_string(),
            Some(one) => format!("something else was there: {one}"),
            None => "nothing yet, which is what a first run says".to_string(),
        },
    );

    // And the closer half of the same question, which is the one Emil reported: a note
    // closed and opened again is a new webview on the same profile, and what it can read
    // is what a login is. The tab is taken away with `keep`, which is what the window
    // does when a pane goes, and then opened again at the same address.
    let at = 0;
    crate::web_tabs::web_close(app.clone(), app.state(), tab.clone(), true);
    std::thread::sleep(Duration::from_secs(2));
    // Through the same patience the first one was opened with: on Windows the *second*
    // webview of a run has been the call that never comes back, and this is the second
    // one of this tab.
    let again = opened_within(app, at, SITES[0]);
    std::thread::sleep(SETTLE);
    let (over, cooked) = if again.is_ok() {
        read_mark(app, &tab)
    } else {
        (None, None)
    };
    check(
        "the site's own storage survives the tab being closed and opened again",
        over.as_deref() == Some(MARK) && cooked.as_deref() == Some(MARK),
        &match (&again, &over, &cooked) {
            (Err(error), _, _) => format!("the tab did not open again: {error}"),
            (Ok(_), Some(one), Some(two)) if one == MARK && two == MARK => {
                "the value and the cookie are both still there".to_string()
            }
            (Ok(_), one, two) => format!(
                "localStorage {}, the cookie {}",
                if one.is_some() { "kept" } else { "**gone**" },
                if two.is_some() { "kept" } else { "**gone**" }
            ),
        },
    );

    // What the window is handed when it wants to draw something over a page. `None`
    // here is the answer this engine gives - Chromium photographs a page over the
    // DevTools protocol, which is batch 8 - and the window reads it as "keep your own
    // ground", which is how an overlay stays above a page at all.
    let shot = tauri::async_runtime::block_on(crate::web_tabs::web_shot(app.clone(), tab.clone()));
    check(
        "a page answers a photograph with nothing, so an overlay keeps its own ground",
        matches!(&shot, Ok(None)),
        match &shot {
            Ok(None) => "nothing, which is what the window expects here",
            Ok(Some(_)) => "a picture, which is better than the window expects",
            Err(_) => "an error, which the window reads as nothing",
        },
    );
}

/// What the gate writes into `localStorage` to find again on the next run.
const MARK: &str = "nib-gate-2";

/// A step back, through the app's own command.
fn step_back(app: &AppHandle, tab: &str) -> Result<(), String> {
    crate::web_tabs::web_step(
        app.clone(),
        app.state::<crate::web_tabs::WebTabs>(),
        tab.to_owned(),
        serde_json::from_value(serde_json::json!("back")).map_err(|error| error.to_string())?,
    )
}

/// Where the engine says the tab is.
///
/// The engine rather than the page: under this build the history is Chromium's, so
/// Chromium is the one to ask whether a step landed, and the answer travels the same
/// message queue every other call here uses instead of the page's answer channel.
/// Said as the engine said it, because the three ways this can be nothing are three
/// different findings: no webview at all, a message the engine dropped (which comes back
/// as an error), and **a browser whose main frame has no address**, which is what a
/// browser that has never navigated looks like from outside. One round of the gate spent
/// a table's worth of noes on the third one without being able to name it.
fn where_now(app: &AppHandle, tab: &str) -> String {
    let Some(view) = app.get_webview(&format!("web-{tab}")) else {
        return "no webview under that label".to_string();
    };

    match view.url() {
        Ok(url) => url.to_string(),
        Err(error) => format!("the engine would not say: {error}"),
    }
}

/// How far down the page the reading has got, through `web_look` - the command the window
/// calls when a tab is left, so the answer is the one that is written against the note.
///
/// Read out of the answer as JSON because `Look`'s fields are the web-tab module's own
/// to keep private, and a gate is not a reason to open them.
fn place(app: &AppHandle, tab: &str) -> Result<f64, String> {
    let said = tauri::async_runtime::block_on(crate::web_tabs::web_look(
        app.clone(),
        app.state::<crate::web_tabs::WebTabs>(),
        tab.to_owned(),
    ))?;

    Ok(serde_json::to_value(said)
        .ok()
        .and_then(|one| one["y"].as_f64())
        .unwrap_or_default())
}

/// What an earlier run of this binary left behind in the site's own storage: the value
/// in `localStorage`, and the **session cookie** beside it.
///
/// Two of them because they are kept by two different mechanisms and only one of them
/// is a switch. `localStorage` is on disk because the profile is; a session cookie is
/// dropped when the process exits unless `persist_session_cookies` is on, and most
/// logins are session cookies - which is the half of Emil's *"cookies etc. ... even
/// across application restarts"* that had to be asked for. See `cef/src/main.rs`.
fn read_mark(app: &AppHandle, tab: &str) -> (Option<String>, Option<String>) {
    let (said, how) = answer(
        app,
        tab,
        &format!(
            "(function () {{ \
               var kept = ''; var baked = ''; \
               try {{ kept = localStorage.getItem('{MARK}') || '' }} catch (error) {{}} \
               try {{ \
                 var found = document.cookie.split('; ').find(function (one) {{ \
                   return one.indexOf('{MARK}=') === 0 \
                 }}); \
                 baked = found ? found.slice('{MARK}='.length) : '' \
               }} catch (error) {{}} \
               return (kept + '.' + baked).replace(/[^A-Za-z0-9._-]/g, '') \
             }})()"
        ),
    );
    say(&format!("\"event\":\"mark\",\"read\":\"{how}\""));

    // A full stop between them, and nothing but letters, digits and three punctuation
    // marks in what comes back: the second of the two channels this can be read over
    // carries the answer in the page's own address, and an address is no place for an
    // arbitrary string. The gate's own mark is spelled to fit.
    let said = said.unwrap_or_default();
    let (kept, baked) = said.split_once('.').unwrap_or_default();
    (
        (!kept.is_empty()).then(|| kept.to_owned()),
        (!baked.is_empty()).then(|| baked.to_owned()),
    )
}

/// And both marks left behind for the next run of the process to find.
///
/// The cookie carries no `expires` and no `max-age`, which is what makes it a session
/// cookie: it is the kind a login uses and the kind that is gone tomorrow unless the
/// profile was told to keep it.
fn write_mark(app: &AppHandle, tab: &str) {
    if let Some(view) = app.get_webview(&format!("web-{tab}")) {
        let _ = view.eval(format!(
            "try {{ localStorage.setItem('{MARK}', '{MARK}') }} catch (error) {{}}; \
             try {{ document.cookie = '{MARK}={MARK}; path=/; SameSite=Lax' }} catch (error) {{}}"
        ));
    }
}

/// One question put to the page through whichever channel answers it, and which one did.
///
/// The app's own commands read a page through the engine's answer channel and there is
/// nothing else for them to use, so [`ask_page`] is asked first: a row measured any other
/// way would not be a row about nib. But a claim like *"the login is still there"* is
/// about what the profile kept rather than about how it was read, and it would be a poor
/// gate that could not answer it on a build whose answer channel is silent. So the second
/// way is [`page_says`], and the run says which one it got the answer from.
fn answer(app: &AppHandle, tab: &str, script: &str) -> (Option<String>, &'static str) {
    if let Some(said) = ask_page(app, tab, script) {
        return (Some(said), "the engine's own answer channel");
    }

    (
        page_says(app, tab, script),
        "the address the page put it in, because the answer channel said nothing",
    )
}

/// One script run in the page, and the answer read back out of the page's own address.
///
/// The page is asked to put its answer in its own fragment with `history.replaceState`,
/// which loads nothing and leaves no entry in the history, and the address is then read
/// off the engine. **Two things that can only fail together**: it needs a script to run
/// and it needs the engine to say where a webview is, and it needs no answer to travel
/// back out of the page - which is the channel that has gone silent under this engine.
///
/// Only for answers that can live in an address: letters, digits, and the three marks
/// `page_says` does not strip. The gate's own answers are spelled that way.
fn page_says(app: &AppHandle, tab: &str, script: &str) -> Option<String> {
    let view = app.get_webview(&format!("web-{tab}"))?;
    view.eval(format!(
        "try {{ history.replaceState(null, '', '#{FRAGMENT}=' + \
           String({script}).replace(/[^A-Za-z0-9._-]/g, '')) }} catch (error) {{}}"
    ))
    .ok()?;
    std::thread::sleep(Duration::from_secs(2));

    let url = view.url().ok()?.to_string();
    url.split_once(&format!("#{FRAGMENT}="))
        .map(|(_, said)| said.to_owned())
        .filter(|said| !said.is_empty())
}

/// What the gate's own answers are labelled with in a page's address. Its own name,
/// because a fragment belongs to the site and the site might be using one.
const FRAGMENT: &str = "nib-gate";

/// One script run in the page, and the answer it returned.
fn ask_page(app: &AppHandle, tab: &str, script: &str) -> Option<String> {
    let view = app.get_webview(&format!("web-{tab}"))?;
    let (sending, waiting) = std::sync::mpsc::channel::<String>();
    view.eval_with_callback(script.to_owned(), move |answer| {
        let _ = sending.send(answer);
    })
    .ok()?;

    let answer = waiting.recv_timeout(Duration::from_secs(10)).ok()?;
    serde_json::from_str::<String>(&answer).ok()
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
