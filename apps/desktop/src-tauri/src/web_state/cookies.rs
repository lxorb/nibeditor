//! A site's cookies, out of a web store and into another, through each engine's own
//! cookie store: never the cookie database on disk, which is encrypted to the machine.
//!
//! | engine | out | in |
//! | --- | --- | --- |
//! | `WebView2` | `Network.getAllCookies` over the `DevTools` Protocol, which keeps `partitionKey`, priority and the source scheme and port | `Network.deleteCookies` for each of the site's, then `Network.setCookies` |
//! | `WKWebView` | `WKHTTPCookieStore`, through the webview's own `cookies()` | `deleteCookie`, then `setCookie` |
//! | `WebKitGTK` | the cookie manager's every cookie, the same way | the same |
//!
//! A Mac and Linux go through Tauri's own cookie calls, which are those stores and write
//! `HttpOnly` back by name, as `web_cookies.rs` does; what they have no word for (a
//! partition, a priority) is left out there and kept in the bundle for an engine that
//! has one.
//!
//! What is read is the site's: its own domain, its subdomains, and anything partitioned
//! under it. What is written replaces exactly that, the way a cookie import in a profile
//! manager overwrites a site's cookies rather than piling on top. A session cookie is
//! written back with the four hundred days `web_cookies.rs` gives every session cookie, so
//! the login it carries survives the next restart here as it did there.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Webview;

use super::bundle::{cookie_of_site, Cookie};

/// Four hundred days, which is what `web_cookies.rs` makes a session cookie last.
const KEPT_FOR: f64 = 400.0 * 24.0 * 60.0 * 60.0;

/// When a cookie written now should end: its own expiry, or four hundred days out for a
/// session cookie.
fn until(cookie: &Cookie, now: f64) -> f64 {
    cookie.expires.unwrap_or(now + KEPT_FOR)
}

/// Now, in seconds since 1970.
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |since| since.as_secs_f64())
}

/// The site's cookies in the store `view` is in.
pub(crate) async fn read(view: &Webview, site: &str) -> Result<Vec<Cookie>, String> {
    Ok(engine::all(view)
        .await?
        .into_iter()
        .filter(|cookie| cookie_of_site(cookie, site))
        .collect())
}

/// Replaces the site's cookies in the store `view` is in with `cookies`, and says how many
/// were written.
pub(crate) async fn write(view: &Webview, site: &str, cookies: &[Cookie]) -> Result<usize, String> {
    for old in read(view, site).await? {
        engine::delete(view, &old).await?;
    }
    let now = now();
    let fitting: Vec<&Cookie> = cookies
        .iter()
        .filter(|cookie| cookie_of_site(cookie, site))
        .collect();
    engine::set(view, &fitting, now).await?;
    Ok(fitting.len())
}

#[cfg(windows)]
mod engine {
    use serde_json::{json, Map, Value};
    use tauri::Webview;

    use super::super::bundle::{Cookie, Partition, Priority, SameSite};
    use super::super::cdp;
    use super::until;

    pub(super) async fn all(view: &Webview) -> Result<Vec<Cookie>, String> {
        let answered = cdp::call(view, "Network.getAllCookies", &json!({})).await?;
        Ok(answered["cookies"]
            .as_array()
            .map(|list| list.iter().filter_map(from_devtools).collect())
            .unwrap_or_default())
    }

    pub(super) async fn delete(view: &Webview, cookie: &Cookie) -> Result<(), String> {
        let mut asked = Map::new();
        asked.insert("name".into(), json!(cookie.name));
        asked.insert("domain".into(), json!(cookie.domain));
        asked.insert("path".into(), json!(cookie.path));
        if let Some(partition) = &cookie.partition {
            asked.insert("partitionKey".into(), partition_key(partition));
        }
        cdp::call(view, "Network.deleteCookies", &Value::Object(asked))
            .await
            .map(|_| ())
    }

    pub(super) async fn set(view: &Webview, cookies: &[&Cookie], now: f64) -> Result<(), String> {
        if cookies.is_empty() {
            return Ok(());
        }
        let list: Vec<Value> = cookies.iter().map(|one| to_devtools(one, now)).collect();
        cdp::call(view, "Network.setCookies", &json!({ "cookies": list }))
            .await
            .map(|_| ())
    }

    /// A partition as the protocol takes it now: an object. (Chromium before 119 said a
    /// string, which `from_devtools` still reads.)
    fn partition_key(partition: &Partition) -> Value {
        json!({
            "topLevelSite": partition.top_level_site,
            "hasCrossSiteAncestor": partition.cross_site_ancestor,
        })
    }

    /// One cookie out of the protocol's own shape.
    pub(super) fn from_devtools(said: &Value) -> Option<Cookie> {
        let text = |key: &str| said[key].as_str().map(str::to_owned);
        let partition = match &said["partitionKey"] {
            Value::String(site) => Some(Partition {
                top_level_site: site.clone(),
                cross_site_ancestor: false,
            }),
            Value::Object(key) => Some(Partition {
                top_level_site: key.get("topLevelSite")?.as_str()?.to_owned(),
                cross_site_ancestor: key
                    .get("hasCrossSiteAncestor")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            }),
            _ => None,
        };
        let session = said["session"].as_bool().unwrap_or(false);
        Some(Cookie {
            name: text("name")?,
            value: text("value").unwrap_or_default(),
            domain: text("domain")?,
            path: text("path").unwrap_or_else(|| "/".to_owned()),
            expires: if session {
                None
            } else {
                said["expires"].as_f64()
            },
            http_only: said["httpOnly"].as_bool().unwrap_or(false),
            secure: said["secure"].as_bool().unwrap_or(false),
            same_site: match said["sameSite"].as_str() {
                Some("Strict") => Some(SameSite::Strict),
                Some("Lax") => Some(SameSite::Lax),
                Some("None") => Some(SameSite::None),
                _ => None,
            },
            priority: match said["priority"].as_str() {
                Some("Low") => Some(Priority::Low),
                Some("Medium") => Some(Priority::Medium),
                Some("High") => Some(Priority::High),
                _ => None,
            },
            partition,
            source_scheme: text("sourceScheme"),
            source_port: said["sourcePort"].as_i64(),
        })
    }

    /// One cookie in the protocol's shape for `setCookies`. A cookie only its own host
    /// is sent (no leading dot) is set by address, which is the one way the protocol has
    /// of making a host-only cookie; a domain cookie is set by its domain.
    pub(super) fn to_devtools(cookie: &Cookie, now: f64) -> Value {
        let mut out = Map::new();
        out.insert("name".into(), json!(cookie.name));
        out.insert("value".into(), json!(cookie.value));
        if cookie.domain.starts_with('.') {
            out.insert("domain".into(), json!(cookie.domain));
        } else {
            let scheme = if cookie.secure { "https" } else { "http" };
            out.insert(
                "url".into(),
                json!(format!("{scheme}://{}{}", cookie.domain, cookie.path)),
            );
        }
        out.insert("path".into(), json!(cookie.path));
        out.insert("secure".into(), json!(cookie.secure));
        out.insert("httpOnly".into(), json!(cookie.http_only));
        out.insert("expires".into(), json!(until(cookie, now)));
        if let Some(same_site) = cookie.same_site {
            out.insert("sameSite".into(), json!(same_site));
        }
        if let Some(priority) = cookie.priority {
            out.insert("priority".into(), json!(priority));
        }
        if let Some(partition) = &cookie.partition {
            out.insert("partitionKey".into(), partition_key(partition));
        }
        if let Some(scheme) = &cookie.source_scheme {
            out.insert("sourceScheme".into(), json!(scheme));
        }
        if let Some(port) = cookie.source_port {
            out.insert("sourcePort".into(), json!(port));
        }
        Value::Object(out)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod engine {
    use tauri::webview::cookie;
    use tauri::Webview;

    use super::super::bundle::{Cookie, SameSite};
    use super::until;

    /// Tauri's cookie calls wait on the window's thread, so they are made from a thread
    /// that may block rather than from the runtime's own.
    async fn blocking<T: Send + 'static>(
        view: &Webview,
        work: impl FnOnce(Webview) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let view = view.clone();
        tauri::async_runtime::spawn_blocking(move || work(view))
            .await
            .map_err(|error| error.to_string())?
    }

    pub(super) async fn all(view: &Webview) -> Result<Vec<Cookie>, String> {
        blocking(view, |view| {
            Ok(view
                .cookies()
                .map_err(|error| error.to_string())?
                .iter()
                .map(from_engine)
                .collect())
        })
        .await
    }

    pub(super) async fn delete(view: &Webview, one: &Cookie) -> Result<(), String> {
        let gone = to_engine(one, 0.0);
        blocking(view, move |view| {
            view.delete_cookie(gone).map_err(|error| error.to_string())
        })
        .await
    }

    pub(super) async fn set(view: &Webview, cookies: &[&Cookie], now: f64) -> Result<(), String> {
        let made: Vec<cookie::Cookie<'static>> =
            cookies.iter().map(|one| to_engine(one, now)).collect();
        blocking(view, move |view| {
            for one in made {
                view.set_cookie(one).map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .await
    }

    /// A moment as seconds since 1970.
    #[allow(
        clippy::cast_precision_loss,
        reason = "seconds since 1970 fit a double's 53 bits for millions of years"
    )]
    fn seconds(at: cookie::time::OffsetDateTime) -> f64 {
        at.unix_timestamp() as f64
    }

    fn from_engine(said: &cookie::Cookie<'static>) -> Cookie {
        Cookie {
            name: said.name().to_owned(),
            value: said.value().to_owned(),
            domain: said.domain_raw().unwrap_or_default().to_owned(),
            path: said.path().unwrap_or("/").to_owned(),
            expires: said.expires_datetime().map(seconds),
            http_only: said.http_only().unwrap_or(false),
            secure: said.secure().unwrap_or(false),
            same_site: said.same_site().map(|one| match one {
                cookie::SameSite::Strict => SameSite::Strict,
                cookie::SameSite::Lax => SameSite::Lax,
                cookie::SameSite::None => SameSite::None,
            }),
            priority: None,
            partition: None,
            source_scheme: None,
            source_port: None,
        }
    }

    #[allow(
        clippy::cast_possible_truncation,
        reason = "an expiry is whole seconds; the fraction a cookie store keeps is noise"
    )]
    fn to_engine(one: &Cookie, now: f64) -> cookie::Cookie<'static> {
        let expires = cookie::time::OffsetDateTime::from_unix_timestamp(until(one, now) as i64)
            .map_or(cookie::Expiration::Session, cookie::Expiration::DateTime);
        let mut made = cookie::Cookie::build((one.name.clone(), one.value.clone()))
            .domain(one.domain.clone())
            .path(one.path.clone())
            .secure(one.secure)
            .http_only(one.http_only)
            .expires(expires);
        if let Some(same_site) = one.same_site {
            made = made.same_site(match same_site {
                SameSite::Strict => cookie::SameSite::Strict,
                SameSite::Lax => cookie::SameSite::Lax,
                SameSite::None => cookie::SameSite::None,
            });
        }
        made.build()
    }
}

#[cfg(all(test, windows))]
mod tests {
    use serde_json::json;

    use super::engine::{from_devtools, to_devtools};
    use super::KEPT_FOR;

    /// A cookie out of the protocol and back in keeps everything that makes it the same
    /// cookie: partition, priority, the source binding, and whether it is only its host's.
    #[test]
    fn a_cookie_round_trips_through_the_protocol() {
        let said = json!({
            "name": "__Host-sid", "value": "v", "domain": "moodle.ethz.ch", "path": "/",
            "expires": 1_900_000_000.25, "size": 10, "httpOnly": true, "secure": true,
            "session": false, "sameSite": "Strict", "priority": "High",
            "sourceScheme": "Secure", "sourcePort": 443,
            "partitionKey": { "topLevelSite": "https://ethz.ch", "hasCrossSiteAncestor": true },
        });
        let cookie = from_devtools(&said).expect("a cookie");
        assert_eq!(cookie.expires, Some(1_900_000_000.25));
        let back = to_devtools(&cookie, 0.0);
        assert_eq!(back["url"], "https://moodle.ethz.ch/");
        assert!(
            back.get("domain").is_none(),
            "a host-only cookie is set by address"
        );
        assert_eq!(back["expires"], 1_900_000_000.25);
        assert_eq!(back["sameSite"], "Strict");
        assert_eq!(back["priority"], "High");
        assert_eq!(back["partitionKey"]["topLevelSite"], "https://ethz.ch");
        assert_eq!(back["partitionKey"]["hasCrossSiteAncestor"], true);
        assert_eq!(back["sourcePort"], 443);
    }

    /// A session cookie is written with four hundred days, a domain cookie by its domain,
    /// and an old engine's partition key (a string) is still read.
    #[test]
    fn a_session_cookie_is_written_to_last() {
        let said = json!({
            "name": "sid", "value": "1", "domain": ".ethz.ch", "path": "/",
            "expires": -1, "session": true, "partitionKey": "https://ethz.ch",
        });
        let cookie = from_devtools(&said).expect("a cookie");
        assert_eq!(cookie.expires, None);
        assert_eq!(
            cookie
                .partition
                .as_ref()
                .map(|one| one.top_level_site.as_str()),
            Some("https://ethz.ch")
        );
        let back = to_devtools(&cookie, 1000.0);
        assert_eq!(back["domain"], ".ethz.ch");
        assert!(back.get("url").is_none());
        assert_eq!(back["expires"], 1000.0 + KEPT_FOR);
    }
}
