//! Where a program keeps its sign-in for one account: the reader's own home for the first
//! account of each program, and a folder of nib's for every one after it.
//!
//! **What nib does and does not do.** Both programs document one variable for staying
//! signed in to several accounts at once: `CLAUDE_CONFIG_DIR` ("give each account its own
//! configuration directory", code.claude.com/docs/en/authentication) and `CODEX_HOME`.
//! nib sets that variable on the unmodified program it starts and on the program's own
//! login, typed into a terminal; the program signs the reader in through its maker's own
//! flow and keeps the login there, refreshing it as it always does. nib never opens what
//! the program writes. A Codex home of nib's is told to keep its login in the system's
//! own store (`cli_auth_credentials_store = "keyring"`, keyed by the home); Claude Code
//! keeps its own file in the folder on Windows and Linux and its Keychain entry, keyed by
//! the folder, on a Mac.
//!
//! **The reader's shell does not decide the account.** A key in the environment outranks
//! a sign-in in both programs, so for a home of nib's the variables that would say who is
//! signed in are taken out of what the program is started with. The first account keeps
//! the environment as it always had it.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use super::Tool;

/// The variables that would sign a program in over the home it is given.
const CLAUDE_OVERRIDES: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];
const CODEX_OVERRIDES: [&str; 2] = ["OPENAI_API_KEY", "CODEX_API_KEY"];

/// What a Codex home of nib's starts with: its login in the system's own store.
const CODEX_CONFIG: &str = "cli_auth_credentials_store = \"keyring\"\n";

/// A home of nib's for one account.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Home {
    tool: Tool,
    dir: PathBuf,
}

impl Home {
    /// The variable the program reads its home from.
    pub fn variable(&self) -> &'static str {
        match self.tool {
            Tool::ClaudeCode => "CLAUDE_CONFIG_DIR",
            Tool::Codex => "CODEX_HOME",
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The program's command, pointed at this home and at nothing else.
    pub fn apply(&self, command: &mut Command) {
        let overrides: &[&str] = match self.tool {
            Tool::ClaudeCode => &CLAUDE_OVERRIDES,
            Tool::Codex => &CODEX_OVERRIDES,
        };
        for name in overrides {
            command.env_remove(name);
        }
        command.env(self.variable(), &self.dir);
    }

    /// Makes the folder, and a Codex home's config, the first time it is used.
    fn made(&self) -> Result<(), String> {
        crate::paths::made(&self.dir)?;
        if self.tool == Tool::Codex {
            let config = self.dir.join("config.toml");
            if !config.exists() {
                std::fs::write(&config, CODEX_CONFIG).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
}

/// The kind the accounts file names a program by.
fn kind_of(tool: Tool) -> &'static str {
    match tool {
        Tool::ClaudeCode => "claude-code",
        Tool::Codex => "codex",
    }
}

/// The home an account's program runs with under the accounts in `root`: `None` for no
/// account named, or for the reader's own (the first of each program).
pub fn under(root: &Path, tool: Tool, account: Option<&str>) -> Result<Option<Home>, String> {
    let Some(id) = account else {
        return Ok(None);
    };
    if !crate::ai_accounts::has_own_home(root, id, kind_of(tool))? {
        return Ok(None);
    }
    let home = Home {
        tool,
        dir: crate::ai_accounts::home_dir(root, id)?,
    };
    home.made()?;
    Ok(Some(home))
}

/// The same, for this app's accounts.
pub fn of(app: &AppHandle, tool: Tool, account: Option<&str>) -> Result<Option<Home>, String> {
    under(&crate::ai_accounts::root(app)?, tool, account)
}

/// A home of nib's let go of, once its program has signed out of it: the folder and what
/// is in it. Nothing for the reader's own home, which is theirs.
pub fn removed(home: &Home) -> Result<(), String> {
    match std::fs::remove_dir_all(&home.dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove that sign-in: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nib-ai-homes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::ai_accounts::write(
            &dir,
            r#"{"accounts":[
                {"id":"claude-code","kind":"claude-code","name":"","model":""},
                {"id":"claude-code-2","kind":"claude-code","name":"","model":"","own":true},
                {"id":"codex-2","kind":"codex","name":"","model":"","own":true}
            ]}"#,
            "",
        )
        .expect("accounts");
        dir
    }

    #[test]
    fn the_first_account_is_the_readers_own_home() {
        let dir = root("first");
        assert_eq!(under(&dir, Tool::ClaudeCode, Some("claude-code")), Ok(None));
        assert_eq!(under(&dir, Tool::ClaudeCode, None), Ok(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_one_is_a_folder_of_nibs_made_on_first_use() {
        let dir = root("second");
        let home = under(&dir, Tool::ClaudeCode, Some("claude-code-2"))
            .expect("read")
            .expect("a home");
        assert_eq!(home.dir(), dir.join("homes").join("claude-code-2"));
        assert!(home.dir().is_dir());
        assert_eq!(home.variable(), "CLAUDE_CONFIG_DIR");

        let codex = under(&dir, Tool::Codex, Some("codex-2"))
            .expect("read")
            .expect("a home");
        let config = std::fs::read_to_string(codex.dir().join("config.toml")).expect("config");
        assert_eq!(config, CODEX_CONFIG);
        removed(&codex).expect("removed");
        assert!(!codex.dir().exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_program_is_started_with_its_home_and_no_key_from_the_shell() {
        let home = Home {
            tool: Tool::ClaudeCode,
            dir: PathBuf::from("homes").join("claude-code-2"),
        };
        let mut command = Command::new("claude");
        command.env("ANTHROPIC_API_KEY", "from-the-shell");
        home.apply(&mut command);
        let envs: Vec<_> = command.get_envs().collect();
        assert!(envs.contains(&(
            std::ffi::OsStr::new("CLAUDE_CONFIG_DIR"),
            Some(home.dir().as_os_str())
        )));
        assert!(envs.contains(&(std::ffi::OsStr::new("ANTHROPIC_API_KEY"), None)));
        for name in CLAUDE_OVERRIDES {
            assert!(envs.contains(&(std::ffi::OsStr::new(name), None)), "{name}");
        }
    }
}
