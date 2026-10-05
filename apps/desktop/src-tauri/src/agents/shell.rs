//! What the app around the window does while an agent is connected (docs/agent-native.md
//! 9.3, 9.5, open question 6): the stop from any app, the tray's rows, one notification
//! per question, and the window that holds the agents' pages kept when it is closed.
//!
//! **Connected** is an agent that called in the last ten minutes and did not say
//! goodbye: the ten minutes the crate keeps a gone agent's tabs for (tabs.rs). The list
//! is said to the window on `nib://agent` whenever it changes, and everything here
//! follows it - nothing is registered, drawn or kept before the first agent, and nothing
//! stays after the last one goes.
//!
//! **The words are the window's.** The tray's rows and the notifications are in the
//! reader's language, which only the window has catalogues for, so it hands them over
//! with the stop's key (`agents_shell`); until it has, they are English.
//!
//! **On the event loop's own thread.** The tray, the key and a plugin added at run time
//! each have to live there: a hot key registered from another thread is one whose
//! presses go to a thread with no loop to hear them.
//!
//! **Never in a probe's.** A run whose windows are sent off the screen is a drive's, and
//! a tray icon or a notification is on the screen of whoever is at the machine: neither
//! is made there (`placement::away`).
//!
//! **The one tray.** Reminders keep nib in the same tray (docs/tasks.md decision 6): the
//! window asks for it with `tray_keep` while a reminder waits or the reader turned it on,
//! and the tray is then up with Open and Quit, and the stop as well while an agent is
//! connected. Closing the window hides it while either wants the tray.

use std::collections::HashMap;
use std::sync::{Mutex, Once, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter as _, Listener as _, Manager as _};

use super::verbs::{Category, Event, EVENT};

/// How long an agent counts as connected after its last call.
const CONNECTED_FOR: Duration = Duration::from_secs(10 * 60);

/// How often the list is looked at again for an agent that went quiet.
const LOOK_EVERY: Duration = Duration::from_secs(30);

/// How long a window hidden for the agents waits, once the last of them has gone,
/// before it is closed: long enough for the window to have heard that nobody is
/// connected, so its close button's handler lets it go.
const LET_GO_AFTER: Duration = Duration::from_secs(2);

/// The words the tray and the notifications say, in the reader's language.
#[derive(Clone, Debug, Deserialize)]
pub struct Words {
    /// The row that brings the window back.
    #[cfg_attr(
        not(any(windows, target_os = "macos")),
        allow(dead_code, reason = "a tray's row, and Linux has no tray here")
    )]
    pub show: String,
    /// The row that stops every agent.
    #[cfg_attr(
        not(any(windows, target_os = "macos")),
        allow(dead_code, reason = "a tray's row, and Linux has no tray here")
    )]
    pub stop: String,
    /// The row that quits.
    #[cfg_attr(
        not(any(windows, target_os = "macos")),
        allow(dead_code, reason = "a tray's row, and Linux has no tray here")
    )]
    pub quit: String,
    /// What the stop says.
    pub stopped: String,
    /// What the second stop says.
    pub closed: String,
    /// What closing the window says, once.
    pub hidden: String,
    /// A client asking to pair, with `{client}` in it.
    pub pairing: String,
}

impl Default for Words {
    fn default() -> Self {
        Self {
            show: "Open".into(),
            stop: "Stop agents".into(),
            quit: "Quit".into(),
            stopped: "Agents stopped".into(),
            closed: "Agent tabs closed".into(),
            hidden: "nibeditor is still running for your agents".into(),
            pairing: "{client} wants to connect".into(),
        }
    }
}

/// What the shell holds.
#[derive(Default)]
struct Shell {
    /// Each agent's last call.
    last: HashMap<String, Instant>,
    /// The list as it was last said.
    said: Vec<String>,
    /// The words.
    words: Words,
    /// The stop's key, as the window last asked for it.
    key: Option<String>,
    /// The key the system holds for the stop now.
    registered: Option<String>,
    /// Whether the global shortcut plugin is in the app yet.
    shortcuts: bool,
    /// The window hidden for the agents, by its label.
    hidden: Option<String>,
    /// Whether closing the window has been said this run.
    told_hidden: bool,
    /// Whether the window keeps nib in the tray for its own sake: a reminder waiting,
    /// or the reader's choice (`tray_keep`).
    kept: bool,
}

static SHELL: Mutex<Option<Shell>> = Mutex::new(None);

static STARTED: Once = Once::new();

fn with<T>(run: impl FnOnce(&mut Shell) -> T) -> T {
    run(SHELL
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(Shell::default))
}

/// The window the agents' pages live in: the reader's first window.
pub fn host(app: &AppHandle) -> Option<tauri::Window> {
    app.get_window("main")
        .or_else(|| crate::launch::document_windows(app).into_iter().next())
}

/// Starts the shell on the first agent request: the notifications, and the clock that
/// notices an agent gone quiet. Nothing of it exists before.
pub fn start(app: &AppHandle) {
    STARTED.call_once(|| {
        let notifying = app.clone();
        let _ = app.run_on_main_thread(move || {
            notifications(&notifying);
        });

        let hearing = app.clone();
        app.listen_any(EVENT, move |event| {
            if let Ok(event) = serde_json::from_str::<Event>(event.payload()) {
                news(&hearing, event);
            }
        });

        let looking = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(LOOK_EVERY);
            changed(&looking);
        });
    });
}

/// An agent called: any verb, the crate's or the window's.
pub fn heard(app: &AppHandle, agent: &str) {
    start(app);
    let fresh = with(|shell| {
        shell
            .last
            .insert(agent.to_string(), Instant::now())
            .is_none_or(|at| at.elapsed() >= CONNECTED_FOR)
    });
    if fresh {
        changed(app);
    }
}

/// An agent said goodbye.
pub fn bye(app: &AppHandle, agent: &str) {
    with(|shell| {
        shell.last.remove(agent);
    });
    changed(app);
}

/// The agents connected now, by id, so two lists of the same agents are the same list.
pub fn connected() -> Vec<String> {
    with(|shell| connected_in(shell, Instant::now()))
}

fn connected_in(shell: &Shell, now: Instant) -> Vec<String> {
    let mut connected: Vec<String> = shell
        .last
        .iter()
        .filter(|(_, at)| now.saturating_duration_since(**at) < CONNECTED_FOR)
        .map(|(id, _)| id.clone())
        .collect();
    connected.sort();
    connected
}

/// Says the list when it changed, and puts the shell in step with it.
fn changed(app: &AppHandle) {
    let now = with(|shell| {
        let now = connected_in(shell, Instant::now());
        if now == shell.said {
            return None;
        }
        shell.said.clone_from(&now);
        Some(now)
    });
    let Some(agents) = now else {
        return;
    };
    let _ = app.emit(EVENT, Event::Connected { agents });
    settle(app);
}

/// The tray, the key and the kept window, as the list and the words say they should
/// be, on the event loop's thread.
fn settle(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let (agents, kept, words) =
            with(|shell| (!shell.said.is_empty(), shell.kept, shell.words.clone()));
        tray(&handle, agents || kept, agents, &words);
        key(&handle, agents);
        if !agents && !kept {
            let_go(&handle);
        }
    });
}

/// The rows of the tray the window keeps nib in, in the reader's words.
#[derive(Debug, Deserialize)]
pub struct TrayWords {
    show: String,
    quit: String,
}

/// Whether the window keeps nib in the tray for its own sake: a reminder is waiting, or
/// the reader asked for it (docs/tasks.md decision 6). With it, closing the window hides
/// it, and Quit is in the tray.
#[tauri::command]
pub fn tray_keep(
    webview: tauri::Webview,
    app: AppHandle,
    on: bool,
    words: TrayWords,
) -> Result<(), String> {
    super::from_the_app(&webview)?;
    with(|shell| {
        shell.kept = on;
        shell.words.show = words.show;
        shell.words.quit = words.quit;
    });
    settle(&app);
    Ok(())
}

/// Whether anything keeps nib in the tray now.
pub fn in_tray() -> bool {
    with(|shell| shell.kept || !shell.said.is_empty())
}

/// The window's words and the stop's key, in the system's own notation.
#[tauri::command]
pub fn agents_shell(
    webview: tauri::Webview,
    app: AppHandle,
    key: Option<String>,
    words: Words,
) -> Result<(), String> {
    super::from_the_app(&webview)?;
    with(|shell| {
        shell.key = key;
        shell.words = words;
    });
    settle(&app);
    Ok(())
}

/// Whether closing the asking window would end the agents' pages, because they live in
/// it; with `hide`, the window hidden rather than closed, and said once (open question
/// 6). The tray has Open and Quit, which is the way back and the way out, so a desktop
/// with no tray here keeps the ordinary close.
#[tauri::command]
pub fn agents_hold(webview: tauri::Webview, app: AppHandle, hide: bool) -> Result<bool, String> {
    super::from_the_app(&webview)?;
    let window = webview.window();
    let holds = cfg!(any(windows, target_os = "macos"))
        && host(&app).is_some_and(|host| host.label() == window.label());
    if !hide {
        return Ok(holds);
    }
    // Nothing to keep it for any more: the window closes the ordinary way.
    if !holds || !in_tray() {
        return Ok(false);
    }

    let _ = window.hide();
    let (say, words) = with(|shell| {
        shell.hidden = Some(window.label().to_string());
        // Said for the agents, whose pages are why it stays; a window kept for the
        // reader's own reminders goes to the tray the way any tray app's does.
        let say = !shell.told_hidden && !shell.said.is_empty();
        shell.told_hidden |= say;
        (say, shell.words.clone())
    });
    if say {
        notify(&app, words.hidden, String::new());
    }
    Ok(true)
}

/// A window hidden for agents that are all gone now: closed, the ordinary way, so what
/// it owes the disk is written and the app ends if it was the last.
fn let_go(app: &AppHandle) {
    let Some(label) = with(|shell| shell.hidden.take()) else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LET_GO_AFTER);
        if in_tray() {
            return;
        }
        if let Some(window) = handle.get_window(&label) {
            if !window.is_visible().unwrap_or(true) {
                let _ = window.close();
            }
        }
    });
}

/// What the crate said, as a notification where one is due: a question while nib is
/// not in front, and the stop.
fn news(app: &AppHandle, event: Event) {
    let words = with(|shell| shell.words.clone());
    let (title, body) = match event {
        Event::Asked { approval } if approval.category == Category::Pairing => (
            words.pairing.replace("{client}", &approval.summary),
            String::new(),
        ),
        Event::Asked { approval } => (approval.name, approval.summary),
        Event::Stopped { closed } => (
            if closed { words.closed } else { words.stopped },
            String::new(),
        ),
        _ => return,
    };
    // Off the thread that said it, which may be the event loop's own: whether a window
    // is in front is asked of the loop.
    let app = app.clone();
    std::thread::spawn(move || {
        let in_front = crate::launch::document_windows(&app)
            .iter()
            .any(|window| window.is_focused().unwrap_or(false));
        if !in_front {
            notify(&app, title, body);
        }
    });
}

/// Whether the notification plugin is in the app: added the first time anything shows a
/// notification - an agent's question, a reminder the page rings itself - and never at
/// launch. On the event loop's thread, which is where a plugin is added at run time.
pub fn notifications(app: &AppHandle) -> bool {
    static ADDED: OnceLock<bool> = OnceLock::new();
    *ADDED.get_or_init(|| app.plugin(tauri_plugin_notification::init()).is_ok())
}

/// One system notification, where the plugin is in the app and this run is nobody's
/// probe.
pub fn notify(app: &AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt as _;

    if crate::placement::away().is_some() || !notifications(app) {
        return;
    }
    let mut built = app.notification().builder().title(title);
    if !body.is_empty() {
        built = built.body(body);
    }
    let _ = built.show();
}

/// The stop's key from any app, while an agent is connected and never otherwise. The
/// global shortcut plugin is added the first time it is needed, on this thread.
fn key(app: &AppHandle, on: bool) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};

    let (wanted, registered, added) = with(|shell| {
        let wanted = if on { shell.key.clone() } else { None };
        (wanted, shell.registered.clone(), shell.shortcuts)
    });
    if wanted == registered {
        return;
    }
    if let Some(old) = &registered {
        if added {
            let _ = app.global_shortcut().unregister(old.as_str());
        }
    }
    let mut held = None;
    if let Some(new) = wanted {
        let ready = added || crate::hotkeys::plugin_added(app);
        with(|shell| shell.shortcuts = ready);
        let stopping = ready
            && app
                .global_shortcut()
                .on_shortcut(new.as_str(), |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        super::stop::stop(app);
                    }
                })
                .is_ok();
        if stopping {
            held = Some(new);
        }
    }
    with(|shell| shell.registered = held);
}

/// The tray's id.
#[cfg(any(windows, target_os = "macos"))]
const TRAY: &str = "nib-agents";

/// The tray's rows, by id.
#[cfg(any(windows, target_os = "macos"))]
const OPEN: &str = "nib-agents-open";
#[cfg(any(windows, target_os = "macos"))]
const STOP: &str = "nib-agents-stop";
#[cfg(any(windows, target_os = "macos"))]
const QUIT: &str = "nib-agents-quit";

/// The tray icon while an agent is connected or the window keeps nib there: Open, the
/// stop while there are agents to stop, Quit. A press on the icon itself is Open, as it
/// is on every tray icon that stands for a window.
#[cfg(any(windows, target_os = "macos"))]
fn tray(app: &AppHandle, on: bool, agents: bool, words: &Words) {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    if !on || crate::placement::away().is_some() {
        let _ = app.remove_tray_by_id(TRAY);
        return;
    }

    let Ok(menu) = rows(app, words, agents) else {
        return;
    };
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_menu(Some(menu));
        return;
    }

    let mut built = TrayIconBuilder::with_id(TRAY)
        .tooltip("nibeditor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => open(app),
            STOP => {
                super::stop::stop(app);
            }
            QUIT => crate::lifecycle::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        built = built.icon(icon.clone());
    }
    let _ = built.build(app);
}

/// The tray's rows, in the reader's words.
#[cfg(any(windows, target_os = "macos"))]
fn rows<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    words: &Words,
    agents: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};

    let open = MenuItem::with_id(app, OPEN, &words.show, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, STOP, &words.stop, true, None::<&str>)?;
    let line = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT, &words.quit, true, None::<&str>)?;
    let mut items: Vec<&dyn IsMenuItem<R>> = vec![&open];
    if agents {
        items.push(&stop);
    }
    items.push(&line);
    items.push(&quit);
    Menu::with_items(app, &items)
}

/// The window back, from the tray: shown, and brought forward the way a second launch
/// brings it (never a probe's, which stays where it was put).
#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn open(app: &AppHandle) {
    if let Some(window) = host(app) {
        let _ = window.show();
        crate::placement::raised(&window);
    }
    with(|shell| shell.hidden = None);
}

/// No tray on Linux: the system's tray library is not everywhere, and a desktop without
/// it would lose the app to a failed load. The window closes the ordinary way there.
#[cfg(not(any(windows, target_os = "macos")))]
fn tray(_app: &AppHandle, _on: bool, _agents: bool, _words: &Words) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_is_connected_for_ten_minutes_after_its_last_call() {
        let now = Instant::now();
        let mut shell = Shell::default();
        shell.last.insert("claude".into(), now);
        shell.last.insert("codex".into(), now);
        assert_eq!(connected_in(&shell, now), ["claude", "codex"]);

        let later = now + CONNECTED_FOR;
        shell.last.insert("codex".into(), later);
        assert_eq!(connected_in(&shell, later), ["codex"]);
    }

    #[test]
    fn the_words_are_english_until_the_window_says() {
        let words = Words::default();
        assert_eq!(
            words.pairing.replace("{client}", "Codex"),
            "Codex wants to connect"
        );
        let said: Words = serde_json::from_value(serde_json::json!({
            "show": "Öffnen", "stop": "Agenten anhalten", "quit": "Beenden",
            "stopped": "Agenten angehalten", "closed": "Agenten-Tabs geschlossen",
            "hidden": "nibeditor läuft weiter", "pairing": "{client} möchte sich verbinden",
        }))
        .expect("the window's words");
        assert_eq!(said.stop, "Agenten anhalten");
    }
}
