//! How a page asked for a tab of its own: behind the page, or in front of it.
//!
//! Emil, 2026-09-28: *"I want Ctrl + Click to work for opening new tabs."* Inside a page
//! they did open a tab - every window a page asks for becomes one (see `on_new_window`
//! in `web_tabs.rs`) - but always in front, so a Ctrl+click took the reader away from the
//! page they meant to stay on. A browser keeps them there: Ctrl+click, the middle
//! button and the menu's "open link in new tab" leave the tab behind; Ctrl+Shift+click
//! and Shift+click go to it; a plain `target="_blank"` goes to it too.
//!
//! **The engine does not say which.** Chromium knows - it opens a link with a
//! disposition - but `WebView2` hands the host the address, whether a person asked,
//! the size a script wanted and the window name, and nothing else. So the answer is put
//! together here from what is to be had, in this order, on the window's own thread at
//! the moment the engine raises the request:
//!
//! 1. **The window name.** The middle button leaves no key held, so a small script in
//!    every page (`MIDDLE`) answers that press itself and opens the link under a name
//!    that says so. A site that opens a window under the same name gets a tab behind
//!    it, which is less than it could already do by asking for one in front.
//! 2. **The keys held.** Ctrl, and Shift, as the input this thread shares with the
//!    page's window has them, the same reading `web_keys.rs` makes.
//! 3. **The page's own menu.** Its link row opens the link it was raised on, so a
//!    request for that address right after the menu is the menu's, and goes behind.
//!
//! What none of them says is the page's own request, which `web_tabs.rs` answers: a tab
//! in front, or for one that asked for a size - an OAuth sign-in, a share dialog - a
//! window of its own, so the page that opened it can still hear from it.
//!
//! `WebView2`'s alone, like `web_keys.rs`: elsewhere nothing is known, and every tab a
//! page asks for opens in front, as before.

use crate::web_keys::Held;

/// Where the tab a page asked for goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asked {
    /// Beside the page, which stays in front.
    Behind,
    /// Beside the page, and shown.
    Front,
}

/// The window names `MIDDLE` opens a link under.
const BEHIND: &str = "nib-behind";
const FRONT: &str = "nib-front";

/// Opens a link pressed with the middle button as a window under a name that says how
/// it was pressed, and keeps the engine from opening it a second time. Only a press a
/// person made, on a web address, that the page itself has not already answered; with
/// Shift it is a tab in front, as in Chrome.
///
/// On the window rather than the document, so it runs after every handler the page
/// put on the way there and can see whether one of them took the press.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub const MIDDLE: &str = r"(function () {
  addEventListener('auxclick', function (event) {
    if (!event.isTrusted || event.button !== 1 || event.defaultPrevented) return
    var link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null
    if (!link || typeof link.href !== 'string' || !/^https?:/i.test(link.href)) return
    event.preventDefault()
    window.open(link.href, event.shiftKey ? 'nib-front' : 'nib-behind')
  })
})()";

/// What one request said, down to where its tab goes, or `None` for a request nobody
/// pressed anything for - the page's own, which `web_tabs.rs` answers.
///
/// `name` is the window name the page asked for; `user` whether the engine says a
/// person asked; `held` the keys held; `menu` whether the page's own menu was just
/// raised on this address. Pure, so the order above has tests.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn placed(name: &str, user: bool, held: Held, menu: bool) -> Option<Asked> {
    match name {
        BEHIND => return Some(Asked::Behind),
        FRONT => return Some(Asked::Front),
        _ => {}
    }

    // Keys held while a script opened a window on its own are not about that window.
    if !user {
        return None;
    }
    if held.ctrl {
        return Some(if held.shift {
            Asked::Front
        } else {
            Asked::Behind
        });
    }
    if held.shift {
        return Some(Asked::Front);
    }
    menu.then_some(Asked::Behind)
}

/// Starts listening on one page, under the tab it belongs to. Called on the window's
/// thread, once, as the page is built.
#[cfg(all(windows, not(feature = "cef")))]
pub use heard::{closing, listen, taken};

#[cfg(all(windows, not(feature = "cef")))]
mod heard {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2NewWindowRequestedEventArgs2, ICoreWebView2_11,
    };
    use webview2_com::{
        ContextMenuRequestedEventHandler, NewWindowRequestedEventHandler,
        WindowCloseRequestedEventHandler,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_SHIFT,
    };
    use windows_core::Interface;

    use super::{placed, Asked, Held};

    thread_local! {
        /// What each tab's last request said, until `on_new_window` takes it. The
        /// engine raises the request to every handler before wry's own answer runs -
        /// wry posts it to the next turn of the loop - so the reading is always here
        /// first, on this one thread.
        static SAID: RefCell<HashMap<String, Option<Asked>>> = RefCell::new(HashMap::new());
        /// The link each tab's own menu was last raised on.
        static MENU: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
    }

    /// Closes a window a page asked for when its page closes itself, the way a sign-in
    /// popup ends. wry answers the page's `window.close()` by destroying the webview's
    /// own container, which leaves the window around it standing empty; so the window
    /// is closed here instead.
    #[allow(
        unsafe_code,
        reason = "a page closing itself is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn closing(webview: &PlatformWebview, window: tauri::WebviewWindow) {
        // Safe: the controller is this window's, the handler is used only on this
        // thread, and WebView2 holds it for as long as it can fire.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let closed = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let _ = window.close();
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_WindowCloseRequested(&closed, &raw mut token);
        }
    }

    /// What the last request from this tab said, taken so it is read once.
    pub fn taken(tab: &str) -> Option<Asked> {
        SAID.with_borrow_mut(|said| said.remove(tab)).flatten()
    }

    #[allow(
        unsafe_code,
        reason = "a page asking for a window is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, tab: String) {
        // Whether a key is down, asked the two ways `web_keys.rs` asks it.
        let held = |key: VIRTUAL_KEY| {
            let code = i32::from(key.0);
            unsafe { GetKeyState(code) < 0 || GetAsyncKeyState(code) < 0 }
        };

        // Safe: the controller is this window's, every object below is used only on
        // this thread, and WebView2 holds each handler for as long as it can fire.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };

            let asking = tab.clone();
            let requested = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };

                let mut uri = windows_core::PWSTR::null();
                args.Uri(&raw mut uri)?;
                let uri = webview2_com::take_pwstr(uri);

                let mut user = windows_core::BOOL::default();
                let _ = args.IsUserInitiated(&raw mut user);

                let name = args
                    .cast::<ICoreWebView2NewWindowRequestedEventArgs2>()
                    .ok()
                    .and_then(|named| {
                        let mut name = windows_core::PWSTR::null();
                        named.Name(&raw mut name).ok()?;
                        Some(webview2_com::take_pwstr(name))
                    })
                    .unwrap_or_default();

                let menu = MENU
                    .with_borrow_mut(|menu| menu.remove(&asking).is_some_and(|link| link == uri));

                let keys = Held {
                    ctrl: held(VK_CONTROL),
                    shift: held(VK_SHIFT),
                    alt: false,
                };
                let said = placed(&name, user.as_bool(), keys, menu);
                SAID.with_borrow_mut(|all| all.insert(asking.clone(), said));
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_NewWindowRequested(&requested, &raw mut token);

            // The page's own menu, remembered by the link it was raised on. A menu
            // raised anywhere else forgets the last one, so a link row chosen long ago
            // cannot speak for a window asked for now.
            let Ok(core) = core.cast::<ICoreWebView2_11>() else {
                return;
            };
            let menu = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };

                let target = args.ContextMenuTarget()?;
                let mut has = windows_core::BOOL::default();
                target.HasLinkUri(&raw mut has)?;
                let link = if has.as_bool() {
                    let mut link = windows_core::PWSTR::null();
                    target.LinkUri(&raw mut link)?;
                    Some(webview2_com::take_pwstr(link))
                } else {
                    None
                };

                MENU.with_borrow_mut(|menu| match link {
                    Some(link) => menu.insert(tab.clone(), link),
                    None => menu.remove(&tab),
                });
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ContextMenuRequested(&menu, &raw mut token);
        }
    }
}

/// Every other engine: nothing is known about a request, and every tab a page asks for
/// opens in front; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(_webview: &tauri::webview::PlatformWebview, _tab: String) {}

#[cfg(any(not(windows), feature = "cef"))]
pub fn taken(_tab: &str) -> Option<Asked> {
    None
}

#[cfg(test)]
mod tests {
    use super::{placed, Asked, Held};

    const NONE: Held = Held {
        ctrl: false,
        shift: false,
        alt: false,
    };
    const CTRL: Held = Held { ctrl: true, ..NONE };
    const SHIFT: Held = Held {
        shift: true,
        ..NONE
    };
    const BOTH: Held = Held {
        ctrl: true,
        shift: true,
        alt: false,
    };

    #[test]
    fn the_middle_buttons_script_names_the_window() {
        assert_eq!(placed("nib-behind", true, NONE, false), Some(Asked::Behind));
        assert_eq!(placed("nib-front", true, SHIFT, false), Some(Asked::Front));
    }

    #[test]
    fn ctrl_leaves_the_tab_behind_and_shift_with_it_goes_there() {
        assert_eq!(placed("", true, CTRL, false), Some(Asked::Behind));
        assert_eq!(placed("", true, BOTH, false), Some(Asked::Front));
    }

    #[test]
    fn shift_alone_goes_there_since_a_window_would_be_a_second_workspace() {
        assert_eq!(placed("", true, SHIFT, false), Some(Asked::Front));
    }

    #[test]
    fn the_pages_own_menu_leaves_the_tab_behind() {
        assert_eq!(placed("", true, NONE, true), Some(Asked::Behind));
    }

    #[test]
    fn a_plain_press_is_the_pages_own_request() {
        assert_eq!(placed("", true, NONE, false), None);
        assert_eq!(placed("_blank", true, NONE, false), None);
    }

    #[test]
    fn keys_held_while_a_script_opens_a_window_are_not_about_it() {
        assert_eq!(placed("", false, CTRL, false), None);
        assert_eq!(placed("", false, NONE, true), None);
        // The name is the script's own answer to a press, and a press it saw.
        assert_eq!(
            placed("nib-behind", false, NONE, false),
            Some(Asked::Behind)
        );
    }
}
