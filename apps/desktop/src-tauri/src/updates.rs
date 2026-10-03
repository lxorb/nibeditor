//! Which stream of releases an install follows, and the look for a new version on
//! it.
//!
//! Two streams come out of the repository; see `.github/workflows/release.yml`. A
//! tag `v*` is a release proper, and every push to main is a build as well, on one
//! rolling pre-release named `edge`. The releases are what an install follows: they
//! are the endpoint in `tauri.conf.json`, which is what the updater is built with
//! when nothing here says otherwise. The rolling build is the other choice, and
//! this module is the only place that knows where it lives.
//!
//! The look is here rather than on the window side because the plugin's `check()`
//! in JavaScript takes no endpoints: it reads the whole list from the
//! configuration and stops at the first manifest it can parse, so a window cannot
//! choose between two. The builder in Rust does take them. Everything after the
//! look is the plugin's again - the window is handed the same resource id the
//! plugin's own `check` would have handed it, and downloads and installs through
//! the plugin's own commands.

use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

/// The channel that follows every push to main, and the name the window asks for
/// it by.
const UNSTABLE: &str = "unstable";

/// The manifest of the rolling build of main, remade by every push.
///
/// The releases' own manifest is in `tauri.conf.json` rather than beside this: it
/// is what the updater falls back to when no endpoint is given, so the stable
/// stream is the app's configuration itself instead of a second copy of it that
/// could drift from it.
const EDGE: &str = "https://github.com/lxorb/nibeditor/releases/download/edge/latest.json";

/// Where this project's own release files are served from. Every bundle and every
/// signature beside it is under this; see `scripts/update-manifest.mjs`, which is
/// what writes the addresses a manifest holds.
const RELEASES: &str = "https://github.com/lxorb/nibeditor/releases/download/";

/// Whether an update a manifest offered is one this channel may install.
///
/// Tauri signs the bundle and not the manifest, so the manifest's words are the
/// part of an update nobody signed: the version it claims and the address it
/// points at are the server's, and the server is a release page, a CDN and
/// whatever sits between them and this machine. The signature still settles the
/// bytes - nothing but this project's key can hand the app a binary it will run -
/// but it does not say *which* of this project's binaries, and the plugin's only
/// other check is that the claimed version is higher than the installed one. A
/// manifest claiming `99.0.0` over the genuine signed installer of an old release
/// therefore verifies, and walks the reader back into whatever that release
/// shipped; and then goes on doing it, because the installed version is older
/// every time and the claim never changes.
///
/// So the two are held to each other. The address has to be a file on this
/// project's own release pages, and the file's name has to be the one a bundle of the
/// version the manifest claimed is given - `Nib-<version>-<platform>`; see `names`.
/// Between them, the only thing a manifest can offer as `99.0.0` is a file this
/// project published as `99.0.0`.
///
/// And a version with a pre-release part on it is a build of main, which only the
/// rolling channel follows: `0.8.1-421` sits above `0.8.0` in semver, so the edge
/// manifest served at the releases' endpoint would otherwise hand a stable install
/// an untested build of main. See `scripts/build-version.sh`.
fn offered(channel: &str, version: &str, download: &str) -> Result<(), String> {
    let Some(file) = download
        .strip_prefix(RELEASES)
        .and_then(|rest| rest.rsplit('/').next())
    else {
        return Err(format!("that version is not served from {RELEASES}"));
    };

    if version.is_empty() || !names(file, version) {
        return Err(format!("{file} is not version {version}"));
    }

    if channel != UNSTABLE && version.contains('-') {
        return Err(format!("{version} is a build of main, not a release"));
    }

    Ok(())
}

/// Whether a bundle's file name is the one this project gives `version`:
/// `Nib-<version>-<platform>`, the platform beginning with a letter.
///
/// The version as the whole of what stands between `Nib-` and the platform, rather
/// than as something found in the name: `0.1` is inside `Nib-0.10.0-...`, and a
/// manifest claiming the first over the second's bundle would install whatever
/// `0.10.0` shipped under a number nothing signed. And the platform a letter,
/// because a version can have a pre-release after it: a build of main is
/// `0.8.1-421`, whose bundle `Nib-0.8.1-421-windows-...` begins with the release's
/// own `Nib-0.8.1-`. A pre-release here is digits and nothing else, which the MSI
/// bundler holds it to (`scripts/build-version.sh`), and every platform the release
/// matrix labels a bundle with is a word (`scripts/name-assets.mjs`).
fn names(file: &str, version: &str) -> bool {
    file.strip_prefix("Nib-")
        .and_then(|rest| rest.strip_prefix(version))
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|platform| platform.starts_with(|first: char| first.is_ascii_alphabetic()))
}

/// What the window is told about a new version: the fields the updater plugin's
/// own `Update` is built from on that side.
///
/// The date and the release notes are left out because nothing shows them, and
/// formatting a date would cost a dependency for a field nobody reads. The
/// manifest is passed on whole, the way the plugin's own `check` passes it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The update itself, which stays on this side; the download and the install
    /// name it.
    rid: ResourceId,
    /// The version running now.
    current_version: String,
    /// The version that was found.
    version: String,
    /// The manifest as it was served.
    raw_json: serde_json::Value,
}

/// Where a channel looks, or `None` for the endpoint the app is configured with.
///
/// Anything the app has not heard of is the stable stream: following the releases
/// is the only safe answer to a value nobody wrote, and it is where every install
/// starts. A constant that did not parse would read as stable too, which is why
/// the tests below parse it.
fn endpoints(channel: &str) -> Option<Vec<Url>> {
    if channel != UNSTABLE {
        return None;
    }

    Url::parse(EDGE).ok().map(|url| vec![url])
}

/// Looks for a new version on the channel this machine follows, and answers
/// nothing when there is none.
///
/// Only ever a higher version, whichever channel was asked for: the plugin
/// compares semver and offers nothing at or below what is installed. That is what
/// keeps a machine which has just left the rolling stream from being handed an
/// older release as an update - a build of main is numbered one patch past the
/// newest tag with a pre-release number, so `0.6.1-84` sits above `0.6.0` and
/// below `0.6.1` and stays where it is until a release passes it. See
/// `scripts/build-version.sh`.
#[tauri::command]
pub async fn check_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<Found>, String> {
    let mut builder = webview.updater_builder();

    if let Some(endpoints) = endpoints(&channel) {
        builder = builder
            .endpoints(endpoints)
            .map_err(|error| format!("could not follow the {channel} channel: {error}"))?;
    }

    let updater = builder
        .build()
        .map_err(|error| format!("could not ask for a new version: {error}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("could not look for a new version: {error}"))?
    else {
        return Ok(None);
    };

    // A manifest that says one thing and points at another is not an update; see
    // `offered`. Nothing is downloaded and nothing is handed to the window, so the
    // look answers the way a look that found nothing does.
    offered(&channel, &update.version, update.download_url.as_str())?;

    Ok(Some(Found {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        raw_json: update.raw_json.clone(),
        // Last, because it hands the update itself over to the table.
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::{endpoints, offered, EDGE, RELEASES, UNSTABLE};
    use tauri::Url;

    /// The address of one bundle on a release page, as the manifest writes it.
    fn bundle(version: &str) -> String {
        format!("{RELEASES}v{version}/Nib-{version}-windows-x64-setup.exe")
    }

    #[test]
    fn a_release_that_says_what_it_serves_is_installed() {
        assert_eq!(offered("stable", "0.9.0", &bundle("0.9.0")), Ok(()));
    }

    #[test]
    fn a_build_of_main_is_installed_on_the_channel_that_follows_main() {
        assert_eq!(offered(UNSTABLE, "0.8.1-421", &bundle("0.8.1-421")), Ok(()));
        // And is not an update for an install that follows the releases, however
        // high semver puts it: a manifest served at the wrong endpoint is a
        // manifest anybody between here and the release page can serve.
        assert!(offered("stable", "0.8.1-421", &bundle("0.8.1-421")).is_err());
    }

    /// The whole of the rollback: a real signature over a real old bundle, under a
    /// version number nothing ever signed.
    #[test]
    fn a_version_the_file_is_not_is_no_update() {
        assert!(offered("stable", "99.0.0", &bundle("0.5.0")).is_err());
        assert!(offered(UNSTABLE, "99.0.0", &bundle("0.5.0")).is_err());
    }

    #[test]
    fn a_file_from_anywhere_else_is_no_update() {
        for address in [
            "https://evil.example/Nib-99.0.0-windows-x64-setup.exe",
            "http://github.com/lxorb/nibeditor/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com/someone/else/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com.evil.example/lxorb/nibeditor/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
        ] {
            assert!(
                offered("stable", "99.0.0", address).is_err(),
                "{address} should not be an update"
            );
        }
    }

    /// A version is the whole of what the file name carries between `Nib-` and the
    /// platform, not something found somewhere in it: `0.1` is inside `0.10.0`, and a
    /// manifest claiming the first over the second's bundle would walk an install onto
    /// whatever `0.10.0` shipped under a number nothing signed.
    #[test]
    fn a_version_is_the_whole_version_in_the_name() {
        assert!(offered("stable", "0.1", &bundle("0.10.0")).is_err());
        assert!(offered("stable", "0.1", &bundle("0.1.0")).is_err());
        assert!(offered("stable", "0.10", &bundle("0.10.0")).is_err());
        assert!(offered("stable", "10.0", &bundle("0.10.0")).is_err());
        assert_eq!(offered("stable", "0.10.0", &bundle("0.10.0")), Ok(()));
    }

    /// A build of main is the release it is numbered after with a pre-release on it,
    /// so its bundle's name begins with that release's: `Nib-0.8.1-421-...` starts
    /// `Nib-0.8.1-`. A manifest claiming the release over the build's bundle is a
    /// stable install handed an untested build of main.
    #[test]
    fn a_release_is_not_the_build_of_main_before_it() {
        assert!(offered("stable", "0.8.1", &bundle("0.8.1-421")).is_err());
        assert!(offered(UNSTABLE, "0.8.1", &bundle("0.8.1-421")).is_err());
        assert!(offered(UNSTABLE, "0.8.1-42", &bundle("0.8.1-421")).is_err());
        assert_eq!(offered(UNSTABLE, "0.8.1-421", &bundle("0.8.1-421")), Ok(()));
    }

    /// Every bundle the updater is handed: the Windows installers, the `AppImage`s and
    /// the Mac archive, each named the way scripts/name-assets.mjs names it.
    #[test]
    fn every_platform_the_updater_serves_is_named_the_same_way() {
        for platform in [
            "windows-x64-setup.exe",
            "windows-arm64-setup.exe",
            "linux-x64.AppImage",
            "linux-arm64.AppImage",
            "macos-universal.app.tar.gz",
        ] {
            let address = format!("{RELEASES}v0.9.0/Nib-0.9.0-{platform}");
            assert_eq!(offered("stable", "0.9.0", &address), Ok(()), "{platform}");
        }
    }

    #[test]
    fn a_manifest_that_names_no_version_is_no_update() {
        assert!(offered("stable", "", &bundle("0.9.0")).is_err());
    }

    #[test]
    fn the_unstable_channel_follows_the_rolling_build_of_main() {
        let looked = endpoints(UNSTABLE).expect("the unstable channel has an endpoint of its own");

        assert_eq!(
            looked,
            vec![Url::parse(EDGE).expect("the manifest url parses")]
        );
    }

    #[test]
    fn the_stable_channel_follows_the_endpoint_the_app_is_configured_with() {
        assert!(endpoints("stable").is_none());
    }

    #[test]
    fn anything_nobody_wrote_is_stable() {
        for channel in ["", "STABLE", "Unstable", "beta", "main"] {
            assert!(
                endpoints(channel).is_none(),
                "{channel} should follow the releases"
            );
        }
    }

    /// A manifest served over anything but https is refused in a release build,
    /// which would be a channel that silently never finds anything.
    #[test]
    fn the_rolling_manifest_is_served_over_https() {
        let url = Url::parse(EDGE).expect("the manifest url parses");

        assert_eq!(url.scheme(), "https");
        assert!(url.path().ends_with("latest.json"));
    }

    /// The two channels are two endpoints. A configuration that listed the rolling
    /// manifest as well would follow it whatever the window asked for, since the
    /// updater takes the first endpoint that answers.
    #[test]
    fn the_configured_endpoint_is_the_releases_one() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the config parses");
        let configured = config["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("the updater is configured with endpoints");

        assert_eq!(configured.len(), 1);
        assert_ne!(configured[0].as_str(), Some(EDGE));
    }
}
