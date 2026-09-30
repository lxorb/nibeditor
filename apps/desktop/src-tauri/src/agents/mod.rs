//! Agents: programs that drive nib on the reader's behalf, through the local endpoint.
//! The design is docs/agent-native.md; this is its crate half.
//!
//! One responsibility a file:
//!
//! | file | what it owns |
//! | --- | --- |
//! | `verbs` | every verb's name, arguments and answer, and the events: the contract |
//! | `grants` | who may drive nib and how far, and their tokens |
//! | `policy` | what an agent may do, and what it asks first, read from the page |
//! | `approvals` | the questions, and the reader's answers |
//! | `limits`, `stop` | how fast, and the stop and every pause |
//! | `log` | every call, written down |
//! | `tabs`, `quiet` | the agent's own tabs nobody sees, and everything they may not do |
//! | `cdp`, `page`, `snapshot`, `keys` | the `DevTools` Protocol, and every act through it |
//! | `browser`, `reader` | the browser verbs, on the agent's tabs and the reader's |
//! | `capture` | a page read for the window's `capture_to_note` |
//! | `memory`, `leases` | the engine's memory, and sync v2's seam |
//!
//! **Nothing at launch.** Not a thread, not a file read, not a webview: the state below
//! is made on the first request that names an agent verb or carries an agent's token,
//! and an installation nobody pairs an agent with never makes it (11).
//!
//! **One engine for now.** Everything that drives a page is `WebView2`'s; every other
//! engine answers `unsupported_on_this_engine` from the same verbs (section 12), and the
//! parts that are only reading and deciding - the policy, the snapshot's shape, the keys
//! - are built and tested everywhere.

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2's verbs read a grant's spaces")
)]
pub mod grants;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "most answers are WebView2's to give")
)]
pub mod verbs;

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2's verbs ask about a tab")
)]
mod approvals;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 reads a page to capture")
)]
mod capture;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 presses keys into a page")
)]
mod keys;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 opens agent tabs")
)]
mod leases;
mod limits;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 types into a page")
)]
mod log;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 has a page to judge")
)]
mod policy;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 has a tree to write")
)]
mod snapshot;
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 has a tab to pause on")
)]
mod stop;

#[cfg(all(windows, not(feature = "cef")))]
mod browser;
// The one door to the DevTools Protocol on a `WebView2` page; web state uses it too
// (see web_state/cdp.rs).
#[cfg(all(windows, not(feature = "cef")))]
pub(crate) mod cdp;
#[cfg(all(windows, not(feature = "cef")))]
mod memory;
#[cfg(all(windows, not(feature = "cef")))]
mod page;
#[cfg(all(windows, not(feature = "cef")))]
mod quiet;
#[cfg(all(windows, not(feature = "cef")))]
mod reader;
#[cfg(all(windows, not(feature = "cef")))]
mod tabs;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use grants::{Grant, Grants, Scope};
use verbs::{Answer, Approval, ApprovalAnswer, ApprovalState, Category, Code, Paired, Verb};

/// Everything the crate keeps about agents, made on the first agent request.
#[derive(Default)]
pub struct Agents {
    /// Who may drive nib.
    pub grants: Grants,
}

/// The one `Agents`, made the first time anything asks.
pub(crate) static AGENTS: OnceLock<Agents> = OnceLock::new();

/// The agents' state, made now if nothing has asked before.
pub fn state(_app: &AppHandle) -> &'static Agents {
    AGENTS.get_or_init(Agents::default)
}

/// Who is calling.
#[derive(Clone, Debug)]
pub enum Caller {
    /// The installation's secret: the reader's own command line, with everything. Its
    /// tabs are filed under `cli`.
    Reader,
    /// An agent, by its grant.
    Agent(Box<Grant>),
}

impl Caller {
    /// The id its tabs, questions and log lines are filed under.
    pub fn id(&self) -> &str {
        match self {
            Caller::Reader => "cli",
            Caller::Agent(grant) => &grant.id,
        }
    }

    /// Whether it may reach a scope. The reader's own command line reaches every one.
    pub fn holds(&self, scope: Scope) -> bool {
        match self {
            Caller::Reader => true,
            Caller::Agent(grant) => grant.holds(scope),
        }
    }

    /// What the window is told about the caller alongside a verb it answers, so its
    /// dispatcher can check scopes and spaces itself. `None` for the reader.
    pub fn told(&self) -> Option<Value> {
        match self {
            Caller::Reader => None,
            Caller::Agent(grant) => serde_json::to_value(grant).ok(),
        }
    }

    fn limits(&self) -> grants::Limits {
        match self {
            Caller::Reader => grants::Limits::default(),
            Caller::Agent(grant) => grant.limits,
        }
    }
}

/// Who a bearer token belongs to, other than the installation's secret: an agent, or
/// nobody.
pub fn caller_for(app: &AppHandle, token: &str) -> Option<Caller> {
    state(app)
        .grants
        .by_token(app, token)
        .map(|grant| Caller::Agent(Box::new(grant)))
}

/// Answers one verb of the crate's own, and writes it in the log.
pub fn answer(app: &AppHandle, caller: &Caller, verb: Verb, args: Value) -> Answer {
    let started = Instant::now();
    let name = verb.name();
    let tab = args.get("tab").and_then(Value::as_str).map(str::to_string);
    let answered = run(app, caller, verb);
    logged(app, caller, name, tab.as_deref(), args, &answered, started);
    answered
}

/// Writes a call in the log: the crate's own verbs from `answer`, the window's from the
/// endpoint.
pub fn logged(
    app: &AppHandle,
    caller: &Caller,
    verb: &str,
    tab: Option<&str>,
    args: Value,
    answered: &Answer,
    started: Instant,
) {
    let code = match answered {
        Answer::Error { code, .. } => serde_json::to_value(code).ok(),
        _ => None,
    };
    log::write(
        app,
        log::Line {
            at: crate::clock::now(),
            agent: caller.id(),
            verb,
            tab,
            args,
            status: answered.status(),
            code,
            ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        },
    );
}

/// One verb, answered.
fn run(app: &AppHandle, caller: &Caller, verb: Verb) -> Answer {
    #[cfg(all(windows, not(feature = "cef")))]
    tabs::back(caller.id());
    match verb {
        Verb::Status(_) => status(app, caller),
        Verb::ApprovalStatus(asked) => {
            let found = match caller {
                Caller::Reader => approvals::any(&asked.id),
                Caller::Agent(grant) => approvals::status(&grant.id, &asked.id),
            };
            match found {
                Some(approval) => Answer::ok(ApprovalState { approval }),
                None => Answer::error(Code::BadArguments, "there is no such question"),
            }
        }
        Verb::Pair(pair) => pair_client(app, caller, &pair),
        Verb::Bye(_) => {
            #[cfg(all(windows, not(feature = "cef")))]
            tabs::bye(caller.id());
            Answer::ok(verbs::Nothing {})
        }
        browsing => {
            if stop::stopped() {
                return Answer::error(
                    Code::Stopped,
                    "the reader pressed the stop: nothing runs until they resume",
                );
            }
            let since = stop::generation();
            match limits::wait_for_room(
                caller.id(),
                limits::Counted::Calls,
                caller.limits().calls,
                || stop::cancelled(since),
            ) {
                Err(()) => return Answer::error(Code::Stopped, "the reader pressed the stop"),
                Ok(true) => said_waiting(app, caller, "calls"),
                Ok(false) => {}
            }
            browse(app, caller, browsing, since)
        }
    }
}

/// The browser's verbs, where the engine can answer them.
#[cfg(all(windows, not(feature = "cef")))]
fn browse(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    browser::answer(app, caller, verb, since)
}

/// Every other engine: no honest way yet (section 12).
#[cfg(not(all(windows, not(feature = "cef"))))]
fn browse(_app: &AppHandle, _caller: &Caller, verb: Verb, _since: u64) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!("{} is not available on this engine yet", verb.name()),
    )
}

/// Counts a navigation against the agent's limit, waiting for room.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 navigates an agent's page")
)]
fn count_navigation(caller: &Caller, since: u64) -> Result<(), Answer> {
    match limits::wait_for_room(
        caller.id(),
        limits::Counted::Navigations,
        caller.limits().navigations,
        || stop::cancelled(since),
    ) {
        Err(()) => Err(Answer::error(Code::Stopped, "the reader pressed the stop")),
        Ok(_) => Ok(()),
    }
}

/// One line in the log for a burst of calls that had to wait.
fn said_waiting(app: &AppHandle, caller: &Caller, what: &str) {
    logged(
        app,
        caller,
        "limit",
        None,
        serde_json::json!({ "waiting": what }),
        &Answer::ok(verbs::Nothing {}),
        Instant::now(),
    );
}

/// `agent_status`.
fn status(app: &AppHandle, caller: &Caller) -> Answer {
    let Caller::Agent(grant) = caller else {
        return Answer::error(
            Code::BadArguments,
            "agent_status is an agent's question: the command line has no grant",
        );
    };
    let grant = state(app)
        .grants
        .by_id(app, &grant.id)
        .unwrap_or_else(|| grant.as_ref().clone());
    #[cfg(all(windows, not(feature = "cef")))]
    let tabs = tabs::of(&grant.id).iter().map(tabs::Tab::listed).collect();
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let tabs = Vec::new();
    Answer::ok(verbs::Status {
        paused: stop::stopped().then_some(verbs::PausedBy::Stop),
        paused_tabs: stop::paused_tabs(&grant.id),
        tabs,
        approvals: approvals::pending(Some(&grant.id)),
        grant,
    })
}

/// The longest a pairing waits for the reader inside one call.
const LONGEST_PAIRING_WAIT: Duration = Duration::from_secs(300);

/// `agent_pair`: a client asking to become an agent (9.1). The reader is asked once; an
/// allowed pairing answers the token to the call that comes after it, or to the call
/// still waiting.
fn pair_client(app: &AppHandle, caller: &Caller, pair: &verbs::Pair) -> Answer {
    if !matches!(caller, Caller::Reader) {
        return Answer::error(
            Code::NotGranted,
            "only a client holding the installation's secret pairs: an agent is paired already",
        );
    }
    let client: String = pair.client.split_whitespace().collect::<Vec<_>>().join(" ");
    if client.is_empty() || client.chars().count() > 60 {
        return Answer::error(Code::BadArguments, "a client's name is 1 to 60 characters");
    }
    let key = approvals::key("agent_pair", None, Some(&client));
    let wait = Duration::from_millis(pair.wait_ms.unwrap_or(0)).min(LONGEST_PAIRING_WAIT);
    let started = Instant::now();
    loop {
        if approvals::allowed(PAIRING, &key) {
            return match state(app).grants.mint(app, &client, Grant::own) {
                Ok((grant, token)) => Answer::ok(Paired {
                    agent: grant.id,
                    token,
                }),
                Err(why) => Answer::error(Code::Failed, why),
            };
        }
        let asked = approvals::ask(
            app,
            approvals::Asking {
                agent: PAIRING,
                name: &client,
                category: Category::Pairing,
                summary: client.clone(),
                site: None,
                tab: None,
                key: key.clone(),
            },
        );
        if !matches!(asked, Answer::NeedsApproval { .. }) || started.elapsed() >= wait {
            return asked;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// What a pairing's question is filed under: nobody's yet.
const PAIRING: &str = "";

/// Whether an agent may send a window verb at all, and what it needs to: the crate's
/// half of the check, before the window's own. A verb of the command line's that is
/// not an agent's (`files.write`, `eval`) is never handed on for an agent.
pub fn may_ask_the_window(caller: &Caller, verb: &str) -> Result<(), String> {
    let Caller::Agent(_) = caller else {
        return Ok(());
    };
    if stop::stopped() {
        return Err("the reader pressed the stop: nothing runs until they resume".into());
    }
    let Some((_, needs)) = verbs::window::AGENT_VERBS
        .iter()
        .find(|(name, _)| *name == verb)
    else {
        return Err(format!("{verb} is not a verb an agent may call"));
    };
    match needs {
        Some(scope) if !caller.holds(*scope) => Err(format!(
            "{verb} needs {}, which this agent was not granted",
            serde_json::to_value(scope)
                .ok()
                .and_then(|one| one.as_str().map(str::to_string))
                .unwrap_or_default()
        )),
        _ => Ok(()),
    }
}

/// Whether a command came from the app's own page: a document window's, never a web
/// page's, whatever the capabilities say. The same rule the terminal holds itself to; an
/// agent's page answering its own questions is the thing this is here to make impossible.
pub(crate) fn from_the_app(webview: &tauri::Webview) -> Result<(), String> {
    if crate::launch::is_document_window(webview.label()) {
        Ok(())
    } else {
        Err("only nib's own window may ask that".into())
    }
}

/// The stop: every call in flight cancelled, every agent paused, and on a second press
/// every agent's tabs closed. Answers whether they were.
#[tauri::command]
pub fn agents_stop(webview: tauri::Webview, app: AppHandle) -> Result<bool, String> {
    from_the_app(&webview)?;
    Ok(stop::stop(&app))
}

/// A pause given back by the reader: the stop's, when neither is named; one agent's on
/// one tab; or all of one agent's.
#[tauri::command]
pub fn agents_resume(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
    tab: Option<String>,
) -> Result<(), String> {
    from_the_app(&webview)?;
    stop::resume(&app, agent.as_deref(), tab.as_deref());
    Ok(())
}

/// What every probe build's identifier starts with (`scripts/probe_app.py`).
const PROBE_IDENTIFIER: &str = "ch.emilvinu.nib.probe.";

/// Whether a build answers test hooks: a debug build, or a probe's, which is built under
/// an identifier of its own. The identifier is compiled into the build, so the app that
/// ships, `ch.emilvinu.nib` from a release build, never answers one.
fn test_hooks(identifier: &str, debug: bool) -> bool {
    debug || identifier.starts_with(PROBE_IDENTIFIER)
}

/// A test hook, in debug and probe builds only: the reader taking the keyboard of one of
/// their tabs, as the engine's `GotFocus` says it, without a press on this machine. It
/// lets the harness prove the reader wins (7.3) with nobody's mouse or keyboard moved.
#[tauri::command]
pub fn agents_test_reader_focus(
    webview: tauri::Webview,
    app: AppHandle,
    tab: String,
) -> Result<(), String> {
    from_the_app(&webview)?;
    if !test_hooks(&app.config().identifier, cfg!(debug_assertions)) {
        return Err("test hooks are only in debug and probe builds".into());
    }
    #[cfg(all(windows, not(feature = "cef")))]
    return reader::focus_for_test(&app, &tab);
    #[cfg(not(all(windows, not(feature = "cef"))))]
    {
        let _ = (app, tab);
        Err("the reader's tabs are not available on this engine yet".into())
    }
}

/// The reader's answer to a question: Allow or Don't allow, and "Always on this site".
/// A takeover answered is the reader handing the tab back.
#[tauri::command(async)]
pub fn agents_answer(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    allow: bool,
    always: bool,
) -> Result<Approval, String> {
    from_the_app(&webview)?;
    let approval = approvals::answer(&app, &id, allow)?;
    if always && approval.answer == ApprovalAnswer::Allowed {
        if let Some(site) = approval.site.clone() {
            let category = approval.category;
            let _ = state(&app).grants.change(&app, &approval.agent, |grant| {
                let kept = grant.always.entry(site).or_default();
                if !kept.contains(&category) {
                    kept.push(category);
                }
            });
        }
    }
    if approval.category == Category::Takeover && approval.answer != ApprovalAnswer::Pending {
        if let Some(tab) = &approval.tab {
            stop::resume(&app, Some(&approval.agent), Some(tab));
        }
    }
    Ok(approval)
}

/// A question the window raises for one of its own verbs on an agent's behalf (writing
/// a setting, publishing): `ok` when the reader already allowed this very call, which
/// spends the allowance, and `needs_approval` otherwise.
#[tauri::command(async)]
pub fn agents_ask(
    webview: tauri::Webview,
    app: AppHandle,
    agent: String,
    category: Category,
    summary: String,
    key: String,
) -> Answer {
    if let Err(why) = from_the_app(&webview) {
        return Answer::error(Code::NotGranted, why);
    }
    if approvals::allowed(&agent, &key) {
        return Answer::ok(verbs::Nothing {});
    }
    let Some(grant) = state(&app).grants.by_id(&app, &agent) else {
        return Answer::error(Code::NotGranted, "there is no such agent");
    };
    if !grant.asks(category) {
        return Answer::ok(verbs::Nothing {});
    }
    approvals::ask(
        &app,
        approvals::Asking {
            agent: &grant.id,
            name: &grant.name,
            category,
            summary,
            site: None,
            tab: None,
            key,
        },
    )
}

/// Everything the activity panel draws from, at once: the agents, their tabs, the
/// questions waiting and what is paused. The events keep it current after.
#[tauri::command(async)]
pub fn agents_state(webview: tauri::Webview, app: AppHandle) -> Result<Overview, String> {
    from_the_app(&webview)?;
    let agents = state(&app).grants.all(&app)?;
    #[cfg(all(windows, not(feature = "cef")))]
    let tabs = agents
        .iter()
        .flat_map(|grant| {
            tabs::of(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab.listed()))
                .collect::<Vec<_>>()
        })
        .collect();
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let tabs = Vec::new();
    let paused = agents
        .iter()
        .flat_map(|grant| {
            stop::paused_tabs(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab))
                .collect::<Vec<_>>()
        })
        .collect();
    Ok(Overview {
        agents,
        tabs,
        approvals: approvals::pending(None),
        stopped: stop::stopped(),
        paused,
    })
}

/// What `agents_state` answers.
#[derive(Serialize)]
pub struct Overview {
    /// Every agent.
    pub agents: Vec<Grant>,
    /// Every agent tab, with its agent.
    pub tabs: Vec<(String, verbs::AgentTab)>,
    /// Every question waiting.
    pub approvals: Vec<Approval>,
    /// Whether the stop is pressed.
    pub stopped: bool,
    /// Every pause on one tab: the agent and the tab.
    pub paused: Vec<(String, String)>,
}

/// One day of the audit log, oldest first, for the activity panel and Add to note.
#[tauri::command(async)]
pub fn agents_log(
    webview: tauri::Webview,
    app: AppHandle,
    day: String,
) -> Result<Vec<Value>, String> {
    from_the_app(&webview)?;
    Ok(log::read_day(&app, &day))
}

/// An agent's tab made a tab of the reader's, without loading it again (6.7): the
/// window has made the reader's tab `tab` for it, and places the page as it places any.
#[tauri::command(async)]
pub fn agents_adopt(
    webview: tauri::Webview,
    app: AppHandle,
    agent_tab: String,
    tab: String,
) -> Result<(), String> {
    from_the_app(&webview)?;
    #[cfg(all(windows, not(feature = "cef")))]
    return tabs::adopt(&app, &agent_tab, &tab);
    #[cfg(not(all(windows, not(feature = "cef"))))]
    {
        let _ = (app, agent_tab, tab);
        Err("agent tabs are not available on this engine yet".into())
    }
}

/// A page read for the window's `capture_to_note` (5.4), on the agent's behalf: `agent`
/// is the grant the window's dispatcher was handed with the call, and none for the
/// reader's own command line. `page` is the reader's paper, for a PDF. See `capture`.
#[tauri::command(async)]
pub fn agents_capture(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
    tab: String,
    shape: verbs::CaptureAs,
    full_page: Option<bool>,
    page: Option<crate::pdf::PdfPage>,
) -> Answer {
    if let Err(why) = from_the_app(&webview) {
        return Answer::error(Code::NotGranted, why);
    }
    let caller = match agent {
        None => Caller::Reader,
        Some(id) => match state(&app).grants.by_id(&app, &id) {
            Some(grant) => Caller::Agent(Box::new(grant)),
            None => return Answer::error(Code::NotGranted, "there is no such agent"),
        },
    };
    capture::answer(
        &app,
        &caller,
        &tab,
        capture::Asked {
            shape,
            full_page: full_page.unwrap_or(false),
            paper: page,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_reaches_only_its_own_window_verbs() {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes.retain(|one| *one != Scope::NotesWrite);
        let agent = Caller::Agent(Box::new(grant));

        assert!(may_ask_the_window(&agent, "read_note").is_ok());
        assert!(may_ask_the_window(&agent, "edit_note").is_err());
        assert!(may_ask_the_window(&agent, "files.write").is_err());
        assert!(may_ask_the_window(&agent, "eval").is_err());
        assert!(may_ask_the_window(&agent, "list_spaces").is_ok());

        // The reader's own command line is not an agent.
        assert!(may_ask_the_window(&Caller::Reader, "files.write").is_ok());
    }

    #[test]
    fn test_hooks_answer_in_debug_and_probe_builds_and_never_in_the_one_that_ships() {
        assert!(test_hooks("ch.emilvinu.nib.probe.nightly", false));
        assert!(test_hooks("ch.emilvinu.nib", true));
        assert!(!test_hooks("ch.emilvinu.nib", false));
        assert!(!test_hooks("ch.emilvinu.nib.probe", false));
        assert!(!test_hooks("ch.emilvinu.nibprobe.x", false));
    }

    #[test]
    fn the_command_line_is_filed_as_cli_with_every_scope() {
        assert_eq!(Caller::Reader.id(), "cli");
        assert!(Caller::Reader.holds(Scope::Terminal));
        assert!(Caller::Reader.told().is_none());
        let agent = Caller::Agent(Box::new(Grant::own("claude-code".into(), "Claude Code")));
        assert_eq!(agent.id(), "claude-code");
        assert!(!agent.holds(Scope::Terminal));
        assert_eq!(agent.told().expect("told")["id"], "claude-code");
    }
}
