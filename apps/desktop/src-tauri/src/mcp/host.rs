//! The same server, hosted inside the app for the AI sidebar's own agent (`ai_agent.rs`):
//! the tool table, the instructions every outside agent's model is given, and a result
//! written the way `nib mcp` writes it, marks included. Nothing of the protocol: the
//! sidebar's loop is in the window, and the call is the endpoint's own dispatch.

use std::collections::BTreeSet;

use serde_json::Value;

use super::results::{rendered as written, Outcome};
use super::server::{defaults, INSTRUCTIONS};
use super::tools::{self, Tool};
use crate::agents::grants::Grant;

/// What every client puts before its model.
pub(crate) fn instructions() -> &'static str {
    INSTRUCTIONS
}

/// The tools a grant reaches, of the window's verbs only those the window answers.
pub(crate) fn listed(grant: &Grant, window: Option<&BTreeSet<String>>) -> Vec<&'static Tool> {
    tools::listed(grant, window)
}

/// A tool as `tools/list` writes it.
pub(crate) fn shown(tool: &Tool) -> Value {
    tool.listed()
}

/// Whether a tool only reads: its own `readOnlyHint`, the line Ask mode is drawn at.
pub(crate) fn reads_only(tool: &Tool) -> bool {
    tool.annotations
        .as_ref()
        .and_then(|one| one.get("readOnlyHint"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// A call's arguments with what a model is spared filled in, as `nib mcp` fills them.
pub(crate) fn with_defaults(tool: &str, args: Value) -> Value {
    defaults(tool, args)
}

/// The endpoint's answer to a call, written for a model.
pub(crate) fn rendered(tool: &str, args: &Value, status: u16, body: &str) -> Value {
    let said = serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_owned()));
    written(tool, args, &Outcome::from_endpoint(status, &said))
}
