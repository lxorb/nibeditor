//! The questions an agent's calls raise, and the reader's answers (docs/agent-native.md
//! 9.3).
//!
//! **A question never holds a call open.** A call that needs asking answers at once,
//! `{"status": "needs_approval", "approval": "a17", "summary": "Place order on
//! shop.example"}`, so an unsupervised agent carries on with something else rather than
//! holding a connection open for an hour. The window hears `asked` and puts the question
//! in the activity panel with one notification; the reader answers there; `answered`
//! says so, and `approval_status` tells the agent.
//!
//! **An allowed question lets the same call through once.** The agent calls again, the
//! call finds its question allowed by what it is about (the verb, the tab, the element),
//! and goes ahead; the question is then spent. "Always on this site" writes the category
//! into the grant for that site, so the next one is not asked at all. A question nobody
//! answered for a day expires.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter as _};

use super::verbs::{Answer, Approval, ApprovalAnswer, Category, Event, EVENT};

/// How long a question waits for the reader.
const EXPIRES: Duration = Duration::from_secs(24 * 60 * 60);

/// How long an allowed question waits to be used before it lapses.
const SPEND_WITHIN: Duration = Duration::from_secs(10 * 60);

/// One question, with what it lets through.
struct Held {
    approval: Approval,
    /// What the call it lets through is about: the verb, the tab, the element.
    key: String,
    /// When it was asked, or answered.
    at: Instant,
    /// Whether an allowed question has let its call through.
    spent: bool,
}

/// Every question of this run.
static HELD: Mutex<Vec<Held>> = Mutex::new(Vec::new());

/// The next question's number.
static NEXT: AtomicU64 = AtomicU64::new(1);

fn held() -> std::sync::MutexGuard<'static, Vec<Held>> {
    HELD.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a call is about, for finding its question again.
pub fn key(verb: &str, tab: Option<&str>, element: Option<&str>) -> String {
    format!(
        "{verb}:{}:{}",
        tab.unwrap_or_default(),
        element.unwrap_or_default()
    )
}

/// Whether the reader allowed this call: spends the allowance if so.
pub fn allowed(agent: &str, key: &str) -> bool {
    let mut all = held();
    let found = all.iter_mut().find(|one| {
        one.approval.agent == agent
            && one.key == key
            && one.approval.answer == ApprovalAnswer::Allowed
            && !one.spent
            && one.at.elapsed() < SPEND_WITHIN
    });
    match found {
        Some(one) => {
            one.spent = true;
            true
        }
        None => false,
    }
}

/// The question for a call: the one already waiting, or a new one, asked. Answers what
/// the call answers, `needs_approval`, or the reader's no when they already said it.
pub struct Asking<'a> {
    /// The agent's id.
    pub agent: &'a str,
    /// The agent's name.
    pub name: &'a str,
    /// What it is about.
    pub category: Category,
    /// One line.
    pub summary: String,
    /// The site, when a page is what it is about.
    pub site: Option<String>,
    /// The tab.
    pub tab: Option<String>,
    /// What the call is about; see `key`.
    pub key: String,
}

/// Asks, once: a call made again while its question waits is told the same question.
pub fn ask(app: &AppHandle, asking: Asking<'_>) -> Answer {
    let mut all = held();
    if let Some(one) = all
        .iter()
        .rev()
        .find(|one| one.approval.agent == asking.agent && one.key == asking.key)
    {
        match one.approval.answer {
            ApprovalAnswer::Pending => {
                return Answer::NeedsApproval {
                    approval: one.approval.id.clone(),
                    summary: one.approval.summary.clone(),
                };
            }
            // Refused recently: said again rather than asked again, so a loop in the
            // agent is not a stream of questions.
            ApprovalAnswer::Denied if one.at.elapsed() < SPEND_WITHIN => {
                return Answer::error(
                    super::verbs::Code::Denied,
                    format!("the reader said no: {}", one.approval.summary),
                );
            }
            _ => {}
        }
    }
    let approval = Approval {
        id: format!("q{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: asking.agent.to_string(),
        name: asking.name.to_string(),
        category: asking.category,
        summary: asking.summary,
        site: asking.site,
        tab: asking.tab,
        asked: crate::clock::now(),
        answer: ApprovalAnswer::Pending,
    };
    all.push(Held {
        approval: approval.clone(),
        key: asking.key,
        at: Instant::now(),
        spent: false,
    });
    drop(all);
    let _ = app.emit(
        EVENT,
        Event::Asked {
            approval: approval.clone(),
        },
    );
    Answer::NeedsApproval {
        approval: approval.id,
        summary: approval.summary,
    }
}

/// The reader's answer. Answers the question as it now stands.
pub fn answer(app: &AppHandle, id: &str, allow: bool) -> Result<Approval, String> {
    let approval = {
        let mut all = held();
        let one = all
            .iter_mut()
            .find(|one| one.approval.id == id)
            .ok_or("there is no such question")?;
        if one.approval.answer != ApprovalAnswer::Pending {
            return Ok(one.approval.clone());
        }
        one.approval.answer = match (allow, one.approval.category) {
            (true, Category::Takeover) => ApprovalAnswer::Done,
            (true, _) => ApprovalAnswer::Allowed,
            (false, _) => ApprovalAnswer::Denied,
        };
        one.at = Instant::now();
        one.approval.clone()
    };
    let _ = app.emit(
        EVENT,
        Event::Answered {
            approval: approval.clone(),
        },
    );
    Ok(approval)
}

/// A question, as the agent that asked may see it.
pub fn status(agent: &str, id: &str) -> Option<Approval> {
    held()
        .iter()
        .find(|one| one.approval.id == id && one.approval.agent == agent)
        .map(|one| one.approval.clone())
}

/// A question by id, whoever asked; for the window and the command line.
pub fn any(id: &str) -> Option<Approval> {
    held()
        .iter()
        .find(|one| one.approval.id == id)
        .map(|one| one.approval.clone())
}

/// Every question still waiting, of one agent or of all.
pub fn pending(agent: Option<&str>) -> Vec<Approval> {
    held()
        .iter()
        .filter(|one| one.approval.answer == ApprovalAnswer::Pending)
        .filter(|one| agent.is_none_or(|agent| one.approval.agent == agent))
        .map(|one| one.approval.clone())
        .collect()
}

/// Every question a day old, expired and said.
pub fn expire(app: &AppHandle) {
    let expired: Vec<Approval> = held()
        .iter_mut()
        .filter(|one| one.approval.answer == ApprovalAnswer::Pending && one.at.elapsed() >= EXPIRES)
        .map(|one| {
            one.approval.answer = ApprovalAnswer::Expired;
            one.approval.clone()
        })
        .collect();
    for approval in expired {
        let _ = app.emit(EVENT, Event::Answered { approval });
    }
}

/// A takeover or a show waiting on one tab: whether its question is still open.
pub fn waiting_on(agent: &str, tab: &str, category: Category) -> Option<Approval> {
    held()
        .iter()
        .rev()
        .find(|one| {
            one.approval.agent == agent
                && one.approval.tab.as_deref() == Some(tab)
                && one.approval.category == category
        })
        .map(|one| one.approval.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pushed(agent: &str, key: &str, answer: ApprovalAnswer) -> String {
        let id = format!("t{}", NEXT.fetch_add(1, Ordering::Relaxed));
        held().push(Held {
            approval: Approval {
                id: id.clone(),
                agent: agent.into(),
                name: agent.into(),
                category: Category::Paying,
                summary: "Pay on shop.example".into(),
                site: Some("shop.example".into()),
                tab: Some("a1".into()),
                asked: 0,
                answer,
            },
            key: key.into(),
            at: Instant::now(),
            spent: false,
        });
        id
    }

    #[test]
    fn an_allowed_question_lets_its_call_through_once() {
        let key = key("browser_click", Some("a1"), Some("e7"));
        pushed("allowing", &key, ApprovalAnswer::Allowed);
        assert!(allowed("allowing", &key));
        assert!(!allowed("allowing", &key));
        // Nobody else's call, and not another element.
        pushed("allowing", &key, ApprovalAnswer::Allowed);
        assert!(!allowed("somebody", &key));
        assert!(!allowed("allowing", "browser_click:a1:e8"));
    }

    #[test]
    fn a_waiting_question_is_nobody_elses_to_read() {
        let id = pushed("reading", "k", ApprovalAnswer::Pending);
        assert!(status("reading", &id).is_some());
        assert!(status("other", &id).is_none());
        assert!(pending(Some("reading")).iter().any(|one| one.id == id));
    }

    #[test]
    fn a_key_names_the_verb_the_tab_and_the_element() {
        assert_eq!(
            key("browser_click", Some("a1"), Some("e7")),
            "browser_click:a1:e7"
        );
        assert_eq!(key("browser_show", Some("a1"), None), "browser_show:a1:");
    }
}
