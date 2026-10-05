//! The stop (docs/agent-native.md 9.5).
//!
//! **The stop** cancels every call in flight, pauses every agent and says so; the tabs
//! are kept so what happened can be looked at, and a second stop closes them. The key
//! that presses it from any app is the activity lane's, in the keyboard registry; this
//! is `agents_stop`, which that key, the tray's row and every indicator's Stop call.
//!
//! **One agent** can be stopped too, from its row in the activity panel or the menu of a
//! tab it is acting in: its next call is refused as a stopped call is, and every other
//! agent carries on. What it has in flight finishes, because the count below is
//! everybody's.
//!
//! Nothing else pauses an agent. The reader pressing, scrolling or typing in a tab an
//! agent is acting in takes nothing from it (7.3): both act on the one page, and the
//! agent reads the page as it then is.
//!
//! A call in flight is cancelled by the count it started under changing: every wait in
//! a call asks `cancelled` between its steps, so a stop is felt within one step.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter as _};

use super::verbs::{Event, EVENT};

/// Which stop the app is on; a call remembers the one it started under.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Whether every agent is paused by the stop.
static STOPPED: AtomicBool = AtomicBool::new(false);

/// The agents stopped one at a time.
static HALTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

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

/// Whether an agent is stopped: by the stop for everyone, or on its own.
pub fn stopped_for(agent: &str) -> bool {
    stopped()
        || HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|all| all.contains(agent))
}

/// The agents stopped one at a time.
pub fn halted() -> Vec<String> {
    HALTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|all| all.iter().cloned().collect())
        .unwrap_or_default()
}

/// Stops one agent, and says so: its next call is refused until it is resumed.
pub fn halt(app: &AppHandle, agent: &str) {
    let fresh = HALTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert(agent.to_string());
    if fresh {
        let _ = app.emit(
            EVENT,
            Event::Paused {
                agent: agent.to_string(),
            },
        );
    }
}

/// Presses the stop. The first press pauses everything and cancels what is in flight;
/// a press while everything is already stopped closes every agent's tabs too. Answers
/// whether the tabs were closed.
pub fn stop(app: &AppHandle) -> bool {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let again = STOPPED.swap(true, Ordering::SeqCst);
    #[cfg(any(windows, feature = "cef"))]
    if again {
        super::tabs::close_all(app, None);
    }
    let _ = app.emit(EVENT, Event::Stopped { closed: again });
    again
}

/// Resumes: the stop and every agent's own, or one agent's own.
pub fn resume(app: &AppHandle, agent: Option<&str>) {
    {
        let mut halted = HALTED.lock().unwrap_or_else(PoisonError::into_inner);
        match (agent, halted.as_mut()) {
            (None, _) => {
                STOPPED.store(false, Ordering::SeqCst);
                *halted = None;
            }
            (Some(agent), Some(all)) => {
                all.remove(agent);
            }
            (Some(_), None) => {}
        }
    }
    let _ = app.emit(
        EVENT,
        Event::Resumed {
            agent: agent.unwrap_or_default().to_string(),
        },
    );
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
    fn one_agent_stopped_is_that_agent_and_nobody_else() {
        HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashSet::new)
            .insert("halting".into());
        assert!(stopped_for("halting"));
        assert!(!stopped_for("someone-else"));
        assert!(halted().contains(&"halting".to_string()));
        if let Some(all) = HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            all.remove("halting");
        }
        assert!(!stopped_for("halting"));
    }
}
