//! A website in a tab: one child webview per web tab, placed over the pane that
//! shows it.
//!
//! Tauri can put a second webview inside a window and give it bounds of its own,
//! so a page sits exactly where the pane is and nothing else about the window
//! changes. That is the only embedding on a desktop that renders a site the way a
//! browser does: a frame cannot, because a great deal of the web refuses to be
//! framed. The engine is the system's - `WebView2` on Windows, which is Chromium,
//! and `WKWebView` on macOS, which is `WebKit` and not Chromium however the tab is
//! asked for. See docs/web-tabs.md.
//!
//! What the window may do with one of these is deliberately small: make it, move
//! it, show it, hide it, send it to an address, step its history, read the page
//! for a clip, and close it. The window says where the pane is; nothing here
//! knows what a pane is.
//!
//! **What a page in a window costs the rest of the crate.** Tauri's
//! `get_webview_window` only answers for a window whose webviews are all itself -
//! `Window::is_webview_window` is that test - so from the moment a web tab puts a
//! second webview in the window, `get_webview_window("main")` answers nothing at
//! all. Anything that asked that way stopped working while a website was open: the
//! command line said the app had no window, a `nib://` link never raised it, and a
//! second launch handed its file over to a window that was never brought forward.
//! So nothing in this crate asks for the window that way. `get_window` is the call,
//! because a window is what all of them wanted; `get_webview` is for a webview by
//! label, which is how this module finds a page.
//!
//! The site gets nothing of the app. It is granted no command, because the
//! capabilities name the app's own webviews rather than the windows they sit in
//! and because a remote origin matches no capability here (see
//! capabilities/default.json); and the globals that reach the app are taken away
//! before the page's first script runs, along with the devices nobody asked to
//! hand over. See `GUARD`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewBuilder,
    WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

/// What a web tab's webview is labelled: this in front of the tab's own id, so a
/// label says which tab it belongs to and nothing else in the window can be
/// mistaken for one.
const LABEL: &str = "web-";

/// The event the window hears whenever a page moves: which tab, where it is, what
/// it calls itself, and whether there is anywhere to step.
const MOVED: &str = "nib://web-tab";

/// The largest page a clip reads, in characters. A note the account would refuse
/// is worse than a clip that stops early, and 4 MB is what the API takes; see
/// `MAX_NOTE_BYTES` in the clipper.
const LONGEST_PAGE: usize = 4_000_000;

/// What a site in a web tab does not get, taken away before its own first script
/// runs.
///
/// Two kinds of thing. The app's own globals, so nothing in the page can speak to
/// the crate even by accident: the capabilities already refuse it, and this is the
/// lock that does not depend on a list of labels being right. And the devices a
/// page can ask a browser for, which a note-taking app has no business granting
/// silently: the camera and the microphone, the clipboard, where you are, and the
/// buses a page can reach hardware over. Taking the API away rather than answering
/// a prompt with no is what keeps the engine from putting a prompt on screen at
/// all.
///
/// `__HIDDEN__` is filled in by `guard` with whatever this origin has not been
/// granted, which is everything until somebody says otherwise.
const GUARD: &str = r"(function () {
  try {
    delete window.__TAURI_INTERNALS__
    delete window.__TAURI__
    delete window.__TAURI_EVENT_PLUGIN_INTERNALS__
    if (window.chrome) delete window.chrome.webview
  } catch (error) {
    // A page that has frozen its own globals keeps them. The capabilities are
    // what actually refuse the call; this is the second lock, not the first.
  }

  function hide(on, name) {
    try {
      Object.defineProperty(on, name, { configurable: true, get: () => undefined })
    } catch (error) {
      // A property that will not be redefined is one the engine still prompts
      // for, and the prompt is answered by nobody pressing allow.
    }
  }

  for (const name of __HIDDEN__) hide(Navigator.prototype, name)
  hide(window, 'Notification')
})()";

/// Puts a revived page back where the reading was.
///
/// It runs before the page's own first script, like the guard, and does its work when
/// the document is ready: a scroll offset set before there is a document to scroll is
/// an offset set on nothing. Three times, because a page that lays itself out in
/// stages - a font, a picture without a size, a script that writes the body - is
/// shorter than its final self when the document is first ready, and a browser
/// restoring a tab does exactly the same thing.
///
/// Only for the page it was left on: `__PLACE__` carries the address, and a tab that
/// followed a link on the way in is a tab whose place is not this page's. And only in
/// the page itself, never in a frame inside it - `window.top` is the test - because a
/// frame that scrolled itself to the page's offset would be a frame scrolled somewhere
/// nobody asked for.
const PLACE: &str = r"(function () {
  var want = __PLACE__
  if (!want || window.top !== window) return

  function put() {
    try {
      if (location.href !== want.url) return
      window.scrollTo(want.x, want.y)
    } catch (error) {
      // A page that will not be scrolled is a page that opens at the top.
    }
  }

  if (document.readyState !== 'loading') put()
  else document.addEventListener('DOMContentLoaded', put, { once: true })
  window.addEventListener('load', function () {
    put()
    setTimeout(put, 400)
  }, { once: true })
})()";

/// Where the page is now: the address, and how far down it the reading has got.
///
/// Read out of the page rather than kept as it scrolls, because a page scrolling is
/// the one thing about a web tab the app cannot see - the wheel goes to the webview
/// and nothing of ours hears it - and asking once, when the tab is left, is the whole
/// of what is needed to open it again where it was.
const LOOKED: &str = r"(function () {
  try {
    return JSON.stringify({
      url: location.href,
      x: window.scrollX || 0,
      y: window.scrollY || 0,
    })
  } catch (error) {
    return JSON.stringify({ url: '', x: 0, y: 0 })
  }
})()";

/// The site's own mark, as an address.
///
/// What the page says its icon is, and `/favicon.ico` where it says nothing - which is
/// the same order a browser looks in, and the reason a tab has the site's mark on it
/// rather than a generic one. Asked of the page rather than of the engine: `WebView2`
/// has an event for it, `WKWebView` has nothing at all, and the page's own `<link>` is
/// what both of them read.
const ICON: &str = r"(function () {
  try {
    var links = document.querySelectorAll('link[rel]')
    for (var index = links.length - 1; index >= 0; index--) {
      var rel = (links[index].getAttribute('rel') || '').toLowerCase()
      if (rel.split(/\s+/).indexOf('icon') >= 0 && links[index].href) return links[index].href
    }
    return new URL('/favicon.ico', location.href).href
  } catch (error) {
    return ''
  }
})()";

/// The page, read for a clip, in the site's own document.
///
/// It reads what is on screen rather than what the server sent: a page that writes
/// itself with a script has already written itself. Every address comes back
/// resolved, because the note this becomes is read from a folder and not from the
/// site.
///
/// `__SELECTION__` takes what somebody has selected. Without one it takes the
/// article: the element a page says holds its writing, or the longest candidate,
/// and otherwise the body with the furniture cut out of it. Turning the HTML into
/// markdown is the window's, through the same converter the clipper uses; see
/// `lib/web-tab/clip.ts`.
const READER: &str = r"(function () {
  const OUT =
    'nav,header,footer,aside,form,dialog,button,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true]'
  const PICKS = ['article', 'main', '[role=main]', '#content', '.post', '.entry-content']
  const ENOUGH = 200

  function absolute(root) {
    for (const one of root.querySelectorAll('[href]')) {
      try {
        one.setAttribute('href', one.href)
      } catch (error) {
        one.removeAttribute('href')
      }
    }
    for (const one of root.querySelectorAll('[src]')) {
      try {
        one.setAttribute('src', one.src)
      } catch (error) {
        one.removeAttribute('src')
      }
    }
    return root
  }

  function selected() {
    const range = window.getSelection()
    if (!range || range.isCollapsed || range.rangeCount === 0) return null

    const held = document.createElement('div')
    for (let index = 0; index < range.rangeCount; index += 1) {
      held.append(range.getRangeAt(index).cloneContents())
    }
    return (held.textContent || '').trim() ? held : null
  }

  function article() {
    let best = null
    for (const pick of PICKS) {
      for (const found of document.querySelectorAll(pick)) {
        const length = (found.textContent || '').trim().length
        if (!best || length > best.length) best = { node: found, length: length }
      }
    }

    if (best && best.length > ENOUGH) return best.node.cloneNode(true)

    const whole = document.body.cloneNode(true)
    for (const furniture of whole.querySelectorAll(OUT)) furniture.remove()
    return whole
  }

  const title = (document.title || '').trim()

  try {
    const part = (__SELECTION__ ? selected() : null) || article()
    const page = absolute(part)

    return { url: location.href, title: title, html: (page.innerHTML || '').slice(0, __LONGEST__) }
  } catch (error) {
    return { url: location.href, title: title, html: '' }
  }
})()";

/// Where a page has been in one tab, and where along it the tab is.
///
/// Kept here rather than asked of the engine, because neither `WebView2` nor
/// `WKWebView` tells Tauri whether a page can go back, and a back arrow that is
/// always lit is an arrow that lies half the time.
///
/// It outlives the webview. A parked tab keeps its trail, so the arrows over a page
/// that has just been revived are right from the first frame rather than dead until
/// somebody follows a link - and stepping one of them walks the trail rather than the
/// engine's own history, which a revived webview has none of. See `engine`.
#[derive(Default)]
struct Trail {
    urls: Vec<String>,
    at: usize,
    /// Whether the engine's own history is this trail.
    ///
    /// True for a webview that has only been sent where the page and the address bar
    /// sent it: `history.back()` is then the right call, and the engine takes the
    /// place on the page and the half-filled form back with it. False from the moment
    /// this crate navigates a step itself - which is how a revived page steps, its
    /// engine holding no history at all - because a `history.back()` after one of
    /// those goes the wrong way: the step put a *new* entry on the engine's stack.
    engine: bool,
}

impl Trail {
    /// The trail a parked tab was parked with, restored under a webview that has just
    /// been built. Its own history is empty, so every step from here is a navigation.
    fn restored(urls: Vec<String>, at: usize) -> Self {
        let at = at.min(urls.len().saturating_sub(1));
        Self {
            engine: urls.len() < 2,
            urls,
            at,
        }
    }

    /// The address one step back or forward, for a tab whose engine cannot step
    /// itself.
    fn step_to(&self, forward: bool) -> Option<&String> {
        if forward {
            self.urls.get(self.at + 1)
        } else {
            self.at.checked_sub(1).and_then(|back| self.urls.get(back))
        }
    }
    /// A page that has arrived. A step back or forward lands on the address next
    /// to where the trail is, and anything else is somewhere new, which forgets
    /// whatever was ahead.
    fn visited(&mut self, url: &str) {
        if self.urls.get(self.at).is_some_and(|here| here == url) {
            return;
        }

        if self.at > 0 && self.urls.get(self.at - 1).is_some_and(|back| back == url) {
            self.at -= 1;
            return;
        }

        if self.urls.get(self.at + 1).is_some_and(|on| on == url) {
            self.at += 1;
            return;
        }

        if !self.urls.is_empty() {
            self.urls.truncate(self.at + 1);
            self.at = self.urls.len();
        }

        self.urls.push(url.to_string());
    }

    fn back(&self) -> bool {
        self.at > 0
    }

    fn forward(&self) -> bool {
        self.at + 1 < self.urls.len()
    }
}

/// Every web tab this app has open: where each of them has been, and which of them
/// is in the middle of being given a page.
#[derive(Default)]
pub struct WebTabs {
    trails: Mutex<HashMap<String, Trail>>,
    /// The tabs whose webview is being built at this moment.
    ///
    /// A page is no longer built on the thread the request arrived on, so two
    /// placements a frame apart are two calls in the air at once - and the label
    /// both of them would build a webview under is the same label. The first to
    /// arrive takes the tab; the second is told the tab is busy, which is what it
    /// would have been told a moment later anyway.
    opening: Mutex<HashSet<String>>,
}

impl WebTabs {
    /// Takes a tab for one build, or says that somebody already has it.
    fn claim(&self, tab: &str) -> bool {
        self.opening
            .lock()
            .is_ok_and(|mut busy| busy.insert(tab.to_string()))
    }

    /// Gives it back, whether the page arrived or not.
    fn built(&self, tab: &str) {
        if let Ok(mut busy) = self.opening.lock() {
            busy.remove(tab);
        }
    }

    /// A page a tab has arrived on, on the trail kept for that tab.
    fn walked(&self, tab: &str, url: &str) {
        if let Ok(mut trails) = self.trails.lock() {
            trails.entry(tab.to_string()).or_default().visited(url);
        }
    }

    /// The trail a tab was parked with, put back under the webview that has just been
    /// built for it. An empty one is no trail at all, which is a tab being opened for
    /// the first time.
    fn restore(&self, tab: &str, urls: Vec<String>, at: usize) {
        if urls.is_empty() {
            return;
        }

        if let Ok(mut trails) = self.trails.lock() {
            trails.insert(tab.to_string(), Trail::restored(urls, at));
        }
    }

    /// Where this tab has been and where along it it is, for the window to write down
    /// against the note.
    fn walk(&self, tab: &str) -> (Vec<String>, usize) {
        self.trails
            .lock()
            .ok()
            .and_then(|trails| trails.get(tab).map(|one| (one.urls.clone(), one.at)))
            .unwrap_or_default()
    }

    /// Where a step goes: the address to send the tab to, or `None` for a tab whose
    /// own engine can take the step. Stepping by address is what a revived page does,
    /// and from the first one this tab does it for good; see `Trail::engine`.
    fn stepping(&self, tab: &str, forward: bool) -> Option<String> {
        let mut trails = self.trails.lock().ok()?;
        let trail = trails.get_mut(tab)?;
        if trail.engine {
            return None;
        }

        trail.step_to(forward).cloned()
    }
}

/// Where the pane is, in the window's own coordinates, as the window measured it.
#[derive(Deserialize)]
pub struct Pane {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the window is told when a page moves.
///
/// A field that says nothing is a field the window leaves as it was: the title and the
/// mark arrive later than the address and on their own, and an empty one here is "no
/// news" rather than "gone".
#[derive(Clone, Serialize)]
struct Moved {
    tab: String,
    url: String,
    title: String,
    icon: String,
    back: bool,
    forward: bool,
    loading: bool,
}

/// Where a page was left, and where it is put back.
#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Place {
    x: f64,
    y: f64,
}

/// What a tab that has been parked - or closed and opened again tomorrow - is handed
/// back when its page is built: the place the reading was at, and the trail behind it.
///
/// One argument rather than three, because they are one thing: everything about where
/// this tab had got to before the webview under it went away.
#[derive(Deserialize)]
pub struct Revived {
    /// Where the reading was on the page, or `None` for a page being opened rather
    /// than revived.
    place: Option<Place>,
    /// Where the tab had been, oldest first.
    trail: Vec<String>,
    /// Where along that it was.
    at: usize,
}

/// What the page says about where it is, read by `LOOKED`.
#[derive(Deserialize)]
struct Looked {
    url: String,
    x: f64,
    y: f64,
}

/// Where a tab is, for the window to write down against the note: the page, the place
/// on it, and the trail behind it.
#[derive(Serialize)]
pub struct Look {
    url: String,
    x: f64,
    y: f64,
    trail: Vec<String>,
    at: usize,
}

/// A page as a clip reads it: where it is, what it calls itself, and the HTML of
/// the part worth keeping.
#[derive(Clone, Serialize, Deserialize)]
pub struct Clipped {
    url: String,
    title: String,
    html: String,
}

/// Which way a step goes.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Back,
    Forward,
    Reload,
}

/// Whether an address is one a web tab may go to.
///
/// Only the web, and never the app: `file:` would read this machine, a scheme the
/// system knows would hand the page to another application, and the app's own
/// origins would put nib inside the tab with the site's script beside it. What
/// somebody typed is turned into an address by the window (see
/// `lib/web-tab/address.ts`); this is the rule that cannot be talked round,
/// because it is also what every link inside the page is judged by.
fn allowed(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    !matches!(
        host.as_str(),
        "tauri.localhost" | "ipc.localhost" | "asset.localhost" | "nib.localhost"
    )
}

/// What the system is asked to open for a window the page asked for, or `None`
/// for a window it does not get.
///
/// The same rule the tab itself is held to, because the request is the page's
/// either way: `window.open` is a scheme of the page's choosing, and the system
/// opens whatever is registered for one. So `nib://` would be a site driving this
/// app through its own links, `smb://` would be a site asking this machine to
/// authenticate somewhere, and a scheme another program registered is a site
/// starting that program - none of which the tab may do by navigating, and none
/// of which it may do by asking for a window either. A page is handed over and
/// everything else is dropped, which is what the engine would have done with it
/// had nothing here been listening.
fn handed_over(url: &Url) -> Option<String> {
    allowed(url).then(|| url.to_string())
}

/// The address, read and judged, or a reason it is not one.
fn address(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|error| format!("that is not an address: {error}"))?;
    if allowed(&parsed) {
        Ok(parsed)
    } else {
        Err("a web tab only opens http and https pages".into())
    }
}

/// The guard script for one origin: `GUARD` with the list of what it may not have.
///
/// A grant is spent by leaving that one alone. The hardware buses are never in the
/// list of grants, so they are never left alone; a note-taking app has no reason to
/// let a page talk to a USB device.
fn guard(granted: &[String]) -> String {
    let asked = ["camera", "clipboard", "location"];
    let named = ["mediaDevices", "clipboard", "geolocation"];

    let mut hidden: Vec<&str> = Vec::new();
    for (want, api) in asked.iter().zip(named) {
        if !granted.iter().any(|one| one == want) {
            hidden.push(api);
        }
    }
    hidden.extend(["bluetooth", "usb", "serial", "hid", "credentials"]);

    let list = hidden
        .iter()
        .map(|one| format!("'{one}'"))
        .collect::<Vec<_>>()
        .join(", ");

    GUARD.replace("__HIDDEN__", &format!("[{list}]"))
}

/// The reader script, told whether it is after a selection.
fn reader(selection: bool) -> String {
    READER
        .replace("__SELECTION__", if selection { "true" } else { "false" })
        .replace("__LONGEST__", &LONGEST_PAGE.to_string())
}

/// The script a webview is built with: the guard, and - for a tab being revived - the
/// place the reading was left at.
///
/// One string, because a builder is handed one script and two calls to it on one
/// builder is a thing this crate should not have to be sure about.
fn opening(granted: &[String], place: Option<Place>, url: &str) -> String {
    let want = place.and_then(|one| {
        serde_json::to_string(&serde_json::json!({ "url": url, "x": one.x, "y": one.y })).ok()
    });

    match want {
        None => guard(granted),
        Some(one) => format!("{}\n{}", guard(granted), PLACE.replace("__PLACE__", &one)),
    }
}

/// Where the site's own storage lives: the app's folder, in a directory of its own.
///
/// Not the app's webview data, which is the point. A page in a tab keeps its
/// cookies and its logins in a profile the app's own session is not in, so signing
/// into a site is not signing into anything of nib's, and clearing one never
/// touches the other. Cross-origin reading is the engine's own rule either way;
/// this is about what sits in the same store on disk.
#[cfg(any(windows, target_os = "linux"))]
fn store(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("web");
    crate::paths::made(&dir)?;
    Ok(dir)
}

/// The same sixteen bytes every time, so `WKWebView` hands back the store it handed
/// out last time. macOS 14 and later; older macOS has no such API and falls back
/// to the default store, which is the one case where a web tab and the app share a
/// profile on disk. Said out loud in docs/web-tabs.md rather than hidden here.
#[cfg(target_os = "macos")]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

/// The webview for one tab, built and attached to the window that asked.
///
/// Async, and the building itself posted to the window's own event loop. Both
/// halves are the fix for a freeze that took the whole app with it, and both are
/// needed:
///
/// A command that is not `async` runs inline inside the callback `WebView2` hands the
/// app its IPC in. Building a child webview from in there is a deadlock, not a
/// stall: the platform creates a `WebView2` controller asynchronously, wry waits for
/// it by running a nested message loop (`webview2_com::wait_with_pump`), and the
/// engine will not deliver a completion callback to a thread that is already inside
/// one of its own event handlers. So the pump spins, the handler never returns, the
/// request that started it is never answered, and the window's thread is gone: no
/// menu opens, no key answers, nothing repaints. That is what "nib freezes and the
/// buttons do nothing" was.
///
/// `async` alone moves the command off that callback and onto the async runtime.
/// The nested wait then has to happen somewhere the engine is not inside a handler,
/// and that place is the event loop's own turn: `run_on_main_thread`, with the
/// answer coming back over a channel once the controller exists. Calling `add_child`
/// straight from this thread would post the same message without waiting, which
/// loses the one thing the window needs to know - whether there is a page to place.
#[tauri::command]
pub async fn web_open(
    webview: Webview,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    url: String,
    pane: Pane,
    granted: Vec<String>,
    revived: Revived,
) -> Result<(), String> {
    let address = address(&url)?;
    let label = format!("{LABEL}{tab}");
    let app = webview.app_handle().clone();

    if app.get_webview(&label).is_some() {
        return Err("that tab already has a page".into());
    }

    if !tabs.claim(&tab) {
        return Err("that tab is already opening a page".into());
    }

    // Where this tab had been, back under the webview being built for it: a tab being
    // revived keeps its arrows, and stepping one of them walks this rather than an
    // engine history that is empty.
    tabs.restore(&tab, revived.trail, revived.at);

    #[allow(
        unused_mut,
        reason = "the storage builders below are per platform, and one platform sets neither"
    )]
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(address))
        .initialization_script(opening(&granted, revived.place, &url))
        .on_navigation(allowed)
        // The page takes its own drops. A file dropped on a site is the site's
        // business, and the app is not in the middle of it.
        .disable_drag_drop_handler();

    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.data_directory(store(&app)?);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(STORE_ID);
    }

    let opening = app.clone();
    let builder = builder.on_new_window(move |url: Url, _features: NewWindowFeatures| {
        // A window the page asks for leaves the app the way every other link
        // does: the system browser. A second webview over the pane would be a
        // window with no way to close it.
        if let Some(address) = handed_over(&url) {
            let _ = opening.opener().open_url(address, None::<&str>);
        }
        NewWindowResponse::Deny
    });

    let moved = tab.clone();
    let sending = app.clone();
    let builder = builder.on_page_load(move |view, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        say(
            &sending,
            &view,
            &moved,
            payload.url().as_str(),
            None,
            None,
            loading,
        );

        // The page is there, so it can be asked what its own mark is. Once per page,
        // on the way in, because that is when a browser puts the site's icon on the
        // tab; the answer comes back through the engine's own script callback and is
        // said to the window the way the address is.
        if loading {
            return;
        }

        let marked = sending.clone();
        let named = moved.clone();
        let asked = view.clone();
        let _ = view.eval_with_callback(ICON, move |answer| {
            let icon = serde_json::from_str::<String>(&answer).unwrap_or_default();
            if icon.is_empty() {
                return;
            }

            let url = asked.url().map(|one| one.to_string()).unwrap_or_default();
            say(&marked, &asked, &named, &url, None, Some(icon), false);
        });
    });

    let titled = tab.clone();
    let naming = app.clone();
    let builder = builder.on_document_title_changed(move |view, title| {
        let url = view.url().map(|one| one.to_string()).unwrap_or_default();
        say(&naming, &view, &titled, &url, Some(title), None, false);
    });

    let window = webview.window();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);

    let posted = app.run_on_main_thread(move || {
        let made = window
            .add_child(
                builder,
                LogicalPosition::new(pane.x, pane.y),
                LogicalSize::new(pane.width, pane.height),
            )
            .map(|_| ())
            .map_err(|error| format!("that page could not be opened: {error}"));

        // One build, one answer: a full channel would be an answer already sent.
        let _ = sending.try_send(made);
    });

    let made = match posted {
        // The window's thread is the only one that may build a page, so a window
        // that cannot be reached is a tab with no page rather than an error worth
        // a message: the pane shows the card, which offers the site in a browser.
        Err(error) => Err(format!("that page could not be opened: {error}")),
        Ok(()) => waiting
            .recv()
            .await
            .unwrap_or_else(|| Err("that page was never built".to_string())),
    };

    tabs.built(&tab);
    made?;

    tabs.walked(&tab, &url);
    Ok(())
}

/// Says where a page is, to the window that holds it and to nothing else.
fn say(
    app: &AppHandle,
    view: &Webview,
    tab: &str,
    url: &str,
    title: Option<String>,
    icon: Option<String>,
    loading: bool,
) {
    let stepping = app.try_state::<WebTabs>().and_then(|tabs| {
        tabs.trails.lock().ok().map(|mut open| {
            let trail = open.entry(tab.to_string()).or_default();
            if !loading && !url.is_empty() {
                trail.visited(url);
            }
            (trail.back(), trail.forward())
        })
    });
    let (back, forward) = stepping.unwrap_or((false, false));

    let payload = Moved {
        tab: tab.to_string(),
        url: url.to_string(),
        title: title.unwrap_or_default(),
        icon: icon.unwrap_or_default(),
        back,
        forward,
        loading,
    };

    // To the window's own webview, by label, rather than to everything: the page
    // in the tab is one of the webviews a plain emit would reach.
    let _ = app.emit_to(view.window().label(), MOVED, payload);
}

/// Puts the page where the pane is, and shows or hides it.
///
/// One command for both, because the pane says both in the same breath: a tab that
/// is not the one on top has no bounds worth setting, and a tab that has just come
/// forward has to be placed before it is shown, or it appears for a frame where the
/// last one was.
///
/// This one and the three under it stay on the window's own thread - not `async`,
/// which is what moves a command off it - because each is a single call into the
/// engine and the engine takes them nowhere else: bounds, visibility, an address, a
/// line of script, a controller closed. None of them waits for the platform to
/// answer, so none of them runs a nested message loop, which is the one thing that
/// cannot be done from inside `WebView2`'s own callback. `web_open` is the one that
/// waits, and it is the one that had to move; see the note above it. A placement is
/// also asked for on every drag of a pane divider, where a hop onto the async
/// runtime and back would be two hops for one `SetBounds`.
#[tauri::command]
pub fn web_place(app: AppHandle, tab: String, pane: Pane, visible: bool) -> Result<(), String> {
    let view = found(&app, &tab)?;

    view.set_bounds(Rect {
        position: LogicalPosition::new(pane.x, pane.y).into(),
        size: LogicalSize::new(pane.width, pane.height).into(),
    })
    .map_err(|error| format!("that page could not be placed: {error}"))?;

    if visible { view.show() } else { view.hide() }
        .map_err(|error| format!("that page could not be shown: {error}"))
}

/// Sends a tab to an address.
#[tauri::command]
pub fn web_navigate(app: AppHandle, tab: String, url: String) -> Result<(), String> {
    let at = address(&url)?;
    found(&app, &tab)?
        .navigate(at)
        .map_err(|error| format!("that address could not be opened: {error}"))
}

/// Back, forward, or the same page again.
///
/// For a page that has been running all along the history is the page's own, so the
/// step is taken in the page: neither `WebView2` nor `WKWebView` hands Tauri a Go
/// Back, and `history.back()` is what a browser's own button calls - it also takes the
/// place on the page and the half-filled form back with it, which no navigation can.
///
/// For a page that has just been revived there is no history in the engine to step:
/// the webview is a minute old and the trail behind the tab is half an hour of
/// reading. So the step is an address off the trail this crate keeps, and from the
/// first of those this tab steps that way for good; see `Trail::engine`.
///
/// Reload goes through the engine either way, which is the one of the three it offers.
#[tauri::command]
pub fn web_step(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    step: Step,
) -> Result<(), String> {
    let view = found(&app, &tab)?;

    let walked = match step {
        Step::Reload => None,
        Step::Back => tabs.stepping(&tab, false),
        Step::Forward => tabs.stepping(&tab, true),
    };

    if let Some(url) = walked {
        let at = address(&url)?;
        return view
            .navigate(at)
            .map_err(|error| format!("that page could not be stepped: {error}"));
    }

    match step {
        Step::Reload => view.reload(),
        Step::Back => view.eval("history.back()"),
        Step::Forward => view.eval("history.forward()"),
    }
    .map_err(|error| format!("that page could not be stepped: {error}"))
}

/// Where the tab is: the page, how far down it the reading has got, and the trail
/// behind it.
///
/// Asked when a tab is left and before it is parked, and written down by the window
/// against the note rather than against this visit to it - so opening the note again
/// tomorrow lands on this page at this place. The scroll offset has to be read out of
/// the page, because a page scrolling is the one thing about a web tab the app cannot
/// see.
#[tauri::command]
pub async fn web_look(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
) -> Result<Look, String> {
    let view = found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);

    view.eval_with_callback(LOOKED, move |answer| {
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;

    let said = serde_json::from_str::<Looked>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))?;
    let (trail, at) = tabs.walk(&tab);

    Ok(Look {
        url: said.url,
        x: said.x,
        y: said.y,
        trail,
        at,
    })
}

/// Puts the page somewhere on itself. For a drive, which has no wheel to turn: see
/// scripts/web-switch-probe.py.
#[tauri::command]
pub fn web_scroll(app: AppHandle, tab: String, x: f64, y: f64) -> Result<(), String> {
    found(&app, &tab)?
        .eval(format!("window.scrollTo({x}, {y})"))
        .map_err(|error| format!("that page could not be scrolled: {error}"))
}

/// How large the page is drawn, as a browser's own zoom: 1 is a hundred per cent.
#[tauri::command]
pub fn web_zoom(app: AppHandle, tab: String, factor: f64) -> Result<(), String> {
    found(&app, &tab)?
        .set_zoom(factor)
        .map_err(|error| format!("that page could not be zoomed: {error}"))
}

/// The engine's own print dialog, for the page in the tab.
///
/// `window.print()` rather than anything of the app's: what a page prints as is the
/// engine's business, the dialog is the one the reader knows from their browser, and
/// nib's own printing is about a note.
#[tauri::command]
pub fn web_print(app: AppHandle, tab: String) -> Result<(), String> {
    found(&app, &tab)?
        .eval("window.print()")
        .map_err(|error| format!("that page could not be printed: {error}"))
}

/// The page, read for a clip.
///
/// The script runs in the site's document and the answer comes back through the
/// engine's own callback rather than through the app's IPC, which is what lets a
/// page be read without the page being given anything to call.
#[tauri::command]
pub async fn web_clip(app: AppHandle, tab: String, selection: bool) -> Result<Clipped, String> {
    let view = found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);

    view.eval_with_callback(reader(selection), move |answer| {
        // One page, one answer: a full channel is an answer already sent.
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;

    serde_json::from_str::<Clipped>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))
}

/// Takes the page away.
///
/// Two callers and two meanings, which is what `keep` says. A tab being **parked** to
/// give the memory back keeps its trail, because the tab is still open and looking at
/// it again has to put the arrows back the way they were. A tab being **closed** keeps
/// nothing: nobody is coming back to it.
#[tauri::command]
pub fn web_close(app: AppHandle, tabs: tauri::State<'_, WebTabs>, tab: String, keep: bool) {
    if let Some(view) = app.get_webview(&format!("{LABEL}{tab}")) {
        let _ = view.close();
    }

    if let Ok(mut open) = tabs.trails.lock() {
        if keep {
            // The engine's history goes with the webview, so the trail that is left is
            // one every step has to walk by address.
            if let Some(trail) = open.get_mut(&tab) {
                trail.engine = false;
            }
        } else {
            open.remove(&tab);
        }
    }
}

/// A still picture of the page as it is now, as a `data:` address the window can put
/// in the pane.
///
/// The whole of why this exists: a native webview draws above every pixel of HTML in
/// the window, so anything the app opens over a page means hiding the page - and a pane
/// that went blank under every menu was the worst thing about a web tab. The window
/// asks for this first, paints it in the hole, and then hides the webview, so what is
/// behind the menu is the page.
///
/// `WebView2` has `CapturePreview`, which is the engine photographing itself and is
/// the only way to get at those pixels: the app's own webview cannot draw the page and
/// nothing outside the process may copy the screen. Elsewhere there is nothing to call
/// - `WKWebView`'s `takeSnapshot` is not reachable through what wry hands out - and the
/// answer is `None`, which the window reads as "keep your own ground". Said in
/// docs/web-tabs.md rather than hidden here.
#[tauri::command]
pub async fn web_shot(app: AppHandle, tab: String) -> Result<Option<String>, String> {
    let view = found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<Option<Vec<u8>>>(1);

    let asked = view.with_webview(move |platform| {
        let answering = sending.clone();
        if let Err(error) = shot::photograph(&platform, sending) {
            eprintln!("web_shot: {error}");
            let _ = answering.try_send(None);
        }
    });

    if asked.is_err() {
        return Ok(None);
    }

    let bytes = waiting.recv().await.flatten();
    Ok(bytes.map(|one| {
        use base64::Engine as _;
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(one)
        )
    }))
}

/// The webview for a tab, or a reason there is none. A tab whose page has been
/// unloaded to give the memory back is the ordinary case rather than a failure, and
/// the window opens it again instead of reporting anything.
fn found(app: &AppHandle, tab: &str) -> Result<Webview, String> {
    app.get_webview(&format!("{LABEL}{tab}"))
        .ok_or_else(|| "that tab has no page open".to_string())
}

#[cfg(windows)]
mod shot {
    use tauri::async_runtime::Sender;
    use tauri::webview::PlatformWebview;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows_com::Win32::Foundation::HGLOBAL;
    use windows_com::Win32::System::Com::{
        IStream, StructuredStorage::CreateStreamOnHGlobal, STREAM_SEEK_END, STREAM_SEEK_SET,
    };

    /// Asks the engine to photograph itself. The answer arrives later, on the channel.
    #[allow(
        unsafe_code,
        reason = "CapturePreview is reached through WebView2's COM interfaces, and the picture comes back in a COM stream"
    )]
    pub fn photograph(
        webview: &PlatformWebview,
        done: Sender<Option<Vec<u8>>>,
    ) -> Result<(), String> {
        // Safe: the controller comes from the webview this window owns, the stream is
        // made here and read only after the engine says it is written, and the handler
        // outlives the call because WebView2 holds it.
        unsafe {
            let core = webview
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;

            // A stream that allocates for itself - a null handle is what asks for that -
            // and frees itself when the last hold on it goes, which is when this
            // closure has read it.
            let stream: IStream = CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true)
                .map_err(|error| error.to_string())?;

            let reading = stream.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let bytes = match result {
                    Err(_) => None,
                    Ok(()) => png(&reading),
                };
                let _ = done.try_send(bytes);
                Ok(())
            }));

            core.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
            .map_err(|error| error.to_string())
        }
    }

    /// The PNG out of the stream the engine wrote it into.
    #[allow(unsafe_code, reason = "a COM stream is read through its own interface")]
    fn png(stream: &IStream) -> Option<Vec<u8>> {
        // Safe: the stream was written by the engine before this is called, and every
        // length below is the one the stream itself reports.
        unsafe {
            let mut end = 0u64;
            stream.Seek(0, STREAM_SEEK_END, Some(&raw mut end)).ok()?;
            stream.Seek(0, STREAM_SEEK_SET, None).ok()?;

            let size = usize::try_from(end).ok()?;
            if size == 0 || size > 32 * 1024 * 1024 {
                return None;
            }

            let mut bytes = vec![0u8; size];
            let mut read = 0u32;
            // `Read` answers with an HRESULT rather than a result, because a stream that
            // gave less than it was asked for is `S_FALSE` and not a failure. How much
            // arrived is the answer that matters.
            let got = stream.Read(
                bytes.as_mut_ptr().cast(),
                u32::try_from(size).ok()?,
                Some(&raw mut read),
            );
            if got.is_err() {
                return None;
            }

            bytes.truncate(usize::try_from(read).unwrap_or(0));
            (!bytes.is_empty()).then_some(bytes)
        }
    }
}

#[cfg(not(windows))]
mod shot {
    use tauri::async_runtime::Sender;
    use tauri::webview::PlatformWebview;

    /// No way in. `WKWebView`'s own snapshot and `WebKitGTK`'s are not reachable
    /// through what wry hands out, so the window keeps its own ground under an overlay
    /// here; see the note on `web_shot`.
    pub fn photograph(
        _webview: &PlatformWebview,
        done: Sender<Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let _ = done.try_send(None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed, guard, handed_over, reader, Trail, WebTabs};
    use tauri::Url;

    fn at(url: &str) -> Url {
        Url::parse(url).expect("an address")
    }

    #[test]
    fn only_the_web_is_allowed() {
        assert!(allowed(&at("https://example.com/a")));
        assert!(allowed(&at("http://example.com/a")));
        assert!(!allowed(&at("file:///C:/notes/Idea.md")));
        assert!(!allowed(&at("mailto:someone@example.com")));
        assert!(!allowed(&at("data:text/html,<p>hi")));
    }

    #[test]
    fn the_app_is_not_a_page() {
        assert!(!allowed(&at("http://tauri.localhost/index.html")));
        assert!(!allowed(&at("https://TAURI.localhost/")));
        assert!(!allowed(&at("http://ipc.localhost/notes")));
        assert!(!allowed(&at("http://asset.localhost/a.png")));
    }

    #[test]
    fn a_window_the_page_asked_for_is_a_page_or_is_nothing() {
        assert_eq!(
            handed_over(&at("https://example.com/a")),
            Some("https://example.com/a".to_string())
        );

        // The app's own scheme: a site asking for a window is a site asking this
        // app to do something, and the system would hand it straight over.
        assert!(handed_over(&at("nib://command?id=record")).is_none());
        // And the rest of what a machine has registered.
        assert!(handed_over(&at("file:///C:/notes/Idea.md")).is_none());
        assert!(handed_over(&at("smb://example.com/share")).is_none());
        assert!(handed_over(&at("ms-officecmd:x")).is_none());
        // The app's own origins, which are refused for the tab and here.
        assert!(handed_over(&at("http://tauri.localhost/index.html")).is_none());
    }

    #[test]
    fn a_trail_remembers_where_it_has_been() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert!(!trail.forward());

        trail.visited("https://b.example/");
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn the_same_page_again_is_not_a_step() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert_eq!(trail.urls.len(), 1);
    }

    #[test]
    fn a_step_back_moves_along_the_trail_rather_than_adding_to_it() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");

        assert_eq!(trail.at, 0);
        assert_eq!(trail.urls.len(), 2);
        assert!(!trail.back());
        assert!(trail.forward());
    }

    #[test]
    fn somewhere_new_forgets_what_was_ahead() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");
        trail.visited("https://c.example/");

        assert_eq!(trail.urls, ["https://a.example/", "https://c.example/"]);
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn nothing_granted_takes_every_device_away() {
        let script = guard(&[]);
        assert!(script.contains("'mediaDevices'"));
        assert!(script.contains("'clipboard'"));
        assert!(script.contains("'geolocation'"));
        assert!(script.contains("delete window.__TAURI_INTERNALS__"));
        assert!(!script.contains("__HIDDEN__"));
    }

    #[test]
    fn a_grant_is_spent_by_leaving_one_alone() {
        let script = guard(&["camera".to_string()]);
        assert!(!script.contains("'mediaDevices'"));
        assert!(script.contains("'clipboard'"));
    }

    #[test]
    fn the_hardware_buses_are_never_granted() {
        let script = guard(&["usb".to_string(), "bluetooth".to_string()]);
        assert!(script.contains("'usb'"));
        assert!(script.contains("'bluetooth'"));
    }

    #[test]
    fn one_tab_builds_one_page_at_a_time() {
        let tabs = WebTabs::default();

        assert!(tabs.claim("a"));
        // The second placement of the same tab, a frame later, while the first is
        // still waiting for its controller. Two builds would be two webviews under
        // one label.
        assert!(!tabs.claim("a"));
        // Another tab is another page and is nobody's business.
        assert!(tabs.claim("b"));

        tabs.built("a");
        assert!(tabs.claim("a"));
    }

    #[test]
    fn a_page_that_could_not_be_built_gives_the_tab_back() {
        let tabs = WebTabs::default();

        assert!(tabs.claim("a"));
        tabs.built("a");
        assert!(tabs.claim("a"));
    }

    #[test]
    fn the_trail_is_kept_for_the_tab_that_walked_it() {
        let tabs = WebTabs::default();

        tabs.walked("a", "https://a.example/");
        tabs.walked("a", "https://b.example/");
        tabs.walked("b", "https://c.example/");

        let trails = tabs.trails.lock().expect("the trails");
        assert!(trails["a"].back());
        assert!(!trails["b"].back());
    }

    #[test]
    fn the_reader_says_whether_it_wants_the_selection() {
        assert!(reader(true).contains("(true ? selected()"));
        assert!(reader(false).contains("(false ? selected()"));
        assert!(!reader(false).contains("__LONGEST__"));
    }
}
