//! An agent's own tabs: pages nobody sees (docs/agent-native.md 6).
//!
//! **Out of sight, not hidden.** A child webview of the reader's window, shown, at
//! (-10000, -10000) in the window's own coordinates: a child is clipped to its parent, so
//! no pixel of it reaches a screen, and to the engine it is a visible page at a desktop
//! size, which paints, runs its timers at full speed and takes input. The spike measured
//! it (section 3); `scripts/agent-tab-probe.py` keeps measuring it. On nib's own Chromium
//! it is better still: a browser with no window at all (`engines/cef.rs`), and everything
//! below but how it is built is the same.
//!
//! **Where they live.** In the reader's first window, and not in a window of their own
//! that nobody sees. Measured both ways: a page in a window that is hidden keeps running
//! just as a page in a minimised one does, so the choice is not about the engine. It is
//! about the app's own life: nib ends with its last window, a quit asks every window
//! about its unsaved notes, and a window of the agents' own would be a window that never
//! answers and an app that never ends. The design's answer to "the window closed while an
//! agent works" is the window hiding into the tray instead (6.1, open question 6), which
//! keeps these pages alive without any of that.
//!
//! **Built quiet.** On `about:blank`, `focused(false)` (wry otherwise hands every new
//! webview the keyboard), developer tools off, and before anything loads the engine's
//! furniture off and every event that could reach the reader answered in `quiet`. None
//! of a reader's tab's listeners: not the browser's keys, not the page-first keys, not
//! full screen, not the permission bubble. Its label is `agent-`, which nothing that looks
//! for a reader's page matches.
//!
//! **How many, and for how long (6.4).** Four an agent and eight in all by default; past
//! that the least recently used is parked - its page closed, its address kept - and built
//! again by the next call on it. A tab nobody called for ten minutes is parked, and an
//! agent that said goodbye has its tabs closed ten minutes later.

use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(all(windows, not(feature = "cef")))]
use std::sync::mpsc::sync_channel;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter as _, Url};
#[cfg(all(windows, not(feature = "cef")))]
use tauri::{LogicalPosition, LogicalSize, Manager as _, WebviewBuilder, WebviewUrl};

use super::cdp;
use super::engines::View;
use super::quiet::{self, Owner};
use super::verbs::{AgentTab, Answer, Code, Event, Store, EVENT};

/// What an agent's page is labelled: `agent-a3`.
pub const LABEL: &str = "agent-";

/// Where an agent's page sits in the window's own coordinates: far enough past the
/// window's corner that a popup the page raises lands on no screen either (6.5).
#[cfg(all(windows, not(feature = "cef")))]
const AWAY: f64 = -10_000.0;

/// An agent tab's size when none is asked for, in CSS pixels.
pub const WIDTH: u32 = 1280;
/// An agent tab's height when none is asked for.
pub const HEIGHT: u32 = 800;

/// Every agent's tabs together, at most, before the least recently used is parked.
const ALL_TABS: usize = 8;

/// How long a tab may go uncalled before it is parked, and how long an agent that said
/// goodbye keeps its tabs.
const IDLE: Duration = Duration::from_secs(600);

/// How long a page may take to be built.
pub(super) const BUILDING: Duration = Duration::from_secs(20);

/// One agent tab.
#[derive(Clone, Debug)]
pub struct Tab {
    /// Its id, `a3`.
    pub id: String,
    /// The agent it belongs to.
    pub agent: String,
    /// Which store, as the agent asked for it.
    pub store: Store,
    /// The store's name as the engine has it: `None` for the one every space shares.
    pub store_name: Option<String>,
    /// Where it is, or was when it was parked.
    pub url: String,
    /// What it calls itself.
    pub title: String,
    /// Whether a page is loading.
    pub loading: bool,
    /// Whether its page is closed to save memory.
    pub parked: bool,
    /// When an agent last called on it.
    pub used: Instant,
    /// Its size in CSS pixels.
    pub size: (u32, u32),
}

impl Tab {
    /// Its page's label.
    pub fn label(&self) -> String {
        format!("{LABEL}{}", self.id)
    }

    /// As `browser_tabs` lists it.
    pub fn listed(&self) -> AgentTab {
        AgentTab {
            id: self.id.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            loading: self.loading,
            store: self.store,
            parked: self.parked,
        }
    }
}

/// Every agent tab, in the order they were opened.
static TABS: Mutex<Vec<Tab>> = Mutex::new(Vec::new());

/// Agents that said goodbye, and when.
static GONE: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

/// The next tab's number.
static NEXT: AtomicU64 = AtomicU64::new(1);

/// Whether the timer that parks and closes has been started.
static TICKING: std::sync::Once = std::sync::Once::new();

fn tabs() -> std::sync::MutexGuard<'static, Vec<Tab>> {
    TABS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The agent and tab a page belongs to, while it is an agent's.
pub fn owner(label: &str) -> Option<Owner> {
    let id = label.strip_prefix(LABEL)?;
    tabs().iter().find(|one| one.id == id).map(|one| Owner {
        agent: one.agent.clone(),
        tab: one.id.clone(),
        label: label.to_string(),
    })
}

/// An agent's tabs.
pub fn of(agent: &str) -> Vec<Tab> {
    tabs()
        .iter()
        .filter(|one| one.agent == agent)
        .cloned()
        .collect()
}

/// One of an agent's tabs.
pub fn find(agent: &str, id: &str) -> Option<Tab> {
    tabs()
        .iter()
        .find(|one| one.agent == agent && one.id == id)
        .cloned()
}

/// Whether a page an agent's tab is on may open a window to `url`: the agent's own
/// rules about the site.
pub fn may_open(owner: &Owner, url: &str) -> Result<(), String> {
    super::policy::site_allowed_for(&owner.agent, url, store_of(&owner.tab))
}

/// Which store a tab is in.
fn store_of(id: &str) -> Store {
    tabs()
        .iter()
        .find(|one| one.id == id)
        .map_or(Store::Reader, |one| one.store)
}

/// Opens an agent tab out of sight: its record kept, room made, the page built and sent
/// to `url`. Answers the tab, or why not.
pub fn open(
    app: &AppHandle,
    agent: &str,
    url: &str,
    store: Store,
    store_name: Option<String>,
    size: (u32, u32),
    most: usize,
) -> Result<Tab, Answer> {
    let address = web_address(url)?;
    if let Some(why) = super::memory::too_much() {
        return Err(Answer::error(Code::Limit, why));
    }
    make_room(app, agent, most, None);
    let tab = Tab {
        id: format!("a{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: agent.to_string(),
        store,
        store_name,
        url: address.to_string(),
        title: String::new(),
        loading: true,
        parked: false,
        used: Instant::now(),
        size: (size.0.clamp(320, 3840), size.1.clamp(240, 2400)),
    };
    tabs().push(tab.clone());
    start_ticking(app);
    if let Err(why) = build(app, &tab, Some(&address)) {
        tabs().retain(|one| one.id != tab.id);
        return Err(Answer::error(Code::Failed, why));
    }
    said(app, &tab);
    Ok(tab)
}

/// The page of one of an agent's tabs, built again first if it was parked. Notes the
/// call, which is what keeps the tab from being parked.
pub fn page(app: &AppHandle, agent: &str, id: &str) -> Result<(Tab, View), Answer> {
    let Some(mut tab) = find(agent, id) else {
        return Err(Answer::error(
            Code::NoSuchTab,
            format!("{id} is not one of this agent's tabs: browser_tabs lists them"),
        ));
    };
    touch(id);
    if let Some(view) = super::engines::view(app, &tab.label()) {
        return Ok((tab, view));
    }
    // Parked: built again where it was.
    let address = web_address(&tab.url)?;
    make_room(app, agent, usize::MAX, Some(id));
    build(app, &tab, Some(&address)).map_err(|why| Answer::error(Code::Failed, why))?;
    tab.parked = false;
    set(id, |one| {
        one.parked = false;
        one.loading = true;
    });
    super::engines::view(app, &tab.label())
        .map(|view| (tab, view))
        .ok_or_else(|| Answer::error(Code::Failed, "the tab's page could not be built again"))
}

fn touch(id: &str) {
    set(id, |one| one.used = Instant::now());
}

/// Changes one tab's record.
pub fn set(id: &str, change: impl FnOnce(&mut Tab)) {
    if let Some(one) = tabs().iter_mut().find(|one| one.id == id) {
        change(one);
    }
}

/// An address an agent's page may go to: the web, and nothing of the machine's.
fn web_address(url: &str) -> Result<Url, Answer> {
    let address: Url = url.trim().parse().map_err(|error| {
        Answer::error(
            Code::BadArguments,
            format!("that is not an address: {error}"),
        )
    })?;
    if matches!(address.scheme(), "http" | "https") || address.as_str() == "about:blank" {
        Ok(address)
    } else {
        Err(Answer::error(
            Code::BadArguments,
            "an agent's tab opens http and https addresses",
        ))
    }
}

/// Parks tabs until the agent has fewer than `most` and all agents fewer than eight,
/// least recently used first, never `keep`.
fn make_room(app: &AppHandle, agent: &str, most: usize, keep: Option<&str>) {
    loop {
        let open: Vec<Tab> = tabs().iter().filter(|one| !one.parked).cloned().collect();
        let mine = open.iter().filter(|one| one.agent == agent).count();
        let candidates: Vec<&Tab> = if mine >= most {
            open.iter().filter(|one| one.agent == agent).collect()
        } else if open.len() >= ALL_TABS {
            open.iter().collect()
        } else {
            return;
        };
        let Some(oldest) = candidates
            .into_iter()
            .filter(|one| Some(one.id.as_str()) != keep)
            .min_by_key(|one| one.used)
        else {
            return;
        };
        park(app, &oldest.id);
    }
}

/// Parks a tab: its page closed, its record kept.
pub fn park(app: &AppHandle, id: &str) {
    let label = format!("{LABEL}{id}");
    set(id, |one| {
        one.parked = true;
        one.loading = false;
    });
    let_go(app, &label);
}

/// Closes a tab for good.
pub fn close(app: &AppHandle, id: &str) {
    let gone = {
        let mut all = tabs();
        let at = all.iter().position(|one| one.id == id);
        at.map(|at| all.remove(at))
    };
    if let Some(tab) = gone {
        let_go(app, &tab.label());
        super::stop::tab_gone(&tab.id);
        let _ = app.emit(
            EVENT,
            Event::Closed {
                agent: tab.agent,
                id: tab.id,
            },
        );
    }
}

/// Closes every tab of an agent, or of every agent.
pub fn close_all(app: &AppHandle, agent: Option<&str>) {
    let ids: Vec<String> = tabs()
        .iter()
        .filter(|one| agent.is_none_or(|agent| one.agent == agent))
        .map(|one| one.id.clone())
        .collect();
    for id in ids {
        close(app, &id);
    }
}

/// The session anchor's label: the page that holds the store every space shares open
/// (`session::anchor` in `web_tabs.rs`).
const ANCHOR: &str = "web-session";

/// A page of the reader's store `store` to read it through, and whether it was built for
/// that: the page that holds the shared store's session open when there is one, or a
/// blank page built there, which loads no site and is let go of with `let_go_of_bare`.
pub(super) fn bare(app: &AppHandle, store: Option<&str>) -> Result<(View, bool), String> {
    if store.is_none() {
        if let Some(anchor) = super::engines::view(app, ANCHOR) {
            return Ok((anchor, false));
        }
    }
    let tab = Tab {
        id: format!("c{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: String::new(),
        store: Store::Reader,
        store_name: store.map(str::to_string),
        url: "about:blank".into(),
        title: String::new(),
        loading: false,
        parked: false,
        used: Instant::now(),
        size: (WIDTH, HEIGHT),
    };
    build_page(app, &tab, None)?;
    super::engines::view(app, &tab.label())
        .map(|view| (view, true))
        .ok_or_else(|| "the page was never built".into())
}

/// Closes a page `bare` built.
pub(super) fn let_go_of_bare(app: &AppHandle, view: &View) {
    let_go(app, &view.label());
}

/// A page closed, with everything kept about it.
fn let_go(app: &AppHandle, label: &str) {
    if let Some(view) = super::engines::view(app, label) {
        view.close();
    }
    cdp::forget(label);
    quiet::forget(app, label);
    super::watch::forget(label);
}

/// An agent said goodbye: its tabs go in ten minutes, unless it comes back.
pub fn bye(agent: &str) {
    let mut gone = GONE.lock().unwrap_or_else(PoisonError::into_inner);
    gone.retain(|(one, _)| one != agent);
    gone.push((agent.to_string(), Instant::now()));
}

/// An agent is back: nothing of its is closed.
pub fn back(agent: &str) {
    GONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|(one, _)| one != agent);
}

/// Tells the window about a tab: where it is and what it calls itself.
pub fn said(app: &AppHandle, tab: &Tab) {
    let _ = app.emit(
        EVENT,
        Event::Tab {
            agent: tab.agent.clone(),
            id: tab.id.clone(),
            url: tab.url.clone(),
            title: tab.title.clone(),
        },
    );
}

/// Builds a tab's page, out of sight and quiet, and sends it to `address` - or leaves it
/// on nothing for a window the engine hands over. Waits for the build. A tab in a twin of
/// the reader's store is handed the reader's cookies first, on a page that has loaded
/// nothing yet (see `engines`).
fn build(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    let Some(reader) = super::engines::reader_of(tab.store_name.as_deref()) else {
        return build_page(app, tab, address);
    };
    build_page(app, tab, None)?;
    let label = tab.label();
    let twin = super::engines::view(app, &label).ok_or("the page was never built")?;
    super::twin::carry(app, reader, &twin);
    if let Some(address) = address {
        cdp::call(
            &twin,
            "Page.navigate",
            &serde_json::json!({ "url": address.as_str() }),
        )?;
    }
    Ok(())
}

/// Builds a tab's page on nib's own Chromium: a browser with no window.
#[cfg(feature = "cef")]
fn build_page(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    super::engines::cef::build(
        app,
        &Owner {
            agent: tab.agent.clone(),
            tab: tab.id.clone(),
            label: tab.label(),
        },
        tab.store_name.as_deref(),
        tab.size,
        address.map(Url::as_str),
    )
}

/// Builds a tab's page on `WebView2`: a child of the reader's window, out of its sight.
#[cfg(all(windows, not(feature = "cef")))]
fn build_page(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    let window =
        super::shell::host(app).ok_or("nib has no window for an agent's tab to live in")?;
    let label = tab.label();
    let blank: Url = "about:blank"
        .parse()
        .map_err(|error| format!("no blank page: {error}"))?;
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(blank))
        .focused(false)
        .devtools(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, tab.store_name.as_deref())?;

    let (answered, answer) = sync_channel::<Result<(), String>>(1);
    let building = app.clone();
    let owner = Owner {
        agent: tab.agent.clone(),
        tab: tab.id.clone(),
        label: label.clone(),
    };
    let store = tab.store_name.clone();
    let (width, height) = tab.size;
    let going = address.map(ToString::to_string);
    app.run_on_main_thread(move || {
        let builder =
            crate::web_tabs::on_shared_session(builder, &window, &building, store.as_deref());
        let made = window
            .add_child(
                builder,
                LogicalPosition::new(AWAY, AWAY),
                LogicalSize::new(f64::from(width), f64::from(height)),
            )
            .map_err(|error| format!("the page could not be built: {error}"));
        let made = made.and_then(|view| {
            let setting = building.clone();
            view.with_webview(move |platform| {
                crate::web_tabs::keep_session(store.as_deref(), &platform);
                let Some(core) = cdp::core_of(&platform) else {
                    return;
                };
                // Every script the runtime registered on the page taken back before
                // anything else is put on it, the way a reader's tab is (web_worlds.rs):
                // the dialog plugin's `alert` and `confirm` with them, so a page's dialogs
                // reach the engine and the agent rather than the app. Then the page's own
                // stubs, and then the site, all in this one turn of the window's thread.
                let _ = crate::web_worlds::cleared(&platform, "");
                quiet::quieten(&setting, &core, &owner);
                cdp::follow(&core, &owner.label);
                listen(&setting, &core, &owner);
                match going {
                    Some(url) => navigate_now(&core, &url),
                    None => quiet::hand_over(&owner.tab, Some(&core)),
                }
            })
            .map_err(|error| format!("the page could not be set up: {error}"))
        });
        let _ = answered.try_send(made);
    })
    .map_err(|error| format!("the window could not be reached: {error}"))?;

    answer
        .recv_timeout(BUILDING)
        .map_err(|_| "the page was never built".to_string())?
}

/// Sends a page somewhere, on the window's thread.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the page is sent through WebView2's own COM interface"
)]
fn navigate_now(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2, url: &str) {
    // Safe: on the window's thread, where the engine's objects live.
    let _ = unsafe { core.Navigate(&windows_core::HSTRING::from(url)) };
}

/// Follows what a tab's page does: where it goes, what it calls itself, and a site the
/// agent may not visit, stopped before it loads (9.2).
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "navigation and title events are WebView2's own, reached through its COM interfaces"
)]
fn listen(
    app: &AppHandle,
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    owner: &Owner,
) {
    use webview2_com::{
        DocumentTitleChangedEventHandler, NavigationCompletedEventHandler,
        NavigationStartingEventHandler,
    };
    use windows_core::PWSTR;

    let starting = {
        let (owner, app) = (owner.clone(), app.clone());
        NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut uri = PWSTR::null();
            // Safe: the event's own arguments, on the window's thread.
            let url = unsafe {
                args.Uri(&raw mut uri)?;
                webview2_com::take_pwstr(uri)
            };
            if let Err(why) = may_open(&owner, &url) {
                // Safe: as above.
                unsafe { args.SetCancel(true)? };
                cdp::heard(&owner.label)
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .say(
                        "warning",
                        format!("nib stopped the page going to {url}: {why}"),
                    );
                return Ok(());
            }
            set(&owner.tab, |one| one.loading = true);
            let _ = &app;
            Ok(())
        }))
    };
    let completed = {
        let (owner, app) = (owner.clone(), app.clone());
        NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
            let mut uri = PWSTR::null();
            let url = sender.and_then(|core| {
                // Safe: the engine's own object, on the window's thread.
                unsafe { core.Source(&raw mut uri).ok()? };
                Some(webview2_com::take_pwstr(uri))
            });
            set(&owner.tab, |one| {
                one.loading = false;
                if let Some(url) = url {
                    one.url = url;
                }
            });
            if let Some(tab) = tabs().iter().find(|one| one.id == owner.tab).cloned() {
                said(&app, &tab);
            }
            Ok(())
        }))
    };
    let titled = {
        let (owner, app) = (owner.clone(), app.clone());
        DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
            let mut title = PWSTR::null();
            let title = sender.and_then(|core| {
                // Safe: as above.
                unsafe { core.DocumentTitle(&raw mut title).ok()? };
                Some(webview2_com::take_pwstr(title))
            });
            if let Some(title) = title {
                set(&owner.tab, |one| one.title = title);
            }
            if let Some(tab) = tabs().iter().find(|one| one.id == owner.tab).cloned() {
                said(&app, &tab);
            }
            Ok(())
        }))
    };
    let mut token = 0i64;
    // Safe: the engine holds the handlers for as long as the webview lives.
    unsafe {
        let _ = core.add_NavigationStarting(&starting, &raw mut token);
        let _ = core.add_NavigationCompleted(&completed, &raw mut token);
        let _ = core.add_DocumentTitleChanged(&titled, &raw mut token);
    }
}

/// Keeps a record for a window a page asked for, as a tab of the same agent in the same
/// store, and answers its id; the page is built by `build_popup` in the loop's next turn.
pub fn reserve_popup(opener: &Owner, url: &str) -> Option<String> {
    let (store, store_name, size) = {
        let all = tabs();
        let one = all.iter().find(|one| one.id == opener.tab)?;
        (one.store, one.store_name.clone(), one.size)
    };
    let tab = Tab {
        id: format!("a{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: opener.agent.clone(),
        store,
        store_name,
        url: url.to_string(),
        title: String::new(),
        loading: true,
        parked: false,
        used: Instant::now(),
        size,
    };
    let id = tab.id.clone();
    tabs().push(tab);
    cdp::heard(&opener.label)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .opened
        .push(id.clone());
    Some(id)
}

/// Builds the page for a window a page asked for and hands it to the engine. On the
/// window's thread, in the event loop's own turn.
#[cfg(all(windows, not(feature = "cef")))]
pub fn build_popup(app: &AppHandle, id: &str) {
    let Some(tab) = tabs().iter().find(|one| one.id == id).cloned() else {
        quiet::hand_over(id, None);
        return;
    };
    // Building waits for the engine, which this turn of the loop may do; answering
    // happens once the page's engine exists, inside `build`'s set-up.
    let building = app.clone();
    std::thread::spawn(move || {
        if build(&building, &tab, None).is_err() {
            let id = tab.id.clone();
            tabs().retain(|one| one.id != id);
            let _ = building.run_on_main_thread(move || quiet::hand_over(&id, None));
        } else {
            said(&building, &tab);
        }
    });
}

/// Agent tabs the reader was shown, by the agent tab's id: the reader's tab each became.
static SHOWN: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// The reader's tab an agent's tab became, if it was shown (6.7): the agent keeps
/// acting in it by either id.
pub fn shown_as(id: &str) -> Option<String> {
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .find(|(agent_tab, _)| agent_tab == id)
        .map(|(_, reader)| reader.clone())
}

/// Makes an agent's tab a tab of the reader's without loading it again (6.7): it stops
/// being the agent's - its dialogs, windows and permissions go back to being the
/// engine's and the reader's - and gets a reader's tab's listeners. The window has made
/// the reader's tab `reader` for it and places the page as it places any tab's.
#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
#[cfg(all(windows, not(feature = "cef")))]
pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    let tab = tabs()
        .iter()
        .find(|one| one.id == id)
        .cloned()
        .ok_or("there is no such agent tab")?;
    let label = tab.label();
    let view = app.get_webview(&label).ok_or(
        "that tab's page was parked to save memory: it opens again with the agent's next call",
    )?;
    tabs().retain(|one| one.id != id);
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    let _ = view.with_webview(|platform| {
        let Some(core) = cdp::core_of(&platform) else {
            return;
        };
        // Safe: on the window's thread, where the engine's objects live.
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2_8,
            };
            use windows_core::Interface as _;
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetAreDefaultScriptDialogsEnabled(true);
                let _ = settings.SetAreDefaultContextMenusEnabled(true);
                let _ = settings.SetAreDevToolsEnabled(true);
                if let Ok(three) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = three.SetAreBrowserAcceleratorKeysEnabled(true);
                }
                if let Ok(four) = settings.cast::<ICoreWebView2Settings4>() {
                    let _ = four.SetIsGeneralAutofillEnabled(true);
                    let _ = four.SetIsPasswordAutosaveEnabled(true);
                }
            }
            if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
                let _ = eight.SetIsMuted(false);
            }
        }
    });
    crate::web_tabs::hand_page_to(app, reader, &label, tab.store_name.clone());
    let _ = app.emit(
        EVENT,
        Event::Closed {
            agent: tab.agent,
            id: tab.id,
        },
    );
    Ok(())
}

/// On nib's own Chromium an agent's page has no window to put in the pane: it was never
/// a view, only pictures (`engines/cef.rs`). So Show opens its address as the reader's
/// tab, which loads it again (the window builds it the ordinary way when this answers
/// no page), and the agent's own tab closes; the agent acts on in the reader's tab by
/// either id, as it does after a Show on `WebView2`.
#[cfg(feature = "cef")]
pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    if find_any(id).is_none() {
        return Err("there is no such agent tab".into());
    }
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    close(app, id);
    Err("an agent's page on nib's own Chromium has no window: the tab loads its address".into())
}

/// Any agent's tab, by its id.
#[cfg(feature = "cef")]
fn find_any(id: &str) -> Option<Tab> {
    tabs().iter().find(|one| one.id == id).cloned()
}

/// Starts the one timer agents have, the first time a tab opens: every fifteen seconds
/// it parks what nobody used, closes what a gone agent left, and puts idle pages' domains
/// to sleep. Nothing runs before an agent's first tab.
fn start_ticking(app: &AppHandle) {
    TICKING.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(15));
            tick(&app);
        });
    });
}

fn tick(app: &AppHandle) {
    let idle: Vec<String> = tabs()
        .iter()
        .filter(|one| !one.parked && one.used.elapsed() >= IDLE)
        .map(|one| one.id.clone())
        .collect();
    for id in idle {
        park(app, &id);
    }
    let gone: Vec<String> = {
        let mut gone = GONE.lock().unwrap_or_else(PoisonError::into_inner);
        let due: Vec<String> = gone
            .iter()
            .filter(|(_, at)| at.elapsed() >= IDLE)
            .map(|(agent, _)| agent.clone())
            .collect();
        gone.retain(|(_, at)| at.elapsed() < IDLE);
        due
    };
    for agent in gone {
        close_all(app, Some(&agent));
    }
    cdp::sleep_idle(app);
    super::approvals::expire(app);
}

#[cfg(test)]
mod tests {
    use super::web_address;

    #[test]
    fn an_agent_tab_goes_to_the_web_and_nowhere_else() {
        assert!(web_address("https://example.com/").is_ok());
        assert!(web_address(" http://127.0.0.1:9/x ").is_ok());
        assert!(web_address("file:///C:/Windows/win.ini").is_err());
        assert!(web_address("tauri://localhost").is_err());
        assert!(web_address("javascript:alert(1)").is_err());
        assert!(web_address("not an address").is_err());
    }
}
