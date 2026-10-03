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
use std::io::{ErrorKind, Read as _, Write as _};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::{Places, State};

/// The file written into a folder once everything in it is in place. A folder without
/// it is one a fetch was interrupted in, and is fetched again. A version's says which
/// runtime its files are linked from, so the runtime is kept while the version is.
pub const READY: &str = ".ready";

/// Where this project's release files are served from; see updates.rs.
const RELEASES: &str = "https://github.com/lxorb/nibeditor/releases/download/";

/// What a probe fetches from instead: its own server, with its own key in its build's
/// config. The signature still has to verify, so this moves where the bytes come from
/// and nothing about which bytes are accepted.
const SOURCE: &str = "NIB_ENGINE_SOURCE";

/// The event the window hears the fetch's progress on.
const PROGRESS: &str = "nib://engine-progress";

/// How long a connection may take to open, and how long a download may go without a
/// byte, before it counts as no connection rather than a ring that never fills.
const CONNECT: Duration = Duration::from_secs(20);
const SILENT: Duration = Duration::from_secs(60);

/// Why a fetch ended without an engine, in the few words the Browser row says it in;
/// see `said` in settings/engine.ts. The whole of what went wrong goes to the log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reason {
    /// No answer from where the release is, or a download that broke off.
    Offline,
    /// The release carries no Chromium, or none for this system.
    Missing,
    /// The release's Chromium is for another version of the app - on the rolling build
    /// of main, the one the next update brings. The window fetches that one instead.
    Moved,
    /// A file not signed with the app's own key.
    Unsigned,
    /// The disk is full.
    Full,
    /// Stopped by the person, which the row says nothing about.
    Stopped,
    /// Anything else: a file that could not be written or unpacked.
    Failed,
}

/// A fetch that did not end in an engine: why, and the detail for the log.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refused {
    pub reason: Reason,
    /// The version the release's Chromium is for, where it is another one.
    pub version: Option<String>,
    pub detail: String,
}

impl Refused {
    fn new(reason: Reason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            version: None,
            detail: detail.into(),
        }
    }

    fn failed(detail: String) -> Self {
        Self::new(Reason::Failed, detail)
    }

    /// A request that got no file: a release without it, or no answer at all.
    fn unreached(what: &str, error: &reqwest::Error) -> Self {
        let reason = if error.status() == Some(reqwest::StatusCode::NOT_FOUND) {
            Reason::Missing
        } else {
            Reason::Offline
        };
        Self::new(reason, format!("{what}: {error}"))
    }

    /// A file that could not be written or read: the disk being full is the one a
    /// person can do something about, so it is the one said apart.
    fn disk(what: &str, error: &std::io::Error) -> Self {
        let reason = if error.kind() == ErrorKind::StorageFull {
            Reason::Full
        } else {
            Reason::Failed
        };
        Self::new(reason, format!("{what}: {error}"))
    }
}

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
fn source_of(version: &str) -> String {
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
    file.read_to_end(&mut whole)
        .map_err(|error| error.to_string())?;
    key.verify(&whole, &signature, true).map_err(refused)
}

/// Unpacks a `.tar.gz` into a folder, keeping what a Mac bundle needs: its links and
/// which files may be run.
fn unpacked(archive: &Path, into: &Path) -> Result<(), Refused> {
    let file = File::open(archive).map_err(|error| Refused::disk("opening the archive", &error))?;
    let mut tarball = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tarball.set_preserve_permissions(true);
    tarball.set_overwrite(true);
    tarball
        .unpack(into)
        .map_err(|error| Refused::disk("that archive could not be unpacked", &error))
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

/// Every engine folder but the versions in `keep` and the runtimes they use: what
/// earlier versions left behind. The running app's version is always among `keep`, so a
/// Chromium that is running is never taken from under itself - and an update fetched
/// ahead of its install keeps the version that is running until the next launch.
fn pruned(engines: &Path, keep: &[&str]) {
    let used: Vec<String> = keep
        .iter()
        .filter_map(|version| std::fs::read_to_string(engines.join(version).join(READY)).ok())
        .map(|runtime| runtime.trim().to_string())
        .collect();
    let Ok(entries) = std::fs::read_dir(engines) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !keep.contains(&name.as_str()) && !used.contains(&name) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// What a fetch that did not finish leaves behind - an archive half downloaded or not
/// signed, a folder half unpacked - thrown away, so a failure costs no disk. Finished
/// folders are not touched: only an archive or a `.partial` folder is ever unfinished.
fn leftovers(engines: &Path) {
    let Ok(entries) = std::fs::read_dir(engines) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".tar.gz") {
            let _ = std::fs::remove_file(entry.path());
        } else if name.ends_with(".partial") {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The folder name a runtime archive is unpacked into.
pub fn runtime_folder(archive: &Archive) -> String {
    archive.name.trim_end_matches(".tar.gz").to_string()
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
) -> Result<(), Refused> {
    let fetching = app.state::<Fetching>();
    let mut response = client
        .get(format!("{base}{}", archive.name))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| Refused::unreached(&archive.name, &error))?;

    let mut file =
        File::create(to).map_err(|error| Refused::disk("saving the download", &error))?;
    let mut done = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| Refused::new(Reason::Offline, format!("the download stopped: {error}")))?
    {
        if fetching.stopped() {
            return Err(Refused::new(Reason::Stopped, "stopped"));
        }
        file.write_all(&chunk)
            .map_err(|error| Refused::disk("saving the download", &error))?;
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

    let key = updater_key(app).map_err(Refused::failed)?;
    verified(to, &archive.signature, &key)
        .map_err(|error| Refused::new(Reason::Unsigned, format!("{}: {error}", archive.name)))
}

/// The updater's public key, from the app's own config: the key every release is signed
/// with.
fn updater_key(app: &AppHandle) -> Result<String, String> {
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
async fn fetch_engine(app: &AppHandle, places: &Places) -> Result<(), Refused> {
    let version = places.version.clone();
    let base = source_of(&version);
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT)
        .read_timeout(SILENT)
        .build()
        .map_err(|error| Refused::failed(error.to_string()))?;

    let manifest: Manifest = client
        .get(format!("{base}chromium.json"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| Refused::unreached("chromium.json", &error))?
        .json()
        .await
        .map_err(|error| Refused::new(Reason::Missing, format!("chromium.json: {error}")))?;
    let wanted = matching(&manifest, &version, &platform())?;

    crate::paths::made(&places.engines).map_err(Refused::failed)?;
    let runtime = places.engines.join(runtime_folder(&wanted.runtime));
    let needs_runtime = !runtime.join(READY).is_file();
    let total = wanted.app.size
        + if needs_runtime {
            wanted.runtime.size
        } else {
            0
        };

    if needs_runtime {
        let archive = places.engines.join(&wanted.runtime.name);
        downloaded(app, &client, &base, &wanted.runtime, &archive, 0, total).await?;
        let staged = runtime.with_extension("partial");
        let _ = std::fs::remove_dir_all(&staged);
        unpacked(&archive, &staged)?;
        let _ = std::fs::remove_file(&archive);
        std::fs::write(staged.join(READY), b"")
            .map_err(|error| Refused::disk("marking the runtime", &error))?;
        let _ = std::fs::remove_dir_all(&runtime);
        std::fs::rename(&staged, &runtime)
            .map_err(|error| Refused::disk("putting the runtime in place", &error))?;
    }

    let archive = places.engines.join(&wanted.app.name);
    let before = if needs_runtime {
        wanted.runtime.size
    } else {
        0
    };
    downloaded(app, &client, &base, &wanted.app, &archive, before, total).await?;

    let folder = places.chromium();
    let staged = folder.with_extension("partial");
    let _ = std::fs::remove_dir_all(&staged);
    crate::paths::made(&staged).map_err(Refused::failed)?;
    linked(&runtime, &staged).map_err(Refused::failed)?;
    unpacked(&archive, &staged)?;
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_file(staged.join(READY));
    std::fs::write(staged.join(READY), runtime_folder(&wanted.runtime))
        .map_err(|error| Refused::disk("marking the engine", &error))?;
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::rename(&staged, &folder)
        .map_err(|error| Refused::disk("putting the engine in place", &error))?;

    let running = app.package_info().version.to_string();
    pruned(&places.engines, &[&places.version, &running]);
    Ok(())
}

/// This system's two archives from a release's manifest, where it is for `version`.
///
/// The rolling build of main is one release, remade by every push, so a version of the
/// app that is not the newest finds the next one's Chromium there. That is said as
/// `Moved`, with the version, for the window to fetch the engine of the update instead.
fn matching<'a>(
    manifest: &'a Manifest,
    version: &str,
    system: &str,
) -> Result<&'a Platform, Refused> {
    if manifest.version != version {
        return Err(Refused {
            reason: Reason::Moved,
            version: Some(manifest.version.clone()),
            detail: format!("that Chromium is for {}, not {version}", manifest.version),
        });
    }
    manifest.platforms.get(system).ok_or_else(|| {
        Refused::new(
            Reason::Missing,
            format!("this release has no Chromium for {system}"),
        )
    })
}

/// Fetches nib's own Chromium for this version of the app - or for `version`, the one an
/// update is about to install, so the engine is there when the new version starts -
/// unless it is here already, saying how far it has got on `nib://engine-progress`.
/// Answers the Browser row's state once it is in place.
#[tauri::command]
pub async fn engine_fetch(app: AppHandle, version: Option<String>) -> Result<State, Refused> {
    if !super::OFFERED {
        return Err(Refused::new(
            Reason::Missing,
            "Chromium is not offered on this system",
        ));
    }
    let mut places = super::places(&app).map_err(Refused::failed)?;
    if let Some(version) = version {
        places.version = version;
    }
    let fetching = app.state::<Fetching>();
    if fetching.running.swap(true, Ordering::SeqCst) {
        return Err(Refused::new(
            Reason::Failed,
            "Chromium is already being fetched",
        ));
    }
    fetching.stop.store(false, Ordering::SeqCst);

    // Rustls with no provider of its own, as the updater builds it; the process's default
    // is set once, and a second setting is refused harmlessly.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let done = if places.chromium_exe().is_some() {
        Ok(())
    } else {
        fetch_engine(&app, &places)
            .await
            .inspect_err(|_| leftovers(&places.engines))
    };
    fetching.running.store(false, Ordering::SeqCst);
    done?;
    super::places(&app)
        .map(|running| super::row_state(&running))
        .map_err(Refused::failed)
}

/// Stops a fetch that is running. What it had downloaded is thrown away.
#[tauri::command]
pub fn engine_cancel(app: AppHandle) {
    app.state::<Fetching>().stop.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::{
        linked, matching, platform, release, runtime_folder, unpacked, Manifest, Reason, Refused,
    };

    #[test]
    fn a_version_is_fetched_from_the_release_it_came_from() {
        assert_eq!(release("0.9.2"), "v0.9.2");
        assert_eq!(
            release("0.9.2-431"),
            "edge",
            "a build of main is on the rolling release"
        );
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
    fn a_release_for_another_version_says_which_and_one_without_this_system_says_so() {
        let said = r#"{
          "version": "0.9.3-12",
          "platforms": {
            "windows-x86_64": {
              "runtime": { "name": "r.tar.gz", "signature": "c2ln", "size": 1 },
              "app": { "name": "a.tar.gz", "signature": "c2ln", "size": 1 }
            }
          }
        }"#;
        let manifest: Manifest = serde_json::from_str(said).expect("read");

        let moved = matching(&manifest, "0.9.3-10", "windows-x86_64").expect_err("moved");
        assert_eq!(moved.reason, Reason::Moved);
        assert_eq!(moved.version.as_deref(), Some("0.9.3-12"));

        let missing = matching(&manifest, "0.9.3-12", "windows-aarch64").expect_err("missing");
        assert_eq!(missing.reason, Reason::Missing);

        assert!(matching(&manifest, "0.9.3-12", "windows-x86_64").is_ok());
    }

    #[test]
    fn a_full_disk_is_said_apart_from_any_other_write() {
        let full = std::io::Error::from(std::io::ErrorKind::StorageFull);
        assert_eq!(Refused::disk("saving", &full).reason, Reason::Full);
        let other = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(Refused::disk("saving", &other).reason, Reason::Failed);
    }

    #[test]
    fn a_refusal_reaches_the_window_as_a_reason_and_its_detail() {
        let said = serde_json::to_value(Refused::new(Reason::Offline, "no route")).expect("said");
        assert_eq!(
            said,
            serde_json::json!({ "reason": "offline", "version": null, "detail": "no route" })
        );
    }

    #[test]
    fn a_fetch_that_failed_leaves_no_archive_and_no_half_folder_behind() {
        let root = tempfile::tempdir().expect("a folder");
        let engines = root.path();
        for folder in ["1.0.0", "runtime-a", "1.1.0.partial"] {
            std::fs::create_dir_all(engines.join(folder)).expect("made");
        }
        std::fs::write(engines.join("runtime-b.tar.gz"), b"half").expect("written");

        super::leftovers(engines);

        let mut left: Vec<String> = std::fs::read_dir(engines)
            .expect("read")
            .flatten()
            .map(|one| one.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(left, ["1.0.0", "runtime-a"]);
    }

    #[test]
    fn pruning_keeps_the_versions_asked_for_and_the_runtimes_they_use() {
        let root = tempfile::tempdir().expect("a folder");
        let engines = root.path();
        for (folder, ready) in [
            ("1.0.0", "runtime-a"),
            ("1.1.0", "runtime-b"),
            ("0.9.0", "runtime-old"),
            ("runtime-a", ""),
            ("runtime-b", ""),
            ("runtime-old", ""),
        ] {
            std::fs::create_dir_all(engines.join(folder)).expect("made");
            std::fs::write(engines.join(folder).join(super::READY), ready).expect("marked");
        }

        super::pruned(engines, &["1.1.0", "1.0.0"]);

        let mut left: Vec<String> = std::fs::read_dir(engines)
            .expect("read")
            .flatten()
            .map(|one| one.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(left, ["1.0.0", "1.1.0", "runtime-a", "runtime-b"]);
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
            tarball
                .into_inner()
                .expect("finished")
                .finish()
                .expect("flushed")
                .flush()
                .expect("synced");
        }

        let version = root.path().join("1.2.3");
        std::fs::create_dir_all(&version).expect("made");
        linked(&runtime, &version).expect("linked");
        unpacked(&archive, &version).expect("unpacked");

        assert_eq!(
            std::fs::read(version.join("libcef.dll")).expect("there"),
            b"engine"
        );
        assert_eq!(
            std::fs::read(version.join("locales").join("en-US.pak")).expect("there"),
            b"words"
        );
        assert_eq!(
            std::fs::read(version.join("nib-chromium.exe")).expect("there"),
            b"app"
        );
    }
}
