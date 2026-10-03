//! The reader's cookies, handed to the twin of their store (see `engines`): the agent is
//! signed in where the reader is, in a profile none of the reader's extensions are in.
//!
//! Every cookie of the reader's store, out of a page there through the protocol
//! (`Network.getAllCookies`, which keeps a partitioned cookie's partition, its priority
//! and the scheme and port it was set from) and into the twin's page before it has loaded
//! anything (`Network.setCookies`). One way only and every time a twin's page is built,
//! so the twin follows the reader's logins and the reader's store never hears of the
//! agent's. A cookie the reader no longer has stays in the twin until it ends: the site
//! has let go of it already.
//!
//! The page the cookies are read from is the one that holds the store's session open when
//! there is one, and otherwise a blank page built in the store for the read and closed
//! after it: no site loads in it, so no extension's script runs in it either.

use std::sync::PoisonError;

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use super::cdp;
use super::engines::View;

/// What of a cookie `Network.setCookies` takes back, as `Network.getAllCookies` says it.
const KEPT: [&str; 11] = [
    "name",
    "value",
    "domain",
    "path",
    "secure",
    "httpOnly",
    "sameSite",
    "priority",
    "sourceScheme",
    "sourcePort",
    "partitionKey",
];

/// Hands the twin `twin` every cookie of the reader's store `reader`. What could not be
/// read or written is said in the twin's console, where the agent reads what went wrong
/// with its page, and the page opens signed out.
pub fn carry(app: &AppHandle, reader: Option<&str>, twin: &View) {
    let said = super::tabs::bare(app, reader).and_then(|(source, built)| {
        let read = cdp::call(&source, "Network.getAllCookies", &json!({}));
        if built {
            super::tabs::let_go_of_bare(app, &source);
        }
        read
    });
    let written = said.and_then(|answer| {
        let cookies = settable(&answer);
        if cookies.is_empty() {
            return Ok(());
        }
        cdp::call(twin, "Network.setCookies", &json!({ "cookies": cookies })).map(|_| ())
    });
    if let Err(why) = written {
        cdp::heard(&twin.label())
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .say("warning", format!("nib could not hand this page the reader's logins: {why}"));
    }
}

/// The cookies of an answer to `Network.getAllCookies`, as `Network.setCookies` takes
/// them: a session cookie stays one, a lasting one keeps its end.
fn settable(answer: &Value) -> Vec<Value> {
    answer
        .get("cookies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|cookie| {
            let mut kept: Map<String, Value> = KEPT
                .iter()
                .filter_map(|key| Some(((*key).to_string(), cookie.get(*key)?.clone())))
                .collect();
            kept.get("name")?;
            let session = cookie.get("session").and_then(Value::as_bool) == Some(true);
            if let Some(expires) = cookie.get("expires").filter(|_| !session) {
                kept.insert("expires".into(), expires.clone());
            }
            Some(Value::Object(kept))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::settable;

    #[test]
    fn a_cookie_goes_over_with_its_partition_and_a_session_one_stays_one() {
        let answer = json!({ "cookies": [
            { "name": "sid", "value": "1", "domain": ".example.com", "path": "/", "expires": -1,
              "size": 4, "httpOnly": true, "secure": true, "session": true, "sameSite": "Lax",
              "priority": "Medium", "sourceScheme": "Secure", "sourcePort": 443 },
            { "name": "chip", "value": "2", "domain": "widget.example", "path": "/",
              "expires": 1_900_000_000.0, "size": 5, "httpOnly": false, "secure": true,
              "session": false, "priority": "Medium", "sourceScheme": "Secure", "sourcePort": 443,
              "partitionKey": { "topLevelSite": "https://shop.example", "hasCrossSiteAncestor": false } },
            { "value": "nameless" },
        ]});
        let cookies = settable(&answer);
        assert_eq!(cookies.len(), 2, "a cookie with no name is no cookie");
        assert_eq!(cookies[0]["name"], "sid");
        assert!(cookies[0].get("expires").is_none(), "a session cookie stays one");
        assert!(cookies[0].get("size").is_none() && cookies[0].get("session").is_none());
        assert_eq!(cookies[0]["httpOnly"], true);
        assert_eq!(cookies[1]["expires"], 1_900_000_000.0);
        assert_eq!(
            cookies[1]["partitionKey"]["topLevelSite"],
            "https://shop.example",
            "a partitioned cookie stays in its partition"
        );
        assert!(settable(&json!({})).is_empty());
    }
}
