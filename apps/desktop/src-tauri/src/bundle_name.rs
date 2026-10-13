//! The Mac app's folder under the product's name: `Orden.app`, where every copy up to
//! 0.11 was `Nib.app` and every copy from 0.12 to 0.13 `nibeditor.app`.
//!
//! Tauri's updater puts a new version into the folder the running copy is in and keeps
//! that folder's name, and the updater that installs this version is the old one, so
//! nothing but this version itself can carry the name over. It does so on the first
//! launch from the old folder: renames the folder, starts itself again from the new
//! one, and goes. Sparkle's `SPARKLE_NORMALIZE_INSTALLED_APPLICATION_NAME` is the same
//! idea, done by the updater.
//!
//! Not when Homebrew put the copy there. Its cask names the folder, and Homebrew refuses
//! to upgrade or uninstall a cask whose app is not where it left it; the cask names the
//! new folder now, and its next upgrade moves the copy itself. Not when the new folder
//! is there already, which is a second copy somebody has. And not where the folder
//! cannot be renamed - a copy run from the disk image, or one macOS translocated - which
//! keeps its name and works the same.
//!
//! What the rename costs: a line pasted into an agent before it, which names the program
//! inside the old folder, has to be pasted again from Settings > Agents.

use std::path::{Path, PathBuf};

/// The folder's names before, and after.
const OLD: [&str; 2] = ["Nib.app", "nibeditor.app"];
const NEW: &str = "Orden.app";

/// The cask's own folder under each of Homebrew's two homes, Apple silicon's and Intel's,
/// for the cask's old token and its new one, which Homebrew renames it to.
#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
const CASKROOMS: [&str; 4] = [
    "/opt/homebrew/Caskroom/nib",
    "/usr/local/Caskroom/nib",
    "/opt/homebrew/Caskroom/orden",
    "/usr/local/Caskroom/orden",
];

/// The folder a program at `exe` is the app of and the folder it is renamed to, when
/// it is `<somewhere>/<an old name>/Contents/MacOS/<program>`.
#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
fn renamed(exe: &Path) -> Option<(PathBuf, PathBuf)> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let named = |path: &Path, name: &str| path.file_name().is_some_and(|own| own == name);

    (named(macos, "MacOS")
        && named(contents, "Contents")
        && OLD.iter().any(|old| named(bundle, old)))
    .then(|| (bundle.to_path_buf(), bundle.with_file_name(NEW)))
}

/// What starts the app again from its new folder, run by `/bin/sh` with this process's
/// id and the new folder: once this process has gone - a second copy started while it
/// runs would be handed to it and quit - and as a new instance, because Launch Services
/// can still count the copy that has just gone as running for a moment, and `open`
/// would then only bring that one forward. On the upgrade check's runners a plain
/// `open` came back about one launch in three.
#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
const RELAUNCH: &str = r#"while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.1; done; /bin/sleep 0.5; exec /usr/bin/open -n "$2""#;

/// Whether Homebrew installed the app: a cask of its name is in one of `rooms`.
#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
fn brewed(rooms: &[&str]) -> bool {
    rooms.iter().any(|room| Path::new(room).exists())
}

/// Renames the running app's folder and starts it again from the new one, or does
/// nothing. Before anything else in the process, so the copy that goes has opened no
/// window and claimed nothing the copy that starts would be handed.
#[cfg(target_os = "macos")]
pub fn carry_over() {
    use std::os::unix::process::CommandExt as _;
    use std::process::{Command, Stdio};

    // A build under an identifier of its own is a probe or somebody's experiment.
    if env!("NIB_IDENTIFIER") != "ch.emilvinu.nib" {
        return;
    }
    let Some((from, to)) = std::env::current_exe().ok().and_then(|exe| renamed(&exe)) else {
        return;
    };
    if to.exists() || brewed(&CASKROOMS) || std::fs::rename(&from, &to).is_err() {
        return;
    }

    // In a process group of its own, so that nothing which ends this process's group
    // when it goes takes the one that starts it again with it.
    let started = Command::new("/bin/sh")
        .args(["-c", RELAUNCH, "sh"])
        .arg(std::process::id().to_string())
        .arg(&to)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
    if started.is_ok() {
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::{brewed, renamed, CASKROOMS, NEW, OLD, RELAUNCH};
    use std::path::{Path, PathBuf};

    #[test]
    fn the_program_inside_either_old_folder_is_moved_to_the_new_one() {
        for old in OLD {
            let (from, to) = renamed(
                &Path::new("/Applications")
                    .join(old)
                    .join("Contents/MacOS/nib"),
            )
            .expect("renamed");
            assert_eq!(from, Path::new("/Applications").join(old));
            assert_eq!(to, PathBuf::from("/Applications/Orden.app"));

            let (_, to) = renamed(
                &Path::new("/Users/a/Apps")
                    .join(old)
                    .join("Contents/MacOS/nib"),
            )
            .expect("anywhere a folder is");
            assert_eq!(to, PathBuf::from("/Users/a/Apps/Orden.app"));
        }
    }

    #[test]
    fn anything_else_keeps_its_name() {
        for exe in [
            "/Applications/Orden.app/Contents/MacOS/nib",
            "/Applications/Nib Copy.app/Contents/MacOS/nib",
            "/Applications/nibeditor 2.app/Contents/MacOS/nib",
            "/Applications/Nib.app/Contents/Resources/nib",
            "/Applications/nibeditor.app/Contents/Resources/nib",
            "/Users/a/code/nib/target/release/nib",
            "nib",
        ] {
            assert_eq!(renamed(Path::new(exe)), None, "{exe}");
        }
    }

    #[test]
    fn a_cask_in_either_home_is_homebrews() {
        let dir = std::env::temp_dir().join(format!("nib-caskroom-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a caskroom");
        let here = dir.to_string_lossy().into_owned();

        assert!(brewed(&["/nowhere/Caskroom/nib", &here]));
        assert!(!brewed(&["/nowhere/Caskroom/nib", "/nowhere/either"]));
        let _ = std::fs::remove_dir(&dir);
    }

    /// The copy that starts again waits for this one to go, then starts a new instance.
    #[test]
    fn the_app_starts_again_as_a_new_instance_once_this_one_has_gone() {
        let (wait, start) = RELAUNCH.split_once("done;").expect("a wait, then a start");
        assert!(wait.contains(r#"kill -0 "$1""#));
        assert!(start.trim_end().ends_with(r#"exec /usr/bin/open -n "$2""#));
    }

    /// The cask under either token is Homebrew's, in either home.
    #[test]
    fn the_cask_is_looked_for_under_both_tokens() {
        for token in ["nib", "orden"] {
            for home in ["/opt/homebrew", "/usr/local"] {
                let room = format!("{home}/Caskroom/{token}");
                assert!(CASKROOMS.contains(&room.as_str()), "{room}");
            }
        }
    }

    /// The new folder is the product's name, which is what the bundle is built as.
    #[test]
    fn the_new_folder_is_the_product_s_name() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the config parses");
        let product = config["productName"].as_str().expect("a product name");
        assert_eq!(NEW, format!("{product}.app"));
        assert!(!OLD.contains(&NEW));
    }
}
