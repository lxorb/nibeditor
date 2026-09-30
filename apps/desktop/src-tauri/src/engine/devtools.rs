//! The `DevTools` Protocol on one page of nib's own Chromium: calls, and what the page
//! says back.
//!
//! The same protocol `WebView2` speaks through its COM interfaces (see
//! `agents/cdp.rs` and `web_worlds.rs`), reached the way `tauri-runtime-cef` offers it: a
//! message sent to the browser's own agent, and one observer per browser that hears
//! every message the agent sends - the answers to anybody's calls, the runtime's own
//! included, and every event. No port and no socket, so nothing else on the machine
//! reaches it.
//!
//! **Calls wait on the caller's thread, never the window's.** Sending a message waits
//! for the event loop to take it, and the answer arrives on the thread the event loop
//! runs on; a call made from that thread would be waiting for itself. Every caller here
//! is a thread of its own or a command's.
//!
//! **Every message, read whole.** The observer is handed each message twice - raw, and
//! then sorted into an answer or an event - and only the raw one says which session a
//! message belongs to, which is how a frame from another site (a process of its own,
//! attached with `Target.setAutoAttach`) is told from the page. So the raw one is read,
//! and the sorted ones are not.

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Webview;
use tauri_runtime_cef::{allocate_devtools_message_id, DevToolsProtocol, WebviewCefExt as _};

/// What hears a page's events: the method, the session it came from (`None` for the
/// page itself), and its parameters.
type Hearing = Arc<dyn Fn(&str, Option<&str>, &Value) + Send + Sync>;

/// One page's conversation with its agent.
#[derive(Default)]
struct Page {
    /// Who is waiting for which answer.
    waiting: Mutex<HashMap<i64, SyncSender<Result<Value, String>>>>,
    /// Who hears the page's events.
    hearing: Mutex<Vec<Hearing>>,
}

/// Every page that has been spoken to, by the webview's label. A label is reused only
/// after its page has gone, and the observer of a page that has gone hears nothing.
static PAGES: LazyLock<Mutex<HashMap<String, Arc<Page>>>> = LazyLock::new(Mutex::default);

/// The conversation with this webview's page, the observer registered the first time.
fn page(view: &Webview) -> Result<Arc<Page>, String> {
    let label = view.label().to_string();
    let mut pages = PAGES.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(found) = pages.get(&label) {
        return Ok(Arc::clone(found));
    }

    let made = Arc::new(Page::default());
    let heard = Arc::clone(&made);
    view.on_dev_tools_protocol(move |said| {
        if let DevToolsProtocol::Message(raw) = said {
            if let Ok(message) = serde_json::from_slice::<Value>(&raw) {
                read(&heard, &message);
            }
        }
    })
    .map_err(|error| format!("the page's agent could not be reached: {error}"))?;
    pages.insert(label, Arc::clone(&made));
    Ok(made)
}

/// One message from the agent: an answer for whoever waits on its id, or an event for
/// whoever hears the page.
fn read(page: &Page, message: &Value) {
    let session = message.get("sessionId").and_then(Value::as_str);
    if let Some(id) = message.get("id").and_then(Value::as_i64) {
        let waiting = page
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(waiting) = waiting {
            let _ = waiting.try_send(answer(message));
        }
        return;
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let hearing = page
        .hearing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    for one in hearing {
        one(method, session, &params);
    }
}

/// What an answer says: its result, or the agent's own words for why there is none.
fn answer(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the page refused")
            .to_string());
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

/// The message a call is sent as.
fn asking(id: i64, method: &str, params: &Value, session: Option<&str>) -> Value {
    let mut message = json!({ "id": id, "method": method, "params": params });
    if let Some(session) = session {
        message["sessionId"] = Value::from(session);
    }
    message
}

/// Calls one method on the page - or on the frame `session` names - and waits at most
/// `patience` for the answer. From any thread but the window's; see the top of this file.
pub fn call(
    view: &Webview,
    session: Option<&str>,
    method: &str,
    params: &Value,
    patience: Duration,
) -> Result<Value, String> {
    let page = page(view)?;
    let id = i64::from(
        allocate_devtools_message_id()
            .map_err(|_| "the page's agent has answered all it will".to_string())?,
    );
    let (answered, waiting) = sync_channel(1);
    page.waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id, answered);

    let sent = view
        .send_dev_tools_message(asking(id, method, params, session).to_string().as_bytes())
        .map_err(|error| format!("the page's agent could not be reached: {error}"));
    let outcome = sent.and_then(|()| {
        waiting
            .recv_timeout(patience)
            .map_err(|_| format!("the page did not answer {method}"))?
    });
    page.waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&id);
    outcome
}

/// Sends methods one after another, in order, on a thread of their own, and waits for
/// none of their answers: for what a page is told from inside one of its own events,
/// which run on the thread a call would be waiting on. The order is the order the page
/// runs them in, which matters to a frame held at its start until the last of them.
pub fn tell(view: &Webview, session: Option<&str>, said: Vec<(&'static str, Value)>) {
    let view = view.clone();
    let session = session.map(str::to_string);
    std::thread::spawn(move || {
        for (method, params) in said {
            let Ok(id) = allocate_devtools_message_id() else {
                return;
            };
            let message = asking(i64::from(id), method, &params, session.as_deref());
            let _ = view.send_dev_tools_message(message.to_string().as_bytes());
        }
    });
}

/// Hears every event the page says from now on, for as long as it is open.
pub fn hear(
    view: &Webview,
    heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static,
) -> Result<(), String> {
    page(view)?
        .hearing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(Arc::new(heard));
    Ok(())
}

/// Lets go of a page that has closed, so its label can be a new page's.
pub fn let_go_of(label: &str) {
    PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(label);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{answer, asking, read, Page};

    #[test]
    fn an_answer_is_its_result_or_the_agent_s_words() {
        assert_eq!(
            answer(&json!({ "id": 3, "result": { "identifier": "4" } })),
            Ok(json!({ "identifier": "4" }))
        );
        assert_eq!(
            answer(&json!({ "id": 3, "error": { "code": -32000, "message": "No frame" } })),
            Err("No frame".to_string())
        );
    }

    #[test]
    fn a_call_names_its_session_only_when_it_has_one() {
        let page = asking(7, "Runtime.evaluate", &json!({ "expression": "1" }), None);
        assert!(page.get("sessionId").is_none());
        let frame = asking(7, "Runtime.evaluate", &json!({}), Some("S1"));
        assert_eq!(frame["sessionId"], "S1");
        assert_eq!(frame["id"], 7);
    }

    #[test]
    fn an_event_reaches_every_hearer_with_its_session() {
        let page = Page::default();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let noting = seen.clone();
        page.hearing.lock().unwrap().push(std::sync::Arc::new(
            move |method: &str, session: Option<&str>, _: &serde_json::Value| {
                noting
                    .lock()
                    .unwrap()
                    .push((method.to_string(), session.map(str::to_string)));
            },
        ));
        read(
            &page,
            &json!({ "method": "Target.attachedToTarget", "params": {}, "sessionId": "S9" }),
        );
        read(&page, &json!({ "id": 99, "result": {} }));
        assert_eq!(
            *seen.lock().unwrap(),
            vec![(
                "Target.attachedToTarget".to_string(),
                Some("S9".to_string())
            )]
        );
    }
}
