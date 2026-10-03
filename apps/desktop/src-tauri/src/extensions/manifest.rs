//! What an extension says about itself, read out of its `manifest.json`: what to call
//! it, its picture, the page its button opens, its options page and what it may do.
//!
//! Manifest V3 and V2 alike, because the Edge store still serves V2 and an `action` and
//! a `browser_action` are the same button. A name written as `__MSG_name__` is looked up
//! in the extension's own words, in the language it says is its default - which is what
//! Chromium shows when it has none of the reader's.
//!
//! And the one thing written back: the developer's key, as `key`. An unpacked extension's
//! id is its folder's hash unless its manifest carries a key, and an extension whose id
//! is not the store's breaks wherever it names itself - its own pages, its messages, its
//! updates. Chromium writes the same field when it installs from a CRX.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

/// What nib needs to know about an extension, out of its manifest.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct About {
    pub name: String,
    pub version: String,
    /// The largest picture it names, as a path inside its folder.
    pub icon: Option<String>,
    /// The page its button opens, as a path inside its folder.
    pub popup: Option<String>,
    /// Its options page, as a path inside its folder.
    pub options: Option<String>,
    /// Whether it has a button at all: an action, with or without a page.
    pub action: bool,
    /// What it asks to be allowed, as Chromium names it: `storage`, `tabs`,
    /// `<all_urls>`, `https://*.example.com/*`.
    pub permissions: Vec<String>,
}

/// Reads the manifest in `folder`.
pub fn read(folder: &Path) -> Result<About, String> {
    let text = fs::read_to_string(folder.join("manifest.json"))
        .map_err(|_| "that extension has no manifest".to_string())?;
    let manifest: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "that extension's manifest cannot be read".to_string())?;
    Ok(about(&manifest, |key| message(folder, &manifest, key)))
}

/// Writes the developer's key into the manifest in `folder`, as base64 of its DER.
#[cfg(not(feature = "cef"))]
pub fn keyed(folder: &Path, key: &[u8]) -> Result<(), String> {
    use base64::Engine as _;

    let path = folder.join("manifest.json");
    let text =
        fs::read_to_string(&path).map_err(|_| "that extension has no manifest".to_string())?;
    let mut manifest: Map<String, Value> =
        serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| "that extension's manifest cannot be read".to_string())?;
    manifest.insert(
        "key".into(),
        Value::String(base64::engine::general_purpose::STANDARD.encode(key)),
    );
    let written = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(&path, written).map_err(|error| error.to_string())
}

/// The fields, out of a parsed manifest, with `__MSG_` names looked up by `lookup`.
fn about(manifest: &Value, lookup: impl Fn(&str) -> Option<String>) -> About {
    let words = |field: &str| {
        let said = manifest
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or_default();
        said.strip_prefix("__MSG_")
            .and_then(|rest| rest.strip_suffix("__"))
            .and_then(&lookup)
            .unwrap_or_else(|| said.to_owned())
    };

    let action = manifest
        .get("action")
        .or_else(|| manifest.get("browser_action"))
        .or_else(|| manifest.get("page_action"));
    let popup = action
        .and_then(|one| one.get("default_popup"))
        .and_then(Value::as_str)
        .and_then(inside);
    let options = manifest
        .get("options_ui")
        .and_then(|one| one.get("page"))
        .or_else(|| manifest.get("options_page"))
        .and_then(Value::as_str)
        .and_then(inside);

    let mut permissions: Vec<String> = ["permissions", "host_permissions"]
        .iter()
        .filter_map(|field| manifest.get(field).and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let matched = manifest
        .get("content_scripts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|one| one.get("matches").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned);
    permissions.extend(matched);
    let mut seen = std::collections::HashSet::new();
    permissions.retain(|one| seen.insert(one.clone()));

    let icon = largest(manifest.get("icons")).or_else(|| {
        action
            .and_then(|one| one.get("default_icon"))
            .and_then(|icon| match icon {
                Value::String(path) => inside(path),
                other => largest(Some(other)),
            })
    });

    About {
        name: words("name"),
        version: manifest
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        icon,
        popup,
        options,
        action: action.is_some(),
        permissions,
    }
}

/// The path of the largest picture in a `{"16": "a.png", "128": "b.png"}` map.
fn largest(icons: Option<&Value>) -> Option<String> {
    icons?
        .as_object()?
        .iter()
        .filter_map(|(size, path)| Some((size.parse::<u32>().ok()?, path.as_str()?)))
        .max_by_key(|(size, _)| *size)
        .and_then(|(_, path)| inside(path))
}

/// A path the manifest names, if it stays inside the extension's folder: no leading
/// slash, no `..`, and no address of another page.
fn inside(path: &str) -> Option<String> {
    let path = path.trim_start_matches('/');
    let page = path.split(['?', '#']).next().unwrap_or_default();
    let fine = !page.is_empty()
        && !page.contains(':')
        && !page.contains('\\')
        && page.split('/').all(|part| !part.is_empty() && part != "..");
    fine.then(|| path.to_owned())
}

/// One of the extension's own words, in its default language: `_locales/<lang>/messages.json`,
/// whose keys are matched without regard to case.
fn message(folder: &Path, manifest: &Value, key: &str) -> Option<String> {
    let language = manifest.get("default_locale").and_then(Value::as_str)?;
    if language.contains(['/', '\\', '.']) {
        return None;
    }
    let text =
        fs::read_to_string(folder.join("_locales").join(language).join("messages.json")).ok()?;
    let messages: Map<String, Value> =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    messages
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, entry)| entry.get("message"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{about, inside};

    #[test]
    fn a_manifest_v3_extension_says_its_button_options_and_permissions() {
        let manifest = json!({
            "name": "__MSG_extName__",
            "version": "2025.1.1",
            "icons": { "16": "img/16.png", "128": "img/128.png", "48": "img/48.png" },
            "action": { "default_popup": "popup.html" },
            "options_ui": { "page": "options.html#general" },
            "permissions": ["storage", "tabs"],
            "host_permissions": ["<all_urls>"],
            "content_scripts": [{ "matches": ["<all_urls>", "https://*.example.com/*"] }]
        });
        let said = about(&manifest, |key| {
            (key == "extName").then(|| "uBlock".to_owned())
        });
        assert_eq!(said.name, "uBlock");
        assert_eq!(said.version, "2025.1.1");
        assert_eq!(said.icon.as_deref(), Some("img/128.png"));
        assert_eq!(said.popup.as_deref(), Some("popup.html"));
        assert_eq!(said.options.as_deref(), Some("options.html#general"));
        assert!(said.action);
        assert_eq!(
            said.permissions,
            ["storage", "tabs", "<all_urls>", "https://*.example.com/*"]
        );
    }

    #[test]
    fn a_manifest_v2_button_and_a_plain_name_are_read_too() {
        let manifest = json!({
            "name": "Vimium",
            "version": "2.1",
            "browser_action": { "default_icon": "icon.png" },
            "options_page": "/pages/options.html"
        });
        let said = about(&manifest, |_| None);
        assert_eq!(said.name, "Vimium");
        assert_eq!(said.icon.as_deref(), Some("icon.png"));
        assert_eq!(said.popup, None);
        assert_eq!(said.options.as_deref(), Some("pages/options.html"));
        assert!(said.action);
    }

    #[test]
    fn a_page_outside_the_extension_is_nobody_s() {
        for bad in [
            "../x.html",
            "https://evil.example/",
            "a/../../b.html",
            "a\\b.html",
            "",
        ] {
            assert_eq!(inside(bad), None, "{bad}");
        }
    }
}
