//! The agents' own tabs as pictures, for the activity panel (docs/agent-native.md 6.6).
//!
//! The engine's own screencast (`Page.startScreencast`): JPEG, 480 pixels wide, sent to
//! the window on `nib://agent-frame` while the panel is open and not at all while it is
//! closed. A picture rather than the page, because a picture takes no input - watching
//! can never be interacting by accident. The page keeps rendering out of sight, so the
//! frames are real; a hidden page would have none (section 3).
//!
//! **At most one frame every fifth of a second a tab.** The engine sends the next frame
//! only while few enough are waiting to be acknowledged, so the acknowledgement is held
//! back a fifth of a second, and a frame that still comes sooner than that after the
//! last one sent is acknowledged and dropped: the engine keeps several in flight, and a
//! page ticking ten times a second was measured sending eight a second on the delay
//! alone. A page playing a video costs the window five pictures a second and no more,
//! and a page that does not change costs nothing, since the engine only sends a frame
//! when something was painted.
//!
//! The window names the tabs it wants, all of them at once, every time the list
//! changes; a tab it stops naming is stopped. The engine's event is heard once per page
//! for the page's whole life - its handler cannot be taken off again - and a frame of a
//! tab nobody is watching is dropped there and not acknowledged, which is what ends it.

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::AppHandle;

/// The event the pictures go out on.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has them to picture"
    )
)]
pub const FRAME_EVENT: &str = "nib://agent-frame";

/// The tabs being watched.
static WATCHED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// One picture of a tab.
#[derive(Clone, Serialize)]
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has them to picture"
    )
)]
struct Frame {
    /// The agent tab's id.
    tab: String,
    /// The picture, a JPEG, as base64.
    jpeg: String,
}

fn watched() -> std::sync::MutexGuard<'static, Option<HashSet<String>>> {
    WATCHED.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has them to picture"
    )
)]
fn is_watched(tab: &str) -> bool {
    watched().as_ref().is_some_and(|all| all.contains(tab))
}

/// Which agent tabs the activity panel wants pictures of: every one it names, and none
/// when it names none.
#[tauri::command]
pub fn agents_watch(
    webview: tauri::Webview,
    app: AppHandle,
    tabs: Vec<String>,
) -> Result<(), String> {
    super::from_the_app(&webview)?;
    let wanted: HashSet<String> = tabs.into_iter().collect();
    let was = watched().replace(wanted.clone()).unwrap_or_default();
    for tab in wanted.difference(&was) {
        engine::start(&app, tab);
    }
    for tab in was.difference(&wanted) {
        engine::stop(&app, tab);
    }
    Ok(())
}

/// A page that went - parked, or closed - is a page whose frames nobody hears any more:
/// the next one built under its label is heard afresh.
#[cfg(any(windows, feature = "cef"))]
pub fn forget(label: &str) {
    engine::forget(label);
}

#[cfg(any(windows, feature = "cef"))]
mod engine {
    use std::collections::{HashMap, HashSet};
    use std::sync::{Mutex, PoisonError};
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};
    use tauri::{AppHandle, Emitter as _};

    use super::{is_watched, Frame, FRAME_EVENT};
    use crate::agents::cdp;

    /// The least time between two frames of one tab.
    const BETWEEN: Duration = Duration::from_millis(200);

    /// When each tab's last frame was sent on.
    static SENT: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

    /// The pages whose frames are heard already.
    static HEARD: Mutex<Option<HashSet<String>>> = Mutex::new(None);

    fn label(tab: &str) -> String {
        format!("{}{tab}", crate::agents::tabs::LABEL)
    }

    /// Pictures of one tab, from now on.
    pub fn start(app: &AppHandle, tab: &str) {
        let label = label(tab);
        let Some(view) = crate::agents::engines::view(app, &label) else {
            // Parked: no page, so no pictures until the agent brings it back.
            return;
        };
        let first = HEARD
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashSet::new)
            .insert(label.clone());
        if first {
            let (app, tab, label) = (app.clone(), tab.to_string(), label.clone());
            cdp::listen(&view, "Page.screencastFrame", move |frame| {
                framed(&app, &tab, &label, &frame);
            });
        }
        cdp::tell(&view, "Page.enable", &json!({}));
        cdp::tell(
            &view,
            "Page.startScreencast",
            &json!({ "format": "jpeg", "quality": 60, "maxWidth": 480, "maxHeight": 300 }),
        );
    }

    /// Forgets that a page's frames are heard.
    pub fn forget(label: &str) {
        if let Some(all) = HEARD
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            all.remove(label);
        }
    }

    /// No more pictures of one tab.
    pub fn stop(app: &AppHandle, tab: &str) {
        if let Some(view) = crate::agents::engines::view(app, &label(tab)) {
            cdp::tell(&view, "Page.stopScreencast", &json!({}));
        }
    }

    /// One frame: sent on if the tab is watched and its last frame was long enough ago,
    /// and acknowledged `BETWEEN` later so the next can come.
    fn framed(app: &AppHandle, tab: &str, label: &str, frame: &Value) {
        if !is_watched(tab) {
            return;
        }
        let (Some(jpeg), Some(session)) = (
            frame.get("data").and_then(Value::as_str),
            frame.get("sessionId").and_then(Value::as_i64),
        ) else {
            return;
        };
        let due = {
            let mut sent = SENT.lock().unwrap_or_else(PoisonError::into_inner);
            let sent = sent.get_or_insert_with(HashMap::new);
            let due = sent.get(tab).is_none_or(|at| at.elapsed() >= BETWEEN);
            if due {
                sent.insert(tab.to_string(), Instant::now());
            }
            due
        };
        if due {
            let _ = app.emit(
                FRAME_EVENT,
                Frame {
                    tab: tab.to_string(),
                    jpeg: jpeg.to_string(),
                },
            );
        }
        let (app, label) = (app.clone(), label.to_string());
        std::thread::spawn(move || {
            std::thread::sleep(BETWEEN);
            if let Some(view) = crate::agents::engines::view(&app, &label) {
                cdp::tell(
                    &view,
                    "Page.screencastFrameAck",
                    &json!({ "sessionId": session }),
                );
            }
        });
    }
}

/// Every other engine has no agent tabs (section 12), and so nothing to picture.
#[cfg(not(any(windows, feature = "cef")))]
mod engine {
    use tauri::AppHandle;

    pub fn start(_app: &AppHandle, _tab: &str) {}

    pub fn stop(_app: &AppHandle, _tab: &str) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_named_tab_is_watched() {
        *watched() = Some(["a1".to_string()].into_iter().collect());
        assert!(is_watched("a1"));
        assert!(!is_watched("a2"));
        *watched() = None;
        assert!(!is_watched("a1"));
    }
}
