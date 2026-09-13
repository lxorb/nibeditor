//! nib, on nib's own Chromium.
//!
//! The same app as the binary next door, on a different engine: this one links CEF
//! through `tauri-runtime-cef`, configures it, and hands it to `nib_lib::run_on`.
//! Everything the app is - the notes, the commands, the window, the web tabs - is
//! the library's, unchanged, and the only thing this file decides is what the engine
//! is and where its profiles go. See ../../src/engine.rs and docs/browser.md.
//!
//! `cef_entry_point` is what makes one binary serve as Chromium's renderer, GPU and
//! utility processes as well: it runs CEF's `execute_process` before anything else
//! and returns. It has to be the first thing that happens - on macOS, loading the
//! framework replaces the process's malloc zone, and an allocation on another thread
//! racing that swap corrupts the heap on every launch, probabilistically.
//!
//! No `windows_subsystem = "windows"` here, unlike the app's own binary: the gate
//! says its numbers on stdout, and a Windows GUI binary has none. That costs a
//! console window on Windows, which is the right trade for a build that exists to
//! be measured and is never installed.

use std::path::PathBuf;

use tauri_runtime_cef::{Cef, SandboxPolicy};

/// The app's own configuration, as the app is built from it.
///
/// Read here for one field - the identifier - because the engine's profiles have to
/// be placed before the app exists, and it is the app handle that would otherwise
/// answer where the app's folder is. One source of truth either way.
const CONFIG: &str = include_str!("../../tauri.conf.json");

/// The folder the engine keeps its profiles in, inside the app's own settings
/// folder. `engine::root` in the library names the same place; the comment there is
/// the layout.
const ROOT: &str = "web";

/// Which sandbox policy to run with, from the environment.
///
/// `Auto` by default, which keeps Chromium's sandbox wherever it can be kept and
/// logs the reason where it cannot - and on Windows it cannot, today, because a
/// sandboxed CEF application has to be the DLL that `bootstrap.exe` loads and a
/// Tauri application is not one yet. That is ship gate 1 in docs/browser.md, and
/// `Required` is what a release will say once it is shut. CI names the policy it
/// used so no number here is quietly an unsandboxed one.
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

/// Where the engine's profiles go: `<the app's settings folder>/web`.
///
/// The same two steps Tauri takes for `app_config_dir`, with the same crate, so the
/// path this hands CEF is the path the library's own `engine::root` computes from an
/// app handle. `None` only on a machine with no config folder at all, where CEF's
/// own default is a better answer than a guess.
fn root_cache_path() -> Option<PathBuf> {
    let identifier = serde_json::from_str::<serde_json::Value>(CONFIG)
        .ok()?
        .get("identifier")?
        .as_str()?
        .to_owned();
    Some(dirs::config_dir()?.join(identifier).join(ROOT))
}

#[tauri_runtime_cef::cef_entry_point]
fn main() {
    // First line of the gate's report, so a run says which engine produced its
    // numbers before it has done anything at all. The CEF version itself is on the
    // lock file beside this crate, which is what the workflow prints.
    println!(
        "{{\"at\":0,\"event\":\"engine\",\"cef_api\":{},\"sandbox\":\"{:?}\"}}",
        tauri_runtime_cef::CEF_API_VERSION_LAST,
        sandbox()
    );

    let mut engine = Cef::default()
        .sandbox(sandbox())
        // `nib://` links reach the app the same way they do on the system's engine;
        // the plugin handles the arriving half either way.
        .deep_link_schemes(["nib"]);

    if let Some(path) = root_cache_path() {
        engine = engine.root_cache_path(path);
    }

    // An unpacked extension, for the gate. There is no host API for installing one
    // - CEF's own issue for that is still open - and there does not need to be:
    // `chrome://extensions` is the management surface and Chromium's own policy
    // mechanisms are how a shipped build would install from the account. Batch 4.
    if let Ok(path) = std::env::var("NIB_CEF_EXTENSION") {
        engine = engine.command_line_arg("load-extension", Some(path));
    }

    nib_lib::run_on(tauri::Builder::default().runtime(engine));
}

#[cfg(test)]
mod tests {
    use super::{root_cache_path, CONFIG};

    /// One revision, in one place. The pin is what the bump workflow rewrites and
    /// what `upstream.py` reads, and a second revision anywhere in this manifest
    /// would be a build made of two different Tauris.
    #[test]
    fn the_pin_is_one_revision() {
        let manifest = include_str!("../Cargo.toml");
        let revisions: std::collections::HashSet<&str> = manifest
            .lines()
            .filter_map(|line| line.strip_prefix("revision = \""))
            .filter_map(|rest| rest.split('"').next())
            .collect();

        assert_eq!(revisions.len(), 1, "the manifest names {revisions:?}");
        let revision = revisions.iter().next().expect("the one revision");
        assert_eq!(revision.len(), 40, "a short revision is a moving target");
        assert!(revision.chars().all(|one| one.is_ascii_hexdigit()));
    }

    /// `tauri` and `tauri-build` come out of the checkout and the rest does not, which
    /// is a finding rather than an omission: the branch moved `tauri-utils` to
    /// `schemars` 1 without moving its version number, and every plugin's build script
    /// is written against the 0.8 API. The manifest says why; this holds it to it.
    #[test]
    fn the_engine_and_its_codegen_come_from_the_checkout() {
        let manifest = include_str!("../Cargo.toml");
        let patched: Vec<&str> = manifest
            .split("[patch.crates-io]")
            .nth(1)
            .expect("a patch section")
            .lines()
            .take_while(|line| !line.starts_with('['))
            .filter(|line| line.contains('='))
            .collect();

        for name in ["tauri ", "tauri-build "] {
            let line = patched
                .iter()
                .find(|line| line.starts_with(name))
                .unwrap_or_else(|| panic!("{name} is not patched"));
            assert!(
                line.contains(".upstream/tauri/crates/"),
                "{name} does not come from the checkout"
            );
        }
        for name in ["tauri-utils ", "tauri-plugin "] {
            assert!(
                !patched.iter().any(|line| line.starts_with(name)),
                "{name} is patched, and every plugin's build script then fails to compile"
            );
        }
        assert!(
            patched.iter().any(|line| line.starts_with("dpi ")),
            "without one dpi there are two, and the compiler says so in as many words"
        );
    }

    /// The profiles go inside the app's own settings folder, under the name the
    /// library uses for the same place.
    #[test]
    fn the_profiles_go_under_the_app_folder() {
        let root = root_cache_path().expect("a config folder");
        assert!(root.ends_with(super::ROOT));

        let identifier = serde_json::from_str::<serde_json::Value>(CONFIG).expect("the config");
        let identifier = identifier["identifier"].as_str().expect("an identifier");
        assert!(root.parent().is_some_and(|dir| dir.ends_with(identifier)));
    }

    /// And the library was compiled for an engine it is handed rather than one
    /// compiled into it, which is the whole of what the feature changes.
    #[test]
    fn the_library_takes_its_engine_from_here() {
        let engine = std::any::type_name::<nib_lib::Engine>();
        assert!(
            engine.contains("DynRuntime"),
            "the library was built for {engine}, so the `cef` feature is not on"
        );
    }
}
