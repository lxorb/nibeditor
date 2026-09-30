//! Taking a site's state out of a web store: its cookies, and per origin its
//! localStorage and `IndexedDB`, plus the web note tab's sessionStorage, sealed into a
//! bundle in a folder of its own.
//!
//! Where each piece is read, Playwright's order: a live page first, a hidden one after.
//! The tab's own origin is read from the tab, in an isolated world, because that is the
//! only place its sessionStorage is; every other origin asked for is read from a hidden
//! page on that origin in the same store (`restore_view.rs`), and so are the cookies when
//! there is no tab. The page does the reading (dump.js, in the page's own process); the
//! compressing and sealing happen here, on a thread of the runtime's, never the
//! window's.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tauri::{Manager as _, Webview};

use super::bundle::{
    deflated, fitted, of_site, Database, Manifest, Session, Skipped, Storage, Taken, BUNDLE_MOST,
    DATABASE_MOST, VERSION,
};
use super::crypto::{Bound, Kind, WebKey};
use super::restore_view::Hidden;
use super::{cookies, folders, isolated, DUMP, ENGINE};

/// What `nibDump('list')` answers.
#[derive(Deserialize)]
struct Listed {
    origin: String,
    local: Option<Vec<(String, String)>>,
    session: Option<Vec<(String, String)>>,
    databases: Vec<Listing>,
}

/// One database as `indexedDB.databases()` names it.
#[derive(Deserialize)]
struct Listing {
    name: String,
    #[serde(default)]
    version: u64,
}

/// What `nibDump('database')` answers: the database as the page wrote it, untouched, or
/// why it stays behind.
#[derive(Deserialize)]
struct Dumped<'a> {
    #[serde(default)]
    size: u64,
    skip: Option<String>,
    #[serde(borrow)]
    db: Option<&'a RawValue>,
}

/// What a capture asks for.
pub(crate) struct Asked<'a> {
    /// The store's name as the manifest says it (`global` for the shared one), and as the
    /// crate builds pages in it (none for the shared one).
    pub label: &'a str,
    pub store: Option<&'a str>,
    pub site: &'a str,
    /// Every origin to read, each on the site.
    pub origins: Vec<String>,
    /// The web note's tab, whose page is read first and whose sessionStorage travels.
    pub tab: Option<Webview>,
    /// What the app keeps about the site besides, carried as it is.
    pub app: Option<serde_json::Value>,
}

/// One file of a capture, as the uploader needs it.
#[derive(Debug, Serialize)]
pub(crate) struct File {
    pub name: String,
    pub size: u64,
}

/// What a capture made: the folder, the manifest's file and every chunk's, and what
/// stayed behind.
#[derive(Debug, Serialize)]
pub(crate) struct Captured {
    pub folder: PathBuf,
    pub manifest: File,
    pub chunks: Vec<File>,
    pub skipped: Vec<Skipped>,
    pub cookies: usize,
}

/// The origin of a page's address: `https://moodle.ethz.ch`, or none for a page that is
/// not on the web (`about:blank`).
pub(crate) fn origin_of(url: &tauri::Url) -> Option<String> {
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

/// An origin asked for, checked: on the web, and on the site.
pub(crate) fn checked_origin(asked: &str, site: &str) -> Result<String, String> {
    let url: tauri::Url = asked
        .parse()
        .map_err(|_| format!("{asked} is not an origin"))?;
    let origin = origin_of(&url).ok_or_else(|| format!("{asked} is not on the web"))?;
    if !url.host_str().is_some_and(|host| of_site(host, site)) {
        return Err(format!("{asked} is not on {site}"));
    }
    Ok(origin)
}

/// The origins to read, checked and each once, with the tab's own first when it is on
/// the site; and which origin that is.
fn to_read(asked: &Asked<'_>) -> Result<(Vec<String>, Option<String>), String> {
    let mut origins: Vec<String> = Vec::new();
    for one in &asked.origins {
        let origin = checked_origin(one, asked.site)?;
        if !origins.contains(&origin) {
            origins.push(origin);
        }
    }

    let tab_origin = asked
        .tab
        .as_ref()
        .and_then(|tab| tab.url().ok())
        .and_then(|url| origin_of(&url))
        .filter(|origin| checked_origin(origin, asked.site).is_ok());
    if let Some(origin) = &tab_origin {
        origins.retain(|one| one != origin);
        origins.insert(0, origin.clone());
    }
    Ok((origins, tab_origin))
}

/// Takes the state out, seals it with `key`, and writes it into a folder of its own.
pub(crate) async fn capture(
    caller: &Webview,
    key: &WebKey,
    asked: Asked<'_>,
) -> Result<Captured, String> {
    let (origins, tab_origin) = to_read(&asked)?;

    // A hidden page is made only when there is something only it can reach.
    let wants_hidden =
        asked.tab.is_none() || origins.iter().any(|one| Some(one) != tab_origin.as_ref());
    let mut hidden = if wants_hidden {
        Some(Hidden::open(&caller.window(), asked.store).await?)
    } else {
        None
    };

    let cookie_view = match (&asked.tab, &hidden) {
        (Some(tab), _) => tab,
        (None, Some(hidden)) => hidden.view(),
        (None, None) => return Err("there is no page to read the cookies through".to_owned()),
    };
    let cookies = cookies::read(cookie_view, asked.site).await?;

    let mut manifest = Manifest {
        v: VERSION,
        store: asked.label.to_owned(),
        site: asked.site.to_owned(),
        engine: ENGINE.to_owned(),
        at: folders::now_ms(),
        generation: key.generation(),
        cookies,
        origins: Vec::new(),
        session: None,
        app: asked.app.clone(),
    };
    let mut taken = Vec::new();

    for origin in origins {
        let on_tab = tab_origin.as_ref() == Some(&origin);
        let view = match (on_tab, &asked.tab, hidden.as_mut()) {
            (true, Some(tab), _) => tab,
            (_, _, Some(hidden)) => {
                hidden.visit(&origin).await?;
                hidden.view()
            }
            _ => continue,
        };
        let at = manifest.origins.len();
        let (storage, session) =
            read_origin(view, &origin, on_tab, key, &asked, at, &mut taken).await?;
        if on_tab {
            manifest.session = session;
        }
        manifest.origins.push(storage);
    }
    drop(hidden);

    written(caller, key, &asked, manifest, taken)
}

/// One origin's storage out of the page in `view`: its localStorage, the tab's
/// sessionStorage when `on_tab`, and each database, sealed into `taken` or listed as
/// staying behind.
async fn read_origin(
    view: &Webview,
    origin: &str,
    on_tab: bool,
    key: &WebKey,
    asked: &Asked<'_>,
    at: usize,
    taken: &mut Vec<Taken>,
) -> Result<(Storage, Option<Session>), String> {
    let args = serde_json::json!({ "session": on_tab }).to_string();
    let listed: Listed = serde_json::from_str(
        &isolated::run(view, DUMP, &format!("nibDump('list', {})", quoted(&args)?)).await?,
    )
    .map_err(|error| format!("the page listed nonsense: {error}"))?;
    if listed.origin != origin {
        return Err(format!(
            "the page was on {} rather than {origin}",
            listed.origin
        ));
    }

    let mut skipped = Vec::new();
    for listing in listed.databases {
        let args = serde_json::json!({ "name": listing.name, "most": DATABASE_MOST }).to_string();
        let text = isolated::run(
            view,
            DUMP,
            &format!("nibDump('database', {})", quoted(&args)?),
        )
        .await?;
        let dumped: Dumped<'_> = serde_json::from_str(&text)
            .map_err(|error| format!("the page dumped nonsense: {error}"))?;
        match (dumped.skip, dumped.db) {
            (None, Some(db)) => taken.push(sealed_chunk(key, asked, at, listing, dumped.size, db)?),
            (why, _) => skipped.push(Skipped {
                name: listing.name,
                version: listing.version,
                size: dumped.size,
                why: why.unwrap_or_else(|| "gone".to_owned()),
            }),
        }
    }

    let session = listed.session.filter(|_| on_tab).map(|items| Session {
        origin: origin.to_owned(),
        items,
    });
    let storage = Storage {
        origin: origin.to_owned(),
        local: listed.local,
        databases: Vec::new(),
        skipped,
    };
    Ok((storage, session))
}

/// One database as the page wrote it, named by its content and sealed as a chunk.
fn sealed_chunk(
    key: &WebKey,
    asked: &Asked<'_>,
    at: usize,
    listing: Listing,
    size: u64,
    db: &RawValue,
) -> Result<Taken, String> {
    let plaintext = db.get().as_bytes();
    let bound = Bound {
        kind: Kind::Chunk,
        store: asked.label,
        site: asked.site,
    };
    let sealed = key.seal(bound, &deflated(plaintext)?)?;
    Ok(Taken {
        origin: at,
        database: Database {
            name: listing.name,
            version: listing.version,
            chunk: key.chunk(asked.label, asked.site, plaintext),
            size,
        },
        sealed: folders::framed(key.generation(), &sealed),
    })
}

/// The bundle fitted under its ceiling, sealed, and written into a folder of its own.
fn written(
    caller: &Webview,
    key: &WebKey,
    asked: &Asked<'_>,
    mut manifest: Manifest,
    taken: Vec<Taken>,
) -> Result<Captured, String> {
    let bound = Bound {
        kind: Kind::Manifest,
        store: asked.label,
        site: asked.site,
    };
    let sealed_manifest = |manifest: &Manifest| -> Result<Vec<u8>, String> {
        let text = serde_json::to_vec(manifest).map_err(|error| error.to_string())?;
        Ok(folders::framed(
            key.generation(),
            &key.seal(bound, &deflated(&text)?)?,
        ))
    };
    let kept = fitted(
        &mut manifest,
        taken,
        |manifest| sealed_manifest(manifest).map(|bytes| bytes.len() as u64),
        BUNDLE_MOST,
    )?;
    let manifest_bytes = sealed_manifest(&manifest)?;

    let folder = folders::fresh(caller.app_handle(), "out")?;
    folders::write(&folder.join(folders::MANIFEST), &manifest_bytes)?;
    let mut chunks = Vec::new();
    for one in kept {
        folders::write(&folder.join(&one.database.chunk), &one.sealed)?;
        chunks.push(File {
            name: one.database.chunk,
            size: one.sealed.len() as u64,
        });
    }

    Ok(Captured {
        folder,
        manifest: File {
            name: folders::MANIFEST.to_owned(),
            size: manifest_bytes.len() as u64,
        },
        chunks,
        skipped: manifest
            .origins
            .iter()
            .flat_map(|origin| origin.skipped.iter().cloned())
            .collect(),
        cookies: manifest.cookies.len(),
    })
}

/// A string as a JavaScript string literal: JSON's own quoting, which JavaScript reads.
pub(crate) fn quoted(text: &str) -> Result<String, String> {
    serde_json::to_string(text).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{checked_origin, quoted};

    /// An origin is on the web and on the site, and is said the way a browser says it.
    #[test]
    fn an_origin_is_checked_against_its_site() {
        assert_eq!(
            checked_origin("https://moodle.ethz.ch/path?x", "ethz.ch").as_deref(),
            Ok("https://moodle.ethz.ch")
        );
        assert_eq!(
            checked_origin("http://127.0.0.1:8080", "127.0.0.1").as_deref(),
            Ok("http://127.0.0.1:8080")
        );
        assert!(checked_origin("https://uzh.ch", "ethz.ch").is_err());
        assert!(checked_origin("file:///C:/x", "ethz.ch").is_err());
        assert!(checked_origin("not a url", "ethz.ch").is_err());
    }

    /// Anything a string holds stays inside the literal it is quoted in.
    #[test]
    fn a_quoted_string_stays_a_string() {
        assert_eq!(
            quoted(r#"{"a":"b'c"}"#).as_deref(),
            Ok(r#""{\"a\":\"b'c\"}""#)
        );
    }
}
