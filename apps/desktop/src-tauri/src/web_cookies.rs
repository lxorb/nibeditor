//! Keeps a web tab's login across a restart, the way a browser that continues where
//! it left off does.
//!
//! Emil, 2026-09-27: *"on moodle-app2.let.ethz.ch every time i reopen nib I have to
//! reloggin."* The `web` folder was always the same one and everything a site keeps
//! on disk came back - a lasting cookie, `localStorage`, `IndexedDB`. What did not was
//! a **session cookie**: one with no expiry, which is what a great many logins are.
//! Moodle's `MoodleSession`, Shibboleth's `_shibsession_...` and the identity
//! provider's own session at `aai-logon.ethz.ch` are all of that kind, so a restart
//! signed the reader out of all three at once.
//!
//! Chrome keeps them when "Continue where you left off" is on, and only then. The
//! `WebView2` behind a web tab has no such setting to turn on, and the switch that asks
//! Chromium for the same thing from the command line, `--restore-last-session`, was
//! measured and is not enough: the engine writes the cookies to disk under it, but a
//! quit that closes the pages first still ends the session and deletes them - on some
//! quits and not others, depending on whether the pages or the process went first.
//! A login that is kept on three restarts out of five is a login that is not kept.
//!
//! So nib does what the setting does, with the engine's own cookie store rather than
//! a file of its own: a cookie that would end with the session is given an expiry
//! instead, in the profile's own cookie database, where the engine keeps and reloads
//! it like any other. The site never sees the difference - an expiry is not sent with
//! a cookie - and it keeps every say it had: a new value replaces this one, a logout
//! deletes it. Twice: whenever a page in a tab has loaded, which is after every step
//! of a sign-in that goes through pages, and as the window closes, which catches a
//! login a page made without loading another one.
//!
//! `WebView2` only, and only the system's: this module is not built anywhere else.
//! `WKWebView` and `WebKitGTK` have cookie stores of their own that wry hands nothing
//! of out; on those a lasting cookie survives a restart and a session one does not,
//! which docs/web-tabs.md says out loud.

use std::time::{SystemTime, UNIX_EPOCH};

/// How long a session cookie is kept once it has been made to last, in seconds: four
/// hundred days, which is the longest Chrome lets any cookie live. Long enough that
/// nobody is signed out by it, and a cookie the site sets again starts a new four
/// hundred days rather than being stretched for ever.
const KEPT_FOR: f64 = 400.0 * 24.0 * 60.0 * 60.0;

/// The expiry a session cookie is given at `now`, both in seconds since 1970, which
/// is what the engine's own cookie object takes.
fn kept_until(now: f64) -> f64 {
    now + KEPT_FOR
}

/// Now, in the engine's own unit.
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |since| since.as_secs_f64())
}

/// Makes every session cookie in the profile this webview is on last, and says so
/// through `done` - once, whether it could or not. Returns at once; the engine
/// answers later, on the window's own thread.
///
/// Every cookie of the profile rather than the page's own, because a sign-in is
/// several sites: the identity provider's session is set on a page that has already
/// been left by the time the one after it loads. Called on the window's own thread,
/// which is the only thread the engine's objects may be touched from.
#[allow(
    unsafe_code,
    reason = "the cookie store is reached through WebView2's COM interfaces, which have no safe wrapper"
)]
pub fn keep(webview: &tauri::webview::PlatformWebview, done: impl FnOnce() + 'static) {
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows_core::{Interface as _, BOOL};

    // Held in one place and taken by whichever of the two ends first: the engine's
    // answer, or the call itself failing, in which case there is no answer coming.
    let done = std::rc::Rc::new(std::cell::Cell::new(Some(
        Box::new(done) as Box<dyn FnOnce()>
    )));
    let answered = done.clone();

    // Safe: the controller comes from a webview this window owns, the manager is held
    // by the closure until the engine has answered, and every call is on this thread.
    let asked = unsafe {
        (|| -> windows_core::Result<()> {
            let manager = webview
                .controller()
                .CoreWebView2()?
                .cast::<ICoreWebView2_2>()?
                .CookieManager()?;
            let store = manager.clone();

            let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                let said = answered.take();
                let kept = (|| {
                    result?;
                    let Some(list) = list else {
                        return Ok(());
                    };

                    let until = kept_until(now());
                    let mut count = 0u32;
                    list.Count(&raw mut count)?;
                    for index in 0..count {
                        let cookie = list.GetValueAtIndex(index)?;
                        let mut session = BOOL::default();
                        cookie.IsSession(&raw mut session)?;
                        if session.as_bool() {
                            cookie.SetExpires(until)?;
                            store.AddOrUpdateCookie(&cookie)?;
                        }
                    }
                    Ok(())
                })();
                if let Some(said) = said {
                    said();
                }
                kept
            }));

            // An empty address is the engine's own way of asking for every cookie of
            // the profile.
            manager.GetCookies(windows_core::w!(""), &handler)
        })()
    };

    // Nothing to tell anybody: a profile whose cookies could not be read this time is
    // read again after the next page, and signing in once more is the worst of it.
    if asked.is_err() {
        if let Some(said) = done.take() {
            said();
        }
    }
}

/// How long the window waits for the engine before it closes anyway. A quit that
/// hangs on a cookie store is worse than one sign-in more.
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(2);

/// The windows that have been through `leaving` once and may now close.
static LEAVING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Holds a window that shows web tabs open until their logins have been made to last,
/// then closes it.
///
/// **Before** the pages close, because the pages closing is what ends the session:
/// once the last one on the profile is gone, a session cookie is gone with it. A
/// window with no web tab in it closes at once, and nothing here runs at all; so does
/// the second request, which is this closing it.
pub fn leaving(window: &tauri::Window, event: &tauri::WindowEvent) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    let pages: Vec<_> = window
        .webviews()
        .into_iter()
        .filter(|one| crate::web_tabs::is_page(one.label()))
        .collect();
    if pages.is_empty() {
        return;
    }

    let label = window.label().to_string();
    {
        let Ok(mut leaving) = LEAVING.lock() else {
            return;
        };
        if let Some(at) = leaving.iter().position(|one| *one == label) {
            leaving.remove(at);
            return;
        }
        leaving.push(label);
    }

    api.prevent_close();

    let close = {
        let window = window.clone();
        move || {
            let _ = window.close();
        }
    };

    // One count per page, down as each is answered; the last answer closes the window.
    let left = Arc::new(AtomicUsize::new(pages.len()));
    let answered = move |left: &AtomicUsize, close: &dyn Fn()| {
        if left.fetch_sub(1, Ordering::SeqCst) == 1 {
            close();
        }
    };

    for page in pages {
        let (waiting, closing) = (left.clone(), close.clone());
        let asked = page.with_webview(move |platform| {
            keep(&platform, move || answered(&waiting, &closing));
        });
        if asked.is_err() {
            answered(&left, &close);
        }
    }

    // And closed regardless, a moment later, should the engine never answer. Only if
    // it is still waiting: a window already closed is not closed twice.
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PATIENCE);
        let waiting = window.label().to_string();
        let still = LEAVING
            .lock()
            .is_ok_and(|leaving| leaving.contains(&waiting));
        if still {
            let _ = window.close();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{kept_until, now, KEPT_FOR};

    /// Four hundred days, and from now rather than from some fixed day: a cookie made
    /// to last today is not one that has already run out.
    #[test]
    fn a_session_cookie_is_kept_for_four_hundred_days_from_now() {
        assert!((KEPT_FOR - 34_560_000.0).abs() < f64::EPSILON);

        let at = now();
        assert!(at > 1_700_000_000.0, "the clock reads a real day");
        assert!((kept_until(at) - at - KEPT_FOR).abs() < 1.0);
    }
}
