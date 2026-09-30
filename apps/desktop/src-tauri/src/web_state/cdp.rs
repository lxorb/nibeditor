//! The `DevTools` Protocol on a `WebView2` page, for a web state: the one door the crate
//! has to it, `agents/cdp.rs`, whose calls wait on the thread that makes them, taken
//! from a thread of the runtime's that may block, so a capture's command awaits them
//! like anything else.
//!
//! In-process, so there is no port for anything else on the machine to reach, and it
//! reaches only the page it is called on. Windows' alone; a Mac and Linux have APIs of
//! their own for the same things (see `cookies.rs` and `isolated.rs`).

use serde_json::Value;
use tauri::Webview;

use super::answer::PATIENCE;

/// Calls one `DevTools` method on the page in `view` and answers what it returned.
pub(crate) async fn call(view: &Webview, method: &str, params: &Value) -> Result<Value, String> {
    let (view, method, params) = (view.clone(), method.to_owned(), params.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::agents::cdp::call_in(&view, None, &method, &params, PATIENCE)
    })
    .await
    .map_err(|error| error.to_string())?
}
