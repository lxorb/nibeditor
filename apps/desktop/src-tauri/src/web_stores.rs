//! Which store a web tab's site data goes in, when a space keeps its own.
//!
//! Emil, 2026-09-27: *"there should be a setting for a space where you can set on which
//! granularity to save the website data. either global (default) which just uses the
//! global cookies and data store of nib or per space which saves it per space or per
//! site which makes it separate for each site in this space."*
//!
//! The window decides which store a tab is in and says so by name - nothing for the
//! one every space shares, `space_<id>` for a space of its own, `site_<id>_<site>` for
//! one site within it; see web-tab/web-data.ts, which is where a site is defined. This
//! is the other half: a name the crate will make something of, and what it makes of
//! it on each engine. A name is the whole of a store's identity, so the same name
//! reaches the same cookies on every launch, and a store nobody names any more is still
//! on disk the day somebody names it again.

/// The folder beside `web` that every store but the shared one lives in, one folder
/// each. Beside rather than inside, because `web` is a `WebView2` user data folder and
/// what is inside it is the engine's.
#[cfg_attr(
    any(feature = "cef", target_os = "macos"),
    allow(
        dead_code,
        reason = "a Mac's own engine is handed an identifier rather than a folder, and nib's own Chromium keeps every store in its primary profile; the folder is what Windows and Linux use"
    )
)]
pub(crate) const STORES: &str = "web-stores";

/// The longest name the crate takes. A space's id and a registrable domain are both
/// far shorter; this is what keeps a folder name under every file system's limit.
const LONGEST: usize = 160;

/// The store a tab was asked to be in, checked: `None` for the one every space
/// shares, which is what nothing and an empty name both mean.
///
/// A name becomes a folder name, so it is held to the two shapes the window writes -
/// `space_` or `site_` and then lower case letters, digits, `.`, `-` and `_`. That
/// leaves nothing that climbs out of the stores folder or means something to a file
/// system, `nul` and `con` included, rather than trying to list what does.
pub(crate) fn named(asked: Option<&str>) -> Result<Option<&str>, String> {
    let Some(name) = asked.filter(|one| !one.is_empty()) else {
        return Ok(None);
    };

    let fine = name.len() <= LONGEST
        && (name.starts_with("space_") || name.starts_with("site_"))
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
        && !name.ends_with('_');

    if fine {
        Ok(Some(name))
    } else {
        Err("that is not a store a web tab can be in".into())
    }
}

/// Sixteen bytes for a store on a Mac, where a store is an identifier rather than a
/// folder: `WKWebsiteDataStore(forIdentifier:)` hands back the same store for the same
/// sixteen bytes, on every launch.
///
/// So they come from the name and from nothing else - two FNV-1a hashes of it, which
/// are fixed by their definition and not by this build's hasher, whose seed changes
/// from run to run. A store's cookies depend on these bytes never changing.
#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
pub(crate) fn identifier(name: &str) -> [u8; 16] {
    /// FNV-1a over the name, from a given start.
    fn hashed(name: &str, start: u64) -> u64 {
        name.bytes().fold(start, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
    }

    let mut out = [0u8; 16];
    // The standard offset basis for the first half, and a second start for the other,
    // so the halves are two different hashes rather than one written twice.
    out[..8].copy_from_slice(&hashed(name, 0xcbf2_9ce4_8422_2325).to_be_bytes());
    out[8..].copy_from_slice(&hashed(name, 0x6e69_625f_7765_6273).to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::{identifier, named, LONGEST};

    /// Nothing, and an empty name, are the store every space shares.
    #[test]
    fn no_name_is_the_shared_store() {
        assert_eq!(named(None), Ok(None));
        assert_eq!(named(Some("")), Ok(None));
    }

    /// The two shapes the window writes are taken as they are.
    #[test]
    fn a_space_and_a_site_are_names() {
        assert_eq!(named(Some("space_0-k3j9x2")), Ok(Some("space_0-k3j9x2")));
        assert_eq!(
            named(Some("site_0-k3j9x2_ethz.ch")),
            Ok(Some("site_0-k3j9x2_ethz.ch"))
        );
        assert_eq!(
            named(Some("site_7-a_xn--mnchen-3ya.de")),
            Ok(Some("site_7-a_xn--mnchen-3ya.de"))
        );
    }

    /// Nothing that could reach outside the stores folder, or mean something to a file
    /// system, is a name.
    #[test]
    fn a_name_is_one_plain_folder() {
        for bad in [
            "..",
            "nul",
            "con",
            "web",
            "space_",
            "site_",
            ".hidden",
            "../web",
            "space/0",
            "space\\0",
            "C:",
            "Space_0",
            "space 0",
            "space_0\0",
            "site_0_é.ch",
        ] {
            assert!(named(Some(bad)).is_err(), "{bad} was taken");
        }

        let long = format!("space_{}", "a".repeat(LONGEST - 6));
        assert!(named(Some(&long)).is_ok());
        assert!(named(Some(&format!("{long}a"))).is_err());
    }

    /// The same bytes for the same name on every launch, and different bytes for
    /// different names - pinned, because a change here would move every store on a Mac.
    #[test]
    fn a_macs_store_is_the_same_every_time() {
        let one = identifier("space_0-k3j9x2");
        assert_eq!(one, identifier("space_0-k3j9x2"));
        assert_ne!(one, identifier("space_1-k3j9x2"));
        assert_ne!(
            identifier("site_0-a_ethz.ch"),
            identifier("site_0-a_uzh.ch")
        );
        assert_ne!(one[..8], one[8..], "two halves, not one written twice");
        // FNV-1a's own published value for "a", which is what says the hash is FNV-1a.
        assert_eq!(
            identifier("a")[..8],
            0xaf63_dc4c_8601_ec8c_u64.to_be_bytes()
        );
        assert_eq!(
            identifier(""),
            [
                0xcb, 0xf2, 0x9c, 0xe4, 0x84, 0x22, 0x23, 0x25, 0x6e, 0x69, 0x62, 0x5f, 0x77, 0x65,
                0x62, 0x73
            ]
        );
    }
}
