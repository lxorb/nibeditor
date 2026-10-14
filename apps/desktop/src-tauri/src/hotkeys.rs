//! Keys from any app: quick add's (`quick_add.rs`) and the agents' stop
//! (`agents/shell.rs`), held here for both, so a key moves between them the same way.
//!
//! **Two ways a key reaches the app.** Windows, a Mac and an X11 session register it
//! with the system through Tauri's global shortcut plugin, which is added the first time
//! a key is wanted and never at launch: a plugin added twice is refused the second time,
//! which is why there is one place that adds it. A Wayland session lets no app grab a
//! key at all - the compositor holds every one - and hands one over only through the
//! desktop portal's global shortcuts, which KDE, GNOME from 48 and Hyprland answer
//! (`hotkeys/portal.rs`). There the system's own settings have the last word on which
//! key it is, and the page is told the key the system says (`Keys`).
//!
//! **Where neither is there** - sway, an older GNOME - nothing reaches the app from
//! another one, and the page is told that too, rather than shown a key that does
//! nothing. What every such desktop does have is a shortcut of its own that runs a
//! command, so `nib --quick-add` and `nib --stop-agents` press the keys from there: a
//! second launch, handed to the app already running (`launch.rs`).
//!
//! On the event loop's own thread, which every caller is on: a plugin added at run time,
//! and a key registered with it, have to live there.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _};

#[cfg(target_os = "linux")]
mod portal;
#[cfg(any(target_os = "linux", test))]
mod trigger;

/// What the page hears when the keys held change.
const EVENT: &str = "nib://global-keys";

/// A key from any app.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Which {
    /// Quick add's window, over whatever is in front.
    QuickAdd,
    /// The stop for every agent.
    StopAgents,
}

impl Which {
    const ALL: [Self; 2] = [Self::QuickAdd, Self::StopAgents];

    /// The keyboard registry's id, which is what the page knows it by.
    fn id(self) -> &'static str {
        match self {
            Self::QuickAdd => "app.quick-add",
            Self::StopAgents => "agents.stop",
        }
    }

    /// What a command line says to press it.
    fn flag(self) -> &'static str {
        match self {
            Self::QuickAdd => "--quick-add",
            Self::StopAgents => "--stop-agents",
        }
    }

    /// The keys a command line asks to press.
    pub fn asked_by(argv: &[String]) -> Vec<Self> {
        Self::ALL
            .into_iter()
            .filter(|which| argv.iter().skip(1).any(|one| one == which.flag()))
            .collect()
    }

    /// Whether `arg` is one of the flags, which nothing else on a command line reads.
    pub fn is_flag(arg: &str) -> bool {
        Self::ALL.iter().any(|which| which.flag() == arg)
    }
}

/// How keys from any app reach Orden on this desktop.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    /// Registered with the system by the plugin.
    System,
    /// Bound through the desktop portal.
    Portal,
    /// Not at all: only a command bound in the desktop's own settings.
    None,
}

/// What the page is told about the keys from any app.
#[derive(Clone, Debug, Serialize)]
pub struct Keys {
    reach: Reach,
    /// Whether the system has a page of its own to change them on.
    change: bool,
    /// The keys held now, by the registry's id, in the system's own words: the key, or
    /// nothing where the system holds it with no key yet.
    held: BTreeMap<&'static str, String>,
    /// The keys the system turned down: its dialog closed without them.
    refused: Vec<&'static str>,
    /// What starts Orden on this machine, for a desktop's own shortcut to run with a flag.
    run: String,
}

/// What is held.
struct Held {
    /// What the page asked for each key, in the plugin's notation.
    wanted: BTreeMap<Which, String>,
    /// What the system holds for each, in its own words.
    held: BTreeMap<Which, String>,
    refused: BTreeSet<Which>,
    /// How keys reach the app here, once that is known.
    reach: Option<Reach>,
    change: bool,
}

static HELD: Mutex<Held> = Mutex::new(Held {
    wanted: BTreeMap::new(),
    held: BTreeMap::new(),
    refused: BTreeSet::new(),
    reach: None,
    change: false,
});

fn with<T>(on_held: impl FnOnce(&mut Held) -> T) -> T {
    on_held(&mut HELD.lock().unwrap_or_else(PoisonError::into_inner))
}

/// Holds `key` for `which` from any app, in the plugin's notation, or lets it go. Answers
/// the key held now.
pub fn hold(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    let key = key.filter(|key| !key.trim().is_empty());
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        return by_portal(app, which, key);
    }
    by_plugin(app, which, key)
}

#[cfg(target_os = "linux")]
fn by_portal(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    let changed = with(|held| {
        let was = held.wanted.get(&which).cloned();
        if was == key {
            return None;
        }
        match key {
            Some(key) => held.wanted.insert(which, key),
            None => held.wanted.remove(&which),
        };
        Some(held.wanted.clone())
    });
    if let Some(wanted) = changed {
        portal::want(app, wanted);
    }
    with(|held| held.held.get(&which).cloned())
}

fn by_plugin(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};

    let old = with(|held| held.held.get(&which).cloned());
    if old == key {
        return old;
    }
    // Something is held only where the plugin is in the app.
    if let Some(old) = &old {
        let _ = app.global_shortcut().unregister(old.as_str());
    }
    let now = key.filter(|key| {
        plugin_added(app)
            && app
                .global_shortcut()
                .on_shortcut(key.as_str(), move |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        pressed(app, which, None);
                    }
                })
                .is_ok()
    });
    with(|held| {
        held.reach = Some(Reach::System);
        match &now {
            Some(now) => held.held.insert(which, now.clone()),
            None => held.held.remove(&which),
        };
    });
    told(app);
    now
}

/// Whether the plugin is in the app, added now where it was not yet.
fn plugin_added(app: &AppHandle) -> bool {
    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        app.plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .is_ok()
    })
}

/// A key pressed - from any app, or by a command line - with the compositor's token for
/// the press where it gave one. On the event loop's thread.
pub fn pressed(app: &AppHandle, which: Which, token: Option<String>) {
    match which {
        Which::QuickAdd => crate::quick_add::bring_up(app, token),
        Which::StopAgents => {
            crate::agents::stop::stop(app);
        }
    }
}

/// How keys reach the app, as the portal found out.
#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn reached(app: &AppHandle, reach: Reach, change: bool) {
    with(|held| {
        held.reach = Some(reach);
        held.change = change;
    });
    told(app);
}

/// The keys the system holds now, and those it turned down.
#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn bound(app: &AppHandle, now: BTreeMap<Which, String>, refused: BTreeSet<Which>) {
    with(|held| {
        held.held = now;
        held.refused = refused;
    });
    told(app);
}

/// The keys the system shows now for those it holds, changed in its own settings.
#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn changed(app: &AppHandle, shown: BTreeMap<Which, String>) {
    with(|held| {
        for (which, said) in shown {
            if let Some(now) = held.held.get_mut(&which) {
                *now = said;
            }
        }
    });
    told(app);
}

fn told(app: &AppHandle) {
    let _ = app.emit(EVENT, keys());
}

fn keys() -> Keys {
    with(|held| Keys {
        reach: held.reach.unwrap_or(if wayland() {
            Reach::Portal
        } else {
            Reach::System
        }),
        change: held.change,
        held: held
            .held
            .iter()
            .map(|(which, said)| (which.id(), said.clone()))
            .collect(),
        refused: held.refused.iter().map(|which| which.id()).collect(),
        run: command(
            std::env::var("FLATPAK_ID").ok(),
            std::env::var("APPIMAGE").ok(),
            std::env::var("SNAP_NAME").ok(),
            std::env::args().next(),
        ),
    })
}

fn wayland() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::linux::wayland_session()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// What starts Orden here: Flatpak's and Snap's own commands, the `AppImage` itself, or the
/// name it was started by, which is `nib` or `orden` on the path.
fn command(
    flatpak: Option<String>,
    appimage: Option<String>,
    snap: Option<String>,
    first: Option<String>,
) -> String {
    if let Some(id) = flatpak.filter(|id| !id.is_empty()) {
        return format!("flatpak run {id}");
    }
    if let Some(path) = appimage.filter(|path| !path.is_empty()) {
        return path;
    }
    if let Some(name) = snap.filter(|name| !name.is_empty()) {
        return name;
    }
    first
        .as_deref()
        .and_then(|first| std::path::Path::new(first).file_name())
        .map_or_else(
            || "nib".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        )
}

/// The keys from any app as they stand, and the portal asked now on a Wayland session
/// where nothing has asked it yet, so that a desktop without one is said to be.
#[tauri::command]
pub fn global_keys(app: AppHandle) -> Keys {
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        portal::start(&app);
    }
    let _ = &app;
    keys()
}

/// The system's own page for the keys, where it has one: the portal's second version.
#[tauri::command]
pub fn global_keys_change(app: AppHandle) {
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        portal::change(&app);
    }
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_line_presses_the_keys_it_names() {
        let argv: Vec<String> = ["nib", "--quick-add"].map(String::from).into();
        assert_eq!(Which::asked_by(&argv), vec![Which::QuickAdd]);
        let argv: Vec<String> = ["nib", "--stop-agents", "--quick-add"]
            .map(String::from)
            .into();
        assert_eq!(
            Which::asked_by(&argv),
            vec![Which::QuickAdd, Which::StopAgents]
        );
        // The program's own name is not a flag, whatever it is called.
        let argv: Vec<String> = ["--quick-add"].map(String::from).into();
        assert!(Which::asked_by(&argv).is_empty());
        assert!(Which::is_flag("--stop-agents"));
        assert!(!Which::is_flag("https://orden.so"));
    }

    #[test]
    fn the_command_is_the_one_this_install_is_started_by() {
        let some = |text: &str| Some(text.to_owned());
        assert_eq!(
            command(some("ch.emilvinu.nib"), None, None, some("/app/bin/nib")),
            "flatpak run ch.emilvinu.nib"
        );
        assert_eq!(
            command(
                None,
                some("/home/e/Orden.AppImage"),
                None,
                some("/tmp/.mount/nib")
            ),
            "/home/e/Orden.AppImage"
        );
        assert_eq!(
            command(None, None, some("orden"), some("/snap/x/nib")),
            "orden"
        );
        assert_eq!(command(None, None, None, some("/usr/bin/nib")), "nib");
        assert_eq!(command(None, None, None, some("orden")), "orden");
        assert_eq!(command(None, None, None, None), "nib");
    }

    #[test]
    fn the_page_knows_each_key_by_the_registry_id() {
        assert_eq!(Which::QuickAdd.id(), "app.quick-add");
        assert_eq!(Which::StopAgents.id(), "agents.stop");
    }
}
