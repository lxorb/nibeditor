//! An agent's page never reaches the reader (docs/agent-native.md 6.2).
//!
//! Every way a page has of putting something in front of somebody - a dialog, a window,
//! a permission bubble, a download's flyout, a sign-in box, a file chooser, the print
//! preview, a picker - is either switched off before the page loads or answered here,
//! out of sight, and said to the agent instead:
//!
//! | the page | here |
//! | --- | --- |
//! | `alert`, `confirm`, `prompt`, `beforeunload` | held with a deferral until `browser_dialog`, or 30 s |
//! | a window | another agent tab of the same agent, `window.opener` kept |
//! | the camera, the microphone, location, notifications, the clipboard | refused |
//! | a download | into `Downloads/nib agents/<agent>`, 500 MB at most |
//! | a file chooser | intercepted, answered by `browser_upload` |
//! | `print()`, `showPicker()` | nothing |
//! | basic authentication, a client certificate | refused |
//!
//! All of it is `WebView2`'s own events on the page's own engine, set on the window's
//! thread on a page that is still `about:blank`, so none of it can be too late.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::AppHandle;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Deferral, ICoreWebView2DownloadOperation,
    ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2ScriptDialogOpeningEventArgs,
    ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5, ICoreWebView2Settings6,
    ICoreWebView2_10, ICoreWebView2_4, ICoreWebView2_5, ICoreWebView2_8,
    COREWEBVIEW2_DOWNLOAD_STATE, COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED,
    COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS, COREWEBVIEW2_PERMISSION_STATE_DENY,
    COREWEBVIEW2_SCRIPT_DIALOG_KIND, COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD,
    COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM, COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
};
use webview2_com::{
    BasicAuthenticationRequestedEventHandler, BytesReceivedChangedEventHandler,
    ClientCertificateRequestedEventHandler, DownloadStartingEventHandler,
    NewWindowRequestedEventHandler, PermissionRequestedEventHandler,
    ScriptDialogOpeningEventHandler, StateChangedEventHandler,
};
use windows_core::{Interface as _, HSTRING, PWSTR};

use super::cdp;
use super::verbs::{Dialog, DialogKind, Download, DownloadState};

/// How long a dialog is held for an answer before it is answered the safe way.
const DIALOG_PATIENCE: Duration = Duration::from_secs(30);

/// The largest file an agent's tab may download.
const MOST_DOWNLOAD: i64 = 500 * 1024 * 1024;

/// What an agent's page runs first, in its own world: the one thing about a page an
/// agent tab changes. `print()` opens the engine's print preview, a window of its own
/// with no event to refuse it by, and `showPicker()` opens a native picker; both do
/// nothing here. Every frame, from the first line of every document.
const STUBS: &str = r"(() => {
  const nothing = () => undefined
  try { Object.defineProperty(window, 'print', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  for (const kind of [window.HTMLInputElement, window.HTMLSelectElement]) {
    try { if (kind && kind.prototype.showPicker) Object.defineProperty(kind.prototype, 'showPicker', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  }
})()";

/// A dialog held open, as the agent is told about it.
struct Held {
    dialog: Dialog,
    since: Instant,
}

/// The dialogs each page is holding, by label.
static DIALOGS: Mutex<Option<HashMap<String, Held>>> = Mutex::new(None);

/// Every agent's downloads, oldest first, with the agent they belong to.
static DOWNLOADS: Mutex<Vec<(String, Download)>> = Mutex::new(Vec::new());

/// A dialog's engine objects, which live on the window's thread.
struct Waiting {
    args: ICoreWebView2ScriptDialogOpeningEventArgs,
    deferral: ICoreWebView2Deferral,
    number: u64,
}

/// A window the page asked for, waiting for its agent tab to be built.
struct Asked {
    args: ICoreWebView2NewWindowRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

thread_local! {
    /// The dialogs' engine objects, by label, on the window's thread.
    static WAITING: RefCell<HashMap<String, Waiting>> = RefCell::new(HashMap::new());
    /// The windows pages asked for, by the agent tab being built for each.
    static POPUPS: RefCell<HashMap<String, Asked>> = RefCell::new(HashMap::new());
}

/// Counts dialogs, so a timeout answers the dialog it was set for and no later one.
static NUMBER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Who a page belongs to, for what the handlers below decide: the agent and the tab.
#[derive(Clone)]
pub struct Owner {
    /// The agent's id.
    pub agent: String,
    /// The agent tab's id.
    pub tab: String,
    /// The page's label.
    pub label: String,
}

/// Quietens an agent's page before it loads anything: the engine's furniture off, and
/// every event that would reach the reader answered here. On the window's thread.
#[allow(
    unsafe_code,
    reason = "the page's settings and events are WebView2's own, reached through its COM interfaces"
)]
pub fn quieten(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    // Safe: on the window's thread, where the engine's objects live; every handler below
    // is held by the engine for as long as the webview is.
    unsafe {
        if let Ok(settings) = core.Settings() {
            let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            let _ = settings.SetAreDevToolsEnabled(false);
            if let Ok(three) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = three.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(four) = settings.cast::<ICoreWebView2Settings4>() {
                let _ = four.SetIsGeneralAutofillEnabled(false);
                let _ = four.SetIsPasswordAutosaveEnabled(false);
            }
            if let Ok(five) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = five.SetIsPinchZoomEnabled(false);
            }
            if let Ok(six) = settings.cast::<ICoreWebView2Settings6>() {
                let _ = six.SetIsSwipeNavigationEnabled(false);
            }
        }
        if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
            let _ = eight.SetIsMuted(true);
        }
    }

    dialogs(app, core, owner);
    windows(app, core, owner);
    permissions(core, owner);
    downloads(app, core, owner);
    sign_ins(core, owner);

    // The file chooser intercepted and the two stubs in place, before the first
    // document: the page domain on first, since a script registered with it off is kept
    // and never run.
    cdp::post(core, "Page.enable", &json!({}));
    cdp::post(
        core,
        "Page.setInterceptFileChooserDialog",
        &json!({ "enabled": true }),
    );
    cdp::post(
        core,
        "Page.addScriptToEvaluateOnNewDocument",
        &json!({ "source": STUBS, "runImmediately": true }),
    );
}

/// Dialogs, held for the agent.
#[allow(
    unsafe_code,
    reason = "a dialog is one of WebView2's own events, reached through its COM interfaces"
)]
fn dialogs(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let app = app.clone();
    let label = owner.label.clone();
    let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // A page shown to the reader since (6.7) has the engine's own dialogs back.
        if super::tabs::owner(&label).is_none() {
            return Ok(());
        }
        // Safe: the event's own arguments, on the window's thread.
        let (kind, message, default_text, url) = unsafe {
            let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
            args.Kind(&raw mut kind)?;
            (
                kind,
                text(|out| args.Message(out)),
                text(|out| args.DefaultText(out)),
                text(|out| args.Uri(out)),
            )
        };
        let kind = match kind {
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => DialogKind::Confirm,
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => DialogKind::Prompt,
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => DialogKind::Beforeunload,
            _ => DialogKind::Alert,
        };
        // Safe: as above.
        let deferral = unsafe { args.GetDeferral()? };
        let number = NUMBER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        WAITING.with_borrow_mut(|held| {
            held.insert(
                label.clone(),
                Waiting {
                    args: args.clone(),
                    deferral,
                    number,
                },
            );
        });
        let dialog = Dialog {
            kind,
            message: cdp::cut(message, 4_000),
            default_text: (kind == DialogKind::Prompt).then_some(default_text),
            url,
            open_ms: 0,
        };
        DIALOGS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashMap::new)
            .insert(
                label.clone(),
                Held {
                    dialog,
                    since: Instant::now(),
                },
            );

        // Answered the safe way if nobody answers: an alert read, anything else no.
        let late = app.clone();
        let named = label.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DIALOG_PATIENCE);
            let answering = late.clone();
            let _ = late.run_on_main_thread(move || {
                let _ = answering;
                settle(&named, Some(number), kind == DialogKind::Alert, None);
            });
        });
        Ok(())
    }));
    let mut token = 0i64;
    // Safe: as above.
    let _ = unsafe { core.add_ScriptDialogOpening(&handler, &raw mut token) };
}

/// A string the engine hands out through an out pointer, taken and freed.
#[allow(
    unsafe_code,
    reason = "a string the engine allocated is read and freed through COM"
)]
fn text(read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
    let mut out = PWSTR::null();
    if read(&raw mut out).is_err() {
        return String::new();
    }
    webview2_com::take_pwstr(out)
}

/// The dialog a page is holding, if any, with how long it has been open.
pub fn dialog_of(label: &str) -> Option<Dialog> {
    DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(label)
        .map(|held| Dialog {
            open_ms: u64::try_from(held.since.elapsed().as_millis()).unwrap_or(u64::MAX),
            ..held.dialog.clone()
        })
}

/// Answers the dialog a page is holding: OK or Cancel, and a prompt's words. From any
/// thread; the answer is given on the window's.
pub fn answer_dialog(
    app: &AppHandle,
    label: &str,
    accept: bool,
    text: Option<String>,
) -> Result<(), String> {
    if dialog_of(label).is_none() {
        return Err("the page is holding no dialog".into());
    }
    let named = label.to_string();
    app.run_on_main_thread(move || settle(&named, None, accept, text))
        .map_err(|error| error.to_string())
}

/// Gives the engine its answer to a held dialog, on the window's thread: the one with
/// `number` when named, whichever is held otherwise.
#[allow(
    unsafe_code,
    reason = "a dialog's answer is given through WebView2's COM interfaces"
)]
fn settle(label: &str, number: Option<u64>, accept: bool, text: Option<String>) {
    let Some(waiting) = WAITING.with_borrow_mut(|held| {
        let fits = held
            .get(label)
            .is_some_and(|one| number.is_none_or(|number| one.number == number));
        if fits {
            held.remove(label)
        } else {
            None
        }
    }) else {
        return;
    };
    if let Some(all) = DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
    // Safe: the engine's own objects, on the thread they were made on.
    unsafe {
        if let Some(text) = text {
            let _ = waiting.args.SetResultText(&HSTRING::from(text));
        }
        if accept {
            let _ = waiting.args.Accept();
        }
        let _ = waiting.deferral.Complete();
    }
}

/// Windows the page asks for: another agent tab of the same agent, built out of sight
/// and handed to the engine as the new window, so `window.opener` is kept and a sign-in
/// popup can post its answer back.
#[allow(
    unsafe_code,
    reason = "a new window is one of WebView2's own events, reached through its COM interfaces"
)]
fn windows(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let app = app.clone();
    let label = owner.label.clone();
    let handler = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // Safe: the event's own arguments, on the window's thread.
        let url = unsafe { text(|out| args.Uri(out)) };
        let Some(owner) = super::tabs::owner(&label) else {
            // A page the reader was shown asks for windows the way a reader's tab does.
            crate::web_tabs::opened_from_adopted(&app, &label, &url);
            return Ok(());
        };
        // Safe: as above.
        unsafe { args.SetHandled(true)? };
        if let Err(why) = super::tabs::may_open(&owner, &url) {
            say(
                &label,
                "warning",
                format!("nib refused a window to {url}: {why}"),
            );
            return Ok(());
        }
        // Safe: as above.
        let deferral = unsafe { args.GetDeferral()? };
        let Some(tab) = super::tabs::reserve_popup(&owner, &url) else {
            // Safe: as above.
            let _ = unsafe { deferral.Complete() };
            return Ok(());
        };
        POPUPS.with_borrow_mut(|held| {
            held.insert(
                tab.clone(),
                Asked {
                    args: args.clone(),
                    deferral,
                },
            );
        });
        // Built in the event loop's own turn: building a webview inside the engine's
        // handler waits for the engine, which is waiting for this handler.
        let building = app.clone();
        let _ = app.run_on_main_thread(move || super::tabs::build_popup(&building, &tab));
        Ok(())
    }));
    let mut token = 0i64;
    // Safe: as above.
    let _ = unsafe { core.add_NewWindowRequested(&handler, &raw mut token) };
}

/// Hands the page that asked for a window the agent tab built for it; or, when none
/// could be built, nothing, which the page reads as `window.open` answering `null`.
#[allow(
    unsafe_code,
    reason = "the new window is handed over through WebView2's COM interfaces"
)]
pub fn hand_over(tab: &str, made: Option<&ICoreWebView2>) {
    let Some(asked) = POPUPS.with_borrow_mut(|held| held.remove(tab)) else {
        return;
    };
    // Safe: the engine's own objects, on the thread they were made on.
    unsafe {
        if let Some(core) = made {
            let _ = asked.args.SetNewWindow(core);
        }
        let _ = asked.deferral.Complete();
    }
}

/// Every permission a page asks for, refused and said.
#[allow(
    unsafe_code,
    reason = "a permission request is one of WebView2's own events, reached through its COM interfaces"
)]
fn permissions(core: &ICoreWebView2, owner: &Owner) {
    let label = owner.label.clone();
    let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // Safe: the event's own arguments, on the window's thread.
        unsafe {
            let mut kind = webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND::default();
            let _ = args.PermissionKind(&raw mut kind);
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            say(
                &label,
                "warning",
                format!("nib refused the page {}", permission_named(kind.0)),
            );
        }
        Ok(())
    }));
    let mut token = 0i64;
    // Safe: as above.
    let _ = unsafe { core.add_PermissionRequested(&handler, &raw mut token) };
}

/// What a permission is called, from `WebView2`'s numbering of them.
fn permission_named(kind: i32) -> &'static str {
    match kind {
        1 => "the microphone",
        2 => "the camera",
        3 => "where it is",
        4 => "notifications",
        5 => "the sensors",
        6 => "reading the clipboard",
        7 => "several downloads at once",
        8 => "files on the machine",
        9 => "playing sound by itself",
        10 => "the machine's fonts",
        11 => "MIDI devices",
        12 => "placing windows",
        _ => "a permission",
    }
}

/// Downloads, into the agent's own folder, never past 500 MB, and never with the
/// engine's own flyout.
#[allow(
    unsafe_code,
    reason = "a download is one of WebView2's own events, reached through its COM interfaces"
)]
fn downloads(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let Ok(four) = core.cast::<ICoreWebView2_4>() else {
        return;
    };
    let owner = owner.clone();
    let app = app.clone();
    let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // Safe: the event's own arguments, on the window's thread.
        unsafe {
            args.SetHandled(true)?;
            let operation = args.DownloadOperation()?;
            let url = text(|out| operation.Uri(out));
            let suggested = text(|out| args.ResultFilePath(out));
            let mut total = 0i64;
            let _ = operation.TotalBytesToReceive(&raw mut total);
            let Some(path) = destination(&app, &owner.agent, &suggested) else {
                args.SetCancel(true)?;
                return Ok(());
            };
            let record = Download {
                tab: owner.tab.clone(),
                url,
                path: path.to_string_lossy().into_owned(),
                state: DownloadState::Going,
            };
            if total > MOST_DOWNLOAD {
                args.SetCancel(true)?;
                noted(
                    &owner.agent,
                    Download {
                        state: DownloadState::TooLarge,
                        ..record
                    },
                );
                return Ok(());
            }
            args.SetResultFilePath(&HSTRING::from(path.as_os_str()))?;
            noted(&owner.agent, record.clone());
            watch_download(&operation, &owner.agent, &record.path);
        }
        Ok(())
    }));
    let mut token = 0i64;
    // Safe: as above.
    let _ = unsafe { four.add_DownloadStarting(&handler, &raw mut token) };
}

/// Follows one download to its end, and stops it past the ceiling.
#[allow(
    unsafe_code,
    reason = "a download's progress is WebView2's own, reached through its COM interfaces"
)]
fn watch_download(operation: &ICoreWebView2DownloadOperation, agent: &str, path: &str) {
    let (agent, path) = (agent.to_string(), path.to_string());
    let growing = BytesReceivedChangedEventHandler::create(Box::new({
        let (agent, path) = (agent.clone(), path.clone());
        move |operation, _| {
            let Some(operation) = operation else {
                return Ok(());
            };
            let mut received = 0i64;
            // Safe: the operation's own properties, on the window's thread.
            unsafe {
                let _ = operation.BytesReceived(&raw mut received);
                if received > MOST_DOWNLOAD {
                    let _ = operation.Cancel();
                    moved(&agent, &path, DownloadState::TooLarge);
                }
            }
            Ok(())
        }
    }));
    let ended = StateChangedEventHandler::create(Box::new(move |operation, _| {
        let Some(operation) = operation else {
            return Ok(());
        };
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
        // Safe: as above.
        unsafe {
            let _ = operation.State(&raw mut state);
        }
        if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
            return Ok(());
        }
        let done = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
            DownloadState::Done
        } else {
            DownloadState::Failed
        };
        moved(&agent, &path, done);
        Ok(())
    }));
    let mut token = 0i64;
    // Safe: the engine holds both handlers for as long as the download lives.
    unsafe {
        let _ = operation.add_BytesReceivedChanged(&growing, &raw mut token);
        let _ = operation.add_StateChanged(&ended, &raw mut token);
    }
}

/// Where an agent's download goes: `Downloads/nib agents/<agent>/<name>`, never over
/// a file that is there. `None` when there is no downloads folder to be had.
fn destination(app: &AppHandle, agent: &str, suggested: &str) -> Option<PathBuf> {
    let name = std::path::Path::new(suggested)
        .file_name()
        .map_or_else(|| std::ffi::OsString::from("download"), ToOwned::to_owned);
    let folder = crate::downloads::folder(app)
        .ok()?
        .join("nib agents")
        .join(agent);
    crate::paths::made(&folder).ok()?;
    let name = crate::downloads::clean_name(&name);
    let taken: Vec<String> = DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(_, one)| one.state == DownloadState::Going)
        .map(|(_, one)| one.path.clone())
        .collect();
    Some(crate::downloads::free_path(&folder, &name, |path| {
        path.exists() || taken.iter().any(|one| std::path::Path::new(one) == path)
    }))
}

fn noted(agent: &str, download: Download) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    all.push((agent.to_string(), download));
    // The last few hundred are plenty to answer "what did I download".
    if all.len() > 500 {
        all.remove(0);
    }
}

fn moved(agent: &str, path: &str, state: DownloadState) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((_, one)) = all
        .iter_mut()
        .rev()
        .find(|(owner, one)| owner == agent && one.path == path)
    {
        if one.state == DownloadState::Going {
            one.state = state;
        }
    }
}

/// An agent's downloads, of one tab when named, oldest first.
pub fn downloads_of(agent: &str, tab: Option<&str>) -> Vec<Download> {
    DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(owner, one)| owner == agent && tab.is_none_or(|tab| one.tab == tab))
        .map(|(_, one)| one.clone())
        .collect()
}

/// Basic authentication and client certificates, refused: a password is the reader's
/// to type, in a takeover (9.4).
#[allow(
    unsafe_code,
    reason = "sign-in requests are WebView2's own events, reached through its COM interfaces"
)]
fn sign_ins(core: &ICoreWebView2, owner: &Owner) {
    if let Ok(ten) = core.cast::<ICoreWebView2_10>() {
        let label = owner.label.clone();
        let handler = BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                // Safe: the event's own arguments, on the window's thread.
                unsafe { args.SetCancel(true)? };
                say(
                    &label,
                    "warning",
                    "nib refused the site's sign-in box: ask the reader with browser_takeover"
                        .into(),
                );
            }
            Ok(())
        }));
        let mut token = 0i64;
        // Safe: as above.
        let _ = unsafe { ten.add_BasicAuthenticationRequested(&handler, &raw mut token) };
    }
    if let Ok(five) = core.cast::<ICoreWebView2_5>() {
        let label = owner.label.clone();
        let handler = ClientCertificateRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                // Safe: as above.
                unsafe { args.SetCancel(true)? };
                say(
                    &label,
                    "warning",
                    "nib refused the site's request for a client certificate".into(),
                );
            }
            Ok(())
        }));
        let mut token = 0i64;
        // Safe: as above.
        let _ = unsafe { five.add_ClientCertificateRequested(&handler, &raw mut token) };
    }
}

/// A line of nib's own in the page's console, which is where the agent reads what the
/// page tried.
fn say(label: &str, level: &str, text: String) {
    cdp::heard(label)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .say(level, text);
}

/// Forgets a page's held dialog, for a page that closed.
pub fn forget(app: &AppHandle, label: &str) {
    if let Some(all) = DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
    let named = label.to_string();
    let _ = app.run_on_main_thread(move || {
        WAITING.with_borrow_mut(|held| held.remove(&named));
    });
}

#[cfg(test)]
mod tests {
    use super::STUBS;

    #[test]
    fn the_stubs_touch_nothing_but_print_and_the_pickers() {
        assert!(STUBS.contains("'print'"));
        assert!(STUBS.contains("'showPicker'"));
        assert!(!STUBS.contains("alert"));
    }
}
