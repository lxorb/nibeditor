//! The stop, and every other reason an agent is not acting (docs/agent-native.md 7.3,
//! 9.5).
//!
//! **The stop** cancels every call in flight, pauses every agent and says so; the tabs
//! are kept so what happened can be looked at, and a second stop closes them. The key
//! that presses it from any app is the activity lane's, in the keyboard registry; this
//! is `agents_stop`, which that key, the tray's row and every indicator's Stop call.
//!
//! **The reader** pauses an agent on one of their own tabs by pressing or typing in it,
//! and a takeover pauses it on the tab the reader is doing a step in. Nothing gives a
//! pause back by itself (open question 5): the reader's press on the agent's mark does,
//! which is `agents_resume`.
//!
//! A call in flight is cancelled by the count it started under changing: every wait in
//! a call asks `cancelled` between its steps, so a stop is felt within one step.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter as _};

use super::verbs::{Event, PausedBy, EVENT};

/// Which stop the app is on; a call remembers the one it started under.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Whether every agent is paused by the stop.
static STOPPED: AtomicBool = AtomicBool::new(false);

/// Pauses on single tabs: (agent, tab) and why.
static PAUSED: Mutex<Option<HashMap<(String, String), PausedBy>>> = Mutex::new(None);

/// The stop a call starts under.
pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

/// Whether the stop was pressed since a call started.
pub fn cancelled(since: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) != since
}

/// Whether every agent is paused by the stop.
pub fn stopped() -> bool {
    STOPPED.load(Ordering::SeqCst)
}

/// Why an agent is paused on a tab, if it is.
pub fn paused_on(agent: &str, tab: &str) -> Option<PausedBy> {
    PAUSED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(&(agent.to_string(), tab.to_string()))
        .copied()
}

/// The tabs an agent is paused on.
pub fn paused_tabs(agent: &str) -> Vec<String> {
    PAUSED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|all| {
            all.keys()
                .filter(|(one, _)| one == agent)
                .map(|(_, tab)| tab.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Pauses an agent on one tab, and says so. Once: a pause that is already there is not
/// said again.
pub fn pause(app: &AppHandle, agent: &str, tab: &str, by: PausedBy) {
    let fresh = PAUSED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashMap::new)
        .insert((agent.to_string(), tab.to_string()), by)
        .is_none();
    if fresh {
        let _ = app.emit(
            EVENT,
            Event::Paused {
                agent: agent.to_string(),
                tab: Some(tab.to_string()),
                by,
            },
        );
    }
}

/// Every agent paused on a tab by the reader: the agents acting there.
pub fn reader_took(app: &AppHandle, tab: &str, agents: &[String]) {
    for agent in agents {
        pause(app, agent, tab, PausedBy::Reader);
    }
}

/// Presses the stop. The first press pauses everything and cancels what is in flight;
/// a press while everything is already stopped closes every agent's tabs too. Answers
/// whether the tabs were closed.
pub fn stop(app: &AppHandle) -> bool {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let again = STOPPED.swap(true, Ordering::SeqCst);
    #[cfg(all(windows, not(feature = "cef")))]
    if again {
        super::tabs::close_all(app, None);
    }
    let _ = app.emit(EVENT, Event::Stopped { closed: again });
    again
}

/// Gives a pause back: the stop's, or one agent's on one tab, or all of one agent's.
pub fn resume(app: &AppHandle, agent: Option<&str>, tab: Option<&str>) {
    if agent.is_none() && tab.is_none() {
        STOPPED.store(false, Ordering::SeqCst);
    }
    let given: Vec<(String, String)> = {
        let mut held = PAUSED.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(all) = held.as_mut() else {
            return said_resumed(app, agent, tab, &[]);
        };
        let matching: Vec<(String, String)> = all
            .keys()
            .filter(|(one, on)| {
                agent.is_none_or(|agent| agent == one) && tab.is_none_or(|tab| tab == on)
            })
            .cloned()
            .collect();
        for key in &matching {
            all.remove(key);
        }
        matching
    };
    said_resumed(app, agent, tab, &given);
}

fn said_resumed(
    app: &AppHandle,
    agent: Option<&str>,
    tab: Option<&str>,
    given: &[(String, String)],
) {
    if given.is_empty() {
        let _ = app.emit(
            EVENT,
            Event::Resumed {
                agent: agent.unwrap_or_default().to_string(),
                tab: tab.map(str::to_string),
            },
        );
        return;
    }
    for (agent, tab) in given {
        let _ = app.emit(
            EVENT,
            Event::Resumed {
                agent: agent.clone(),
                tab: Some(tab.clone()),
            },
        );
    }
}

/// Forgets every pause on a tab that closed.
pub fn tab_gone(tab: &str) {
    if let Some(all) = PAUSED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.retain(|(_, on), _| on != tab);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_is_cancelled_by_the_count_moving_on() {
        let started = generation();
        assert!(!cancelled(started));
        GENERATION.fetch_add(1, Ordering::SeqCst);
        assert!(cancelled(started));
    }

    #[test]
    fn a_pause_is_per_agent_and_tab_until_given_back() {
        PAUSED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashMap::new)
            .insert(("pausing".into(), "t1".into()), PausedBy::Reader);
        assert_eq!(paused_on("pausing", "t1"), Some(PausedBy::Reader));
        assert_eq!(paused_on("pausing", "t2"), None);
        assert_eq!(paused_on("other", "t1"), None);
        assert_eq!(paused_tabs("pausing"), ["t1"]);
        tab_gone("t1");
        assert_eq!(paused_on("pausing", "t1"), None);
    }
}
