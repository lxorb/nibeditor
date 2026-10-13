//! A space's own web data, folded into the store every page shares (#239).
//!
//! Emil, 2026-10-13: *"currently there's a web data option per space ... i'd like for this
//! option to be removed. instead, web data should be global"*. A reader who kept a space
//! apart is signed in to its sites in that space's store, and turning the option into
//! nothing must not sign them out. So once, the first time a build without the option
//! starts, each store a space kept is merged into the global one (lib/web-tab/merged.ts
//! names them):
//!
//! - **Cookies, one at a time.** A cookie is its name, domain, path and partition. One the
//!   global store does not have is copied as it is - `HttpOnly`, `Secure`, `SameSite`, the
//!   partition and the expiry with it. One both have goes to the copy set last, and no
//!   engine says when a cookie was set, so the later expiry stands for it: a site that sets
//!   a cookie again sets the same lifetime from a later moment, and nib's own four hundred
//!   days for a session cookie run from the last time it kept one (`web_cookies.rs`). A
//!   cookie without an expiry on either side is the one from the store used last.
//! - **An origin's storage, whole or not at all.** Its localStorage and every `IndexedDB`
//!   database are copied over only when the global store holds nothing for the origin; an
//!   origin global has storage for keeps its own. An app's storage is one state, and half
//!   of two states is neither.
//! - **Nothing is deleted.** The store merged from is left where it is, as it was.
//!
//! Read and written through the same hidden pages and isolated worlds a web login is
//! carried through (`restore_view.rs`, `isolated.rs`, scripts/dump.js and restore.js),
//! never through the web key: nothing here leaves the computer.

use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tauri::Webview;

use super::bundle::{Cookie, Partition, DATABASE_MOST};
use super::capture::quoted;
use super::cookies::{self, now};
use super::restore_view::Hidden;
use super::{isolated, DUMP, RESTORE};

/// What a merge did.
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub(crate) struct Merged {
    /// Cookies written into the global store: new there, or newer than its own.
    pub cookies: usize,
    /// Cookies the global store kept, because its own were newer.
    pub kept: usize,
    /// Origins whose storage was copied over.
    pub origins: usize,
    /// Origins left as the global store had them.
    pub left: usize,
}

/// What `nibDump('list')` says of an origin.
#[derive(Deserialize)]
struct Listed {
    origin: String,
    local: Option<Vec<(String, String)>>,
    databases: Vec<Listing>,
}

/// One database, as the list names it.
#[derive(Deserialize)]
struct Listing {
    name: String,
}

/// What `nibDump('database')` answers: the database, or why it stays behind.
#[derive(Deserialize)]
struct Dumped<'a> {
    skip: Option<String>,
    #[serde(borrow)]
    db: Option<&'a RawValue>,
}

/// Which cookie this is, wherever it is kept.
fn identity(cookie: &Cookie) -> (String, String, String, Option<(String, bool)>) {
    (
        cookie.name.clone(),
        cookie.domain.to_ascii_lowercase(),
        cookie.path.clone(),
        cookie.partition.as_ref().map(
            |Partition {
                 top_level_site,
                 cross_site_ancestor,
             }| { (top_level_site.clone(), *cross_site_ancestor) },
        ),
    )
}

/// The cookies of `from` to write into the global store, which holds `into`, and how many
/// of `from`'s the global store keeps its own of. `from_used_last` says which store was
/// used last, for two copies neither of which ends.
pub(crate) fn chosen(
    from: &[Cookie],
    into: &[Cookie],
    from_used_last: bool,
    at: f64,
) -> (Vec<Cookie>, usize) {
    let theirs: HashMap<_, &Cookie> = into.iter().map(|one| (identity(one), one)).collect();
    let mut kept = 0;
    let taken = from
        .iter()
        // An ended cookie is nobody's login any more.
        .filter(|one| one.expires.is_none_or(|end| end > at))
        .filter(|one| {
            let Some(there) = theirs.get(&identity(one)) else {
                return true;
            };
            let newer = match (one.expires, there.expires) {
                (Some(mine), Some(theirs)) => match mine.total_cmp(&theirs) {
                    std::cmp::Ordering::Greater => true,
                    std::cmp::Ordering::Less => false,
                    std::cmp::Ordering::Equal => from_used_last,
                },
                _ => from_used_last,
            };
            if !newer {
                kept += 1;
            }
            newer
        })
        .cloned()
        .collect();
    (taken, kept)
}

/// When anything in `folder` last changed, a few levels down, which is the nearest thing a
/// store has to when it was last used. Nothing for a store that is not a folder (a Mac's).
pub(crate) fn last_used(folder: &Path) -> Option<SystemTime> {
    fn newest(at: &Path, depth: u8, seen: &mut usize) -> Option<SystemTime> {
        let mut best = std::fs::metadata(at).ok()?.modified().ok();
        if depth == 0 {
            return best;
        }
        for entry in std::fs::read_dir(at).ok()?.flatten() {
            *seen += 1;
            if *seen > 20_000 {
                break;
            }
            let path = entry.path();
            let here = if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                newest(&path, depth - 1, seen)
            } else {
                entry.metadata().ok().and_then(|one| one.modified().ok())
            };
            best = best.max(here);
        }
        best
    }
    newest(folder, 5, &mut 0)
}

/// Folds the store `from` into the global one: its cookies, and the storage of each of
/// `origins` the global store has none of. `from_used_last` is whether `from` was used
/// more recently than the global store.
pub(crate) async fn merge(
    caller: &Webview,
    from: &str,
    origins: &[String],
    from_used_last: bool,
) -> Result<Merged, String> {
    let window = caller.window();
    let mut old = Hidden::open(&window, Some(from)).await?;
    let mut global = Hidden::open(&window, None).await?;

    let theirs = cookies::every(old.view()).await?;
    let ours = cookies::every(global.view()).await?;
    let (taken, kept) = chosen(&theirs, &ours, from_used_last, now());
    let writing: Vec<&Cookie> = taken.iter().collect();
    cookies::put(global.view(), &writing).await?;
    let mut merged = Merged {
        cookies: taken.len(),
        kept,
        ..Merged::default()
    };

    for origin in origins {
        // An origin that cannot be opened or read is left as it is, and the rest go on.
        match copied(&mut old, &mut global, origin).await {
            Ok(true) => merged.origins += 1,
            Ok(false) | Err(_) => merged.left += 1,
        }
    }
    Ok(merged)
}

/// One origin's storage out of `old` and into `global`, when `global` has none. Says
/// whether it was copied.
async fn copied(old: &mut Hidden, global: &mut Hidden, origin: &str) -> Result<bool, String> {
    let listing = quoted(r#"{"session":false}"#)?;
    let list = format!("nibDump('list', {listing})");

    global.visit(origin).await?;
    let there: Listed = parsed(&isolated::run(global.view(), DUMP, &list).await?)?;
    if there.origin != origin {
        return Err(format!(
            "the page was on {} rather than {origin}",
            there.origin
        ));
    }
    if there.local.as_ref().is_some_and(|items| !items.is_empty()) || !there.databases.is_empty() {
        return Ok(false);
    }

    old.visit(origin).await?;
    let here: Listed = parsed(&isolated::run(old.view(), DUMP, &list).await?)?;
    let local = here.local.unwrap_or_default();
    if local.is_empty() && here.databases.is_empty() {
        return Ok(false);
    }

    let mut databases = Vec::new();
    for listing in &here.databases {
        let args = serde_json::json!({ "name": listing.name, "most": DATABASE_MOST }).to_string();
        let text = isolated::run(
            old.view(),
            DUMP,
            &format!("nibDump('database', {})", quoted(&args)?),
        )
        .await?;
        let dumped: Dumped<'_> = parsed(&text)?;
        if let (None, Some(db)) = (dumped.skip, dumped.db) {
            databases.push(db.get().to_owned());
        }
    }

    if !local.is_empty() {
        let items = serde_json::to_string(&local).map_err(|error| error.to_string())?;
        isolated::run(
            global.view(),
            RESTORE,
            &format!("nibRestore('local', {})", quoted(&items)?),
        )
        .await?;
    }
    for database in &databases {
        isolated::run(
            global.view(),
            RESTORE,
            &format!("nibRestore('database', {})", quoted(database)?),
        )
        .await?;
    }
    Ok(true)
}

fn parsed<'a, T: Deserialize<'a>>(text: &'a str) -> Result<T, String> {
    serde_json::from_str(text).map_err(|error| format!("the page answered nonsense: {error}"))
}

#[cfg(test)]
mod tests {
    use super::super::bundle::{Cookie, Partition};
    use super::chosen;

    fn cookie(name: &str, value: &str, expires: Option<f64>) -> Cookie {
        Cookie {
            name: name.into(),
            value: value.into(),
            domain: ".example.com".into(),
            path: "/".into(),
            expires,
            http_only: true,
            secure: true,
            same_site: None,
            priority: None,
            partition: None,
            source_scheme: None,
            source_port: None,
        }
    }

    #[test]
    fn a_cookie_the_global_store_lacks_is_copied() {
        let (taken, kept) = chosen(&[cookie("sid", "space", Some(2e9))], &[], false, 1e9);
        assert_eq!(taken.len(), 1);
        assert_eq!(kept, 0);
    }

    #[test]
    fn of_two_copies_the_later_expiry_wins() {
        let into = [cookie("sid", "global", Some(1.5e9))];
        let (taken, kept) = chosen(&[cookie("sid", "space", Some(2e9))], &into, false, 1e9);
        assert_eq!(taken[0].value, "space");
        assert_eq!(kept, 0);

        let into = [cookie("sid", "global", Some(3e9))];
        let (taken, kept) = chosen(&[cookie("sid", "space", Some(2e9))], &into, true, 1e9);
        assert!(taken.is_empty(), "the global store's own was set later");
        assert_eq!(kept, 1);
    }

    #[test]
    fn two_session_cookies_go_to_the_store_used_last() {
        let into = [cookie("sid", "global", None)];
        let from = [cookie("sid", "space", None)];
        assert_eq!(chosen(&from, &into, true, 1e9).0.len(), 1);
        assert_eq!(chosen(&from, &into, false, 1e9).1, 1);
    }

    #[test]
    fn an_ended_cookie_is_left_behind() {
        assert!(chosen(&[cookie("old", "x", Some(5e8))], &[], true, 1e9)
            .0
            .is_empty());
    }

    #[test]
    fn a_partitioned_cookie_is_its_own_cookie() {
        let mut parted = cookie("sid", "parted", Some(2e9));
        parted.partition = Some(Partition {
            top_level_site: "https://shop.example".into(),
            cross_site_ancestor: false,
        });
        let into = [cookie("sid", "global", Some(3e9))];
        let (taken, _) = chosen(&[parted], &into, false, 1e9);
        assert_eq!(
            taken.len(),
            1,
            "a partition is another cookie than the unpartitioned one"
        );
    }
}
