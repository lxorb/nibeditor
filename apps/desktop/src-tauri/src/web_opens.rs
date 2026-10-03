//! How a page asked for a tab of its own: behind the page, or in front of it.
//!
//! Emil, 2026-09-28: *"I want Ctrl + Click to work for opening new tabs."* Inside a page
//! they did open a tab - every window a page asks for becomes one (see `on_new_window`
//! in `web_tabs.rs`) - but always in front, so a Ctrl+click took the reader away from the
//! page they meant to stay on. A browser keeps them there: Ctrl+click, the middle
//! button and the menu's "open link in new tab" leave the tab behind; Ctrl+Shift+click
//! and Shift+click go to it; a plain `target="_blank"` goes to it too.
//!
//! Emil again, 2026-09-30: *"Ctrl + click to open a new web page doesn't work."* A
//! Ctrl+click, a Shift+click and a `target="_blank"` link had never reached any of this.
//! The opener plugin puts a script in every webview that takes those three presses
//! away from the page, before the engine sees them, to hand the link to the system
//! browser - which a site is never granted, so nothing opened at all. That script is
//! off now (see `lib.rs`), and scripts/web-click-probe.py presses every kind of link
//! every way and fails on any press that opens the wrong thing.
//!
//! **The engine does not say which.** Chromium knows - it opens a link with a
//! disposition - but `WebView2` hands the host the address, whether a person asked,
//! the size a script wanted and the window name, and nothing else. So the answer is put
//! together here from what is to be had, in this order, on the window's own thread at
//! the moment the engine raises the request:
//!
//! 1. **The window name.** A press on a link says how it was made in the press itself -
//!    the button, and the keys held with it - so a small script in every page
//!    (`SCRIPT`) answers the middle button, a Ctrl+click and a Shift+click itself, and
//!    opens the link under a name that says where its tab goes. The press's own keys
//!    rather than the keyboard's, because they are the ones the page acted on: a press
//!    made by a tool that holds no key on the machine, and a key let go of before the
//!    engine asks, are both still the press they were. A site that opens a window under
//!    the same name gets a tab behind it, which is less than it could already do by
//!    asking for one in front. The script runs in nib's own world in the page, which
//!    shares the page's document and events and none of its globals, so the page can
//!    neither see it nor replace the `window.open` it calls; see `web_worlds.rs`.
//! 2. **The keys held.** Ctrl, and Shift, as the input this thread shares with the
//!    page's window has them, the same reading `web_keys.rs` makes - for a window the
//!    page's own script asks for in answer to a press, which is not a link the script
//!    above could see.
//! 3. **The page's own menu.** Its link row opens the link it was raised on, so a
//!    request for that address right after the menu is the menu's, and goes behind.
//!
//! What none of them says is the page's own request, which `web_tabs.rs` answers: a tab
//! in front, or for one that asked for a size - an OAuth sign-in, a share dialog - a
//! window of its own, so the page that opened it can still hear from it.
//!
//! **Find and the address field, the same way.** Chrome gives Ctrl+F, Ctrl+L and Alt+D
//! to the page first and answers them only when nothing in the page took the key, which
//! is what lets Google Docs, Notion and VS Code on the web keep their own find, and a
//! site its own Ctrl+L. The engine cannot say whether a page took a key - it offers the
//! host every Ctrl chord before the page has seen it; see `web_keys.rs` - so the same
//! script listens last, and asks for a window under one of four more names when the key
//! went by: `nib-find`, `nib-find-next`, `nib-find-previous` and `nib-address`. Those
//! are read here into a `Passed`, said to the window for this tab alone as
//! `nib://web-passed`, and never become a window, since `about:blank` is not an address
//! a tab may open. Any page can ask by those names, and all it can get is its own tab's
//! find opened or stepped through, or its own address field - which is what its keys
//! already get it. A name is never a command: there are eight, and nothing else is read.
//!
//! **A modifier tapped twice, the same way.** Shift pressed twice on its own opens nib's
//! palette wherever the keyboard is (see `lib/double-tap.ts`), and a page never tells
//! the host about a lone Shift: the engine offers the host a key only with Ctrl or Alt
//! held, and never Shift. So the script counts the taps itself, by the same rules, and
//! asks under `nib-twice-shift` (or `-ctrl`, `-alt`) when two came; the page keeps every
//! key, and a tap it answered itself does not count. A modifier grants a page no user
//! activation in Chromium, so this ask cannot lean on the engine saying a person asked;
//! it is taken instead when a key was really pressed a moment ago and this page has the
//! keyboard (`typing_here`), which is what keeps a page from opening the palette over
//! somebody typing anywhere else.
//!
//! **Ctrl+D, the same way, as a key.** Chrome bookmarks on it only when the page let it
//! go by - Google Sheets fills down with it, Figma and Excalidraw duplicate, VS Code on
//! the web selects the next one - and nib puts the tab down (Deselect tab). What it
//! means is the reader's own binding rather than an ask of the tab's, so it comes back
//! under an eighth name, `nib-ctrl-d`, and is said to the window as the key it was on
//! `web_keys.rs`'s own event: played there, it does whatever Ctrl+D does in the app,
//! which under the VS Code keyboard is nothing at all. Ctrl+Shift+D, every pane put
//! down at once, goes the same way under `nib-ctrl-shift-d`: Chrome's own is
//! Bookmark all tabs, which a page is offered first as well. Ctrl+Space and
//! Ctrl+Shift+Space, the space switcher's two keys, under `nib-ctrl-space` and
//! `nib-ctrl-shift-space`: no browser binds either, but Google Sheets selects a column
//! and everything with them, and Colab, Jupyter and VS Code on the web complete and show
//! a call's parameters, so a page that uses them keeps them. An input method that
//! toggles on Ctrl+Space takes it before the page does, and the page sees no space.
//!
//! **Ctrl+H and Ctrl+Shift+Delete, the same way.** Chrome's History and its Delete
//! browsing data are the page's first in Chrome too - Google Docs replaces on Ctrl+H - and
//! come back under `nib-ctrl-h` and `nib-ctrl-shift-delete` as the keys they were, which
//! the bar of the tab answers; see lib/web-tab/bar-keys.ts.
//!
//! **And Ctrl+0.** The engine's own Ctrl+0 goes back to the zoom the app last set rather
//! than to a hundred per cent (see `web_page.rs`), so it asks the same way, under
//! `nib-actual-size`, and the crate draws the page at a hundred per cent without taking
//! the keyboard out of it. All a page gets by asking is its own zoom reset.
//!
//! `WebView2`'s, and nib's own Chromium's, which hands the host no window name: there the
//! script asks through a function only nib's world has (`BINDING`). Elsewhere nothing is
//! known, and every tab a page asks for opens in front, as before.

use serde::Serialize;

use crate::web_keys::{Held, Pressed, PRESSED};

/// Where the tab a page asked for goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asked {
    /// Beside the page, which stays in front.
    Behind,
    /// Beside the page, and shown.
    Front,
}

/// The window names `SCRIPT` opens a link under.
const BEHIND: &str = "nib-behind";
const FRONT: &str = "nib-front";

/// And the ones it asks for nib's answer to a key the page let go by.
const FIND: &str = "nib-find";
const FIND_NEXT: &str = "nib-find-next";
const FIND_PREVIOUS: &str = "nib-find-previous";
const ADDRESS: &str = "nib-address";
/// And the chords it hands back as the keys they were.
const CTRL_D: &str = "nib-ctrl-d";
const CTRL_SHIFT_D: &str = "nib-ctrl-shift-d";
const CTRL_SPACE: &str = "nib-ctrl-space";
const CTRL_SHIFT_SPACE: &str = "nib-ctrl-shift-space";
const CTRL_H: &str = "nib-ctrl-h";
const CTRL_SHIFT_DELETE: &str = "nib-ctrl-shift-delete";

/// And the one Ctrl+0 asks for a hundred per cent by, which the crate answers itself.
const ACTUAL: &str = "nib-actual-size";

/// And the store's own install button, pressed on an extension's page; see `SCRIPT`.
const INSTALL: &str = "nib-install-extension";

/// And a modifier tapped twice on its own.
const TWICE_SHIFT: &str = "nib-twice-shift";
const TWICE_CTRL: &str = "nib-twice-ctrl";
const TWICE_ALT: &str = "nib-twice-alt";

/// The event the window hears those on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const PASSED: &str = "nib://web-passed";

/// A key the page let go by, as what it asks of nib: to open the find (Ctrl+F), to step
/// to the next match or the one before (Ctrl+G and F3, with Shift for the one before),
/// to go to the address field (Ctrl+L and Alt+D), or a modifier tapped twice. The whole
/// of what a page can say this way.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub enum Passed {
    Find,
    Next,
    Previous,
    Address,
    #[serde(rename = "shift-shift")]
    ShiftTwice,
    #[serde(rename = "ctrl-ctrl")]
    CtrlTwice,
    #[serde(rename = "alt-alt")]
    AltTwice,
    /// The store's own "Add to Chrome" or "Get", pressed: nib installs the extension the
    /// page is about (extensions.rs).
    Install,
}

impl Passed {
    /// Whether it is a modifier tapped twice, which no engine says a person asked for.
    #[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
    pub const fn is_tap(self) -> bool {
        matches!(self, Self::ShiftTwice | Self::CtrlTwice | Self::AltTwice)
    }
}

/// One page's ask, named by the tab it came from.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
struct Ask {
    tab: String,
    key: Passed,
}

/// Says a page's ask to its window, with the keyboard handed back to the app: the find
/// field and the address field are the window's, and so are the keys a hand presses
/// next.
///
/// `tab` is the tab whose page this was heard on, which the caller knows from where it
/// was listening; nothing the page says names it.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn passed(app: &tauri::AppHandle, window: &str, tab: &str, key: Passed) {
    let ask = Ask {
        tab: tab.to_string(),
        key,
    };
    told(app, window, PASSED, ask);
}

/// Says a chord the page let go by to its window, as the key it was; see the top of this
/// file.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn played(app: &tauri::AppHandle, window: &str, key: Pressed) {
    told(app, window, PRESSED, key);
}

/// The keyboard back to the app's own page, and the word said to it.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn told<S: Serialize + Clone>(app: &tauri::AppHandle, window: &str, event: &str, said: S) {
    use tauri::{Emitter, Manager};

    if let Some(ours) = app.get_webview(window) {
        crate::placement::keyboard_to(&ours);
    }
    let _ = app.emit_to(window, event, said);
}

/// The script in every page and every frame, in nib's own world there rather than the
/// page's: it adds no global, patches nothing, and a page that wraps `window.open`,
/// `addEventListener` or `Element.prototype.closest` wraps its own and not these. See
/// `web_worlds.rs`.
///
/// A link pressed for a tab of its own - the middle button, or the main one with Ctrl or
/// Shift held - opens as a window under a name that says where its tab goes, and the
/// engine is kept from opening it a second time: in front with Shift and behind without,
/// as in Chrome, read off the press. Only a press a person made, on a web address, that
/// the page itself has not already answered. Alt with the main button is the engine's
/// own download, and the Windows key is not a browser's, so both are left to the engine.
///
/// Ctrl+F, Ctrl+G and F3 (Shift for the one before), Ctrl+L, Alt+D, Ctrl+D, Ctrl+H,
/// Ctrl+Shift+Delete, and Ctrl+0 on the row or the number pad, that nothing in the page
/// took ask for nib's
/// answer by name, and are taken so the engine does not answer them too. By Windows' key
/// code, which is what the engine and Chrome read a chord by, so a layout whose letters
/// are not Latin still has them. Ctrl+Alt types a character on half the keyboards in
/// Europe, and is left alone.
///
/// All of them run last, after every handler the page has, so they see whether one of
/// them took the key or the press. Being on the window is not enough for that: the
/// page's own window handlers were put there after this script's, and a target's
/// handlers run in the order they were added - the probe caught a page's Ctrl+F
/// answered twice. So each press puts the answer back at the end of the window's list on
/// its way down, in the capturing turn, which is before the page's bubbling handlers run
/// and after they were added. The list is the document's and not a world's, so this
/// holds from nib's own world as it did from the page's. A page that stops the press on
/// its way up is left to the engine, whose own find then opens, as a browser's would.
///
/// A modifier tapped twice on its own asks by name as well, counted by the rules
/// `lib/double-tap.ts` keeps and waiting as long (`within`, which that file's test holds
/// to its own). The keys are watched on the capturing turn, before anything in the page
/// can stop one on its way, so a letter the page swallowed still ends a tap; and the
/// ask waits for the last release to have gone past the page, so a Shift the page took
/// for itself does not open anything.
///
/// And on a store's page for an extension, its own install button - "Add to Chrome" on
/// the Chrome Web Store, whose words always name Chrome, and Edge Add-ons' "Get", by its
/// id - is taken before the store's own script hears it, and asks under
/// `nib-install-extension`: neither engine installs from a store for a host, and nib does
/// (extensions.rs). All a page gets by asking is the store page it is on installed, which
/// the bar's own Add does too.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub const SCRIPT: &str = r"(function () {
  var open = window.open.bind(window)

  function last(type, answer) {
    function after(event) {
      removeEventListener(type, after)
      answer(event)
    }
    addEventListener(type, function () {
      removeEventListener(type, after)
      addEventListener(type, after)
    }, true)
  }

  function asked(event) {
    if (!event.isTrusted || event.defaultPrevented) return
    var link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null
    if (!link || typeof link.href !== 'string' || !/^https?:/i.test(link.href)) return
    event.preventDefault()
    open(link.href, event.shiftKey ? 'nib-front' : 'nib-behind')
  }

  last('auxclick', function (event) {
    if (event.button === 1) asked(event)
  })

  last('click', function (event) {
    var held = event.ctrlKey || event.shiftKey
    if (event.button === 0 && held && !event.altKey && !event.metaKey) asked(event)
  })

  last('keydown', function (event) {
    if (!event.isTrusted || event.defaultPrevented || event.metaKey) return
    var ctrl = event.ctrlKey
    var alt = event.altKey
    var back = event.shiftKey
    var code = event.keyCode
    var name = null
    if (ctrl && alt) return
    else if (alt) name = code === 68 && !back ? 'nib-address' : null
    else if (ctrl && code === 70 && !back) name = 'nib-find'
    else if (ctrl && code === 76 && !back) name = 'nib-address'
    else if (ctrl && (code === 48 || code === 96) && !back) name = 'nib-actual-size'
    else if (ctrl && code === 68) name = back ? 'nib-ctrl-shift-d' : 'nib-ctrl-d'
    else if (ctrl && code === 32) name = back ? 'nib-ctrl-shift-space' : 'nib-ctrl-space'
    else if (ctrl && code === 72 && !back) name = 'nib-ctrl-h'
    else if (ctrl && code === 46 && back) name = 'nib-ctrl-shift-delete'
    else if (ctrl && code === 71) name = back ? 'nib-find-previous' : 'nib-find-next'
    else if (!ctrl && code === 114) name = back ? 'nib-find-previous' : 'nib-find-next'
    if (!name) return
    event.preventDefault()
    open('about:blank', name)
  })

  var within = 350
  var twice = { Shift: 'nib-twice-shift', Control: 'nib-twice-ctrl', Alt: 'nib-twice-alt' }
  var down = null
  var tap = null
  var asking = null
  function broken() {
    down = null
    tap = null
  }
  function alone(event, key) {
    return (key === 'Shift' || !event.shiftKey) && (key === 'Control' || !event.ctrlKey) &&
      (key === 'Alt' || !event.altKey) && !event.metaKey
  }
  addEventListener('keydown', function (event) {
    if (!event.isTrusted || event.repeat) return
    if (event.isComposing || event.key === 'Process') return broken()
    if (twice[event.key] && down === null && alone(event, event.key)) {
      if (tap && event.timeStamp - tap.at > within) tap = null
      down = { key: event.key, at: event.timeStamp }
      return
    }
    broken()
  }, true)
  addEventListener('keyup', function (event) {
    asking = null
    if (!event.isTrusted) return
    if (!down || down.key !== event.key) return broken()
    var key = down.key
    var at = down.at
    down = null
    if (event.timeStamp - at > within) {
      tap = null
      return
    }
    var again = tap && tap.key === key && at - tap.at <= within
    if (again && tap.spent) {
      tap = { key: key, at: event.timeStamp, spent: true }
      return
    }
    tap = { key: key, at: event.timeStamp, spent: again }
    if (again) asking = key
  }, true)
  addEventListener('pointerdown', broken, true)
  addEventListener('wheel', broken, true)
  addEventListener('blur', function (event) {
    if (event.target === window) broken()
  }, true)
  last('keyup', function (event) {
    var key = asking
    asking = null
    if (key && !event.defaultPrevented) open('about:blank', twice[key])
  })
  var here = typeof location === 'object' ? location : null
  if (here && /^(chromewebstore\.google\.com|microsoftedge\.microsoft\.com)$/.test(here.hostname) &&
    /\/detail\//.test(here.pathname)) {
    addEventListener('click', function (event) {
      if (!event.isTrusted || event.button !== 0) return
      var button = event.target instanceof Element ? event.target.closest('button') : null
      if (!button) return
      var said = button.innerText || ''
      if (!/^getOrRemoveButton/.test(button.id) && !(/chrome/i.test(said) && !/enterprise/i.test(said))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      open('about:blank', 'nib-install-extension')
    }, true)
  }
})()";

/// Where the store's own install button is taken, in `SCRIPT`, and where that part ends.
const STORE_PART: &str = "  var here = typeof location";
const STORE_END: &str = "    }, true)\n  }\n";

/// `script` without the part that takes the store's own install button: nib's own
/// Chromium's, whose store installs for itself (extensions.rs). Pure, so it has a test.
#[cfg_attr(
    not(feature = "cef"),
    allow(dead_code, reason = "only nib's own Chromium leaves it out")
)]
fn without_store_button(script: &str) -> String {
    let Some(start) = script.find(STORE_PART) else {
        return script.to_owned();
    };
    let end = script[start..]
        .find(STORE_END)
        .map_or(start, |at| start + at + STORE_END.len());
    format!("{}{}", &script[..start], &script[end..])
}

/// The key a window asked for under `name` hands back, or `None`. Pure, and the only
/// reading of that name.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub fn chord(name: &str) -> Option<Pressed> {
    match name {
        CTRL_D => Some(Pressed::with_ctrl("d", "KeyD", false)),
        CTRL_SHIFT_D => Some(Pressed::with_ctrl("D", "KeyD", true)),
        CTRL_SPACE => Some(Pressed::with_ctrl(" ", "Space", false)),
        CTRL_SHIFT_SPACE => Some(Pressed::with_ctrl(" ", "Space", true)),
        CTRL_H => Some(Pressed::with_ctrl("h", "KeyH", false)),
        CTRL_SHIFT_DELETE => Some(Pressed::with_ctrl("Delete", "Delete", true)),
        _ => None,
    }
}

/// What a window asked for under `name` asks of nib, or `None` for a window. Pure, and
/// the only reading of those names.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub fn sought(name: &str) -> Option<Passed> {
    match name {
        FIND => Some(Passed::Find),
        FIND_NEXT => Some(Passed::Next),
        FIND_PREVIOUS => Some(Passed::Previous),
        ADDRESS => Some(Passed::Address),
        TWICE_SHIFT => Some(Passed::ShiftTwice),
        TWICE_CTRL => Some(Passed::CtrlTwice),
        TWICE_ALT => Some(Passed::AltTwice),
        INSTALL => Some(Passed::Install),
        _ => None,
    }
}

/// Whether a window asked for under `name` is Ctrl+0 that the page let go by. Pure, and
/// the only reading of that name.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn actual(name: &str) -> bool {
    name == ACTUAL
}

/// How long ago a key may have been pressed for a tap to be a person's: the second
/// release and the ask arriving here are a few milliseconds apart, and a second is the
/// widest a loaded machine could stretch that.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const LATELY_MS: u32 = 1000;

/// Whether an ask is one a person made. The engine says so for a key that grants the
/// page an activation; a modifier grants none, so a tap is taken when a key was
/// pressed `since` milliseconds ago, at most `LATELY_MS`, and this page has the
/// keyboard. Pure, so the rule has tests; the two facts are read in `typing_here`.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn taken_as_a_person_s(key: Passed, user: bool, since: u32, focused: bool) -> bool {
    user || (key.is_tap() && focused && since <= LATELY_MS)
}

/// What one request said, down to where its tab goes, or `None` for a request nobody
/// pressed anything for - the page's own, which `web_tabs.rs` answers.
///
/// `name` is the window name the page asked for; `user` whether the engine says a
/// person asked; `held` the keys held; `menu` whether the page's own menu was just
/// raised on this address. Pure, so the order above has tests.
#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
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

/// Starts listening on one page, under the tab it belongs to and in the window it is in.
/// Called on the window's thread, once, as the page is built.
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
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetFocus, GetKeyState, GetLastInputInfo, LASTINPUTINFO, VIRTUAL_KEY,
        VK_CONTROL, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::IsChild;
    use windows_core::Interface;

    use super::{actual, chord, passed, placed, played, sought, taken_as_a_person_s, Asked, Held};

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

    /// How long ago this machine last heard a key or the pointer, in milliseconds, and
    /// whether the keyboard is in the page under `host`: the two facts a double tap is
    /// taken on. The focus is asked of the input this thread shares with the page's
    /// window, the way `web_keys.rs` asks for a modifier.
    #[allow(
        unsafe_code,
        reason = "the last input and the window with the keyboard are Win32's to say"
    )]
    fn typing_here(host: HWND) -> (u32, bool) {
        let mut last = LASTINPUTINFO {
            cbSize: u32::try_from(std::mem::size_of::<LASTINPUTINFO>()).unwrap_or(8),
            dwTime: 0,
        };

        // Safe: both read state and take nothing but the struct they fill.
        unsafe {
            let since = if GetLastInputInfo(&raw mut last).as_bool() {
                GetTickCount().wrapping_sub(last.dwTime)
            } else {
                u32::MAX
            };
            let focus = GetFocus();
            let here = !focus.is_invalid() && (focus == host || IsChild(host, focus).as_bool());
            (since, here)
        }
    }

    #[allow(
        unsafe_code,
        reason = "a page asking for a window is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: tauri::AppHandle, tab: String, window: String) {
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

            // The window the page is drawn in, which the keyboard is inside while the
            // page has it. The controller hands it over in its own crate's type.
            let mut parent = windows_com::Win32::Foundation::HWND::default();
            let _ = webview.controller().ParentWindow(&raw mut parent);
            let host = HWND(parent.0);

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

                // A swipe over the page, said a frame at a time; see web_swipe.rs. Not a
                // press, so nothing is asked of who made it beyond what the script asked.
                if let Some(payload) = crate::web_swipe::named(&name) {
                    crate::web_swipe::heard(&app, &window, &asking, payload);
                    return Ok(());
                }
                // What the page's keys asked for, said to the window for this tab. The
                // engine's own answer - wry's, a turn later - denies the window, since
                // `about:blank` is not an address a tab may open. Only when a person
                // pressed something, so a page cannot take the keyboard from wherever
                // the reader is typing by asking on its own.
                if let Some(key) = sought(&name) {
                    let (since, focused) = typing_here(host);
                    if taken_as_a_person_s(key, user.as_bool(), since, focused) {
                        passed(&app, &window, &asking, key);
                    }
                    return Ok(());
                }
                // And the chord that goes back as the key it was, on the same terms.
                if let Some(key) = chord(&name) {
                    if user.as_bool() {
                        played(&app, &window, key);
                    }
                    return Ok(());
                }
                // The keyboard stays in the page: a zoom is not a reason to leave it.
                if actual(&name) {
                    if user.as_bool() {
                        crate::web_page::actual_size(&app, &window, &asking);
                    }
                    return Ok(());
                }

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

/// The name of the one function nib's world in a page has on nib's own Chromium: what
/// `SCRIPT` asks through there, in place of a window name. The engine's `DevTools`
/// protocol puts it in nib's world alone (`Runtime.addBinding` by the world's name), so
/// the page's own world never has it, and says each call to this app as
/// `Runtime.bindingCalled`, which nothing in a page can raise.
#[cfg(feature = "cef")]
pub const BINDING: &str = "nibAsked";

/// `SCRIPT` as nib's own Chromium runs it: the engine hands the host no window name, so
/// the script asks through `BINDING` instead, with the address and the name it would
/// have opened a window under - and through a window after all where the binding is not
/// there, which opens the link as a tab in front rather than not at all.
#[cfg(feature = "cef")]
pub fn script() -> String {
    without_store_button(SCRIPT).replacen(
        "var open = window.open.bind(window)",
        concat!(
            "var open = typeof nibAsked === 'function'",
            " ? function (url, name) { nibAsked(JSON.stringify([url, name])) }",
            " : window.open.bind(window)",
        ),
        1,
    )
}

/// What one call through `BINDING` asked, read as the window name `SCRIPT` names it
/// with: a tab of its own for a link, the find or the address field, a chord, or a tap.
/// Only ever raised for a press a person made (`isTrusted`), which is what a window
/// name's user flag says on `WebView2`.
#[cfg(feature = "cef")]
pub fn heard_on_chromium(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    let Ok((url, name)) = serde_json::from_str::<(String, String)>(payload) else {
        return;
    };
    if let Some(key) = sought(&name) {
        passed(app, window, tab, key);
        return;
    }
    if let Some(key) = chord(&name) {
        played(app, window, key);
        return;
    }
    if actual(&name) {
        crate::web_page::actual_size(app, window, tab);
        return;
    }
    if let Some(asked) = placed(&name, true, Held::default(), false) {
        crate::web_tabs::opened_beside(app, window, tab, &url, asked == Asked::Behind);
    }
}

/// Every other engine: nothing is known about a request, and every tab a page asks for
/// opens in front; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn taken(_tab: &str) -> Option<Asked> {
    None
}

#[cfg(test)]
mod tests {
    use super::{
        actual, chord, placed, sought, taken_as_a_person_s, Ask, Asked, Held, Passed, SCRIPT,
    };

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

    /// The one line nib's own Chromium swaps for its binding is there to swap: a script
    /// that no longer opened its windows through it would ask through nothing there.
    #[test]
    fn the_script_opens_its_windows_through_the_line_chromium_swaps() {
        assert_eq!(
            SCRIPT
                .matches("var open = window.open.bind(window)")
                .count(),
            1
        );
    }

    #[cfg(feature = "cef")]
    #[test]
    fn on_chromium_the_script_asks_through_the_binding_where_there_is_one() {
        let script = super::script();
        assert!(script.contains("typeof nibAsked === 'function'"));
        assert!(script.contains(super::BINDING));
        assert!(!script.contains("var open = window.open.bind(window)"));
    }

    #[test]
    fn the_script_names_the_window_for_a_press_on_a_link() {
        assert_eq!(placed("nib-behind", true, NONE, false), Some(Asked::Behind));
        assert_eq!(placed("nib-front", true, SHIFT, false), Some(Asked::Front));
    }

    #[test]
    fn the_press_s_own_keys_outrank_the_keyboard_s() {
        // A Ctrl+click the script named is behind even when the keyboard says Shift is
        // down by now, and a Shift+click in front with nothing held on the machine at
        // all - a press made by a tool, or a key let go of before the engine asked.
        assert_eq!(placed("nib-behind", true, BOTH, false), Some(Asked::Behind));
        assert_eq!(placed("nib-behind", true, SHIFT, true), Some(Asked::Behind));
        assert_eq!(placed("nib-front", true, NONE, false), Some(Asked::Front));
        assert_eq!(placed("nib-front", true, CTRL, true), Some(Asked::Front));
    }

    #[test]
    fn the_script_answers_the_middle_button_and_ctrl_or_shift_on_a_link() {
        // Three presses, one answer: the middle button on its `auxclick`, and the main
        // button with Ctrl or Shift on its `click` - without Alt, the engine's download,
        // or the Windows key.
        assert!(SCRIPT.contains("last('auxclick'"));
        assert!(SCRIPT.contains("last('click'"));
        assert!(SCRIPT.contains("event.ctrlKey || event.shiftKey"));
        assert!(SCRIPT.contains("!event.altKey && !event.metaKey"));
        for name in ["'nib-behind'", "'nib-front'"] {
            assert!(SCRIPT.contains(name), "{name}");
            assert!(
                placed(name.trim_matches('\''), true, NONE, false).is_some(),
                "{name}"
            );
        }
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

    #[test]
    fn eight_names_ask_for_nib_s_answer_and_nothing_else_does() {
        assert_eq!(sought("nib-find"), Some(Passed::Find));
        assert_eq!(sought("nib-find-next"), Some(Passed::Next));
        assert_eq!(sought("nib-find-previous"), Some(Passed::Previous));
        assert_eq!(sought("nib-address"), Some(Passed::Address));
        assert_eq!(sought("nib-twice-shift"), Some(Passed::ShiftTwice));
        assert_eq!(sought("nib-twice-ctrl"), Some(Passed::CtrlTwice));
        assert_eq!(sought("nib-twice-alt"), Some(Passed::AltTwice));
        assert_eq!(sought("nib-install-extension"), Some(Passed::Install));
        // A name is one of the eight exactly, or a window.
        for name in [
            "",
            "_blank",
            "nib-behind",
            "nib-front",
            "NIB-FIND",
            "nib-find ",
            "nib-find-all",
            "nib-twice-meta",
            "nib-twice",
        ] {
            assert_eq!(sought(name), None, "{name:?}");
        }
    }

    #[test]
    fn ctrl_d_let_go_by_goes_back_as_the_key_it_was() {
        let key = chord("nib-ctrl-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+D");
        assert_eq!(key["key"], "d");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["down"], true);

        // One name exactly, and none of the others is a key.
        for name in [
            "",
            "nib-find",
            "nib-address",
            "NIB-CTRL-D",
            "nib-ctrl-d ",
            "nib-ctrl-f",
        ] {
            assert!(chord(name).is_none(), "{name:?}");
        }
        // Nor is it an ask of the tab's or a window.
        assert_eq!(sought("nib-ctrl-d"), None);
    }

    #[test]
    fn ctrl_shift_d_let_go_by_goes_back_with_its_shift() {
        let key = chord("nib-ctrl-shift-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+Shift+D");
        assert_eq!(key["key"], "D");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["shift"], true);
        assert_eq!(key["down"], true);
        assert_eq!(sought("nib-ctrl-shift-d"), None);
        assert!(chord("nib-ctrl-shift-d ").is_none());
        // Asked with Shift held, and the plain one without.
        assert!(SCRIPT.contains("name = back ? 'nib-ctrl-shift-d' : 'nib-ctrl-d'"));
    }

    /// Chrome's History and Delete browsing data, which a page has first: back as the
    /// keys they were, the bar's to answer.
    #[test]
    fn ctrl_h_and_ctrl_shift_delete_let_go_by_go_back_as_the_keys_they_were() {
        let history = chord("nib-ctrl-h").map(|one| serde_json::to_value(one).expect("a key"));
        let history = history.expect("Ctrl+H");
        assert_eq!(history["key"], "h");
        assert_eq!(history["code"], "KeyH");
        assert_eq!(history["ctrl"], true);
        assert_eq!(history["shift"], false);

        let clear =
            chord("nib-ctrl-shift-delete").map(|one| serde_json::to_value(one).expect("a key"));
        let clear = clear.expect("Ctrl+Shift+Delete");
        assert_eq!(clear["key"], "Delete");
        assert_eq!(clear["code"], "Delete");
        assert_eq!(clear["ctrl"], true);
        assert_eq!(clear["shift"], true);

        assert_eq!(sought("nib-ctrl-h"), None);
        assert!(chord("nib-ctrl-delete").is_none());
        assert!(
            SCRIPT.contains("else if (ctrl && code === 46 && back) name = 'nib-ctrl-shift-delete'")
        );
    }

    #[test]
    fn ctrl_space_let_go_by_goes_back_as_the_space_switcher() {
        for (name, shift) in [("nib-ctrl-space", false), ("nib-ctrl-shift-space", true)] {
            let key = chord(name).map(|one| serde_json::to_value(one).expect("a key"));
            let key = key.expect(name);
            assert_eq!(key["key"], " ");
            assert_eq!(key["code"], "Space");
            assert_eq!(key["ctrl"], true);
            assert_eq!(key["shift"], shift);
            assert_eq!(key["alt"], false);
            assert_eq!(key["down"], true);
            assert_eq!(sought(name), None);
        }
        assert!(chord("nib-alt-space").is_none());
        // Asked only once the page let it go by, as every key here is: Sheets and Colab
        // keep theirs.
        assert!(SCRIPT.contains(
            "else if (ctrl && code === 32) name = back ? 'nib-ctrl-shift-space' : 'nib-ctrl-space'"
        ));
    }

    #[test]
    fn the_script_asks_by_the_names_read_here() {
        for name in [
            "'nib-find'",
            "'nib-find-next'",
            "'nib-find-previous'",
            "'nib-address'",
            "'nib-actual-size'",
            "'nib-twice-shift'",
            "'nib-twice-ctrl'",
            "'nib-twice-alt'",
            "'nib-ctrl-d'",
            "'nib-ctrl-shift-d'",
            "'nib-install-extension'",
            "'nib-ctrl-space'",
            "'nib-ctrl-shift-space'",
            "'nib-ctrl-h'",
            "'nib-ctrl-shift-delete'",
        ] {
            assert!(SCRIPT.contains(name), "{name}");
        }
    }

    /// On nib's own Chromium the store's own button installs, so nothing takes it there;
    /// everything else in the script is the same.
    #[test]
    fn chromium_leaves_the_store_s_button_to_the_store() {
        let left = super::without_store_button(SCRIPT);
        assert!(!left.contains("nib-install-extension"));
        assert!(!left.contains("chromewebstore"));
        assert!(left.contains("'nib-ctrl-d'") && left.contains("'nib-twice-shift'"));
        assert!(left.trim_end().ends_with("})()"));
        assert_eq!(
            SCRIPT.len() - left.len(),
            SCRIPT.find(super::STORE_PART).map_or(0, |start| {
                SCRIPT[start..]
                    .find(super::STORE_END)
                    .expect("the part ends")
                    + super::STORE_END.len()
            })
        );
    }

    /// Ctrl+0 is answered in the crate and never reaches the window as an ask, since the
    /// keyboard stays in the page; and no window of that name is ever a tab.
    #[test]
    fn ctrl_0_asks_by_a_name_of_its_own() {
        assert!(actual("nib-actual-size"));
        assert_eq!(sought("nib-actual-size"), None);
        assert_eq!(placed("nib-actual-size", true, NONE, false), None);
        for name in ["", "nib-find", "nib-actual", "NIB-ACTUAL-SIZE", "_blank"] {
            assert!(!actual(name), "{name:?}");
        }
        // The key on the row and on the number pad, with Ctrl and without Shift.
        assert!(SCRIPT.contains("ctrl && (code === 48 || code === 96) && !back"));
    }

    #[test]
    fn a_tap_is_a_person_s_when_a_key_just_went_and_the_page_has_the_keyboard() {
        let tap = Passed::ShiftTwice;
        assert!(taken_as_a_person_s(tap, false, 40, true));
        // Too long ago, or the keyboard is somewhere else: a page asking on its own.
        assert!(!taken_as_a_person_s(tap, false, 5000, true));
        assert!(!taken_as_a_person_s(tap, false, 40, false));
        // The engine's word is enough for anything.
        assert!(taken_as_a_person_s(tap, true, u32::MAX, false));
    }

    #[test]
    fn the_other_asks_still_want_the_engine_s_word() {
        assert!(!taken_as_a_person_s(Passed::Find, false, 40, true));
        assert!(taken_as_a_person_s(Passed::Address, true, 40, false));
    }

    #[test]
    fn an_ask_reaches_the_window_as_one_of_eight_words_for_its_tab() {
        let said = |key| {
            serde_json::to_value(Ask {
                tab: "t1".into(),
                key,
            })
            .expect("an ask")
        };
        assert_eq!(said(Passed::Find)["key"], "find");
        assert_eq!(said(Passed::Next)["key"], "next");
        assert_eq!(said(Passed::Previous)["key"], "previous");
        assert_eq!(said(Passed::Address)["key"], "address");
        assert_eq!(said(Passed::ShiftTwice)["key"], "shift-shift");
        assert_eq!(said(Passed::CtrlTwice)["key"], "ctrl-ctrl");
        assert_eq!(said(Passed::AltTwice)["key"], "alt-alt");
        assert_eq!(said(Passed::Install)["key"], "install");
        assert_eq!(said(Passed::Find)["tab"], "t1");
    }
}
