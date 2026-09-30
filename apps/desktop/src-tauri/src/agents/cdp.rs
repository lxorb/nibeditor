//! The `DevTools` Protocol on one webview, `WebView2`'s own way: no port, no socket, and
//! nothing a page or another program could reach (docs/agent-native.md 3).
//!
//! Three things, all through the webview's own COM interfaces:
//!
//! - **Calls**, `CallDevToolsProtocolMethod`, from any thread but the window's: the call
//!   is posted to the window's thread, the engine answers there, and the answer comes
//!   back over a channel the caller waits on. So an agent's verb, which runs on the
//!   endpoint's own thread, reads like a sequence of plain calls.
//! - **Calls into a frame** that runs in a process of its own, with the session the
//!   engine attached to it (`CallDevToolsProtocolMethodForSession`). A site framed in
//!   another site's page is such a frame; `Target.setAutoAttach` with `flatten` is what
//!   gives it a session, and `heard` keeps the list.
//! - **Events**, `GetDevToolsProtocolEventReceiver`: what the page printed, what it
//!   fetched, which frames it attached, and when a file chooser opened. Kept per page in
//!   rings of 500, the most an agent is ever shown.
//!
//! **Awake only while used (11).** The domains that make the engine do work nobody asked
//! for - the network log, the accessibility tree, the DOM agent - are enabled on the
//! first call an agent makes on a page and disabled after a minute of nothing. The
//! console's domain (`Runtime`) is enabled only once an agent asks for the console,
//! because a page can tell that one is on.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::webview::PlatformWebview;
use tauri::Webview;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2DevToolsProtocolEventReceivedEventArgs2, ICoreWebView2_11,
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
};
use windows_core::{Interface as _, HSTRING, PWSTR};

use super::verbs::{ConsoleLine, Request};

/// How long one call may take before the caller is told the page did not answer.
pub const PATIENCE: Duration = Duration::from_secs(30);

/// How many console lines and requests are kept per page.
const RING: usize = 500;

/// How long a page's domains stay on after the last call.
const AWAKE: Duration = Duration::from_secs(60);

/// The longest a console line or a request's address is kept, in characters.
const LONGEST_LINE: usize = 4_000;

/// One call on a page's own session.
pub fn call(view: &Webview, method: &str, params: &Value) -> Result<Value, String> {
    call_in(view, None, method, params, PATIENCE)
}

/// One call, on a frame's session when one is named, waiting at most `patience`.
pub fn call_in(
    view: &Webview,
    session: Option<&str>,
    method: &str,
    params: &Value,
    patience: Duration,
) -> Result<Value, String> {
    let (answered, answer) = sync_channel::<Result<String, String>>(1);
    let asking = (
        method.to_string(),
        params.to_string(),
        session.map(str::to_string),
    );
    view.with_webview(move |platform| {
        let (method, params, session) = asking;
        send(&platform, session.as_deref(), &method, &params, answered);
    })
    .map_err(|error| format!("the page could not be reached: {error}"))?;

    let text = answer
        .recv_timeout(patience)
        .map_err(|_| format!("{method}: the page did not answer"))??;
    if text.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|error| format!("{method}: {error}"))
}

/// One call that stops waiting as soon as `give_up` says so: `None` then, the call still
/// made. For a page that may raise a dialog as it is pressed - the press's own answer only
/// comes once the dialog is answered, and the dialog is waiting on the agent.
pub fn call_until(
    view: &Webview,
    session: Option<&str>,
    method: &str,
    params: &Value,
    give_up: impl Fn() -> bool,
) -> Result<Option<Value>, String> {
    let (answered, answer) = sync_channel::<Result<String, String>>(1);
    let asking = (
        method.to_string(),
        params.to_string(),
        session.map(str::to_string),
    );
    view.with_webview(move |platform| {
        let (method, params, session) = asking;
        send(&platform, session.as_deref(), &method, &params, answered);
    })
    .map_err(|error| format!("the page could not be reached: {error}"))?;

    let started = Instant::now();
    loop {
        match answer.recv_timeout(Duration::from_millis(25)) {
            Ok(text) => {
                let text = text?;
                if text.is_empty() {
                    return Ok(Some(Value::Null));
                }
                return serde_json::from_str(&text)
                    .map(Some)
                    .map_err(|error| format!("{method}: {error}"));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(format!("{method}: the page did not answer"));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if give_up() {
                    return Ok(None);
                }
                if started.elapsed() >= PATIENCE {
                    return Err(format!("{method}: the page did not answer"));
                }
            }
        }
    }
}

/// Sends one call to the engine, on the window's thread, and the answer to `answered`
/// whenever it comes.
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is WebView2's own, reached through its COM interfaces"
)]
fn send(
    platform: &PlatformWebview,
    session: Option<&str>,
    method: &str,
    params: &str,
    answered: std::sync::mpsc::SyncSender<Result<String, String>>,
) {
    let late = answered.clone();
    let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
        let _ = late.try_send(match result {
            Ok(()) => Ok(json),
            Err(error) => Err(refusal(&json).unwrap_or_else(|| error.message())),
        });
        Ok(())
    }));
    let (method, params) = (HSTRING::from(method), HSTRING::from(params));
    // Safe: the controller is this webview's, asked on its own thread, and the engine
    // holds the handler until it has answered.
    let sent = unsafe {
        platform
            .controller()
            .CoreWebView2()
            .and_then(|core| match session {
                None => core.CallDevToolsProtocolMethod(&method, &params, &done),
                Some(session) => core.cast::<ICoreWebView2_11>().and_then(|core| {
                    core.CallDevToolsProtocolMethodForSession(
                        &HSTRING::from(session),
                        &method,
                        &params,
                        &done,
                    )
                }),
            })
    };
    if let Err(error) = sent {
        let _ = answered.try_send(Err(error.message()));
    }
}

/// One call nobody waits for, on the window's thread: its answer, whatever it is, is
/// dropped. For what a page is set up with before it loads, where waiting would be
/// waiting inside the event loop's own turn.
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is WebView2's own, reached through its COM interfaces"
)]
pub fn post(core: &ICoreWebView2, method: &str, params: &Value) {
    let ignored = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
    // Safe: on the window's thread; the engine holds the handler until it answers.
    let _ = unsafe {
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params.to_string()),
            &ignored,
        )
    };
}

/// The sentence in the protocol's own refusal, `{"code": -32000, "message": "..."}`.
fn refusal(json: &str) -> Option<String> {
    let said: Value = serde_json::from_str(json).ok()?;
    said.get("message")?.as_str().map(str::to_string)
}

/// Starts hearing one of the protocol's events on a page, on the window's thread. `on`
/// is handed the frame's session (empty for the page's own) and the event's parameters.
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol's events are WebView2's own, reached through its COM interfaces"
)]
pub fn hear(core: &ICoreWebView2, event: &str, on: impl Fn(&str, Value) + 'static) -> bool {
    // Safe: on the window's thread, where the engine's objects live; the engine holds the
    // handler for as long as the webview does.
    unsafe {
        let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) else {
            return false;
        };
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut said = PWSTR::null();
                args.ParameterObjectAsJson(&raw mut said)?;
                let said = webview2_com::take_pwstr(said);
                let session = args
                    .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                    .ok()
                    .and_then(|two| {
                        let mut session = PWSTR::null();
                        two.SessionId(&raw mut session).ok()?;
                        Some(webview2_com::take_pwstr(session))
                    })
                    .unwrap_or_default();
                if let Ok(value) = serde_json::from_str(&said) {
                    on(&session, value);
                }
                Ok(())
            }));
        let mut token = 0i64;
        receiver
            .add_DevToolsProtocolEventReceived(&handler, &raw mut token)
            .is_ok()
    }
}

/// A frame that runs in a process of its own, as the engine attached it.
#[derive(Clone, Debug)]
pub struct Frame {
    /// Its session.
    pub session: String,
    /// Its frame id, which is also its target's id.
    pub id: String,
    /// Where it is.
    pub url: String,
}

/// What the engine has said about one page, kept as it says it.
#[derive(Default)]
pub struct Heard {
    /// The console, oldest first.
    console: VecDeque<ConsoleLine>,
    /// The next console line's number.
    console_next: u64,
    /// The requests, oldest first.
    requests: VecDeque<Request>,
    /// The next request's number.
    requests_next: u64,
    /// Each request's number and when it started, by its session and id.
    started: HashMap<(String, String), (u64, Instant)>,
    /// The requests still in flight, by session and id.
    in_flight: HashSet<(String, String)>,
    /// When the last request started or ended.
    network_moved: Option<Instant>,
    /// Frames in processes of their own, by the number their refs carry (`f2e17` is
    /// the second); a frame that went is `None`, so the numbers of the rest hold.
    frames: Vec<Option<Frame>>,
    /// A file chooser the page opened and nobody has answered: the input's node.
    pub chooser: Option<u64>,
    /// Agent tabs the page opened as windows since an agent last looked.
    pub opened: Vec<String>,
    /// Navigations of the page's own frame started, and loads finished: what an act
    /// waits on to know whether it led somewhere.
    pub navigations: u64,
    /// Loads of the page's own frame finished.
    pub loads: u64,
    /// The page's own frame, once known.
    pub main_frame: Option<String>,
    /// What a drag the engine intercepted carries, for the drop.
    pub dragged: Option<Value>,
    /// When an agent last called on the page.
    used: Option<Instant>,
    /// Whether the domains are on.
    awake: bool,
    /// Whether the console's domain is on.
    console_on: bool,
    /// Whether the page's events are being followed.
    followed: bool,
}

impl Heard {
    /// Console lines after `since`, of `level` when named.
    pub fn console(&self, since: Option<u64>, level: Option<&str>) -> (Vec<ConsoleLine>, u64) {
        let lines = self
            .console
            .iter()
            .filter(|one| since.is_none_or(|since| one.seq > since))
            .filter(|one| level.is_none_or(|level| one.level == level))
            .cloned()
            .collect();
        (lines, self.console_next)
    }

    /// Requests after `since`, whose address contains `matching` when named.
    pub fn requests(&self, since: Option<u64>, matching: Option<&str>) -> (Vec<Request>, u64) {
        let rows = self
            .requests
            .iter()
            .filter(|one| since.is_none_or(|since| one.seq > since))
            .filter(|one| matching.is_none_or(|part| one.url.contains(part)))
            .cloned()
            .collect();
        (rows, self.requests_next)
    }

    /// The session and request id of a request by its number, for its body.
    pub fn request_id(&self, seq: u64) -> Option<(String, String)> {
        self.started
            .iter()
            .find(|(_, (one, _))| *one == seq)
            .map(|(key, _)| key.clone())
    }

    /// Whether no request has been in flight for `quiet`.
    pub fn idle_for(&self, quiet: Duration) -> bool {
        self.in_flight.is_empty() && self.network_moved.is_none_or(|at| at.elapsed() >= quiet)
    }

    /// The frames, by number.
    pub fn frames(&self) -> Vec<(usize, Frame)> {
        self.frames
            .iter()
            .enumerate()
            .filter_map(|(at, one)| one.clone().map(|frame| (at + 1, frame)))
            .collect()
    }

    /// The frame with that number.
    pub fn frame(&self, number: usize) -> Option<Frame> {
        self.frames.get(number.checked_sub(1)?).cloned().flatten()
    }

    /// A line of nib's own in the console: what the page tried that nib refused.
    pub fn say(&mut self, level: &str, text: String) {
        self.line(level, text, Some("nib".to_string()));
    }

    fn line(&mut self, level: &str, text: String, source: Option<String>) {
        self.console_next += 1;
        self.console.push_back(ConsoleLine {
            seq: self.console_next,
            level: level.to_string(),
            text: cut(text, LONGEST_LINE),
            source,
        });
        while self.console.len() > RING {
            self.console.pop_front();
        }
    }

    fn request_started(&mut self, session: &str, event: &Value) {
        let Some(id) = event.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let key = (session.to_string(), id.to_string());
        // A redirect is the same request again under the same id.
        if !self.in_flight.insert(key.clone()) && self.started.contains_key(&key) {
            return;
        }
        self.requests_next += 1;
        let seq = self.requests_next;
        self.started.insert(key, (seq, Instant::now()));
        self.network_moved = Some(Instant::now());
        let request = event.get("request").cloned().unwrap_or_default();
        self.requests.push_back(Request {
            seq,
            method: text_at(&request, "method"),
            url: cut(text_at(&request, "url"), LONGEST_LINE),
            status: None,
            kind: text_at(event, "type"),
            ms: None,
            failed: None,
            body: None,
        });
        while self.requests.len() > RING {
            if let Some(gone) = self.requests.pop_front() {
                self.started.retain(|_, (seq, _)| *seq != gone.seq);
            }
        }
    }

    fn responded(&mut self, session: &str, event: &Value) {
        let Some(seq) = self.seq_of(session, event) else {
            return;
        };
        let status = event
            .pointer("/response/status")
            .and_then(Value::as_u64)
            .and_then(|one| u16::try_from(one).ok());
        if let Some(row) = self.requests.iter_mut().find(|one| one.seq == seq) {
            row.status = status;
        }
    }

    fn request_ended(&mut self, session: &str, event: &Value, failed: Option<String>) {
        let Some(id) = event.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let key = (session.to_string(), id.to_string());
        self.in_flight.remove(&key);
        self.network_moved = Some(Instant::now());
        let Some((seq, at)) = self.started.get(&key).copied() else {
            return;
        };
        if let Some(row) = self.requests.iter_mut().find(|one| one.seq == seq) {
            row.ms = u64::try_from(at.elapsed().as_millis()).ok();
            row.failed = failed;
        }
    }

    fn seq_of(&self, session: &str, event: &Value) -> Option<u64> {
        let id = event.get("requestId")?.as_str()?;
        self.started
            .get(&(session.to_string(), id.to_string()))
            .map(|(seq, _)| *seq)
    }

    fn attached(&mut self, event: &Value) {
        if event.pointer("/targetInfo/type").and_then(Value::as_str) != Some("iframe") {
            return;
        }
        let (Some(session), Some(frame)) = (
            event.get("sessionId").and_then(Value::as_str),
            event
                .pointer("/targetInfo/targetId")
                .and_then(Value::as_str),
        ) else {
            return;
        };
        let url = event
            .pointer("/targetInfo/url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        // A frame attached again (a navigation inside it) keeps its number.
        if let Some(held) = self.frames.iter_mut().flatten().find(|one| one.id == frame) {
            held.session = session.to_string();
            held.url = url;
            return;
        }
        self.frames.push(Some(Frame {
            session: session.to_string(),
            id: frame.to_string(),
            url,
        }));
    }

    fn detached(&mut self, event: &Value) {
        let Some(session) = event.get("sessionId").and_then(Value::as_str) else {
            return;
        };
        for one in &mut self.frames {
            if one.as_ref().is_some_and(|frame| frame.session == session) {
                *one = None;
            }
        }
        self.in_flight.retain(|(owner, _)| owner != session);
    }
}

/// What every page has had said about it, by label.
static HEARD: Mutex<Option<HashMap<String, Arc<Mutex<Heard>>>>> = Mutex::new(None);

/// What has been said about a page, made empty the first time it is asked for.
pub fn heard(label: &str) -> Arc<Mutex<Heard>> {
    let mut all = HEARD.lock().unwrap_or_else(PoisonError::into_inner);
    Arc::clone(
        all.get_or_insert_with(HashMap::new)
            .entry(label.to_string())
            .or_default(),
    )
}

/// Forgets a page that closed.
pub fn forget(label: &str) {
    let mut all = HEARD.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(all) = all.as_mut() {
        all.remove(label);
    }
}

/// Every page anything has been said about.
pub fn labels() -> Vec<String> {
    HEARD
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|all| all.keys().cloned().collect())
        .unwrap_or_default()
}

/// Starts following what a page says, on the window's thread. Once per webview: the
/// engine's receivers live as long as it does.
pub fn follow(core: &ICoreWebView2, label: &str) {
    let page = heard(label);
    if std::mem::replace(
        &mut page.lock().unwrap_or_else(PoisonError::into_inner).followed,
        true,
    ) {
        return;
    }
    let on = |event: &str, run: fn(&mut Heard, &str, Value)| {
        let page = Arc::clone(&page);
        hear(core, event, move |session, value| {
            let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
            run(&mut held, session, value);
        });
    };
    on("Network.requestWillBeSent", |held, session, event| {
        held.request_started(session, &event);
    });
    on("Network.responseReceived", |held, session, event| {
        held.responded(session, &event);
    });
    on("Network.loadingFinished", |held, session, event| {
        held.request_ended(session, &event, None);
    });
    on("Network.loadingFailed", |held, session, event| {
        let why = text_at(&event, "errorText");
        held.request_ended(session, &event, Some(why));
    });
    on("Runtime.consoleAPICalled", |held, _, event| {
        let level = match event.get("type").and_then(Value::as_str) {
            Some("error" | "assert") => "error",
            Some("warning") => "warning",
            Some("info") => "info",
            Some("debug") => "debug",
            _ => "log",
        };
        held.line(level, spoken(&event), frame_source(&event));
    });
    on("Runtime.exceptionThrown", |held, _, event| {
        let details = event.get("exceptionDetails").cloned().unwrap_or_default();
        let text = details
            .pointer("/exception/description")
            .and_then(Value::as_str)
            .map_or_else(|| text_at(&details, "text"), str::to_string);
        let source = Some(format!(
            "{}:{}",
            text_at(&details, "url"),
            details
                .get("lineNumber")
                .and_then(Value::as_u64)
                .unwrap_or_default()
                + 1
        ));
        held.line("error", text, source);
    });
    on("Log.entryAdded", |held, _, event| {
        let entry = event.get("entry").cloned().unwrap_or_default();
        let level = match entry.get("level").and_then(Value::as_str) {
            Some("error") => "error",
            Some("warning") => "warning",
            Some("verbose") => "debug",
            _ => "info",
        };
        let source = entry.get("url").and_then(Value::as_str).map(str::to_string);
        held.line(level, text_at(&entry, "text"), source);
    });
    on("Page.fileChooserOpened", |held, _, event| {
        held.chooser = event.get("backendNodeId").and_then(Value::as_u64);
    });
    on("Target.attachedToTarget", |held, _, event| {
        held.attached(&event);
    });
    on("Page.frameStartedNavigating", |held, session, event| {
        let main = held.main_frame.as_deref();
        let ours = session.is_empty()
            && main.is_none_or(|main| event.get("frameId").and_then(Value::as_str) == Some(main));
        let same = matches!(
            event.get("navigationType").and_then(Value::as_str),
            Some("sameDocument" | "historySameDocument")
        );
        if ours && !same {
            held.navigations += 1;
        }
    });
    on("Page.loadEventFired", |held, session, _| {
        if session.is_empty() {
            held.loads += 1;
        }
    });
    on("Input.dragIntercepted", |held, _, event| {
        held.dragged = event.get("data").cloned();
    });
    on("Target.detachedFromTarget", |held, _, event| {
        held.detached(&event);
    });
}

/// What a console call printed: each argument as the console would show it.
fn spoken(event: &Value) -> String {
    event
        .get("args")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .map(|one| match one.get("value") {
                    Some(Value::String(text)) => text.clone(),
                    Some(value) if !value.is_null() => value.to_string(),
                    _ => one
                        .get("description")
                        .and_then(Value::as_str)
                        .or_else(|| one.get("type").and_then(Value::as_str))
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

/// Where a console call was made, from its stack.
fn frame_source(event: &Value) -> Option<String> {
    let top = event.pointer("/stackTrace/callFrames/0")?;
    Some(format!(
        "{}:{}",
        top.get("url")?.as_str()?,
        top.get("lineNumber")?.as_u64()? + 1
    ))
}

fn text_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Text cut at `most` characters, between two characters.
pub fn cut(text: String, most: usize) -> String {
    match text.char_indices().nth(most) {
        Some((at, _)) => text[..at].to_string(),
        None => text,
    }
}

/// Wakes a page's domains for an agent's call, and notes the call: the network log, the
/// DOM agent, the page's events, and the frames in processes of their own. Frames each
/// get their network log too, which is what makes `browser_network` whole.
pub fn awake(view: &Webview, label: &str, own: bool) {
    let page = heard(label);
    let asleep = {
        let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
        held.used = Some(Instant::now());
        !std::mem::replace(&mut held.awake, true)
    };
    if !asleep {
        return;
    }
    if !page.lock().unwrap_or_else(PoisonError::into_inner).followed {
        // A reader's page is followed from the first agent call on it; an agent's own from
        // before it loads.
        let following = Arc::clone(&page);
        let named = label.to_string();
        let _ = view.with_webview(move |platform| {
            if let Some(core) = core_of(&platform) {
                follow(&core, &named);
            }
            following
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .followed = true;
        });
    }
    for method in ["Page.enable", "DOM.enable", "Network.enable", "Log.enable"] {
        let _ = call(view, method, &json!({}));
    }
    if own {
        let _ = call(
            view,
            "Target.setAutoAttach",
            &json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true, "filter": [{ "type": "iframe" }] }),
        );
    } else {
        attach_existing(view);
    }
    let frames = page.lock().unwrap_or_else(PoisonError::into_inner).frames();
    for (_, frame) in frames {
        let _ = call_in(
            view,
            Some(&frame.session),
            "Network.enable",
            &json!({}),
            PATIENCE,
        );
    }
}

/// Attaches to a reader's page's frames that run in processes of their own, with
/// sessions of this crate's own: the page's own following of its frames (`web_worlds`)
/// is left as it is.
fn attach_existing(view: &Webview) {
    let Ok(tree) = call(view, "Page.getFrameTree", &json!({})) else {
        return;
    };
    let mut frames = HashSet::new();
    let mut walking = vec![tree.get("frameTree").cloned().unwrap_or_default()];
    while let Some(node) = walking.pop() {
        if let Some(id) = node.pointer("/frame/id").and_then(Value::as_str) {
            frames.insert(id.to_string());
        }
        walking.extend(
            node.get("childFrames")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
    }
    let Ok(targets) = call(view, "Target.getTargets", &json!({})) else {
        return;
    };
    for info in targets
        .get("targetInfos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let is_frame = info.get("type").and_then(Value::as_str) == Some("iframe");
        let Some(id) = info.get("targetId").and_then(Value::as_str) else {
            continue;
        };
        if is_frame && frames.contains(id) {
            let _ = call(
                view,
                "Target.attachToTarget",
                &json!({ "targetId": id, "flatten": true }),
            );
        }
    }
}

/// Turns the console's domain on for a page, once: a page can tell it is on, so it is
/// on only for an agent that asked for the console.
pub fn listen_to_console(view: &Webview, label: &str) {
    let page = heard(label);
    let first = !std::mem::replace(
        &mut page
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .console_on,
        true,
    );
    if first {
        // Briefly: a page holding a dialog answers nothing until the dialog is answered.
        let _ = call_in(
            view,
            None,
            "Runtime.enable",
            &json!({}),
            Duration::from_secs(3),
        );
    }
}

/// Puts to sleep every page nobody has called on for a minute. Called on the agents'
/// own timer; see `super::tabs`.
pub fn sleep_idle(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    for label in labels() {
        let page = heard(&label);
        let sleepy = {
            let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
            let idle = held.awake && held.used.is_none_or(|at| at.elapsed() >= AWAKE);
            if idle {
                held.awake = false;
                held.console_on = false;
            }
            idle
        };
        if !sleepy {
            continue;
        }
        let Some(view) = app.get_webview(&label) else {
            forget(&label);
            continue;
        };
        for method in [
            "Runtime.disable",
            "Network.disable",
            "Accessibility.disable",
            "DOM.disable",
            "Log.disable",
        ] {
            let _ = call_in(&view, None, method, &json!({}), Duration::from_secs(5));
        }
    }
}

/// The platform webview's engine, on the window's thread.
#[allow(
    unsafe_code,
    reason = "the engine is reached through WebView2's COM interfaces"
)]
pub fn core_of(platform: &PlatformWebview) -> Option<ICoreWebView2> {
    // Safe: the controller is this webview's own, asked on its own thread.
    unsafe { platform.controller().CoreWebView2().ok() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_console_call_prints_each_argument_as_the_console_would() {
        let event = json!({
            "type": "log",
            "args": [
                { "type": "string", "value": "saved" },
                { "type": "number", "value": 3 },
                { "type": "object", "description": "Object" },
                { "type": "undefined" },
            ],
        });
        assert_eq!(spoken(&event), "saved 3 Object undefined");
    }

    #[test]
    fn the_ring_keeps_the_last_five_hundred_and_counts_on() {
        let mut heard = Heard::default();
        for at in 0..(RING + 20) {
            heard.line("log", format!("{at}"), None);
        }
        let (lines, next) = heard.console(None, None);
        assert_eq!(lines.len(), RING);
        assert_eq!(lines[0].text, "20");
        assert_eq!(next, u64::try_from(RING + 20).expect("small"));
        let (after, _) = heard.console(Some(next - 2), None);
        assert_eq!(after.len(), 2);
    }

    #[test]
    fn a_request_is_in_flight_until_it_ends_and_a_redirect_is_the_same_request() {
        let mut heard = Heard::default();
        let sent = json!({ "requestId": "1", "type": "Fetch", "request": { "method": "GET", "url": "https://a.example/x" } });
        heard.request_started("", &sent);
        heard.request_started("", &sent);
        assert!(!heard.idle_for(Duration::ZERO));
        heard.responded(
            "",
            &json!({ "requestId": "1", "response": { "status": 302 } }),
        );
        heard.request_ended("", &json!({ "requestId": "1" }), None);
        assert!(heard.idle_for(Duration::ZERO));
        let (rows, next) = heard.requests(None, Some("a.example"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, Some(302));
        assert_eq!(rows[0].method, "GET");
        assert_eq!(next, 1);
        assert!(!heard.idle_for(Duration::from_secs(60)));
    }

    #[test]
    fn a_frame_keeps_its_number_when_another_goes() {
        let mut heard = Heard::default();
        let attach = |heard: &mut Heard, session: &str, frame: &str| {
            heard.attached(&json!({ "sessionId": session, "targetInfo": { "type": "iframe", "targetId": frame, "url": "https://b.example/" } }));
        };
        attach(&mut heard, "s1", "F1");
        attach(&mut heard, "s2", "F2");
        heard.detached(&json!({ "sessionId": "s1" }));
        assert!(heard.frame(1).is_none());
        assert_eq!(heard.frame(2).map(|one| one.id).as_deref(), Some("F2"));
        attach(&mut heard, "s3", "F2");
        assert_eq!(heard.frame(2).map(|one| one.session).as_deref(), Some("s3"));
        // A worker is not a frame.
        heard.attached(
            &json!({ "sessionId": "w", "targetInfo": { "type": "worker", "targetId": "W" } }),
        );
        assert_eq!(heard.frames().len(), 1);
    }

    #[test]
    fn text_is_cut_between_two_characters() {
        assert_eq!(cut("héllo".into(), 2), "hé");
        assert_eq!(cut("hi".into(), 5), "hi");
    }
}
