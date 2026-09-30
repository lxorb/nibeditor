//! A site's web state as it travels: one manifest and one chunk per `IndexedDB` database,
//! each compressed and then sealed. Neutral, so a login taken out of `WebView2` on
//! Windows goes into `WKWebView` on a Mac: nothing in here is an engine's own format.
//!
//! ```text
//! manifest   v, store, site, engine, time, generation, the site's cookies, per origin its
//!            localStorage and which databases went (by chunk name) or stayed (and why),
//!            the web note tab's sessionStorage, and what the app adds (trail, zoom,
//!            grants, fence), all as JSON, deflated, sealed as a manifest
//! <chunk>    one database as dump.js wrote it, deflated, sealed as a chunk, named by
//!            HMAC of its plaintext (see `crypto.rs`), so an unchanged database is the same
//!            name and never uploaded twice
//! ```
//!
//! The ceilings are docs/sync-v2.md 6.3 and 6.5: a database over 16 MiB stays behind
//! (the site fills it again), and a bundle is at most 32 MiB sealed, the largest
//! databases staying behind first until it fits. What stays is listed with its size and
//! why, so nothing is left out without a word.

use std::io::{Read as _, Write as _};

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

/// The manifest's version. A reader refuses one it does not know rather than guessing.
pub(crate) const VERSION: u32 = 1;

/// The most one `IndexedDB` database may be, in bytes of its encoding, before it stays
/// behind.
pub(crate) const DATABASE_MOST: u64 = 16 * 1024 * 1024;

/// The most a whole bundle may be, sealed, in bytes.
pub(crate) const BUNDLE_MOST: u64 = 32 * 1024 * 1024;

/// The most anything is allowed to grow to when it is inflated again: well past what the
/// ceilings let in, and far short of what a crafted stream would ask for.
const INFLATED_MOST: u64 = 4 * BUNDLE_MOST;

/// One site's web state, as the manifest says it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Manifest {
    /// `VERSION`.
    pub v: u32,
    /// The store it came out of: `global`, `space_<id>` or `site_<id>_<site>`.
    pub store: String,
    /// The registrable domain.
    pub site: String,
    /// Which engine wrote it: `webview2`, `wkwebview` or `webkitgtk`.
    pub engine: String,
    /// When it was taken, in milliseconds since 1970.
    pub at: u64,
    /// The web key's generation it is sealed under.
    pub generation: u32,
    /// The site's cookies, its subdomains' and its partitions' included.
    pub cookies: Vec<Cookie>,
    /// Each origin of the site that was asked for.
    pub origins: Vec<Storage>,
    /// The web note tab's sessionStorage, for the origin it was on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<Session>,
    /// What the app keeps about the site besides (the trail and scroll, zoom, the grants,
    /// the fence), carried as it was handed over and handed back as it is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<serde_json::Value>,
}

/// One origin's storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Storage {
    /// `https://moodle.ethz.ch`.
    pub origin: String,
    /// localStorage, in its own order; none where the engine refused to say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<Vec<(String, String)>>,
    /// The databases that travel, by chunk.
    pub databases: Vec<Database>,
    /// The databases that stay behind.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<Skipped>,
}

/// A database that travels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Database {
    pub name: String,
    pub version: u64,
    /// The chunk it is in.
    pub chunk: String,
    /// About how many bytes its encoding is.
    pub size: u64,
}

/// A database that stays behind, and why.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Skipped {
    pub name: String,
    pub version: u64,
    /// About how many bytes it is.
    pub size: u64,
    /// `large` past `DATABASE_MOST`, `bundle` for the bundle's ceiling, `unmovable` for a
    /// value that cannot travel (a key that may not be exported), `gone` when it went
    /// away while it was being read.
    pub why: String,
}

/// A tab's sessionStorage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Session {
    pub origin: String,
    pub items: Vec<(String, String)>,
}

/// A cookie, as every engine can say it and take it back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Cookie {
    pub name: String,
    pub value: String,
    /// As the engine said it: a leading dot for a cookie every subdomain is sent, none for
    /// one only its own host is.
    pub domain: String,
    pub path: String,
    /// Seconds since 1970, or none for a session cookie.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    #[serde(default)]
    pub http_only: bool,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_site: Option<SameSite>,
    /// Chromium's own; the others have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    /// The top-level site a partitioned (CHIPS) cookie belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition: Option<Partition>,
    /// Chromium's scheme binding, `Secure`, `NonSecure` or `Unset`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_scheme: Option<String>,
    /// Chromium's port binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_port: Option<i64>,
}

/// A cookie's `SameSite`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SameSite {
    Strict,
    Lax,
    None,
}

/// A cookie's priority, which Chromium uses to choose what to evict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Priority {
    Low,
    Medium,
    High,
}

/// A partitioned cookie's partition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Partition {
    /// `https://example.com`.
    pub top_level_site: String,
    #[serde(default)]
    pub cross_site_ancestor: bool,
}

/// Whether a host belongs to a site: the site itself or one of its subdomains, whatever
/// dot the engine put in front.
pub(crate) fn of_site(host: &str, site: &str) -> bool {
    let host = host.trim_start_matches('.').to_ascii_lowercase();
    host == site
        || host
            .strip_suffix(site)
            .is_some_and(|front| front.ends_with('.'))
}

/// Whether a cookie is part of a site's state: set for the site or a subdomain, or
/// partitioned under it (a widget's cookie in the site's own jar).
pub(crate) fn cookie_of_site(cookie: &Cookie, site: &str) -> bool {
    of_site(&cookie.domain, site)
        || cookie.partition.as_ref().is_some_and(|partition| {
            let host = partition
                .top_level_site
                .split_once("://")
                .map_or(partition.top_level_site.as_str(), |(_, host)| host);
            of_site(host.split(':').next().unwrap_or(host), site)
        })
}

/// Bytes deflated.
pub(crate) fn deflated(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = DeflateEncoder::new(Vec::new(), Compression::default());
    out.write_all(bytes)
        .and_then(|()| out.finish())
        .map_err(|error| format!("could not compress: {error}"))
}

/// Bytes inflated again, and refused past `INFLATED_MOST`: a stream that would grow
/// without end is not one of ours.
pub(crate) fn inflated(bytes: &[u8]) -> Result<Vec<u8>, String> {
    inflated_within(bytes, INFLATED_MOST)
}

/// The same, within `most` bytes.
fn inflated_within(bytes: &[u8], most: u64) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    DeflateDecoder::new(bytes)
        .take(most + 1)
        .read_to_end(&mut out)
        .map_err(|error| format!("could not decompress: {error}"))?;
    if out.len() as u64 > most {
        return Err("that web state is larger than any bundle may be".to_owned());
    }
    Ok(out)
}

/// A database the dump read, sealed, ready to be chosen for the bundle or left out.
#[derive(Debug)]
pub(crate) struct Taken {
    /// Which origin it belongs to, as an index into the manifest's origins.
    pub origin: usize,
    pub database: Database,
    pub sealed: Vec<u8>,
}

/// Which databases fit: all of them while the bundle is under `most` bytes with the
/// manifest, and otherwise the largest stay behind, one at a time, until it fits. The
/// ones that stay are moved into their origin's `skipped` as `bundle`; the ones that go
/// are listed under their origin and returned with their sealed bytes.
pub(crate) fn fitted(
    manifest: &mut Manifest,
    mut taken: Vec<Taken>,
    manifest_size: impl Fn(&Manifest) -> Result<u64, String>,
    most: u64,
) -> Result<Vec<Taken>, String> {
    // Smallest first, so dropping from the end drops the largest.
    taken.sort_by_key(|one| one.sealed.len());
    loop {
        for origin in &mut manifest.origins {
            origin.databases.clear();
        }
        for one in &taken {
            if let Some(origin) = manifest.origins.get_mut(one.origin) {
                origin.databases.push(one.database.clone());
            }
        }
        let chunks: u64 = taken.iter().map(|one| one.sealed.len() as u64).sum();
        if manifest_size(manifest)? + chunks <= most {
            return Ok(taken);
        }
        let Some(largest) = taken.pop() else {
            return Err("this site's web state is larger than a bundle may be".to_owned());
        };
        if let Some(origin) = manifest.origins.get_mut(largest.origin) {
            origin.skipped.push(Skipped {
                name: largest.database.name,
                version: largest.database.version,
                size: largest.database.size,
                why: "bundle".to_owned(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cookie_of_site, deflated, fitted, inflated, inflated_within, of_site, Cookie, Database,
        Manifest, Partition, Priority, SameSite, Session, Storage, Taken, VERSION,
    };

    fn cookie(domain: &str) -> Cookie {
        Cookie {
            name: "sid".into(),
            value: "1".into(),
            domain: domain.into(),
            path: "/".into(),
            expires: None,
            http_only: true,
            secure: true,
            same_site: Some(SameSite::Lax),
            priority: Some(Priority::High),
            partition: None,
            source_scheme: Some("Secure".into()),
            source_port: Some(443),
        }
    }

    fn manifest() -> Manifest {
        Manifest {
            v: VERSION,
            store: "global".into(),
            site: "ethz.ch".into(),
            engine: "webview2".into(),
            at: 1_700_000_000_000,
            generation: 1,
            cookies: vec![
                cookie(".ethz.ch"),
                Cookie {
                    partition: Some(Partition {
                        top_level_site: "https://ethz.ch".into(),
                        cross_site_ancestor: false,
                    }),
                    expires: Some(1_800_000_000.5),
                    ..cookie("widget.example")
                },
            ],
            origins: vec![Storage {
                origin: "https://moodle.ethz.ch".into(),
                local: Some(vec![("token".into(), "abc".into())]),
                databases: vec![],
                skipped: vec![],
            }],
            session: Some(Session {
                origin: "https://moodle.ethz.ch".into(),
                items: vec![("step".into(), "3".into())],
            }),
            app: Some(serde_json::json!({ "zoom": 1.25 })),
        }
    }

    /// A manifest written and read back is the same manifest, field for field.
    #[test]
    fn a_manifest_round_trips() {
        let made = manifest();
        let text = serde_json::to_vec(&made).expect("written");
        let read: Manifest = serde_json::from_slice(&text).expect("read");
        assert_eq!(read, made);
        let json = String::from_utf8(text).expect("text");
        assert!(json.contains(r#""sameSite":"Lax""#), "{json}");
        assert!(
            json.contains(r#""topLevelSite":"https://ethz.ch""#),
            "{json}"
        );
        assert!(json.contains(r#""httpOnly":true"#), "{json}");
    }

    /// Deflated and inflated, bytes are the bytes; a stream that would grow past any
    /// bundle is refused rather than filling the memory.
    #[test]
    fn compression_round_trips_and_refuses_a_bomb() {
        let large = vec![7u8; 1_000_000];
        for bytes in [&b""[..], b"x", &large[..]] {
            assert_eq!(
                inflated(&deflated(bytes).expect("deflated")).expect("inflated"),
                bytes
            );
        }
        assert!(deflated(&large).expect("deflated").len() < 10_000);

        let bomb = deflated(&[0u8; 2001]).expect("deflated");
        assert!(inflated_within(&bomb, 2000).is_err());
        assert_eq!(inflated_within(&bomb, 2001).expect("inflated").len(), 2001);
        assert!(inflated(b"not deflate at all \xff\xff").is_err());
    }

    /// A site is itself and its subdomains, whatever dot the engine wrote, and never a
    /// domain that merely ends in the same letters.
    #[test]
    fn a_host_belongs_to_its_site_only() {
        assert!(of_site("ethz.ch", "ethz.ch"));
        assert!(of_site(".ethz.ch", "ethz.ch"));
        assert!(of_site("moodle-app2.let.ethz.ch", "ethz.ch"));
        assert!(of_site("AAI-Logon.ETHZ.ch", "ethz.ch"));
        assert!(!of_site("notethz.ch", "ethz.ch"));
        assert!(!of_site("ethz.ch.evil.com", "ethz.ch"));
        assert!(!of_site("uzh.ch", "ethz.ch"));
        assert!(of_site("127.0.0.1", "127.0.0.1"));

        assert!(cookie_of_site(&cookie(".ethz.ch"), "ethz.ch"));
        assert!(!cookie_of_site(&cookie("widget.example"), "ethz.ch"));
        let partitioned = Cookie {
            partition: Some(Partition {
                top_level_site: "https://ethz.ch".into(),
                cross_site_ancestor: false,
            }),
            ..cookie("widget.example")
        };
        assert!(cookie_of_site(&partitioned, "ethz.ch"));
        assert!(!cookie_of_site(&partitioned, "uzh.ch"));
    }

    fn taken(origin: usize, name: &str, sealed: usize) -> Taken {
        Taken {
            origin,
            database: Database {
                name: name.into(),
                version: 1,
                chunk: format!("chunk-{name}"),
                size: sealed as u64,
            },
            sealed: vec![0; sealed],
        }
    }

    /// Under the ceiling everything goes; over it, the largest stays behind first, listed
    /// with its size and why, until the rest fits.
    #[test]
    fn the_bundle_ceiling_leaves_the_largest_behind() {
        let size = |_: &super::Manifest| Ok(100);

        let mut all = manifest();
        let kept = fitted(
            &mut all,
            vec![taken(0, "a", 300), taken(0, "b", 200)],
            size,
            1000,
        )
        .expect("fits");
        assert_eq!(kept.len(), 2);
        assert_eq!(all.origins[0].databases.len(), 2);
        assert!(all.origins[0].skipped.is_empty());

        let mut some = manifest();
        let kept = fitted(
            &mut some,
            vec![
                taken(0, "small", 100),
                taken(0, "large", 700),
                taken(0, "mid", 400),
            ],
            size,
            1000,
        )
        .expect("fits");
        let names: Vec<_> = kept.iter().map(|one| one.database.name.as_str()).collect();
        assert_eq!(names, ["small", "mid"]);
        assert_eq!(some.origins[0].skipped.len(), 1);
        assert_eq!(some.origins[0].skipped[0].name, "large");
        assert_eq!(some.origins[0].skipped[0].why, "bundle");
        assert_eq!(some.origins[0].skipped[0].size, 700);

        // A manifest that alone is over the ceiling cannot be made to fit.
        let mut huge = manifest();
        assert!(fitted(&mut huge, vec![], |_| Ok(2000), 1000).is_err());
    }
}
