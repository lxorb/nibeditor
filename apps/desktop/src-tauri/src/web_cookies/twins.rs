//! The unpartitioned twins an earlier nib made of partitioned cookies, found so that
//! `keep` can take them away.
//!
//! From f47877a4 (2026-09-27) until 2026-09-30, `keep` gave every session cookie its
//! four hundred days through `WebView2`'s COM cookie manager, and that manager knows
//! nothing of partitions (CHIPS, a cookie's `Partitioned` attribute). A partitioned
//! session cookie read through it and written back came out as a second cookie of the
//! same name, domain, path and value with no partition at all: sent to its site under
//! every top-level site, which is the one boundary `Partitioned` is there to draw. A
//! widget's cookie meant for one site was readable across all of them. `keep` goes
//! through the `DevTools` Protocol now, which keeps a partition; this is the clean-up
//! after the old one.
//!
//! A twin is told apart by three things together, and nothing less:
//!
//! - it has no partition, and it lasts;
//! - a partitioned cookie in the same store has its name, its domain and its path;
//! - it ends four hundred days after a moment the old `keep` could have written it -
//!   between the day that `keep` landed and a margin after the day it was replaced,
//!   for a build of those days that is still running somewhere.
//!
//! Looked for on every keep rather than on one, because the partitioned cookie a twin
//! is known by may not be there yet: it was a session cookie, gone at the last quit, and
//! comes back only when its site's frame loads again. The look reads nothing more than
//! `keep` has already read, and a twin found is gone, so it costs nothing twice. Nothing
//! ends later than the last twin's four hundred days, in January 2028; from then on it
//! finds nothing, and this file can go.

use crate::web_state::cookies::{Cookie, KEPT_FOR};

/// The earliest a twin was written: the moment the COM `keep` landed, 2026-09-27
/// 15:46:49 UTC, in seconds since 1970.
const MADE_FROM: f64 = 1_790_524_009.0;

/// The latest a twin can have been written: 2026-12-01 00:00 UTC, two months after the
/// COM `keep` was replaced, for a build of those three days that is still running.
const MADE_UNTIL: f64 = 1_796_083_200.0;

/// The twins among a store's cookies.
pub(super) fn of(all: &[Cookie]) -> impl Iterator<Item = &Cookie> {
    all.iter().filter(move |one| is_twin(one, all))
}

/// Whether `one` is a twin the old `keep` made of a partitioned cookie in `all`.
fn is_twin(one: &Cookie, all: &[Cookie]) -> bool {
    let Some(ends) = one.expires else {
        return false;
    };
    let written = ends - KEPT_FOR;
    one.partition.is_none()
        && (MADE_FROM..=MADE_UNTIL).contains(&written)
        && all.iter().any(|other| {
            other.partition.is_some()
                && other.name == one.name
                && other.domain == one.domain
                && other.path == one.path
        })
}

#[cfg(test)]
pub(super) mod tests {
    use super::{of, KEPT_FOR, MADE_FROM, MADE_UNTIL};
    use crate::web_state::cookies::Cookie;
    use serde_json::json;

    /// A cookie as `Network.getAllCookies` hands one over: `part` on the widget's host,
    /// partitioned under `partition` where one is given, lasting until `expires` where
    /// one is given.
    pub(in crate::web_cookies) fn cookie(
        name: &str,
        partition: Option<&str>,
        expires: Option<f64>,
    ) -> Cookie {
        let mut said = json!({
            "name": name, "value": "v", "domain": "widget.example", "path": "/",
            "secure": true, "httpOnly": false, "sameSite": "None",
            "session": expires.is_none(), "expires": expires.unwrap_or(-1.0),
            "sourceScheme": "Secure", "sourcePort": 443,
        });
        if let Some(site) = partition {
            said["partitionKey"] = json!({ "topLevelSite": site, "hasCrossSiteAncestor": true });
        }
        crate::web_state::cookies::engine::from_devtools(&said).expect("a cookie")
    }

    /// The moment the old `keep` last ran in the profiles this matters for.
    const WRITTEN: f64 = 1_790_700_000.0;

    /// What the old `keep` left: the partitioned session cookie as it was, and beside it
    /// the same cookie unpartitioned for four hundred days. Only the second is a twin.
    #[test]
    fn the_unpartitioned_copy_of_a_partitioned_cookie_is_a_twin() {
        let all = [
            cookie("part", Some("https://news.example"), None),
            cookie("part", None, Some(WRITTEN + KEPT_FOR)),
        ];
        let found: Vec<_> = of(&all).collect();
        assert_eq!(found.len(), 1);
        assert!(found[0].partition.is_none());
        assert_eq!(found[0].expires, Some(WRITTEN + KEPT_FOR));
    }

    /// A partitioned cookie that has since been made to last, the way `keep` does now,
    /// still names its twin: the twin is known by the partition, not by the session.
    #[test]
    fn a_lasting_partitioned_cookie_still_names_its_twin() {
        let all = [
            cookie(
                "part",
                Some("https://news.example"),
                Some(WRITTEN + KEPT_FOR),
            ),
            cookie("part", None, Some(WRITTEN + KEPT_FOR)),
        ];
        assert_eq!(of(&all).count(), 1);
    }

    /// Everything that is not a twin stays, however close it comes: the site's own
    /// cookies of another name or path, a session cookie, one that lasts for a lifetime
    /// the old `keep` never gave, one written before it landed or after it went, and one
    /// with no partitioned cookie of its name in the store at all.
    #[test]
    fn nothing_but_a_twin_is_one() {
        let partitioned = cookie("part", Some("https://news.example"), None);
        let lone = [
            cookie("part", None, Some(WRITTEN + KEPT_FOR)),
            cookie("other", Some("https://news.example"), None),
        ];
        assert_eq!(of(&lone).count(), 0, "no partitioned cookie of its name");

        let mut elsewhere = cookie("part", None, Some(WRITTEN + KEPT_FOR));
        elsewhere.path = "/account".into();
        let mut another_host = cookie("part", None, Some(WRITTEN + KEPT_FOR));
        another_host.domain = ".widget.example".into();
        for one in [
            elsewhere,
            another_host,
            cookie("part", None, None),
            cookie("part", None, Some(WRITTEN + 30.0 * 24.0 * 60.0 * 60.0)),
            cookie("part", None, Some(MADE_FROM - 1.0 + KEPT_FOR)),
            cookie("part", None, Some(MADE_UNTIL + 1.0 + KEPT_FOR)),
        ] {
            let all = [partitioned.clone(), one];
            assert_eq!(of(&all).count(), 0, "{:?}", all[1]);
        }
    }

    /// The partitioned cookie itself is never a twin, whatever its expiry.
    #[test]
    fn a_partitioned_cookie_is_never_a_twin() {
        let all = [
            cookie(
                "part",
                Some("https://news.example"),
                Some(WRITTEN + KEPT_FOR),
            ),
            cookie(
                "part",
                Some("https://other.example"),
                Some(WRITTEN + KEPT_FOR),
            ),
        ];
        assert_eq!(of(&all).count(), 0);
    }
}
