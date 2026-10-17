//! What nib's own Chromium left on a machine, now that every launch is on the system's
//! engine.
//!
//! Up to 0.15 a reader on Windows could choose nib's own Chromium in Settings: the choice
//! was a file, and a launch that read `chromium` there handed itself to a second build of
//! the app fetched into the app's local data folder. That build is gone (#305, #313).
//! Nothing reads the choice any more, so a launch whatever it says - `chromium`, a word
//! from a later version, half a file - is on the system's engine, and once the window is
//! up the choice, its lock and the fetched builds go, off the window's thread:
//!
//! ```text
//! <config>/engine.json              {"engine": "chromium", "tries": 0}
//! <config>/engine.lock
//! <local>/engines/chromium/         a build for each version that fetched one
//! ```
//!
//! Chromium's profiles in `<config>/chromium` are the reader's own - what its web tabs
//! were signed in to - and stay where they are.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager as _};

/// Where the engine choice and the fetched builds were, for one app.
struct Leftovers {
    choice: PathBuf,
    lock: PathBuf,
    engines: PathBuf,
}

impl Leftovers {
    fn under(config: &Path, local: &Path) -> Self {
        Self {
            choice: config.join("engine.json"),
            lock: config.join("engine.lock"),
            engines: local.join("engines"),
        }
    }
}

/// The engine an old choice named, for the log: `None` where there was no choice, or
/// none that could be read. The launch is on the system's engine either way.
fn named_engine(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let said: serde_json::Value = serde_json::from_str(&text).ok()?;
    said.get("engine")?.as_str().map(str::to_string)
}

/// Takes the choice, its lock and the fetched builds away, and answers what the choice
/// said. A file that is not there is not an error, and one that will not go is left for
/// the next launch.
fn retire_engine(places: &Leftovers) -> Option<String> {
    let said = named_engine(&places.choice);
    let _ = std::fs::remove_file(&places.choice);
    let _ = std::fs::remove_file(&places.lock);
    let chromium = places.engines.join("chromium");
    if chromium.is_dir() {
        let _ = std::fs::remove_dir_all(&chromium);
    }
    // The folder held nothing else; gone only where it is empty now.
    let _ = std::fs::remove_dir(&places.engines);
    said
}

/// Clears what the Chromium build left, on a thread of its own: a fetched build is three
/// hundred megabytes of files, and the window is already up.
pub fn clear_leftovers(app: &AppHandle) {
    let (Ok(config), Ok(local)) = (
        crate::paths::config_dir(app),
        app.path().app_local_data_dir(),
    ) else {
        return;
    };
    let places = Leftovers::under(&config, &local);
    if !places.choice.exists() && !places.engines.join("chromium").exists() {
        return;
    }
    std::thread::spawn(move || {
        if let Some(engine) = retire_engine(&places) {
            eprintln!("nib: engine: the choice said {engine}; running on the system's");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{named_engine, retire_engine, Leftovers};

    fn places() -> (tempfile::TempDir, Leftovers) {
        let dir = tempfile::tempdir().expect("a folder");
        let places = Leftovers::under(&dir.path().join("config"), &dir.path().join("local"));
        std::fs::create_dir_all(dir.path().join("config")).expect("config");
        (dir, places)
    }

    #[test]
    fn a_reader_who_chose_chromium_is_on_the_system_engine_and_the_build_goes() {
        let (_dir, places) = places();
        std::fs::write(&places.choice, r#"{"engine":"chromium","tries":1}"#).expect("choice");
        std::fs::write(&places.lock, "").expect("lock");
        let build = places.engines.join("chromium").join("0.15.0");
        std::fs::create_dir_all(&build).expect("build");
        std::fs::write(build.join("nib-chromium.exe"), "MZ").expect("exe");

        assert_eq!(retire_engine(&places).as_deref(), Some("chromium"));
        assert!(!places.choice.exists());
        assert!(!places.lock.exists());
        assert!(!places.engines.exists());
    }

    #[test]
    fn a_choice_that_cannot_be_read_is_no_trouble() {
        let (_dir, places) = places();
        std::fs::write(&places.choice, "{\"engine\": \"chrom").expect("choice");
        assert_eq!(named_engine(&places.choice), None);
        assert_eq!(retire_engine(&places), None);
        assert!(!places.choice.exists());

        // And nothing there at all.
        assert_eq!(retire_engine(&places), None);
    }

    #[test]
    fn a_folder_of_engines_with_something_else_in_it_stays() {
        let (_dir, places) = places();
        std::fs::create_dir_all(places.engines.join("chromium")).expect("chromium");
        std::fs::create_dir_all(places.engines.join("other")).expect("other");
        let _ = retire_engine(&places);
        assert!(!places.engines.join("chromium").exists());
        assert!(places.engines.join("other").exists());
    }
}
