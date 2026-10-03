//! The plans a reader already pays for, spent through the programs their makers ship:
//! Claude Code and Codex, run headless on this machine, signed in by the reader through
//! the programs' own sign-in.
//!
//! **Why a program and not a login of nib's own.** Anthropic does not let an app sign
//! somebody in to Claude.ai, route requests through a Pro or Max plan's credentials, or
//! collect, store or pass on its tokens; what it does allow is a person running the
//! unmodified Claude Code they installed and signed in to themselves. So nib starts that
//! program, asks it a question, and reads the answer: it never opens `~/.claude` or
//! `~/.codex`, never reads a token, and learns whether somebody is signed in only by
//! asking the program (`claude auth status`, `codex login status`). See docs/ai.md,
//! which carries the policy's own words, and `lib/ai/local` in the app, which reads what
//! the programs say.
//!
//! **Two shapes.** A question (`ai_cli_ask`): Claude Code, words in, words out, ended.
//! And a session (`ai_cli_open`, `ai_cli_say`, `ai_cli_close`), the AI sidebar's thread
//! (docs/ai-sidebar.md 5.2): a Claude Code kept open for one thread, or a thread on the
//! window's one Codex app-server, whose only tool is `nib mcp` under the sidebar's own
//! grant. Codex answers every question this way, a question being a thread with no tool.
//!
//! **Who may.** The window's own document pages, as for a terminal: a web tab's page,
//! the presenter and anything a site could open are refused. And they name a tool, a
//! model, an effort, a mode and a thread, and send words - never a program, an argument,
//! a variable or a protocol message; see args.rs and say.rs.
//!
//! **The sidebar's token.** `nib mcp` proves itself with the token of the provider's
//! built-in grant ("nib · Claude Code" in Settings > Agents). A fresh one is issued the
//! first time a run of the app needs it, kept in memory only, and handed to the program
//! in its environment, which passes it to `nib mcp` (src/mcp/link.rs). Last run's is
//! worth nothing.
//!
//! **Nothing outlives its asking.** A question ends when it is stopped, when it has run
//! for `ASKING`, when its window is destroyed and when the app exits; a session when it is
//! closed, when nothing has been said for `IDLE` (the window then starts it again from
//! its own transcript), with its window and with the app. Each ends with every process it
//! started; see family.rs.
//!
//! | file | what it owns |
//! | --- | --- |
//! | `args` | the command line each run starts with, and how a Codex thread is set up |
//! | `say` | what the window may say to a session, and what comes back |
//! | `session` | a Claude Code session: what is said, written as stream-json |
//! | `codex_app` | the window's Codex app-server: the JSON-RPC client, its threads |
//! | `program` | where each program is, and the `PATH` it runs with |
//! | `family` | a program and everything it starts, ended together |
//! | `run` | one run: stdin in, lines out, its end |

mod args;
mod codex_app;
mod family;
mod program;
mod run;
mod say;
mod session;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

pub use args::Tool;
use args::{Effort, Mode, Shape};
use codex_app::Host;
use program::Program;
use run::{Heard, Running, Said};
use say::{Message, Say};
use session::Claude;

/// Whether this build offers Claude Code at all. Anthropic's terms for running Claude
/// Code inside a product ask the product's maker to accept its Commercial Terms; a build
/// made with `NIB_CLAUDE_CODE=off` leaves the choice out, here and in the pane (see
/// `__CLAUDE_CODE__` in vite.config.ts).
fn claude_code_offered() -> bool {
    !matches!(option_env!("NIB_CLAUDE_CODE"), Some("off" | "0" | "false"))
}

/// How long one question may take, thinking included, before it is ended.
const ASKING: Duration = Duration::from_secs(300);

/// How long a session may sit with nothing said by either side before it is ended. The
/// window starts it again from its own transcript at the next message.
const IDLE: Duration = Duration::from_secs(600);

/// How long a program may take to say whether it is signed in, what flags it has or
/// which models it offers: a cold start of Node on a slow disk, and a token it may
/// refresh on the way.
const TELLING: Duration = Duration::from_secs(30);

/// Every question and every session running, by the name the window gave it, and the
/// app-servers the windows' Codex threads are on.
#[derive(Default)]
pub struct Asks {
    running: Mutex<HashMap<String, Held>>,
    sessions: Mutex<HashMap<String, Session>>,
    hosts: Mutex<HashMap<HostKey, Arc<Host>>>,
}

struct Held {
    owner: String,
    running: Running,
}

/// One open session.
struct Session {
    owner: String,
    /// Which opening of this name it is, so the end of an earlier one, heard late,
    /// takes nothing of a later one's.
    opening: u64,
    on: On,
}

enum On {
    Claude(Claude),
    Codex(Arc<Host>),
}

/// An app-server: the window's, and for threads with tools, the provider whose token it
/// was started with. A question's threads are on one with no token at all.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct HostKey {
    owner: String,
    agent: Option<String>,
}

fn lock<T>(held: &Mutex<T>) -> MutexGuard<'_, T> {
    held.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Asks {
    /// Stops every run and session one window owns, or every one for `None`.
    fn stop_where(&self, owner: Option<&str>) {
        let mine = |one: &str| owner.is_none_or(|owner| one == owner);
        for held in lock(&self.running).values() {
            if mine(&held.owner) {
                held.running.stop();
            }
        }
        let sessions: Vec<Session> = {
            let mut sessions = lock(&self.sessions);
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, session)| mine(&session.owner))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        for session in sessions {
            if let On::Claude(claude) = session.on {
                claude.stop();
            }
        }
        let hosts: Vec<Arc<Host>> = {
            let mut hosts = lock(&self.hosts);
            let keys: Vec<HostKey> = hosts.keys().filter(|key| mine(&key.owner)).cloned().collect();
            keys.iter().filter_map(|key| hosts.remove(key)).collect()
        };
        for host in hosts {
            host.stop();
        }
    }
}

/// A window has gone, and its questions and sessions with it.
pub fn window_gone(app: &AppHandle, label: &str) {
    if let Some(asks) = app.try_state::<Asks>() {
        asks.stop_where(Some(label));
    }
}

/// The app is ending: every program it started goes.
pub fn end_all(app: &AppHandle) {
    if let Some(asks) = app.try_state::<Asks>() {
        asks.stop_where(None);
    }
}

/// The window this call came from, when it is one of ours; see the top of this file.
fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("not a window of this app".to_owned())
    }
}

/// A name the window may give a run, a session or a provider: short, letters, digits,
/// `-` and `_`.
fn usable(id: &str) -> Result<(), String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    fits.then_some(())
        .ok_or_else(|| "not a question's name".to_owned())
}

/// Refuses Claude Code in a build that leaves it out.
fn offered(tool: Tool) -> Result<(), String> {
    if tool == Tool::ClaudeCode && !claude_code_offered() {
        return Err("not in this build".to_owned());
    }
    Ok(())
}

/// A program's command, started in `folder` with its own `PATH`.
fn command(program: &Program, args: &[impl AsRef<std::ffi::OsStr>], folder: &Path) -> Command {
    let mut command = Command::new(&program.exe);
    command
        .args(args)
        .current_dir(folder)
        .env("PATH", &program.path);
    command
}

/// Where a program runs: a folder of the app's own, empty, so nothing it might look
/// around in is the reader's. Never a space.
fn workroom(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("ai");
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder)
}

/// Claude Code's optional flags, read off its help once per program per run of the app;
/// see args.rs.
fn caps_of(program: &Program, folder: &Path) -> args::Caps {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, args::Caps>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(caps) = lock(known).get(&program.exe).cloned() {
        return caps;
    }

    let help = run::run_to_end(command(program, &args::HELP, folder), TELLING)
        .map(|said| format!("{}\n{}", said.out, said.ended.err))
        .unwrap_or_default();
    let caps = args::Caps::from_help(&help);
    lock(known).insert(program.exe.clone(), caps.clone());
    caps
}

/// What a program said when asked whether it is signed in, and where it is.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The program, for the line a terminal types to sign in with it.
    program: String,
    #[serde(flatten)]
    said: Said,
}

/// Whether a tool is installed and signed in, asked of the tool itself. `None` where it
/// is not installed. The app reads the answer; see `lib/ai/local/status.svelte.ts`.
#[tauri::command(async)]
pub fn ai_cli_status(webview: Webview, tool: Tool) -> Result<Option<Status>, String> {
    owner(&webview)?;
    offered(tool)?;
    let Some(program) = program::find(tool) else {
        return Ok(None);
    };
    let folder = workroom(webview.app_handle())?;
    let said = run::run_to_end(command(&program, args::status(tool), &folder), TELLING)
        .map_err(|error| error.to_string())?;
    Ok(Some(Status {
        program: program.exe.to_string_lossy().into_owned(),
        said,
    }))
}

/// A message on a channel, as JSON.
fn sent(output: &Channel<Value>, message: Message) {
    if let Ok(value) = serde_json::to_value(message) {
        let _ = output.send(value);
    }
}

/// Asks Claude Code one question, with `prompt` on its stdin, and streams what it prints
/// to `output`. `model` empty or `None` is its own default. Answers once the program has
/// started; everything after that, its end included, arrives on the channel. Codex is
/// asked through a session (`ai_cli_open` with no mode).
#[tauri::command(async)]
pub fn ai_cli_ask(
    webview: Webview,
    id: String,
    tool: Tool,
    model: Option<String>,
    prompt: String,
    output: Channel<Value>,
) -> Result<(), String> {
    let owner = owner(&webview)?;
    usable(&id)?;
    offered(tool)?;
    if tool != Tool::ClaudeCode {
        return Err("asked through a session".to_owned());
    }
    let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
    let app = webview.app_handle().clone();
    let folder = workroom(&app)?;
    let model = model.filter(|one| !one.trim().is_empty());
    let args = args::ask(model.as_deref(), &caps_of(&program, &folder))?;

    let asks = webview.state::<Asks>();
    // Held across the start, so a program that ends at once cannot take its entry out
    // before it is put in.
    let mut running = lock(&asks.running);
    if running.contains_key(&id) {
        return Err(format!("{id} is already being asked"));
    }

    let name = id.clone();
    let started = run::start(
        command(&program, &args, &folder),
        prompt.into_bytes(),
        ASKING,
        move |heard| {
            let message = match heard {
                Heard::Line(line) => Message::Line { line },
                Heard::End(ended) => {
                    if let Some(asks) = app.try_state::<Asks>() {
                        lock(&asks.running).remove(&name);
                    }
                    Message::End(ended)
                }
            };
            sent(&output, message);
        },
    )
    .map_err(|error| format!("{} could not be started: {error}", tool.command()))?;

    running.insert(
        id,
        Held {
            owner,
            running: started,
        },
    );
    Ok(())
}

/// Stops a question: the program and everything it started. What it said before stays
/// said; the channel's end says `stopped`.
#[tauri::command]
pub fn ai_cli_stop(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    if let Some(held) = lock(&webview.state::<Asks>().running).get(&id) {
        if held.owner == owner {
            held.running.stop();
        }
    }
    Ok(())
}

/// The provider a session's tools are asked as: its id and name in Settings > AI.
#[derive(Debug, Deserialize)]
pub struct Agent {
    id: String,
    name: String,
}

/// The built-in grant's id for a provider, as the API loop names it too (`ai_agent.rs`).
fn grant_id(agent: &Agent) -> Result<String, String> {
    usable(&agent.id)?;
    Ok(format!("nib-{}", agent.id))
}

/// The provider's built-in grant's token for this run of the app: made with the grant
/// the first time, issued afresh the first time a run asks, kept in memory only.
fn token_for(app: &AppHandle, agent: &Agent) -> Result<String, String> {
    static ISSUED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let issued = ISSUED.get_or_init(Mutex::default);
    let id = grant_id(agent)?;
    let mut held = lock(issued);
    if let Some(token) = held.get(&id) {
        return Ok(token.clone());
    }
    let grants = &crate::agents::state(app).grants;
    let token = if grants.by_id(app, &id).is_some() {
        grants.reissue(app, &id)?
    } else {
        let client = format!("nib · {}", agent.name.trim());
        let made = id.clone();
        grants
            .mint(app, &client, move |_, client| {
                crate::agents::grants::Grant::own(made, client)
            })?
            .1
    };
    held.insert(id, token.clone());
    Ok(token)
}

/// Which opening of a session this is; see `Session::opening`.
fn next_opening() -> u64 {
    static OPENINGS: AtomicU64 = AtomicU64::new(1);
    OPENINGS.fetch_add(1, Ordering::SeqCst)
}

/// Where a session's messages go: the window's channel, and on the end the session let
/// go of, if it is still this opening.
fn session_output(app: &AppHandle, id: &str, opening: u64, output: Channel<Value>) -> codex_app::Output {
    let app = app.clone();
    let id = id.to_owned();
    Arc::new(move |message: Message| {
        if matches!(message, Message::End(_)) {
            // On a thread of its own: the end can be heard while the session is still
            // being opened, under the lock this takes, and under a Codex host's own.
            let app = app.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                if let Some(asks) = app.try_state::<Asks>() {
                    let mut sessions = lock(&asks.sessions);
                    if sessions.get(&id).is_some_and(|one| one.opening == opening) {
                        sessions.remove(&id);
                    }
                }
            });
        }
        sent(&output, message);
    })
}

/// How a session is to start: what the window names, and nothing else.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opening {
    tool: Tool,
    agent: Agent,
    /// `None`: words only, no tool.
    #[serde(default)]
    mode: Option<Mode>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<Effort>,
    /// A Codex thread to start as a copy of another open session's.
    #[serde(default)]
    fork_of: Option<String>,
}

/// Opens a session named `id`: a Claude Code of its own, or a thread on the window's
/// Codex app-server. Answers once it is started; what it says, and its end, arrive on
/// `output`. Then `ai_cli_say` talks to it and `ai_cli_close` ends it.
#[tauri::command(async)]
pub fn ai_cli_open(
    webview: Webview,
    id: String,
    opening: Opening,
    output: Channel<Value>,
) -> Result<(), String> {
    let owner = owner(&webview)?;
    usable(&id)?;
    offered(opening.tool)?;
    let tool = opening.tool;
    let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
    let app = webview.app_handle().clone();
    let folder = workroom(&app)?;
    let model = opening.model.as_deref().filter(|one| !one.trim().is_empty());
    let model = args::checked_model(model)?;
    let token = match opening.mode {
        Some(_) => Some(token_for(&app, &opening.agent)?),
        None => None,
    };

    let asks = webview.state::<Asks>();
    let mut sessions = lock(&asks.sessions);
    if sessions.contains_key(&id) {
        return Err(format!("{id} is already open"));
    }
    let number = next_opening();
    let output = session_output(&app, &id, number, output);

    let on = match tool {
        Tool::ClaudeCode => {
            let caps = caps_of(&program, &folder);
            let config = folder.join("nib-mcp.json");
            if opening.mode.is_some() {
                let nib = crate::mcp::program::program()?;
                std::fs::write(&config, args::mcp_config(&nib).to_string())
                    .map_err(|error| error.to_string())?;
            }
            let shape = Shape {
                mode: opening.mode,
                model,
                effort: opening.effort,
            };
            let mut command = command(&program, &args::claude_session(shape, &caps, &config)?, &folder);
            command.envs(args::CLAUDE_SESSION_ENV);
            if let Some(token) = &token {
                command.env(args::TOKEN_VAR, token);
            }
            let output = Arc::clone(&output);
            let claude = Claude::start(command, IDLE, move |message| output(message))
                .map_err(|error| format!("{} could not be started: {error}", tool.command()))?;
            On::Claude(claude)
        }
        Tool::Codex => {
            let key = HostKey {
                owner: owner.clone(),
                agent: token.as_ref().map(|_| opening.agent.id.clone()),
            };
            let host = host_for(&asks, key, &program, &folder, token.as_deref())?;
            let fork_of = opening.fork_of.as_deref();
            host.open(&id, output, opening.mode, model, opening.effort, fork_of)?;
            On::Codex(host)
        }
    };
    sessions.insert(
        id,
        Session {
            owner,
            opening: number,
            on,
        },
    );
    Ok(())
}

/// The window's app-server for `key`, started now if it has none running.
fn host_for(
    asks: &Asks,
    key: HostKey,
    program: &Program,
    folder: &Path,
    token: Option<&str>,
) -> Result<Arc<Host>, String> {
    let mut hosts = lock(&asks.hosts);
    if let Some(host) = hosts.get(&key).filter(|host| host.alive()) {
        return Ok(Arc::clone(host));
    }
    let mut command = command(program, &args::codex_server(), folder);
    if let Some(token) = token {
        command.env(args::TOKEN_VAR, token);
    }
    let nib = crate::mcp::program::program()?;
    let host = Host::start(command, IDLE, nib, folder.to_path_buf())
        .map_err(|error| format!("codex could not be started: {error}"))?;
    let host = Arc::new(host);
    hosts.insert(key, Arc::clone(&host));
    Ok(host)
}

/// Says something to an open session; see say.rs for what may be said.
#[tauri::command]
pub fn ai_cli_say(webview: Webview, id: String, say: Value) -> Result<(), String> {
    let owner = owner(&webview)?;
    let say = serde_json::from_value::<Say>(say)
        .map_err(|error| error.to_string())?
        .checked()?;
    let asks = webview.state::<Asks>();
    let sessions = lock(&asks.sessions);
    let session = sessions
        .get(&id)
        .filter(|one| one.owner == owner)
        .ok_or_else(|| format!("{id} is not open"))?;
    match &session.on {
        On::Claude(claude) => claude.say(&say),
        On::Codex(host) => host.say(&id, say),
    }
}

/// Ends a session. What it said stays said; the channel's end says `stopped`.
#[tauri::command]
pub fn ai_cli_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let asks = webview.state::<Asks>();
    let session = {
        let mut sessions = lock(&asks.sessions);
        if sessions.get(&id).is_none_or(|one| one.owner != owner) {
            return Ok(());
        }
        sessions.remove(&id)
    };
    match session.map(|one| one.on) {
        Some(On::Claude(claude)) => claude.stop(),
        Some(On::Codex(host)) => host.close(&id),
        None => {}
    }
    Ok(())
}

/// The models a program offers, as it lists them: Claude Code's `list_models`, Codex's
/// `model/list`. The window reads them into its model list (`lib/ai/local/models.ts`).
#[tauri::command(async)]
pub fn ai_cli_models(webview: Webview, tool: Tool) -> Result<Value, String> {
    let owner = owner(&webview)?;
    offered(tool)?;
    let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
    let folder = workroom(webview.app_handle())?;
    match tool {
        Tool::ClaudeCode => {
            let caps = caps_of(&program, &folder);
            let claude = Claude::start(
                command(&program, &args::claude_listing(&caps), &folder),
                TELLING,
                |_| {},
            )
            .map_err(|error| error.to_string())?;
            let listed = claude.ask(serde_json::json!({ "subtype": "list_models" }), TELLING);
            // Asked nothing else, it ends on its own; the idle time ends it otherwise.
            claude.close_input();
            listed
        }
        Tool::Codex => {
            let asks = webview.state::<Asks>();
            let key = HostKey { owner, agent: None };
            host_for(&asks, key, &program, &folder, None)?.models(TELLING)
        }
    }
}


#[cfg(test)]
mod tests {
    use super::run::{run_to_end, start, Ended, Heard};
    use super::say::GoalSay;
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::Instant;

    /// The stand-in for both programs, which Node runs; see scripts/fake-ai-cli.mjs.
    /// Found upwards from the crate, because this file is compiled by two of them: the
    /// app's, and the Chromium build's one folder further down (cef/Cargo.toml).
    fn fake_script() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|folder| folder.join("scripts").join("fake-ai-cli.mjs"))
            .find(|script| script.is_file())
            .expect("scripts/fake-ai-cli.mjs above the crate")
    }

    /// Whether Node is here to run it. CI's Rust job sets it up; a machine without it
    /// says so rather than failing a test about something else.
    fn node() -> bool {
        Command::new("node").arg("--version").output().is_ok()
    }

    fn fake(tool: Tool, mode: &str, args: &[impl AsRef<std::ffi::OsStr>]) -> Command {
        let mut command = Command::new("node");
        command
            .arg(fake_script())
            .arg(tool.command())
            .args(args)
            .env("FAKE_AI_CLI_MODE", mode)
            .env_remove(args::TOKEN_VAR);
        command
    }

    /// Everything a run says, until its end.
    fn heard_all(command: Command, input: &str, timeout: Duration) -> (Vec<String>, Ended) {
        let (sent, heard) = mpsc::channel();
        start(command, input.as_bytes().to_vec(), timeout, move |one| {
            let _ = sent.send(one);
        })
        .expect("started");
        let mut lines = Vec::new();
        for one in heard {
            match one {
                Heard::Line(line) => lines.push(line),
                Heard::End(ended) => return (lines, ended),
            }
        }
        panic!("no end was heard");
    }

    fn full_caps() -> args::Caps {
        let said =
            run_to_end(fake(Tool::ClaudeCode, "answer", &["--help"]), TELLING).expect("help");
        args::Caps::from_help(&said.out)
    }

    #[test]
    fn claude_code_answers_line_by_line_with_the_question_on_stdin() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let args = args::ask(None, &full_caps()).expect("args");
        let (lines, ended) = heard_all(
            fake(Tool::ClaudeCode, "answer", &args),
            "the rules\n\nwhat is a heron",
            TELLING,
        );

        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(!ended.stopped && !ended.timed_out);
        assert!(lines[0].contains("\"subtype\":\"init\""));
        assert!(lines
            .iter()
            .any(|line| line.contains("content_block_delta")));
        assert!(lines
            .last()
            .is_some_and(|line| line.contains("what is a heron")));
    }

    #[test]
    fn a_question_without_the_policy_flags_is_refused_by_the_stand_in() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let (_, ended) = heard_all(fake(Tool::ClaudeCode, "answer", &["-p"]), "hi", TELLING);
        assert_eq!(ended.code, Some(2));
        assert!(ended.err.contains("asked with tools"));
    }

    /// Whether a process is still running, asked of the system by its number.
    fn alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            let listed = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .expect("tasklist");
            String::from_utf8_lossy(&listed.stdout).contains(&pid.to_string())
        }
        #[cfg(unix)]
        {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .is_ok_and(|status| status.success())
        }
    }

    fn pids_in(file: &Path) -> Vec<u32> {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            if let Ok(text) = std::fs::read_to_string(file) {
                let pids: Vec<u32> = text
                    .split_whitespace()
                    .filter_map(|one| one.parse().ok())
                    .collect();
                if pids.len() == 2 {
                    return pids;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("the stand-in never said who it started");
    }

    fn gone_soon(pid: u32) -> bool {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(10) {
            if !alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn a_stop_ends_the_program_and_everything_it_started() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let args = args::ask(None, &args::Caps::default()).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);

        let (sent, heard) = mpsc::channel();
        let running = start(command, b"hold on".to_vec(), TELLING, move |one| {
            let _ = sent.send(one);
        })
        .expect("started");

        let family = pids_in(&pids);
        assert!(family.iter().all(|&pid| alive(pid)));
        running.stop();

        let ended = heard
            .iter()
            .find_map(|one| match one {
                Heard::End(ended) => Some(ended),
                Heard::Line(_) => None,
            })
            .expect("an end");
        assert!(ended.stopped);
        for pid in family {
            assert!(gone_soon(pid), "{pid} outlived the stop");
        }
    }

    #[test]
    fn a_run_past_its_time_is_ended_with_its_family() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let args = args::ask(None, &args::Caps::default()).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);

        let (_, ended) = heard_all(command, "hold on", Duration::from_secs(3));
        assert!(ended.timed_out);
        assert!(!ended.stopped);
        for pid in pids_in(&pids) {
            assert!(gone_soon(pid), "{pid} outlived the timeout");
        }
    }

    #[test]
    fn the_status_question_is_answered_whole() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let claude = run_to_end(
            fake(Tool::ClaudeCode, "answer", args::status(Tool::ClaudeCode)),
            TELLING,
        )
        .expect("status");
        assert_eq!(claude.ended.code, Some(0));
        assert!(claude.out.contains("\"loggedIn\": true"));

        let codex = run_to_end(
            fake(Tool::Codex, "signed-out", args::status(Tool::Codex)),
            TELLING,
        )
        .expect("status");
        assert_eq!(codex.ended.code, Some(1));
        assert!(codex.ended.err.contains("Not logged in"));
    }

    /// Messages off a session until one matches, or a panic after `patience`.
    fn until(
        heard: &Receiver<Message>,
        patience: Duration,
        mut matches: impl FnMut(&Message) -> bool,
    ) -> Vec<Message> {
        let started = Instant::now();
        let mut seen = Vec::new();
        while let Some(left) = patience.checked_sub(started.elapsed()) {
            let Ok(message) = heard.recv_timeout(left) else {
                break;
            };
            let done = matches(&message);
            seen.push(message);
            if done {
                return seen;
            }
        }
        panic!("not heard in time; heard {seen:#?}");
    }

    fn line_has(message: &Message, words: &str) -> bool {
        matches!(message, Message::Line { line } if line.contains(words))
    }

    fn reply_to(message: &Message, to: &str) -> bool {
        matches!(message, Message::Reply { to: said, .. } if said == to)
    }

    fn result_of<'a>(messages: &'a [Message], to: &str) -> &'a Value {
        messages
            .iter()
            .find_map(|one| match one {
                Message::Reply {
                    to: said, result, ..
                } if said == to => Some(result),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no reply to {to} in {messages:#?}"))
    }

    fn turn(text: &str) -> Say {
        Say::Turn {
            text: text.to_owned(),
            images: Vec::new(),
        }
    }

    fn claude_session(mode: &str, shape: Shape, folder: &Path) -> (Claude, Receiver<Message>) {
        let config = folder.join("nib-mcp.json");
        std::fs::write(&config, args::mcp_config(Path::new("nib.exe")).to_string())
            .expect("config");
        let args = args::claude_session(shape, &full_caps(), &config).expect("args");
        let mut command = fake(Tool::ClaudeCode, mode, &args);
        command.envs(args::CLAUDE_SESSION_ENV);
        if shape.mode.is_some() {
            command.env(args::TOKEN_VAR, "abc123");
        }
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(command, IDLE, move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        (claude, heard)
    }

    #[test]
    fn a_claude_code_session_answers_turn_after_turn_and_is_told_what_to_use() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let shape = Shape {
            mode: Some(Mode::Ask),
            model: Some("opus"),
            effort: Some(Effort::High),
        };
        let (claude, heard) = claude_session("answer", shape, dir.path());

        claude.say(&turn("what is a heron")).expect("said");
        let first = until(&heard, TELLING, |one| line_has(one, "\"type\":\"result\""));
        let init = first
            .iter()
            .find(|one| line_has(one, "\"subtype\":\"init\""))
            .expect("init");
        // The stand-in says what it was started with: nib alone, its token, the mode's
        // tools, the model and the effort.
        for told in [
            "\"mcp_servers\":[{\"name\":\"nib\",\"status\":\"connected\"}]",
            "\"token\":true",
            "mcp__nib__read_note",
            "\"model\":\"opus\"",
            "\"effort\":\"high\"",
        ] {
            assert!(line_has(init, told), "{told} not in {init:?}");
        }
        assert!(!line_has(init, "mcp__nib__edit_note"));
        assert!(first
            .iter()
            .any(|one| line_has(one, "You asked: what is a heron")));

        claude.say(&Say::Context).expect("said");
        let context = until(&heard, TELLING, |one| reply_to(one, "context"));
        assert_eq!(result_of(&context, "context")["maxTokens"], 200_000);

        claude
            .say(&Say::Model {
                model: "sonnet".into(),
            })
            .expect("said");
        until(&heard, TELLING, |one| reply_to(one, "model"));
        claude
            .say(&Say::Effort {
                effort: Some(Effort::Max),
            })
            .expect("said");
        claude
            .say(&turn("/clear and then a second one"))
            .expect("said");
        let second = until(&heard, TELLING, |one| {
            line_has(one, "\"type\":\"result\"") && !line_has(one, "effort")
        });
        assert!(second.iter().any(|one| line_has(one, "effort set to max")));
        assert!(second
            .iter()
            .any(|one| line_has(one, "You asked: /clear and then a second one")));
        assert!(second
            .iter()
            .any(|one| line_has(one, "\"model\":\"sonnet\"")));

        claude.stop();
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.stopped));
    }

    #[test]
    fn a_session_stopped_mid_turn_is_interrupted_and_keeps_its_words() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let (claude, heard) = claude_session("slow", Shape::default(), dir.path());
        claude.say(&turn("a long answer please")).expect("said");
        until(&heard, TELLING, |one| line_has(one, "text_delta"));
        claude.say(&Say::Interrupt).expect("said");
        let rest = until(&heard, TELLING, |one| line_has(one, "\"type\":\"result\""));
        assert!(rest
            .iter()
            .any(|one| line_has(one, "error_during_execution")));
        claude.close_input();
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.code == Some(0)));
    }

    #[test]
    fn a_session_nobody_talks_to_is_ended_with_its_family() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let config = dir.path().join("nib-mcp.json");
        let args = args::claude_session(Shape::default(), &full_caps(), &config).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(command, Duration::from_secs(2), move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        claude.say(&turn("hold on")).expect("said");
        let family = pids_in(&pids);
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(
            matches!(end.last(), Some(Message::End(ended)) if ended.timed_out && !ended.stopped)
        );
        for pid in family {
            assert!(gone_soon(pid), "{pid} outlived the idle end");
        }
    }

    fn codex_host(mode: &str, token: bool, folder: &Path) -> Host {
        let mut command = fake(Tool::Codex, mode, &args::codex_server());
        if token {
            command.env(args::TOKEN_VAR, "abc123");
        }
        Host::start(command, IDLE, PathBuf::from("nib.exe"), folder.to_path_buf())
            .expect("started")
    }

    fn route() -> (codex_app::Output, Receiver<Message>) {
        let (sent, heard) = mpsc::channel();
        let sent = Mutex::new(sent);
        let output: codex_app::Output = Arc::new(move |message| {
            let _ = lock(&sent).send(message);
        });
        (output, heard)
    }

    #[test]
    fn codex_threads_share_the_app_server_and_stream_their_turns() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("answer", true, dir.path());
        let (one, first) = route();
        let (two, second) = route();
        host.open(
            "one",
            one,
            Some(Mode::Ask),
            Some("gpt-fake"),
            Some(Effort::Xhigh),
            None,
        )
        .expect("opened");
        host.open("two", two, Some(Mode::Agent), None, None, None)
            .expect("opened");

        // Said before the thread is there: held, then sent.
        host.say("one", turn("what is a heron")).expect("said");
        let heard = until(&first, TELLING, |one| line_has(one, "turn/completed"));
        let told = &result_of(&heard, "thread")["told"];
        assert!(told["enabled_tools"]
            .as_array()
            .is_some_and(|tools| tools.contains(&serde_json::json!("read_note"))));
        let asked = &result_of(&heard, "turn")["told"];
        assert_eq!(asked["model"], "gpt-fake");
        assert_eq!(asked["effort"], "xhigh");
        assert!(heard
            .iter()
            .any(|one| line_has(one, "item/agentMessage/delta")));
        assert!(heard
            .iter()
            .any(|one| line_has(one, "thread/tokenUsage/updated")));
        assert!(heard
            .iter()
            .any(|one| line_has(one, "You asked: what is a heron")));

        // The other thread heard none of it but what is about no thread.
        let others: Vec<Message> = second.try_iter().collect();
        assert!(others.iter().all(|one| !line_has(one, "agentMessage")));

        host.say(
            "one",
            Say::Goal {
                goal: GoalSay::Set {
                    objective: "file the inbox".into(),
                    budget: Some(1000),
                },
            },
        )
        .expect("said");
        until(&first, TELLING, |one| reply_to(one, "goal"));
        host.say(
            "one",
            Say::Compact {
                focus: String::new(),
            },
        )
        .expect("said");
        until(&first, TELLING, |one| reply_to(one, "compact"));

        let models = host.models(TELLING).expect("models");
        assert!(models["data"][0]["supportedReasoningEfforts"].is_array());

        host.close("one");
        let end = until(&first, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.stopped));
        assert!(host.say("one", Say::Interrupt).is_err());
        assert!(host.alive());
        host.stop();
        until(&second, TELLING, |one| matches!(one, Message::End(_)));
    }

    #[test]
    fn codex_is_steered_and_stopped_mid_turn() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("slow", false, dir.path());
        let (output, heard) = route();
        host.open("t", output, None, None, None, None)
            .expect("opened");
        host.say("t", turn("a long answer")).expect("said");
        until(&heard, TELLING, |one| {
            line_has(one, "item/agentMessage/delta")
        });
        host.say(
            "t",
            Say::Steer {
                text: "shorter".into(),
            },
        )
        .expect("steered");
        until(&heard, TELLING, |one| reply_to(one, "steer"));
        host.say("t", Say::Interrupt).expect("stopped");
        let rest = until(&heard, TELLING, |one| line_has(one, "turn/completed"));
        assert!(rest.iter().any(|one| line_has(one, "\"interrupted\"")));
        host.stop();
    }

    #[test]
    fn codex_s_requests_for_approval_are_declined() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("approval", false, dir.path());
        let (output, heard) = route();
        host.open("t", output, None, None, None, None)
            .expect("opened");
        host.say("t", turn("run something")).expect("said");
        // The stand-in ends the turn only once answered, and says what the answer was.
        let heard = until(&heard, TELLING, |one| line_has(one, "turn/completed"));
        assert!(heard.iter().any(|one| line_has(one, "requestApproval")));
        assert!(heard.iter().any(|one| line_has(one, "answered decline")));
        host.stop();
    }

    #[test]
    fn a_thread_with_tools_on_a_host_with_no_token_is_refused_by_the_stand_in() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("answer", false, dir.path());
        let (output, heard) = route();
        host.open("t", output, Some(Mode::Agent), None, None, None)
            .expect("opened");
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.err.contains("token")));
        host.stop();
    }

    /// No argument a session starts with comes from the window but what it names: two
    /// openings that differ only in their model and effort differ only there.
    #[test]
    fn nothing_on_the_command_line_comes_from_the_window_but_what_it_names() {
        let caps = args::Caps::from_help(
            "--input-format --effort --restricted --permission-mode --permission-prompts \
             --no-session-persistence --safe-mode",
        );
        let config = PathBuf::from("ai").join("nib-mcp.json");
        let one = Shape {
            mode: Some(Mode::Agent),
            model: Some("opus"),
            effort: Some(Effort::Low),
        };
        let two = Shape {
            model: Some("sonnet[1m]"),
            effort: Some(Effort::Max),
            ..one
        };
        let first = args::claude_session(one, &caps, &config).expect("one");
        let second = args::claude_session(two, &caps, &config).expect("two");
        assert_eq!(first.len(), second.len());
        let differ: Vec<(&str, &str)> = first
            .iter()
            .zip(&second)
            .filter(|(a, b)| a != b)
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        assert_eq!(differ, [("opus", "sonnet[1m]"), ("low", "max")]);
        // And a Codex command line takes nothing from the window at all: its model,
        // effort and mode go in typed requests on stdin.
        assert!(args::codex_server()
            .iter()
            .all(|arg| arg == "app-server" || arg == "-c" || arg.contains('=')));
    }

    /// An npm install on Windows is a `.cmd` file, and everything on the command line
    /// goes through `cmd.exe`: the empty `--tools` value, the system prompt and the TOML
    /// overrides have to arrive as they were sent.
    #[cfg(windows)]
    #[test]
    fn every_argument_survives_an_npm_shim() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let shim = |name: &str, tool: &str| {
            let shim = dir.path().join(name);
            std::fs::write(
                &shim,
                format!("@node \"{}\" {tool} %*\r\n", fake_script().display()),
            )
            .expect("the shim");
            Program {
                exe: shim,
                path: std::env::var_os("PATH").unwrap_or_default(),
            }
        };

        let program = shim("claude.cmd", "claude");
        let args = args::ask(Some("opus"), &args::Caps::default()).expect("args");
        let (lines, ended) =
            heard_all(command(&program, &args, dir.path()), "through cmd", TELLING);
        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(lines[0].contains("opus[1m]"));

        let program = shim("codex.cmd", "codex");
        let mut command = command(&program, &args::codex_server(), dir.path());
        command.env("FAKE_AI_CLI_MODE", "answer");
        let host = Host::start(
            command,
            IDLE,
            PathBuf::from("nib.exe"),
            dir.path().to_path_buf(),
        )
        .expect("started");
        assert!(host.models(TELLING).is_ok());
        host.stop();
    }

    /// The reader's own Claude Code, asked "say ok" with the arguments nib uses and no
    /// tool, once as a question and twice in one session - only where it is installed
    /// and already signed in, and never signing anything in or out. Run by hand:
    /// `cargo test real_claude -- --ignored --nocapture`.
    #[test]
    #[ignore = "asks the real Claude Code on this machine, which spends a little of a plan"]
    fn real_claude_says_ok() {
        let Some(program) = program::find(Tool::ClaudeCode) else {
            eprintln!("no Claude Code here; skipped");
            return;
        };
        let dir = tempfile::tempdir().expect("a folder");
        let status = run_to_end(
            command(&program, args::status(Tool::ClaudeCode), dir.path()),
            TELLING,
        )
        .expect("status");
        if !status.out.contains("\"loggedIn\": true") {
            eprintln!("Claude Code is not signed in; skipped");
            return;
        }
        let caps = caps_of(&program, dir.path());
        let args = args::ask(None, &caps).expect("args");
        let (lines, ended) = heard_all(command(&program, &args, dir.path()), "say ok", ASKING);
        eprintln!("{} lines, ended {ended:?}", lines.len());
        assert_eq!(ended.code, Some(0), "{}", ended.err);
        let result = lines
            .iter()
            .find(|line| line.contains("\"type\":\"result\""))
            .expect("a result");
        assert!(result.contains("\"is_error\":false"), "{result}");
        assert!(result.to_lowercase().contains("ok"), "{result}");
        let init = lines
            .iter()
            .find(|line| line.contains("\"subtype\":\"init\""))
            .expect("init");
        assert!(init.contains("\"tools\":[]"), "{init}");
        assert!(init.contains("\"mcp_servers\":[]"), "{init}");

        let shape = Shape {
            model: Some("haiku"),
            effort: Some(Effort::Low),
            ..Shape::default()
        };
        let config = dir.path().join("nib-mcp.json");
        let args = args::claude_session(shape, &caps, &config).expect("args");
        let mut session = command(&program, &args, dir.path());
        session.envs(args::CLAUDE_SESSION_ENV);
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(session, IDLE, move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        for _ in 0..2 {
            claude.say(&turn("say ok")).expect("said");
            let said = until(&heard, ASKING, |one| line_has(one, "\"type\":\"result\""));
            assert!(
                said.iter().any(|one| line_has(one, "\"is_error\":false")),
                "{said:#?}"
            );
            assert!(said.iter().any(|one| line_has(one, "\"tools\":[]")));
        }
        claude.say(&Say::Context).expect("said");
        let context = until(&heard, ASKING, |one| reply_to(one, "context"));
        assert!(result_of(&context, "context")["maxTokens"].is_number());
        let models = claude.ask(serde_json::json!({ "subtype": "list_models" }), TELLING);
        assert!(models.is_ok_and(|models| models["models"].is_array()));
        claude.stop();
    }
}
