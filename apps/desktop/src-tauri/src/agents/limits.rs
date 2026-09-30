//! How fast an agent may go: calls a minute and navigations a minute, as its grant says
//! (docs/agent-native.md 9.5). Over either, a call waits for room rather than failing,
//! the way a browser's own throttle does, and a burst of waiting is one line in the log
//! rather than a thousand.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// The window the counts are over.
const MINUTE: Duration = Duration::from_secs(60);

/// What is counted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Counted {
    /// Every call.
    Calls,
    /// Every page an agent sends a tab to.
    Navigations,
}

/// The moments of the last minute's calls and navigations, by agent.
#[derive(Default)]
pub struct Counts {
    seen: HashMap<(String, Counted), VecDeque<Instant>>,
    /// When each agent was last told to wait, so a burst is said once a minute.
    said: HashMap<String, Instant>,
}

impl Counts {
    /// How long this one has to wait before it fits under `most` a minute, counting it
    /// if it fits now.
    pub fn admit(
        &mut self,
        agent: &str,
        what: Counted,
        most: u32,
        now: Instant,
    ) -> Option<Duration> {
        let most = usize::try_from(most.max(1)).unwrap_or(usize::MAX);
        let moments = self.seen.entry((agent.to_string(), what)).or_default();
        while moments
            .front()
            .is_some_and(|at| now.duration_since(*at) >= MINUTE)
        {
            moments.pop_front();
        }
        if moments.len() < most {
            moments.push_back(now);
            return None;
        }
        moments
            .front()
            .map(|oldest| MINUTE.saturating_sub(now.duration_since(*oldest)))
    }

    /// Whether this wait is the first of a burst, which is the one the log hears about.
    pub fn first_of_burst(&mut self, agent: &str, now: Instant) -> bool {
        let fresh = self
            .said
            .get(agent)
            .is_none_or(|at| now.duration_since(*at) >= MINUTE);
        if fresh {
            self.said.insert(agent.to_string(), now);
        }
        fresh
    }
}

/// Every agent's counts.
static COUNTS: Mutex<Option<Counts>> = Mutex::new(None);

/// Waits until the agent has room for one more, and counts it. Answers whether it had
/// to wait and was the first of a burst to, which the caller writes down once. Gives up
/// waiting when `stopped` says so.
pub fn wait_for_room(
    agent: &str,
    what: Counted,
    most: u32,
    stopped: impl Fn() -> bool,
) -> Result<bool, ()> {
    let mut first = false;
    loop {
        let wait = {
            let mut all = COUNTS.lock().unwrap_or_else(PoisonError::into_inner);
            let counts = all.get_or_insert_with(Counts::default);
            let now = Instant::now();
            let wait = counts.admit(agent, what, most, now);
            if wait.is_some() && !first {
                first = counts.first_of_burst(agent, now);
            }
            wait
        };
        let Some(wait) = wait else {
            return Ok(first);
        };
        if stopped() {
            return Err(());
        }
        std::thread::sleep(wait.min(Duration::from_millis(250)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_past_the_limit_wait_for_the_oldest_to_leave_the_minute() {
        let mut counts = Counts::default();
        let start = Instant::now();
        for _ in 0..3 {
            assert_eq!(counts.admit("a", Counted::Calls, 3, start), None);
        }
        let later = start + Duration::from_secs(20);
        assert_eq!(
            counts.admit("a", Counted::Calls, 3, later),
            Some(Duration::from_secs(40))
        );
        // Another agent, and another count, are counted apart.
        assert_eq!(counts.admit("b", Counted::Calls, 3, later), None);
        assert_eq!(counts.admit("a", Counted::Navigations, 3, later), None);
        // A minute on, there is room again.
        let minute = start + MINUTE;
        assert_eq!(counts.admit("a", Counted::Calls, 3, minute), None);
    }

    #[test]
    fn a_burst_is_said_once_a_minute() {
        let mut counts = Counts::default();
        let start = Instant::now();
        assert!(counts.first_of_burst("a", start));
        assert!(!counts.first_of_burst("a", start + Duration::from_secs(5)));
        assert!(counts.first_of_burst("b", start));
        assert!(counts.first_of_burst("a", start + MINUTE));
    }

    #[test]
    fn a_limit_of_nothing_still_lets_one_through() {
        let mut counts = Counts::default();
        assert_eq!(counts.admit("a", Counted::Calls, 0, Instant::now()), None);
    }
}
