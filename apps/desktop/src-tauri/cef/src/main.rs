//! nib, on nib's own Chromium.
//!
//! The same app as the binary next door, on a different engine: this one links CEF
//! through `tauri-runtime-cef`, configures it, and hands it to `nib_lib::run_on`.
//! Everything the app is - the notes, the commands, the window, the web tabs - is the
//! library's, unchanged, and the only thing this file decides is what the engine is and
//! where its profiles go. See ../Cargo.toml, ../../src/engine.rs and docs/browser.md.
//!
//! One binary is also Chromium's renderer, GPU and utility processes: a process started
//! with `--type=` is one of those, and runs as `helper::run` before anything else happens
//! and then ends. It has to be the first thing - on macOS, loading the framework replaces
//! the process's malloc zone, and an allocation on another thread racing that swap
//! corrupts the heap. Why the helper is nib's own and not the runtime's is in helper.rs.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod helper;

use std::path::PathBuf;

use tauri_runtime_cef::{Cef, RemoteDebugging, SandboxPolicy};

/// The app's own configuration, as the app is built from it.
///
/// Read here for one field - the identifier - because the engine's profiles have to be
/// placed before the app exists, and it is the app handle that would otherwise answer
/// where the app's folder is. One source of truth either way.
const CONFIG: &str = include_str!("../../tauri.conf.json");

/// The folder the engine keeps its profiles in, inside the app's own settings folder.
/// `engine::root` in the library names the same place; the comment there is the layout.
const ROOT: &str = "chromium";

/// Which sandbox policy to run with, from the environment.
///
/// `Auto` by default, which keeps Chromium's sandbox wherever the runtime can keep it and
/// says so where it cannot - and on Windows it cannot yet: a sandboxed CEF application has
/// to be the DLL `bootstrap.exe` loads, and a Tauri application is an executable. That is
/// the first row of docs/browser.md section 10.
fn sandbox() -> SandboxPolicy {
    match std::env::var("NIB_CEF_SANDBOX")
        .unwrap_or_default()
        .as_str()
    {
        "required" => SandboxPolicy::Required,
        "disabled" | "off" => SandboxPolicy::Disabled,
        _ => SandboxPolicy::Auto,
    }
}

/// Extra Chromium switches, as a list a person wrote in one string.
///
/// `NIB_CEF_ARGS=enable-logging=stderr,v=1`: comma separated, each one a `key=value` pair
/// or a bare key, in the order they are written. It is how the next thing a run needs to
/// be asked gets asked without a rebuild. A bare key is handed on as `bare` spells it.
fn switches(written: &str) -> Vec<(String, Option<String>)> {
    written
        .split(',')
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(|one| match one.split_once('=') {
            Some((key, value)) => (key.to_owned(), Some(value.to_owned())),
            None => (bare(one), None),
        })
        .collect()
}

/// A switch with no value, the way the runtime takes one: with its dashes. Without them
/// it reaches Chromium as an argument rather than a switch - an address to open - and
/// Chromium never sees the switch at all. Chromium drops the dashes off the name it
/// keeps, so `--x` is the switch `x` was meant to be.
fn bare(name: &str) -> String {
    format!("--{}", name.trim_start_matches('-'))
}

/// The port a probe reads the pages through, named in `NIB_CEF_DEBUG_PORT`.
///
/// The system's engine is reached the same way, through the variable `WebView2` reads its
/// switches from (see scripts/devtools.py), so a drive asks both engines the same
/// questions. Off unless named: whatever can set this process's environment can already
/// run code as the person it belongs to.
fn debugging() -> RemoteDebugging {
    std::env::var("NIB_CEF_DEBUG_PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .map_or(RemoteDebugging::Disabled, |port| RemoteDebugging::Port {
            port,
            allowed_origins: Vec::new(),
        })
}

/// Lets a run that asked for a debugging port have one.
///
/// The runtime pins Chromium's own "may be debugged" preference off, in the profile's
/// `Local State`, on every run without a port - and a preference it sets for a run that
/// has one arrives after Chromium has read the file, so a probe following an ordinary
/// launch was refused ("disallowed by the system admin"). So the file says yes before
/// Chromium opens it, and only on a run that named a port.
fn allow_debugging(root: &std::path::Path) {
    let state = root.join("Local State");
    let Ok(text) = std::fs::read_to_string(&state) else {
        return;
    };
    let Ok(mut said) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    if let Some(devtools) = said
        .as_object_mut()
        .map(|all| {
            all.entry("devtools")
                .or_insert_with(|| serde_json::json!({}))
        })
        .and_then(serde_json::Value::as_object_mut)
    {
        devtools.insert(
            "remote_debugging".to_owned(),
            serde_json::json!({ "allowed": true }),
        );
        let _ = std::fs::write(&state, said.to_string());
    }
}

/// Where the engine's profiles go: `<the app's settings folder>/web`.
///
/// The same two steps Tauri takes for `app_config_dir`, with the same crate, so the path
/// this hands CEF is the path the library's own `engine::root` computes from an app
/// handle. `None` only on a machine with no config folder at all, where CEF's own default
/// is a better answer than a guess.
fn root_cache_path() -> Option<PathBuf> {
    let identifier = serde_json::from_str::<serde_json::Value>(CONFIG)
        .ok()?
        .get("identifier")?
        .as_str()?
        .to_owned();
    let identifier = overridden_identifier().unwrap_or(identifier);
    Some(dirs::config_dir()?.join(identifier).join(ROOT))
}

/// The identifier a build was given on its command line (`--config`), which reaches the
/// build as `TAURI_CONFIG` and moves the app's own folder - a probe's, above all, which
/// must never share a profile with the app somebody uses.
fn overridden_identifier() -> Option<String> {
    let said = option_env!("TAURI_CONFIG")?;
    serde_json::from_str::<serde_json::Value>(said)
        .ok()?
        .get("identifier")?
        .as_str()
        .map(str::to_owned)
}

/// Whether the run that started this one sent every window off the screen:
/// `NIB_OFF_SCREEN`, which only a probe sets. See src/placement.rs.
fn off_screen() -> bool {
    std::env::var_os("NIB_OFF_SCREEN").is_some_and(|value| !value.is_empty() && value != "0")
}

fn main() {
    if helper::is_helper() {
        // A probe's GPU process or utility holds its windows off the screen as the app
        // holds its own. Not a renderer, which makes none; see foreground.rs.
        if !helper::is_renderer() {
            nib_lib::hold_helper();
        }
        helper::run();
        return;
    }

    let mut engine = Cef::default()
        .sandbox(sandbox())
        // `nib://` links reach the app the same way they do on the system's engine; the
        // plugin handles the arriving half either way.
        .deep_link_schemes(["nib"])
        .command_line_args(switches(&std::env::var("NIB_CEF_ARGS").unwrap_or_default()));

    let debugging = debugging();
    let debugged = !matches!(debugging, RemoteDebugging::Disabled);
    if let Some(path) = root_cache_path() {
        if debugged {
            allow_debugging(&path);
        }
        // An agent's own tab is a browser with no window, which CEF can make only when
        // told so as it starts; and only where an agent is paired, since the switch is
        // the whole process's (see agents/engines/cef.rs).
        if path.parent().is_some_and(nib_lib::agent_pages_wanted) {
            engine = engine.with_settings(|settings| settings.windowless_rendering_enabled = 1);
        }
        engine = engine.root_cache_path(path);
    }
    engine = engine.remote_debugging(debugging);

    // A probe's window is off the screen (see placement.rs), and Chromium counts a window
    // nobody can see as hidden: it stops painting it and stops its animation frames, and
    // nib's own interface waits on those as it starts. So a run sent away paints anyway,
    // which is what a window on a screen does.
    //
    // And a probe raises none of the dialogs Chromium can be talked out of: an extension
    // that will not load (`--load-extension`, a probe's switch) is otherwise a native
    // message box with no parent, centred on the primary screen, which a probe put there
    // twice on 2026-10-03; and a page that stops answering is otherwise a "Page
    // unresponsive" dialog. The error is still in the log. Whatever window it raises
    // anyway is held off the screen; see src/foreground.rs.
    if off_screen() {
        engine = engine
            .disable_features(["CalculateNativeWinOcclusion"])
            .command_line_args::<_, String>(
                [
                    "disable-backgrounding-occluded-windows",
                    "noerrdialogs",
                    "disable-hang-monitor",
                ]
                .map(|name| (bare(name), None)),
            );
    }

    nib_lib::run_on(tauri::Builder::default().runtime(engine));
}

#[cfg(test)]
mod tests {
    use super::{root_cache_path, switches, CONFIG};

    /// The switches a run can add, read the way a person would write them.
    #[test]
    fn the_command_line_reads_pairs_and_bare_keys() {
        assert_eq!(
            switches("enable-logging=stderr, no-sandbox ,,v=1"),
            vec![
                ("enable-logging".to_owned(), Some("stderr".to_owned())),
                ("--no-sandbox".to_owned(), None),
                ("v".to_owned(), Some("1".to_owned())),
            ]
        );
        assert_eq!(
            switches("--noerrdialogs"),
            vec![("--noerrdialogs".to_owned(), None)],
            "a key written with its dashes keeps two"
        );
        assert!(
            switches("").is_empty(),
            "an unset variable adds no switches"
        );
    }

    /// The engine's profiles are inside the app's own folder, under the name the library
    /// uses for them.
    #[test]
    fn the_profiles_are_in_the_app_s_own_folder() {
        let identifier = serde_json::from_str::<serde_json::Value>(CONFIG).unwrap()["identifier"]
            .as_str()
            .unwrap()
            .to_owned();
        let path = root_cache_path().expect("a config folder");
        assert!(path.ends_with("chromium"));
        assert!(
            path.parent().unwrap().ends_with(&identifier) || option_env!("TAURI_CONFIG").is_some()
        );
    }
}
