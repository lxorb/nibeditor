//! Agents: programs that drive nib on the reader's behalf, through the local endpoint.
//! The design is docs/agent-native.md; this is its crate half.
//!
//! What lives here, one responsibility a file: who an agent is and what it may reach
//! (`grants`), the verbs and their answers (`verbs`), and - on the engines that can - the
//! agent's own tabs that nobody sees and every verb that drives a page.
//!
//! **Nothing at launch.** Not a thread, not a file read, not a webview: the state below
//! is made on the first request that names an agent verb or carries an agent's token,
//! and an installation nobody pairs an agent with never makes it (11).

// The contract other lanes build against lands a step ahead of the verbs that answer
// it; the allowance goes as they do.
#[allow(
    dead_code,
    reason = "the contract lands before the verbs that answer it"
)]
pub mod grants;
#[allow(
    dead_code,
    reason = "the contract lands before the verbs that answer it"
)]
pub mod verbs;

use std::sync::OnceLock;

use serde_json::Value;
use tauri::AppHandle;

use grants::{Grant, Grants, Scope};
use verbs::{Answer, Code, Verb};

/// Everything the crate keeps about agents, made on the first agent request.
#[derive(Default)]
pub struct Agents {
    /// Who may drive nib.
    pub grants: Grants,
}

/// The one `Agents`, made the first time anything asks.
static AGENTS: OnceLock<Agents> = OnceLock::new();

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
    #[allow(
        dead_code,
        reason = "the contract lands before the verbs that answer it"
    )]
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
}

/// Who a bearer token belongs to, other than the installation's secret: an agent, or
/// nobody.
pub fn caller_for(app: &AppHandle, token: &str) -> Option<Caller> {
    state(app)
        .grants
        .by_token(app, token)
        .map(|grant| Caller::Agent(Box::new(grant)))
}

/// Answers one verb of the crate's own.
pub fn answer(app: &AppHandle, caller: &Caller, verb: Verb) -> Answer {
    match verb {
        Verb::Status(_) => status(app, caller),
        Verb::Pair(_) | Verb::Bye(_) | Verb::ApprovalStatus(_) => Answer::error(
            Code::UnsupportedOnThisEngine,
            format!("{} is not answered yet", verb.name()),
        ),
        _ => unsupported(verb.name()),
    }
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
    Answer::ok(verbs::Status {
        grant,
        paused: None,
        paused_tabs: Vec::new(),
        tabs: Vec::new(),
        approvals: Vec::new(),
    })
}

/// What a verb answers on an engine with no honest way to do it (section 12).
fn unsupported(name: &str) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!("{name} is not available on this engine"),
    )
}

/// Whether an agent may send a window verb at all, and what it needs to: the crate's
/// half of the check, before the window's own. A verb of the command line's that is
/// not an agent's (`files.write`, `eval`) is never handed on for an agent.
pub fn may_ask_the_window(caller: &Caller, verb: &str) -> Result<(), String> {
    let Caller::Agent(_) = caller else {
        return Ok(());
    };
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
}
