//! The AI sidebar's agent: nib's own tools, called by the loop the window runs for a
//! Claude or `OpenAI` key, a `ChatGPT` plan or a compatible server (docs/ai-sidebar.md 4.4).
//!
//! **An agent like any other.** Each provider gets a built-in grant, named after it
//! ("nib · Claude"), made the first time its thread asks and kept in Settings > Agents
//! with the same scopes, sites, questions, limits and stop as an outside agent's. A call
//! goes through the endpoint's own dispatch with that grant as the caller
//! (`endpoint::dispatch`), so it meets the same policy, asks the same questions and is
//! written to the same log; the answer is written for the model the way `nib mcp`
//! writes it, marks round every word from outside (`mcp::host`). There is no second
//! policy in the window.
//!
//! **The modes are views of the grant, never more than it** (4.4): Ask lists the tools
//! that only read, Plan those and `create_note` for the plan, Agent everything the grant
//! reaches. A call to a tool its mode does not list is refused here as well, whatever
//! the model says.
//!
//! Every turn also carries where the reader is - the space, the tab in front, every
//! open tab - asked by nib through the same two verbs an outside agent would call
//! (`ai_agent_context`).
//!
//! The grant is made with the two choices the window holds (src/lib/ai/chat/choices.ts):
//! whether the reader's own tabs are in reach (`browser.reader`), and whether every edit
//! asks first (`confirm` mode). Made once; the reader changes it in Settings > Agents.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agents::grants::{Grant, Mode as GrantMode, Scope};
use crate::agents::{state, Caller};
use crate::mcp::host;

/// The sidebar's modes, as the window names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Reads and cites.
    Ask,
    /// Reads, and writes the plan as a note.
    Plan,
    /// Everything the grant reaches.
    Agent,
}

/// Which provider's agent is asking, and the window's two choices for a new grant.
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
    /// Whether every edit asks first.
    #[serde(default)]
    pub ask_first: bool,
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
/// reader's tabs in reach or not, and asking for every write or not.
fn made(id: String, client: &str, builtin: &Builtin) -> Grant {
    let mut grant = Grant::own(id, client);
    if !builtin.reader_tabs {
        grant.scopes.retain(|one| *one != Scope::BrowserReader);
    }
    if builtin.ask_first {
        grant.mode = GrantMode::Confirm;
    }
    grant
}

/// The provider's built-in grant, made the first time it is asked for. Its token is not
/// kept: the window's calls are dispatched inside the app, and a client outside it gets
/// a token of its own.
fn grant_for(app: &AppHandle, builtin: &Builtin) -> Result<Grant, String> {
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

/// Whether a mode lists a tool: Ask what only reads, Plan that and `create_note`.
fn in_mode(mode: Mode, name: &str, reads_only: bool) -> bool {
    match mode {
        Mode::Ask => reads_only,
        Mode::Plan => reads_only || name == "create_note",
        Mode::Agent => true,
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
    let (status, body) =
        crate::endpoint::dispatch(&app, &Caller::Agent(Box::new(grant)), asked, false);
    Ok(host::rendered(&tool, &args, status, &body))
}

/// What every turn is sent about where the reader is (docs/ai-sidebar.md 4.2): the
/// space, the tab in front and every open tab, with their kinds and paths or addresses,
/// as `get_context` and `workspace_tabs` answer the provider's agent. Asked by nib for
/// the turn rather than by the model, so in every mode; each verb only as far as the
/// grant reaches, and written for the model with its marks like any answer.
const CONTEXT: [(&str, fn() -> Value); 2] = [
    ("get_context", || json!({})),
    ("workspace_tabs", || json!({ "op": "list" })),
];

/// The reader's context for a turn: one answer a verb, as the model reads it.
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
    Ok(CONTEXT
        .iter()
        .filter(|(verb, _)| reached.contains(*verb))
        .map(|(verb, args)| {
            let args = args();
            let asked = json!({ "verb": verb, "args": args, "rest": [] });
            let (status, body) = crate::endpoint::dispatch(&app, &caller, asked, false);
            host::rendered(verb, &args, status, &body)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builtin(reader_tabs: bool, ask_first: bool) -> Builtin {
        Builtin {
            id: "anthropic".into(),
            name: "Claude".into(),
            reader_tabs,
            ask_first,
        }
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
    fn ask_lists_only_what_reads() {
        let grant = made(
            "nib-anthropic".into(),
            "nib · Claude",
            &builtin(true, false),
        );
        let ask = names(Mode::Ask, &grant);
        assert!(
            ask.contains("read_note")
                && ask.contains("search_notes")
                && ask.contains("browser_snapshot")
        );
        assert!(
            !ask.contains("edit_note")
                && !ask.contains("create_note")
                && !ask.contains("browser_click")
        );
    }

    #[test]
    fn plan_adds_the_plans_own_note_and_nothing_else_that_writes() {
        let grant = made(
            "nib-anthropic".into(),
            "nib · Claude",
            &builtin(true, false),
        );
        let plan = names(Mode::Plan, &grant);
        assert!(plan.contains("create_note") && plan.contains("read_note"));
        assert!(!plan.contains("edit_note") && !plan.contains("write_note"));
    }

    #[test]
    fn agent_lists_everything_the_grant_reaches_and_no_more() {
        let grant = made(
            "nib-anthropic".into(),
            "nib · Claude",
            &builtin(true, false),
        );
        let agent = names(Mode::Agent, &grant);
        assert!(agent.contains("edit_note") && agent.contains("browser_click"));
        // Emil's defaults leave scripts, settings and the terminal out.
        assert!(!agent.contains("browser_evaluate") && !agent.contains("run_terminal"));
        let ask = names(Mode::Ask, &grant);
        assert!(ask.is_subset(&agent));
    }

    #[test]
    fn agent_can_make_rename_move_and_delete_every_kind() {
        let grant = made(
            "nib-anthropic".into(),
            "nib · Claude",
            &builtin(true, false),
        );
        let agent = names(Mode::Agent, &grant);
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
        let ask = names(Mode::Ask, &grant);
        assert!(!ask.contains("trash_file") && !ask.contains("move_file"));
    }

    #[test]
    fn every_turn_asks_where_the_reader_is_by_the_two_verbs_that_say() {
        let verbs: Vec<&str> = CONTEXT.iter().map(|(verb, _)| *verb).collect();
        assert_eq!(verbs, ["get_context", "workspace_tabs"]);
        assert_eq!(CONTEXT[1].1(), json!({ "op": "list" }));
    }

    #[test]
    fn the_two_choices_shape_a_new_grant() {
        let open = made("nib-a".into(), "nib · A", &builtin(true, false));
        assert!(open.holds(Scope::BrowserReader));
        assert_eq!(open.mode, GrantMode::Unsupervised);
        let shut = made("nib-a".into(), "nib · A", &builtin(false, true));
        assert!(!shut.holds(Scope::BrowserReader));
        assert_eq!(shut.mode, GrantMode::Confirm);
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
        let read: Vec<Mode> = serde_json::from_str(r#"["ask","plan","agent"]"#).expect("modes");
        assert_eq!(read, [Mode::Ask, Mode::Plan, Mode::Agent]);
    }
}
