//! A site's own mark, as the engine that drew the page found it.
//!
//! Emil, 2026-09-28: *"I don't always get the proper icon, e.g. sometimes whatsapp just
//! doesn't get its icon and keeps at the default icon."*
//!
//! **What it was.** The mark used to be an address: the page's last `<link rel=icon>`,
//! read once as the page finished loading, and then fetched a second time by the app's
//! own page to draw it. Both halves failed on web.whatsapp.com. Its script adds a second
//! `<link rel=icon>` a second or so after the page has loaded - measured, 1.3 s after
//! the load event - so which address the one read found depended on which finished
//! first. And the address it adds, `web.whatsapp.com/favicon/1x/favicon/v4/`, is served
//! with `Cross-Origin-Resource-Policy: same-origin`: the site's own page may draw it and
//! nothing else may, the app's page included. So a tab that lost the race wore a broken
//! picture, the globe stood in for it, and the address was written into the `.url`,
//! where the file list met the same refusal on every launch after. An icon behind a login
//! failed the same way for a different reason: the app's page is in another profile from
//! the site's, so it asked without the site's cookies.
//!
//! **What it is now, on `WebView2`, which is Chrome's answer.** The engine already
//! chose the page's icon and fetched it, inside the page's own profile with the page's
//! own cookies, and says when that choice changes: `FaviconChanged`. What it chose is
//! read again inside the page at the size the site drew it, and where the page will not
//! hand that over the engine's own decoded copy stands in (`GetFavicon`); see `fetch`.
//! Either way the window is sent a `data:` address nothing has to fetch again, whatever
//! the site's headers say. The event follows the page for as long as it is open, so a
//! mark a site redraws with an unread count is redrawn in the tab as well. See
//! docs/web-tabs.md.
//!
//! Every other engine has no such event reachable through what wry hands out, so there
//! the page is still asked once it has loaded. It is asked for every mark it declares
//! rather than the last, and the one worth drawing is chosen here; see `best`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// The event the window hears a tab's mark on.
const ICON: &str = "nib://web-icon";

/// The side of the box a mark is drawn in, in pixels, at the density a mark has to
/// stay sharp at: `--icon-md` is sixteen, and a screen at twice that is common.
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
const WANT: u32 = 32;

/// The largest mark worth sending, in bytes. It is written into the note's file, so it
/// is kept small: a mark of 32 or 64 pixels is a few kilobytes as a PNG or an SVG. An
/// `.ico` that carries every size up to 256 is several times this - proton.me's is 33
/// kilobytes, measured - and that one is drawn from the engine's own copy instead.
const LARGEST: usize = 16 * 1024;

/// What the window is told: which tab, and its mark. Empty is a page with none.
#[derive(Clone, Serialize)]
struct Iconed<'a> {
    tab: &'a str,
    icon: &'a str,
}

/// Tells the window that holds a tab what its mark is now.
pub fn said(app: &AppHandle, window: &str, tab: &str, icon: &str) {
    let _ = app.emit_to(window, ICON, Iconed { tab, icon });
}

/// A PNG as an address the window can draw without fetching anything, or nothing for
/// bytes that are not a PNG of a size worth sending.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn data_url(png: &[u8]) -> Option<String> {
    use base64::Engine as _;

    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if !png.starts_with(&SIGNATURE) || png.len() > LARGEST {
        return None;
    }

    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// One mark a page declares, as `ASK` reads it off a `<link>`.
#[derive(Debug, Default, Deserialize)]
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
pub struct Declared {
    #[serde(default)]
    rel: String,
    #[serde(default)]
    href: String,
    #[serde(default)]
    sizes: String,
    #[serde(default)]
    r#type: String,
}

/// What a page says about its marks: where it is, and every `<link>` that names one.
#[derive(Debug, Default, Deserialize)]
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
pub struct Declaring {
    #[serde(default)]
    page: String,
    #[serde(default)]
    links: Vec<Declared>,
}

/// Every `<link>` in the page with a `rel`, resolved, for `best` to choose from. The
/// choosing is not done in here because a rule inside a page's script is a rule
/// nothing can test.
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
pub const ASK: &str = r"(function () {
  try {
    var links = []
    var found = document.querySelectorAll('link[rel][href]')
    for (var index = 0; index < found.length; index++) {
      var one = found[index]
      links.push({
        rel: one.getAttribute('rel') || '',
        href: one.href,
        sizes: one.getAttribute('sizes') || '',
        type: one.getAttribute('type') || '',
      })
    }
    return { page: location.href, links: links }
  } catch (error) {
    return { page: '', links: [] }
  }
})()";

/// How good a declared mark is for a box `WANT` pixels wide: higher is better.
///
/// A drawing that scales is best, because it is sharp at any size. Then the smallest
/// picture at least as large as the box, which is sharp without being a large picture
/// shrunk. Then one that does not say its size - usually an `.ico` holding several -
/// and last the largest of those smaller than the box.
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
fn score(declared: &Declared) -> u64 {
    let sizes = declared.sizes.to_ascii_lowercase();
    let scales = sizes.split_whitespace().any(|one| one == "any")
        || declared.r#type.eq_ignore_ascii_case("image/svg+xml")
        || declared
            .href
            .split(['?', '#'])
            .next()
            .is_some_and(|path| path.to_ascii_lowercase().ends_with(".svg"));
    if scales {
        return 4_000_000;
    }

    let widths = || {
        sizes
            .split_whitespace()
            .filter_map(|one| one.split_once('x'))
            .filter_map(|(wide, _)| wide.parse::<u32>().ok())
    };

    if let Some(fits) = widths().filter(|&wide| wide >= WANT).min() {
        return 3_000_000 - u64::from(fits.min(1_000_000));
    }

    match widths().max() {
        Some(wide) => 1_000_000 + u64::from(wide),
        None => 2_000_000,
    }
}

/// Whether a `rel` holds the one word asked for: `shortcut icon` names an `icon`, and
/// `apple-touch-icon` does not.
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
fn names(rel: &str, word: &str) -> bool {
    rel.split_ascii_whitespace()
        .any(|one| one.eq_ignore_ascii_case(word))
}

/// The one mark worth drawing out of everything a page declares, the way a browser
/// chooses it: the best `rel=icon` for the box, the last declared where two are as
/// good - a page that adds one with a script means the newer one - Apple's home screen
/// picture where the page declares nothing else, and the site's `/favicon.ico` where
/// it declares nothing at all.
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
pub fn best(declaring: &Declaring) -> Option<String> {
    let usable = |one: &&Declared| {
        let href = one.href.to_ascii_lowercase();
        href.starts_with("https:") || href.starts_with("http:") || href.starts_with("data:image/")
    };
    let pick = |word: &str| {
        declaring
            .links
            .iter()
            .filter(|one| names(&one.rel, word))
            .filter(usable)
            .enumerate()
            .max_by_key(|(at, one)| (score(one), *at))
            .map(|(_, one)| one.href.clone())
    };

    pick("icon")
        .or_else(|| pick("apple-touch-icon"))
        .or_else(|| pick("apple-touch-icon-precomposed"))
        .or_else(|| {
            let page = tauri::Url::parse(&declaring.page).ok()?;
            matches!(page.scheme(), "http" | "https")
                .then(|| page.join("/favicon.ico").ok())
                .flatten()
                .map(String::from)
        })
}

/// Starts following one page's mark. Called on the window's thread, once, as the page
/// is built; `window` is the label of the window the page is in.
///
/// Asked once straight away as well, because a page that had its mark before this was
/// listening would otherwise wear nothing until it changed it.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
pub fn listen(
    webview: &tauri::webview::PlatformWebview,
    app: AppHandle,
    tab: String,
    window: String,
) {
    use webview2_com::FaviconChangedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15;
    use windows_core::Interface as _;

    // Safe: the controller is the one this window owns, every object below is used only
    // on this thread, and the handler outlives the call because WebView2 holds it. A
    // runtime too old to have favicons at all leaves the tab its file's mark.
    unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core) = core.cast::<ICoreWebView2_15>() else {
            return;
        };

        let telling = Telling {
            app,
            tab,
            window,
            asked: std::rc::Rc::default(),
            turn: 0,
        };

        let changed = telling.clone();
        let handler = FaviconChangedEventHandler::create(Box::new(move |sender, _args| {
            if let Some(core) = sender.and_then(|one| one.cast::<ICoreWebView2_15>().ok()) {
                fetch(&core, changed.again());
            }
            Ok(())
        }));

        let mut token = 0i64;
        let _ = core.add_FaviconChanged(&handler, &raw mut token);
        fetch(&core, telling.again());
    }
}

/// Who hears a page's mark, and which asking an answer belongs to.
#[cfg(all(windows, not(feature = "cef")))]
#[derive(Clone)]
struct Telling {
    app: AppHandle,
    tab: String,
    window: String,
    /// How many times this page's mark has been asked for. The page's read and the
    /// engine's copy each take their own time, so a mark redrawn twice in quick
    /// succession can be answered out of order; only the latest asking is said.
    asked: std::rc::Rc<std::cell::Cell<u64>>,
    /// Which asking this is.
    turn: u64,
}

#[cfg(all(windows, not(feature = "cef")))]
impl Telling {
    /// The next asking, which every earlier one gives way to.
    fn again(&self) -> Self {
        let turn = self.asked.get() + 1;
        self.asked.set(turn);
        Self {
            turn,
            ..self.clone()
        }
    }

    /// Says the mark, unless the page has been asked again since.
    fn tell(&self, icon: &str) {
        if self.asked.get() == self.turn {
            said(&self.app, &self.window, &self.tab, icon);
        }
    }
}

/// The picture the engine chose for the page now, at the resolution the site drew it,
/// and the window told when it arrives.
///
/// **Why not `GetFavicon` alone.** It hands over the picture already scaled to sixteen
/// pixels - measured, on a screen at twice that - so a mark drawn from it is blurred on
/// exactly the screens a mark is looked at on. The engine's choice of which picture to
/// fetch is the right one, a size that fills the box on this screen, and `FaviconUri`
/// says what it chose. So that address is read again inside the page - in nib's own
/// world there, which the page cannot see - where the site's cookies and its own origin
/// are, and the bytes come back as they were served; see
/// `FETCH`. Where the page will not hand them over - a mark on another origin that does
/// not allow reading it, or a page whose policy forbids the request - the engine's own
/// sixteen pixels are the answer, and those always arrive.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
fn fetch(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15, told: Telling) {
    // Safe: a string the engine allocated for this call, taken and freed here.
    let uri = unsafe {
        let mut uri = windows_core::PWSTR::null();
        match core.FaviconUri(&raw mut uri) {
            Ok(()) => webview2_com::take_pwstr(uri),
            Err(_) => String::new(),
        }
    };

    // No address is a page with no mark at all - or one that has not got that far yet -
    // and is said as none rather than asked of the engine, which would answer with a
    // picture of nothing.
    if uri.is_empty() {
        told.tell("");
        return;
    }

    // A mark written into the page is already the picture.
    if let Some(icon) = picture(&uri) {
        told.tell(&icon);
        return;
    }

    if !(uri.starts_with("https:") || uri.starts_with("http:")) {
        decoded(core, told);
        return;
    }

    // In nib's own world rather than the page's, so a page that has wrapped `fetch` - to
    // log it, retry it, or route it through its own worker - neither sees this read nor
    // changes what it answers; see web_worlds.rs.
    let fallback = core.clone();
    crate::web_worlds::evaluate(core, fetching(&uri), move |answer| {
        match answer.as_deref().and_then(read_back) {
            Some(icon) => told.tell(&icon),
            None => decoded(&fallback, told),
        }
    });
}

/// The engine's own picture of the page's mark, sixteen pixels square, and the window
/// told when it arrives. A page with none is told as none, so a tab that followed a
/// link to a site without a mark stops wearing the last site's.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
fn decoded(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15, told: Telling) {
    use webview2_com::GetFaviconCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG;

    let handler = GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
        let icon = result
            .ok()
            .and(stream)
            .and_then(|stream| crate::web_tabs::read_stream(&stream))
            .and_then(|png| data_url(&png))
            .unwrap_or_default();
        told.tell(&icon);
        Ok(())
    }));

    // Safe: the engine holds the handler until it answers, on this same thread.
    unsafe {
        let _ = core.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG, &handler);
    }
}

/// Reads the mark the engine chose, inside the page: from the page's own origin, with
/// its cookies where the mark is on that origin, and out of the cache the engine has just
/// filled. The answer is a `data:` address or nothing. `__URI__` is the address, as a
/// JSON string.
///
/// Cookies go to the page's own origin and no other - the fetch's own default - because
/// a mark on a shared host answers anybody with `Access-Control-Allow-Origin: *`, which
/// the engine refuses for a request that carries credentials: Google's editors keep
/// theirs on `ssl.gstatic.com`, and asked with cookies it was refused every time, in red
/// in the page's own console.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const FETCH: &str = r"(async () => {
  try {
    const answer = await fetch(__URI__, { cache: 'force-cache' })
    if (!answer.ok) return ''
    const body = await answer.blob()
    if (!/^image\//.test(body.type) || body.size > __LARGEST__) return ''
    return await new Promise((done) => {
      const reader = new FileReader()
      reader.onload = () => done(String(reader.result))
      reader.onerror = () => done('')
      reader.readAsDataURL(body)
    })
  } catch (error) {
    return ''
  }
})()";

/// `FETCH` for one address: what the protocol's own evaluation is asked to run, because
/// it waits for a promise and a plain script does not.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn fetching(uri: &str) -> String {
    let address = serde_json::to_string(uri).unwrap_or_else(|_| "''".into());
    FETCH
        .replace("__URI__", &address)
        .replace("__LARGEST__", &LARGEST.to_string())
}

/// The picture out of the protocol's answer to `fetching`, or nothing.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn read_back(answer: &str) -> Option<String> {
    let said: serde_json::Value = serde_json::from_str(answer).ok()?;
    picture(said.pointer("/result/value")?.as_str()?)
}

/// An address that is a picture the window may draw as it stands, or nothing.
///
/// The page wrote it, so it is taken as the page's word and no more: a picture of a
/// kind an `<img>` draws, in base64, of a size worth keeping in a file. An SVG among
/// them is safe to draw, because an `<img>` never runs what is in one.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn picture(address: &str) -> Option<String> {
    const KINDS: [&str; 9] = [
        "png",
        "jpeg",
        "gif",
        "webp",
        "avif",
        "bmp",
        "svg+xml",
        "x-icon",
        "vnd.microsoft.icon",
    ];

    let (head, body) = address.strip_prefix("data:image/")?.split_once(',')?;
    let (kind, encoding) = head.split_once(';')?;
    let fits = address.len() <= LARGEST * 4 / 3 + 64;
    let base64 = body
        .bytes()
        .all(|one| one.is_ascii_alphanumeric() || matches!(one, b'+' | b'/' | b'='));

    (KINDS.contains(&kind.to_ascii_lowercase().as_str())
        && encoding.eq_ignore_ascii_case("base64")
        && !body.is_empty()
        && base64
        && fits)
        .then(|| address.to_string())
}

/// Every other engine is asked by the page it drew; see the top of this file.
#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(test)]
mod tests {
    use super::{best, data_url, fetching, picture, read_back, Declared, Declaring};

    fn link(rel: &str, href: &str, sizes: &str, kind: &str) -> Declared {
        Declared {
            rel: rel.into(),
            href: href.into(),
            sizes: sizes.into(),
            r#type: kind.into(),
        }
    }

    fn on(links: Vec<Declared>) -> Option<String> {
        best(&Declaring {
            page: "https://a.example/deep/page?x=1".into(),
            links,
        })
    }

    #[test]
    fn a_page_that_declares_nothing_wears_its_site_s_favicon_ico() {
        assert_eq!(on(vec![]).as_deref(), Some("https://a.example/favicon.ico"));
        let stylesheet = link("stylesheet", "https://a.example/s.css", "", "");
        assert_eq!(
            on(vec![stylesheet]).as_deref(),
            Some("https://a.example/favicon.ico")
        );
    }

    #[test]
    fn a_page_the_app_cannot_name_wears_nothing() {
        let blank = Declaring {
            page: "about:blank".into(),
            links: vec![],
        };
        assert_eq!(best(&blank), None);
    }

    #[test]
    fn the_smallest_picture_that_fills_the_box_wins() {
        let links = vec![
            link("icon", "https://a.example/16.png", "16x16", ""),
            link("icon", "https://a.example/192.png", "192x192", ""),
            link("icon", "https://a.example/48.png", "48x48", ""),
            link("icon", "https://a.example/32.png", "32x32", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/32.png"));
    }

    #[test]
    fn a_drawing_that_scales_beats_every_picture() {
        let links = vec![
            link("icon", "https://a.example/32.png", "32x32", ""),
            link("icon", "https://a.example/mark.svg?v=2", "", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/mark.svg?v=2"));

        let typed = vec![
            link("icon", "https://a.example/mark", "", "image/svg+xml"),
            link("icon", "https://a.example/32.png", "32x32", ""),
        ];
        assert_eq!(on(typed).as_deref(), Some("https://a.example/mark"));
    }

    #[test]
    fn an_unsized_icon_beats_one_too_small_for_the_box() {
        let links = vec![
            link("shortcut icon", "https://a.example/favicon.ico", "", ""),
            link("icon", "https://a.example/16.png", "16x16", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/favicon.ico"));
    }

    // web.whatsapp.com's own shape: the page declares one, and its script adds another
    // after the page has loaded. Two as good as each other go to the newer.
    #[test]
    fn of_two_as_good_the_one_declared_last_wins() {
        let links = vec![
            link("shortcut icon", "https://static.example/a.webp", "", ""),
            link(
                "apple-touch-icon",
                "https://static.example/192.webp",
                "192x192",
                "",
            ),
            link("icon", "https://a.example/favicon/1x/", "", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/favicon/1x/"));
    }

    #[test]
    fn apple_s_picture_only_where_there_is_nothing_else() {
        let only = vec![link(
            "apple-touch-icon",
            "https://a.example/touch.png",
            "180x180",
            "",
        )];
        assert_eq!(on(only).as_deref(), Some("https://a.example/touch.png"));

        let both = vec![
            link(
                "apple-touch-icon",
                "https://a.example/touch.png",
                "180x180",
                "",
            ),
            link("icon", "https://a.example/16.png", "16x16", ""),
        ];
        assert_eq!(on(both).as_deref(), Some("https://a.example/16.png"));
    }

    #[test]
    fn a_mark_written_into_the_page_counts_and_other_schemes_do_not() {
        let inline = vec![link("icon", "data:image/png;base64,AAAA", "", "")];
        assert_eq!(on(inline).as_deref(), Some("data:image/png;base64,AAAA"));

        let local = vec![link("icon", "blob:https://a.example/1", "", "")];
        assert_eq!(on(local).as_deref(), Some("https://a.example/favicon.ico"));
    }

    #[test]
    fn a_png_travels_as_an_address_and_nothing_else_does() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        assert_eq!(
            data_url(&png).as_deref(),
            Some("data:image/png;base64,iVBORw0KGgoBAgM=")
        );
        assert_eq!(data_url(b"GIF89a"), None);
        assert_eq!(data_url(&[]), None);

        let poster = [png.as_slice(), &vec![0u8; 64 * 1024]].concat();
        assert_eq!(data_url(&poster), None);
    }

    #[test]
    fn a_picture_the_page_wrote_is_drawn_as_it_stands() {
        for said in [
            "data:image/png;base64,iVBORw0KGgo=",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "data:image/vnd.microsoft.icon;base64,AAABAA==",
        ] {
            assert_eq!(picture(said).as_deref(), Some(said));
        }
    }

    #[test]
    fn anything_else_the_page_says_is_not_a_picture() {
        for said in [
            "",
            "https://a.example/favicon.ico",
            "data:text/html;base64,PHNjcmlwdD4=",
            "data:image/png,rawbytes",
            "data:image/png;base64,",
            "data:image/png;base64,\"><script>",
            "javascript:alert(1)",
        ] {
            assert_eq!(picture(said), None, "{said}");
        }

        let poster = format!("data:image/png;base64,{}", "A".repeat(200 * 1024));
        assert_eq!(picture(&poster), None);
    }

    #[test]
    fn the_address_reaches_the_page_as_a_string_and_nothing_more() {
        let expression = fetching(r#"https://a.example/i.png?x='1'&y="2""#);
        assert!(expression.contains(r#"fetch("https://a.example/i.png?x='1'&y=\"2\"", "#));
        assert!(!expression.contains("__URI__") && !expression.contains("__LARGEST__"));
    }

    #[test]
    fn the_page_s_answer_is_read_back_as_a_picture_or_nothing() {
        let png = "data:image/png;base64,iVBORw0KGgo=";
        let answer = format!(r#"{{"result":{{"type":"string","value":"{png}"}}}}"#);
        assert_eq!(read_back(&answer).as_deref(), Some(png));

        assert_eq!(
            read_back(r#"{"result":{"type":"string","value":""}}"#),
            None
        );
        assert_eq!(
            read_back(r#"{"result":{"type":"object"},"exceptionDetails":{}}"#),
            None
        );
        assert_eq!(read_back("not json"), None);
    }
}
