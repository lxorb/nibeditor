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
use super::crypto::{Bound, Kind, WebKey};
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

/// The manifest at `path`, opened with the generation of the key it names and held to
/// the store and site it is asked for as; with the key and that generation.
fn opened_manifest(
    vault: &impl Vault,
    label: &str,
    site: &str,
    path: &Path,
) -> Result<(Manifest, WebKey, u32), String> {
    let file =
        std::fs::read(path).map_err(|error| format!("the manifest could not be read: {error}"))?;
    let (generation, sealed) = folders::unframed(&file)?;
    let key = keys::at(vault, generation)?.ok_or_else(|| {
        "this computer does not have the key that web state was sealed with".to_owned()
    })?;

    let bound = Bound {
        kind: Kind::Manifest,
        store: label,
        site,
    };
    let manifest: Manifest = serde_json::from_slice(&inflated(&key.open(bound, sealed)?)?)
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
    Ok((manifest, key, generation))
}

/// The chunks the manifest at `path` names that its folder does not hold yet: what a
/// download fetches after the manifest, since only this computer can read the list.
pub(crate) fn chunks_wanted(
    vault: &impl Vault,
    label: &str,
    site: &str,
    path: &Path,
) -> Result<Vec<String>, String> {
    let folder = path
        .parent()
        .ok_or_else(|| "that web state has no folder".to_owned())?;
    let (manifest, _, _) = opened_manifest(vault, label, site, path)?;

    let mut wanted: Vec<String> = Vec::new();
    for database in manifest.origins.iter().flat_map(|origin| &origin.databases) {
        let here = folders::is_file_name(&database.chunk) && folder.join(&database.chunk).is_file();
        if !here && !wanted.contains(&database.chunk) {
            wanted.push(database.chunk.clone());
        }
    }
    Ok(wanted)
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
    let (manifest, key, generation) = opened_manifest(vault, label, site, path)?;
    let bound = |kind| Bound {
        kind,
        store: label,
        site,
    };

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

#[cfg(test)]
mod tests {
    use super::super::bundle::{deflated, Database, Manifest, Storage, VERSION};
    use super::super::crypto::{Bound, Kind};
    use super::super::folders::{framed, MANIFEST};
    use super::super::keys::{rotate, Memory};
    use super::chunks_wanted;

    /// A manifest naming two chunks, sealed the way a capture seals one, in a folder of
    /// its own that holds one of the two.
    fn sealed_bundle(vault: &Memory) -> std::path::PathBuf {
        let key = rotate(vault).expect("a key");
        let database = |chunk: &str| Database {
            name: chunk.to_owned(),
            version: 1,
            chunk: chunk.to_owned(),
            size: 3,
        };
        let manifest = Manifest {
            v: VERSION,
            store: "global".into(),
            site: "ethz.ch".into(),
            engine: "webview2".into(),
            at: 1,
            generation: key.generation(),
            cookies: vec![],
            origins: vec![Storage {
                origin: "https://moodle.ethz.ch".into(),
                local: None,
                databases: vec![database("aa11"), database("bb22"), database("aa11")],
                skipped: vec![],
            }],
            session: None,
            app: None,
        };
        let bound = Bound {
            kind: Kind::Manifest,
            store: "global",
            site: "ethz.ch",
        };
        let text = serde_json::to_vec(&manifest).expect("json");
        let sealed = key
            .seal(bound, &deflated(&text).expect("deflated"))
            .expect("sealed");

        let folder = std::env::temp_dir().join(format!("nib-wanted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).expect("a folder");
        std::fs::write(folder.join(MANIFEST), framed(key.generation(), &sealed)).expect("written");
        std::fs::write(folder.join("aa11"), b"here").expect("written");
        folder
    }

    /// A download asks for exactly the chunks the manifest names that are not beside it
    /// yet, each once.
    #[test]
    fn a_download_asks_for_the_chunks_it_is_missing() {
        let vault = Memory::default();
        let folder = sealed_bundle(&vault);
        let path = folder.join(MANIFEST);

        assert_eq!(
            chunks_wanted(&vault, "global", "ethz.ch", &path),
            Ok(vec!["bb22".to_owned()])
        );
        // Held to the store and the site it is asked as, like the restore itself.
        assert!(chunks_wanted(&vault, "global", "uzh.ch", &path).is_err());
        assert!(chunks_wanted(&Memory::default(), "global", "ethz.ch", &path).is_err());

        let _ = std::fs::remove_dir_all(&folder);
    }
}
