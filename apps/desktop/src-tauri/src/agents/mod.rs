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
//! | `limits`, `stop` | how fast, and the stop |
//! | `log` | every call, written down |
//! | `tabs`, `quiet` | the agent's own tabs nobody sees, and everything they may not do |
//! | `cdp`, `page`, `snapshot`, `keys` | the `DevTools` Protocol, and every act through it |
//! | `browser`, `reader` | the browser verbs, on the agent's tabs and the reader's |
//! | `capture` | a page read for the window's `capture_to_note` |
//! | `memory`, `leases` | the engine's memory, and sync v2's seam |
//! | `shell`, `watch` | what the app around the window does for agents - the tray, the stop key, the notifications, the window kept - and the pictures of their tabs |
//!
//! **Nothing at launch.** Not a thread, not a file read, not a webview: the state below
//! is made on the first request that names an agent verb or carries an agent's token,
//! and an installation nobody pairs an agent with never makes it (11).
//!
//! **Two engines drive a page, and the verbs are the same on both.** `WebView2` and nib's
//! own Chromium both speak the `DevTools` Protocol, and `engines` hands every verb the
//! page on whichever it is; the system's engines on a Mac and on Linux answer
//! `unsupported_on_this_engine` from the same verbs (section 12, and `engines` for why).
//! The parts that are only reading and deciding - the policy, the snapshot's shape, the
//! keys - are built and tested everywhere.

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs reads a grant's spaces"
    )
)]
pub mod grants;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "most answers are given by an engine with agent tabs"
    )
)]
pub mod verbs;

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs asks about a tab")
)]
mod approvals;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs reads a page to capture"
    )
)]
mod capture;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs presses keys into a page"
    )
)]
mod keys;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs opens agent tabs")
)]
pub(crate) mod leases;
mod limits;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs types into a page")
)]
mod log;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a page to judge"
    )
)]
mod policy;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a tree to write"
    )
)]
mod snapshot;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a call to stop"
    )
)]
mod stop;

#[cfg(any(windows, feature = "cef"))]
pub mod engines;
pub mod shell;
pub mod watch;

#[cfg(any(windows, feature = "cef"))]
mod browser;
// The one door to the DevTools Protocol on a page of either engine; web state uses it
// too on `WebView2` (see web_state/cdp.rs).
#[cfg(any(windows, feature = "cef"))]
pub(crate) mod cdp;
#[cfg(any(windows, feature = "cef"))]
mod memory;
#[cfg(any(windows, feature = "cef"))]
mod page;
#[cfg(any(windows, feature = "cef"))]
mod quiet;
#[cfg(any(windows, feature = "cef"))]
mod reader;
#[cfg(any(windows, feature = "cef"))]
mod tabs;
#[cfg(any(windows, feature = "cef"))]
mod twin;

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
/// nobody. A token the app lent one of the sidebar's own sessions is that provider's
/// agent in that session's mode.
pub fn caller_for(app: &AppHandle, token: &str) -> Option<Caller> {
    state(app)
        .grants
        .by_token(app, token)
        .or_else(|| crate::ai_agent::lent(app, token))
        .map(|grant| Caller::Agent(Box::new(grant)))
}

/// Answers one verb of the crate's own, and writes it in the log.
pub fn answer(app: &AppHandle, caller: &Caller, verb: Verb, args: Value) -> Answer {
    shell::start(app);
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
    // Every call but the goodbye, which would otherwise count as the agent still being
    // here the moment after it left.
    if let Caller::Agent(grant) = caller {
        if verb != "agent_bye" {
            shell::heard(app, &grant.id);
        }
    }
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
    #[cfg(any(windows, feature = "cef"))]
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
            #[cfg(any(windows, feature = "cef"))]
            tabs::bye(caller.id());
            shell::bye(app, caller.id());
            Answer::ok(verbs::Nothing {})
        }
        browsing => {
            if stop::stopped_for(caller.id()) {
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
#[cfg(any(windows, feature = "cef"))]
fn browse(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    browser::answer(app, caller, verb, since)
}

/// The system's engine on a Mac and on Linux: measured, not built (section 12). Its
/// pages can be kept out of sight and alive, but every way a page reaches the reader -
/// a file panel, a camera prompt, a window - is the engine's own delegate there, which
/// nib does not hold for an agent's page yet; so no verb pretends.
#[cfg(not(any(windows, feature = "cef")))]
fn browse(_app: &AppHandle, _caller: &Caller, verb: Verb, _since: u64) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!(
            "{} is not available on {}: an agent's browser runs on Windows and on nib's own Chromium",
            verb.name(),
            if cfg!(target_os = "macos") {
                "WKWebView"
            } else {
                "WebKitGTK"
            }
        ),
    )
}

/// Counts a navigation against the agent's limit, waiting for room.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs navigates an agent's page"
    )
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
    #[cfg(any(windows, feature = "cef"))]
    let tabs = tabs::of(&grant.id).iter().map(tabs::Tab::listed).collect();
    #[cfg(not(any(windows, feature = "cef")))]
    let tabs = Vec::new();
    Answer::ok(verbs::Status {
        stopped: stop::stopped_for(&grant.id),
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
    if stop::stopped_for(caller.id()) {
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
/// every agent's tabs closed. Answers whether they were. With an agent named, that one
/// agent stopped and nobody else, which closes nothing.
#[tauri::command]
pub fn agents_stop(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<bool, String> {
    from_the_app(&webview)?;
    Ok(match agent {
        Some(agent) => {
            stop::halt(&app, &agent);
            false
        }
        None => stop::stop(&app),
    })
}

/// The stop lifted: everybody's when no agent is named, or one agent's own.
#[tauri::command]
pub fn agents_resume(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    from_the_app(&webview)?;
    stop::resume(&app, agent.as_deref());
    Ok(())
}

/// The reader's answer to a question: Allow or Don't allow, and "Always on this site".
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
/// questions waiting and who is stopped. The events keep it current after.
#[tauri::command(async)]
pub fn agents_state(webview: tauri::Webview, app: AppHandle) -> Result<Overview, String> {
    from_the_app(&webview)?;
    let agents = state(&app).grants.all(&app)?;
    #[cfg(any(windows, feature = "cef"))]
    let tabs = agents
        .iter()
        .flat_map(|grant| {
            tabs::of(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab.listed()))
                .collect::<Vec<_>>()
        })
        .collect();
    #[cfg(not(any(windows, feature = "cef")))]
    let tabs = Vec::new();
    Ok(Overview {
        agents,
        tabs,
        approvals: approvals::pending(None),
        stopped: stop::stopped(),
        halted: stop::halted(),
        connected: shell::connected(),
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
    /// The agents stopped one at a time.
    pub halted: Vec<String>,
    /// The agents connected now.
    pub connected: Vec<String>,
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

/// The days the audit log has, newest first, for Settings > Agents' sessions.
#[tauri::command(async)]
pub fn agents_log_days(webview: tauri::Webview, app: AppHandle) -> Result<Vec<String>, String> {
    from_the_app(&webview)?;
    Ok(log::days(&app))
}

/// The reader's Clear in Settings > Agents: one agent's calls out of the audit log, or
/// every call when no agent is named.
#[tauri::command(async)]
pub fn agents_log_clear(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    from_the_app(&webview)?;
    log::clear(&app, agent.as_deref())
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
    #[cfg(any(windows, feature = "cef"))]
    return tabs::adopt(&app, &agent_tab, &tab);
    #[cfg(not(any(windows, feature = "cef")))]
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
