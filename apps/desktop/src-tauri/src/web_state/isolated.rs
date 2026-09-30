//! Running dump.js and restore.js in a page without the page seeing them.
//!
//! An isolated world is a second JavaScript global on the same document: it shares the
//! DOM and the origin's storage with the page's own scripts and nothing else, so a site
//! can neither read what the dump reads out nor change it on the way, and the names the
//! scripts define never reach the page. Each engine has one:
//!
//! | engine | world |
//! | --- | --- |
//! | `WebView2` | `Page.createIsolatedWorld`, then `Runtime.evaluate` in it, over the `DevTools` Protocol |
//! | `WKWebView` | a `WKContentWorld` named `nib-state`, through `callAsyncJavaScript` (macOS 11) |
//! | `WebKitGTK` | a script world named `nib-state`, through `call_async_javascript_function` (2.40) |
//!
//! None falls back to the page's own world. Every call is one program: the script's own
//! source, which defines its one name on the world's global, and then the call, whose
//! promise the engine waits for; what comes back is the string the call answered.

use tauri::Webview;

/// What the worlds are called, which is what a web inspector shows them as.
const WORLD: &str = "nib-state";

/// Runs `source`, then `call`, in an isolated world of the page in `view`, and answers
/// the string `call`'s promise resolved to.
pub(crate) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
    engine::run(view, source, call).await
}

#[cfg(windows)]
mod engine {
    use serde_json::json;
    use tauri::Webview;

    use super::super::cdp;
    use super::WORLD;

    pub(super) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
        let tree = cdp::call(view, "Page.getFrameTree", &json!({})).await?;
        let frame = tree["frameTree"]["frame"]["id"]
            .as_str()
            .ok_or("the page has no frame to run in")?;

        let world = cdp::call(
            view,
            "Page.createIsolatedWorld",
            &json!({ "frameId": frame, "worldName": WORLD, "grantUniveralAccess": false }),
        )
        .await?;
        let context = world["executionContextId"]
            .as_i64()
            .ok_or("the page made no world to run in")?;

        let answered = cdp::call(
            view,
            "Runtime.evaluate",
            &json!({
                "expression": format!("{source}\n;{call}"),
                "contextId": context,
                "awaitPromise": true,
                "returnByValue": true,
            }),
        )
        .await?;

        if let Some(thrown) = answered.get("exceptionDetails") {
            let said = thrown["exception"]["description"]
                .as_str()
                .or_else(|| thrown["text"].as_str())
                .unwrap_or("the script failed");
            return Err(said.to_owned());
        }
        answered["result"]["value"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "the script answered nothing".to_owned())
    }
}

#[cfg(target_os = "macos")]
mod engine {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use tauri::Webview;

    use super::super::answer::{answer, Reply};
    use super::WORLD;

    #[allow(
        unsafe_code,
        reason = "WKWebView's content worlds are reached through its Objective-C interface, from the pointer wry hands out"
    )]
    pub(super) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
        let body = format!("{source}\nreturn await {call}");
        answer("a script", |reply: Reply<String>| {
            view.with_webview(move |platform| {
                let Some(mtm) = MainThreadMarker::new() else {
                    reply.say(Err("not on the window's thread".to_owned()));
                    return;
                };
                // SAFETY: the pointer is the WKWebView wry built for this page, alive while
                // the page is; retaining it keeps it so for the call, on the main thread.
                let Some(web) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) })
                else {
                    reply.say(Err("the page has gone".to_owned()));
                    return;
                };
                let world =
                    unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) };
                let answered = reply.clone();
                let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                    // SAFETY: the engine hands this block either an error or a value,
                    // each alive for the call.
                    let said = unsafe {
                        if let Some(error) = error.as_ref() {
                            Err(error.localizedDescription().to_string())
                        } else {
                            value
                                .as_ref()
                                .and_then(|value| value.downcast_ref::<NSString>())
                                .map(ToString::to_string)
                                .ok_or_else(|| "the script answered nothing".to_owned())
                        }
                    };
                    answered.say(said);
                });
                // SAFETY: on the main thread, with the webview's own world; the engine
                // copies the block and calls it once.
                unsafe {
                    web.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                        &NSString::from_str(&body),
                        None,
                        None,
                        &world,
                        Some(&done),
                    );
                }
            })
            .map_err(|error| error.to_string())
        })
        .await
    }
}

#[cfg(target_os = "linux")]
mod engine {
    use javascriptcore::ValueExt as _;
    use tauri::Webview;
    use webkit2gtk::WebViewExt as _;

    use super::super::answer::{answer, Reply};
    use super::WORLD;

    pub(super) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
        let body = format!("{source}\nreturn await {call}");
        answer("a script", |reply: Reply<String>| {
            view.with_webview(move |platform| {
                platform.inner().call_async_javascript_function(
                    &body,
                    None,
                    Some(WORLD),
                    None,
                    None::<&webkit2gtk::gio::Cancellable>,
                    move |result| {
                        reply.say(match result {
                            Ok(value) if value.is_string() => Ok(value.to_str().to_string()),
                            Ok(_) => Err("the script answered nothing".to_owned()),
                            Err(error) => Err(error.to_string()),
                        });
                    },
                );
            })
            .map_err(|error| error.to_string())
        })
        .await
    }
}
