//! A link's preview, made on the sender's device (docs/chats.md 4.8): the page's title,
//! site, description and picture, read once as the message is written and frozen in it,
//! as Signal makes them. Recipients never contact the site, everybody sees the same
//! preview, and a page that changes later does not change the message.
//!
//! The crate fetches it, not the webview, so no cookie and no login goes with the request.
//! Only a public address: a name that resolves anywhere private (this machine, the local
//! network, a link-local or unique-local address) is no preview, and the connection is
//! pinned to the address that was checked, so a second lookup cannot answer differently.
//! Redirects are followed by hand, each one checked the same way. Nothing slower than
//! three seconds, nothing but HTML, and no more of a page than its head needs.

use base64::Engine as _;
use reqwest::header::{CONTENT_TYPE, LOCATION, USER_AGENT};
use reqwest::{redirect, Client, Url};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

/// How long a whole preview may take, the page and its picture.
const PATIENCE: Duration = Duration::from_secs(3);

/// The most of a page read: a head is in the first part of any page.
const MOST_PAGE: usize = 512 * 1024;

/// The largest picture taken.
const MOST_PICTURE: usize = 2 * 1024 * 1024;

/// Redirects followed, at most.
const MOST_HOPS: usize = 5;

/// What a preview says, as the window reads it.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// Where the page ended up, after any redirect.
    url: String,
    title: String,
    site: Option<String>,
    text: Option<String>,
    /// The page's picture, as base64, and its media type.
    picture: Option<String>,
    picture_type: Option<String>,
}

/// A link's preview, or nothing: a private address, a page that is not HTML, one with no
/// title, or one slower than three seconds.
#[tauri::command(async)]
pub async fn link_preview(url: String) -> Option<Page> {
    tokio::time::timeout(PATIENCE, preview(&url))
        .await
        .ok()
        .flatten()
}

async fn preview(url: &str) -> Option<Page> {
    let (url, html) = fetched(url, MOST_PAGE, |kind| kind.starts_with("text/html")).await?;
    let html = String::from_utf8_lossy(&html.0);
    let head = Head::read(&html);

    let title = head
        .meta("og:title")
        .or_else(|| head.meta("twitter:title"))
        .or(head.title.clone())?;
    let mut page = Page {
        url: url.to_string(),
        title: clipped(&title, 300),
        site: head
            .meta("og:site_name")
            .or_else(|| {
                url.host_str()
                    .map(|host| host.trim_start_matches("www.").to_owned())
            })
            .map(|site| clipped(&site, 100)),
        text: head
            .meta("og:description")
            .or_else(|| head.meta("twitter:description"))
            .or_else(|| head.meta("description"))
            .map(|text| clipped(&text, 1000)),
        picture: None,
        picture_type: None,
    };

    let picture = head
        .meta("og:image")
        .or_else(|| head.meta("og:image:url"))
        .or_else(|| head.meta("twitter:image"))
        .and_then(|found| url.join(&found).ok());
    if let Some(picture) = picture {
        if let Some((_, (bytes, kind))) = fetched(picture.as_str(), MOST_PICTURE, |kind| {
            kind.starts_with("image/")
        })
        .await
        {
            page.picture = Some(base64::engine::general_purpose::STANDARD.encode(bytes));
            page.picture_type = Some(kind);
        }
    }
    Some(page)
}

/// The bytes at an address and their media type, following redirects by hand, each hop to
/// a public address only; None for anything else, or a type `wanted` does not take.
async fn fetched(
    start: &str,
    most: usize,
    wanted: impl Fn(&str) -> bool,
) -> Option<(Url, (Vec<u8>, String))> {
    let mut url = Url::parse(start).ok()?;
    for _ in 0..=MOST_HOPS {
        if !matches!(url.scheme(), "http" | "https") {
            return None;
        }
        let host = url.host_str()?.to_owned();
        let port = url.port_or_known_default()?;
        let address = public_address(&host, port).await?;

        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = Client::builder()
            .redirect(redirect::Policy::none())
            .resolve(&host, address)
            .build()
            .ok()?;
        let mut response = client
            .get(url.clone())
            .header(USER_AGENT, "Mozilla/5.0 (compatible; nib link preview)")
            .send()
            .await
            .ok()?;

        if response.status().is_redirection() {
            let next = response.headers().get(LOCATION)?.to_str().ok()?;
            url = url.join(next).ok()?;
            continue;
        }
        if !response.status().is_success() {
            return None;
        }
        let kind = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !wanted(&kind) {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            bytes.extend_from_slice(&chunk);
            if bytes.len() >= most {
                bytes.truncate(most);
                break;
            }
        }
        return Some((url, (bytes, kind)));
    }
    None
}

/// The address a name resolves to, if every address it resolves to is public.
async fn public_address(host: &str, port: u16) -> Option<SocketAddr> {
    let named = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let found: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || {
        (named.as_str(), port)
            .to_socket_addrs()
            .map(Iterator::collect)
            .unwrap_or_default()
    })
    .await
    .ok()?;
    if found.is_empty() || !found.iter().all(|one| is_public(one.ip())) {
        return None;
    }
    found.first().copied()
}

/// Whether an address is one anybody on the internet could reach: none of this machine's,
/// the local network's, or the ones set aside.
fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.is_multicast()
                // Shared address space (carrier-grade NAT) and the benchmarking range.
                || (a == 100 && (64..128).contains(&b))
                || (a == 198 && (18..20).contains(&b))
                || a == 0
                || a >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique local and link-local.
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

/// Text cut to at most `most` characters, whole characters, without its outer blanks.
fn clipped(text: &str, most: usize) -> String {
    text.trim().chars().take(most).collect()
}

/// What a page's head says: its title and its `meta` tags by name or property.
struct Head {
    title: Option<String>,
    metas: Vec<(String, String)>,
}

impl Head {
    fn read(html: &str) -> Self {
        // Only the head: the body is where a page says anything it likes.
        let lower = html.to_ascii_lowercase();
        let end = lower.find("</head").unwrap_or(html.len());
        let (html, lower) = (&html[..end], &lower[..end]);

        let title = lower.find("<title").and_then(|at| {
            let open = at + lower[at..].find('>')? + 1;
            let close = open + lower[open..].find("</title")?;
            Some(decoded(html[open..close].trim()))
        });

        let mut metas = Vec::new();
        let mut from = 0;
        while let Some(at) = lower[from..].find("<meta") {
            let start = from + at;
            let Some(length) = lower[start..].find('>') else {
                break;
            };
            let tag = &html[start..start + length];
            let key = attribute(tag, "property").or_else(|| attribute(tag, "name"));
            if let (Some(key), Some(content)) = (key, attribute(tag, "content")) {
                metas.push((key.to_ascii_lowercase(), decoded(&content)));
            }
            from = start + length;
        }
        Self {
            title: title.filter(|one| !one.is_empty()),
            metas,
        }
    }

    /// The first non-empty `meta` of a name.
    fn meta(&self, key: &str) -> Option<String> {
        self.metas
            .iter()
            .find(|(name, content)| name == key && !content.trim().is_empty())
            .map(|(_, content)| content.clone())
    }
}

/// An attribute's value in a tag, quoted either way or not at all.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name) {
        let start = from + at;
        from = start + name.len();
        // A whole attribute name: after a blank, and followed by `=`.
        let before = lower[..start].chars().last();
        if !before.is_some_and(char::is_whitespace) {
            continue;
        }
        let rest = lower[from..].trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        let value_at = tag.len() - rest.len() + 1;
        let value = tag[value_at..].trim_start();
        let quote = value.chars().next()?;
        return Some(if quote == '"' || quote == '\'' {
            value[1..].split(quote).next()?.to_owned()
        } else {
            value
                .split(|one: char| one.is_whitespace() || one == '/' || one == '>')
                .next()?
                .to_owned()
        });
    }
    None
}

/// The few entities a title or a description is written with.
fn decoded(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let named = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        if let Some(one) = named {
            out.push(one);
            rest = &rest[end + 1..];
        } else {
            out.push('&');
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::{attribute, decoded, is_public, Head};

    #[test]
    fn a_head_says_its_title_and_metas() {
        let head = Head::read(
            r#"<html><head><title>Plain &amp; simple</title>
            <meta property="og:title" content="The &quot;real&quot; title">
            <meta name=description content='A line &#8212; with a dash'>
            <META PROPERTY="og:image" CONTENT="/pic.png" />
            </head><body><meta property="og:title" content="not this"></body>"#,
        );
        assert_eq!(head.title.as_deref(), Some("Plain & simple"));
        assert_eq!(head.meta("og:title").as_deref(), Some("The \"real\" title"));
        assert_eq!(
            head.meta("description").as_deref(),
            Some("A line \u{2014} with a dash")
        );
        assert_eq!(head.meta("og:image").as_deref(), Some("/pic.png"));
        assert_eq!(head.metas.len(), 3, "nothing from the body");
    }

    #[test]
    fn an_attribute_is_a_whole_name() {
        let tag = r#"<meta data-content="no" content="yes""#;
        assert_eq!(attribute(tag, "content").as_deref(), Some("yes"));
        assert_eq!(attribute("<meta name=x", "content"), None);
    }

    #[test]
    fn only_public_addresses_are_fetched() {
        for private in [
            "127.0.0.1",
            "10.0.0.8",
            "192.168.1.1",
            "172.16.4.4",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:192.168.0.1",
        ] {
            assert!(
                !is_public(private.parse().expect("an address")),
                "{private}"
            );
        }
        for public in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(public.parse().expect("an address")), "{public}");
        }
    }

    #[test]
    fn entities_are_decoded_and_odd_ones_kept() {
        assert_eq!(
            decoded("a &lt;b&gt; &#x41; &unknown; & c"),
            "a <b> A &unknown; & c"
        );
    }
}
