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
//! `WebView2` and `WKWebView`, and only the system's engines: this module is not built
//! anywhere else. The design is the same on both, because both hand out the profile's
//! own cookie store - `ICoreWebView2CookieManager` on Windows, the data store's
//! `WKHTTPCookieStore` on a Mac - and in both a cookie is a set of properties that can
//! be read, given an expiry and written back. On a Mac a session cookie lives only in
//! the network process's memory: a lasting one is written to the data store on disk
//! and comes back on the next launch, a session one is simply gone. `WebKitGTK` has a
//! store of its own that wry hands nothing of out; there a lasting cookie survives a
//! restart and a session one does not, which docs/web-tabs.md says out loud.

use std::time::{SystemTime, UNIX_EPOCH};

/// How long a session cookie is kept once it has been made to last, in seconds: four
/// hundred days, which is the longest Chrome lets any cookie live. Long enough that
/// nobody is signed out by it, and a cookie the site sets again starts a new four
/// hundred days rather than being stretched for ever.
const KEPT_FOR: f64 = 400.0 * 24.0 * 60.0 * 60.0;

/// The expiry a session cookie is given at `now`, both in seconds since 1970, which
/// is what the engine's own cookie object takes.
#[cfg_attr(
    target_os = "macos",
    allow(dead_code, reason = "a Mac's own date counts from now")
)]
fn kept_until(now: f64) -> f64 {
    now + KEPT_FOR
}

/// Now, in the engine's own unit.
#[cfg_attr(
    target_os = "macos",
    allow(dead_code, reason = "a Mac's own date counts from now")
)]
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
#[cfg(windows)]
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

/// Makes every session cookie in the data store this webview is on last, and says so
/// through `done` - once, whether it could or not. The same promise as the Windows one
/// above, kept with `WKHTTPCookieStore`: every cookie of the store is read, and each
/// one that would end with the session is written back with an expiry.
///
/// A cookie is read as its properties and made again from them, which is the one way
/// `NSHTTPCookie` has of changing anything about a cookie. `HttpOnly` is not one of the
/// documented keys, so it is written back by name where the cookie had it: a cookie a
/// page's script could not read before is not one it can read after.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "the cookie store is reached through WKWebView's Objective-C interface, from the pointer wry hands out"
)]
pub fn keep(webview: &tauri::webview::PlatformWebview, done: impl FnOnce() + 'static) {
    use std::cell::Cell;
    use std::ptr::NonNull;
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{
        NSArray, NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieExpires,
        NSHTTPCookieMaximumAge, NSMutableCopying as _, NSString,
    };
    use objc2_web_kit::WKWebView;

    /// The cookie again, lasting: its own properties, with a lifetime and without the
    /// discard that would end it with the session anyway.
    fn lasting(cookie: &NSHTTPCookie) -> Option<Retained<NSHTTPCookie>> {
        let properties = cookie.properties()?.mutableCopy();
        let until = NSDate::dateWithTimeIntervalSinceNow(KEPT_FOR);
        // SAFETY: every key is `NSHTTPCookie`'s own and every value is the type the key
        // takes: a date for the expiry, strings for the maximum age, the discard and
        // `HttpOnly`.
        unsafe {
            // Both kinds of lifetime, because `NSHTTPCookie` reads one or the other by
            // the cookie's version - an expiry for the Netscape kind nearly every site
            // sets, a maximum age for the RFC 2965 kind - and ignores the one that is not
            // its own. And a discard said outright as no, because an RFC 2965 cookie with
            // none said is taken to be discarded with the session.
            properties.insert(NSHTTPCookieExpires, until.as_ref() as &AnyObject);
            properties.insert(
                NSHTTPCookieMaximumAge,
                NSString::from_str(&format!("{KEPT_FOR:.0}")).as_ref() as &AnyObject,
            );
            properties.insert(
                NSHTTPCookieDiscard,
                NSString::from_str("FALSE").as_ref() as &AnyObject,
            );
            if cookie.isHTTPOnly() {
                properties.insert(
                    &*NSString::from_str("HttpOnly"),
                    NSString::from_str("TRUE").as_ref() as &AnyObject,
                );
            }
            NSHTTPCookie::cookieWithProperties(&properties)
        }
    }

    type Said = Rc<Cell<Option<Box<dyn FnOnce()>>>>;
    fn say(done: &Said) {
        if let Some(said) = done.take() {
            said();
        }
    }

    let done: Said = Rc::new(Cell::new(Some(Box::new(done) as Box<dyn FnOnce()>)));

    // SAFETY: the pointer is the WKWebView wry built for this page, alive for as long
    // as the page is, and retaining it keeps it so while the store is asked; this runs
    // on the main thread, where it belongs.
    let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
        say(&done);
        return;
    };

    // SAFETY: reading the webview's own configuration on its own thread.
    let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
    let writing = store.clone();
    let answered = done.clone();

    let handler = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
        // SAFETY: the engine hands this block an array that is alive for its length.
        let cookies = unsafe { cookies.as_ref() };
        let kept: Vec<_> = cookies
            .iter()
            .filter(|cookie| cookie.isSessionOnly())
            .filter_map(|cookie| lasting(&cookie))
            .collect();

        if kept.is_empty() {
            say(&answered);
            return;
        }

        // One count per cookie, down as each is stored; the last one says so.
        let left = Rc::new(Cell::new(kept.len()));
        for cookie in kept {
            let (left, answered) = (left.clone(), answered.clone());
            let stored = RcBlock::new(move || {
                left.set(left.get().saturating_sub(1));
                if left.get() == 0 {
                    say(&answered);
                }
            });
            // SAFETY: the store is the webview's own and is used on its own thread;
            // the block is copied by the engine and outlives the call.
            unsafe { writing.setCookie_completionHandler(&cookie, Some(&stored)) };
        }
    });

    // SAFETY: as above; the engine copies the block and calls it once, on this thread.
    unsafe { store.getAllCookies(&handler) };
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
