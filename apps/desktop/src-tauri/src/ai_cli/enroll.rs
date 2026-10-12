//! The agents on this computer, connected to nib with nothing to set up (docs/agent-native.md
//! 10, "Connected on their own").
//!
//! Emil, 2026-10-12: "[Claude Code] running on my machine should be able to connect to nib
//! without me having to set up anything." So the installed app adds itself to each agent
//! program it finds, the way the program itself adds a server - `claude mcp add --scope
//! user nib -- <nib> mcp`, `codex mcp add nib -- <nib> mcp` - which is the line Settings >
//! AI > Access offers to paste, run for the reader. The program writes its own config;
//! nib never opens it. Then the agent finds `nib mcp` in every folder it starts in, and
//! its first call is the pairing the reader allows once (mcp/pairing.rs).
//!
//! **Never over the reader's own.** A program that already has a server called `nib` -
//! added by hand, pointing anywhere - is left as it is. Turning it off in Access removes
//! the entry only where it names this app's own program.
//!
//! **Only the app somebody installed**: a release under the shipped identifier, not a
//! probe and not a development build, whose program would be a copy about to be deleted.
//! A test points it at homes of its own with `NIB_ENROLL_HOME`, and nothing else does;
//! the reader's `~/.claude.json` and `~/.codex` are never a test's.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::program::{self, Program};
use super::run::run_to_end;
use super::{Tool, TELLING};

/// The identifier of the app that ships.
const SHIPPED: &str = "ch.emilvinu.nib";

/// What the server is called in each program.
const NAME: &str = "nib";

/// A home of a test's own, where the programs' configs are read and written instead of
/// the reader's.
const TEST_HOME: &str = "NIB_ENROLL_HOME";

/// What the window's switch keeps: whether nib connects itself.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Kept {
    #[serde(default)]
    off: bool,
}

fn kept_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::paths::config_dir(app)?.join("enroll.json"))
}

fn is_on(app: &AppHandle) -> bool {
    kept_file(app)
        .ok()
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str::<Kept>(&text).ok())
        .is_none_or(|kept| !kept.off)
}

/// A test's home, where there is one.
fn test_home() -> Option<PathBuf> {
    std::env::var_os(TEST_HOME)
        .filter(|one| !one.is_empty())
        .map(PathBuf::from)
}

/// Whether this app may write itself into the programs' configs at all.
fn offered(app: &AppHandle) -> bool {
    test_home().is_some()
        || (!cfg!(debug_assertions)
            && app.config().identifier == SHIPPED
            && crate::placement::away().is_none())
}

/// The program's arguments for one of the three.
fn get_args() -> Vec<OsString> {
    ["mcp", "get", NAME].map(OsString::from).to_vec()
}

fn add_args(tool: Tool, nib: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = match tool {
        Tool::ClaudeCode => vec!["mcp", "add", "--scope", "user", NAME, "--"],
        Tool::Codex => vec!["mcp", "add", NAME, "--"],
    }
    .into_iter()
    .map(OsString::from)
    .collect();
    args.extend([nib.as_os_str().to_owned(), OsString::from("mcp")]);
    args
}

fn remove_args(tool: Tool) -> Vec<OsString> {
    match tool {
        Tool::ClaudeCode => vec!["mcp", "remove", "--scope", "user", NAME],
        Tool::Codex => vec!["mcp", "remove", NAME],
    }
    .into_iter()
    .map(OsString::from)
    .collect()
}

/// A program's command, in a test's home where there is one: every variable either
/// program reads its home from.
fn homed(program: &Program, args: &[OsString], folder: &Path, home: Option<&Path>) -> Command {
    let mut command = super::command(program, args, folder, None);
    if let Some(home) = home {
        command
            .env("HOME", home)
            .env("USERPROFILE", home)
            .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
            .env("CODEX_HOME", home.join(".codex"));
    }
    command
}

/// What a program says it has under nib's name: `None` for none, else what it said.
fn entry(program: &Program, folder: &Path, home: Option<&Path>) -> Option<String> {
    let said = run_to_end(homed(program, &get_args(), folder, home), TELLING).ok()?;
    (said.ended.code == Some(0)).then_some(said.out)
}

/// Adds nib to one program, where it has no server of that name.
pub fn enroll(program: &Program, tool: Tool, folder: &Path, nib: &Path, home: Option<&Path>) {
    if entry(program, folder, home).is_some() {
        return;
    }
    let _ = run_to_end(homed(program, &add_args(tool, nib), folder, home), TELLING);
}

/// Takes nib out of one program, where the entry names this app's own program.
pub fn unenroll(program: &Program, tool: Tool, folder: &Path, nib: &Path, home: Option<&Path>) {
    let ours = entry(program, folder, home)
        .is_some_and(|said| said.contains(nib.to_string_lossy().as_ref()));
    if ours {
        let _ = run_to_end(homed(program, &remove_args(tool), folder, home), TELLING);
    }
}

/// Every program found, with what to do to it, on a thread of its own: a launch never
/// waits on a program.
fn each(app: &AppHandle, act: fn(&Program, Tool, &Path, &Path, Option<&Path>)) {
    let Ok(folder) = super::workroom(app) else {
        return;
    };
    let Ok(nib) = crate::mcp::program::program() else {
        return;
    };
    let _ = std::thread::Builder::new()
        .name("agents enrolled".into())
        .spawn(move || {
            let home = test_home();
            for tool in [Tool::ClaudeCode, Tool::Codex] {
                if let Some(found) = program::find(tool) {
                    act(&found, tool, &folder, &nib, home.as_deref());
                }
            }
        });
}

/// After the window: nib added to every agent program on this computer, unless the reader
/// turned it off.
pub fn keep_enrolled(app: &AppHandle) {
    if offered(app) && is_on(app) {
        each(app, enroll);
    }
}

/// What the switch in Access shows.
#[derive(Serialize)]
pub struct Standing {
    offered: bool,
    on: bool,
}

pub fn standing(app: &AppHandle) -> Standing {
    Standing {
        offered: offered(app),
        on: is_on(app),
    }
}

/// The switch turned: kept, and every program connected or let go of now.
pub fn turned(app: &AppHandle, on: bool) -> Result<(), String> {
    let text = serde_json::to_string(&Kept { off: !on }).map_err(|error| error.to_string())?;
    let file = kept_file(app)?;
    if let Some(dir) = file.parent() {
        crate::paths::made(dir)?;
    }
    crate::paths::write_privately(&file, text.as_bytes())?;
    if offered(app) {
        each(app, if on { enroll } else { unenroll });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_program_is_added_the_way_it_adds_a_server_itself() {
        let nib = Path::new("C:/nib/nib.exe");
        let line = |args: Vec<OsString>| {
            args.iter()
                .map(|one| one.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert_eq!(
            line(add_args(Tool::ClaudeCode, nib)),
            "mcp add --scope user nib -- C:/nib/nib.exe mcp"
        );
        assert_eq!(
            line(add_args(Tool::Codex, nib)),
            "mcp add nib -- C:/nib/nib.exe mcp"
        );
        assert_eq!(
            line(remove_args(Tool::ClaudeCode)),
            "mcp remove --scope user nib"
        );
        assert_eq!(line(remove_args(Tool::Codex)), "mcp remove nib");
    }

    #[test]
    fn the_switch_is_on_unless_turned_off() {
        let read = |text: &str| serde_json::from_str::<Kept>(text).map(|kept| !kept.off);
        assert_eq!(read("{}").ok(), Some(true));
        assert_eq!(read(r#"{"off":true}"#).ok(), Some(false));
    }
}
