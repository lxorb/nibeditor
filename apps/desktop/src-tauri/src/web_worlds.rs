//! What a page in a web tab is handed by the app: nothing, in the page's own world.
//!
//! Emil, 2026-09-30, on Google Sheets in a web tab: *"Loading issue - Troubleshoot this
//! issue by clearing application resources"*, every time. Measured on the probe with
//! the page's console read over the `DevTools` protocol: `Uncaught SyntaxError:
//! Identifier 'ipc' has already been declared`, in the editor's own bundle, and then
//! `RITZ_initializeModules is not defined` and the rest of the editor never starting.
//!
//! **Why.** A web tab is a Tauri webview, and a Tauri webview is built to carry the app.
//! wry writes `window.ipc` into every document it creates; Tauri writes `isTauri`,
//! `__TAURI_INTERNALS__` and each plugin's internals beside it. Every one of them is
//! `Object.defineProperty(window, name, { value })`, which leaves `configurable` out -
//! and a classic script may not declare `let ipc`, `const ipc` or `class ipc` at the top
//! level while the global object carries a non-configurable `ipc`. The *whole* script is
//! a `SyntaxError` before its first line runs. `ipc` is three letters and an ordinary name
//! for a bundle to use, and the one Google's spreadsheet editor ships uses it. Nothing
//! inside the page could undo it: `delete window.ipc` answers false and redefining it
//! throws, so the guard script that claimed to take the app's globals away never had.
//!
//! **What a browser does instead, and what this does.** A browser gives a page nothing
//! of itself. What an extension or an automation tool runs in a page runs in a world of
//! its own - Chrome's content scripts, Electron's context isolation, Puppeteer's utility
//! world, `WKContentWorld` - with the same document and the same events and none of the
//! page's globals or prototypes, so neither side can see or break the other. So:
//!
//! 1. A tab's webview is built on `about:blank`, and before it is sent to the site every
//!    script the runtime registered on it is taken back. None of it is needed: every
//!    event this crate follows on a page is one of the engine's own, and every question
//!    it asks a page comes back through the engine's own script callback. That takes the
//!    dialog plugin's `alert` and `confirm` and the opener plugin's link handler with it,
//!    which answered a site's `confirm()` yes before anybody was asked and swallowed its
//!    Ctrl+click; see `web_dialogs.rs` and `web_opens.rs`.
//! 2. The engine's message channel goes too, so the page has nothing to post to the app.
//! 3. nib's own page scripts - a link pressed for a tab of its own and the keys a page
//!    lets go by (`web_opens.rs`), and the place a revived page was left at - run in a
//!    world of nib's own, `WORLD`. The page's `window`, `window.open`, `addEventListener`
//!    and prototypes are the page's own.
//! 4. What the crate reads out of a page on its own account - the site's mark - is read
//!    in that same world on `WebView2`; see `evaluate`.
//!
//! **Per engine.** `WebView2` takes a script back only by the identifier it handed out,
//! which wry and Tauri throw away, and offers an isolated world only through its
//! `DevTools` protocol; see `cleared`. `WKWebView` and `WebKitGTK` each have a user
//! content controller whose scripts can be emptied in one call, and a world a user script
//! can be put in (`WKContentWorld`, a script world) - measured only on Windows, where the
//! probes run, and built on the other two against their own documented calls.

use serde_json::{json, Value};

/// The name of nib's own world in a page: where its page scripts run and what it reads
/// a page from. Anything but the empty name is an isolated world; the page's own is the
/// empty one.
pub(crate) const WORLD: &str = "nib";

/// A script the engine is asked to register only to learn how far its own numbering has
/// got. It is taken back with everything registered before it, so it never runs.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
const MARK: &str = "void 0";

/// The identifiers of every script registered before the one the engine just filed
/// under `last`, and that one too: all of them are the runtime's or this module's own
/// marker, and all of them go.
///
/// The engine numbers a webview's scripts from one, counting up, which is its habit
/// rather than its contract - so it is checked rather than assumed. An identifier that is
/// not a counting number is `None`, and then nothing is taken back: a tab that still
/// carries the runtime's globals is where every web tab was before this existed, and a
/// sweep that guessed could take back something it did not mean to.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn taken_back(last: &str) -> Option<std::ops::RangeInclusive<u32>> {
    let last = last.trim().parse::<u32>().ok().filter(|one| *one > 0)?;
    Some(1..=last)
}

/// What the protocol is asked to register a script in nib's world with.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn registering(source: &str) -> String {
    json!({ "source": source, "worldName": WORLD }).to_string()
}

/// The page's own frame, out of the protocol's frame tree.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn frame_of(tree: &str) -> Option<String> {
    let said: Value = serde_json::from_str(tree).ok()?;
    said.pointer("/frameTree/frame/id")?
        .as_str()
        .map(str::to_string)
}

/// What the protocol is asked for nib's world in that frame with.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn world_in(frame: &str) -> String {
    json!({ "frameId": frame, "worldName": WORLD }).to_string()
}

/// The world it answered with, as the context an evaluation is run in.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn context_of(world: &str) -> Option<i64> {
    let said: Value = serde_json::from_str(world).ok()?;
    said.get("executionContextId")?.as_i64()
}

/// What the protocol is asked to run an expression in that world with: waiting for a
/// promise, and answering with the value itself rather than a handle to it.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn evaluating(expression: &str, context: i64) -> String {
    json!({
        "expression": expression,
        "contextId": context,
        "awaitPromise": true,
        "returnByValue": true,
    })
    .to_string()
}

/// What the protocol is asked to follow a page's frames with: every frame that runs in a
/// process of its own - a site framed in another site's page - and no other kind of
/// target, each held at its start until nib's scripts are in it.
///
/// A frame from another site is a document the page's own registration never reaches:
/// `WebView2` puts it in a renderer of its own, which the protocol treats as a target of
/// its own. Measured on the probe: a same-site frame had nib's world, and one from
/// another site did not until this. Its links and its keys are the page's all the same.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn attaching() -> String {
    json!({
        "autoAttach": true,
        "waitForDebuggerOnStart": true,
        "flatten": true,
        "filter": [{ "type": "iframe" }],
    })
    .to_string()
}

/// The session of a frame the protocol has just attached to, out of the event that says
/// so, or `None` for any other kind of target.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn attached_frame(event: &str) -> Option<String> {
    let said: Value = serde_json::from_str(event).ok()?;
    if said.pointer("/targetInfo/type")?.as_str()? != "iframe" {
        return None;
    }
    said.get("sessionId")?.as_str().map(str::to_string)
}

/// What a frame is sent once it is attached, in order, which is the order its session
/// runs them in: its page domain on, nib's scripts registered in nib's world, its own
/// frames followed the same way, and then let go. The last is sent whatever became of
/// the others, because a frame held at its start and never let go is a frame that never
/// loads.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn in_frame(scripts: &str) -> [(&'static str, String); 4] {
    [
        ("Page.enable", "{}".to_string()),
        (
            "Page.addScriptToEvaluateOnNewDocument",
            registering(scripts),
        ),
        ("Target.setAutoAttach", attaching()),
        ("Runtime.runIfWaitingForDebugger", "{}".to_string()),
    ]
}

/// What was done to a page before it was sent to the site, for the launch trace.
#[derive(Default)]
pub struct Cleared {
    /// Whether the runtime's scripts were taken back.
    swept: bool,
    /// How many there were, where the engine can say.
    counted: Option<usize>,
    /// Whether nib's own scripts are in nib's world.
    ours: bool,
    /// Whether frames from other sites have them too.
    frames: bool,
}

impl Cleared {
    /// One line for the launch trace.
    pub fn said(&self) -> String {
        let swept = match (self.swept, self.counted) {
            (false, _) => "the runtime's scripts left in".to_string(),
            (true, Some(count)) => format!("{count} of the runtime's scripts taken back"),
            (true, None) => "the runtime's scripts taken back".to_string(),
        };
        let ours = if self.ours {
            "in nib's world"
        } else {
            "missing"
        };
        let frames = if self.frames {
            ""
        } else {
            ", not in other sites' frames"
        };
        format!("{swept}, nib's own {ours}{frames}")
    }
}

#[cfg(not(feature = "cef"))]
pub use engine::sent;
#[cfg(all(windows, not(feature = "cef")))]
pub use engine::{cleared, evaluate};

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use std::cell::RefCell;
    use std::rc::Rc;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_11};
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    };
    use windows_core::{Interface as _, HSTRING, PWSTR};

    use super::{
        attached_frame, attaching, context_of, evaluating, frame_of, in_frame, registering,
        taken_back, world_in, Cleared, MARK,
    };

    /// Clears a page of the app before it is sent to the site: the runtime's scripts
    /// taken back, the engine's message channel and host objects off, and `scripts` -
    /// nib's own, or nothing - registered in nib's world.
    ///
    /// On the window's own thread, on a webview that is still on `about:blank`, and in the
    /// event loop's own turn rather than inside one of the engine's handlers: the two
    /// registrations wait for the engine's answer with a nested message pump, which is
    /// what wry's own build does in the same place. The caller navigates afterwards, in the
    /// same turn, so no navigation can arrive in the middle of the sweep.
    #[allow(
        unsafe_code,
        reason = "a page's scripts and settings are WebView2's own, reached through its COM interfaces"
    )]
    pub fn cleared(webview: &PlatformWebview, scripts: &str) -> Cleared {
        // Safe: the controller is this window's, and everything below is used on this
        // thread and no other.
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            return Cleared::default();
        };

        // Settings change from the next navigation on, which is the site's.
        //
        // Safe: as above.
        unsafe {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetIsWebMessageEnabled(false);
                let _ = settings.SetAreHostObjectsAllowed(false);
            }
        }

        let taken = added(&core, MARK)
            .as_deref()
            .and_then(taken_back)
            .map(|every| {
                let mut count = 0usize;
                for id in every {
                    // Safe: as above. An identifier the engine does not know is ignored
                    // by it, which is the answer this wants too.
                    if unsafe {
                        core.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(id.to_string()))
                    }
                    .is_ok()
                    {
                        count += 1;
                    }
                }
                count
            });

        let ours = scripts.is_empty() || registered(&core, scripts);
        let frames = scripts.is_empty() || following(&core, scripts);
        Cleared {
            swept: taken.is_some(),
            counted: taken,
            ours,
            frames,
        }
    }

    /// Clears a page built on `about:blank` and sends it to the site, in one turn of the
    /// window's thread and in that order: clearing runs a nested message pump, so a
    /// navigation posted from elsewhere would be dispatched in the middle of it - the
    /// site's first document arriving before the runtime's scripts were off.
    ///
    /// The site is loaded whatever the clearing says. A tab left on a blank page would be
    /// worse than one that still carries the runtime's globals, which is where every web
    /// tab was before this, and the launch trace says which it was.
    #[allow(
        unsafe_code,
        reason = "the page is sent to the site through WebView2's own COM interface"
    )]
    pub fn sent(webview: &PlatformWebview, url: &str, scripts: &str) -> Cleared {
        let done = cleared(webview, scripts);
        // Safe: the controller is this window's, on its own thread.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let _ = core.Navigate(&HSTRING::from(url));
            }
        }
        done
    }

    /// Registers a script in the page's own world, the way the runtime does, and answers
    /// the identifier the engine filed it under.
    #[allow(
        unsafe_code,
        reason = "a script is registered through WebView2's own COM interface"
    )]
    fn added(core: &ICoreWebView2, script: &str) -> Option<String> {
        let said = Rc::new(RefCell::new(String::new()));
        let kept = Rc::clone(&said);
        let asked = core.clone();
        let js = HSTRING::from(script);

        AddScriptToExecuteOnDocumentCreatedCompletedHandler::wait_for_async_operation(
            // Safe: the interface is this window's, and the engine holds the handler
            // until it has answered.
            Box::new(move |handler| unsafe {
                asked
                    .AddScriptToExecuteOnDocumentCreated(&js, &handler)
                    .map_err(Into::into)
            }),
            Box::new(move |error, id| {
                error?;
                *kept.borrow_mut() = id;
                Ok(())
            }),
        )
        .ok()?;

        let id = said.borrow().clone();
        (!id.is_empty()).then_some(id)
    }

    /// Registers nib's own scripts in nib's world, for every document the page creates
    /// from here on. Waits for the engine, so the site's first document has them.
    ///
    /// The protocol's page domain is turned on first, because a script registered on a
    /// session whose page domain is off is kept and never run - measured, on the probe: a
    /// world's script ran on no reload until `Page.enable`, and on every one after it.
    /// Turning it on sends the host the page's events, which nothing here listens to.
    fn registered(core: &ICoreWebView2, scripts: &str) -> bool {
        waited(core, "Page.enable", "{}")
            && waited(
                core,
                "Page.addScriptToEvaluateOnNewDocument",
                &registering(scripts),
            )
    }

    /// Follows the page's frames from other sites and gives each nib's scripts before its
    /// first document; see `attaching`.
    ///
    /// The engine says a frame has been attached as one of the protocol's events, on this
    /// thread and inside the engine's own handler - so nothing there waits: what a frame is
    /// sent goes out in one go, in the order its session runs it, and its answers are not
    /// read. An engine too old to address a frame's session is never asked to hold one.
    #[allow(
        unsafe_code,
        reason = "the DevTools protocol and its events are WebView2's own, reached through its COM interfaces"
    )]
    fn following(core: &ICoreWebView2, scripts: &str) -> bool {
        let Ok(sessions) = core.cast::<ICoreWebView2_11>() else {
            return false;
        };
        // Safe: as above.
        let Ok(receiver) = (unsafe {
            core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Target.attachedToTarget"))
        }) else {
            return false;
        };

        let scripts = scripts.to_string();
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                // Safe: a string the engine allocated for this event, taken and freed here.
                let event = unsafe {
                    let mut event = PWSTR::null();
                    args.ParameterObjectAsJson(&raw mut event)?;
                    webview2_com::take_pwstr(event)
                };
                let Some(session) = attached_frame(&event) else {
                    return Ok(());
                };

                let session = HSTRING::from(session);
                for (method, params) in in_frame(&scripts) {
                    let ignored =
                        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                    // Safe: the engine holds the handler until it answers, on this thread.
                    let _ = unsafe {
                        sessions.CallDevToolsProtocolMethodForSession(
                            &session,
                            &HSTRING::from(method),
                            &HSTRING::from(params),
                            &ignored,
                        )
                    };
                }
                Ok(())
            }));

        let mut token = 0i64;
        // Safe: the engine holds the handler for as long as the webview lives.
        let listening =
            unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &raw mut token) };
        listening.is_ok() && waited(core, "Target.setAutoAttach", &attaching())
    }

    /// Runs one protocol method and waits for the engine to answer it, with a nested
    /// message pump: true for a method that succeeded.
    #[allow(
        unsafe_code,
        reason = "the DevTools protocol is WebView2's own, reached through its COM interface"
    )]
    fn waited(core: &ICoreWebView2, method: &str, params: &str) -> bool {
        let asked = core.clone();
        let method = HSTRING::from(method);
        let params = HSTRING::from(params);

        CallDevToolsProtocolMethodCompletedHandler::wait_for_async_operation(
            // Safe: as above.
            Box::new(move |handler| unsafe {
                asked
                    .CallDevToolsProtocolMethod(&method, &params, &handler)
                    .map_err(Into::into)
            }),
            Box::new(|error, _answer| error),
        )
        .is_ok()
    }

    /// Runs one protocol method and hands its answer on, or `None` for one that failed.
    /// Never waits: the answer arrives on this thread when the engine has it.
    #[allow(
        unsafe_code,
        reason = "the DevTools protocol is WebView2's own, reached through its COM interface"
    )]
    fn call(
        core: &ICoreWebView2,
        method: &str,
        params: &str,
        then: impl FnOnce(Option<String>) + 'static,
    ) {
        // Whichever of the two roads below answers first answers, and only once: the
        // engine's handler, or a call the engine refused outright.
        let then = Rc::new(RefCell::new(Some(then)));
        let answering = Rc::clone(&then);
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, answer| {
                let taken = answering.borrow_mut().take();
                if let Some(then) = taken {
                    then(result.ok().map(|()| answer));
                }
                Ok(())
            }));

        // Safe: the engine holds the handler until it answers, on this same thread.
        let sent = unsafe {
            core.CallDevToolsProtocolMethod(
                &HSTRING::from(method),
                &HSTRING::from(params),
                &handler,
            )
        };
        if sent.is_err() {
            let taken = then.borrow_mut().take();
            if let Some(then) = taken {
                then(None);
            }
        }
    }

    /// Runs `expression` in nib's world in the page as it is now, and hands on the
    /// protocol's answer - `{"result": {"value": ...}}` - or `None`.
    ///
    /// Three steps, each the engine's answer to the last: the page's frame, nib's world in
    /// it, and the expression run there. The page's own `fetch`, DOM methods and
    /// prototypes are not the ones this calls, so a page that has wrapped them neither
    /// sees the call nor changes its answer. Never waits, so it may be asked from inside
    /// one of the engine's own handlers.
    pub fn evaluate(
        core: &ICoreWebView2,
        expression: String,
        answer: impl FnOnce(Option<String>) + 'static,
    ) {
        let world = core.clone();
        call(core, "Page.getFrameTree", "{}", move |tree| {
            let Some(frame) = tree.as_deref().and_then(frame_of) else {
                answer(None);
                return;
            };
            let running = world.clone();
            call(
                &world,
                "Page.createIsolatedWorld",
                &world_in(&frame),
                move |made| {
                    let Some(context) = made.as_deref().and_then(context_of) else {
                        answer(None);
                        return;
                    };
                    call(
                        &running,
                        "Runtime.evaluate",
                        &evaluating(&expression, context),
                        answer,
                    );
                },
            );
        });
    }
}

#[cfg(feature = "cef")]
pub use engine::{asking, sent, value};

/// nib's own Chromium: the same protocol `WebView2` is cleared with, spoken through the
/// runtime's own door to the page's agent (see engine/devtools.rs). What the runtime puts
/// in every page is two things there: a script it registers over the protocol, taken
/// back here the way `WebView2`'s are, and `window.ipc`, which nib's own renderer never
/// gives a page that is not the app's (see cef/src/helper.rs).
#[cfg(feature = "cef")]
mod engine {
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{Url, Webview};

    use crate::engine::devtools;

    use super::{
        attached_frame, attaching, context_of, evaluating, frame_of, in_frame, registering,
        taken_back, world_in, Cleared, MARK,
    };

    /// How long one step of the clearing waits for the page's agent.
    const PATIENCE: Duration = Duration::from_secs(10);

    /// The one function nib's world has, and no other world: see `web_opens::BINDING`.
    fn binding() -> Value {
        json!({ "name": crate::web_opens::BINDING, "executionContextName": super::WORLD })
    }

    /// Hears what nib's world in the page asks through its binding, for as long as the
    /// page is open, and hands each call to `web_opens`.
    pub fn asking(view: &Webview, app: &tauri::AppHandle, tab: &str, window: &str) {
        let (app, tab, window) = (app.clone(), tab.to_string(), window.to_string());
        let _ = devtools::hear(view, move |method, _session, params| {
            if method != "Runtime.bindingCalled"
                || params.get("name").and_then(Value::as_str) != Some(crate::web_opens::BINDING)
            {
                return;
            }
            if let Some(payload) = params.get("payload").and_then(Value::as_str) {
                crate::web_opens::heard_on_chromium(&app, &window, &tab, payload);
            }
        });
    }

    /// One call, its answer or `None`; the parameters as the helpers above write them.
    fn called(view: &Webview, method: &str, params: &str) -> Option<Value> {
        let params: Value = serde_json::from_str(params).ok()?;
        devtools::call(view, None, method, &params, PATIENCE).ok()
    }

    /// Clears a page built on `about:blank` - the runtime's scripts taken back, nib's own
    /// registered in nib's world, frames from other sites followed - and sends it to the
    /// site. On a thread of its own: every step waits for the page's agent, whose answers
    /// arrive on the window's thread.
    ///
    /// The runtime registers its script before the blank page loads, and the protocol
    /// answers in the order it is asked, so the mark registered here is numbered after the
    /// runtime's and every identifier up to it is the runtime's. The site is loaded
    /// whatever the clearing says, as on `WebView2`.
    pub fn sent(view: &Webview, url: &Url, scripts: &str) -> Cleared {
        let enabled = called(view, "Page.enable", "{}").is_some();
        let taken = called(
            view,
            "Page.addScriptToEvaluateOnNewDocument",
            &json!({ "source": MARK }).to_string(),
        )
        .and_then(|said| said.get("identifier")?.as_str().map(str::to_string))
        .as_deref()
        .and_then(taken_back)
        .map(|every| {
            every
                .filter(|id| {
                    called(
                        view,
                        "Page.removeScriptToEvaluateOnNewDocument",
                        &json!({ "identifier": id.to_string() }).to_string(),
                    )
                    .is_some()
                })
                .count()
        });

        let ours = scripts.is_empty()
            || (enabled
                && called(view, "Runtime.addBinding", &binding().to_string()).is_some()
                && called(
                    view,
                    "Page.addScriptToEvaluateOnNewDocument",
                    &registering(scripts),
                )
                .is_some());
        let frames = scripts.is_empty() || following(view, scripts);

        let _ = view.navigate(url.clone());
        Cleared {
            swept: taken.is_some(),
            counted: taken,
            ours,
            frames,
        }
    }

    /// Follows the page's frames from other sites and gives each nib's scripts before its
    /// first document, as on `WebView2`: the frame's own session is told, in order and
    /// without waiting, from inside the event that says it was attached.
    fn following(view: &Webview, scripts: &str) -> bool {
        let telling = view.clone();
        let scripts = scripts.to_string();
        let heard = devtools::hear(view, move |method, _session, params| {
            if method != "Target.attachedToTarget" {
                return;
            }
            let Some(session) = attached_frame(&params.to_string()) else {
                return;
            };
            let said = std::iter::once(("Runtime.addBinding", binding()))
                .chain(
                    in_frame(&scripts)
                        .into_iter()
                        .filter_map(|(method, params)| {
                            Some((method, serde_json::from_str(&params).ok()?))
                        }),
                )
                .collect();
            devtools::tell(&telling, Some(&session), said);
        });
        heard.is_ok() && called(view, "Target.setAutoAttach", &attaching()).is_some()
    }

    /// Runs `expression` in nib's world in the page as it is now and answers what it came
    /// to, or `None`. On a thread of its own, like `sent`: the page's own `fetch`, DOM
    /// methods and globals are not the ones this uses, so a page neither sees the call nor
    /// changes its answer, and nothing it leaves behind is the page's to see.
    pub fn value(view: &Webview, expression: &str) -> Option<Value> {
        let tree = called(view, "Page.getFrameTree", "{}")?;
        let frame = frame_of(&tree.to_string())?;
        let world = called(view, "Page.createIsolatedWorld", &world_in(&frame))?;
        let context = context_of(&world.to_string())?;
        called(view, "Runtime.evaluate", &evaluating(expression, context))?
            .pointer("/result/value")
            .cloned()
    }
}

/// The name wry registers its message channel under on the two `WebKit` engines, which
/// is what the page's `window.ipc` posts to.
#[cfg(all(not(windows), not(feature = "cef")))]
const CHANNEL: &str = "ipc";

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly as _};
    use objc2_foundation::{NSString, NSURLRequest, NSURL};
    use objc2_web_kit::{WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebView};
    use tauri::webview::PlatformWebview;

    use super::{Cleared, CHANNEL, WORLD};

    /// Clears a page built on `about:blank` of everything the runtime put in it, puts
    /// nib's own scripts in a content world of nib's own, and sends it to the site. On the
    /// main thread, where the webview lives.
    ///
    /// The user content controller is the one the view was built with - the
    /// configuration it hands out is a copy, and the controller in it is the view's own -
    /// and its scripts apply from the next document on, which is the site's.
    #[allow(
        unsafe_code,
        reason = "a WKWebView's user scripts are reached through the Objective-C runtime"
    )]
    pub fn sent(webview: &PlatformWebview, url: &str, scripts: &str) -> Cleared {
        let Some(mtm) = MainThreadMarker::new() else {
            return Cleared::default();
        };
        // SAFETY: the pointer is the WKWebView wry built for this page, alive for as
        // long as the page is; this runs on the main thread, where it belongs.
        let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
            return Cleared::default();
        };

        // SAFETY: the view's own user content controller, on the main thread.
        let content = unsafe { view.configuration().userContentController() };
        // SAFETY: as above. Taking the channel's handler away is what takes
        // `window.webkit.messageHandlers.ipc` out of the page.
        let counted = unsafe {
            let counted = content.userScripts().count();
            content.removeAllUserScripts();
            content.removeScriptMessageHandlerForName(&NSString::from_str(CHANNEL));
            counted
        };

        if !scripts.is_empty() {
            // SAFETY: a user script made and added on the main thread, in a content world
            // the page's own scripts cannot see.
            unsafe {
                let world = WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm);
                let script =
                    WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                        WKUserScript::alloc(mtm),
                        &NSString::from_str(scripts),
                        WKUserScriptInjectionTime::AtDocumentStart,
                        false,
                        &world,
                    );
                content.addUserScript(&script);
            }
        }

        if let Some(address) = NSURL::URLWithString(&NSString::from_str(url)) {
            // SAFETY: a load asked of the view on the main thread.
            let _ = unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&address)) };
        }

        Cleared {
            swept: true,
            counted: Some(counted),
            ours: true,
            frames: true,
        }
    }
}

#[cfg(all(
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ),
    not(feature = "cef")
))]
mod engine {
    use tauri::webview::PlatformWebview;
    use webkit2gtk::{
        UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
        WebViewExt,
    };

    use super::{Cleared, CHANNEL, WORLD};

    /// Clears a page built on `about:blank` of everything the runtime put in it, puts
    /// nib's own scripts in a script world of nib's own, and sends it to the site. On the
    /// main thread, where the webview lives; the scripts apply from the next document on,
    /// which is the site's.
    pub fn sent(webview: &PlatformWebview, url: &str, scripts: &str) -> Cleared {
        let view = webview.inner();
        let Some(content) = view.user_content_manager() else {
            view.load_uri(url);
            return Cleared::default();
        };

        content.remove_all_scripts();
        content.unregister_script_message_handler(CHANNEL);
        if !scripts.is_empty() {
            content.add_script(&UserScript::for_world(
                scripts,
                UserContentInjectedFrames::AllFrames,
                UserScriptInjectionTime::Start,
                WORLD,
                &[],
                &[],
            ));
        }
        view.load_uri(url);

        Cleared {
            swept: true,
            counted: None,
            ours: true,
            frames: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        attached_frame, attaching, context_of, evaluating, frame_of, in_frame, registering,
        taken_back, world_in, Cleared, WORLD,
    };

    #[test]
    fn the_trace_says_what_was_taken_back_and_what_was_put_in() {
        let all = Cleared {
            swept: true,
            counted: Some(14),
            ours: true,
            frames: true,
        };
        assert_eq!(
            all.said(),
            "14 of the runtime's scripts taken back, nib's own in nib's world"
        );
        let none = Cleared::default();
        assert_eq!(
            none.said(),
            "the runtime's scripts left in, nib's own missing, not in other sites' frames"
        );
    }

    #[test]
    fn every_script_up_to_the_marker_is_taken_back() {
        assert_eq!(taken_back("7"), Some(1..=7));
        assert_eq!(taken_back("1"), Some(1..=1));
    }

    #[test]
    fn a_numbering_this_does_not_read_takes_nothing_back() {
        for said in ["", "0", "-3", "{A1B2}", "7a", "4294967296"] {
            assert_eq!(taken_back(said), None, "{said:?}");
        }
    }

    #[test]
    fn nib_s_scripts_are_registered_in_nib_s_world_and_never_the_page_s() {
        let asked: serde_json::Value =
            serde_json::from_str(&registering("(function () {})()")).expect("json");
        assert_eq!(asked["worldName"], WORLD);
        assert_eq!(asked["source"], "(function () {})()");
        // The page's own world is the one with no name.
        assert!(!WORLD.is_empty());
    }

    #[test]
    fn the_world_is_asked_for_in_the_page_s_own_frame() {
        let tree =
            r#"{"frameTree":{"frame":{"id":"4F2A","url":"https://a.example/"},"childFrames":[]}}"#;
        assert_eq!(frame_of(tree).as_deref(), Some("4F2A"));
        assert_eq!(frame_of("{}"), None);
        assert_eq!(frame_of("not json"), None);

        let asked: serde_json::Value = serde_json::from_str(&world_in("4F2A")).expect("json");
        assert_eq!(asked["frameId"], "4F2A");
        assert_eq!(asked["worldName"], WORLD);
    }

    #[test]
    fn a_frame_from_another_site_is_followed_and_held_until_it_has_nib_s_world() {
        let asked: serde_json::Value = serde_json::from_str(&attaching()).expect("json");
        assert_eq!(asked["autoAttach"], true);
        assert_eq!(asked["waitForDebuggerOnStart"], true);
        assert_eq!(asked["flatten"], true);
        assert_eq!(asked["filter"][0]["type"], "iframe");

        let frame = r#"{"sessionId":"S1","targetInfo":{"targetId":"T1","type":"iframe","url":"https://b.example/"},"waitingForDebugger":true}"#;
        assert_eq!(attached_frame(frame).as_deref(), Some("S1"));
        let worker = r#"{"sessionId":"S2","targetInfo":{"targetId":"T2","type":"worker"}}"#;
        assert_eq!(attached_frame(worker), None);
        assert_eq!(attached_frame("{}"), None);
    }

    #[test]
    fn a_frame_is_given_nib_s_world_and_always_let_go_last() {
        let sent = in_frame("(function () {})()");
        let methods: Vec<&str> = sent.iter().map(|(method, _)| *method).collect();
        assert_eq!(
            methods,
            [
                "Page.enable",
                "Page.addScriptToEvaluateOnNewDocument",
                "Target.setAutoAttach",
                "Runtime.runIfWaitingForDebugger",
            ]
        );
        let registered: serde_json::Value = serde_json::from_str(&sent[1].1).expect("json");
        assert_eq!(registered["worldName"], WORLD);
    }

    #[test]
    fn an_expression_runs_in_that_world_and_answers_with_its_value() {
        assert_eq!(context_of(r#"{"executionContextId":12}"#), Some(12));
        assert_eq!(context_of(r#"{"executionContextId":"12"}"#), None);
        assert_eq!(context_of("{}"), None);

        let asked: serde_json::Value =
            serde_json::from_str(&evaluating("1 + 1", 12)).expect("json");
        assert_eq!(asked["contextId"], 12);
        assert_eq!(asked["expression"], "1 + 1");
        assert_eq!(asked["awaitPromise"], true);
        assert_eq!(asked["returnByValue"], true);
    }
}
