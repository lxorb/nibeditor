//! Which client this is, and the token nib gave it (docs/agent-native.md 9.1).
//!
//! A client is asked about once. The first `nib mcp` a client runs asks the reader through
//! `agent_pair` (the bubble in nib: the client's name, Don't allow, Allow), and the token
//! an Allow answers is kept here, under the client's own name, in the app's settings
//! folder: `<config>/agents/clients/<client>`, the owner's alone. Every later run of that
//! client reads it and asks nobody. nib itself keeps only the token's hash (grants.rs), so
//! this file is the one copy; removing the agent in Settings > Agents is what makes it
//! worth nothing.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::{made, write_privately};

/// The longest client name the pairing takes (`pair_client` in agents/mod.rs).
const LONGEST_NAME: usize = 60;

/// The clients whose own names are words nobody would call them by.
const KNOWN: [(&str, &str); 3] = [
    ("claude-code", "Claude Code"),
    ("claude-ai", "Claude Desktop"),
    ("codex-mcp-client", "Codex"),
];

/// A client, as it named itself at `initialize`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Client {
    /// Its file's name: the client's own name, as letters, digits and hyphens.
    pub key: String,
    /// What the reader is asked about and the grant is called: `Claude Code`.
    pub name: String,
}

impl Client {
    /// The client an `initialize`'s `clientInfo` describes; a client that said nothing
    /// is `agent`, asked about as "An agent".
    pub fn from_info(info: &Value) -> Self {
        let said = |key: &str| {
            info.get(key)
                .and_then(Value::as_str)
                .map(|one| one.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|one| !one.is_empty())
        };
        let own = said("name");
        let key = own.as_deref().map(file_name).unwrap_or_default();
        let key = if key.is_empty() {
            "agent".to_owned()
        } else {
            key
        };
        let known = KNOWN
            .iter()
            .find(|(name, _)| own.as_deref() == Some(*name))
            .map(|(_, called)| (*called).to_owned());
        let name = said("title")
            .or(known)
            .or(own)
            .unwrap_or_else(|| "An agent".to_owned());
        Client {
            key,
            name: name.chars().take(LONGEST_NAME).collect(),
        }
    }
}

/// A name as a file may be called: lowercase letters and digits, anything else one
/// hyphen, 48 characters at most. `Claude Code` is `claude-code`.
fn file_name(name: &str) -> String {
    let mut key = String::new();
    for one in name.chars().flat_map(char::to_lowercase) {
        if one.is_ascii_alphanumeric() {
            key.push(one);
        } else if !key.is_empty() && !key.ends_with('-') {
            key.push('-');
        }
        if key.len() >= 48 {
            break;
        }
    }
    key.trim_end_matches('-').to_owned()
}

/// What is kept for a client: the agent nib made for it, and its token.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    /// The agent's id.
    pub agent: String,
    /// Its token.
    pub token: String,
}

/// Where a client's token is kept.
fn file(dir: &Path, client: &Client) -> PathBuf {
    dir.join("agents").join("clients").join(&client.key)
}

/// The client's token, when it has one.
pub fn kept(dir: &Path, client: &Client) -> Option<Kept> {
    let text = std::fs::read_to_string(file(dir, client)).ok()?;
    serde_json::from_str(&text).ok()
}

/// The client's token, kept, the owner's alone.
pub fn keep(dir: &Path, client: &Client, kept: &Kept) -> Result<(), String> {
    let path = file(dir, client);
    if let Some(folder) = path.parent() {
        made(folder)?;
    }
    let text = serde_json::to_string(kept).map_err(|error| error.to_string())?;
    write_privately(&path, text.as_bytes())
}

/// The client's token, gone: nib no longer knows it.
pub fn forget(dir: &Path, client: &Client) {
    let _ = std::fs::remove_file(file(dir, client));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_client_is_called_what_it_calls_itself() {
        let claude = Client::from_info(&json!({ "name": "claude-code", "title": "Claude Code" }));
        assert_eq!(claude.key, "claude-code");
        assert_eq!(claude.name, "Claude Code");

        let codex = Client::from_info(&json!({ "name": "codex-mcp-client", "version": "1" }));
        assert_eq!(codex.key, "codex-mcp-client");
        assert_eq!(codex.name, "Codex");

        let other = Client::from_info(&json!({ "name": "My Tool (beta)" }));
        assert_eq!(other.key, "my-tool-beta");
        assert_eq!(other.name, "My Tool (beta)");
    }

    #[test]
    fn a_client_that_says_nothing_is_an_agent() {
        let nobody = Client::from_info(&json!({}));
        assert_eq!(nobody.key, "agent");
        assert_eq!(nobody.name, "An agent");
        let odd = Client::from_info(&json!({ "name": "日本", "title": "  " }));
        assert_eq!(odd.key, "agent");
        assert_eq!(odd.name, "日本");
    }

    #[test]
    fn a_long_name_is_cut_to_what_pairing_takes() {
        let long = Client::from_info(&json!({ "name": "x".repeat(200) }));
        assert_eq!(long.name.chars().count(), LONGEST_NAME);
        assert_eq!(long.key.len(), 48);
    }

    #[test]
    fn a_token_is_kept_forgotten_and_nobody_elses() {
        let dir = tempfile::tempdir().expect("a folder");
        let claude = Client::from_info(&json!({ "name": "claude-code" }));
        let codex = Client::from_info(&json!({ "name": "codex-mcp-client" }));
        assert_eq!(kept(dir.path(), &claude), None);

        let token = Kept {
            agent: "claude-code".into(),
            token: "t".repeat(64),
        };
        keep(dir.path(), &claude, &token).expect("kept");
        assert_eq!(kept(dir.path(), &claude), Some(token));
        assert_eq!(kept(dir.path(), &codex), None);
        assert!(dir
            .path()
            .join("agents")
            .join("clients")
            .join("claude-code")
            .is_file());

        forget(dir.path(), &claude);
        assert_eq!(kept(dir.path(), &claude), None);
    }
}
