//! Where Claude Code and Codex are on this machine, and the `PATH` they run with.
//!
//! The same program that answers in a terminal has to be found by an app nobody started
//! from one, and that is where the other apps that do this lose people: an npm install
//! under nvm, Volta or mise is on the terminal's `PATH` and on no app's, a Mac app opened
//! from the Dock gets launchd's four folders, and the native installers put the program
//! in `~/.local/bin`, which is added to a `PATH` at the next login. So a program is
//! looked for, in order:
//!
//! 1. on the `PATH` the app was started with, which is where a terminal finds it;
//! 2. where the installers put it: `~/.local/bin` (Claude Code's own installer on every
//!    system), npm's global folder, Homebrew, Bun, Volta and mise;
//! 3. on a Mac and on Linux, on the `PATH` the reader's own login shell builds, asked
//!    once per run of the app - VS Code's and Typora's answer to the same question.
//!
//! And the program is started with a `PATH` that has its own folder in front: an npm
//! install is a script that starts `node`, which lives beside it under nvm or mise.
//!
//! `NIB_AI_CLAUDE_CODE` and `NIB_AI_CODEX` name a program outright, for a probe that runs
//! a stand-in rather than the reader's own; see scripts/fake-ai-cli.mjs.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use super::args::Tool;

/// A program, found, and the `PATH` it is started with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    /// The file to start.
    pub exe: PathBuf,
    /// The `PATH` it gets.
    pub path: OsString,
}

/// The file names a tool may have: an executable of its own, or npm's `.cmd` on Windows.
fn names(tool: Tool) -> Vec<String> {
    let command = tool.command();
    if cfg!(windows) {
        vec![format!("{command}.exe"), format!("{command}.cmd")]
    } else {
        vec![command.to_owned()]
    }
}

/// The folders installers put these programs in, inside the reader's home and outside it,
/// in the order they are looked at after the `PATH`.
pub fn installed_in(home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(home) = home {
        found.push(home.join(".local").join("bin"));
    }
    if cfg!(windows) {
        if let Some(appdata) = appdata {
            found.push(appdata.join("npm"));
        }
        return found;
    }
    found.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    if let Some(home) = home {
        for inside in [
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".local/share/mise/shims",
        ] {
            found.push(home.join(inside));
        }
    }
    found
}

/// The first of `names` in the first of `folders` that holds one, as `is_file` answers.
pub fn first_in(
    folders: &[PathBuf],
    names: &[String],
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    folders
        .iter()
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| is_file(candidate))
}

/// A `PATH` with `folder` in front of `path`.
pub fn with_first(folder: Option<&Path>, path: &OsStr) -> OsString {
    let mut folders: Vec<PathBuf> = folder.map(Path::to_path_buf).into_iter().collect();
    folders.extend(std::env::split_paths(path));
    std::env::join_paths(folders).unwrap_or_else(|_| path.to_owned())
}

/// Where a tool is, or `None` where it is not installed.
pub fn find(tool: Tool) -> Option<Program> {
    let path = search_path();
    let exe = named_outright(tool).or_else(|| {
        let home = dirs::home_dir();
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
        let mut folders: Vec<PathBuf> = std::env::split_paths(&path).collect();
        folders.extend(installed_in(home.as_deref(), appdata.as_deref()));
        first_in(&folders, &names(tool), Path::is_file)
    })?;
    let path = with_first(exe.parent(), &path);
    Some(Program { exe, path })
}

/// The program a probe named in the environment, where it named one that exists.
fn named_outright(tool: Tool) -> Option<PathBuf> {
    let name = match tool {
        Tool::ClaudeCode => "NIB_AI_CLAUDE_CODE",
        Tool::Codex => "NIB_AI_CODEX",
    };
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

/// The `PATH` to look on and to start with: the app's own, and on a Mac and Linux the
/// login shell's after it.
fn search_path() -> OsString {
    let own = std::env::var_os("PATH").unwrap_or_default();
    #[cfg(unix)]
    if let Some(shell) = login_path() {
        let mut both: Vec<PathBuf> = std::env::split_paths(&own).collect();
        both.extend(std::env::split_paths(shell));
        if let Ok(joined) = std::env::join_paths(both) {
            return joined;
        }
    }
    own
}

/// What a login shell's `PATH` is, asked once per run of the app.
#[cfg(unix)]
fn login_path() -> Option<&'static OsStr> {
    static ASKED: std::sync::OnceLock<Option<OsString>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell).as_deref()
}

/// The line a login shell prints its `PATH` on, told apart from whatever its files print
/// on the way in - a greeting, a theme's warning - by a mark of its own.
#[cfg(any(unix, test))]
const MARK: &str = "__nib_path__=";

/// The `PATH` out of everything a login shell printed.
#[cfg(any(unix, test))]
pub fn marked_path(printed: &str) -> Option<&str> {
    printed
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(MARK))
        .filter(|path| !path.is_empty())
}

/// Asks `$SHELL -ilc`, interactive as well as a login because a `PATH` line in
/// `.bashrc` or `.zshrc` is read only by an interactive shell. Five seconds, and nothing
/// where a shell file waits for input or takes longer.
#[cfg(unix)]
fn ask_login_shell() -> Option<OsString> {
    use std::io::Read as _;
    use std::os::unix::ffi::OsStringExt as _;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let shell = std::env::var_os("SHELL")?;
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '\\n{MARK}%s\\n' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let reading = std::thread::spawn(move || {
        let mut printed = Vec::new();
        let _ = out.read_to_end(&mut printed);
        printed
    });

    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if child.try_wait().ok().flatten().is_some() {
            let printed = String::from_utf8_lossy(&reading.join().ok()?).into_owned();
            return marked_path(&printed).map(|path| OsString::from_vec(path.as_bytes().to_vec()));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_path_first_then_where_installers_put_it() {
        let home = Path::new("/home/e");
        let found = installed_in(Some(home), Some(Path::new("/roaming")));
        assert_eq!(found[0], home.join(".local").join("bin"));
        if cfg!(windows) {
            assert_eq!(found[1], Path::new("/roaming").join("npm"));
        } else {
            assert!(found.contains(&PathBuf::from("/opt/homebrew/bin")));
            assert!(found.contains(&home.join(".local/share/mise/shims")));
        }
    }

    #[test]
    fn the_first_folder_that_holds_one_wins_and_an_exe_before_npm_s_cmd() {
        let folders = [PathBuf::from("a"), PathBuf::from("b")];
        let names = names(Tool::ClaudeCode);
        let held = |path: &Path| path.starts_with("b");
        assert_eq!(
            first_in(&folders, &names, held),
            Some(PathBuf::from("b").join(&names[0]))
        );
        assert_eq!(first_in(&folders, &names, |_| false), None);
        if cfg!(windows) {
            assert_eq!(names, ["claude.exe", "claude.cmd"]);
        }
    }

    #[test]
    fn the_program_s_own_folder_goes_first_on_its_path() {
        let path = std::env::join_paths([PathBuf::from("x"), PathBuf::from("y")]).expect("joined");
        let joined = with_first(Some(Path::new("here")), &path);
        let folders: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            folders,
            [
                PathBuf::from("here"),
                PathBuf::from("x"),
                PathBuf::from("y")
            ]
        );
    }

    #[test]
    fn the_login_shell_s_path_is_the_marked_line() {
        let printed = "Welcome\n[oh-my-zsh] update\n\n__nib_path__=/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(marked_path(printed), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(marked_path("no mark here"), None);
        assert_eq!(marked_path("__nib_path__=\n"), None);
    }
}
