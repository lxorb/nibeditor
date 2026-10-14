//! The desktop portal's global shortcuts (`org.freedesktop.portal.GlobalShortcuts`), the
//! one way a Wayland session hands an app a key pressed in another.
//!
//! **One session for every key the page wants**, bound again whenever that set changes:
//! the portal binds a session's keys once and never again, so a key added or let go is a
//! new session. The key the reader chose is only the key the app prefers; the system's
//! settings decide, and the system says back which key it is (`trigger_description`),
//! which is what the page shows. GNOME and KDE ask the first time, in a dialog of their
//! own, and remember the answer. A set the system turned down is not asked about again
//! until the set changes, so nothing the page does over and over brings the dialog
//! back.
//!
//! **Before anything else**, a program that is not in a sandbox tells the portal which
//! desktop entry it is (`org.freedesktop.host.portal.Registry`), which is how the dialog
//! names Orden and how the system remembers its keys; a portal too old to have the
//! registry works it out by itself.
//!
//! On threads of its own: every step is a request answered later, and a dialog may wait
//! on the reader for as long as they like. One thread binds, one hears the presses, and
//! a press is answered on the event loop's thread with the compositor's token for it, so
//! quick add's window may take the front.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::AppHandle;
use zbus::blocking::{Connection, MessageIterator};
use zbus::message::Type as Kind;
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};
use zbus::MatchRule;

use super::{trigger, Reach, Which};

const DESKTOP: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
const SHORTCUTS: &str = "org.freedesktop.portal.GlobalShortcuts";
const REQUEST: &str = "org.freedesktop.portal.Request";
const SESSION: &str = "org.freedesktop.portal.Session";
const REGISTRY: &str = "org.freedesktop.host.portal.Registry";
const PROPERTIES: &str = "org.freedesktop.DBus.Properties";

/// The names an installed Orden's desktop entry has had: the AUR's, the Snap's and the
/// Nix flake's, Tauri's own in the .deb and the .rpm, and Flathub's.
const ENTRIES: [&str; 4] = ["nib", "orden", "Orden", "ch.emilvinu.nib"];

/// What the binding thread is asked.
enum Ask {
    /// These keys, and no others.
    Want(BTreeMap<Which, String>),
    /// The system's own page for them.
    Change,
}

static ASKS: OnceLock<Sender<Ask>> = OnceLock::new();

/// The session the presses are heard for now.
static SESSION_NOW: Mutex<Option<String>> = Mutex::new(None);

/// The binding thread, started the first time anything asks: the portal asked whether it
/// is there at all.
pub fn start(app: &AppHandle) {
    let _ = asks(app);
}

fn asks(app: &AppHandle) -> &'static Sender<Ask> {
    ASKS.get_or_init(|| {
        let (asks, asked) = mpsc::channel();
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("nib-portal-keys".into())
            .spawn(move || run(&app, &asked));
        asks
    })
}

/// These keys, and no others, from any app.
pub fn want(app: &AppHandle, wanted: BTreeMap<Which, String>) {
    let _ = asks(app).send(Ask::Want(wanted));
}

/// The system's own page for the keys.
pub fn change(app: &AppHandle) {
    let _ = asks(app).send(Ask::Change);
}

fn run(app: &AppHandle, asked: &Receiver<Ask>) {
    let portal = match Portal::open() {
        Ok(portal) => portal,
        Err(error) => {
            crate::logs::say(
                app,
                "info",
                &format!("global keys: no desktop portal for them here ({error})"),
            );
            super::reached(app, Reach::None, false);
            return;
        }
    };
    crate::logs::say(
        app,
        "info",
        &format!(
            "global keys: the desktop portal, version {}",
            portal.version
        ),
    );
    super::reached(app, Reach::Portal, portal.version >= 2);
    portal.hear(app);

    let mut bound = Bound::default();
    while let Ok(first) = asked.recv() {
        // Only the last of several sets waiting is worth a session.
        let mut wanted = None;
        let mut change = false;
        for ask in std::iter::once(first).chain(asked.try_iter()) {
            match ask {
                Ask::Want(keys) => wanted = Some(keys),
                Ask::Change => change = true,
            }
        }
        if let Some(wanted) = wanted {
            portal.rebind(app, &mut bound, wanted);
        }
        if change {
            if let Some(session) = &bound.session {
                portal.configure(session);
            }
        }
    }
}

/// What was last bound: the keys asked for, and the session holding them, if the system
/// gave one.
#[derive(Default)]
struct Bound {
    keys: BTreeMap<Which, String>,
    session: Option<String>,
}

/// The session bus, and what the portal is on it.
struct Portal {
    bus: Connection,
    /// This connection's name as the portal writes it into a request's path.
    sender: String,
    version: u32,
}

impl Portal {
    fn open() -> zbus::Result<Self> {
        let bus = Connection::session()?;
        register(&bus);
        let reply = bus.call_method(
            Some(DESKTOP),
            PATH,
            Some(PROPERTIES),
            "Get",
            &(SHORTCUTS, "version"),
        )?;
        let body = reply.body();
        let version = u32::try_from(body.deserialize::<OwnedValue>()?)?;
        let sender = bus.unique_name().map_or_else(String::new, |name| {
            name.as_str().trim_start_matches(':').replace('.', "_")
        });
        Ok(Self {
            bus,
            sender,
            version,
        })
    }

    /// Binds `wanted` in a session of its own, in place of what was bound.
    fn rebind(&self, app: &AppHandle, bound: &mut Bound, wanted: BTreeMap<Which, String>) {
        if bound.keys == wanted {
            return;
        }
        if let Some(session) = bound.session.take() {
            self.close(&session);
        }
        set_session(None);
        bound.keys.clone_from(&wanted);
        if wanted.is_empty() {
            super::bound(app, BTreeMap::new(), BTreeSet::new());
            return;
        }
        match self.bind(&wanted) {
            Ok((session, held)) => {
                let refused = wanted
                    .keys()
                    .filter(|which| !held.contains_key(which))
                    .copied()
                    .collect();
                set_session(Some(session.clone()));
                bound.session = Some(session);
                super::bound(app, held, refused);
            }
            Err(error) => {
                crate::logs::say(app, "info", &format!("global keys: not bound ({error})"));
                super::bound(app, BTreeMap::new(), wanted.keys().copied().collect());
            }
        }
    }

    /// A session with `wanted` in it, and what the system holds for each.
    fn bind(
        &self,
        wanted: &BTreeMap<Which, String>,
    ) -> zbus::Result<(String, BTreeMap<Which, String>)> {
        let made = token();
        let options = HashMap::from([
            ("handle_token", Value::from(made.as_str())),
            ("session_handle_token", Value::from(token())),
        ]);
        let (code, results) = self.request("CreateSession", &made, &(options,))?;
        let session = results
            .get("session_handle")
            .and_then(|value| text(value))
            .filter(|_| code == 0)
            .ok_or_else(|| zbus::Error::Failure(format!("no session ({code})")))?;

        let shortcuts: Vec<(&str, HashMap<&str, Value>)> = wanted
            .iter()
            .map(|(which, key)| {
                let mut details =
                    HashMap::from([("description", Value::from(which.description()))]);
                if let Some(preferred) = trigger::preferred(key) {
                    details.insert("preferred_trigger", Value::from(preferred));
                }
                (which.portal_id(), details)
            })
            .collect();
        let asked = token();
        let options = HashMap::from([("handle_token", Value::from(asked.as_str()))]);
        let path = ObjectPath::try_from(session.as_str())?;
        let answer = self.request("BindShortcuts", &asked, &(&path, shortcuts, "", options));
        match answer {
            Ok((0, results)) => Ok((
                session,
                results
                    .get("shortcuts")
                    .map_or_else(BTreeMap::new, |value| triggers(value)),
            )),
            Ok((code, _)) => {
                self.close(&session);
                Err(zbus::Error::Failure(format!("turned down ({code})")))
            }
            Err(error) => {
                self.close(&session);
                Err(error)
            }
        }
    }

    /// Calls `method` and waits for the answer the portal sends on the request it made,
    /// listening before the call so the answer cannot arrive unheard.
    fn request<B>(
        &self,
        method: &str,
        handle: &str,
        body: &B,
    ) -> zbus::Result<(u32, HashMap<String, OwnedValue>)>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        let path = format!("{PATH}/request/{}/{handle}", self.sender);
        let rule = MatchRule::builder()
            .msg_type(Kind::Signal)
            .interface(REQUEST)?
            .member("Response")?
            .path(path.as_str())?
            .build();
        let mut answers = MessageIterator::for_match_rule(rule, &self.bus, Some(4))?;
        self.bus
            .call_method(Some(DESKTOP), PATH, Some(SHORTCUTS), method, body)?;
        let answer = answers
            .next()
            .ok_or_else(|| zbus::Error::Failure("the portal went away".into()))??;
        let body = answer.body();
        body.deserialize()
    }

    /// The system's own page for the session's keys: the portal's second version.
    fn configure(&self, session: &str) {
        if self.version < 2 {
            return;
        }
        let Ok(path) = ObjectPath::try_from(session) else {
            return;
        };
        let options: HashMap<&str, Value> = HashMap::new();
        let _ = self.bus.call_method(
            Some(DESKTOP),
            PATH,
            Some(SHORTCUTS),
            "ConfigureShortcuts",
            &(&path, "", options),
        );
    }

    fn close(&self, session: &str) {
        let _ = self
            .bus
            .call_method(Some(DESKTOP), session, Some(SESSION), "Close", &());
    }

    /// The presses, and the keys the system changed, heard on a thread of their own.
    fn hear(&self, app: &AppHandle) {
        let bus = self.bus.clone();
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("nib-portal-presses".into())
            .spawn(move || {
                if let Err(error) = presses(&bus, &app) {
                    crate::logs::say(&app, "info", &format!("global keys: deaf ({error})"));
                }
            });
    }
}

fn presses(bus: &Connection, app: &AppHandle) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(Kind::Signal)
        .interface(SHORTCUTS)?
        .path(PATH)?
        .build();
    for message in MessageIterator::for_match_rule(rule, bus, Some(64))? {
        let message = message?;
        let header = message.header();
        let body = message.body();
        match header.member().map(|member| member.as_str()) {
            Some("Activated") => {
                let (session, id, _at, options): (
                    OwnedObjectPath,
                    String,
                    u64,
                    HashMap<String, OwnedValue>,
                ) = body.deserialize()?;
                let Some(which) = Which::from_portal(&id).filter(|_| is_now(session.as_str()))
                else {
                    continue;
                };
                let token = options
                    .get("activation_token")
                    .and_then(|value| text(value));
                let pressing = app.clone();
                let _ = app.run_on_main_thread(move || super::pressed(&pressing, which, token));
            }
            Some("ShortcutsChanged") => {
                let (session, shortcuts): (OwnedObjectPath, Listed) = body.deserialize()?;
                if is_now(session.as_str()) {
                    super::changed(app, listed(shortcuts));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Tells the portal which desktop entry this is, where the program is not in a sandbox
/// that already says so. A portal without the registry is one that works it out itself.
fn register(bus: &Connection) {
    if std::env::var_os("FLATPAK_ID").is_some() || std::env::var_os("SNAP").is_some() {
        return;
    }
    let Some(entry) = installed_entry() else {
        return;
    };
    let options: HashMap<&str, Value> = HashMap::new();
    let _ = bus.call_method(
        Some(DESKTOP),
        PATH,
        Some(REGISTRY),
        "Register",
        &(entry.as_str(), options),
    );
}

/// The desktop entry this install put on the system, by the name the portal knows it by.
fn installed_entry() -> Option<String> {
    let home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    let shared = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|dirs| !dirs.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    let folders: Vec<PathBuf> = home
        .into_iter()
        .chain(shared.split(':').map(PathBuf::from))
        .map(|folder| folder.join("applications"))
        .collect();
    first_entry(&folders, |path| path.is_file())
}

fn first_entry(folders: &[PathBuf], exists: impl Fn(&std::path::Path) -> bool) -> Option<String> {
    folders.iter().find_map(|folder| {
        ENTRIES
            .iter()
            .find(|entry| exists(&folder.join(format!("{entry}.desktop"))))
            .map(|entry| (*entry).to_owned())
    })
}

fn set_session(session: Option<String>) {
    *SESSION_NOW.lock().unwrap_or_else(PoisonError::into_inner) = session;
}

fn is_now(session: &str) -> bool {
    SESSION_NOW
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_deref()
        == Some(session)
}

/// A handle no request of this connection has had before.
fn token() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    format!("orden{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// The keys in a list of shortcuts as the portal says them, `a(sa{sv})`, with the key
/// the system shows for each.
fn triggers(value: &Value<'_>) -> BTreeMap<Which, String> {
    let Value::Array(items) = unwrapped(value) else {
        return BTreeMap::new();
    };
    items
        .inner()
        .iter()
        .filter_map(|item| {
            let Value::Structure(pair) = unwrapped(item) else {
                return None;
            };
            let [id, details] = pair.fields() else {
                return None;
            };
            let which = Which::from_portal(&text(id)?)?;
            let said = match unwrapped(details) {
                Value::Dict(details) => details.iter().find_map(|(key, value)| {
                    (text(key).as_deref() == Some("trigger_description"))
                        .then(|| text(value))
                        .flatten()
                }),
                _ => None,
            };
            Some((which, said.unwrap_or_default()))
        })
        .collect()
}

/// A list of shortcuts as a signal carries it, typed.
type Listed = Vec<(String, HashMap<String, OwnedValue>)>;

/// The keys in a list a signal carried, with the key the system shows for each.
fn listed(shortcuts: Listed) -> BTreeMap<Which, String> {
    shortcuts
        .into_iter()
        .filter_map(|(id, details)| {
            let said = details
                .get("trigger_description")
                .and_then(|value| text(value))
                .unwrap_or_default();
            Some((Which::from_portal(&id)?, said))
        })
        .collect()
}

/// A variant's value, however deep the variants go.
fn unwrapped<'v, 'a>(value: &'v Value<'a>) -> &'v Value<'a> {
    match value {
        Value::Value(inner) => unwrapped(inner),
        other => other,
    }
}

fn text(value: &Value<'_>) -> Option<String> {
    String::try_from(unwrapped(value)).ok()
}

impl Which {
    /// The id the portal keeps the key under, which a Hyprland config binds it by.
    fn portal_id(self) -> &'static str {
        match self {
            Self::QuickAdd => "quick-add",
            Self::StopAgents => "stop-agents",
        }
    }

    fn from_portal(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|which| which.portal_id() == id)
    }

    /// What the system's dialog and settings call it.
    fn description(self) -> &'static str {
        match self {
            Self::QuickAdd => "Add a task",
            Self::StopAgents => "Stop agents",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keys_the_system_holds_are_read_with_the_key_it_shows() {
        let said = Value::new(vec![
            (
                "quick-add".to_owned(),
                HashMap::from([(
                    "trigger_description".to_owned(),
                    Value::new("Ctrl+Alt+Space"),
                )]),
            ),
            ("stop-agents".to_owned(), HashMap::new()),
            ("something-else".to_owned(), HashMap::new()),
        ]);
        let held = triggers(&said);
        assert_eq!(
            held.get(&Which::QuickAdd).map(String::as_str),
            Some("Ctrl+Alt+Space")
        );
        assert_eq!(held.get(&Which::StopAgents).map(String::as_str), Some(""));
        assert_eq!(held.len(), 2);
    }

    #[test]
    fn the_first_entry_installed_is_the_one_registered() {
        let folders = [
            PathBuf::from("/home/a/.local/share/applications"),
            PathBuf::from("/usr/share/applications"),
        ];
        let found = first_entry(&folders, |path| {
            path == std::path::Path::new("/usr/share/applications/Orden.desktop")
        });
        assert_eq!(found.as_deref(), Some("Orden"));
        assert_eq!(first_entry(&folders, |_| false), None);
    }

    #[test]
    fn every_key_has_a_portal_id_of_its_own() {
        for which in Which::ALL {
            assert_eq!(Which::from_portal(which.portal_id()), Some(which));
        }
    }
}
