//! An extension's file, from its store: the store's own update service, which is what
//! Chrome and Edge ask too, and which needs no key and no account.
//!
//! Two questions, one protocol (Omaha's `update2`, the GET form). `crx` asks for the file
//! and is redirected to it; `newer` asks whether there is a version past the one here and
//! where it is. The answer is trusted for nothing but where to look: what arrives is
//! checked as a CRX before a byte of it is unpacked (crx.rs), so an answer from somebody
//! in the middle - Edge's own download is plain HTTP - is a file that fails that check.

use super::link::Store;

/// The Chromium version nib says it is, which a store reads to decide whether an
/// extension that asks for a newer browser may have it. A current one: nib's engines are.
const PRODUCT_VERSION: &str = "140.0.0.0";

/// The largest file taken, which is past every extension in either store.
const MOST_BYTES: usize = 256 * 1024 * 1024;

/// The service's address, with the question in `x`.
fn service(store: Store, response: &str, x: &str) -> String {
    match store {
        Store::Chrome => format!(
            "https://clients2.google.com/service/update2/crx?response={response}&acceptformat=crx3&prodversion={PRODUCT_VERSION}&x={x}"
        ),
        Store::Edge => format!(
            "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response={response}&prod=chromiumcrx&prodchannel=&prodversion={PRODUCT_VERSION}&x={x}"
        ),
    }
}

/// The client every request goes out on: rustls, as the updater's, with no cookies.
fn client() -> Result<reqwest::Client, String> {
    // Set once for the process; a second setting is refused harmlessly.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())
}

/// The newest file of extension `id`, as the store hands it out.
pub async fn crx(store: Store, id: &str) -> Result<Vec<u8>, String> {
    let x = format!("id%3D{id}%26installsource%3Dondemand%26uc");
    download(&service(store, "redirect", &x)).await
}

/// A version newer than `version` and where to fetch it, or `None` when this is the
/// newest.
pub async fn newer(
    store: Store,
    id: &str,
    version: &str,
) -> Result<Option<(String, String)>, String> {
    let x = format!("id%3D{id}%26v%3D{version}%26uc");
    let said = client()?
        .get(service(store, "updatecheck", &x))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(offline)?
        .text()
        .await
        .map_err(offline)?;
    Ok(update_in(&said).filter(|(found, _)| later(found, version)))
}

/// Fetches a file the service pointed at.
pub async fn download(url: &str) -> Result<Vec<u8>, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(offline)?;
    if response
        .content_length()
        .is_some_and(|length| length > MOST_BYTES as u64)
    {
        return Err("that extension is too large".into());
    }
    let bytes = response.bytes().await.map_err(offline)?;
    if bytes.len() > MOST_BYTES {
        return Err("that extension is too large".into());
    }
    Ok(bytes.to_vec())
}

/// What a failed request is said as.
fn offline(error: reqwest::Error) -> String {
    format!("the store could not be reached: {error}")
}

/// The version and the file in an update answer, if it offers one.
fn update_in(xml: &str) -> Option<(String, String)> {
    let at = xml.find("<updatecheck")?;
    let tag = &xml[at..at + xml[at..].find('>')?];
    let attribute = |name: &str| {
        let start = tag.find(&format!(" {name}=\""))? + name.len() + 3;
        let end = start + tag[start..].find('"')?;
        Some(tag[start..end].replace("&amp;", "&"))
    };
    if attribute("status").is_some_and(|status| status != "ok") {
        return None;
    }
    Some((attribute("version")?, attribute("codebase")?))
}

/// Whether version `a` is past `b`, as Chromium compares them: up to four numbers, each
/// as a number.
pub fn later(a: &str, b: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        version
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (numbers(a), numbers(b));
    for at in 0..a.len().max(b.len()) {
        let (one, two) = (
            a.get(at).copied().unwrap_or(0),
            b.get(at).copied().unwrap_or(0),
        );
        if one != two {
            return one > two;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{later, update_in};

    #[test]
    fn an_update_answer_says_the_version_and_the_file() {
        let offered = r#"<?xml version="1.0"?><gupdate><app appid="x" status="ok"><updatecheck status="ok" codebase="http://host/files/f?P1=1&amp;P2=2" version="2026.930.1227" /></app></gupdate>"#;
        assert_eq!(
            update_in(offered),
            Some((
                "2026.930.1227".to_owned(),
                "http://host/files/f?P1=1&P2=2".to_owned()
            ))
        );
        let none = r#"<gupdate><app appid="x" status="ok"><updatecheck _esbAllowlist="true" status="noupdate"/></app></gupdate>"#;
        assert_eq!(update_in(none), None);
        assert_eq!(update_in("<html>"), None);
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert!(later("2026.930.1227", "2026.92.1"));
        assert!(later("1.10", "1.9"));
        assert!(later("1.0.1", "1"));
        assert!(!later("1.0", "1"));
        assert!(!later("1.2", "1.10"));
    }
}
