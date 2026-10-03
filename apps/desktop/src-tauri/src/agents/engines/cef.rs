//! An agent's own tab on nib's own Chromium: a browser with no window at all
//! (docs/agent-native.md 12).
//!
//! **Windowless, not out of sight.** On `WebView2` an agent's page is a window clipped to
//! nothing; here it is better than that: an Alloy-style browser with off-screen rendering,
//! which CEF builds without any native window - no window to be on a screen, to come to
//! the front, to take the keyboard or to be counted by the system as hidden. It paints
//! into a buffer nobody reads at a frame rate of its own (60), is told it is shown
//! (`WasHidden(false)`) and lays itself out at the tab's own size, so to the page it is a
//! visible tab at a desktop size and to the reader it is nothing. CEF mixes styles per
//! browser, so the reader's tabs stay Chrome style beside it (docs/browser.md 1). Its
//! `<select>` lists are paints of the page too, never windows.
//!
//! **The same protocol, through the browser's own agent.** Calls are
//! `SendDevToolsMessage` on the browser's host and answers and events come back to one
//! observer per browser (`AddDevToolsMessageObserver`) - no port, no socket - so every
//! verb in `browser.rs` and `page.rs` runs here unchanged. The host may only be spoken to
//! on CEF's UI thread, so a call from anywhere else is posted there, and its answer comes
//! back over a channel the caller waits on; the raw message is read, because only it says
//! which frame's session an event is from.
//!
//! **Quiet by its handlers.** Everything that would reach the reader is this browser's own
//! handler, answered here: dialogs held for `browser_dialog` (`quiet.rs` keeps them),
//! windows the page opens made more windowless agent tabs with their opener kept,
//! permissions refused, downloads into the agent's folder under the ceiling, the file
//! chooser intercepted (and refused should it ever get past), sign-in boxes and client
//! certificates refused, no context menu, no sound, and a site the agent may not visit
//! stopped before it loads.
//!
//! **Only for somebody who uses agents.** Off-screen rendering is a switch CEF reads once
//! as it starts, for the whole process, and its own documentation says it can cost a
//! browser that never renders off screen. So it is on only in a run that started with an
//! agent already paired (`windowless_wanted`, which `cef/src/main.rs` asks); the first
//! agent paired in a run gets its tabs from the next launch, and is told so.

#![allow(
    clippy::transmute_ptr_to_ptr,
    reason = "the cef crate's wrap_* macros transmute between a wrapper and the struct it wraps"
)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

#[allow(
    clippy::wildcard_imports,
    reason = "the cef crate's wrap_* macros expand to calls on its traits by their bare names"
)]
use cef::*;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::super::cdp;
use super::super::quiet::{self, Owner};
use super::super::tabs;
use super::super::verbs::{Dialog, DialogKind, Download, DownloadState};
use super::View;

/// The frame rate an agent's page paints at: a visible tab's.
const FRAME_RATE: i32 = 60;

/// Whether this run's engine can make windowless browsers: decided once, before CEF
/// starts, by `windowless_wanted`.
static WINDOWLESS: OnceLock<bool> = OnceLock::new();

/// Whether a run should start CEF able to make windowless browsers: when an agent is
/// paired with this installation, which is when `<config>/agents.json` names one. Asked
/// once by the engine's binary before CEF starts; the answer is this run's.
pub fn windowless_wanted(config: &Path) -> bool {
    *WINDOWLESS.get_or_init(|| {
        std::fs::read_to_string(config.join("agents.json")).is_ok_and(|text| paired(&text))
    })
}

/// Whether the agents' file names an agent.
fn paired(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|file| file.get("agents")?.as_array().map(|all| !all.is_empty()))
        .unwrap_or(false)
}

/// Who hears a page's events: the method, the frame's session (`None` for the page's
/// own) and the parameters.
type Hearing = Arc<dyn Fn(&str, Option<&str>, &Value) + Send + Sync>;

/// One agent page and everything about it, from before its browser exists to after it
/// closed.
struct Page {
    owner: Owner,
    app: AppHandle,
    size: (u32, u32),
    /// Where it was sent to go once it was built and quietened.
    going: Mutex<Option<String>>,
    /// Told once the browser exists, or why it never will.
    built: Mutex<Option<SyncSender<Result<(), String>>>>,
    host: Mutex<Option<BrowserHost>>,
    /// Kept for as long as the observer should hear.
    observing: Mutex<Option<Registration>>,
    url: Mutex<String>,
    waiting: Mutex<HashMap<i32, SyncSender<Result<Value, String>>>>,
    hearing: Mutex<Vec<Hearing>>,
    /// The dialog the page holds: its number, and how it is answered.
    dialog: Mutex<Option<(u64, JsdialogCallback)>>,
}

impl Page {
    fn host(&self) -> Option<BrowserHost> {
        self.host.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn say(&self, text: String) {
        quiet::say(&self.owner.label, "warning", text);
    }
}

/// An agent's page on nib's own Chromium, as the verbs hold it.
#[derive(Clone)]
pub struct Windowless {
    label: String,
    page: Arc<Page>,
}

/// Every agent page that has a browser, by label.
static PAGES: Mutex<Option<HashMap<String, Windowless>>> = Mutex::new(None);

/// The next message's id: every page here is this crate's own browser, so the ids are
/// this crate's to count.
static NEXT: AtomicI32 = AtomicI32::new(1);

/// The page under a label, while it has a browser.
pub fn page(label: &str) -> Option<Windowless> {
    PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(label)
        .cloned()
}

impl Windowless {
    /// Its label.
    pub fn label(&self) -> &str {
        &self.label
    }

    /// Where it is, as its own frame last said.
    pub fn url(&self) -> String {
        self.page
            .url
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Closes it: gone from every list at once, its browser let go on CEF's thread.
    pub fn close(&self) {
        if let Some(all) = PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            all.remove(&self.label);
        }
        if let Some(host) = self.page.host() {
            on_ui(move || host.close_browser(1));
        }
    }

    /// Sends one call, from any thread, and answers where its answer arrives.
    pub fn ask(
        &self,
        session: Option<&str>,
        method: &str,
        params: &Value,
    ) -> Result<cdp::Answering, String> {
        let host = self
            .page
            .host()
            .ok_or("the page has closed")?;
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = Value::from(session);
        }
        let (answered, answer) = sync_channel(1);
        self.page
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, answered);
        let page = Arc::clone(&self.page);
        let bytes = message.to_string().into_bytes();
        let posted = on_ui(move || {
            if host.send_dev_tools_message(Some(&bytes)) == 0 {
                if let Some(waiting) = page
                    .waiting
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(&id)
                {
                    let _ = waiting.try_send(Err("the page refused the message".into()));
                }
            }
        });
        if !posted {
            self.page
                .waiting
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            return Err("the engine's thread could not be reached".into());
        }
        Ok(answer)
    }

    /// One call nobody waits for.
    pub fn tell(&self, method: &str, params: &Value) {
        let _ = self.ask(None, method, params);
    }

    /// Hears every event the page says from now on.
    pub fn hear(&self, heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static) {
        self.page
            .hearing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Arc::new(heard));
    }
}

/// A piece of work for CEF's UI thread, taken by whichever runs it first.
type Work = Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>;

/// Runs `job` on CEF's UI thread, the only one a browser may be spoken to on. Whether it
/// was posted.
fn on_ui(job: impl FnOnce() + Send + 'static) -> bool {
    let job: Work = Arc::new(Mutex::new(Some(Box::new(job))));
    let mut task = Job::new(job);
    post_task(ThreadId::UI, Some(&mut task)) != 0
}

wrap_task! {
    struct Job {
        job: Work,
    }

    impl Task {
        fn execute(&self) {
            let job = self.job.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(job) = job {
                job();
            }
        }
    }
}

/// Builds an agent's page in the profile of `store` - the one every space shares when
/// `None` - at `size` CSS pixels, quietened before it loads anything, and sends it to
/// `going`. Waits for the browser, from any thread but CEF's own.
pub fn build(
    app: &AppHandle,
    owner: &Owner,
    store: Option<&str>,
    size: (u32, u32),
    going: Option<&str>,
) -> Result<(), String> {
    if !WINDOWLESS.get().copied().unwrap_or(false) {
        return Err(
            "nib's own Chromium makes agents' pages from the launch after the first agent was paired: quit nib and open it again"
                .into(),
        );
    }
    let profile = crate::engine::profile(app, store)?;
    let (built, waiting) = sync_channel(1);
    let page = Arc::new(Page {
        owner: owner.clone(),
        app: app.clone(),
        size,
        going: Mutex::new(going.map(str::to_string)),
        built: Mutex::new(Some(built)),
        host: Mutex::new(None),
        observing: Mutex::new(None),
        url: Mutex::new("about:blank".into()),
        waiting: Mutex::new(HashMap::new()),
        hearing: Mutex::new(Vec::new()),
        dialog: Mutex::new(None),
    });
    let making = Arc::clone(&page);
    let posted = on_ui(move || {
        // A profile other than the primary one is made asynchronously, and a browser
        // asked for before it is ready is no browser: the browser is made once the
        // context says it is.
        let settings = RequestContextSettings {
            cache_path: profile.to_string_lossy().as_ref().into(),
            ..Default::default()
        };
        let mut ready = Ready::new(Arc::new(Mutex::new(Some(Arc::clone(&making)))));
        if request_context_create_context(Some(&settings), Some(&mut ready)).is_none() {
            finished(&making, Err("the page's profile could not be opened".into()));
        }
    });
    if !posted {
        return Err("the engine's thread could not be reached".into());
    }
    waiting
        .recv_timeout(tabs::BUILDING)
        .map_err(|_| "the page was never built".to_string())?
}

/// Says to whoever waits on a page's build how it went, once.
fn finished(page: &Page, outcome: Result<(), String>) {
    if let Some(built) = page
        .built
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
    {
        let _ = built.try_send(outcome);
    }
}

wrap_request_context_handler! {
    struct Ready {
        page: Arc<Mutex<Option<Arc<Page>>>>,
    }

    impl RequestContextHandler {
        fn on_request_context_initialized(&self, request_context: Option<&mut RequestContext>) {
            let Some(page) = self.page.lock().unwrap_or_else(PoisonError::into_inner).take() else {
                return;
            };
            let mut client = Agent::new(Arc::clone(&page));
            let made = browser_host_create_browser_sync(
                Some(&windowless()),
                Some(&mut client),
                Some(&CefString::from("about:blank")),
                Some(&browser_settings()),
                None,
                request_context,
            );
            if made.is_none() {
                finished(&page, Err("the engine made no page".into()));
            }
        }
    }
}

/// A browser with no window, in Alloy style: the only style CEF renders off screen.
fn windowless() -> WindowInfo {
    WindowInfo {
        windowless_rendering_enabled: 1,
        runtime_style: RuntimeStyle::ALLOY,
        ..Default::default()
    }
}

/// An agent page's settings: its own frame rate, and an opaque page, as a tab's is.
fn browser_settings() -> BrowserSettings {
    BrowserSettings {
        windowless_frame_rate: FRAME_RATE,
        background_color: 0xFFFF_FFFF,
        ..Default::default()
    }
}

/// What an agent's page has been told before anything loads: the file chooser
/// intercepted, `print()` and the pickers stubbed, the page domain on first since a
/// script registered with it off is kept and never run.
fn quietened(page: &Windowless) {
    page.tell("Page.enable", &json!({}));
    page.tell("Page.setInterceptFileChooserDialog", &json!({ "enabled": true }));
    page.tell(
        "Page.addScriptToEvaluateOnNewDocument",
        &json!({ "source": quiet::STUBS, "runImmediately": true }),
    );
}

/// A browser made for a page: kept, heard, quietened and sent where it was going. On
/// CEF's UI thread.
fn made(page: &Arc<Page>, browser: &Browser) {
    let Some(host) = browser.host() else {
        finished(page, Err("the engine made a page with no host".into()));
        return;
    };
    host.was_hidden(0);
    host.set_windowless_frame_rate(FRAME_RATE);
    host.set_audio_muted(1);
    let mut observer = Listening::new(Arc::clone(page));
    let observing = host.add_dev_tools_message_observer(Some(&mut observer));
    *page.observing.lock().unwrap_or_else(PoisonError::into_inner) = observing;
    *page.host.lock().unwrap_or_else(PoisonError::into_inner) = Some(host);

    let handle = Windowless {
        label: page.owner.label.clone(),
        page: Arc::clone(page),
    };
    PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashMap::new)
        .insert(handle.label.clone(), handle.clone());
    cdp::follow_view(&View::Windowless(handle.clone()), &handle.label);
    quietened(&handle);
    let going = page
        .going
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some(url) = going {
        handle.tell("Page.navigate", &json!({ "url": url }));
    }
    finished(page, Ok(()));
}

/// A page's browser closed: everything that held it let go of.
fn closed(page: &Page) {
    if let Some(all) = PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        if all
            .get(&page.owner.label)
            .is_some_and(|one| std::ptr::eq(Arc::as_ptr(&one.page), page))
        {
            all.remove(&page.owner.label);
        }
    }
    page.observing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    page.host.lock().unwrap_or_else(PoisonError::into_inner).take();
    page.dialog
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    quiet::release(&page.owner.label);
    for (_, waiting) in page
        .waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .drain()
    {
        let _ = waiting.try_send(Err("the page has closed".into()));
    }
}

wrap_dev_tools_message_observer! {
    struct Listening {
        page: Arc<Page>,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_message(
            &self,
            _browser: Option<&mut Browser>,
            message: Option<&[u8]>,
        ) -> ::std::os::raw::c_int {
            if let Some(message) = message.and_then(|raw| serde_json::from_slice::<Value>(raw).ok()) {
                heard(&self.page, &message);
            }
            1
        }
    }
}

/// One message from the page's agent: an answer for whoever waits on its id, or an event
/// for whoever hears the page.
fn heard(page: &Page, message: &Value) {
    if let Some(id) = message
        .get("id")
        .and_then(Value::as_i64)
        .and_then(|id| i32::try_from(id).ok())
    {
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
    let session = message.get("sessionId").and_then(Value::as_str);
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

/// Answers the dialog a page holds: OK or Cancel, and a prompt's words.
pub fn answer_dialog(
    _app: &AppHandle,
    label: &str,
    accept: bool,
    text: Option<String>,
) -> Result<(), String> {
    let found = page(label).ok_or("the page has closed")?;
    settle(&found.page, None, accept, text);
    Ok(())
}

/// Gives the engine its answer to a held dialog: the one with `number` when named,
/// whichever is held otherwise.
fn settle(page: &Arc<Page>, number: Option<u64>, accept: bool, text: Option<String>) {
    let held = {
        let mut dialog = page.dialog.lock().unwrap_or_else(PoisonError::into_inner);
        if dialog
            .as_ref()
            .is_some_and(|(one, _)| number.is_none_or(|number| *one == number))
        {
            dialog.take()
        } else {
            None
        }
    };
    let Some((_, callback)) = held else {
        return;
    };
    quiet::release(&page.owner.label);
    on_ui(move || {
        let words = text.map(|one| CefString::from(one.as_str()));
        callback.cont(i32::from(accept), words.as_ref());
    });
}

/// Holds a dialog for the agent, and answers it the safe way if nobody does.
fn hold(page: &Arc<Page>, kind: DialogKind, message: String, default: String, url: String, callback: JsdialogCallback) {
    let number = quiet::NUMBER.fetch_add(1, Ordering::Relaxed);
    *page.dialog.lock().unwrap_or_else(PoisonError::into_inner) = Some((number, callback));
    quiet::hold(
        &page.owner.label,
        Dialog {
            kind,
            message: cdp::cut(message, 4_000),
            default_text: (kind == DialogKind::Prompt).then_some(default),
            url,
            open_ms: 0,
        },
    );
    let late = Arc::clone(page);
    std::thread::spawn(move || {
        std::thread::sleep(quiet::DIALOG_PATIENCE);
        settle(&late, Some(number), kind == DialogKind::Alert, None);
    });
}

/// A string CEF handed over, as text.
fn text(said: Option<&CefString>) -> String {
    said.map(ToString::to_string).unwrap_or_default()
}

wrap_client! {
    struct Agent {
        page: Arc<Page>,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(Screen::new(Arc::clone(&self.page)))
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(Life::new(Arc::clone(&self.page)))
        }

        fn jsdialog_handler(&self) -> Option<JsdialogHandler> {
            Some(Dialogs::new(Arc::clone(&self.page)))
        }

        fn permission_handler(&self) -> Option<PermissionHandler> {
            Some(Permissions::new(Arc::clone(&self.page)))
        }

        fn download_handler(&self) -> Option<DownloadHandler> {
            Some(Downloads::new(Arc::clone(&self.page)))
        }

        fn dialog_handler(&self) -> Option<DialogHandler> {
            Some(Files::new(Arc::clone(&self.page)))
        }

        fn context_menu_handler(&self) -> Option<ContextMenuHandler> {
            Some(Menus::new())
        }

        fn request_handler(&self) -> Option<RequestHandler> {
            Some(Requests::new(Arc::clone(&self.page)))
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(Display::new(Arc::clone(&self.page)))
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(Loads::new(Arc::clone(&self.page)))
        }
    }
}

wrap_render_handler! {
    struct Screen {
        page: Arc<Page>,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (width, height) = self.page.size;
                *rect = Rect {
                    x: 0,
                    y: 0,
                    width: i32::try_from(width).unwrap_or(1280),
                    height: i32::try_from(height).unwrap_or(800),
                };
            }
        }

        fn screen_info(
            &self,
            _browser: Option<&mut Browser>,
            screen_info: Option<&mut ScreenInfo>,
        ) -> ::std::os::raw::c_int {
            let Some(screen) = screen_info else {
                return 0;
            };
            // A screen exactly the tab's size, at one pixel a CSS pixel: nothing the page
            // asks about its screen says anything about the reader's.
            let (width, height) = self.page.size;
            let whole = Rect {
                x: 0,
                y: 0,
                width: i32::try_from(width).unwrap_or(1280),
                height: i32::try_from(height).unwrap_or(800),
            };
            screen.device_scale_factor = 1.0;
            screen.depth = 24;
            screen.depth_per_component = 8;
            screen.rect.clone_from(&whole);
            screen.available_rect = whole;
            1
        }

        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            _type_: PaintElementType,
            _dirty_rects: Option<&[Rect]>,
            _buffer: *const u8,
            _width: ::std::os::raw::c_int,
            _height: ::std::os::raw::c_int,
        ) {
            // Nobody looks: a picture is the protocol's (`Page.captureScreenshot`), and
            // the activity panel's is its screencast.
        }
    }
}

wrap_life_span_handler! {
    struct Life {
        page: Arc<Page>,
    }

    impl LifeSpanHandler {
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: ::std::os::raw::c_int,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int,
            _popup_features: Option<&PopupFeatures>,
            window_info: Option<&mut WindowInfo>,
            client: Option<&mut Option<Client>>,
            settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            let url = text(target_url);
            let owner = &self.page.owner;
            if let Err(why) = tabs::may_open(owner, &url) {
                self.page.say(format!("nib refused a window to {url}: {why}"));
                return 1;
            }
            let (Some(window_info), Some(client), Some(settings)) = (window_info, client, settings) else {
                return 1;
            };
            let Some(tab) = tabs::reserve_popup(owner, &url) else {
                return 1;
            };
            // Another agent tab of the same agent, with no window either, and the opener
            // kept so a sign-in popup can post its answer back.
            let popup = Arc::new(Page {
                owner: Owner {
                    agent: owner.agent.clone(),
                    tab: tab.clone(),
                    label: format!("{}{tab}", tabs::LABEL),
                },
                app: self.page.app.clone(),
                size: self.page.size,
                going: Mutex::new(None),
                built: Mutex::new(None),
                host: Mutex::new(None),
                observing: Mutex::new(None),
                url: Mutex::new(url),
                waiting: Mutex::new(HashMap::new()),
                hearing: Mutex::new(Vec::new()),
                dialog: Mutex::new(None),
            });
            *window_info = windowless();
            *settings = browser_settings();
            *client = Some(Agent::new(popup));
            0
        }

        fn on_after_created(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                made(&self.page, browser);
                if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                    tabs::said(&self.page.app, &tab);
                }
            }
        }

        fn do_close(&self, _browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
            0
        }

        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            closed(&self.page);
        }
    }
}

wrap_jsdialog_handler! {
    struct Dialogs {
        page: Arc<Page>,
    }

    impl JsdialogHandler {
        fn on_jsdialog(
            &self,
            _browser: Option<&mut Browser>,
            origin_url: Option<&CefString>,
            dialog_type: JsdialogType,
            message_text: Option<&CefString>,
            default_prompt_text: Option<&CefString>,
            callback: Option<&mut JsdialogCallback>,
            _suppress_message: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            let Some(callback) = callback else {
                return 0;
            };
            let kind = if dialog_type == JsdialogType::CONFIRM {
                DialogKind::Confirm
            } else if dialog_type == JsdialogType::PROMPT {
                DialogKind::Prompt
            } else {
                DialogKind::Alert
            };
            hold(
                &self.page,
                kind,
                text(message_text),
                text(default_prompt_text),
                text(origin_url),
                callback.clone(),
            );
            1
        }

        fn on_before_unload_dialog(
            &self,
            _browser: Option<&mut Browser>,
            message_text: Option<&CefString>,
            _is_reload: ::std::os::raw::c_int,
            callback: Option<&mut JsdialogCallback>,
        ) -> ::std::os::raw::c_int {
            let Some(callback) = callback else {
                return 0;
            };
            let url = self.page.url.lock().unwrap_or_else(PoisonError::into_inner).clone();
            hold(
                &self.page,
                DialogKind::Beforeunload,
                text(message_text),
                String::new(),
                url,
                callback.clone(),
            );
            1
        }

        fn on_reset_dialog_state(&self, _browser: Option<&mut Browser>) {
            self.page.dialog.lock().unwrap_or_else(PoisonError::into_inner).take();
            quiet::release(&self.page.owner.label);
        }
    }
}

wrap_permission_handler! {
    struct Permissions {
        page: Arc<Page>,
    }

    impl PermissionHandler {
        fn on_request_media_access_permission(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut MediaAccessCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cont(0);
            }
            self.page.say(format!(
                "nib refused {} the camera and the microphone",
                text(requesting_origin)
            ));
            1
        }

        fn on_show_permission_prompt(
            &self,
            _browser: Option<&mut Browser>,
            _prompt_id: u64,
            requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut PermissionPromptCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cont(PermissionRequestResult::DENY);
            }
            self.page
                .say(format!("nib refused {} a permission", text(requesting_origin)));
            1
        }
    }
}

wrap_download_handler! {
    struct Downloads {
        page: Arc<Page>,
    }

    impl DownloadHandler {
        fn can_download(
            &self,
            _browser: Option<&mut Browser>,
            _url: Option<&CefString>,
            _request_method: Option<&CefString>,
        ) -> ::std::os::raw::c_int {
            1
        }

        fn on_before_download(
            &self,
            _browser: Option<&mut Browser>,
            download_item: Option<&mut DownloadItem>,
            suggested_name: Option<&CefString>,
            callback: Option<&mut BeforeDownloadCallback>,
        ) -> ::std::os::raw::c_int {
            let (Some(item), Some(callback)) = (download_item, callback) else {
                return 0;
            };
            let owner = &self.page.owner;
            // Not continued is cancelled, with Alloy style: 0 for every refusal.
            let Some(path) = quiet::destination(&self.page.app, &owner.agent, &text(suggested_name)) else {
                return 0;
            };
            let record = Download {
                tab: owner.tab.clone(),
                url: CefString::from(&item.url()).to_string(),
                path: path.to_string_lossy().into_owned(),
                state: DownloadState::Going,
            };
            if item.total_bytes() > quiet::MOST_DOWNLOAD {
                quiet::noted(
                    &owner.agent,
                    Download {
                        state: DownloadState::TooLarge,
                        ..record
                    },
                );
                return 0;
            }
            quiet::noted(&owner.agent, record);
            callback.cont(Some(&CefString::from(path.to_string_lossy().as_ref())), 0);
            1
        }

        fn on_download_updated(
            &self,
            _browser: Option<&mut Browser>,
            download_item: Option<&mut DownloadItem>,
            callback: Option<&mut DownloadItemCallback>,
        ) {
            let Some(item) = download_item else {
                return;
            };
            let path = CefString::from(&item.full_path()).to_string();
            if path.is_empty() {
                return;
            }
            let agent = &self.page.owner.agent;
            if item.received_bytes() > quiet::MOST_DOWNLOAD {
                if let Some(callback) = callback {
                    callback.cancel();
                }
                quiet::moved(agent, &path, DownloadState::TooLarge);
            } else if item.is_complete() != 0 {
                quiet::moved(agent, &path, DownloadState::Done);
            } else if item.is_canceled() != 0 || item.is_interrupted() != 0 {
                quiet::moved(agent, &path, DownloadState::Failed);
            }
        }
    }
}

wrap_dialog_handler! {
    struct Files {
        page: Arc<Page>,
    }

    impl DialogHandler {
        fn on_file_dialog(
            &self,
            _browser: Option<&mut Browser>,
            _mode: FileDialogMode,
            _title: Option<&CefString>,
            _default_file_path: Option<&CefString>,
            _accept_filters: Option<&mut CefStringList>,
            _accept_extensions: Option<&mut CefStringList>,
            _accept_descriptions: Option<&mut CefStringList>,
            callback: Option<&mut FileDialogCallback>,
        ) -> ::std::os::raw::c_int {
            // The chooser is intercepted through the protocol and answered by
            // `browser_upload`; one that gets past is never shown.
            if let Some(callback) = callback {
                callback.cancel();
            }
            self.page
                .say("nib refused the page a file chooser: browser_upload answers one".into());
            1
        }
    }
}

wrap_context_menu_handler! {
    struct Menus;

    impl ContextMenuHandler {
        fn on_before_context_menu(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>,
            model: Option<&mut MenuModel>,
        ) {
            if let Some(model) = model {
                model.clear();
            }
        }
    }
}

wrap_request_handler! {
    struct Requests {
        page: Arc<Page>,
    }

    impl RequestHandler {
        fn on_before_browse(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _user_gesture: ::std::os::raw::c_int,
            _is_redirect: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            let (Some(frame), Some(request)) = (frame, request) else {
                return 0;
            };
            if frame.is_main() == 0 {
                return 0;
            }
            let url = CefString::from(&request.url()).to_string();
            match tabs::may_open(&self.page.owner, &url) {
                Ok(()) => {
                    tabs::set(&self.page.owner.tab, |one| one.loading = true);
                    0
                }
                Err(why) => {
                    self.page
                        .say(format!("nib stopped the page going to {url}: {why}"));
                    1
                }
            }
        }

        fn on_open_urlfrom_tab(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            target_url: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            self.page.say(format!(
                "nib kept {} from opening in a tab of the reader's",
                text(target_url)
            ));
            1
        }

        fn auth_credentials(
            &self,
            _browser: Option<&mut Browser>,
            _origin_url: Option<&CefString>,
            _is_proxy: ::std::os::raw::c_int,
            _host: Option<&CefString>,
            _port: ::std::os::raw::c_int,
            _realm: Option<&CefString>,
            _scheme: Option<&CefString>,
            _callback: Option<&mut AuthCallback>,
        ) -> ::std::os::raw::c_int {
            self.page.say(
                "nib refused the site's sign-in box: ask the reader with browser_takeover".into(),
            );
            0
        }

        fn on_select_client_certificate(
            &self,
            _browser: Option<&mut Browser>,
            _is_proxy: ::std::os::raw::c_int,
            _host: Option<&CefString>,
            _port: ::std::os::raw::c_int,
            _certificates: Option<&[Option<X509Certificate>]>,
            callback: Option<&mut SelectClientCertificateCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.select(None);
            }
            self.page
                .say("nib refused the site's request for a client certificate".into());
            1
        }
    }
}

wrap_display_handler! {
    struct Display {
        page: Arc<Page>,
    }

    impl DisplayHandler {
        fn on_address_change(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            if frame.is_some_and(|frame| frame.is_main() != 0) {
                let url = text(url);
                self.page
                    .url
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone_from(&url);
                tabs::set(&self.page.owner.tab, |one| one.url = url);
            }
        }

        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title = text(title);
            tabs::set(&self.page.owner.tab, |one| one.title = title);
            if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                tabs::said(&self.page.app, &tab);
            }
        }

        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            _message: Option<&CefString>,
            _source: Option<&CefString>,
            _line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            // The page's console is the agent's to read (`browser_console`), not the
            // engine's log's.
            1
        }
    }
}

wrap_load_handler! {
    struct Loads {
        page: Arc<Page>,
    }

    impl LoadHandler {
        fn on_loading_state_change(
            &self,
            _browser: Option<&mut Browser>,
            is_loading: ::std::os::raw::c_int,
            _can_go_back: ::std::os::raw::c_int,
            _can_go_forward: ::std::os::raw::c_int,
        ) {
            let loading = is_loading != 0;
            tabs::set(&self.page.owner.tab, |one| one.loading = loading);
            if !loading {
                if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                    tabs::said(&self.page.app, &tab);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{answer, paired};

    #[test]
    fn an_answer_is_its_result_or_the_agent_s_words() {
        assert_eq!(
            answer(&json!({ "id": 3, "result": { "data": "x" } })),
            Ok(json!({ "data": "x" }))
        );
        assert_eq!(
            answer(&json!({ "id": 3, "error": { "code": -32000, "message": "No node" } })),
            Err("No node".to_string())
        );
        assert_eq!(answer(&json!({ "id": 4 })), Ok(serde_json::Value::Null));
    }

    #[test]
    fn a_run_wants_windowless_pages_only_with_an_agent_paired() {
        assert!(paired(r#"{"agents":[{"id":"claude-code"}]}"#));
        assert!(!paired(r#"{"agents":[]}"#));
        assert!(!paired("not json"));
    }
}
