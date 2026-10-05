//! The browser verbs, answered on `WebView2` and nib's own Chromium alike - both speak the
//! `DevTools` Protocol, and `engines` hands every verb the page whichever it is
//! (docs/agent-native.md 5.2 and 12): which tab, whether
//! this agent may act there, what the page says it would be doing, and then the act.
//!
//! Every verb on a tab goes through the same gate, in this order: the tab is this agent's
//! own or a reader's tab it may reach (`browser.reader`, its spaces); the page is not
//! holding a dialog; the site is not denied. Nothing the reader does in a tab takes it
//! from the agent (7.3), and the stop is asked before any verb (`super::answer`). A press
//! or a write is then judged from the page (`policy`) and asks first when it has to,
//! answering `needs_approval` at once.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::PoisonError;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter as _};

use super::approvals::{self, Asking};
use super::engines::{self, ReaderStore, View};
use super::grants::{Grant, Scope, SiteRule};
use super::keys;
use super::page::{Element, Page};
use super::policy::{self, Act, Facts};
use super::snapshot::{self, Asked, Wanted};
use super::tabs::{self, Tab};
use super::verbs::{
    Acted, Answer, Category, Closed, Code, ConsoleLines, DownloadList, Evaluated, Event, Found,
    Opened, PageText, Requests, Snapped, StorageOp, Store, Stored, TabList, Verb, Waited, World,
    EVENT,
};
use super::Caller;

/// The longest `browser_wait` when none is asked for, and the longest ever.
const WAIT: Duration = Duration::from_secs(30);
const LONGEST_WAIT: Duration = Duration::from_secs(120);

/// How many response bodies one `browser_network` reads, and how long each may be.
const BODIES: usize = 20;
const LONGEST_BODY: usize = 100_000;

/// Where a verb acts.
pub(super) enum Place {
    /// One of this agent's own tabs.
    Own(Tab),
    /// A tab of the reader's, by its id.
    Reader(String),
}

impl Place {
    fn store(&self) -> Store {
        match self {
            Place::Own(tab) => tab.store,
            Place::Reader(_) => Store::Reader,
        }
    }

    fn id(&self) -> &str {
        match self {
            Place::Own(tab) => &tab.id,
            Place::Reader(id) => id,
        }
    }
}

/// A verb's answer, and the tab it was about, for the log.
pub fn answer(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    if !caller.holds(Scope::Browser) && !caller.holds(Scope::BrowserReader) {
        return Answer::error(Code::NotGranted, "this agent was not granted the browser");
    }
    match verb {
        Verb::Tabs(_) => tabs_of(app, caller),
        Verb::Open(open) => open_tab(app, caller, &open),
        Verb::Downloads(asked) => Answer::ok(DownloadList {
            downloads: super::quiet::downloads_of(caller.id(), asked.tab.as_deref()),
        }),
        Verb::Close(on) => match tabs::find(caller.id(), &on.tab) {
            Some(_) => {
                tabs::close(app, &on.tab);
                Answer::ok(Closed { tab: on.tab })
            }
            None => Answer::error(
                Code::NoSuchTab,
                format!(
                    "{} is not one of this agent's tabs: the reader's tabs are theirs to close",
                    on.tab
                ),
            ),
        },
        verb => on_a_tab(app, caller, verb, since),
    }
}

/// `browser_tabs`.
fn tabs_of(app: &AppHandle, caller: &Caller) -> Answer {
    let reader = match caller {
        Caller::Reader => {
            super::reader::tabs(app, &super::grants::Spaces::All(super::grants::Every::All))
        }
        Caller::Agent(grant) if grant.holds(Scope::BrowserReader) => {
            super::reader::tabs(app, &grant.spaces)
        }
        Caller::Agent(_) => Vec::new(),
    };
    let agent = tabs::of(caller.id()).iter().map(Tab::listed).collect();
    Answer::ok(TabList { reader, agent })
}

/// `browser_open`.
fn open_tab(app: &AppHandle, caller: &Caller, open: &super::verbs::Open) -> Answer {
    if !caller.holds(Scope::Browser) {
        return Answer::error(
            Code::NotGranted,
            "this agent was not granted tabs of its own",
        );
    }
    let host = policy::host_of(&open.url).unwrap_or_default();
    let mut store = open.store;
    if let Caller::Agent(grant) = caller {
        if policy::rule_for(grant, &host) == Some(SiteRule::AgentStore) {
            store = Store::Agent;
        }
        if let Err(why) = policy::site_allowed(grant, &open.url, store) {
            return Answer::error(Code::SiteDenied, why);
        }
        if let Some(space) = &open.space {
            if !grant.spaces.reach(space) {
                return Answer::error(
                    Code::NotGranted,
                    format!("{space} is not a space this agent may reach"),
                );
            }
        }
    }
    if store == Store::Space && open.space.is_none() {
        return Answer::error(Code::BadArguments, "store \"space\" needs the space");
    }
    // Never the reader's own store, whose pages run the reader's extensions: its twin,
    // or the agent's own (see `engines`).
    if store != Store::Agent && engines::reader_store() == ReaderStore::Blocked {
        store = Store::Agent;
    }
    let store_name = match store {
        Store::Agent => Some(format!("agent_{}", caller.id())),
        Store::Reader | Store::Space => {
            let reader = store_for(app, open.space.as_deref(), &open.url);
            // The lease is the reader's store's: the twin carries its logins.
            if let Err(why) =
                super::leases::lease_needed(reader.as_deref(), &policy::site_of(&host))
            {
                return Answer::error(Code::InUseElsewhere, why);
            }
            Some(engines::twin_of(reader.as_deref()))
        }
    };
    let most = match caller {
        Caller::Agent(grant) => usize::try_from(grant.limits.tabs).unwrap_or(4),
        Caller::Reader => 4,
    };
    let size = (
        open.width.unwrap_or(tabs::WIDTH),
        open.height.unwrap_or(tabs::HEIGHT),
    );
    match tabs::open(app, caller.id(), &open.url, store, store_name, size, most) {
        Ok(tab) => Answer::ok(Opened { tab: tab.id, store }),
        Err(refused) => refused,
    }
}

/// Which store the reader's tabs of a space use for an address, as the window decides;
/// the one every space shares when the window does not say.
fn store_for(app: &AppHandle, space: Option<&str>, url: &str) -> Option<String> {
    let asked = super::verbs::window::StoreAsk {
        space: space.map(str::to_string),
        url: url.to_string(),
    };
    crate::endpoint::ask(
        app,
        super::verbs::window::STORE_FOR,
        serde_json::to_value(asked).unwrap_or_default(),
        Duration::from_millis(800),
    )
    .ok()
    .and_then(|value| serde_json::from_value::<super::verbs::window::StoreSaid>(value).ok())
    .and_then(|said| said.store)
    .and_then(|store| {
        crate::web_stores::named(Some(&store))
            .ok()
            .flatten()
            .map(str::to_string)
    })
}

/// The tab a verb names, and whether this agent may act there now.
fn place(app: &AppHandle, caller: &Caller, tab: &str) -> Result<(Place, View), Answer> {
    // An agent's tab the reader was shown is the reader's now, under either id.
    let shown = tabs::shown_as(tab);
    let tab = shown.as_deref().unwrap_or(tab);
    if let Some(own) = tabs::find(caller.id(), tab) {
        let (own, view) = tabs::page(app, caller.id(), &own.id)?;
        return Ok((Place::Own(own), view));
    }
    let not_found = || {
        Answer::error(
            Code::NoSuchTab,
            format!("there is no tab {tab} this agent may reach: browser_tabs lists them"),
        )
    };
    if !caller.holds(Scope::BrowserReader)
        || tabs::owner(&format!("{}{tab}", tabs::LABEL)).is_some()
    {
        return Err(not_found());
    }
    if let Caller::Agent(grant) = caller {
        if !matches!(grant.spaces, super::grants::Spaces::All(_))
            && !super::reader::tabs(app, &grant.spaces)
                .iter()
                .any(|one| one.id == tab)
        {
            return Err(not_found());
        }
    }
    let Some(view) = super::reader::page(app, tab) else {
        return Err(not_found());
    };
    Ok((Place::Reader(tab.to_string()), view))
}

/// The tab a verb acts on, through the gate at the top of this file.
fn gate<'a>(
    app: &AppHandle,
    caller: &Caller,
    verb: &str,
    view: &'a View,
    place: &Place,
    since: u64,
) -> Result<Page<'a>, Answer> {
    let label = view.label();
    let own = matches!(place, Place::Own(_));
    // The tab by the id the window knows it under: an agent's tab the reader was shown is
    // the reader's tab now, whichever of its two ids the agent called it by (6.7), and it
    // is that tab that wears the frame.
    let tab = place.id();
    let _ = app.emit(
        EVENT,
        Event::Acting {
            agent: caller.id().to_string(),
            tab: tab.to_string(),
            verb: verb.to_string(),
        },
    );
    super::cdp::awake(view, &label, own);
    let page = Page {
        view,
        label,
        own,
        since,
    };
    if let Caller::Agent(grant) = caller {
        if let Err(why) = policy::site_allowed(grant, &page.url(), place.store()) {
            return Err(Answer::error(Code::SiteDenied, why));
        }
    }
    Ok(page)
}

/// Every verb that acts on one tab.
fn on_a_tab(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    let name = verb.name();
    let Some(tab) = tab_of(&verb) else {
        return Answer::error(Code::BadArguments, format!("{name} needs a tab"));
    };
    let lets_through = matches!(
        verb,
        Verb::Dialog(_) | Verb::Console(_) | Verb::Network(_) | Verb::Takeover(_) | Verb::Show(_)
    );
    on_tab(
        app,
        caller,
        &tab,
        name,
        since,
        lets_through,
        |place, page| act(app, caller, place, page, verb),
    )
}

/// One act on one tab, `name` as the activity panel shows it, through the gate at the
/// top of this file; a dialog the page is holding stops it unless it `lets_through`, and
/// rides on the answer either way. The window's `agents_capture` comes in here too.
pub(super) fn on_tab(
    app: &AppHandle,
    caller: &Caller,
    tab: &str,
    name: &str,
    since: u64,
    lets_through: bool,
    act: impl FnOnce(&Place, &Page<'_>) -> Answer,
) -> Answer {
    let (place, view) = match place(app, caller, tab) {
        Ok(found) => found,
        Err(refused) => return refused,
    };
    let page = match gate(app, caller, name, &view, &place, since) {
        Ok(page) => page,
        Err(refused) => return refused,
    };
    let held = super::quiet::dialog_of(&page.label);
    if held.is_some() && !lets_through {
        return Answer::error(
            Code::Failed,
            "the page is holding a dialog: answer it with browser_dialog first",
        )
        .with_dialog(held);
    }
    let answered = act(&place, &page);
    answered.with_dialog(super::quiet::dialog_of(&page.label))
}

/// The tab a verb names.
fn tab_of(verb: &Verb) -> Option<String> {
    Some(
        match verb {
            Verb::Navigate(one) => &one.tab,
            Verb::Wait(one) => &one.tab,
            Verb::Snapshot(one) => &one.tab,
            Verb::Find(one) => &one.tab,
            Verb::Read(one) => &one.tab,
            Verb::Click(one) => &one.tab,
            Verb::Type(one) => &one.tab,
            Verb::Press(one) => &one.tab,
            Verb::Scroll(one) => &one.tab,
            Verb::Select(one) => &one.tab,
            Verb::FillForm(one) => &one.tab,
            Verb::Hover(one) => &one.tab,
            Verb::Drag(one) => &one.tab,
            Verb::Upload(one) => &one.tab,
            Verb::Screenshot(one) => &one.tab,
            Verb::Console(one) => &one.tab,
            Verb::Network(one) => &one.tab,
            Verb::Evaluate(one) => &one.tab,
            Verb::Dialog(one) => &one.tab,
            Verb::Storage(one) => &one.tab,
            Verb::Show(one) => &one.tab,
            Verb::Takeover(one) => &one.tab,
            _ => return None,
        }
        .clone(),
    )
}

/// What an act answers: where the page is, and the tabs it opened.
fn acted(page: &Page<'_>) -> Answer {
    let opened = std::mem::take(
        &mut super::cdp::heard(&page.label)
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .opened,
    );
    Answer::ok(Acted {
        url: page.url(),
        opened,
    })
}

/// Whether a press or a write asks first. `Ok` to go ahead; the answer to give when not.
/// Signing in is refused outright, for the command line too, the way typing into a
/// password field is: it is the reader's, through a takeover (9.4).
fn judged(
    app: &AppHandle,
    caller: &Caller,
    page: &Page<'_>,
    place: &Place,
    facts: &Facts,
    act: Act,
    key: &str,
) -> Result<(), Answer> {
    if policy::signs_in(facts, act) {
        return Err(Answer::error(
            Code::PasswordField,
            "that signs in: the reader does, ask with browser_takeover",
        ));
    }
    let Caller::Agent(grant) = caller else {
        return Ok(());
    };
    let hosts = page_hosts(page);
    let Some(question) = policy::judge(grant, facts, act, &page.url(), &hosts) else {
        return Ok(());
    };
    if approvals::allowed(&grant.id, key) {
        return Ok(());
    }
    Err(ask(
        app,
        grant,
        question.category,
        question.summary,
        Some(&page.url()),
        place.id(),
        key,
    ))
}

/// Asks the reader; see `approvals`.
fn ask(
    app: &AppHandle,
    grant: &Grant,
    category: Category,
    summary: String,
    url: Option<&str>,
    tab: &str,
    key: &str,
) -> Answer {
    approvals::ask(
        app,
        Asking {
            agent: &grant.id,
            name: &grant.name,
            category,
            summary,
            site: url
                .and_then(policy::host_of)
                .map(|host| policy::site_of(&host)),
            tab: Some(tab.to_string()),
            key: key.to_string(),
        },
    )
}

/// The hosts a page and its frames have talked to, for the payment processors.
fn page_hosts(page: &Page<'_>) -> Vec<String> {
    let heard = super::cdp::heard(&page.label);
    let held = heard.lock().unwrap_or_else(PoisonError::into_inner);
    let (requests, _) = held.requests(None, None);
    let mut hosts: HashSet<String> = requests
        .iter()
        .filter_map(|one| policy::host_of(&one.url))
        .collect();
    for (_, frame) in held.frames() {
        if let Some(host) = policy::host_of(&frame.url) {
            hosts.insert(host);
        }
    }
    hosts.into_iter().collect()
}

/// A ref resolved, or the answer to give.
fn element(page: &Page<'_>, reference: &str) -> Result<Element, Answer> {
    page.element(reference)
}

/// The verbs that act on one tab.
#[allow(
    clippy::too_many_lines,
    reason = "one arm a verb: the dispatch reads as the table of verbs it is"
)]
fn act(app: &AppHandle, caller: &Caller, place: &Place, page: &Page<'_>, verb: Verb) -> Answer {
    let tab = place.id().to_string();
    let from_page = |result: Answer| match result {
        Answer::Ok { result, dialog, .. } => Answer::Ok {
            result,
            untrusted: Some(page.url()),
            dialog,
        },
        other => other,
    };
    let run = || -> Result<Answer, Answer> {
        Ok(match verb {
            Verb::Navigate(go) => {
                if let Some(url) = &go.url {
                    if let Caller::Agent(grant) = caller {
                        policy::site_allowed(grant, url, place.store())
                            .map_err(|why| Answer::error(Code::SiteDenied, why))?;
                    }
                    super::count_navigation(caller, page.since)?;
                    page.navigate(url)?;
                } else if go.back || go.forward || go.reload {
                    super::count_navigation(caller, page.since)?;
                    page.step(if go.back { -1 } else { i64::from(go.forward) })?;
                } else {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "say url, back, forward or reload",
                    ));
                }
                acted(page)
            }
            Verb::Wait(wait) => {
                let most = wait
                    .timeout_ms
                    .map_or(WAIT, Duration::from_millis)
                    .min(LONGEST_WAIT);
                let ms = page.wait(&wait.until, most)?;
                Answer::ok(Waited {
                    ms,
                    url: page.url(),
                })
            }
            Verb::Snapshot(asked) => {
                let (parts, secret) = page.parts()?;
                let under = match &asked.element {
                    Some(reference) => {
                        let (frame, backend) = snapshot::parse_ref(reference).ok_or_else(|| {
                            Answer::error(Code::NoSuchRef, format!("{reference} is not a ref"))
                        })?;
                        let prefix = frame.map(|one| format!("f{one}")).unwrap_or_default();
                        if !snapshot::holds(&parts, &prefix, backend) {
                            return Err(Answer::error(
                                Code::NoSuchRef,
                                "that element is gone: take a snapshot again",
                            ));
                        }
                        Some((prefix, backend))
                    }
                    None => None,
                };
                let url = page.url();
                let origin = tauri::Url::parse(&url)
                    .map(|one| one.origin().ascii_serialization())
                    .unwrap_or_default();
                let written = snapshot::render(
                    &parts,
                    &Asked {
                        under: under
                            .as_ref()
                            .map(|(prefix, backend)| (prefix.as_str(), *backend)),
                        most: asked.max_chars.unwrap_or(snapshot::MOST).max(200),
                        secret: &secret,
                        origin: &origin,
                    },
                );
                from_page(Answer::ok(Snapped {
                    url,
                    title: page.title(),
                    text: written.text,
                    truncated: written.truncated,
                }))
            }
            Verb::Find(asked) => {
                if asked.text.is_none() && asked.role.is_none() && asked.name.is_none() {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "say text, or a role and a name",
                    ));
                }
                let (text, role, name) = (
                    asked.text.as_deref().map(str::to_lowercase),
                    asked.role.as_deref().map(str::to_lowercase),
                    asked.name.as_deref().map(str::to_lowercase),
                );
                let matches = page.find(&Wanted {
                    text: text.as_deref(),
                    role: role.as_deref(),
                    name: name.as_deref(),
                })?;
                from_page(Answer::ok(Found { matches }))
            }
            Verb::Read(asked) => {
                let (url, title, text) = page.read(app, asked.shape)?;
                let most = asked.max_chars.unwrap_or(100_000);
                let truncated = text.chars().count() > most;
                let text = super::cdp::cut(text, most);
                from_page(Answer::ok(PageText {
                    url,
                    title,
                    text,
                    truncated,
                }))
            }
            Verb::Click(click) => {
                let target = element(page, &click.element)?;
                let facts = page.facts(&target)?;
                let key = approvals::key("browser_click", Some(&tab), Some(&click.element));
                judged(app, caller, page, place, &facts, Act::Press, &key)?;
                let button = match click.button {
                    super::verbs::Button::Left => "left",
                    super::verbs::Button::Right => "right",
                    super::verbs::Button::Middle => "middle",
                };
                page.click(
                    &target,
                    button,
                    click.count.unwrap_or(1).clamp(1, 3),
                    modifiers(&click.modifiers),
                )?;
                acted(page)
            }
            Verb::Type(typing) => {
                let target = element(page, &typing.element)?;
                let mut facts = page.facts(&target)?;
                let key = approvals::key("browser_type", Some(&tab), Some(&typing.element));
                judged(app, caller, page, place, &facts, Act::Write, &key)?;
                if typing.submit {
                    facts.submit = facts.in_form;
                    let key =
                        approvals::key("browser_type_submit", Some(&tab), Some(&typing.element));
                    judged(app, caller, page, place, &facts, Act::Enter, &key)?;
                }
                page.type_text(&target, &typing.text, typing.replace)?;
                if typing.submit {
                    press(
                        page,
                        place,
                        &keys::chord("Enter").map_err(|why| Answer::error(Code::Failed, why))?,
                    )?;
                }
                acted(page)
            }
            Verb::Press(pressing) => {
                let key = keys::chord(&pressing.keys)
                    .map_err(|why| Answer::error(Code::BadArguments, why))?;
                // Enter and Control+Enter are a message box's send as well as a form's
                // submit; Shift+Enter only submits a form of single-line fields.
                if key.sends() || key.submits() {
                    if let Some(mut facts) = page.active_facts()? {
                        facts.submit = facts.in_form && key.submits();
                        let act = if key.sends() { Act::Enter } else { Act::Press };
                        let asked =
                            approvals::key("browser_press", Some(&tab), Some(&pressing.keys));
                        judged(app, caller, page, place, &facts, act, &asked)?;
                    }
                }
                press(page, place, &key)?;
                acted(page)
            }
            Verb::Scroll(scroll) => {
                let target = scroll
                    .element
                    .as_deref()
                    .map(|one| element(page, one))
                    .transpose()?;
                page.scroll(target.as_ref(), scroll.dx, scroll.dy)?;
                acted(page)
            }
            Verb::Select(select) => {
                let target = element(page, &select.element)?;
                let facts = page.facts(&target)?;
                let key = approvals::key("browser_select", Some(&tab), Some(&select.element));
                judged(app, caller, page, place, &facts, Act::Write, &key)?;
                page.select(&target, &select.values)?;
                acted(page)
            }
            Verb::FillForm(form) => {
                let mut targets = Vec::with_capacity(form.fields.len());
                for field in &form.fields {
                    let target = element(page, &field.element)?;
                    let facts = page.facts(&target)?;
                    if facts.password() || facts.sign_in() {
                        return Err(Answer::error(Code::PasswordField, "that form is a sign-in: the reader fills it, ask with browser_takeover"));
                    }
                    targets.push((target, facts));
                }
                if let Some((_, facts)) = targets.first() {
                    let key = approvals::key("browser_fill_form", Some(&tab), None);
                    judged(app, caller, page, place, facts, Act::Write, &key)?;
                }
                for ((target, _), field) in targets.iter().zip(&form.fields) {
                    page.fill(target, &field.value)?;
                }
                acted(page)
            }
            Verb::Hover(hover) => {
                page.hover(&element(page, &hover.element)?)?;
                acted(page)
            }
            Verb::Drag(drag) => {
                let (from, to) = (element(page, &drag.from)?, element(page, &drag.to)?);
                let facts = page.facts(&from)?;
                let key = approvals::key("browser_drag", Some(&tab), Some(&drag.from));
                judged(app, caller, page, place, &facts, Act::Write, &key)?;
                page.drag(&from, &to)?;
                acted(page)
            }
            Verb::Upload(upload) => {
                let target = element(page, &upload.element)?;
                let files = files_of(app, &upload.files)?;
                if let Caller::Agent(grant) = caller {
                    let outside: Vec<&(PathBuf, bool)> =
                        files.iter().filter(|(_, inside)| !inside).collect();
                    let key =
                        approvals::key("browser_upload", Some(&tab), Some(&upload.files.join("|")));
                    if !outside.is_empty()
                        && grant.asks(Category::Files)
                        && !approvals::allowed(&grant.id, &key)
                    {
                        let summary = format!(
                            "Hand {} to {}",
                            outside[0].0.display(),
                            policy::host_of(&page.url()).unwrap_or_default()
                        );
                        return Err(ask(
                            app,
                            grant,
                            Category::Files,
                            summary,
                            Some(&page.url()),
                            &tab,
                            &key,
                        ));
                    }
                    let facts = page.facts(&target)?;
                    judged(app, caller, page, place, &facts, Act::Write, &key)?;
                }
                let paths: Vec<String> = files
                    .iter()
                    .map(|(path, _)| path.to_string_lossy().into_owned())
                    .collect();
                page.upload(&target, &paths)?;
                acted(page)
            }
            Verb::Screenshot(shot) => {
                let target = shot
                    .element
                    .as_deref()
                    .map(|one| element(page, one))
                    .transpose()?;
                let picture = page.screenshot(target.as_ref(), shot.full_page, shot.scale)?;
                from_page(Answer::ok(picture))
            }
            Verb::Console(asked) => {
                super::cdp::listen_to_console(page.view, &page.label);
                let heard = super::cdp::heard(&page.label);
                let (lines, next) = heard
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .console(asked.since, asked.level.as_deref());
                from_page(Answer::ok(ConsoleLines { lines, next }))
            }
            Verb::Network(asked) => {
                if asked.bodies && !caller.holds(Scope::BrowserNetwork) {
                    return Err(Answer::error(
                        Code::NotGranted,
                        "bodies need browser.network",
                    ));
                }
                let heard = super::cdp::heard(&page.label);
                let (mut requests, next) = heard
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .requests(asked.since, asked.matching.as_deref());
                if asked.bodies {
                    for row in requests.iter_mut().rev().take(BODIES) {
                        let found = heard
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .request_id(row.seq);
                        if let Some((session, id)) = found {
                            let session = (!session.is_empty()).then_some(session);
                            if let Ok(body) = super::cdp::call_in(
                                page.view,
                                session.as_deref(),
                                "Network.getResponseBody",
                                &json!({ "requestId": id }),
                                Duration::from_secs(5),
                            ) {
                                row.body = body
                                    .get("body")
                                    .and_then(Value::as_str)
                                    .map(|text| super::cdp::cut(text.to_string(), LONGEST_BODY));
                            }
                        }
                    }
                }
                from_page(Answer::ok(Requests { requests, next }))
            }
            Verb::Evaluate(evaluate) => {
                if let Caller::Agent(grant) = caller {
                    let host = policy::host_of(&page.url()).unwrap_or_default();
                    if !grant.holds(Scope::BrowserScript) || !policy::script_allowed(grant, &host) {
                        return Err(Answer::error(
                            Code::NotGranted,
                            format!(
                                "scripts on {} need browser.script for that site",
                                policy::site_of(&host)
                            ),
                        ));
                    }
                }
                let value = page.evaluate(&evaluate.expression, evaluate.world == World::Page)?;
                from_page(Answer::ok(Evaluated { value }))
            }
            Verb::Dialog(answer) => {
                if super::quiet::dialog_of(&page.label).is_none() {
                    return Err(Answer::error(
                        Code::NoDialog,
                        "the page is holding no dialog",
                    ));
                }
                super::quiet::answer_dialog(app, &page.label, answer.accept, answer.text)
                    .map_err(|why| Answer::error(Code::Failed, why))?;
                std::thread::sleep(Duration::from_millis(50));
                page.settle(page.navigations());
                acted(page)
            }
            Verb::Storage(storage) => {
                let own_store = matches!(place, Place::Own(tab) if tab.store == Store::Agent);
                if !own_store && !caller.holds(Scope::BrowserStorage) {
                    return Err(Answer::error(
                        Code::NotGranted,
                        "the reader's cookies and storage need browser.storage",
                    ));
                }
                match storage.op {
                    StorageOp::Cookies => Answer::ok(Stored {
                        cookies: Some(page.cookies()?),
                        local: None,
                    }),
                    StorageOp::SetCookie => {
                        let cookie = storage.cookie.as_ref().ok_or_else(|| {
                            Answer::error(Code::BadArguments, "set_cookie needs the cookie")
                        })?;
                        page.set_cookie(cookie)?;
                        Answer::ok(Stored::default())
                    }
                    StorageOp::Clear => {
                        page.clear()?;
                        Answer::ok(Stored::default())
                    }
                    StorageOp::Local => from_page(Answer::ok(Stored {
                        cookies: None,
                        local: Some(page.local()?),
                    })),
                }
            }
            Verb::Show(_) => {
                let Place::Own(own) = place else {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "that is already the reader's tab",
                    ));
                };
                let Caller::Agent(grant) = caller else {
                    return Ok(acted(page));
                };
                let asked = approvals::waiting_on(&grant.id, &own.id, Category::Showing);
                if asked
                    .as_ref()
                    .is_some_and(|one| one.answer == super::verbs::ApprovalAnswer::Allowed)
                {
                    return Ok(acted(page));
                }
                let key = approvals::key("browser_show", Some(&own.id), None);
                let title = if own.title.is_empty() {
                    own.url.clone()
                } else {
                    own.title.clone()
                };
                ask(
                    app,
                    grant,
                    Category::Showing,
                    format!("Show {title}"),
                    Some(&own.url),
                    &own.id,
                    &key,
                )
            }
            Verb::Takeover(takeover) => {
                let Caller::Agent(grant) = caller else {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "the command line is the reader already",
                    ));
                };
                let key = approvals::key("browser_takeover", Some(&tab), Some(&takeover.reason));
                // A question and nothing more: the agent keeps the tab, and goes on
                // when the page shows the step done.
                ask(
                    app,
                    grant,
                    Category::Takeover,
                    takeover.reason.clone(),
                    Some(&page.url()),
                    &tab,
                    &key,
                )
            }
            other => Answer::error(
                Code::BadArguments,
                format!("{} is not a verb on a tab", other.name()),
            ),
        })
    };
    run().unwrap_or_else(|refused| refused)
}

/// One key pressed: into an agent's own page through the engine; into a reader's page as
/// the page's own key events, never the engine's (see reader.rs).
fn press(page: &Page<'_>, place: &Place, key: &keys::Key) -> Result<(), Answer> {
    match place {
        Place::Own(_) => page.press(key),
        Place::Reader(_) => page.press_in_page(key),
    }
}

/// The protocol's modifier bits for the keys held.
fn modifiers(held: &[super::verbs::Modifier]) -> u8 {
    use super::verbs::Modifier;
    held.iter().fold(0, |bits, one| {
        bits | match one {
            Modifier::Alt => 1,
            Modifier::Control => 2,
            Modifier::Meta => 4,
            Modifier::Shift => 8,
        }
    })
}

/// The files an agent hands a page: each an absolute path, or one relative to the spaces
/// folder, and whether it is inside a space (9.4). A file that is not there is refused.
fn files_of(app: &AppHandle, asked: &[String]) -> Result<Vec<(PathBuf, bool)>, Answer> {
    if asked.is_empty() {
        return Err(Answer::error(Code::BadArguments, "say which files"));
    }
    let root = crate::paths::spaces_dir(app).ok();
    asked
        .iter()
        .map(|one| {
            let given = PathBuf::from(one);
            let path = if given.is_absolute() {
                given
            } else {
                root.as_ref()
                    .map_or(given.clone(), |root| root.join(&given))
            };
            let path = crate::paths::folded(&path);
            if !path.is_file() {
                return Err(Answer::error(
                    Code::BadArguments,
                    format!("{} is not a file", path.display()),
                ));
            }
            let inside = crate::paths::in_spaces(app, &path.to_string_lossy()).is_ok();
            Ok((path, inside))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::modifiers;
    use crate::agents::verbs::Modifier;

    #[test]
    fn modifiers_are_the_protocols_bits() {
        assert_eq!(modifiers(&[]), 0);
        assert_eq!(modifiers(&[Modifier::Control, Modifier::Shift]), 10);
        assert_eq!(modifiers(&[Modifier::Alt, Modifier::Meta]), 5);
    }
}
