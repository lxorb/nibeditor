//! Which extension a link names, and which store it is in.
//!
//! What somebody pastes is the address of the store's own page, the one a search or a
//! friend handed them: the Chrome Web Store's, old or new, or Edge Add-ons'. The id is
//! the last part of it that is one - thirty-two letters from `a` to `p`, which is how
//! Chromium writes the first sixteen bytes of a key's hash - and the store is the host.
//! A bare id is taken too, as the Chrome Web Store's, which is where nearly every one
//! comes from.

use serde::{Deserialize, Serialize};
use tauri::Url;

/// Where an extension comes from, and so where it is fetched and updated from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    /// The Chrome Web Store.
    Chrome,
    /// Microsoft Edge Add-ons.
    Edge,
}

/// How long an extension's id is.
const ID_LENGTH: usize = 32;

/// Whether `word` is an extension id: thirty-two letters from `a` to `p`.
pub fn is_id(word: &str) -> bool {
    word.len() == ID_LENGTH && word.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
}

/// The store and the extension a link or an id names, or `None` for anything else.
pub fn named(said: &str) -> Option<(Store, String)> {
    let said = said.trim();
    if is_id(said) {
        return Some((Store::Chrome, said.to_owned()));
    }

    let url = Url::parse(said).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    let store = store_of(&url)?;
    let parts: Vec<&str> = url.path_segments()?.filter(|one| !one.is_empty()).collect();
    // The detail page and nothing else: a search or a category is no extension.
    let detail = parts.iter().position(|one| *one == "detail")?;
    let id = parts[detail + 1..].iter().rev().find(|one| is_id(one))?;
    Some((store, (*id).to_owned()))
}

/// The store a page is in, judged by its host and its first folder.
fn store_of(url: &Url) -> Option<Store> {
    let host = url.host_str()?.to_ascii_lowercase();
    let first = url.path_segments()?.next().unwrap_or_default();
    match host.as_str() {
        "chromewebstore.google.com" => Some(Store::Chrome),
        "chrome.google.com" if first == "webstore" => Some(Store::Chrome),
        "microsoftedge.microsoft.com" if first == "addons" => Some(Store::Edge),
        _ => None,
    }
}

/// The store's own page for an extension: where nib's own Chromium sends a pasted link,
/// for the store's own button to install it.
#[cfg_attr(
    not(feature = "cef"),
    allow(
        dead_code,
        reason = "only nib's own Chromium installs through the store's own page"
    )
)]
pub fn page_of(store: Store, id: &str) -> String {
    match store {
        Store::Chrome => format!("https://chromewebstore.google.com/detail/{id}"),
        Store::Edge => format!("https://microsoftedge.microsoft.com/addons/detail/{id}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{is_id, named, page_of, Store};

    const UBLOCK: &str = "ddkjiahejlhfcafbddmgiahcphecmpfh";

    #[test]
    fn every_store_page_shape_names_its_extension() {
        for (link, store) in [
            (
                format!("https://chromewebstore.google.com/detail/ublock-origin-lite/{UBLOCK}"),
                Store::Chrome,
            ),
            (
                format!("https://chromewebstore.google.com/detail/{UBLOCK}?hl=de"),
                Store::Chrome,
            ),
            (
                format!("https://chrome.google.com/webstore/detail/ublock/{UBLOCK}"),
                Store::Chrome,
            ),
            (
                format!(
                    "https://chromewebstore.google.com/detail/ublock-origin-lite/{UBLOCK}/reviews"
                ),
                Store::Chrome,
            ),
            (
                format!("https://microsoftedge.microsoft.com/addons/detail/ublock/{UBLOCK}"),
                Store::Edge,
            ),
            (format!("  {UBLOCK} "), Store::Chrome),
        ] {
            assert_eq!(named(&link), Some((store, UBLOCK.to_owned())), "{link}");
        }
    }

    #[test]
    fn nothing_else_is_an_extension() {
        for link in [
            "",
            "https://example.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://chromewebstore.google.com/category/extensions",
            "https://chromewebstore.google.com/detail/ublock-origin-lite",
            "https://microsoftedge.microsoft.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "file:///C:/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "ddkjiahejlhfcafbddmgiahcphecmpfz",
            "ddkjiahejlhfcafbddmgiahcphecmpf",
        ] {
            assert_eq!(named(link), None, "{link}");
        }
    }

    #[test]
    fn an_id_is_thirty_two_letters_a_to_p() {
        assert!(is_id(UBLOCK));
        assert!(!is_id(&UBLOCK.to_uppercase()));
        assert!(!is_id("../../../../../../../../../../../"));
    }

    #[test]
    fn the_store_page_round_trips() {
        for store in [Store::Chrome, Store::Edge] {
            assert_eq!(
                named(&page_of(store, UBLOCK)),
                Some((store, UBLOCK.to_owned()))
            );
        }
    }
}
