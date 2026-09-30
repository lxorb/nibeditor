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
//! anywhere else. On a Mac the store is the data store's own `WKHTTPCookieStore`, where
//! a cookie is a set of properties that can be read, given an expiry and written back.
//! There a session cookie lives only in the network process's memory: a lasting one
//! is written to the data store on disk and comes back on the next launch, a session
//! one is simply gone. `WebKitGTK` has a store of its own that wry hands nothing of
//! out; there a lasting cookie survives a restart and a session one does not, which
//! docs/web-tabs.md says out loud.
//!
//! On Windows the store is reached through the `DevTools` Protocol - every cookie out of
//! `Network.getAllCookies`, each session one back through `Network.setCookie` - and not
//! through `ICoreWebView2CookieManager`, the COM manager nib used first. That one knows
//! nothing of partitions (CHIPS): a partitioned cookie, which its site may read only
//! under the one top-level site it was set under, came back from it as an unpartitioned
//! copy that the site could read under every other. The protocol hands a cookie over
//! with its partition and takes it back with it, so a partitioned login lasts too, and
//! stays in its partition. `twins.rs` finds the copies the COM manager left, and each
//! keep takes away any there are.

#[cfg(windows)]
use crate::web_state::cookies::Cookie;

#[cfg(windows)]
mod twins;

/// Makes every session cookie in the profile this webview is on last, and says so
/// through `done` - once, whether it could or not. Returns at once; the engine
/// answers later, on the window's own thread.
///
/// Every cookie of the profile rather than the page's own, because a sign-in is
/// several sites: the identity provider's session is set on a page that has already
/// been left by the time the one after it loads. Called on the window's own thread,
/// which is the only thread the engine's objects may be touched from, so every call
/// is one the engine answers later rather than one this waits on.
#[cfg(windows)]
pub fn keep(webview: &tauri::webview::PlatformWebview, done: impl FnOnce() + 'static) {
    use std::cell::Cell;
    use std::rc::Rc;

    use serde_json::json;

    use crate::agents::cdp;
    use crate::web_state::cookies::{engine::cookies_in, now};

    let Some(core) = cdp::core_of(webview) else {
        done();
        return;
    };
    let asking = core.clone();
    cdp::ask(&core, "Network.getAllCookies", &json!({}), move |answer| {
        // Nothing to tell anybody where the store could not be read: it is read again
        // after the next page, and signing in once more is the worst of it.
        let calls = answer
            .map(|said| asks(&cookies_in(&said), now()))
            .unwrap_or_default();
        if calls.is_empty() {
            done();
            return;
        }

        // One count per call, down as each is answered, whatever the answer; the last
        // one says so.
        let left = Rc::new(Cell::new(calls.len()));
        let done = Rc::new(Cell::new(Some(Box::new(done) as Box<dyn FnOnce()>)));
        for (method, params) in calls {
            let (left, done) = (left.clone(), done.clone());
            cdp::ask(&asking, method, &params, move |_| {
                left.set(left.get().saturating_sub(1));
                if left.get() == 0 {
                    if let Some(said) = done.take() {
                        said();
                    }
                }
            });
        }
    });
}

/// What keeping a store's logins asks the engine for, given every cookie in it: each
/// twin an earlier nib made taken away, then each session cookie written back as it is -
/// its partition first of all - with an expiry four hundred days out.
///
/// One `setCookie` a cookie rather than one `setCookies` for them all, because the
/// engine refuses a whole list over one cookie in it that it will not take, and one it
/// will not take is no reason for every other login to end with the session.
#[cfg(windows)]
fn asks(all: &[Cookie], now: f64) -> Vec<(&'static str, serde_json::Value)> {
    use crate::web_state::cookies::engine::{deleting, to_devtools};

    let taken = twins::of(all).map(|twin| ("Network.deleteCookies", deleting(twin)));
    let kept = all
        .iter()
        .filter(|one| one.expires.is_none())
        .map(|one| ("Network.setCookie", to_devtools(one, now)));
    taken.chain(kept).collect()
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
    use objc2_foundation::{NSArray, NSHTTPCookie};
    use objc2_web_kit::WKWebView;

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

/// The cookie again, lasting: its own properties, with a lifetime and without the
/// discard that would end it with the session anyway.
///
/// The discard is taken out rather than said as no. The engine hands a session
/// cookie over with `Discard` set, and on macOS 26 a cookie made from properties that
/// hold the key at all is session-only, "FALSE" included - so every cookie this wrote
/// back was the same session cookie again, and a login lasted only as long as a quit
/// with the page still open happened to keep it. Without the key, an expiry makes the
/// Netscape kind nearly every site sets last, and a maximum age the RFC 2965 kind,
/// which is the one that would otherwise default to being discarded.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "a cookie's properties are a dictionary whose values the type system does not check"
)]
fn lasting(
    cookie: &objc2_foundation::NSHTTPCookie,
) -> Option<objc2::rc::Retained<objc2_foundation::NSHTTPCookie>> {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{
        NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieExpires, NSHTTPCookieMaximumAge,
        NSMutableCopying as _, NSString,
    };

    use crate::web_state::cookies::KEPT_FOR;

    let properties = cookie.properties()?.mutableCopy();
    let until = NSDate::dateWithTimeIntervalSinceNow(KEPT_FOR);
    // SAFETY: every key is `NSHTTPCookie`'s own and every value is the type the key
    // takes: a date for the expiry, strings for the maximum age and `HttpOnly`.
    unsafe {
        properties.insert(NSHTTPCookieExpires, until.as_ref() as &AnyObject);
        properties.insert(
            NSHTTPCookieMaximumAge,
            NSString::from_str(&format!("{KEPT_FOR:.0}")).as_ref() as &AnyObject,
        );
        properties.removeObjectForKey(NSHTTPCookieDiscard);
        if cookie.isHTTPOnly() {
            properties.insert(
                &*NSString::from_str("HttpOnly"),
                NSString::from_str("TRUE").as_ref() as &AnyObject,
            );
        }
        NSHTTPCookie::cookieWithProperties(&properties)
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
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    if pages(window).is_empty() {
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

    let closing = window.clone();
    kept(window, move || {
        let _ = closing.close();
    });
}

/// The window's web tabs, which are the pages whose logins are worth keeping.
fn pages(window: &tauri::Window) -> Vec<tauri::Webview> {
    window
        .webviews()
        .into_iter()
        .filter(|one| crate::web_tabs::is_page(one.label()))
        .collect()
}

/// Makes the logins of every web tab in a window last, then calls `then` - once,
/// whether the engine answered or not. At once for a window with no web tab in it.
///
/// What closing a window does through `leaving`, and what quitting does for each
/// window before asking it to go (see `quit` in lifecycle.rs): a quit ends a window
/// without the close request `leaving` hears, so it has to ask for this itself.
pub fn kept(window: &tauri::Window, then: impl FnOnce() + Send + 'static) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    type Then = Mutex<Option<Box<dyn FnOnce() + Send>>>;

    let pages = pages(window);
    if pages.is_empty() {
        then();
        return;
    }

    // Held in one place and taken by whichever comes first: the last page's answer,
    // or the patience running out.
    let then: Arc<Then> = Arc::new(Mutex::new(Some(Box::new(then))));
    let go = move |then: &Then| {
        let taken = then.lock().ok().and_then(|mut then| then.take());
        if let Some(then) = taken {
            then();
        }
    };

    // One count per page, down as each is answered; the last answer goes on.
    let left = Arc::new(AtomicUsize::new(pages.len()));
    for page in pages {
        let (waiting, going) = (left.clone(), then.clone());
        let asked = page.with_webview(move |platform| {
            keep(&platform, move || {
                if waiting.fetch_sub(1, Ordering::SeqCst) == 1 {
                    go(&going);
                }
            });
        });
        if asked.is_err() && left.fetch_sub(1, Ordering::SeqCst) == 1 {
            go(&then);
        }
    }

    // And on regardless, a moment later, should the engine never answer. A quit that
    // hangs on a cookie store is worse than one sign-in more.
    std::thread::spawn(move || {
        std::thread::sleep(PATIENCE);
        go(&then);
    });
}

#[cfg(test)]
mod tests {
    use crate::web_state::cookies::{now, KEPT_FOR};

    /// Four hundred days, and from now rather than from some fixed day: a cookie made
    /// to last today is not one that has already run out.
    #[test]
    fn a_session_cookie_is_kept_for_four_hundred_days_from_now() {
        assert!((KEPT_FOR - 34_560_000.0).abs() < f64::EPSILON);
        assert!(now() > 1_700_000_000.0, "the clock reads a real day");
    }

    /// A widget's partitioned session cookie is written back in its partition, and no
    /// call keeping a store's logins ever writes it without one: the COM manager's
    /// copy, readable under every site, is what this replaced. A first-party session
    /// cookie lasts as before, and a lasting cookie is left alone.
    #[cfg(windows)]
    #[test]
    fn a_partitioned_session_cookie_is_kept_in_its_partition() {
        use super::twins::tests::cookie;

        let all = [
            cookie("part", Some("https://news.example"), None),
            cookie("sid", None, None),
            cookie("pid", None, Some(1_900_000_000.0)),
        ];
        let calls = super::asks(&all, 1000.0);

        assert_eq!(calls.len(), 2, "{calls:?}");
        assert!(calls
            .iter()
            .all(|(method, _)| *method == "Network.setCookie"));
        let (_, part) = &calls[0];
        assert_eq!(part["name"], "part");
        assert_eq!(part["partitionKey"]["topLevelSite"], "https://news.example");
        assert_eq!(part["partitionKey"]["hasCrossSiteAncestor"], true);
        assert_eq!(part["expires"], 1000.0 + KEPT_FOR);
        assert_eq!(part["secure"], true);
        let (_, sid) = &calls[1];
        assert_eq!(sid["name"], "sid");
        assert!(sid.get("partitionKey").is_none());
        assert_eq!(sid["expires"], 1000.0 + KEPT_FOR);
    }

    /// A store the COM manager kept: the partitioned session cookie, and its copy with no
    /// partition. The copy is taken away - asked for without a partition, which is the
    /// engine's way of naming only the unpartitioned one - and the partitioned one is
    /// written back in its partition, never deleted.
    #[cfg(windows)]
    #[test]
    fn a_twin_is_taken_away_and_the_partitioned_cookie_kept() {
        use super::twins::tests::cookie;

        let all = [
            cookie("part", Some("https://news.example"), None),
            cookie("part", None, Some(1_790_700_000.0 + KEPT_FOR)),
        ];
        let calls = super::asks(&all, 1000.0);

        assert_eq!(calls.len(), 2, "{calls:?}");
        let (method, taken) = &calls[0];
        assert_eq!(*method, "Network.deleteCookies");
        assert_eq!(taken["name"], "part");
        assert_eq!(taken["domain"], "widget.example");
        assert_eq!(taken["path"], "/");
        assert!(taken.get("partitionKey").is_none());
        let (method, kept) = &calls[1];
        assert_eq!(*method, "Network.setCookie");
        assert_eq!(kept["partitionKey"]["topLevelSite"], "https://news.example");
    }

    /// A session cookie the way the engine hands one over, with `Discard` set, of
    /// either version: what comes back lasts, and for about four hundred days.
    #[cfg(target_os = "macos")]
    #[test]
    #[allow(
        unsafe_code,
        reason = "a cookie's properties are a dictionary whose values the type system does not check"
    )]
    fn a_session_cookie_is_made_again_as_one_that_lasts() {
        use objc2::runtime::AnyObject;
        use objc2_foundation::{
            NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain, NSHTTPCookieName,
            NSHTTPCookiePath, NSHTTPCookieValue, NSHTTPCookieVersion, NSMutableDictionary,
            NSString,
        };

        for version in ["0", "1"] {
            let properties = NSMutableDictionary::<NSString, AnyObject>::new();
            // SAFETY: every key is `NSHTTPCookie`'s own, and every value a string.
            let session = unsafe {
                for (key, value) in [
                    (NSHTTPCookieName, "sessionid"),
                    (NSHTTPCookieValue, "1"),
                    (NSHTTPCookieDomain, "example.org"),
                    (NSHTTPCookiePath, "/"),
                    (NSHTTPCookieVersion, version),
                    (NSHTTPCookieDiscard, "TRUE"),
                ] {
                    properties.insert(key, NSString::from_str(value).as_ref() as &AnyObject);
                }
                NSHTTPCookie::cookieWithProperties(&properties).expect("a cookie")
            };
            assert!(
                session.isSessionOnly(),
                "version {version} starts as a session cookie"
            );

            let kept = super::lasting(&session).expect("made again");
            assert!(
                !kept.isSessionOnly(),
                "version {version} still ends with the session"
            );
            let left = kept
                .expiresDate()
                .map(|until| until.timeIntervalSinceDate(&NSDate::now()))
                .expect("an expiry");
            assert!(
                (left - KEPT_FOR).abs() < 60.0,
                "version {version} lasts {left} seconds"
            );
            assert_eq!(kept.name().to_string(), "sessionid");
        }
    }
}
