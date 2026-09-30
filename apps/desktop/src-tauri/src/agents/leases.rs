//! One device holds a site's login at a time, under sync v2 (docs/agent-native.md 7.4,
//! `sync-v2.md` 6.2).
//!
//! The lease itself is the window's (`lib/web-tab/lease.svelte.ts`): the hub socket, the
//! acquiring, the handing over. What an agent needs of it is one answer, before it builds
//! a page in the reader's store: is another computer using this site right now? The
//! window says so here whenever a lease it knows about lands somewhere else or comes
//! back, and `browser_open` asks before it builds, answering `in_use_elsewhere` with that
//! computer's name.
//!
//! **An agent never acquires a lease and never takes one.** It cannot press Use here on
//! the reader's behalf, and a lease it asked for while the other computer's person had
//! stepped away would be handed over without anybody asking them - so an agent's page
//! runs on this computer's own state, as the reader's pages do while the hub is out of
//! reach, and the window's activity counts an agent at work as somebody at this computer,
//! so a lease this device holds is not handed away in the middle of a job. A site this
//! device has never asked about is not known to be anybody's. An agent's own store is
//! not synced and never needs a lease.

use std::collections::HashMap;
use std::sync::Mutex;

/// A site in a store: the store's name (none for the one every space shares) and the site.
type Where = (Option<String>, String);

/// The sites another computer holds, with that computer's name.
static ELSEWHERE: Mutex<Option<HashMap<Where, String>>> = Mutex::new(None);

/// Whether this device may use a site's login in a store now: `Err` names the device
/// that holds it.
pub fn lease_needed(store: Option<&str>, site: &str) -> Result<(), String> {
    let held = ELSEWHERE
        .lock()
        .map_err(|_| "the leases are unreadable".to_owned())?;
    match held
        .as_ref()
        .and_then(|all| all.get(&(store.map(str::to_owned), site.to_owned())))
    {
        Some(device) => Err(device.clone()),
        None => Ok(()),
    }
}

/// Remembers who holds a site's login elsewhere, or with no device that nobody else
/// does any more. Nothing else is kept: the window says it again after a restart.
fn said(store: Option<String>, site: String, device: Option<String>) {
    if let Ok(mut held) = ELSEWHERE.lock() {
        let all = held.get_or_insert_with(HashMap::new);
        match device {
            Some(device) => {
                all.insert((store, site), device);
            }
            None => {
                all.remove(&(store, site));
            }
        }
    }
}

/// The window saying where a site's login is: `device` is the computer that holds it
/// elsewhere, or none once this one holds it again or nobody does. `store` is the store's
/// name as the window builds pages in it, none for the shared one.
#[tauri::command]
pub fn web_lease_elsewhere(store: Option<String>, site: String, device: Option<String>) {
    said(store.filter(|one| !one.is_empty()), site, device);
}

#[cfg(test)]
mod tests {
    use super::{lease_needed, said};

    /// A site another computer holds is refused with its name, in that store only, and
    /// is this device's again once the window says so.
    #[test]
    fn a_site_held_elsewhere_is_refused_by_name() {
        assert!(lease_needed(None, "shop.example").is_ok());

        said(None, "shop.example".into(), Some("Laptop".into()));
        assert_eq!(lease_needed(None, "shop.example"), Err("Laptop".into()));
        assert!(lease_needed(Some("space_a"), "shop.example").is_ok());
        assert!(lease_needed(None, "other.example").is_ok());

        said(None, "shop.example".into(), None);
        assert!(lease_needed(None, "shop.example").is_ok());
    }
}
