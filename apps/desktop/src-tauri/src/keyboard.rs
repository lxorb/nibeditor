//! Where the keyboard was in each window, and the keyboard put back there.
//!
//! Emil, 2026-09-30: *"when I Alt+Tab out of nib and back in, I usually have to click
//! again before I can type, into the terminal or the open web page."* A browser puts the
//! keyboard back exactly where it was - the site's own field with its caret, the address
//! field, a terminal's prompt - however the window came back: Alt+Tab, the taskbar, a
//! notification, a dialog closing over it. Chrome does it by storing the focused view as
//! its window is left and restoring it as the window comes back; the page keeps its own
//! focused element meanwhile, in the renderer.
//!
//! **Why nib lost it.** A window here holds several webviews: the app's own page and one
//! per web tab. On Windows every activation hands the keyboard to the window itself, and
//! wry answers that by moving it into the window's *own* page, always - and does the same
//! at the start of every drag of the window. So a web tab's page never had the keyboard
//! back after Alt+Tab, whatever it held before. nib's own Chromium is worse off: nothing
//! there hands the window's keyboard to any page at all.
//!
//! **One record per window**: which of its web pages has the keyboard, or none, which is
//! the app's own page. Written only when the keyboard really moves: a page takes it (the
//! engine says so, or it is found there as the app's page lets go of it, or as the window
//! is left), or a person takes it into the app's page, which the page says itself
//! (`keyboard_here`, from lib/keyboard-home.ts). Never by the window's own activation, and
//! never by nib handing a browser chord back to its own page. The element inside a page is
//! the engine's to keep - the site's input with its caret and selection, the note, the
//! terminal - and the app's page keeps the other half of this record for its own elements.
//!
//! **Read back** as the window takes the keyboard (`WM_SETFOCUS`: activation, a restore
//! from the taskbar, a dialog closing) and as a drag of it ends, inside that same message,
//! so a click that activated the window still lands where it clicked. And by the app's page
//! once a layer of its own has closed with the keyboard nowhere (`keyboard_back`). Only a
//! page that is on screen, only one of the reader's tabs - an agent's own page is never in
//! this record - and never while another program is in front.
//!
//! A Mac and Linux keep a window's first responder and its focus widget across activation
//! themselves, so only the second reading is theirs; the same record and the same commands,
//! with the platform asked which page has the keyboard.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::Instant;

use tauri::{AppHandle, Manager as _, Webview};

/// How long a page that was out of sight under a layer may still be handed the keyboard
/// back as it comes into sight again: the layer's own way out, and a margin for the
/// window to see it has gone. See `LEAVING` in lib/web-tab/WebTab.svelte.
const OWED_MS: u64 = 1_000;

/// The record, for every window of the run.
#[derive(Debug, Default)]
struct Homes {
    /// The page that has the keyboard, by the label of the window it is in. A window that
    /// is not here is typing in its own page.
    typing: HashMap<String, String>,
    /// The pages on screen, by label.
    shown: HashSet<String>,
    /// A page owed the keyboard the moment it is shown again, and until when.
    owed: Option<(String, u64)>,
}

/// Where the keyboard goes back to after one of the app's layers has closed.
#[derive(Debug, PartialEq, Eq)]
enum Back {
    /// To this page, now.
    Page(String),
    /// To a page still out of sight under the layer, as it is shown again.
    Later,
    /// To the app's own page, which knows which of its elements.
    Own,
}

impl Homes {
    fn page_took(&mut self, window: &str, page: &str) {
        self.typing.insert(window.to_string(), page.to_string());
        self.owed = None;
    }

    fn own_took(&mut self, window: &str) {
        self.typing.remove(window);
        self.owed = None;
    }

    /// A page shown or hidden. True when it is shown owing the keyboard.
    fn placed(&mut self, page: &str, visible: bool, now: u64) -> bool {
        if !visible {
            self.shown.remove(page);
            return false;
        }
        self.shown.insert(page.to_string());
        match self.owed.take() {
            Some((owed, until)) if owed == page => now <= until,
            other => {
                self.owed = other;
                false
            }
        }
    }

    fn closed(&mut self, page: &str) {
        self.typing.retain(|_, one| one != page);
        self.shown.remove(page);
        if self.owed.as_ref().is_some_and(|(owed, _)| owed == page) {
            self.owed = None;
        }
    }

    /// The page to hand the keyboard back to as the window comes back: the one that had
    /// it, while it is still on screen.
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "a Mac and Linux keep a window's keyboard across activation themselves"
        )
    )]
    fn home(&self, window: &str) -> Option<&str> {
        self.typing
            .get(window)
            .filter(|page| self.shown.contains(*page))
            .map(String::as_str)
    }

    fn back(&mut self, window: &str, now: u64) -> Back {
        let Some(page) = self.typing.get(window) else {
            return Back::Own;
        };
        if self.shown.contains(page) {
            return Back::Page(page.clone());
        }
        self.owed = Some((page.clone(), now.saturating_add(OWED_MS)));
        Back::Later
    }
}

static HOMES: LazyLock<Mutex<Homes>> = LazyLock::new(Mutex::default);

/// The record, for one short look. Never held across a call into the engine: the engine
/// may say a page took the keyboard from inside that call, which writes here.
fn homes<T>(look: impl FnOnce(&mut Homes) -> T) -> T {
    look(&mut HOMES.lock().unwrap_or_else(PoisonError::into_inner))
}

/// Milliseconds since the record was first asked the time.
fn now() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    u64::try_from(START.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// A page took the keyboard.
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "only Windows says a page took it as it happens")
)]
fn page_took(window: &str, page: &str) {
    homes(|all| all.page_took(window, page));
}

/// A web tab's page is on screen as it is built: the rectangle it was built at is the
/// pane's. See `web_open`.
pub fn built(page: &str) {
    homes(|all| all.placed(page, true, now()));
}

/// A page shown or hidden, from `web_place` on the window's own thread; a page owed the
/// keyboard takes it as it arrives, while its window is still the one in front.
pub fn placed(app: &AppHandle, view: &Webview, visible: bool) {
    let page = view.label();
    if homes(|all| all.placed(page, visible, now())) && native::in_front(&view.window()) {
        native::take(app, page);
    }
}

/// A page closed, on the window's own thread.
pub fn closed(page: &str) {
    homes(|all| all.closed(page));
    native::let_go_of(page);
}

/// The window was left: whichever of its pages has the keyboard is where it goes back to.
#[cfg(windows)]
fn left(window: &str) {
    if let Some(page) = native::holding(window) {
        page_took(window, &page);
    }
}

/// The window took the keyboard, which the engine has just put in the app's own page.
///
/// Never in a run whose windows were sent off the screen: a page handed the keyboard
/// activates the window it is in, and a probe's window must never be activated; see
/// foreground.rs. A probe's window is never activated to begin with, so this is the
/// guard's second line, not its first.
#[cfg(windows)]
fn returned(window: &str) {
    if crate::placement::away().is_some() {
        return;
    }
    match homes(|all| all.home(window).map(str::to_string)) {
        Some(page) => {
            if !native::take_now(&page) {
                native::take_own(window);
            }
        }
        None => native::take_own(window),
    }
}

/// Starts following a window, once, as its page comes up.
#[tauri::command]
pub fn keyboard_watch(webview: Webview) {
    native::watch(&webview);
}

/// Somebody put the keyboard in the app's own page: a key, or an element a person types
/// or stands in taking it. Said by the page once each time it has the keyboard again.
#[tauri::command]
pub fn keyboard_here(webview: Webview) {
    homes(|all| all.own_took(webview.window().label()));
}

/// The app's own page let go of the keyboard. Where it went, if it went to a page of this
/// window, is written down, and the answer is whether it did; gone to another program,
/// nothing is.
#[tauri::command]
pub fn keyboard_went(webview: Webview) -> bool {
    let window = webview.window().label().to_string();
    let Some(page) = native::holding(&window) else {
        return false;
    };
    homes(|all| all.page_took(&window, &page));
    true
}

/// One of the app's layers closed with the keyboard nowhere. True when a page has it back
/// or will as it comes into sight; false leaves it to the app's own page. Never while
/// another program is in front: nib only ever gives the keyboard back to itself.
///
/// With a tab, that tab's page is where it goes: a web tab's find bar closing, which was
/// opened from the page and gives the page its keyboard back, as Chrome's does.
#[tauri::command]
pub fn keyboard_back(webview: Webview, tab: Option<String>) -> bool {
    let window = webview.window();
    if let Some(tab) = tab {
        let page = crate::web_tabs::label_of(&tab);
        homes(|all| all.page_took(window.label(), &page));
    }
    // A probe's window is never in front, and never handed the keyboard besides; see
    // `returned`.
    if crate::placement::away().is_some() || !native::in_front(&window) {
        return false;
    }
    match homes(|all| all.back(window.label(), now())) {
        Back::Page(page) => native::take(webview.app_handle(), &page),
        Back::Later => true,
        Back::Own => false,
    }
}

/// What a message to a window says about its keyboard.
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
#[derive(Debug, PartialEq, Eq)]
enum Moment {
    /// The window is being left for another: where the keyboard is now is where it goes
    /// back to.
    Leaving,
    /// The window has the keyboard back, or has stopped being dragged: it goes home.
    Back,
    Nothing,
}

/// `WM_ACTIVATE` with `WA_INACTIVE`, `WM_SETFOCUS` and `WM_EXITSIZEMOVE`, by number, so
/// the rule reads and is tested on every platform.
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
fn moment(message: u32, wparam: usize) -> Moment {
    const ACTIVATE: u32 = 0x0006;
    const SET_FOCUS: u32 = 0x0007;
    const EXIT_SIZE_MOVE: u32 = 0x0232;
    const INACTIVE: usize = 0;
    // The low word says how; the high one whether the window is minimised.
    let how = wparam % 0x1_0000;
    match message {
        ACTIVATE if how == INACTIVE => Moment::Leaving,
        SET_FOCUS | EXIT_SIZE_MOVE => Moment::Back,
        _ => Moment::Nothing,
    }
}

/// The window's own messages, on Windows: the one seam every engine's window shares.
#[cfg(windows)]
mod watching {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::{Webview, Window};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsChild, WM_NCDESTROY};

    use super::{left, moment, returned, Moment};

    /// This file's own mark among the window's subclasses: wry keeps one of its own there.
    const OURS: usize = 0x6b65_7973;

    thread_local! {
        /// The windows followed, by handle, with their labels.
        static WINDOWS: RefCell<HashMap<isize, String>> = RefCell::new(HashMap::new());
    }

    /// Follows the messages of the window a page is in, once. On the window's own thread.
    #[allow(
        unsafe_code,
        reason = "a window's activation is heard through a Win32 subclass, which only the Win32 API installs"
    )]
    pub fn watch(webview: &Webview) {
        let window = webview.window();
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let (hwnd, label) = (hwnd.0 as isize, window.label().to_string());
        if WINDOWS.with_borrow_mut(|all| all.insert(hwnd, label).is_some()) {
            return;
        }
        // Safe: a window of this thread, and a procedure that lives for the program; it
        // takes itself off as the window goes.
        unsafe {
            let _ = SetWindowSubclass(HWND(hwnd as *mut core::ffi::c_void), Some(heard), OURS, 0);
        }
    }

    /// Whether the keyboard is in this window or inside it, asked of the input this thread
    /// shares with every page's window, the way `web_opens.rs` asks it.
    #[allow(
        unsafe_code,
        reason = "which window has the keyboard is Win32's to say"
    )]
    pub fn keyboard_in(host: isize) -> bool {
        let host = HWND(host as *mut core::ffi::c_void);
        // Safe: which window of this thread's input has the keyboard, and whether it is
        // inside another; neither takes anything.
        unsafe {
            let focus = GetFocus();
            !focus.is_invalid() && (host == focus || IsChild(host, focus).as_bool())
        }
    }

    /// Whether this window is the one in front of the person.
    #[allow(unsafe_code, reason = "which window is in front is Win32's to say")]
    pub fn in_front(window: &Window) -> bool {
        let Ok(ours) = window.hwnd() else {
            return false;
        };
        // Safe: reads which window is in front; takes nothing.
        let front = unsafe { GetForegroundWindow() };
        front.0 as isize == ours.0 as isize
    }

    /// Runs in front of wry's own subclass, which was there first: the keyboard is looked
    /// for before the window's default moves it, and put back after wry has put it in the
    /// app's own page.
    #[allow(
        unsafe_code,
        reason = "the subclass's own procedure, called by Win32 with the message's words"
    )]
    unsafe extern "system" fn heard(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        // Every message the window gets passes through here, so the label is only looked
        // up for the three this is about.
        let now = moment(message, wparam.0);
        let window = match now {
            Moment::Nothing => None,
            _ => WINDOWS.with_borrow(|all| all.get(&(hwnd.0 as isize)).cloned()),
        };
        if let (Some(window), Moment::Leaving) = (&window, &now) {
            left(window);
        }

        // Safe: hands the message on down the window's chain, as a subclass must.
        let answer = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };

        if let (Some(window), Moment::Back) = (&window, &now) {
            returned(window);
        }
        if message == WM_NCDESTROY {
            WINDOWS.with_borrow_mut(|all| all.remove(&(hwnd.0 as isize)));
            // Safe: this subclass, off the window that is going.
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(heard), OURS);
            }
        }
        answer
    }
}

/// The page asked which of this window's pages has the keyboard, and one of them handed
/// it: `WebView2`, through each page's controller.
#[cfg(all(windows, not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::webview::PlatformWebview;
    use tauri::AppHandle;
    use webview2_com::FocusChangedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
    };

    pub use super::watching::{in_front, watch};

    /// A reader's web page: the window it is in, and its controller.
    struct Page {
        window: String,
        controller: ICoreWebView2Controller,
    }

    thread_local! {
        /// Every reader's page, by label. On the window's thread, which is the only one
        /// the engine's objects may be touched from.
        static PAGES: RefCell<HashMap<String, Page>> = RefCell::new(HashMap::new());
    }

    /// A reader's page, as it is built: the engine says each time it takes the keyboard.
    #[allow(
        unsafe_code,
        reason = "a page taking the keyboard is WebView2's own controller event, reached through COM"
    )]
    pub fn page(platform: &PlatformWebview, label: &str, window: &str) {
        let controller = platform.controller();
        let (holder, named) = (window.to_string(), label.to_string());
        let got = FocusChangedEventHandler::create(Box::new(move |_, _| {
            super::page_took(&holder, &named);
            Ok(())
        }));
        let mut token = 0i64;
        // Safe: the controller is this page's own, on its own thread; the engine holds the
        // handler for as long as the page lives.
        unsafe {
            let _ = controller.add_GotFocus(&got, &raw mut token);
        }
        let page = Page {
            window: window.to_string(),
            controller,
        };
        PAGES.with_borrow_mut(|all| all.insert(label.to_string(), page));
    }

    pub fn let_go_of(label: &str) {
        PAGES.with_borrow_mut(|all| all.remove(label));
    }

    /// Which of this window's pages has the keyboard now.
    #[allow(
        unsafe_code,
        reason = "a page's window is its WebView2 controller's to say, reached through COM"
    )]
    pub fn holding(window: &str) -> Option<String> {
        PAGES.with_borrow(|all| {
            all.iter().find_map(|(label, page)| {
                if page.window != window {
                    return None;
                }
                let mut parent = windows_com::Win32::Foundation::HWND::default();
                // Safe: the page's own window, asked of its controller on its thread.
                unsafe { page.controller.ParentWindow(&raw mut parent).ok()? };
                super::watching::keyboard_in(parent.0 as isize).then(|| label.clone())
            })
        })
    }

    /// Hands a page the keyboard, the engine's way: the page's own focused element, its
    /// caret and its selection come back with it.
    #[allow(
        unsafe_code,
        reason = "a page is given the keyboard through its WebView2 controller, reached through COM"
    )]
    pub fn take_now(label: &str) -> bool {
        let Some(controller) =
            PAGES.with_borrow(|all| all.get(label).map(|page| page.controller.clone()))
        else {
            return false;
        };
        // Safe: the page's own controller, on its own thread. Out of the borrow above,
        // because the engine may say the page took the keyboard from inside this call.
        unsafe {
            controller
                .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
                .is_ok()
        }
    }

    pub fn take(_app: &AppHandle, label: &str) -> bool {
        take_now(label)
    }

    /// The app's own page: wry has already handed it the keyboard.
    pub fn take_own(_window: &str) {}
}

/// The same on nib's own Chromium on Windows, through each browser's host, which is CEF's
/// own way to give a browser the keyboard. There the app's own page is a browser like any
/// other and nothing hands it the keyboard as the window comes back, so this does.
#[cfg(all(windows, feature = "cef"))]
mod native {
    use std::sync::{Mutex, PoisonError};

    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri::{AppHandle, Webview};
    use tauri_runtime_cef::WebviewCefExt as _;

    pub use super::watching::in_front;

    /// A browser the keyboard can be handed to: a reader's page, or a window's own.
    struct Page {
        label: String,
        window: String,
        own: bool,
        host: cef::BrowserHost,
    }

    static PAGES: Mutex<Vec<Page>> = Mutex::new(Vec::new());

    fn pages<T>(look: impl FnOnce(&mut Vec<Page>) -> T) -> T {
        look(&mut PAGES.lock().unwrap_or_else(PoisonError::into_inner))
    }

    fn keep_host(page: Page) {
        pages(|all| {
            all.retain(|one| one.label != page.label);
            all.push(page);
        });
    }

    /// Nothing to hear on the runtime's own webview; see `chromium_page`.
    pub fn page(_platform: &tauri::webview::PlatformWebview, _label: &str, _window: &str) {}

    /// A reader's page, by its browser's host, as its browser is found.
    pub fn chromium_page(label: &str, window: &str, host: cef::BrowserHost) {
        keep_host(Page {
            label: label.to_string(),
            window: window.to_string(),
            own: false,
            host,
        });
    }

    pub fn let_go_of(label: &str) {
        pages(|all| all.retain(|one| one.label != label));
    }

    /// Which of this window's pages has the keyboard now.
    pub fn holding(window: &str) -> Option<String> {
        pages(|all| {
            all.iter()
                .find(|one| {
                    !one.own
                        && one.window == window
                        && super::watching::keyboard_in(one.host.window_handle().0 as isize)
                })
                .map(|one| one.label.clone())
        })
    }

    fn focus(host: Option<cef::BrowserHost>) -> bool {
        host.is_some_and(|host| {
            host.set_focus(1);
            true
        })
    }

    pub fn take_now(label: &str) -> bool {
        focus(pages(|all| {
            all.iter()
                .find(|one| !one.own && one.label == label)
                .map(|one| one.host.clone())
        }))
    }

    pub fn take(_app: &AppHandle, label: &str) -> bool {
        take_now(label)
    }

    pub fn take_own(window: &str) {
        focus(pages(|all| {
            all.iter()
                .find(|one| one.own && one.window == window)
                .map(|one| one.host.clone())
        }));
    }

    /// Follows the window, and keeps its own page's host to hand the keyboard to.
    pub fn watch(webview: &Webview) {
        super::watching::watch(webview);
        let label = webview.window().label().to_string();
        let own = webview.label().to_string();
        let _ = webview.with_cef_webview(move |page| {
            if let Some(host) = page.browser().host() {
                keep_host(Page {
                    label: own,
                    window: label,
                    own: true,
                    host,
                });
            }
        });
    }
}

/// A Mac, asked which page is the window's first responder or inside it. The keyboard is
/// handed over through the runtime, which makes the page the first responder.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow};
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    struct Page {
        window: String,
        view: Retained<WKWebView>,
        frame: Retained<NSWindow>,
    }

    thread_local! {
        static PAGES: RefCell<HashMap<String, Page>> = RefCell::new(HashMap::new());
    }

    #[allow(
        unsafe_code,
        reason = "the runtime hands the page and its window over as bare pointers"
    )]
    pub fn page(platform: &PlatformWebview, label: &str, window: &str) {
        // Safe: the runtime's own live objects, of the types it says, on the main thread.
        let (view, frame) = unsafe {
            (
                Retained::retain(platform.inner().cast::<WKWebView>()),
                Retained::retain(platform.ns_window().cast::<NSWindow>()),
            )
        };
        if let (Some(view), Some(frame)) = (view, frame) {
            let page = Page {
                window: window.to_string(),
                view,
                frame,
            };
            PAGES.with_borrow_mut(|all| all.insert(label.to_string(), page));
        }
    }

    pub fn let_go_of(label: &str) {
        PAGES.with_borrow_mut(|all| all.remove(label));
    }

    pub fn holding(window: &str) -> Option<String> {
        PAGES.with_borrow(|all| {
            all.iter().find_map(|(label, page)| {
                if page.window != window {
                    return None;
                }
                let responder = page.frame.firstResponder()?;
                let view = responder.downcast::<NSView>().ok()?;
                view.isDescendantOf(&page.view).then(|| label.clone())
            })
        })
    }

    pub fn take(app: &AppHandle, label: &str) -> bool {
        app.get_webview(label)
            .is_some_and(|page| page.set_focus().is_ok())
    }

    pub fn in_front(window: &Window) -> bool {
        window.is_focused().unwrap_or(false)
    }

    pub fn watch(_webview: &Webview) {}
}

/// Linux, asked which page is its window's focus widget.
#[cfg(all(target_os = "linux", not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};
    use webkit2gtk::glib::prelude::ObjectExt as _;

    thread_local! {
        static PAGES: RefCell<HashMap<String, (String, webkit2gtk::WebView)>> =
            RefCell::new(HashMap::new());
    }

    pub fn page(platform: &PlatformWebview, label: &str, window: &str) {
        let view = platform.inner();
        PAGES.with_borrow_mut(|all| all.insert(label.to_string(), (window.to_string(), view)));
    }

    pub fn let_go_of(label: &str) {
        PAGES.with_borrow_mut(|all| all.remove(label));
    }

    pub fn holding(window: &str) -> Option<String> {
        PAGES.with_borrow(|all| {
            all.iter().find_map(|(label, (holder, view))| {
                (holder == window && view.property::<bool>("is-focus")).then(|| label.clone())
            })
        })
    }

    pub fn take(app: &AppHandle, label: &str) -> bool {
        app.get_webview(label)
            .is_some_and(|page| page.set_focus().is_ok())
    }

    pub fn in_front(window: &Window) -> bool {
        window.is_focused().unwrap_or(false)
    }

    pub fn watch(_webview: &Webview) {}
}

/// Everywhere else - nib's own Chromium on a Mac, the BSDs - the record without the
/// platform's answer to which page has the keyboard: a layer closing gives it back to the
/// app's own page's element.
#[cfg(not(any(
    windows,
    all(any(target_os = "macos", target_os = "linux"), not(feature = "cef"))
)))]
mod native {
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    pub fn page(_platform: &PlatformWebview, _label: &str, _window: &str) {}

    pub fn let_go_of(_label: &str) {}

    pub fn holding(_window: &str) -> Option<String> {
        None
    }

    pub fn take(app: &AppHandle, label: &str) -> bool {
        app.get_webview(label)
            .is_some_and(|page| page.set_focus().is_ok())
    }

    pub fn in_front(window: &Window) -> bool {
        window.is_focused().unwrap_or(false)
    }

    pub fn watch(_webview: &Webview) {}
}

#[cfg(all(windows, feature = "cef"))]
pub use native::chromium_page;
pub use native::page;

#[cfg(test)]
mod tests {
    use super::{moment, Back, Homes, Moment, OWED_MS};

    fn typing_in(window: &str, page: &str) -> Homes {
        let mut homes = Homes::default();
        homes.placed(page, true, 0);
        homes.page_took(window, page);
        homes
    }

    #[test]
    fn a_window_nobody_typed_in_a_page_of_is_typing_in_its_own() {
        let mut homes = Homes::default();
        assert_eq!(homes.home("main"), None);
        assert_eq!(homes.back("main", 0), Back::Own);
    }

    #[test]
    fn the_page_that_took_the_keyboard_is_where_it_goes_back() {
        let homes = typing_in("main", "web-a");
        assert_eq!(homes.home("main"), Some("web-a"));
        // Each window its own.
        assert_eq!(homes.home("window-2"), None);
    }

    #[test]
    fn a_person_in_the_app_s_own_page_takes_it_from_the_page() {
        let mut homes = typing_in("main", "web-a");
        homes.own_took("main");
        assert_eq!(homes.home("main"), None);
    }

    #[test]
    fn the_last_page_to_take_it_wins() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-b", true, 0);
        homes.page_took("main", "web-b");
        assert_eq!(homes.home("main"), Some("web-b"));
    }

    #[test]
    fn a_page_out_of_sight_is_never_handed_it_as_the_window_comes_back() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.home("main"), None);
        // In sight again, it is.
        homes.placed("web-a", true, 0);
        assert_eq!(homes.home("main"), Some("web-a"));
    }

    #[test]
    fn a_page_that_closed_is_forgotten() {
        let mut homes = typing_in("main", "web-a");
        homes.closed("web-a");
        assert_eq!(homes.home("main"), None);
        assert_eq!(homes.back("main", 0), Back::Own);
        // And coming back under the same label is not being on screen.
        homes.page_took("main", "web-a");
        assert_eq!(homes.home("main"), None);
    }

    #[test]
    fn a_layer_closing_hands_a_page_on_screen_the_keyboard_now() {
        let mut homes = typing_in("main", "web-a");
        assert_eq!(homes.back("main", 5), Back::Page("web-a".into()));
    }

    #[test]
    fn a_page_still_under_the_layer_takes_it_as_it_is_shown_again() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 100), Back::Later);
        // Another page shown first owes nothing.
        assert!(!homes.placed("web-b", true, 200));
        assert!(homes.placed("web-a", true, 300));
        // Once.
        assert!(!homes.placed("web-a", true, 400));
    }

    #[test]
    fn a_debt_runs_out() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 100), Back::Later);
        assert!(!homes.placed("web-a", true, 101 + OWED_MS));
    }

    #[test]
    fn the_keyboard_going_anywhere_else_first_clears_the_debt() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 0), Back::Later);
        homes.own_took("main");
        assert!(!homes.placed("web-a", true, 10));

        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 0), Back::Later);
        homes.closed("web-a");
        assert!(!homes.placed("web-a", true, 10));
    }

    #[test]
    fn a_window_is_left_on_its_deactivation_and_home_on_its_focus_or_a_drag_s_end() {
        // WM_ACTIVATE: WA_INACTIVE is left, WA_ACTIVE and WA_CLICKACTIVE are not, and the
        // minimised flag in the high word changes nothing.
        assert_eq!(moment(0x0006, 0), Moment::Leaving);
        assert_eq!(moment(0x0006, 0x0001_0000), Moment::Leaving);
        assert_eq!(moment(0x0006, 1), Moment::Nothing);
        assert_eq!(moment(0x0006, 2), Moment::Nothing);
        // WM_SETFOCUS and WM_EXITSIZEMOVE.
        assert_eq!(moment(0x0007, 0), Moment::Back);
        assert_eq!(moment(0x0232, 0), Moment::Back);
        // WM_KILLFOCUS and WM_ENTERSIZEMOVE are not.
        assert_eq!(moment(0x0008, 0), Moment::Nothing);
        assert_eq!(moment(0x0231, 0), Moment::Nothing);
    }
}
