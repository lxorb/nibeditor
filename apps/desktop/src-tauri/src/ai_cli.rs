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
//! **Who may.** The window's own document pages, as for a terminal: a web tab's page,
//! the presenter and anything a site could open are refused. And they name a tool, a
//! model and a question - never a program, an argument or a variable; see args.rs.
//!
//! **Nothing outlives its asking.** A run ends when it is stopped, when it has run for
//! `ASKING`, when its window is destroyed and when the app exits, and it ends with every
//! process it started; see family.rs. A page that reloads mid-answer leaves the run to
//! finish or time out with nobody reading it, since the page-load hook is the terminal's.
//!
//! | file | what it owns |
//! | --- | --- |
//! | `args` | the command line each question and each status question runs with |
//! | `program` | where each program is, and the `PATH` it runs with |
//! | `family` | a program and everything it starts, ended together |
//! | `run` | one run: stdin in, lines out, its end |

mod args;
mod family;
mod program;
mod run;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

pub use args::Tool;
use program::Program;
use run::{Ended, Heard, Running, Said};

/// Whether this build offers Claude Code at all. Anthropic's terms for running Claude
/// Code inside a product ask the product's maker to accept its Commercial Terms; a build
/// made with `NIB_CLAUDE_CODE=off` leaves the choice out, here and in the pane (see
/// `__CLAUDE_CODE__` in vite.config.ts).
fn claude_code_offered() -> bool {
    !matches!(option_env!("NIB_CLAUDE_CODE"), Some("off" | "0" | "false"))
}

/// How long one question may take, thinking included, before it is ended.
const ASKING: Duration = Duration::from_secs(300);

/// How long a program may take to say whether it is signed in, or what flags it has: a
/// cold start of Node on a slow disk, and a token it may refresh on the way.
const TELLING: Duration = Duration::from_secs(30);

/// Every question running, by the name the window gave it.
#[derive(Default)]
pub struct Asks {
    running: Mutex<HashMap<String, Held>>,
}

struct Held {
    owner: String,
    running: Running,
}

impl Asks {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Stops every run one window owns, or every run for `None`.
    fn stop_where(&self, owner: Option<&str>) {
        for held in self.lock().values() {
            if owner.is_none_or(|owner| held.owner == owner) {
                held.running.stop();
            }
        }
    }
}

/// A window has gone, and its questions with it.
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

/// A name the window may give a run: short, letters, digits, `-` and `_`.
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

/// The optional flags a program has, read off its help once per program per run of the
/// app; see args.rs.
fn caps_of(tool: Tool, program: &Program, folder: &Path) -> args::Caps {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, args::Caps>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    let cached = known
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&program.exe)
        .cloned();
    if let Some(caps) = cached {
        return caps;
    }

    let help = run::run_to_end(command(program, args::help(tool), folder), TELLING)
        .map(|said| format!("{}\n{}", said.out, said.ended.err))
        .unwrap_or_default();
    let caps = args::Caps::from_help(&help);
    known
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(program.exe.clone(), caps.clone());
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

/// What a question's channel carries: each line the program printed, then its end.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Message {
    Line { line: String },
    End(Ended),
}

/// Asks a tool one question, with `prompt` on its stdin, and streams what it prints to
/// `output`. `model` empty or `None` is the tool's own default. Answers once the program
/// has started; everything after that, its end included, arrives on the channel.
#[tauri::command(async)]
pub fn ai_cli_ask(
    webview: Webview,
    id: String,
    tool: Tool,
    model: Option<String>,
    prompt: String,
    output: Channel<serde_json::Value>,
) -> Result<(), String> {
    let owner = owner(&webview)?;
    usable(&id)?;
    offered(tool)?;
    let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
    let app = webview.app_handle().clone();
    let folder = workroom(&app)?;
    let model = model.filter(|one| !one.trim().is_empty());
    let args = args::ask(tool, model.as_deref(), &caps_of(tool, &program, &folder))?;

    let asks = webview.state::<Asks>();
    // Held across the start, so a program that ends at once cannot take its entry out
    // before it is put in.
    let mut running = asks.lock();
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
                        asks.lock().remove(&name);
                    }
                    Message::End(ended)
                }
            };
            if let Ok(value) = serde_json::to_value(message) {
                let _ = output.send(value);
            }
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
    if let Some(held) = webview.state::<Asks>().lock().get(&id) {
        if held.owner == owner {
            held.running.stop();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run::{run_to_end, start, Heard};
    use super::*;
    use std::sync::mpsc;
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
            .env("FAKE_AI_CLI_MODE", mode);
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

    fn full_caps(tool: Tool) -> args::Caps {
        let said = run_to_end(fake(tool, "answer", &["--help"]), TELLING).expect("help");
        args::Caps::from_help(&said.out)
    }

    #[test]
    fn claude_code_answers_line_by_line_with_the_question_on_stdin() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let args = args::ask(Tool::ClaudeCode, None, &full_caps(Tool::ClaudeCode)).expect("args");
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
    fn codex_answers_read_only_with_the_question_on_stdin() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let caps = args::Caps::from_help("--ephemeral --ignore-user-config");
        let args = args::ask(Tool::Codex, Some("gpt-fake"), &caps).expect("args");
        let (lines, ended) = heard_all(fake(Tool::Codex, "answer", &args), "a question", TELLING);

        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(lines
            .iter()
            .any(|line| line.contains("You asked: a question")));
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
        let args = args::ask(Tool::ClaudeCode, None, &args::Caps::default()).expect("args");
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
        let args = args::ask(Tool::Codex, None, &args::Caps::default()).expect("args");
        let mut command = fake(Tool::Codex, "hang", &args);
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
        let shim = dir.path().join("claude.cmd");
        std::fs::write(
            &shim,
            format!("@node \"{}\" claude %*\r\n", fake_script().display()),
        )
        .expect("the shim");

        let program = Program {
            exe: shim,
            path: std::env::var_os("PATH").unwrap_or_default(),
        };
        let args = args::ask(Tool::ClaudeCode, Some("opus"), &args::Caps::default()).expect("args");
        let (lines, ended) =
            heard_all(command(&program, &args, dir.path()), "through cmd", TELLING);
        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(lines[0].contains("opus[1m]"));
    }

    /// The reader's own Claude Code, asked "say ok" with the arguments nib uses - only
    /// where it is installed and already signed in, and never signing anything in or out.
    /// Run by hand: `cargo test real_claude -- --ignored --nocapture`.
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
        let caps = caps_of(Tool::ClaudeCode, &program, dir.path());
        let args = args::ask(Tool::ClaudeCode, None, &caps).expect("args");
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
    }
}
