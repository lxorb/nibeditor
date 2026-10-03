//! What colour a page stands on, read out of the page for the glass theme.
//!
//! Emil, 2026-10-01: *"glass theme is pretty ass right now, it should be based on
//! what's currently open, e.g. the website."* Under glass the frame takes its colour
//! from the page in front, the way Safari's tab bar does, and Safari's order is the one
//! asked here: the colour the page names for its browser (`<meta name="theme-color">`,
//! its `media` honoured), and otherwise what the page has painted along its top edge.
//!
//! **Read rather than photographed.** The top edge is read off the document at three
//! points, as the first element there with a ground of its own, walking out to the
//! root. That is the exact colour the page asked for, on every engine, for the price of
//! three style lookups. A photograph would be an engine capture and a decode for a
//! colour the page has already said in words. Where the top is a picture, or the three
//! points do not agree, the page says so and the window reads the still it already took
//! as the page landed instead; see lib/glass/reading.ts.
//!
//! Asked when a page finishes loading and when it moves to another address, never as it
//! is used. Every colour comes back in one spelling: a canvas's `fillStyle` is a parser
//! every engine has, and it answers `#rrggbb` for an opaque colour and `rgba()` for the
//! rest, whatever the page wrote.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// What the page says, read in its own document.
const TINT: &str = r#"(function () {
  try {
    var paint = document.createElement('canvas').getContext('2d')
    function said(colour) {
      if (!paint || !colour) return ''
      paint.fillStyle = '#000000'
      paint.fillStyle = colour
      var first = paint.fillStyle
      paint.fillStyle = '#ffffff'
      paint.fillStyle = colour
      return first === paint.fillStyle ? String(first) : ''
    }
    var theme = ''
    var named = document.querySelectorAll('meta[name="theme-color" i]')
    for (var at = 0; at < named.length && !theme; at++) {
      var media = named[at].getAttribute('media')
      if (media && !window.matchMedia(media).matches) continue
      theme = said(named[at].getAttribute('content') || '')
    }
    var top = []
    var pictured = false
    var root = document.documentElement
    var wide = root.clientWidth || window.innerWidth
    var scheme = getComputedStyle(root).colorScheme || ''
    var dark = /dark/.test(scheme) && (!/light/.test(scheme) || window.matchMedia('(prefers-color-scheme: dark)').matches)
    var points = [0.08, 0.5, 0.92]
    for (var point = 0; point < points.length; point++) {
      var found = ''
      var here = false
      for (var one = document.elementFromPoint(Math.round(wide * points[point]), 1); one && one.nodeType === 1; one = one.parentElement) {
        if (/^(img|video|canvas|iframe|picture|svg|embed|object)$/i.test(one.tagName)) {
          here = true
          break
        }
        var style = getComputedStyle(one)
        if (style.backgroundImage && style.backgroundImage !== 'none') {
          here = true
          break
        }
        var ground = said(style.backgroundColor)
        if (ground.charAt(0) === '#') {
          found = ground
          break
        }
      }
      pictured = pictured || here
      top.push(found || (here ? '' : dark ? '#121212' : '#ffffff'))
    }
    return { theme: theme, top: top, pictured: pictured }
  } catch (error) {
    return { theme: '', top: [], pictured: false }
  }
})()"#;

/// The longest colour worth reading: `rgba(255, 255, 255, 0.123456)` and some room.
const LONGEST: usize = 48;

/// How many points along the top edge are read.
const POINTS: usize = 3;

/// What the page said, as the window is told it.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Tinted {
    /// The colour the page names for its browser, or empty.
    #[serde(default)]
    theme: String,
    /// The colour at each point along the top edge, empty where it is a picture.
    #[serde(default)]
    top: Vec<String>,
    /// Whether a picture is what the top edge shows somewhere.
    #[serde(default)]
    pictured: bool,
}

impl Tinted {
    /// Only what a colour can be: the page answered in its own world and could have
    /// answered with anything, so a long string or a long list is cut to nothing.
    fn kept(self) -> Self {
        let short = |one: String| {
            if one.len() <= LONGEST {
                one
            } else {
                String::new()
            }
        };
        Self {
            theme: short(self.theme),
            top: self.top.into_iter().take(POINTS).map(short).collect(),
            pictured: self.pictured,
        }
    }
}

/// The page's answer, read; nothing at all for an answer that is not one.
fn read(answer: &str) -> Tinted {
    serde_json::from_str::<Tinted>(answer)
        .map(Tinted::kept)
        .unwrap_or_default()
}

/// What colour the page in a tab stands on; see the top of this file.
#[tauri::command]
pub async fn web_tint(app: AppHandle, tab: String) -> Result<Tinted, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);

    view.eval_with_callback(TINT, move |answer| {
        // One page, one answer: a full channel is an answer already sent.
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;
    Ok(read(&answer))
}

#[cfg(test)]
mod tests {
    use super::{read, Tinted, TINT};

    #[test]
    fn a_page_s_answer_is_read_as_it_was_given() {
        let said = read(r##"{"theme":"#ff0000","top":["#ffffff","#ffffff",""],"pictured":true}"##);
        assert_eq!(
            said,
            Tinted {
                theme: "#ff0000".into(),
                top: vec!["#ffffff".into(), "#ffffff".into(), String::new()],
                pictured: true,
            }
        );
    }

    #[test]
    fn an_answer_that_is_not_one_is_nothing() {
        assert_eq!(read("null"), Tinted::default());
        assert_eq!(read("not json"), Tinted::default());
        assert_eq!(read(r#"{"theme":7}"#), Tinted::default());
    }

    #[test]
    fn a_page_cannot_hand_back_more_than_a_colour() {
        let long = "x".repeat(4096);
        let many = vec!["#000000"; 50];
        let answer = serde_json::json!({ "theme": long, "top": many }).to_string();
        let said = read(&answer);
        assert!(said.theme.is_empty());
        assert_eq!(said.top.len(), 3);
    }

    #[test]
    fn the_script_asks_for_the_theme_colour_and_the_top_edge() {
        assert!(TINT.contains(r#"meta[name="theme-color" i]"#));
        assert!(TINT.contains("elementFromPoint"));
        assert!(TINT.contains("matchMedia(media)"));
    }
}
