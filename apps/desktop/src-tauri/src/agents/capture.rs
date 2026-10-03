//! A page put into a note, for the window's `capture_to_note` (docs/agent-native.md 5.4).
//!
//! The note is the window's to write, and the page is the engine's to read, so the
//! window asks here for the page (`agents_capture`) and writes what it is answered: the
//! article for a clip, which it turns into the clip's markdown with the clipper's own
//! converter; a picture; a PDF. Either kind of tab, through the same gate as every
//! browser verb - the agent's own, or the reader's with `browser.reader` in a space it
//! may reach, never another agent's - so the reader taking the tab back, a dialog the
//! page is holding and a site the agent is kept from all answer here as they do there.
//!
//! What the page must not give up it does not give up here either (9.4): the clip is
//! read in nib's own world with no field's value in it, the picture has every filled
//! secret field painted over, and a page holding one is not printed at all.
//!
//! **The log.** Nothing is written here: the call is the agent's `capture_to_note`,
//! which the endpoint writes by the status the window answers it with, and the window
//! answers with this answer's own code. So a capture the reader's password field
//! refused is `error (password_field)` in the log, not a failure of the window's.

use tauri::AppHandle;

use super::grants::Scope;
use super::verbs::{Answer, CaptureAs, Code};
use super::Caller;
use crate::pdf::PdfPage;

/// The window's verb this answers for: the scope its row names, and what the activity
/// panel says the agent is doing.
const VERB: &str = "capture_to_note";

/// What the window asked for beyond the tab.
pub struct Asked {
    /// Which of the three.
    pub shape: CaptureAs,
    /// The whole page rather than the tab as it shows, for a picture.
    pub full_page: bool,
    /// The reader's paper, for a PDF: their own page setup, as their PDF export uses.
    pub paper: Option<PdfPage>,
}

/// The page in `tab`, captured, or why not.
pub fn answer(app: &AppHandle, caller: &Caller, tab: &str, asked: Asked) -> Answer {
    if let Err(refused) = may_capture(caller, &asked) {
        return refused;
    }
    taken(app, caller, tab, asked)
}

/// Whether this caller may capture at all, before any tab is looked at: nothing runs
/// while the stop is pressed, the window verb's own row must be held (which is the
/// scope `capture_to_note` needs), and so must a browser.
fn may_capture(caller: &Caller, asked: &Asked) -> Result<(), Answer> {
    if super::stop::stopped() {
        return Err(Answer::error(
            Code::Stopped,
            "the reader pressed the stop: nothing runs until they resume",
        ));
    }
    super::may_ask_the_window(caller, VERB).map_err(|why| Answer::error(Code::NotGranted, why))?;
    if !caller.holds(Scope::Browser) && !caller.holds(Scope::BrowserReader) {
        return Err(Answer::error(
            Code::NotGranted,
            "this agent was not granted the browser",
        ));
    }
    if asked.shape == CaptureAs::Pdf && asked.paper.is_none() {
        return Err(no_paper());
    }
    Ok(())
}

fn no_paper() -> Answer {
    Answer::error(Code::BadArguments, "a PDF needs the paper it is printed on")
}

/// The page read through the engine, where the engine can be asked.
#[cfg(any(windows, feature = "cef"))]
fn taken(app: &AppHandle, caller: &Caller, tab: &str, asked: Asked) -> Answer {
    use super::verbs::Captured;

    // An agent's own tab needs the scope for tabs of its own, whatever else it holds;
    // a reader's needs `browser.reader`, which the gate asks.
    if super::tabs::find(caller.id(), tab).is_some() && !caller.holds(Scope::Browser) {
        return Answer::error(
            Code::NotGranted,
            "this agent was not granted tabs of its own",
        );
    }
    let since = super::stop::generation();
    super::browser::on_tab(app, caller, tab, VERB, since, false, |_, page| {
        let url = page.url();
        let captured = match asked.shape {
            CaptureAs::Clip => page.clip().map(|(url, title, html)| Captured {
                url,
                title,
                html: Some(html),
                ..Captured::default()
            }),
            CaptureAs::Screenshot => {
                page.screenshot(None, asked.full_page, None)
                    .map(|picture| Captured {
                        url: url.clone(),
                        title: page.title(),
                        png: Some(picture.png),
                        ..Captured::default()
                    })
            }
            CaptureAs::Pdf => asked
                .paper
                .as_ref()
                .ok_or_else(no_paper)
                .and_then(|paper| page.pdf(paper))
                .map(|pdf| Captured {
                    url: url.clone(),
                    title: page.title(),
                    pdf: Some(pdf),
                    ..Captured::default()
                }),
        };
        match captured {
            Ok(captured) => Answer::Ok {
                result: serde_json::to_value(captured).unwrap_or_default(),
                untrusted: Some(url),
                dialog: None,
            },
            Err(refused) => refused,
        }
    })
}

/// Every other engine: no honest way yet (section 12). The window clips a reader's tab
/// the clip button's way there, and takes no picture it could not paint over.
#[cfg(not(any(windows, feature = "cef")))]
fn taken(_app: &AppHandle, _caller: &Caller, _tab: &str, _asked: Asked) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        "capturing a page is not available on this engine yet",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::grants::Grant;

    fn asked(shape: CaptureAs) -> Asked {
        Asked {
            shape,
            full_page: false,
            paper: Some(PdfPage {
                width: 8.27,
                height: 11.69,
                margin: 0.787,
                landscape: false,
            }),
        }
    }

    fn agent(scopes: &[Scope]) -> Caller {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes = scopes.to_vec();
        Caller::Agent(Box::new(grant))
    }

    fn code(refused: Result<(), Answer>) -> Option<Code> {
        match refused {
            Err(Answer::Error { code, .. }) => Some(code),
            _ => None,
        }
    }

    #[test]
    fn a_capture_needs_what_capture_to_note_needs_and_a_browser() {
        let clip = asked(CaptureAs::Clip);
        // Writing notes is capture_to_note's own row.
        assert_eq!(
            code(may_capture(&agent(&[Scope::Browser]), &clip)),
            Some(Code::NotGranted)
        );
        // And a browser, of its own or the reader's.
        assert_eq!(
            code(may_capture(&agent(&[Scope::NotesWrite]), &clip)),
            Some(Code::NotGranted)
        );
        assert!(may_capture(&agent(&[Scope::NotesWrite, Scope::Browser]), &clip).is_ok());
        assert!(may_capture(&agent(&[Scope::NotesWrite, Scope::BrowserReader]), &clip).is_ok());
        // The reader's own command line holds every scope.
        assert!(may_capture(&Caller::Reader, &clip).is_ok());
    }

    #[test]
    fn a_pdf_needs_the_paper() {
        let mut pdf = asked(CaptureAs::Pdf);
        assert!(may_capture(&Caller::Reader, &pdf).is_ok());
        pdf.paper = None;
        assert_eq!(
            code(may_capture(&Caller::Reader, &pdf)),
            Some(Code::BadArguments)
        );
        // A picture and a clip are printed on nothing.
        let mut shot = asked(CaptureAs::Screenshot);
        shot.paper = None;
        assert!(may_capture(&Caller::Reader, &shot).is_ok());
    }

    #[test]
    fn the_shapes_are_the_windows_words() {
        for (shape, word) in [
            (CaptureAs::Clip, "clip"),
            (CaptureAs::Screenshot, "screenshot"),
            (CaptureAs::Pdf, "pdf"),
        ] {
            assert_eq!(serde_json::to_value(shape).expect("a word"), word);
            assert_eq!(
                serde_json::from_value::<CaptureAs>(word.into()).expect("a shape"),
                shape
            );
        }
        assert!(serde_json::from_value::<CaptureAs>("link".into()).is_err());
    }
}
