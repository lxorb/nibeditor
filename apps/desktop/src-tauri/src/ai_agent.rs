//! The AI sidebar's agent: nib's own tools, called by the loop the window runs for a
//! Claude or `OpenAI` key, a `ChatGPT` plan or a compatible server (docs/ai-sidebar.md 4.4).
//!
//! **An agent like any other.** Each provider gets a built-in grant, named after it
//! ("nib · Claude"), made the first time its thread asks and kept in Settings > Agents
//! with the same scopes, sites, limits and stop as an outside agent's. A call goes
//! through the endpoint's own dispatch with that grant as the caller
//! (`endpoint::dispatch`), so it meets the same policy and is written to the same log;
//! the answer is written for the model the way `nib mcp` writes it, marks round every
//! word from outside (`mcp::host`). There is no second policy in the window.
//!
//! **The modes are views of the grant, never more than it** (4.4). What each lists:
//! Plan the tools that only read and `create_note` for the plan, Approve and Agent
//! everything the grant reaches. A call to a tool its mode does not list is refused here
//! as well, whatever the model says. And how each is supervised, laid over the grant for
//! the call and never kept (`supervised`): Approve asks before every change and never
//! before a read; Agent asks for nothing but paying, because every change it makes can
//! be kept or undone; Plan as the grant says.
//!
//! The sidebar's Claude Code and Codex call the same tools through `nib mcp`, with a token
//! the app lends each provider and mode for one run (`lend`): the endpoint finds the
//! grant in that mode by it (`lent`), so a session is supervised as its thread's mode is.
//!
//! Every turn also carries where the reader is - the space, the tab in front, every
//! open tab - asked by nib through the same two verbs an outside agent would call
//! (`ai_agent_context`).

use std::collections::BTreeSet;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agents::grants::{fresh_token, hashed, same, Grant, Mode as GrantMode, Scope};
use crate::agents::{state, Caller};
use crate::mcp::host;

/// The sidebar's modes, as the window names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Everything the grant reaches, every change approved first.
    Approve,
    /// Reads, and writes the plan as a note.
    Plan,
    /// Everything the grant reaches, nothing asked.
    Agent,
}

/// Which provider's agent is asking, and whether a new grant reaches the reader's tabs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    /// The provider's id in Settings > AI.
    pub id: String,
    /// The provider's name there.
    pub name: String,
    /// Whether the reader's own tabs are in reach.
    #[serde(default = "yes")]
    pub reader_tabs: bool,
}

fn yes() -> bool {
    true
}

/// The built-in grant's id for a provider: `nib-` and the provider's own id, which the
/// window keeps to the characters a keychain entry takes.
fn grant_id(provider: &str) -> Result<String, String> {
    let fits = !provider.is_empty()
        && provider.len() <= 48
        && provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(format!("nib-{provider}"))
    } else {
        Err(format!("{provider} is not a provider"))
    }
}

/// A new built-in grant: Emil's defaults for the reader's own agents (9.1), with the
/// reader's tabs in reach or not - and the terminal, which the sidebar is asked about as
/// much as the notes ("why did the build fail"). How much it asks is the thread's mode's
/// (`supervised`), not the grant's.
fn made(id: String, client: &str, builtin: &Builtin) -> Grant {
    let mut grant = Grant::own(id, client);
    grant.scopes.push(Scope::Terminal);
    if !builtin.reader_tabs {
        grant.scopes.retain(|one| *one != Scope::BrowserReader);
    }
    grant
}

/// The grant as a call in `mode` meets the policy: Approve asks before every change, and
/// about every category, whatever was switched off; Agent asks for nothing but paying;
/// Plan, which changes nothing but its own note, as the grant is.
fn supervised(mut grant: Grant, mode: Mode) -> Grant {
    match mode {
        Mode::Approve => {
            grant.mode = GrantMode::Confirm;
            grant.asks.clear();
        }
        Mode::Agent => grant.mode = GrantMode::Autonomous,
        Mode::Plan => {}
    }
    grant
}

/// The provider's built-in grant, made the first time it is asked for. Its token is not
/// kept: the window's calls are dispatched inside the app, and the sidebar's Claude Code
/// and Codex are lent a token of their own (`lend`).
pub(crate) fn grant_for(app: &AppHandle, builtin: &Builtin) -> Result<Grant, String> {
    let id = grant_id(&builtin.id)?;
    let grants = &state(app).grants;
    if let Some(found) = grants.by_id(app, &id) {
        return Ok(found);
    }
    let client = format!("nib · {}", builtin.name.trim());
    let (grant, _token) =
        grants.mint(app, &client, |_, client| made(id.clone(), client, builtin))?;
    Ok(grant)
}

/// A token lent for one run: the grant it is, the mode it is in, the token and its hash.
struct Lent {
    grant: String,
    mode: Mode,
    token: String,
    hash: String,
}

/// Every token lent this run. Memory only: the next run lends new ones, so last run's
/// is worth nothing.
static LENT: Mutex<Vec<Lent>> = Mutex::new(Vec::new());

fn lent_now() -> std::sync::MutexGuard<'static, Vec<Lent>> {
    LENT.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The token a provider's session in `mode` hands `nib mcp`: one per provider and mode
/// for a run of the app, made the first time it is asked for.
pub(crate) fn lend(app: &AppHandle, builtin: &Builtin, mode: Mode) -> Result<String, String> {
    let grant = grant_for(app, builtin)?.id;
    let mut all = lent_now();
    if let Some(one) = all.iter().find(|one| one.grant == grant && one.mode == mode) {
        return Ok(one.token.clone());
    }
    let token = fresh_token()?;
    all.push(Lent {
        grant,
        mode,
        hash: hashed(&token),
        token: token.clone(),
    });
    Ok(token)
}

/// The grant a lent token is, in its mode; `None` for a token this run did not lend.
/// Every hash compared, none skipped, as `Grants::by_token` does.
pub(crate) fn lent(app: &AppHandle, token: &str) -> Option<Grant> {
    let said = hashed(token);
    let (grant, mode) = {
        let all = lent_now();
        let mut found = None;
        for one in all.iter() {
            if same(&said, &one.hash) && found.is_none() {
                found = Some((one.grant.clone(), one.mode));
            }
        }
        found?
    };
    state(app)
        .grants
        .by_id(app, &grant)
        .map(|grant| supervised(grant, mode))
}

/// Whether a mode lists a tool: Plan what only reads and `create_note`, the others all.
pub(crate) fn in_mode(mode: Mode, name: &str, reads_only: bool) -> bool {
    match mode {
        Mode::Plan => reads_only || name == "create_note",
        Mode::Approve | Mode::Agent => true,
    }
}

/// The window's verbs it answers now, asked of it the way `nib mcp` asks.
fn window_verbs(app: &AppHandle) -> Option<BTreeSet<String>> {
    let said = crate::endpoint::ask(app, "verbs", json!({}), Duration::from_secs(2)).ok()?;
    Some(
        said.get("verbs")?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    )
}

/// The tools a mode lists for a grant, as `tools/list` would write them.
fn listed(grant: &Grant, window: Option<&BTreeSet<String>>, mode: Mode) -> Vec<Value> {
    host::listed(grant, window)
        .into_iter()
        .filter(|tool| in_mode(mode, &tool.name, host::reads_only(tool)))
        .map(host::shown)
        .collect()
}

/// The instructions and the tools for a provider's agent in a mode.
#[tauri::command(async)]
pub fn ai_agent_tools(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    mode: Mode,
) -> Result<Value, String> {
    crate::agents::from_the_app(&webview)?;
    let grant = grant_for(&app, &agent)?;
    let window = window_verbs(&app);
    Ok(json!({
        "instructions": host::instructions(),
        "tools": listed(&grant, window.as_ref(), mode),
    }))
}

/// One call, as the provider's agent, answered the way `nib mcp` answers a model.
#[tauri::command(async)]
pub fn ai_agent_call(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    mode: Mode,
    tool: String,
    args: Value,
) -> Result<Value, String> {
    crate::agents::from_the_app(&webview)?;
    let grant = grant_for(&app, &agent)?;
    let window = window_verbs(&app);
    let shown = listed(&grant, window.as_ref(), mode);
    if !shown.iter().any(|one| one["name"] == tool.as_str()) {
        return Err(format!("{tool} is not a tool in this mode"));
    }
    let args = host::with_defaults(&tool, if args.is_object() { args } else { json!({}) });
    let asked = json!({ "verb": tool, "args": args, "rest": [] });
    let caller = Caller::Agent(Box::new(supervised(grant, mode)));
    let (status, body) = crate::endpoint::dispatch(&app, &caller, asked, false);
    Ok(host::rendered(&tool, &args, status, &body))
}

/// What every turn is sent about where the reader is (docs/ai-sidebar.md 4.2): the
/// space, the tab in front and every open tab, with their kinds and paths or addresses,
/// as `get_context` answers the provider's agent. Asked by nib for the turn rather than
/// by the model, so in every mode; only as far as the grant reaches, and written for the
/// model with its marks like any answer. One verb: `get_context` lists every tab, so a
/// `workspace_tabs` list beside it would say each one twice.
const CONTEXT: &str = "get_context";

/// The reader's context for a turn, as the model reads it: nothing where the grant does
/// not reach it.
#[tauri::command(async)]
pub fn ai_agent_context(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
) -> Result<Vec<Value>, String> {
    crate::agents::from_the_app(&webview)?;
    let grant = grant_for(&app, &agent)?;
    let window = window_verbs(&app);
    let reached: BTreeSet<String> = host::listed(&grant, window.as_ref())
        .into_iter()
        .map(|tool| tool.name.clone())
        .collect();
    let caller = Caller::Agent(Box::new(grant));
    Ok(Some(CONTEXT)
        .filter(|verb| reached.contains(*verb))
        .map(|verb| {
            let args = json!({});
            let asked = json!({ "verb": verb, "args": args, "rest": [] });
            let (status, body) = crate::endpoint::dispatch(&app, &caller, asked, false);
            host::rendered(verb, &args, status, &body)
        })
        .into_iter()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::verbs::Category;

    /// Every question a call can raise about itself (pairing is a client's, not a call's).
    const ASKED: [Category; 11] = [
        Category::Paying,
        Category::Sending,
        Category::Publishing,
        Category::Deleting,
        Category::SigningIn,
        Category::Settings,
        Category::Terminal,
        Category::Files,
        Category::Writing,
        Category::Showing,
        Category::Takeover,
    ];

    fn builtin(reader_tabs: bool) -> Builtin {
        Builtin {
            id: "anthropic".into(),
            name: "Claude".into(),
            reader_tabs,
        }
    }

    fn grant() -> Grant {
        made("nib-anthropic".into(), "nib · Claude", &builtin(true))
    }

    fn names(mode: Mode, grant: &Grant) -> BTreeSet<String> {
        let window: BTreeSet<String> = [
            "read_note",
            "search_notes",
            "edit_note",
            "create_note",
            "write_note",
            "get_context",
            "move_file",
            "trash_file",
            "create_folder",
            "edit_canvas",
            "workspace_tabs",
            "read_terminal",
            "type_terminal",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        listed(grant, Some(&window), mode)
            .iter()
            .filter_map(|one| one["name"].as_str().map(str::to_owned))
            .collect()
    }

    #[test]
    fn plan_adds_the_plans_own_note_and_nothing_else_that_writes() {
        let plan = names(Mode::Plan, &grant());
        assert!(plan.contains("create_note") && plan.contains("read_note"));
        assert!(plan.contains("browser_snapshot") && plan.contains("read_terminal"));
        assert!(!plan.contains("edit_note") && !plan.contains("write_note"));
        assert!(!plan.contains("browser_click") && !plan.contains("type_terminal"));
    }

    #[test]
    fn approve_and_agent_list_everything_the_grant_reaches_and_no_more() {
        let grant = grant();
        let agent = names(Mode::Agent, &grant);
        assert_eq!(names(Mode::Approve, &grant), agent);
        assert!(agent.contains("edit_note") && agent.contains("browser_click"));
        // Emil's defaults leave scripts and settings out; the terminal is in.
        assert!(!agent.contains("browser_evaluate") && agent.contains("type_terminal"));
        assert!(names(Mode::Plan, &grant).is_subset(&agent));
        for verb in [
            "create_note",
            "create_folder",
            "edit_canvas",
            "move_file",
            "trash_file",
            "workspace_tabs",
            "get_context",
        ] {
            assert!(agent.contains(verb), "{verb}");
        }
    }

    #[test]
    fn agent_never_asks_but_before_paying() {
        let mut stored = grant();
        // Whatever the grant said, asking first included.
        stored.mode = GrantMode::Confirm;
        let agent = supervised(stored, Mode::Agent);
        assert_eq!(agent.mode, GrantMode::Autonomous);
        for category in ASKED {
            assert_eq!(agent.asks(category), category == Category::Paying, "{category:?}");
        }
    }

    #[test]
    fn approve_asks_before_every_change_whatever_was_switched_off() {
        let mut stored = grant();
        stored.asks.insert(Category::Deleting, false);
        stored.asks.insert(Category::Terminal, false);
        let approve = supervised(stored, Mode::Approve);
        assert_eq!(approve.mode, GrantMode::Confirm);
        for category in ASKED {
            assert!(approve.asks(category), "{category:?}");
        }
    }

    #[test]
    fn plan_is_supervised_as_the_grant_says() {
        let stored = grant();
        assert_eq!(supervised(stored.clone(), Mode::Plan), stored);
    }

    #[test]
    fn a_mode_is_laid_over_a_call_never_over_the_grant() {
        // The grant a provider is made with asks for nothing of its own; the thread's
        // mode says how much it asks.
        let made = grant();
        assert_eq!(made.mode, GrantMode::Unsupervised);
        assert!(made.asks.is_empty());
    }

    #[test]
    fn every_turn_asks_where_the_reader_is_once() {
        // `get_context` lists every tab; a `workspace_tabs` list beside it said them twice.
        assert_eq!(CONTEXT, "get_context");
    }

    #[test]
    fn the_readers_tabs_are_in_reach_or_not() {
        assert!(made("nib-a".into(), "nib · A", &builtin(true)).holds(Scope::BrowserReader));
        assert!(!made("nib-a".into(), "nib · A", &builtin(false)).holds(Scope::BrowserReader));
    }

    #[test]
    fn a_provider_id_that_is_not_one_makes_no_grant() {
        assert_eq!(grant_id("anthropic").as_deref(), Ok("nib-anthropic"));
        assert_eq!(grant_id("compatible-2").as_deref(), Ok("nib-compatible-2"));
        for bad in ["", "a b", "../x", &"x".repeat(49)] {
            assert!(grant_id(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn modes_read_as_the_window_names_them() {
        let read: Vec<Mode> =
            serde_json::from_str(r#"["approve","plan","agent"]"#).expect("modes");
        assert_eq!(read, [Mode::Approve, Mode::Plan, Mode::Agent]);
        assert!(serde_json::from_str::<Mode>(r#""ask""#).is_err());
    }
}
