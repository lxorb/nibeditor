//! A shell in a tab: one pseudo terminal per terminal tab, and the commands the window
//! runs it with.
//!
//! A terminal tab is a session, not a file: nothing here touches the spaces folder, and
//! the tab keeps which shell it runs and in which folder in its own words; see
//! `lib/terminal` in the frontend and docs/terminal.md. What is here is the engine: the
//! shells this machine has (shells.rs), one running shell each (session.rs), and what a
//! shell is doing (process.rs).
//!
//! **Who may.** A shell can do anything the person at the keyboard can, so the commands
//! answer the app's own document windows and nobody else, checked here rather than
//! trusted to a list somewhere else:
//!
//! - the webview has to be the page of a window of ours - `main` or `nib-2` and so on -
//!   which a web tab's page (`web-...`), the presenter's window and anything a site could
//!   open never are. A remote origin is refused before it gets this far, by Tauri, and a
//!   web tab has the app's globals taken away besides; see `web_tabs.rs`;
//! - a session belongs to the window that started it, and no other window can type into
//!   it, size it, read it or end it;
//! - a shell is started by an id this module found (see shells.rs): the window cannot
//!   name a program, an argument or a variable of its own. Another machine is the same:
//!   a host's id, which the crate finds in the reader's ssh config or among the hosts it
//!   keeps itself, and the system's `ssh` started for it (remote.rs). A picture carried to
//!   a host is the same id and the same `ssh`, with the picture's bytes the window's only
//!   words of its own (picture.rs).
//!
//! And none of this is reachable from outside the app: the `nib` command and `nib://`
//! links reach verbs, and no verb opens or types into a terminal; see docs/terminal.md.
//!
//! **Nothing outlives its window.** A session ends when its tab closes (the window says
//! so), when the page it belongs to loads again, when its window is destroyed, and when
//! the app exits - so no shell is ever left running with nothing to show it. What a
//! restart brings back is the tab's own words, its folder among them, and its last lines,
//! which are kept in the app's local data folder and never in a space (history.rs).

pub mod history;
pub mod picture;
pub(crate) mod process;
pub mod remote;
mod session;
pub mod shells;
mod ssh_config;

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Webview};

use session::{Out, Session};

/// Every shell running, by the name the window gave its session.
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<String, Held>>,
}

/// One session, and the window it belongs to.
struct Held {
    owner: String,
    session: Session,
    /// Whether the session is another machine's: `ssh` itself rather than a shell.
    remote: bool,
}

impl Held {
    /// Whether ending it would stop something: a program besides the shell, or - on
    /// another machine, whose programs cannot be seen from here - the connection
    /// itself, as macOS Terminal and iTerm2 count an `ssh` among the jobs that ask.
    fn busy(&self) -> bool {
        self.remote || self.session.busy()
    }
}

/// What `pty_spawn` answers: the shell's process id, which the window keeps for nothing
/// but the probe that checks no shell outlives its tab.
#[derive(Serialize)]
pub struct Spawned {
    pid: Option<u32>,
}

/// The one answer every refusal gets. The window never asks for anything it may not
/// have, so this is only ever read by whoever was trying.
const REFUSED: &str = "not a window of this app";

impl Terminals {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Runs `with` on a session this window owns.
    fn with<T>(
        &self,
        owner: &str,
        id: &str,
        with: impl FnOnce(&Session) -> T,
    ) -> Result<T, String> {
        let sessions = self.lock();
        match sessions.get(id) {
            Some(held) if held.owner == owner => Ok(with(&held.session)),
            _ => Err(format!("no terminal {id}")),
        }
    }

    /// Takes out every session one window owns - or every session, for `None` - and ends
    /// them off this thread, since closing a Windows console waits for it.
    fn end_where(&self, owner: Option<&str>) {
        let ending: Vec<Held> = {
            let mut sessions = self.lock();
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, held)| owner.is_none_or(|owner| held.owner == owner))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        if ending.is_empty() {
            return;
        }

        std::thread::spawn(move || {
            for held in ending {
                held.session.end();
            }
        });
    }
}

/// The state this module keeps, and the page load that lets go of a page's shells: a
/// window reloaded is a window whose tabs are about to be made again from the session,
/// and the old shells have nobody left to show them.
pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder
        .manage(Terminals::default())
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(terminals) = webview.try_state::<Terminals>() {
                    terminals.end_where(Some(webview.label()));
                }
            }
        })
}

/// A window has gone, and its shells with it.
pub fn window_gone(app: &AppHandle, label: &str) {
    if let Some(terminals) = app.try_state::<Terminals>() {
        terminals.end_where(Some(label));
    }
}

/// The app is ending: every shell goes, and is waited for, so that nothing is still
/// running once the process has gone.
pub fn end_all(app: &AppHandle) {
    let Some(terminals) = app.try_state::<Terminals>() else {
        return;
    };
    let ending: Vec<Held> = terminals.lock().drain().map(|(_, held)| held).collect();
    for held in ending {
        held.session.end();
    }
}

/// The window this call came from, when it is one of ours; see the top of this file.
fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err(REFUSED.to_owned())
    }
}

/// A name the window may give a session: short, and nothing but letters, digits, `-`
/// and `_`, since it is only ever a key.
fn usable(id: &str) -> Result<(), String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(())
    } else {
        Err("not a terminal name".to_owned())
    }
}

/// The shells this machine has, the platform's default first. Found the first time it is
/// asked, which is the first time a chooser needs the list, and never at launch.
#[tauri::command(async)]
pub fn terminal_shells(webview: Webview) -> Result<Vec<shells::Offered>, String> {
    owner(&webview)?;
    Ok(shells::detected()
        .iter()
        .map(shells::Shell::offered)
        .collect())
}

/// Starts a shell, by one of the ids `terminal_shells` answered, in a folder where there
/// is one, at the size the tab is. What it prints arrives on `output` as bytes, at most
/// once a frame, and the last message is `{ exit }`.
#[tauri::command(async)]
pub fn pty_spawn(
    webview: Webview,
    id: String,
    shell: String,
    folder: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<Spawned, String> {
    let owner = owner(&webview)?;
    usable(&id)?;
    let terminals = webview.state::<Terminals>();
    if terminals.lock().contains_key(&id) {
        return Err(format!("terminal {id} is already running"));
    }

    // Another machine is a host the crate found, by its id, as a shell is; see remote.rs.
    let host = remote::host_id(&shell);
    let remote = host.is_some();
    let launch = match host {
        Some(host) => remote::connect(&webview, host)?,
        None => shells::find(&shell)
            .ok_or_else(|| format!("no shell {shell} here"))?
            .launch(folder.as_deref(), &shells::ThisMachine),
    };
    let (session, started) = session::Session::open(&launch, cols, rows)?;
    let pid = session.pid();

    terminals.lock().insert(
        id.clone(),
        Held {
            owner,
            session,
            remote,
        },
    );

    let app = webview.app_handle().clone();
    started.run(
        Box::new(move |out| {
            let _ = match out {
                Out::Bytes(bytes) => output.send(InvokeResponseBody::Raw(bytes)),
                // The last message, and the only one that is not bytes.
                Out::Exit(exit) => {
                    output.send(InvokeResponseBody::Json(format!("{{\"exit\":{exit}}}")))
                }
            };
        }),
        move |mine| {
            let Some(terminals) = app.try_state::<Terminals>() else {
                return;
            };
            let gone = {
                let mut sessions = terminals.lock();
                let this = sessions.get(&id).is_some_and(|held| mine(&held.session));
                if this {
                    sessions.remove(&id)
                } else {
                    None
                }
            };
            // Dropped here, on the waiter's own thread: closing the console is what
            // lets the reader reach the end.
            drop(gone);
        },
    );

    Ok(Spawned { pid })
}

/// Keystrokes, and what xterm.js answers the shell with. `binary` is for the mouse
/// reports that are bytes rather than text, one character a byte.
#[tauri::command]
pub fn pty_write(webview: Webview, id: String, data: String, binary: bool) -> Result<(), String> {
    let owner = owner(&webview)?;
    let bytes = if binary {
        data.chars()
            .map(|one| u8::try_from(u32::from(one)).unwrap_or(b'?'))
            .collect()
    } else {
        data.into_bytes()
    };
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.write(bytes))
}

/// The tab is another size.
#[tauri::command]
pub fn pty_resize(webview: Webview, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.resize(cols, rows))?
}

/// The window has drawn this much of what it was sent; see `MOST_UNSEEN` in session.rs.
#[tauri::command]
pub fn pty_seen(webview: Webview, id: String, bytes: usize) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.seen(bytes))
}

/// Whether something besides the shell is running, asked before the tab closes and
/// before the app quits; see `Held::busy`.
#[tauri::command(async)]
pub fn pty_busy(webview: Webview, id: String) -> Result<bool, String> {
    let owner = owner(&webview)?;
    let sessions = webview.state::<Terminals>();
    let sessions = sessions.lock();
    match sessions.get(&id) {
        Some(held) if held.owner == owner => Ok(held.busy()),
        _ => Err(format!("no terminal {id}")),
    }
}

/// What is running in front of the shell, by name, which the tab is named for; nothing
/// while the shell itself is. See process.rs.
#[tauri::command(async)]
pub fn pty_program(webview: Webview, id: String) -> Result<Option<String>, String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, Session::program)
}

/// Which folder the shell is in, where the system can say without the shell's help.
#[tauri::command(async)]
pub fn pty_folder(webview: Webview, id: String) -> Result<Option<String>, String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, Session::folder)
}

/// The tab has closed, or is starting its shell again: this one goes.
#[tauri::command]
pub fn pty_kill(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let terminals = webview.state::<Terminals>();
    let held = {
        let mut sessions = terminals.lock();
        match sessions.get(&id) {
            Some(held) if held.owner == owner => sessions.remove(&id),
            _ => None,
        }
    };

    if let Some(held) = held {
        std::thread::spawn(move || held.session.end());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_name_is_a_key_and_nothing_else() {
        assert!(usable("a1b2-c3_d4").is_ok());
        for bad in ["", "../x", "a b", "a;b", &"x".repeat(81)] {
            assert!(usable(bad).is_err(), "{bad:?} was taken");
        }
    }

    /// A shell at its prompt, started the way a tab starts one.
    fn idle_shell() -> Session {
        let (program, args) = if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
            (
                std::path::PathBuf::from(root).join(r"System32\cmd.exe"),
                vec!["/q".to_owned()],
            )
        } else {
            (std::path::PathBuf::from("/bin/sh"), Vec::new())
        };
        let launch = shells::Launch {
            program,
            args,
            folder: Some(std::env::temp_dir()),
            env: Vec::new(),
        };
        let (session, started) = Session::open(&launch, 80, 24).expect("a shell");
        started.run(Box::new(|_| {}), |_| {});
        session
    }

    /// Another machine's terminal is busy for as long as it is connected, whatever runs
    /// there; a shell here only while something besides it runs.
    #[test]
    fn a_remote_terminal_is_busy_while_it_is_connected() {
        let here = Held {
            owner: "main".to_owned(),
            session: idle_shell(),
            remote: false,
        };
        assert!(!here.busy());
        here.session.end();

        let there = Held {
            owner: "main".to_owned(),
            session: idle_shell(),
            remote: true,
        };
        assert!(there.busy());
        there.session.end();
    }
}
