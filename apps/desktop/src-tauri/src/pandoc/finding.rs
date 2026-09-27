//! Where pandoc is on a Mac.
//!
//! An app started from Finder or the Dock does not inherit the terminal's `PATH`:
//! launchd hands it `/usr/bin:/bin:/usr/sbin:/sbin`, and pandoc is never in any of
//! those. Homebrew puts it in `/opt/homebrew/bin` or `/usr/local/bin`, `MacPorts` in
//! `/opt/local/bin`, pandoc's own installer in `/usr/local/bin`, and a Haskell or
//! Nix setup somewhere of its own. So the same `pandoc` that works in a terminal
//! was "not installed" to the app, and the export list shrank to what needs none.
//!
//! The answer is Typora's and VS Code's: look in the places a package manager
//! puts it first, which is a handful of `stat` calls, and only when none of them
//! holds it ask the reader's own login shell, once per launch, which knows every
//! `PATH` line their shell files add. On the other platforms a launched app has
//! the `PATH` its user set, and none of this runs.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Where a package manager on a Mac puts the programs it installs, in the order
/// they are looked at: Homebrew on Apple silicon, then Homebrew on Intel and
/// pandoc's own installer, then `MacPorts`, then a Nix profile shared by the
/// machine.
const WELL_KNOWN: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/nix/var/nix/profiles/default/bin",
    "/run/current-system/sw/bin",
];

/// The same inside the reader's home: pip, pipx and a hand-built copy, then a
/// Haskell install, then a Nix profile of their own.
const IN_HOME: &[&str] = &[".local/bin", ".cabal/bin", ".ghcup/bin", ".nix-profile/bin"];

/// Every folder pandoc is looked for in: the `PATH` the app was started with
/// first, since that is where a terminal launch finds it, then the places above.
pub fn folders(path: Option<&OsStr>, home: Option<&Path>) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = path
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();

    found.extend(WELL_KNOWN.iter().map(PathBuf::from));
    if let Some(home) = home {
        found.extend(IN_HOME.iter().map(|inside| home.join(inside)));
    }

    found
}

/// The first `pandoc` among the folders that `runs` says is a program.
pub fn first_in(folders: &[PathBuf], runs: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    folders
        .iter()
        .map(|folder| folder.join("pandoc"))
        .find(|program| runs(program))
}

/// What a login shell said `command -v pandoc` was, out of everything it printed.
///
/// A shell started with `-i` reads the reader's shell files, and those can print
/// anything - a greeting, a theme's warning, a reminder to update - so only the
/// last line is the answer, and only if it is a path. `command -v` answers a bare
/// word for an alias or a function, which is nothing a program can be started with.
pub fn shell_answer(printed: &str) -> Option<PathBuf> {
    let last = printed
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())?;
    last.starts_with('/').then(|| PathBuf::from(last))
}

// A `PATH` is written with colons in every case below, which is a Mac's spelling and
// not Windows', where none of this runs.
#[cfg(all(test, unix))]
mod tests {
    use super::{first_in, folders, shell_answer};
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    #[test]
    fn looks_where_the_app_was_started_first_then_where_package_managers_put_it() {
        let found = folders(
            Some(OsStr::new("/usr/bin:/bin")),
            Some(Path::new("/Users/e")),
        );

        assert_eq!(found[0], PathBuf::from("/usr/bin"));
        assert_eq!(found[2], PathBuf::from("/opt/homebrew/bin"));
        assert!(found.contains(&PathBuf::from("/opt/local/bin")));
        assert!(found.contains(&PathBuf::from("/Users/e/.local/bin")));
    }

    #[test]
    fn still_looks_with_no_path_and_no_home() {
        let found = folders(None, None);
        assert_eq!(found[0], PathBuf::from("/opt/homebrew/bin"));
    }

    #[test]
    fn takes_the_first_folder_that_holds_a_program() {
        let found = folders(Some(OsStr::new("/usr/bin")), None);
        let held = first_in(&found, |program| program.starts_with("/usr/local"));

        assert_eq!(held, Some(PathBuf::from("/usr/local/bin/pandoc")));
        assert_eq!(first_in(&found, |_| false), None);
    }

    #[test]
    fn reads_the_last_line_a_login_shell_printed() {
        let printed = "Welcome back\n[oh-my-zsh] update available\n/opt/pandoc/bin/pandoc\n\n";
        assert_eq!(
            shell_answer(printed),
            Some(PathBuf::from("/opt/pandoc/bin/pandoc"))
        );
    }

    #[test]
    fn an_alias_or_nothing_is_no_answer() {
        assert_eq!(shell_answer("pandoc"), None);
        assert_eq!(shell_answer(""), None);
    }
}
