//! Fetching nib's own Chromium: the engine the Browser row switches to, downloaded the
//! first time somebody chooses it rather than carried by every installer.
//!
//! Chromium is four hundred megabytes on disk, and most people never switch, so it is
//! not in the installer; `JetBrains` fetches the runtime its IDEs run on the same way, the
//! moment somebody picks another. What `JetBrains` gets wrong, by its own account, is that
//! a fetched runtime then stays as it was while the IDE updates around it. Here the
//! engine is fetched *per version of the app*, from the same release the app came from,
//! and the updater fetches the next one before it installs the next app (see
//! updater.ts), so the two never disagree.
//!
//! **Two archives, so an update is small.** A release carries, for each platform, the
//! Chromium runtime - the engine's own files, which change when the engine does - and the
//! app built on it, which changes every release:
//!
//! ```text
//! chromium.json                                   what the release carries, and their signatures
//! chromium-runtime-<cef>-<platform>.tar.gz        ~140 MB, fetched when the engine moves
//! nib-chromium-<version>-<platform>.tar.gz        a few MB, fetched with every version
//! ```
//!
//! On disk the runtime is unpacked once, and each version's folder is the app's archive
//! with every runtime file linked into it - a hard link, which costs nothing - because
//! Chromium looks for its files beside the executable that loads it.
//!
//! **Signed like an update.** Every archive has the minisign signature the updater's
//! own key makes (`tauri signer sign`), checked against the key in the app's config
//! before a byte of it is unpacked. The manifest is not signed, and does not need to be:
//! it only says which signed files to fetch, and a file that is not this project's own
//! does not verify.

use std::fs::File;
use std::io::{Read as _, Write as _};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::{Places, State};

/// The file written into a folder once everything in it is in place. A folder without
/// it is one a fetch was interrupted in, and is fetched again.
pub const READY: &str = ".ready";

/// Where this project's release files are served from; see updates.rs.
const RELEASES: &str = "https://github.com/lxorb/nibeditor/releases/download/";

/// What a probe fetches from instead: its own server, with its own key in its build's
/// config. The signature still has to verify, so this moves where the bytes come from
/// and nothing about which bytes are accepted.
const SOURCE: &str = "NIB_ENGINE_SOURCE";

/// The event the window hears the fetch's progress on.
const PROGRESS: &str = "nib://engine-progress";

/// Whether a fetch is running, and whether it was asked to stop.
#[derive(Default)]
pub struct Fetching {
    running: AtomicBool,
    stop: AtomicBool,
}

/// One file of a release, as `chromium.json` names it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Archive {
    /// The file's name on the release.
    pub name: String,
    /// Its minisign signature, as `tauri signer sign` writes it: base64 of the text.
    pub signature: String,
    /// Its size in bytes, for the progress.
    pub size: u64,
}

/// What one platform needs.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Platform {
    /// The engine's own files.
    pub runtime: Archive,
    /// The app built on them.
    pub app: Archive,
}

/// `chromium.json`: what a release carries for nib's own Chromium.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    /// The version of the app it was built from, which has to be this one.
    pub version: String,
    /// Each platform's two archives, by `<os>-<arch>`.
    pub platforms: std::collections::HashMap<String, Platform>,
}

/// This machine's platform, as the manifest names it.
pub fn platform() -> String {
    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

/// The release a version of the app is on: its own tag, or the rolling build of main
/// for a version with a build number on it (see scripts/build-version.sh).
pub fn release(version: &str) -> String {
    if version.contains('-') {
        "edge".to_string()
    } else {
        format!("v{version}")
    }
}

/// Where a version's files are served from.
fn source(version: &str) -> String {
    std::env::var(SOURCE).map_or_else(
        |_| format!("{RELEASES}{}/", release(version)),
        |own| format!("{}/", own.trim_end_matches('/')),
    )
}

/// How far a fetch has got, said to the window.
#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

/// Checks a file against the signature the release gave it, with the app's own key.
///
/// Streamed where the signature is over the file's hash, which is what minisign makes
/// by default, so four hundred megabytes are never in memory at once; read whole for the
/// older kind the updater also accepts.
pub fn verified(path: &Path, signature: &str, key: &str) -> Result<(), String> {
    use base64::Engine as _;
    let text = |encoded: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    };
    let key = text(key)
        .and_then(|key| minisign_verify::PublicKey::decode(&key).ok())
        .ok_or("the app's own key could not be read")?;
    let signature = text(signature)
        .and_then(|signature| minisign_verify::Signature::decode(&signature).ok())
        .ok_or("that file's signature could not be read")?;

    let refused = |_| "that file is not signed by nib".to_string();
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    if let Ok(mut stream) = key.verify_stream(&signature) {
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            stream.update(&buffer[..read]);
        }
        return stream.finalize().map_err(refused);
    }
    let mut whole = Vec::new();
    file.read_to_end(&mut whole).map_err(|error| error.to_string())?;
    key.verify(&whole, &signature, true).map_err(refused)
}

/// Unpacks a `.tar.gz` into a folder, keeping what a Mac bundle needs: its links and
/// which files may be run.
fn unpacked(archive: &Path, into: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|error| error.to_string())?;
    let mut tarball = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tarball.set_preserve_permissions(true);
    tarball.set_overwrite(true);
    tarball
        .unpack(into)
        .map_err(|error| format!("that archive could not be unpacked: {error}"))
}

/// Every file under `from` put at the same place under `to`, as a hard link where the
/// disk allows one and a copy where it does not. Links inside a Mac bundle stay links.
fn linked(from: &Path, to: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let there = to.join(entry.file_name());
        if kind.is_dir() {
            crate::paths::made(&there)?;
            linked(&entry.path(), &there)?;
        } else if kind.is_symlink() {
            #[cfg(unix)]
            {
                let target = std::fs::read_link(entry.path()).map_err(|error| error.to_string())?;
                let _ = std::fs::remove_file(&there);
                std::os::unix::fs::symlink(target, &there).map_err(|error| error.to_string())?;
            }
        } else if !there.exists() && std::fs::hard_link(entry.path(), &there).is_err() {
            std::fs::copy(entry.path(), &there).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Every engine folder that is not this version's or the runtime it uses: what earlier
/// versions left behind. Whatever is still running from one is left where it is.
fn pruned(places: &Places, runtime: &str) {
    let Ok(entries) = std::fs::read_dir(&places.engines) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name != places.version && name != runtime {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The folder name a runtime archive is unpacked into.
pub fn runtime_folder(archive: &Archive) -> String {
    archive
        .name
        .trim_end_matches(".tar.gz")
        .to_string()
}

impl Fetching {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
}

/// Downloads one archive into `to`, saying how far it has got, and checks it.
async fn downloaded(
    app: &AppHandle,
    client: &reqwest::Client,
    base: &str,
    archive: &Archive,
    to: &Path,
    before: u64,
    total: u64,
) -> Result<(), String> {
    let fetching = app.state::<Fetching>();
    let mut response = client
        .get(format!("{base}{}", archive.name))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Chromium could not be downloaded: {error}"))?;

    let mut file = File::create(to).map_err(|error| error.to_string())?;
    let mut done = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("the download stopped: {error}"))?
    {
        if fetching.stopped() {
            return Err("stopped".to_string());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        done += chunk.len() as u64;
        let _ = app.emit(
            PROGRESS,
            Progress {
                done: before + done,
                total,
            },
        );
    }
    drop(file);

    let key = crate::engine_switch::fetch::key(app)?;
    verified(to, &archive.signature, &key)
}

/// The updater's public key, from the app's own config: the key every release is signed
/// with.
fn key(app: &AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "this build has no key to check Chromium with".to_string())
}

/// Fetches this version's Chromium build - the runtime too, where the one it needs is
/// not here yet - and says where it got to.
async fn fetch(app: &AppHandle, places: &Places) -> Result<(), String> {
    let version = places.version.clone();
    let base = source(&version);
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())?;

    let manifest: Manifest = client
        .get(format!("{base}chromium.json"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("this release has no Chromium: {error}"))?
        .json()
        .await
        .map_err(|error| format!("this release's Chromium could not be read: {error}"))?;
    if manifest.version != version {
        return Err(format!(
            "that Chromium is for {}, not {version}",
            manifest.version
        ));
    }
    let wanted = manifest
        .platforms
        .get(&platform())
        .ok_or("this release has no Chromium for this system")?;

    crate::paths::made(&places.engines)?;
    let runtime = places.engines.join(runtime_folder(&wanted.runtime));
    let needs_runtime = !runtime.join(READY).is_file();
    let total = wanted.app.size + if needs_runtime { wanted.runtime.size } else { 0 };

    if needs_runtime {
        let archive = places.engines.join(&wanted.runtime.name);
        downloaded(app, &client, &base, &wanted.runtime, &archive, 0, total).await?;
        let staged = runtime.with_extension("partial");
        let _ = std::fs::remove_dir_all(&staged);
        unpacked(&archive, &staged)?;
        let _ = std::fs::remove_file(&archive);
        std::fs::write(staged.join(READY), b"").map_err(|error| error.to_string())?;
        let _ = std::fs::remove_dir_all(&runtime);
        std::fs::rename(&staged, &runtime).map_err(|error| error.to_string())?;
    }

    let archive = places.engines.join(&wanted.app.name);
    let before = if needs_runtime { wanted.runtime.size } else { 0 };
    downloaded(app, &client, &base, &wanted.app, &archive, before, total).await?;

    let folder = places.chromium();
    let staged = folder.with_extension("partial");
    let _ = std::fs::remove_dir_all(&staged);
    crate::paths::made(&staged)?;
    linked(&runtime, &staged)?;
    unpacked(&archive, &staged)?;
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_file(staged.join(READY));
    std::fs::write(staged.join(READY), b"").map_err(|error| error.to_string())?;
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::rename(&staged, &folder).map_err(|error| error.to_string())?;

    pruned(places, &runtime_folder(&wanted.runtime));
    Ok(())
}

/// Fetches nib's own Chromium for this version of the app, unless it is here already,
/// saying how far it has got on `nib://engine-progress`. Answers the Browser row's state
/// once it is in place.
#[tauri::command]
pub async fn engine_fetch(app: AppHandle) -> Result<State, String> {
    if !super::OFFERED {
        return Err("Chromium is not available on this system".into());
    }
    let places = super::places(&app)?;
    let fetching = app.state::<Fetching>();
    if fetching.running.swap(true, Ordering::SeqCst) {
        return Err("Chromium is already being fetched".into());
    }
    fetching.stop.store(false, Ordering::SeqCst);

    // Rustls with no provider of its own, as the updater builds it; the process's default
    // is set once, and a second setting is refused harmlessly.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let done = if places.chromium_exe().is_some() {
        Ok(())
    } else {
        fetch(&app, &places).await
    };
    fetching.running.store(false, Ordering::SeqCst);
    done.map(|()| super::state(&places))
}

/// Stops a fetch that is running. What it had downloaded is thrown away.
#[tauri::command]
pub fn engine_cancel(app: AppHandle) {
    app.state::<Fetching>().stop.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::{linked, platform, release, runtime_folder, unpacked, Manifest};

    #[test]
    fn a_version_is_fetched_from_the_release_it_came_from() {
        assert_eq!(release("0.9.2"), "v0.9.2");
        assert_eq!(release("0.9.2-431"), "edge", "a build of main is on the rolling release");
    }

    #[test]
    fn a_platform_is_named_by_its_system_and_its_processor() {
        let named = platform();
        assert!(named.contains('-'));
        assert!(named.ends_with(std::env::consts::ARCH));
    }

    #[test]
    fn the_manifest_reads_as_a_release_writes_it() {
        let said = r#"{
          "version": "0.9.2",
          "platforms": {
            "windows-aarch64": {
              "runtime": { "name": "chromium-runtime-152.0.6-windows-aarch64.tar.gz", "signature": "c2ln", "size": 140 },
              "app": { "name": "nib-chromium-0.9.2-windows-aarch64.tar.gz", "signature": "c2ln", "size": 9 }
            }
          }
        }"#;
        let manifest: Manifest = serde_json::from_str(said).expect("read");
        let windows = &manifest.platforms["windows-aarch64"];
        assert_eq!(
            runtime_folder(&windows.runtime),
            "chromium-runtime-152.0.6-windows-aarch64"
        );
        assert_eq!(windows.app.size, 9);
    }

    #[test]
    fn a_version_folder_is_the_runtime_linked_in_and_the_app_unpacked_over_it() {
        let root = tempfile::tempdir().expect("a folder");
        let runtime = root.path().join("runtime");
        std::fs::create_dir_all(runtime.join("locales")).expect("made");
        std::fs::write(runtime.join("libcef.dll"), b"engine").expect("written");
        std::fs::write(runtime.join("locales").join("en-US.pak"), b"words").expect("written");

        // The app's archive, as a release makes it: one executable.
        let archive = root.path().join("app.tar.gz");
        {
            let gz = flate2::write::GzEncoder::new(
                std::fs::File::create(&archive).expect("created"),
                flate2::Compression::fast(),
            );
            let mut tarball = tar::Builder::new(gz);
            let mut header = tar::Header::new_gnu();
            header.set_size(3);
            header.set_mode(0o755);
            header.set_cksum();
            tarball
                .append_data(&mut header, "nib-chromium.exe", &b"app"[..])
                .expect("appended");
            tarball.into_inner().expect("finished").finish().expect("flushed").flush().expect("synced");
        }

        let version = root.path().join("1.2.3");
        std::fs::create_dir_all(&version).expect("made");
        linked(&runtime, &version).expect("linked");
        unpacked(&archive, &version).expect("unpacked");

        assert_eq!(std::fs::read(version.join("libcef.dll")).expect("there"), b"engine");
        assert_eq!(
            std::fs::read(version.join("locales").join("en-US.pak")).expect("there"),
            b"words"
        );
        assert_eq!(std::fs::read(version.join("nib-chromium.exe")).expect("there"), b"app");
    }
}
