//! One device holds a site's login at a time, under sync v2 (docs/agent-native.md 7.4,
//! `sync-v2.md` 6.2).
//!
//! An agent's tab in the reader's store needs the same lease a reader's tab does, and the
//! agent's activity counts as the device being in use, so a laptop does not hand the
//! session to the desktop in the middle of an agent's job; and an agent never takes a
//! lease another device is using. That is the `web-lease` lane's to build. Until it
//! lands every lease is this device's, and this seam is where it plugs in: `browser_open`
//! asks here before it builds a page, and an `Err` answers `in_use_elsewhere` with the
//! other device's name. An agent's own store is not synced and never needs one.

/// Whether this device may use a site's login in a store now: `Err` names the device
/// that holds it. Always `Ok` until sync v2's leases exist.
#[allow(
    clippy::unnecessary_wraps,
    reason = "the seam's signature is what the lease lane fills in"
)]
pub fn lease_needed(store: Option<&str>, site: &str) -> Result<(), String> {
    let _ = (store, site);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_lease_is_this_devices_until_sync_v2() {
        assert!(super::lease_needed(None, "shop.example").is_ok());
        assert!(super::lease_needed(Some("agent_a"), "shop.example").is_ok());
    }
}
