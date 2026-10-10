//! A picture pasted into a remote terminal, carried to its host.
//!
//! A coding agent pastes a picture by reading the clipboard itself - Claude Code's Alt+V
//! on Windows and Ctrl+V elsewhere - and on the host that is the host's clipboard, which
//! is empty. So the window carries the picture over and pastes its path there, which the
//! agent takes as an image the way it takes one dragged onto a terminal (issue 228; see
//! `lib/terminal/images.ts` and docs/terminal.md).
//!
//! **The tab's own way there.** The same host's id, so the same `ssh` and the same
//! arguments the tab connects with (`remote::reach`), in a connection of its own beside
//! the tab's: the tab's carries a person's typing to a shell and has no room for a file.
//! In `BatchMode`, so a key, the agent or a connection `ssh` already shares
//! (`ControlMaster`) is enough, and a host that would ask for a password refuses at once
//! rather than waiting on a prompt nobody sees. The window names the host, the kind of
//! picture and its bytes and nothing else: the file's name and the line the host runs
//! are made here.
//!
//! **Where it goes.** The host user's own cache, `~/.cache/nib/images` (or under
//! `$XDG_CACHE_HOME`), made private, in `sh` whatever the login shell is; the host says
//! the file's path back on its output, which is what is pasted.

use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::Webview;

/// The kinds of picture a paste carries, and the end of each one's file name: what a
/// coding agent reads as an image from a path. The online terminal's `IMAGE_KINDS`.
const KINDS: [(&str, &str); 4] = [
    ("png", "png"),
    ("jpeg", "jpg"),
    ("gif", "gif"),
    ("webp", "webp"),
];

/// The largest picture a paste carries: the online terminal's `MOST_IMAGE`.
const MOST_BYTES: usize = 16 * 1024 * 1024;

/// What `ssh` is told besides the tab's own arguments: no prompt, no terminal, a host
/// that does not answer given up on in seconds rather than minutes, and a connection that
/// dies on the way found out in fifteen.
const OPTIONS: [&str; 9] = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=3",
];

/// The end of a picture's file name by its kind, or None for a kind no agent reads.
fn end_of(kind: &str) -> Option<&'static str> {
    KINDS
        .iter()
        .find(|(one, _)| *one == kind)
        .map(|(_, end)| *end)
}

/// A fresh name for a picture: `nib-`, sixteen random hex digits and its end, so it is
/// never a path and never a word a shell reads twice.
fn fresh_name(end: &str) -> Result<String, String> {
    use std::fmt::Write as _;

    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let mut name = String::from("nib-");
    for byte in random {
        let _ = write!(name, "{byte:02x}");
    }
    Ok(format!("{name}.{end}"))
}

/// What the host runs: its user's cache folder made, private, the bytes from standard
/// input into `name` there, and the file's path said back. One word for the login shell,
/// in single quotes, which `bash`, `zsh`, `fish` and `tcsh` all read as it is.
fn script(name: &str) -> String {
    format!(
        "sh -c 'd=\"${{XDG_CACHE_HOME:-$HOME/.cache}}/nib/images\"; umask 077; \
         mkdir -p \"$d\" && cat > \"$d/{name}\" && printf %s \"$d/{name}\"'"
    )
}

/// `ssh` run with `args`, the picture on its standard input; the path the host said.
fn carried(program: &Path, args: &[String], bytes: Vec<u8>) -> Result<String, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // `CREATE_NO_WINDOW`: a console program started by a GUI app gets a console window of
    // its own otherwise, which would flash up in front of everything.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);

    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start ssh: {error}"))?;
    if let Some(mut input) = child.stdin.take() {
        // On a thread of its own: `ssh` reads it while the host answers, and a picture
        // larger than the pipe would otherwise wait on output nobody is reading yet.
        std::thread::spawn(move || {
            let _ = input.write_all(&bytes);
        });
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("ssh did not finish: {error}"))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() && path.starts_with('/') {
        Ok(path)
    } else {
        let said = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "the host did not take the picture: {}",
            said.trim()
        ))
    }
}

/// A picture pasted into the remote terminal of the host `host` names, written to a file
/// on that host; answers the file's path there. See the top of this file.
#[tauri::command(async)]
pub fn remote_image(
    webview: Webview,
    host: String,
    kind: String,
    base64: String,
) -> Result<String, String> {
    super::owner(&webview)?;
    let end = end_of(&kind).ok_or_else(|| format!("{kind} is not a picture an agent reads"))?;
    if base64.len() > MOST_BYTES.div_ceil(3) * 4 {
        return Err("the picture is larger than a paste carries".to_owned());
    }
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|error| format!("the picture is not base64: {error}"))?;

    let (program, reach) = super::remote::reach(&webview, &host)?;
    let mut args = Vec::from(OPTIONS.map(String::from));
    args.extend(reach);
    args.push(script(&fresh_name(end)?));
    carried(&program, &args, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_pictures_an_agent_reads_are_carried() {
        assert_eq!(end_of("png"), Some("png"));
        assert_eq!(end_of("jpeg"), Some("jpg"));
        assert_eq!(end_of("svg"), None);
        assert_eq!(end_of("../x"), None);
    }

    #[test]
    fn a_name_is_never_a_path_or_a_word_a_shell_reads_twice() {
        let name = fresh_name("png").expect("a name");
        let plain = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.';
        assert_eq!(name.len(), "nib-".len() + 16 + ".png".len());
        assert!(name.bytes().all(plain));
        assert_ne!(name, fresh_name("png").expect("another"));
    }

    #[test]
    fn the_host_runs_one_quoted_word_and_says_the_path_back() {
        let line = script("nib-0011223344556677.png");
        assert!(line.starts_with("sh -c '") && line.ends_with('\''));
        // One word for the login shell: no single quote inside it.
        assert_eq!(line.matches('\'').count(), 2);
        assert!(line.contains("cat > \"$d/nib-0011223344556677.png\""));
        assert!(line.contains("printf %s \"$d/nib-0011223344556677.png\""));
    }

    #[test]
    fn the_options_go_before_the_hosts_own_arguments() {
        assert_eq!(OPTIONS[0], "-T");
        assert!(OPTIONS.contains(&"BatchMode=yes"));
        assert!(!OPTIONS.contains(&"--"));
    }

    #[cfg(unix)]
    #[test]
    fn the_path_the_host_said_is_the_answer_and_a_refusal_is_an_error() {
        let sh = Path::new("/bin/sh");
        let run = |line: &str| vec!["-c".to_owned(), line.to_owned()];

        let took = carried(sh, &run("cat >/dev/null; echo /a.png"), vec![1]);
        assert_eq!(took, Ok("/a.png".to_owned()));

        let refused = carried(sh, &run("echo Permission denied >&2; exit 255"), vec![1]);
        let said = refused.expect_err("refused");
        assert!(said.contains("Permission denied"));
    }
}
