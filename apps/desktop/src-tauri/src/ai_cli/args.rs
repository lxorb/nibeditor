//! What each program is started with, which the crate decides and the window never does.
//!
//! The window names a tool, a model and a question. Everything else on the command line
//! is written here, so no page - nib's own or one that got hold of its bridge - can hand
//! Claude Code or Codex a flag that lets it run a command, write a file or reach a server
//! the reader set up for their own work. The answer is words and nothing else:
//!
//! - **Claude Code** runs with no tools at all (`--tools ""`), none of the reader's MCP
//!   servers (`--strict-mcp-config` with none given), nothing written to its session
//!   history, and nib's own one-line system prompt in place of the coding agent's. Where
//!   the installed version knows `--safe-mode`, the reader's hooks, plugins and
//!   `CLAUDE.md` stay out of it too, while their sign-in and model work as always; and
//!   where it knows `--permission-prompts none`, anything that would ask is refused.
//! - **Codex** runs read-only, its shell tool, web search and MCP servers off, the
//!   `AGENTS.md` files it would read left unread, nothing written to its history, and the
//!   question read from stdin (`-`).
//!
//! Which optional flags a program has is read off its own `--help`, once per program per
//! run of the app (`Caps`), so an older Claude Code or Codex is still asked rather than
//! refused for a flag it has not heard of.

use serde::Deserialize;

/// The two programs, as the window names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tool {
    /// Anthropic's Claude Code, `claude`.
    ClaudeCode,
    /// The Codex CLI, `codex`.
    Codex,
}

impl Tool {
    /// The program's name on a command line.
    pub fn command(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude",
            Self::Codex => "codex",
        }
    }
}

/// What Claude Code is told in place of its own system prompt. One line with no quote,
/// percent sign or line break, because on Windows an npm install is a `.cmd` file and
/// every argument goes through `cmd.exe` on its way; the instructions that change with
/// the question are in the question itself, on stdin. See `promptFor` in the app.
pub const SYSTEM: &str = "You are the assistant inside nibeditor, a markdown notes app. \
The message starts with the app's instructions for this request; follow them exactly. \
You have no tools: answer in words only.";

/// The optional flags a program's `--help` mentions.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Caps {
    flags: Vec<String>,
}

impl Caps {
    /// Every `--flag` the help text names.
    pub fn from_help(help: &str) -> Self {
        let mut flags: Vec<String> = help
            .split(|one: char| !(one.is_ascii_alphanumeric() || one == '-'))
            .filter(|word| word.len() > 2 && word.starts_with("--"))
            .map(str::to_owned)
            .collect();
        flags.sort_unstable();
        flags.dedup();
        Self { flags }
    }

    fn has(&self, flag: &str) -> bool {
        self.flags
            .binary_search_by(|one| one.as_str().cmp(flag))
            .is_ok()
    }
}

/// Whether a model name is one to pass on: a short run of the characters model names and
/// aliases are made of (`opus`, `claude-opus-4-5`, `gpt-5.1-codex`, `sonnet[1m]`), never
/// starting with a dash, so it can only ever be the value of `--model`.
pub fn model_ok(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 100
        && !model.starts_with('-')
        && model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'[' | b']')
        })
}

/// The command line one question runs with. `model` is `None` for the program's own
/// default, which is whatever the reader chose in it.
pub fn ask(tool: Tool, model: Option<&str>, caps: &Caps) -> Result<Vec<String>, String> {
    if let Some(model) = model {
        if !model_ok(model) {
            return Err(format!("{model:?} is not a model name"));
        }
    }

    let mut args: Vec<String> = match tool {
        Tool::ClaudeCode => claude(caps),
        Tool::Codex => codex(caps),
    };
    if let Some(model) = model {
        let at = if tool == Tool::Codex {
            // Before the `-` that says the question is on stdin.
            args.len() - 1
        } else {
            args.len()
        };
        args.splice(at..at, ["--model".to_owned(), model.to_owned()]);
    }
    Ok(args)
}

fn claude(caps: &Caps) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--system-prompt",
        SYSTEM,
    ]
    .map(str::to_owned)
    .to_vec();

    if caps.has("--no-session-persistence") {
        args.push("--no-session-persistence".to_owned());
    }
    if caps.has("--safe-mode") {
        args.push("--safe-mode".to_owned());
    }
    if caps.has("--permission-prompts") {
        args.extend(["--permission-prompts".to_owned(), "none".to_owned()]);
    }
    args
}

fn codex(caps: &Caps) -> Vec<String> {
    let mut args: Vec<String> = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
    ]
    .map(str::to_owned)
    .to_vec();

    for flag in ["--ephemeral", "--ignore-user-config", "--ignore-rules"] {
        if caps.has(flag) {
            args.push(flag.to_owned());
        }
    }
    // Overrides of the reader's config for this one run, as TOML. A key an older Codex
    // does not know is left alone by it, so both spellings of web search are given; and
    // the strings are TOML's single-quoted kind, because on Windows an npm install is a
    // `.cmd` file and a double quote has a meaning to `cmd.exe` on the way.
    for setting in [
        "features.shell_tool=false",
        "web_search='disabled'",
        "tools.web_search=false",
        "mcp_servers={}",
        "project_doc_max_bytes=0",
        "history.persistence='none'",
    ] {
        args.extend(["-c".to_owned(), setting.to_owned()]);
    }
    args.push("-".to_owned());
    args
}

/// What asks a program whether, and as whom, it is signed in: an answer it gives from
/// its own files, which nib never opens.
pub fn status(tool: Tool) -> &'static [&'static str] {
    match tool {
        Tool::ClaudeCode => &["auth", "status", "--json"],
        Tool::Codex => &["login", "status"],
    }
}

/// What lists the flags a question may use.
pub fn help(tool: Tool) -> &'static [&'static str] {
    match tool {
        Tool::ClaudeCode => &["--help"],
        Tool::Codex => &["exec", "--help"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE_HELP: &str = "  --safe-mode   Start with all customizations disabled\n  \
        --no-session-persistence  Disable session persistence\n  \
        --permission-prompts <target>  Who answers";

    #[test]
    fn claude_runs_with_no_tools_no_servers_and_nib_s_prompt() {
        let args = ask(Tool::ClaudeCode, None, &Caps::default()).expect("args");
        let tools = args
            .iter()
            .position(|one| one == "--tools")
            .expect("--tools");
        assert_eq!(args[tools + 1], "");
        assert!(args.contains(&"--strict-mcp-config".to_owned()));
        assert!(args.contains(&"-p".to_owned()));
        assert!(!args.iter().any(|one| one == "--mcp-config"));
        assert!(!args.iter().any(|one| one.contains("skip-permissions")));
        let prompt = args
            .iter()
            .position(|one| one == "--system-prompt")
            .expect("prompt");
        assert_eq!(args[prompt + 1], SYSTEM);
    }

    #[test]
    fn every_fixed_argument_survives_cmd() {
        let caps = Caps::from_help(CLAUDE_HELP);
        for tool in [Tool::ClaudeCode, Tool::Codex] {
            for arg in ask(tool, None, &caps).expect("args") {
                assert!(
                    !arg.contains(['"', '%', '\n', '\r', '^', '&', '|', '<', '>']),
                    "{arg}"
                );
            }
        }
    }

    #[test]
    fn optional_flags_only_where_the_help_names_them() {
        let bare = ask(Tool::ClaudeCode, None, &Caps::default()).expect("args");
        assert!(!bare.contains(&"--safe-mode".to_owned()));

        let caps = Caps::from_help(CLAUDE_HELP);
        let full = ask(Tool::ClaudeCode, None, &caps).expect("args");
        assert!(full.contains(&"--safe-mode".to_owned()));
        assert!(full.contains(&"--no-session-persistence".to_owned()));
        let prompts = full
            .iter()
            .position(|one| one == "--permission-prompts")
            .expect("prompts");
        assert_eq!(full[prompts + 1], "none");
    }

    #[test]
    fn codex_is_read_only_with_its_tools_off_and_reads_stdin() {
        let caps = Caps::from_help("--ephemeral  Run without persisting\n--ignore-user-config");
        let args = ask(Tool::Codex, Some("gpt-5.1-codex"), &caps).expect("args");
        assert_eq!(args[0], "exec");
        assert_eq!(args.last().map(String::as_str), Some("-"));
        let sandbox = args
            .iter()
            .position(|one| one == "--sandbox")
            .expect("sandbox");
        assert_eq!(args[sandbox + 1], "read-only");
        assert!(args.contains(&"features.shell_tool=false".to_owned()));
        assert!(args.contains(&"mcp_servers={}".to_owned()));
        assert!(args.contains(&"--ephemeral".to_owned()));
        assert!(!args.contains(&"--ignore-rules".to_owned()));
        let model = args.iter().position(|one| one == "--model").expect("model");
        assert_eq!(args[model + 1], "gpt-5.1-codex");
        assert!(model < args.len() - 2);
    }

    #[test]
    fn a_model_is_a_value_and_never_a_flag() {
        for good in [
            "opus",
            "claude-opus-4-5",
            "sonnet[1m]",
            "gpt-5.1-codex",
            "o3:high",
        ] {
            assert!(model_ok(good), "{good} was refused");
        }
        for bad in [
            "",
            "--dangerously-skip-permissions",
            "-p",
            "opus sonnet",
            "a\"b",
            "x%PATH%",
            &"m".repeat(101),
        ] {
            assert!(!model_ok(bad), "{bad:?} was taken");
            assert!(ask(Tool::ClaudeCode, Some(bad), &Caps::default()).is_err());
        }
    }

    #[test]
    fn the_status_questions_are_the_programs_own() {
        assert_eq!(status(Tool::ClaudeCode), ["auth", "status", "--json"]);
        assert_eq!(status(Tool::Codex), ["login", "status"]);
    }
}
