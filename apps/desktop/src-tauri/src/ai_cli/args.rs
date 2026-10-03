//! What each program is started with, and what it is told on the way, which the crate
//! decides and the window never does.
//!
//! The window names a tool, a model, an effort, a mode and a thread, and sends words.
//! Everything else on the command line, and every field of every message that sets a
//! program up, is written here, so no page (nib's own, or one that got hold of its
//! bridge) can hand Claude Code or Codex a flag that lets it run a command, write a file
//! or reach a server the reader set up for their own work.
//!
//! - **A question** (`ask`, Claude Code only) is answered in words: no tools at all
//!   (`--tools ""`), none of the reader's MCP servers (`--strict-mcp-config` with none
//!   given), nothing written to its session history, nib's own one-line system prompt in
//!   place of the coding agent's, and where the installed version knows `--safe-mode`,
//!   the reader's hooks, plugins and `CLAUDE.md` left out while their sign-in and model
//!   work as always.
//! - **A session** (the AI sidebar's thread, docs/ai-sidebar.md 5.2) is the same promise
//!   with one tool in it: nib's own, `nib mcp`, under the sidebar's grant, listing only
//!   what the thread's mode lists. Claude Code runs long-lived with turns on stdin as
//!   stream-json, `--restricted` where it has it (the reader's settings files, hooks and
//!   plugins left out) and the reader's `CLAUDE.md` files switched off by their own
//!   variable. Not `--safe-mode`: measured on 2.1.280, it drops the `--mcp-config` server
//!   too. Codex runs as `app-server` for every question, sidebar or not: read-only,
//!   asking nobody, shell and web search off, none of the reader's MCP servers, no
//!   `AGENTS.md`, and nib's server added per thread on stdin (`codex_thread`).
//!
//! Which optional flags Claude Code has is read off its own `--help`, once per program
//! per run of the app (`Caps`), so an older version is still asked rather than refused
//! for a flag it has not heard of.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

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

/// What a session of the sidebar's is told, by mode: one line each, kept to the
/// characters `cmd.exe` passes through untouched, like `SYSTEM`. The space's own
/// instructions and the reader's arrive in the first message, from the window.
pub fn session_system(mode: Option<Mode>) -> &'static str {
    match mode {
        None => SYSTEM,
        Some(Mode::Ask) => {
            "You are the reader's assistant inside nibeditor, their notes app and web \
browser. Ask mode: read and search with the nib tools, change nothing, and answer from what \
you read, naming the note or page each claim comes from as a [[wikilink]] or its address. \
Reply in the language of the question, in markdown, briefly."
        }
        Some(Mode::Plan) => {
            "You are the reader's assistant inside nibeditor, their notes app and web \
browser. Plan mode: read what you need with the nib tools, then write the plan as one new \
note with create_note, a task per step, and change nothing else. Reply in the language of \
the request, briefly."
        }
        Some(Mode::Agent) => {
            "You are the reader's agent inside nibeditor, their notes app and web browser. \
Do what they ask with the nib tools; every change you make is shown to them to keep or undo. \
Change part of a note with edit_note rather than write_note, since they may be typing in it. \
Reply in the language of the request, briefly, saying what you did."
        }
    }
}

/// What the sidebar's thread may do (docs/ai-sidebar.md 4.4): the tools each lists are a
/// view of the grant, never more than it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// The tools that only read.
    Ask,
    /// Those, and `create_note` for the plan.
    Plan,
    /// Everything the grant reaches.
    Agent,
}

/// nib's scale of effort, less `auto`, which is sent as nothing (docs/ai-sidebar.md 4.9).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    /// `none`, as `OpenAI` spells it.
    Off,
    /// `minimal`.
    Minimal,
    /// `low`.
    Low,
    /// `medium`.
    Medium,
    /// `high`.
    High,
    /// `xhigh`, the chip's Extra.
    Xhigh,
    /// `max`.
    Max,
}

impl Effort {
    /// The level as a program spells it, or why it cannot be sent: Claude Code takes low
    /// to max, Codex `none` to max.
    pub fn word(self, tool: Tool) -> Result<&'static str, String> {
        Ok(match (self, tool) {
            (Self::Off | Self::Minimal, Tool::ClaudeCode) => {
                return Err(format!("{} has no such effort", tool.command()))
            }
            (Self::Off, Tool::Codex) => "none",
            (Self::Minimal, Tool::Codex) => "minimal",
            (Self::Low, _) => "low",
            (Self::Medium, _) => "medium",
            (Self::High, _) => "high",
            (Self::Xhigh, _) => "xhigh",
            (Self::Max, _) => "max",
        })
    }
}

/// One row of `nib mcp`'s table, as far as a mode needs it.
#[derive(Deserialize)]
struct Row {
    name: String,
    #[serde(default)]
    annotations: Value,
}

/// The tools a mode lists and the ones it leaves out, by their names in `nib mcp`, from
/// the one table the server lists them from (src/mcp/tools.json). What the grant does
/// not reach the server leaves out on its own.
pub fn tools_of(mode: Mode) -> (Vec<String>, Vec<String>) {
    let table: Vec<Row> =
        serde_json::from_str(include_str!("../mcp/tools.json")).unwrap_or_default();
    let (listed, left): (Vec<Row>, Vec<Row>) = table.into_iter().partition(|row| {
        let reads = row.annotations["readOnlyHint"].as_bool() == Some(true);
        match mode {
            Mode::Ask => reads,
            Mode::Plan => reads || row.name == "create_note",
            Mode::Agent => true,
        }
    });
    let names = |rows: Vec<Row>| rows.into_iter().map(|row| row.name).collect();
    (names(listed), names(left))
}

/// The name a session's MCP server goes by in both programs, which Claude Code prefixes
/// its tools with (`mcp__nib__read_note`).
pub const SERVER: &str = "nib";

/// The variable `nib mcp` reads the sidebar's token from (src/mcp/link.rs). Set on the
/// program's own environment: Claude Code hands its environment to the servers it starts,
/// and Codex is told to pass this one on (`env_vars`). Never on a command line.
pub const TOKEN_VAR: &str = "NIB_MCP_TOKEN";

/// What a Claude Code session's environment adds to the app's: the reader's `CLAUDE.md`
/// files left unread, which `--restricted` does not do on its own.
pub const CLAUDE_SESSION_ENV: [(&str, &str); 1] = [("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1")];

/// Claude Code's `--mcp-config`: `nib mcp` alone, by this app's own program. No token in
/// it; see `TOKEN_VAR`.
pub fn mcp_config(nib: &Path) -> Value {
    json!({
        "mcpServers": {
            SERVER: { "type": "stdio", "command": nib, "args": ["mcp"] }
        }
    })
}

/// What a session is started as.
#[derive(Clone, Copy, Debug, Default)]
pub struct Shape<'a> {
    /// The mode's tools; `None` is a session with no tool at all, for a question that
    /// wants words.
    pub mode: Option<Mode>,
    /// `None` is the program's own default.
    pub model: Option<&'a str>,
    /// `None` is the model's own default.
    pub effort: Option<Effort>,
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

/// A model name, checked.
pub fn checked_model(model: Option<&str>) -> Result<Option<&str>, String> {
    match model {
        Some(model) if !model_ok(model) => Err(format!("{model:?} is not a model name")),
        other => Ok(other),
    }
}

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

/// The flags every Claude Code run starts with: printed as stream-json, no tool of its
/// own, none of the reader's MCP servers.
fn claude_base(input: bool, partial: bool) -> Vec<String> {
    let mut args = vec!["-p".to_owned()];
    if input {
        args.extend(["--input-format".to_owned(), "stream-json".to_owned()]);
    }
    args.extend(
        ["--output-format", "stream-json", "--verbose"]
            .map(str::to_owned)
            .to_vec(),
    );
    if partial {
        args.push("--include-partial-messages".to_owned());
    }
    args.extend(["--tools", "", "--strict-mcp-config"].map(str::to_owned).to_vec());
    args
}

/// The flags a program has that keep the reader's things out, where it has them.
fn present(caps: &Caps, flags: &[&str]) -> Vec<String> {
    flags
        .iter()
        .filter(|flag| caps.has(flag))
        .map(|flag| (*flag).to_owned())
        .collect()
}

/// The command line one question runs with: Claude Code, words only. `model` is `None`
/// for the program's own default, which is whatever the reader chose in it. Codex is
/// asked through its app-server (`codex_server`), never here.
pub fn ask(model: Option<&str>, caps: &Caps) -> Result<Vec<String>, String> {
    let model = checked_model(model)?;
    let mut args = claude_base(false, true);
    args.extend(["--system-prompt".to_owned(), SYSTEM.to_owned()]);
    args.extend(present(caps, &["--no-session-persistence", "--safe-mode"]));
    if caps.has("--permission-prompts") {
        args.extend(["--permission-prompts".to_owned(), "none".to_owned()]);
    }
    if let Some(model) = model {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    Ok(args)
}

/// Claude Code's command line for a session. `config` is the file `mcp_config` was
/// written to, named only where the shape has a mode.
pub fn claude_session(shape: Shape, caps: &Caps, config: &Path) -> Result<Vec<String>, String> {
    if !caps.has("--input-format") {
        return Err("out of date".to_owned());
    }
    let model = checked_model(shape.model)?;
    let effort = shape
        .effort
        .map(|one| one.word(Tool::ClaudeCode))
        .transpose()?;

    let mut args = claude_base(true, true);
    if let Some(mode) = shape.mode {
        let (listed, left) = tools_of(mode);
        let named = |names: &[String]| {
            names
                .iter()
                .map(|name| format!("mcp__{SERVER}__{name}"))
                .collect::<Vec<_>>()
                .join(",")
        };
        args.extend([
            "--mcp-config".to_owned(),
            config.to_string_lossy().into_owned(),
            "--allowedTools".to_owned(),
            if left.is_empty() {
                format!("mcp__{SERVER}")
            } else {
                named(&listed)
            },
        ]);
        if !left.is_empty() {
            // Left out of what the model is shown, not only refused when called.
            args.extend(["--disallowedTools".to_owned(), named(&left)]);
        }
    }
    // Anything not allowed above is refused without asking: nobody is there to ask, and
    // nib's own questions are asked at nib's verbs.
    if caps.has("--permission-mode") {
        args.extend(["--permission-mode".to_owned(), "dontAsk".to_owned()]);
    }
    if caps.has("--permission-prompts") {
        args.extend(["--permission-prompts".to_owned(), "none".to_owned()]);
    }
    args.extend([
        "--system-prompt".to_owned(),
        session_system(shape.mode).to_owned(),
    ]);
    args.extend(present(caps, &["--no-session-persistence", "--restricted"]));
    if let Some(model) = model {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    if let (Some(effort), true) = (effort, caps.has("--effort")) {
        args.extend(["--effort".to_owned(), effort.to_owned()]);
    }
    Ok(args)
}

/// Claude Code asked for its model list and nothing else: no tool, no server, nothing of
/// the reader's.
pub fn claude_listing(caps: &Caps) -> Vec<String> {
    let mut args = claude_base(true, false);
    args.extend(["--system-prompt".to_owned(), SYSTEM.to_owned()]);
    args.extend(present(caps, &["--no-session-persistence", "--safe-mode"]));
    args
}

/// Codex's app-server, with the reader's config overridden where it could reach past the
/// answer: no shell, no web search, none of their MCP servers, no `AGENTS.md`, nothing in
/// its history, read-only and asking nobody. A key an older Codex does not know is left
/// alone by it, so both spellings of web search are given; and the strings are TOML's
/// single-quoted kind, because on Windows an npm install is a `.cmd` file and a double
/// quote has a meaning to `cmd.exe` on the way.
pub fn codex_server() -> Vec<String> {
    let mut args = vec!["app-server".to_owned()];
    for setting in [
        "features.shell_tool=false",
        "web_search='disabled'",
        "tools.web_search=false",
        "mcp_servers={}",
        "project_doc_max_bytes=0",
        "history.persistence='none'",
        "sandbox_mode='read-only'",
        "approval_policy='never'",
    ] {
        args.extend(["-c".to_owned(), setting.to_owned()]);
    }
    args
}

/// The parameters of `thread/start`: read-only, asking nobody, kept nowhere, its
/// instructions nib's, and for a mode `nib mcp` with the mode's tools. Sent on stdin, so
/// nothing in it is on a command line.
pub fn codex_thread(mode: Option<Mode>, model: Option<&str>, nib: &Path, folder: &Path) -> Value {
    let mut config = serde_json::Map::new();
    if let Some(mode) = mode {
        let (listed, left) = tools_of(mode);
        let key = |name: &str| format!("mcp_servers.{SERVER}.{name}");
        config.insert(key("command"), json!(nib));
        config.insert(key("args"), json!(["mcp"]));
        config.insert(key("env_vars"), json!([TOKEN_VAR]));
        config.insert(key("startup_timeout_sec"), json!(30));
        config.insert(key("tool_timeout_sec"), json!(180));
        if !left.is_empty() {
            config.insert(key("enabled_tools"), json!(listed));
        }
    }
    let mut params = json!({
        "cwd": folder,
        "sandbox": "read-only",
        "approvalPolicy": "never",
        "ephemeral": true,
        "baseInstructions": session_system(mode),
        "config": config,
    });
    if let Some(model) = model {
        params["model"] = json!(model);
    }
    params
}

/// What asks a program whether, and as whom, it is signed in: an answer it gives from
/// its own files, which nib never opens.
pub fn status(tool: Tool) -> &'static [&'static str] {
    match tool {
        Tool::ClaudeCode => &["auth", "status", "--json"],
        Tool::Codex => &["login", "status"],
    }
}

/// What lists Claude Code's flags.
pub const HELP: [&str; 1] = ["--help"];

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const CLAUDE_HELP: &str = "  --safe-mode   Start with all customizations disabled\n  \
        --no-session-persistence  Disable session persistence\n  \
        --permission-prompts <target>  Who answers\n  --input-format <format>\n  \
        --effort <level>\n  --restricted\n  --permission-mode <mode>";

    fn config() -> PathBuf {
        PathBuf::from("ai").join("nib-mcp.json")
    }

    fn value_of<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let at = args.iter().position(|one| one == flag)?;
        args.get(at + 1).map(String::as_str)
    }

    #[test]
    fn claude_runs_with_no_tools_no_servers_and_nib_s_prompt() {
        let args = ask(None, &Caps::default()).expect("args");
        assert_eq!(value_of(&args, "--tools"), Some(""));
        assert!(args.contains(&"--strict-mcp-config".to_owned()));
        assert!(args.contains(&"-p".to_owned()));
        assert!(!args.iter().any(|one| one == "--mcp-config"));
        assert!(!args.iter().any(|one| one.contains("skip-permissions")));
        assert_eq!(value_of(&args, "--system-prompt"), Some(SYSTEM));
    }

    #[test]
    fn every_fixed_argument_survives_cmd() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let mut all = ask(None, &caps).expect("args");
        all.extend(codex_server());
        all.extend(claude_listing(&caps));
        for mode in [None, Some(Mode::Ask), Some(Mode::Plan), Some(Mode::Agent)] {
            let shape = Shape {
                mode,
                model: Some("opus[1m]"),
                effort: Some(Effort::Xhigh),
            };
            all.extend(claude_session(shape, &caps, &config()).expect("session"));
        }
        for arg in all {
            assert!(
                !arg.contains(['"', '%', '\n', '\r', '^', '&', '|', '<', '>']),
                "{arg}"
            );
        }
    }

    #[test]
    fn optional_flags_only_where_the_help_names_them() {
        let bare = ask(None, &Caps::default()).expect("args");
        assert!(!bare.contains(&"--safe-mode".to_owned()));

        let caps = Caps::from_help(CLAUDE_HELP);
        let full = ask(None, &caps).expect("args");
        assert!(full.contains(&"--safe-mode".to_owned()));
        assert!(full.contains(&"--no-session-persistence".to_owned()));
        assert_eq!(value_of(&full, "--permission-prompts"), Some("none"));
    }

    #[test]
    fn a_session_lists_only_nib_and_only_its_mode_s_tools() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let shape = |mode| Shape {
            mode: Some(mode),
            ..Shape::default()
        };

        let ask = claude_session(shape(Mode::Ask), &caps, &config()).expect("ask");
        assert_eq!(value_of(&ask, "--tools"), Some(""));
        assert_eq!(
            value_of(&ask, "--mcp-config"),
            Some(config().to_string_lossy().as_ref())
        );
        let allowed = value_of(&ask, "--allowedTools").expect("allowed");
        assert!(allowed.contains("mcp__nib__read_note"));
        assert!(!allowed.contains("edit_note"));
        assert!(allowed.split(',').all(|one| one.starts_with("mcp__nib__")));
        let denied = value_of(&ask, "--disallowedTools").expect("denied");
        assert!(denied.contains("mcp__nib__edit_note"));
        assert!(denied.contains("mcp__nib__run_terminal"));
        assert!(!ask.contains(&"--safe-mode".to_owned()));
        assert!(ask.contains(&"--restricted".to_owned()));
        assert_eq!(value_of(&ask, "--permission-mode"), Some("dontAsk"));
        assert_eq!(value_of(&ask, "--input-format"), Some("stream-json"));

        let plan = claude_session(shape(Mode::Plan), &caps, &config()).expect("plan");
        let allowed = value_of(&plan, "--allowedTools").expect("allowed");
        assert!(allowed.contains("mcp__nib__create_note"));
        assert!(!allowed.contains("write_note"));

        let agent = claude_session(shape(Mode::Agent), &caps, &config()).expect("agent");
        assert_eq!(value_of(&agent, "--allowedTools"), Some("mcp__nib"));
        assert!(!agent.contains(&"--disallowedTools".to_owned()));

        let words = claude_session(Shape::default(), &caps, &config()).expect("words");
        assert!(!words.contains(&"--mcp-config".to_owned()));
        assert!(!words.contains(&"--allowedTools".to_owned()));
    }

    #[test]
    fn a_session_takes_its_model_and_effort_as_values() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let shape = Shape {
            mode: Some(Mode::Ask),
            model: Some("sonnet[1m]"),
            effort: Some(Effort::Max),
        };
        let args = claude_session(shape, &caps, &config()).expect("args");
        assert_eq!(value_of(&args, "--model"), Some("sonnet[1m]"));
        assert_eq!(value_of(&args, "--effort"), Some("max"));

        let off = Shape {
            effort: Some(Effort::Off),
            ..shape
        };
        assert!(claude_session(off, &caps, &config()).is_err());
        let older = Caps::from_help("--input-format");
        let args = claude_session(shape, &older, &config()).expect("args");
        assert!(!args.contains(&"--effort".to_owned()));
        assert!(claude_session(shape, &Caps::default(), &config()).is_err());
    }

    #[test]
    fn the_effort_scale_as_each_program_spells_it() {
        assert_eq!(Effort::Off.word(Tool::Codex), Ok("none"));
        assert_eq!(Effort::Xhigh.word(Tool::ClaudeCode), Ok("xhigh"));
        assert!(Effort::Minimal.word(Tool::ClaudeCode).is_err());
        let parsed: Effort = serde_json::from_str("\"xhigh\"").expect("effort");
        assert_eq!(parsed, Effort::Xhigh);
        assert!(serde_json::from_str::<Effort>("\"--max\"").is_err());
        assert!(serde_json::from_str::<Mode>("\"yolo\"").is_err());
    }

    #[test]
    fn codex_serves_read_only_asking_nobody_with_its_tools_off() {
        let args = codex_server();
        assert_eq!(args[0], "app-server");
        for setting in [
            "features.shell_tool=false",
            "mcp_servers={}",
            "sandbox_mode='read-only'",
            "approval_policy='never'",
            "project_doc_max_bytes=0",
        ] {
            assert!(args.contains(&setting.to_owned()), "{setting}");
        }
    }

    #[test]
    fn a_codex_thread_adds_nib_alone_with_its_mode_s_tools() {
        let nib = PathBuf::from("nib.exe");
        let folder = PathBuf::from("ai");
        let ask = codex_thread(Some(Mode::Ask), Some("gpt-5.1-codex"), &nib, &folder);
        assert_eq!(ask["sandbox"], "read-only");
        assert_eq!(ask["approvalPolicy"], "never");
        assert_eq!(ask["ephemeral"], true);
        assert_eq!(ask["model"], "gpt-5.1-codex");
        let config = &ask["config"];
        assert_eq!(config["mcp_servers.nib.args"], json!(["mcp"]));
        assert_eq!(config["mcp_servers.nib.env_vars"], json!([TOKEN_VAR]));
        let enabled = config["mcp_servers.nib.enabled_tools"]
            .as_array()
            .expect("enabled");
        assert!(enabled.contains(&json!("read_note")));
        assert!(!enabled.contains(&json!("edit_note")));
        assert!(config
            .as_object()
            .expect("config")
            .keys()
            .all(|key| key.starts_with("mcp_servers.nib.")));

        let agent = codex_thread(Some(Mode::Agent), None, &nib, &folder);
        assert!(agent["config"]["mcp_servers.nib.enabled_tools"].is_null());
        assert!(agent.get("model").is_none());
        let words = codex_thread(None, None, &nib, &folder);
        assert_eq!(words["config"], json!({}));
    }

    #[test]
    fn the_mcp_config_names_nib_alone_and_no_token() {
        let config = mcp_config(Path::new("nib.exe"));
        let servers = config["mcpServers"].as_object().expect("servers");
        assert_eq!(servers.len(), 1);
        assert_eq!(servers["nib"]["args"], json!(["mcp"]));
        assert!(servers["nib"].get("env").is_none());
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
            assert!(ask(Some(bad), &Caps::default()).is_err());
            let shape = Shape {
                model: Some(bad),
                ..Shape::default()
            };
            assert!(claude_session(shape, &Caps::from_help(CLAUDE_HELP), &config()).is_err());
        }
    }

    #[test]
    fn the_status_questions_are_the_programs_own() {
        assert_eq!(status(Tool::ClaudeCode), ["auth", "status", "--json"]);
        assert_eq!(status(Tool::Codex), ["login", "status"]);
    }
}
