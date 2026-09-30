//! Putting a site's state into a web store: the other half of `capture.rs`.
//!
//! The manifest is opened with the generation of the web key it names, and everything
//! in it is held to the store and site asked for (the sealing binds both, so a bundle of
//! another site's or another store's does not even open). Then, in a hidden page of the
//! store (`restore_view.rs`): the site's cookies replaced, and per origin its databases
//! deleted and made again from their chunks and its localStorage replaced, so the origin
//! holds exactly what the other computer's did. Every chunk is checked against its
//! name, which is the HMAC of what it holds, before a byte of it reaches a page.
//!
//! What cannot go in here comes back to the caller: the tab's sessionStorage, which
//! belongs to the tab (see `session.rs` and `web_state_session`), and what the app carried
//! (the trail, zoom, grants).
//!
//! Only where no page of the site is live: the lease makes that true (docs/sync-v2.md
//! 6.5), and a database a live page holds open is refused rather than waited on.

use std::path::Path;

use serde::Serialize;
use tauri::Webview;

use super::bundle::{inflated, Manifest, Session, Skipped, VERSION};
use super::capture::{checked_origin, quoted};
use super::crypto::{Bound, Kind};
use super::keys::{self, Vault};
use super::restore_view::Hidden;
use super::{cookies, folders, isolated, RESTORE};

/// What a restore did, and what it hands back.
#[derive(Debug, Serialize)]
pub(crate) struct Restored {
    pub cookies: usize,
    pub origins: usize,
    pub databases: usize,
    /// What the other computer left behind, so the caller can say nothing more about it.
    pub skipped: Vec<Skipped>,
    /// The web note tab's sessionStorage, for `web_state_session`.
    pub session: Option<Session>,
    /// What the app carried, as it was handed over.
    pub app: Option<serde_json::Value>,
    /// Which engine it came from and when.
    pub engine: String,
    pub at: u64,
}

/// Opens the manifest at `path` and puts everything in it into `store`.
pub(crate) async fn restore(
    caller: &Webview,
    vault: &impl Vault,
    label: &str,
    store: Option<&str>,
    site: &str,
    path: &Path,
) -> Result<Restored, String> {
    let folder = path
        .parent()
        .ok_or_else(|| "that web state has no folder".to_owned())?;
    let file =
        std::fs::read(path).map_err(|error| format!("the manifest could not be read: {error}"))?;
    let (generation, sealed) = folders::unframed(&file)?;
    let key = keys::at(vault, generation)?.ok_or_else(|| {
        "this computer does not have the key that web state was sealed with".to_owned()
    })?;

    let bound = |kind| Bound {
        kind,
        store: label,
        site,
    };
    let manifest: Manifest =
        serde_json::from_slice(&inflated(&key.open(bound(Kind::Manifest), sealed)?)?)
            .map_err(|error| format!("the manifest is not one: {error}"))?;
    if manifest.v != VERSION {
        return Err(format!(
            "that web state is version {}, which this app cannot read",
            manifest.v
        ));
    }
    if manifest.store != label || manifest.site != site {
        return Err("that web state is another site's".to_owned());
    }

    let mut hidden = Hidden::open(&caller.window(), store).await?;
    let cookies = cookies::write(hidden.view(), site, &manifest.cookies).await?;

    let mut databases = 0;
    for origin in &manifest.origins {
        let at = checked_origin(&origin.origin, site)?;
        hidden.visit(&at).await?;
        let view = hidden.view();

        isolated::run(view, RESTORE, "nibRestore('clear', '{}')").await?;
        if let Some(local) = &origin.local {
            let items = serde_json::to_string(local).map_err(|error| error.to_string())?;
            isolated::run(
                view,
                RESTORE,
                &format!("nibRestore('local', {})", quoted(&items)?),
            )
            .await?;
        }

        for database in &origin.databases {
            let (chunk_generation, sealed) = {
                let bytes = folders::read(folder, &database.chunk)?;
                let (number, sealed) = folders::unframed(&bytes)?;
                (number, sealed.to_vec())
            };
            if chunk_generation != generation {
                return Err(format!("{} is sealed under another key", database.name));
            }
            let plaintext = inflated(&key.open(bound(Kind::Chunk), &sealed)?)?;
            if key.chunk(label, site, &plaintext) != database.chunk {
                return Err(format!("{} is not what its name says", database.name));
            }
            let text = String::from_utf8(plaintext)
                .map_err(|_| format!("{} is not text", database.name))?;
            isolated::run(
                view,
                RESTORE,
                &format!("nibRestore('database', {})", quoted(&text)?),
            )
            .await?;
            databases += 1;
        }
    }
    drop(hidden);

    Ok(Restored {
        cookies,
        origins: manifest.origins.len(),
        databases,
        skipped: manifest
            .origins
            .iter()
            .flat_map(|origin| origin.skipped.iter().cloned())
            .collect(),
        session: manifest.session,
        app: manifest.app,
        engine: manifest.engine,
        at: manifest.at,
    })
}
