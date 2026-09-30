//! A web note's sessionStorage, put back into its tab: a form or a wizard half way
//! through, as Chrome brings it back for a restored tab.
//!
//! sessionStorage belongs to one tab, so no hidden page can hold it for another; it is
//! written into the tab itself, which is then loaded again so the site starts from it.
//!
//! | engine | how |
//! | --- | --- |
//! | `WebView2` | a script at the start of the next document (`AddScriptToExecuteOnDocumentCreated`), guarded by the origin, before any of the site's own; the page is reloaded and the script taken away again once that load is done |
//! | `WKWebView`, `WebKitGTK` | written through the tab's isolated world (restore.js), then the page is reloaded |
//!
//! The second is a load the site has already run once without its sessionStorage, which
//! is the honest difference; the first never is.

use tauri::Webview;

/// Seeds `items` into the sessionStorage the tab in `view` has for `origin`, and reloads
/// its page so the site starts from them.
pub(crate) async fn seed(
    view: &Webview,
    origin: &str,
    items: &[(String, String)],
) -> Result<(), String> {
    engine::seed(view, origin, items).await
}

#[cfg(windows)]
mod engine {
    use std::cell::Cell;
    use std::rc::Rc;

    use tauri::Webview;
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler, NavigationCompletedEventHandler,
    };
    use windows_core::HSTRING;

    use super::super::answer::{answer, Reply};

    /// The script that seeds the storage at a document's start, only on `origin`.
    pub(super) fn script(origin: &str, items: &[(String, String)]) -> Result<String, String> {
        let origin = serde_json::to_string(origin).map_err(|error| error.to_string())?;
        let items = serde_json::to_string(items).map_err(|error| error.to_string())?;
        Ok(format!(
            "(function () {{\n  if (location.origin !== {origin}) return\n  try {{\n    \
             sessionStorage.clear()\n    for (const [key, value] of {items}) \
             sessionStorage.setItem(key, value)\n  }} catch (error) {{}}\n}})()"
        ))
    }

    #[allow(
        unsafe_code,
        reason = "a script at a document's start and the load that runs it are WebView2's COM interfaces, which have no safe wrapper"
    )]
    pub(super) async fn seed(
        view: &Webview,
        origin: &str,
        items: &[(String, String)],
    ) -> Result<(), String> {
        let source = script(origin, items)?;
        answer("seeding the tab", |reply: Reply<()>| {
            view.with_webview(move |platform| {
                let failed = reply.clone();
                // Safe throughout: the controller and its webview are this tab's own, every
                // handler is held by the engine until it runs, and all of it is on the
                // window's thread.
                let asked = unsafe {
                    platform.controller().CoreWebView2().and_then(|core| {
                        let reloading = core.clone();
                        let added = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                            Box::new(move |result, id| {
                                if let Err(error) = result {
                                    reply.say(Err(error.message()));
                                    return Ok(());
                                }
                                let token = Rc::new(Cell::new(0i64));
                                let held = token.clone();
                                let told = reply.clone();
                                let done = NavigationCompletedEventHandler::create(Box::new(
                                    move |sender, _args| {
                                        if let Some(core) = sender {
                                            let _ = core.RemoveScriptToExecuteOnDocumentCreated(
                                                &HSTRING::from(id.as_str()),
                                            );
                                            let _ = core.remove_NavigationCompleted(held.get());
                                        }
                                        told.say(Ok(()));
                                        Ok(())
                                    },
                                ));
                                let mut registered = 0i64;
                                let reloaded = reloading
                                    .add_NavigationCompleted(&done, &raw mut registered)
                                    .and_then(|()| {
                                        token.set(registered);
                                        reloading.Reload()
                                    });
                                if let Err(error) = reloaded {
                                    reply.say(Err(error.message()));
                                }
                                Ok(())
                            }),
                        );
                        core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(source), &added)
                    })
                };
                if let Err(error) = asked {
                    failed.say(Err(error.message()));
                }
            })
            .map_err(|error| error.to_string())
        })
        .await
    }

    #[cfg(test)]
    mod tests {
        use super::script;

        /// The origin and the items go in as JSON literals, so nothing in a value can end
        /// the string it is in.
        #[test]
        fn the_seed_quotes_what_it_carries() {
            let made = script(
                "https://ethz.ch",
                &[("a\"b".to_owned(), "</script>\u{2028}'".to_owned())],
            )
            .expect("a script");
            assert!(made.contains(r#"location.origin !== "https://ethz.ch""#));
            assert!(made.contains(r#"[["a\"b","</script>"#));
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod engine {
    use tauri::Webview;

    use super::super::isolated;
    use super::super::RESTORE;

    pub(super) async fn seed(
        view: &Webview,
        origin: &str,
        items: &[(String, String)],
    ) -> Result<(), String> {
        let on = view
            .url()
            .map(|url| url.origin().ascii_serialization())
            .map_err(|error| error.to_string())?;
        if on != origin {
            return Err(format!("the tab is not on {origin}"));
        }
        let items = serde_json::to_string(items).map_err(|error| error.to_string())?;
        let call = format!(
            "nibRestore('session', {})",
            serde_json::to_string(&items).map_err(|error| error.to_string())?
        );
        isolated::run(view, RESTORE, &call).await?;
        view.reload().map_err(|error| error.to_string())
    }
}
