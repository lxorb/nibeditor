//! The program an agent's client runs as `nib mcp`: this binary, where it is installed.
//! The settings pane asks for it to write the line a reader pastes into their client
//! (`src/lib/agents/mcp.ts`), the app writes it into the clients it finds itself
//! (`ai_cli/enroll.rs`), and `nib mcp` starts the app with it when nib is closed. So it
//! has to be a path that is still there tomorrow, and on Linux the running binary is
//! not always one.
//!
//! **An `AppImage`** runs from a folder mounted for that run alone, gone once it ends:
//! the program to name is the `AppImage` itself, which its runtime says in `APPIMAGE`.
//!
//! **Nix** runs it out of `/nix/store/<hash>-orden-<version>`, a folder the next update
//! replaces and the garbage collector then deletes, and through a wrapper that sets the
//! libraries' paths, so the binary itself is `.nib-wrapped` beside the wrapper. The
//! program to name is the one on the path outside the store that leads to this same
//! copy - a NixOS system's `/run/current-system/sw/bin/orden`, a profile's
//! `~/.nix-profile/bin/orden` - which every update moves along with it. Run with
//! `nix run`, there is none, and the wrapper beside the binary is the answer.

use std::path::{Component, Path, PathBuf};

/// Where Nix keeps every package.
const STORE: &str = "/nix/store";

/// The names this program has on a path.
const NAMES: [&str; 2] = ["orden", "nib"];

/// This program's path, as a client should run it.
pub fn program() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("this program cannot find itself: {error}"))?;
    if !cfg!(target_os = "linux") {
        return Ok(exe);
    }
    let path: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    Ok(chosen(
        &exe,
        std::env::var_os("APPIMAGE").map(PathBuf::from),
        &path,
        |candidate| std::fs::canonicalize(candidate).ok(),
    ))
}

/// The path to name for the binary at `exe`: the `AppImage`, a name on the path that leads
/// to this copy in the Nix store, the wrapper beside a wrapped binary, or `exe` itself.
fn chosen(
    exe: &Path,
    appimage: Option<PathBuf>,
    path: &[PathBuf],
    resolve: impl Fn(&Path) -> Option<PathBuf>,
) -> PathBuf {
    if let Some(image) = appimage.filter(|one| one.has_root()) {
        return image;
    }
    let Some(copy) = store_copy(exe) else {
        return exe.to_owned();
    };
    let lasting = path
        .iter()
        .filter(|folder| folder.has_root() && !folder.starts_with(STORE))
        .flat_map(|folder| NAMES.map(|name| folder.join(name)))
        .find(|candidate| resolve(candidate).is_some_and(|target| target.starts_with(&copy)));
    lasting.unwrap_or_else(|| unwrapped(exe))
}

/// The package folder in the Nix store a path is inside, `/nix/store/<hash>-<name>`.
fn store_copy(exe: &Path) -> Option<PathBuf> {
    let inside = exe.strip_prefix(STORE).ok()?;
    let Some(Component::Normal(package)) = inside.components().next() else {
        return None;
    };
    Some(Path::new(STORE).join(package))
}

/// The wrapper Nix's `wrapProgram` leaves beside a binary it renamed `.<name>-wrapped`,
/// which is what sets the libraries' paths; any other binary as it is.
fn unwrapped(exe: &Path) -> PathBuf {
    exe.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix('.')?.strip_suffix("-wrapped"))
        .map_or_else(|| exe.to_owned(), |name| exe.with_file_name(name))
}

/// Whether `command`, a program an agent's client was told to run, is a copy of this
/// app that is not this one any more: a Nix store path an update has replaced, an
/// `AppImage`'s mount gone with its run, or an `AppImage` of an earlier release. A
/// program by any other name is somebody else's.
pub fn older_copy(command: &str, now: &Path) -> bool {
    let command = command.trim().trim_matches(|c| c == '"' || c == '\'');
    let path = Path::new(command);
    if path == now || command.is_empty() {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let ours = |name: &str| NAMES.contains(&name) || name == ".nib-wrapped";
    if let Some(copy) = store_copy(path) {
        let package = copy
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let named = package
            .split_once('-')
            .is_some_and(|(_, rest)| rest.starts_with("orden-") || rest.starts_with("nib-"));
        return named && ours(name);
    }
    if command.starts_with("/tmp/.mount_") {
        return command.ends_with("/usr/bin/nib");
    }
    let lower = name.to_ascii_lowercase();
    lower.strip_suffix(".appimage").is_some_and(|stem| {
        ["orden", "nibeditor", "nib"].iter().any(|product| {
            stem.strip_prefix(product)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(['-', '_', '.']))
        })
    })
}

/// The program a client's own description of a server names: the line `claude mcp get`
/// and `codex mcp get` both write as `Command: <program>`.
pub fn command_in(said: &str) -> Option<&str> {
    said.lines().find_map(|line| {
        let line = line.trim();
        let (label, rest) = line.split_once(':')?;
        label
            .eq_ignore_ascii_case("command")
            .then_some(rest.trim())
            .filter(|rest| !rest.is_empty())
    })
}

/// The program the settings pane's copy line names, for the reader to paste into an
/// agent's client: `claude mcp add --scope user nib -- "<this>" mcp`.
#[tauri::command]
pub fn mcp_program(webview: tauri::Webview) -> Result<String, String> {
    crate::agents::from_the_app(&webview)?;
    program().map(|path| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_is_this_one() {
        let found = program().expect("a path");
        assert!(found.is_absolute());
        if !cfg!(target_os = "linux") {
            assert_eq!(found, std::env::current_exe().expect("this test"));
        }
    }

    const NOW: &str = "/nix/store/aaa-orden-0.15.0/bin/.nib-wrapped";

    /// What a NixOS system's links lead to: its own path into this copy, and a profile's
    /// into another.
    fn links(candidate: &Path) -> Option<PathBuf> {
        match candidate.to_str()?.replace('\\', "/").as_str() {
            "/run/current-system/sw/bin/orden" => {
                Some(PathBuf::from("/nix/store/aaa-orden-0.15.0/bin/nib"))
            }
            "/home/e/.nix-profile/bin/nib" => {
                Some(PathBuf::from("/nix/store/zzz-orden-0.14.0/bin/nib"))
            }
            "/usr/bin/nib" => Some(PathBuf::from("/usr/bin/nib")),
            _ => None,
        }
    }

    #[test]
    fn an_appimage_is_named_and_never_its_mount() {
        let mount = Path::new("/tmp/.mount_OrdenX1/usr/bin/nib");
        let image = PathBuf::from("/home/e/Apps/Orden-0.15.0-linux-x64.AppImage");
        assert_eq!(chosen(mount, Some(image.clone()), &[], links), image);
        assert_eq!(
            chosen(mount, Some(PathBuf::from("Orden.AppImage")), &[], links),
            mount
        );
    }

    #[test]
    fn a_nix_copy_is_named_by_the_path_that_leads_to_it() {
        let path = [
            PathBuf::from("/home/e/.nix-profile/bin"),
            PathBuf::from("/nix/store/aaa-orden-0.15.0/bin"),
            PathBuf::from("/run/current-system/sw/bin"),
        ];
        assert_eq!(
            chosen(Path::new(NOW), None, &path, links),
            PathBuf::from("/run/current-system/sw/bin/orden")
        );
        // `nix run`: nothing on the path leads here, so the wrapper beside the binary.
        assert_eq!(
            chosen(Path::new(NOW), None, &path[..2], links),
            PathBuf::from("/nix/store/aaa-orden-0.15.0/bin/nib")
        );
    }

    #[test]
    fn a_package_s_binary_is_named_as_it_is() {
        let deb = Path::new("/usr/bin/nib");
        assert_eq!(chosen(deb, None, &[PathBuf::from("/usr/bin")], links), deb);
    }

    #[test]
    fn an_older_copy_of_this_app_is_known_and_nothing_else_is() {
        let now = Path::new("/run/current-system/sw/bin/orden");
        for older in [
            "/nix/store/zzz-orden-0.14.0/bin/.nib-wrapped",
            "/nix/store/yyy-nib-0.13.1/bin/nib",
            "/tmp/.mount_NibAbCd/usr/bin/nib",
            "/home/e/Apps/Nib-0.13.1-linux-x64.AppImage",
            "\"/home/e/Apps/Orden.AppImage\"",
            "/opt/nibeditor_0.12.AppImage",
        ] {
            assert!(older_copy(older, now), "{older}");
        }
        for theirs in [
            "/run/current-system/sw/bin/orden",
            "/nix/store/xxx-nodejs-22/bin/node",
            "/nix/store/xxx-nibbler-1.0/bin/nib",
            "/usr/bin/python3",
            "/home/e/Apps/Nibbles.AppImage",
            "/tmp/.mount_Other/usr/bin/other",
            "",
        ] {
            assert!(!older_copy(theirs, now), "{theirs}");
        }
    }

    #[test]
    fn the_command_is_read_off_either_client_s_description() {
        let claude =
            "orden:\n  Scope: User config\n  Type: stdio\n  Command: /usr/bin/nib\n  Args: mcp\n";
        assert_eq!(command_in(claude), Some("/usr/bin/nib"));
        let codex = "orden\n  enabled: true\n  transport: stdio\n  command: /nix/store/a-orden-1/bin/nib\n  args: mcp\n";
        assert_eq!(command_in(codex), Some("/nix/store/a-orden-1/bin/nib"));
        assert_eq!(command_in("nothing here"), None);
    }
}
