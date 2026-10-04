//! Which engine nib runs on - the system's, or nib's own Chromium - chosen in Settings,
//! and the launch that honours the choice.
//!
//! Emil, 2026-09-30: *"it should for now be possible to switch between chromium and the
//! alternative."* Two builds come out of the one source (see engine.rs and
//! cef/Cargo.toml): `nib`, on the system's engine, which is what the installers put on
//! a machine and what every shortcut, link and second launch starts; and `nib-chromium`,
//! the same app on Chromium, which the Browser row fetches (`fetch.rs`) into the app's
//! own data folder. The choice is a file, read before anything else starts:
//!
//! ```text
//! <config>/engine.json                 {"engine": "chromium", "tries": 0}
//! <local>/engines/chromium/<version>/  the engine for this version of the app
//! ```
//!
//! **The hand-over.** Whichever build the system starts reads the choice first, before
//! Tauri or Chromium does anything, and if the other build is the one chosen - and is
//! there, for this version - it starts that one with the same arguments and ends. A
//! link clicked in another program is a launch like any other, so it reaches the
//! engine that is running either way. Reading a small file and starting a process are
//! the whole cost, a few milliseconds of a launch that has to stay under a second.
//!
//! **Never a dead app.** Chromium chosen but not there (a new version not fetched yet,
//! a folder somebody deleted), or chosen and never getting as far as its window twice
//! in a row: the launch runs on the system's engine, and the row says so. The count
//! goes back to nought each time the Chromium build shows its window.
//!
//! **One of them at a time.** A relaunch starts the next launch before this one has
//! gone, and two engines on one app would be two apps writing the same notes. So a
//! running app holds a lock on `engine.lock` for as long as it runs; a launch that
//! finds it held leaves the choice alone and runs, which is how a second launch reaches
//! the first (the single instance plugin hands its arguments over), and a relaunch
//! waits for it to be let go before it decides anything.
//!
//! This is the chooser; the Chromium build it chooses is `fetch.rs`'s to fetch, and the
//! window's row is `settings/EngineRow.svelte`.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub mod fetch;

/// The two engines.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    /// The system's own: `WebView2` on Windows, `WKWebView` on a Mac, `WebKitGTK` on
    /// Linux. What every install starts on.
    #[default]
    System,
    /// nib's own Chromium, through `tauri-runtime-cef`.
    Chromium,
}

/// The engine this build is.
pub const THIS: Engine = if cfg!(feature = "cef") {
    Engine::Chromium
} else {
    Engine::System
};

/// Whether this platform can run nib's own Chromium at all.
///
/// Windows. Not Linux: the runtime is GTK 4 and the app's file dialogs are GTK 3, and
/// one process cannot load both (docs/browser.md section 10), so there is no Chromium row
/// there rather than one that cannot start. And not a Mac yet: the Mac build starts, but
/// its window stops answering at the first web tab (measured by .github/workflows/cef.yml
/// on 2026-09-30, docs/browser.md section 0) - a row there would offer an app that
/// freezes. The build is still made and proved on a Mac, so the row is one line away.
pub const OFFERED: bool = cfg!(windows);

/// How many launches in a row may end before the Chromium build shows its window
/// before a launch stays on the system's engine instead.
const TRIES: u8 = 2;

/// How long a relaunch waits for the app it replaces to finish going.
const PATIENCE: Duration = Duration::from_secs(30);

/// Said to a build started by another one: run as you are, whatever the choice says.
/// It is what keeps two builds from handing a launch back and forth.
const HANDED: &str = "NIB_ENGINE_HANDED";

/// Said to the Chromium build by the system's: where the system's build is, so a
/// switch back can start it.
const LAUNCHER: &str = "NIB_ENGINE_LAUNCHER";

/// Said to the launch a relaunch starts: wait for the app that started you to go.
const AFTER: &str = "NIB_ENGINE_AFTER";

/// The choice, as it is written down.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    /// The engine chosen.
    #[serde(default)]
    pub engine: Engine,
    /// How many launches have handed over to Chromium since it last showed its window.
    #[serde(default)]
    pub tries: u8,
    /// Whether the last launch fell back to the system's engine, for the row to say so
    /// once.
    #[serde(default)]
    pub fell_back: bool,
}

/// Where everything this module reads and writes is, for one app.
#[derive(Clone, Debug)]
pub struct Places {
    /// `<config>/engine.json`.
    pub choice: PathBuf,
    /// `<config>/engine.lock`.
    pub lock: PathBuf,
    /// `<local>/engines/chromium`, where every fetched engine is.
    pub engines: PathBuf,
    /// This version of the app, which the Chromium build has to match to the byte:
    /// both are the same source, and the interface and the crate are one contract.
    pub version: String,
}

impl Places {
    /// The places for an app with this identifier and version, worked out the way Tauri
    /// works out its own folders - so before Tauri exists.
    pub fn of(identifier: &str, version: &str) -> Option<Self> {
        let config = dirs::config_dir()?.join(identifier);
        let local = dirs::data_local_dir()?.join(identifier);
        Some(Self {
            choice: config.join("engine.json"),
            lock: config.join("engine.lock"),
            engines: local.join("engines").join("chromium"),
            version: version.to_string(),
        })
    }

    /// The places of the running app.
    pub fn app(app: &AppHandle) -> Option<Self> {
        Self::of(
            &app.config().identifier,
            &app.package_info().version.to_string(),
        )
    }

    /// The folder this version's Chromium build is in.
    pub fn chromium(&self) -> PathBuf {
        self.engines.join(&self.version)
    }

    /// The Chromium build's executable for this version, where it is complete.
    pub fn chromium_exe(&self) -> Option<PathBuf> {
        let folder = self.chromium();
        folder
            .join(fetch::READY)
            .is_file()
            .then(|| executable(&folder))
            .filter(|exe| exe.is_file())
    }
}

/// The Chromium build's executable inside a folder its archives were unpacked into.
pub fn executable(folder: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        folder
            .join("nib-chromium.app")
            .join("Contents")
            .join("MacOS")
            .join("nib-chromium")
    } else if cfg!(windows) {
        folder.join("nib-chromium.exe")
    } else {
        folder.join("nib-chromium")
    }
}

/// The choice written down, or the system's engine where nothing is, or where what is
/// written cannot be read.
pub fn read_choice(path: &Path) -> Choice {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes the choice down, whole, so a launch never reads half of one.
pub fn write_choice(path: &Path, choice: &Choice) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        crate::paths::made(folder)?;
    }
    let text = serde_json::to_string(choice).map_err(|error| error.to_string())?;
    let staged = path.with_extension("json.new");
    std::fs::write(&staged, text).map_err(|error| error.to_string())?;
    std::fs::rename(&staged, path).map_err(|error| error.to_string())
}

/// What a launch does, decided from what it can see. Pure, so every road through it is
/// a test rather than a launch.
#[derive(Debug, PartialEq, Eq)]
pub enum Launch {
    /// Run as this build.
    Run,
    /// Run as this build, and write down that Chromium was given up on.
    FallBack,
    /// Start the Chromium build and end.
    ToChromium,
    /// Start the system's build and end.
    ToSystem,
}

/// What this launch does.
///
/// `handed` is a launch another build started, which never hands on again. `installed`
/// is whether this version's Chromium build is there, and `launcher` whether the
/// system's build is known to a Chromium one.
pub fn decide(
    this: Engine,
    choice: &Choice,
    handed: bool,
    installed: bool,
    launcher: bool,
) -> Launch {
    if handed || choice.engine == this {
        return Launch::Run;
    }
    match this {
        Engine::System if !OFFERED || !installed => Launch::Run,
        Engine::System if choice.tries >= TRIES => Launch::FallBack,
        Engine::System => Launch::ToChromium,
        Engine::Chromium if launcher => Launch::ToSystem,
        Engine::Chromium => Launch::Run,
    }
}

/// The lock this app holds while it runs; see the top of this file.
static HELD: OnceLock<File> = OnceLock::new();

/// Takes the lock, or answers that another app on this identifier holds it.
fn claim_lock(path: &Path) -> Option<File> {
    if let Some(folder) = path.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .ok()?;
    file.try_lock().ok().map(|()| file)
}

/// Waits for the app a relaunch replaces to let go of the lock, and takes it.
fn claim_after(path: &Path) -> Option<File> {
    let until = Instant::now() + PATIENCE;
    loop {
        if let Some(file) = claim_lock(path) {
            return Some(file);
        }
        if Instant::now() >= until {
            return None;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Starts another build of the app with this launch's arguments, and answers whether it
/// started. Its environment says it was handed the launch, and nothing else of this
/// process's switches goes with it.
fn start_build(exe: &Path, launcher: Option<&Path>) -> bool {
    let mut command = Command::new(exe);
    command
        .args(std::env::args_os().skip(1))
        .env(HANDED, "1")
        .env_remove(AFTER);
    if let Some(launcher) = launcher {
        command.env(LAUNCHER, launcher);
    }
    command.spawn().is_ok()
}

/// The system's build, as the Chromium build knows it: the build that handed it the
/// launch said where it is.
fn launcher() -> Option<PathBuf> {
    std::env::var_os(LAUNCHER)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

/// Whether this launch is a relaunch, which waits for the app that started it to go
/// rather than handing itself to that app; see handover.rs.
pub fn relaunching() -> bool {
    std::env::var_os(AFTER).is_some()
}

/// Whether this launch belongs to the other build, which has been started with its
/// arguments: the caller ends the process at once. The first thing a launch does, before
/// Tauri or Chromium starts anything.
pub fn handed_over(identifier: &str, version: &str) -> bool {
    let Some(places) = Places::of(identifier, version) else {
        return false;
    };

    let held = if std::env::var_os(AFTER).is_some() {
        claim_after(&places.lock)
    } else {
        claim_lock(&places.lock)
    };
    // Another app on this identifier is running: this launch is a second one, and the
    // single instance plugin hands it to that app. Nothing is decided here.
    let Some(held) = held else {
        return false;
    };

    let choice = read_choice(&places.choice);
    let handed = std::env::var_os(HANDED).is_some();
    let installed = places.chromium_exe();
    let back = launcher();

    match decide(THIS, &choice, handed, installed.is_some(), back.is_some()) {
        Launch::Run => {
            let _ = HELD.set(held);
            false
        }
        Launch::FallBack => {
            let _ = write_choice(
                &places.choice,
                &Choice {
                    engine: Engine::System,
                    tries: 0,
                    fell_back: true,
                },
            );
            let _ = HELD.set(held);
            false
        }
        Launch::ToChromium => {
            let Some(exe) = installed else {
                let _ = HELD.set(held);
                return false;
            };
            let _ = write_choice(
                &places.choice,
                &Choice {
                    tries: choice.tries.saturating_add(1),
                    ..choice
                },
            );
            drop(held);
            let here = std::env::current_exe().ok();
            start_build(&exe, here.as_deref())
        }
        Launch::ToSystem => {
            let Some(exe) = back else {
                let _ = HELD.set(held);
                return false;
            };
            drop(held);
            start_build(&exe, None)
        }
    }
}

/// The Chromium build has shown its window: the tries start again from nought. On the
/// system's engine there is nothing to count.
pub fn window_shown(app: &AppHandle) {
    if THIS != Engine::Chromium {
        return;
    }
    let Some(places) = Places::app(app) else {
        return;
    };
    let choice = read_choice(&places.choice);
    if choice.tries != 0 {
        let _ = write_choice(&places.choice, &Choice { tries: 0, ..choice });
    }
}

/// What the Browser row shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// The engine this app is running on.
    pub running: Engine,
    /// The engine chosen, which the next launch runs on.
    pub chosen: Engine,
    /// Whether this platform can have Chromium at all.
    pub offered: bool,
    /// Whether this version's Chromium build is here.
    pub installed: bool,
    /// Whether this launch gave up on Chromium, which the row says once.
    pub fell_back: bool,
}

fn row_state(places: &Places) -> State {
    let choice = read_choice(&places.choice);
    State {
        running: THIS,
        chosen: choice.engine,
        offered: OFFERED,
        installed: THIS == Engine::Chromium || places.chromium_exe().is_some(),
        fell_back: choice.fell_back,
    }
}

fn places(app: &AppHandle) -> Result<Places, String> {
    Places::app(app).ok_or_else(|| "this machine has no folder for the app's settings".into())
}

/// Which engine is running and which is chosen, for the Browser row.
#[tauri::command(async)]
pub fn engine_state(app: AppHandle) -> Result<State, String> {
    let places = places(&app)?;
    let said = row_state(&places);
    // Said once: the row that shows it is the reader having seen it.
    if said.fell_back {
        let _ = write_choice(
            &places.choice,
            &Choice {
                fell_back: false,
                ..read_choice(&places.choice)
            },
        );
    }
    Ok(said)
}

/// Chooses the engine the next launch runs on. The running app is not changed; a
/// relaunch is what changes engines.
#[tauri::command(async)]
pub fn engine_choose(app: AppHandle, engine: Engine) -> Result<State, String> {
    if engine == Engine::Chromium && !OFFERED {
        return Err("Chromium is not available on this system".into());
    }
    let places = places(&app)?;
    write_choice(
        &places.choice,
        &Choice {
            engine,
            tries: 0,
            fell_back: false,
        },
    )?;
    Ok(row_state(&places))
}

/// Whether the app should start its next launch as it leaves.
static RELAUNCHING: AtomicBool = AtomicBool::new(false);

/// Quits the careful way - every window asked, every note saved - and starts the app
/// again once this one has gone, on the engine that is chosen. The next launch is the
/// system's build, which reads the choice like any other launch; see `handed_over`.
///
/// Off the window's thread: the careful quit writes down where every window is.
#[tauri::command(async)]
pub fn engine_relaunch(app: AppHandle) {
    RELAUNCHING.store(true, Ordering::SeqCst);
    crate::lifecycle::quit(&app);
}

/// A quit was called off - somebody chose Cancel over an unsaved note - so nothing
/// starts after it either.
pub fn relaunch_called_off() {
    RELAUNCHING.store(false, Ordering::SeqCst);
}

/// The app is ending: where a relaunch was asked for, the next launch starts now and
/// waits for this process to let go of the lock.
pub fn on_leaving() {
    if !RELAUNCHING.swap(false, Ordering::SeqCst) {
        return;
    }
    let exe = match THIS {
        Engine::System => std::env::current_exe().ok(),
        Engine::Chromium => launcher(),
    };
    let Some(exe) = exe else {
        return;
    };
    let _ = Command::new(exe)
        .env(AFTER, std::process::id().to_string())
        .env_remove(HANDED)
        .env_remove(LAUNCHER)
        .spawn();
}

/// The state fetching Chromium keeps while the app runs, added to the builder.
pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder.manage(fetch::Fetching::default())
}

#[cfg(test)]
mod tests {
    use super::{
        decide, read_choice, write_choice, Choice, Engine, Launch, Places, OFFERED, TRIES,
    };

    fn chosen(engine: Engine, tries: u8) -> Choice {
        Choice {
            engine,
            tries,
            fell_back: false,
        }
    }

    #[test]
    fn a_launch_runs_as_itself_when_its_engine_is_the_chosen_one() {
        assert_eq!(
            decide(
                Engine::System,
                &chosen(Engine::System, 0),
                false,
                true,
                false
            ),
            Launch::Run
        );
        assert_eq!(
            decide(
                Engine::Chromium,
                &chosen(Engine::Chromium, 1),
                false,
                true,
                true
            ),
            Launch::Run
        );
    }

    #[test]
    fn the_system_s_build_hands_over_only_to_a_chromium_that_is_there() {
        let wanted = chosen(Engine::Chromium, 0);
        assert_eq!(
            decide(Engine::System, &wanted, false, false, false),
            Launch::Run,
            "not fetched yet: run on the system's engine"
        );
        let expected = if OFFERED {
            Launch::ToChromium
        } else {
            Launch::Run
        };
        assert_eq!(
            decide(Engine::System, &wanted, false, true, false),
            expected
        );
    }

    #[test]
    fn chromium_that_never_shows_a_window_is_given_up_on() {
        if !OFFERED {
            return;
        }
        assert_eq!(
            decide(
                Engine::System,
                &chosen(Engine::Chromium, TRIES - 1),
                false,
                true,
                false
            ),
            Launch::ToChromium
        );
        assert_eq!(
            decide(
                Engine::System,
                &chosen(Engine::Chromium, TRIES),
                false,
                true,
                false
            ),
            Launch::FallBack
        );
    }

    #[test]
    fn a_handed_launch_never_hands_on() {
        assert_eq!(
            decide(
                Engine::System,
                &chosen(Engine::Chromium, 0),
                true,
                true,
                true
            ),
            Launch::Run
        );
        assert_eq!(
            decide(
                Engine::Chromium,
                &chosen(Engine::System, 0),
                true,
                true,
                true
            ),
            Launch::Run
        );
    }

    #[test]
    fn chromium_hands_back_only_to_a_system_build_it_knows() {
        let back = chosen(Engine::System, 0);
        assert_eq!(
            decide(Engine::Chromium, &back, false, true, true),
            Launch::ToSystem
        );
        assert_eq!(
            decide(Engine::Chromium, &back, false, true, false),
            Launch::Run
        );
    }

    #[test]
    fn a_choice_is_read_back_as_it_was_written_and_nothing_is_the_system() {
        let folder = tempfile::tempdir().expect("a folder");
        let path = folder.path().join("engine.json");
        assert_eq!(read_choice(&path), Choice::default());

        let written = Choice {
            engine: Engine::Chromium,
            tries: 1,
            fell_back: true,
        };
        write_choice(&path, &written).expect("written");
        assert_eq!(read_choice(&path), written);

        std::fs::write(&path, "{ half").expect("broken");
        assert_eq!(
            read_choice(&path).engine,
            Engine::System,
            "an unreadable choice is no choice"
        );
    }

    #[test]
    fn this_version_s_engine_is_there_only_once_it_was_finished() {
        let folder = tempfile::tempdir().expect("a folder");
        let places = Places {
            choice: folder.path().join("engine.json"),
            lock: folder.path().join("engine.lock"),
            engines: folder.path().join("engines"),
            version: "1.2.3".into(),
        };
        let exe = super::executable(&places.chromium());
        std::fs::create_dir_all(exe.parent().expect("a folder")).expect("made");
        std::fs::write(&exe, b"").expect("an executable");
        assert!(places.chromium_exe().is_none(), "unpacked but not finished");

        std::fs::write(places.chromium().join(super::fetch::READY), b"").expect("finished");
        assert_eq!(places.chromium_exe(), Some(exe));
    }
}
