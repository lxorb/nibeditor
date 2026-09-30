//! A page nobody sees, in the same store as a site's tabs, that is the site's origin and
//! runs none of the site's code: where a site's storage is written back, and read out
//! for an origin no tab is on.
//!
//! Playwright's `storageState` does the same thing the same way - a blank page whose
//! every request is answered with nothing, sent to each origin in turn - and this is
//! each engine's own form of it (docs/sync-v2.md 6.4):
//!
//! | engine | how the page becomes the origin |
//! | --- | --- |
//! | `WebView2` | sent to `<origin>/__nib_restore`, which `WebResourceRequested` answers with an empty page before any network is asked |
//! | `WKWebView` | `loadHTMLString("", baseURL: <origin>/__nib_restore)`, which runs as that origin |
//! | `WebKitGTK` | `load_html("", <origin>/__nib_restore)`, the same |
//!
//! The view is a child of the window that asked, a pixel wide, hidden from the moment
//! it exists and never given the keyboard, built through the same seam every web tab is
//! (`engine::web_store`), so it is in the store the tab would be in and shares its
//! browser process. It is closed when it is dropped.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::async_runtime::{channel, Receiver};
use tauri::webview::PageLoadEvent;
use tauri::{
    LogicalPosition, LogicalSize, Manager as _, Url, Webview, WebviewBuilder, WebviewUrl, Window,
};

use super::answer::PATIENCE;

/// The address every hidden page is sent to under an origin. Nothing on the network is
/// ever asked for it.
pub(crate) const PATH: &str = "/__nib_restore";

/// How many hidden views this run has made, for their labels.
static MADE: AtomicU64 = AtomicU64::new(0);

/// One hidden page, and the addresses it has finished loading.
pub(crate) struct Hidden {
    view: Webview,
    loads: Receiver<String>,
}

impl Hidden {
    /// Builds one in `store` (the one every space shares, for none), inside `window`.
    pub(crate) async fn open(window: &Window, store: Option<&str>) -> Result<Self, String> {
        let app = window.app_handle().clone();
        // Under the `web-` prefix every page of the web wears, so no capability names it
        // and a window's close makes its session cookies last like a tab's; see
        // web_tabs.rs and web_cookies.rs.
        let label = format!("web-state-{}", MADE.fetch_add(1, Ordering::Relaxed));
        let (loaded, loads) = channel(16);
        let blank: Url = "about:blank"
            .parse()
            .map_err(|_| "no blank page to start from".to_owned())?;

        let builder = WebviewBuilder::new(label, WebviewUrl::External(blank))
            .focused(false)
            .disable_drag_drop_handler()
            .on_page_load(move |_view, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    let _ = loaded.try_send(payload.url().to_string());
                }
            });
        let builder = crate::engine::web_store(builder, &app, store)?;

        // On the window's own thread, like a tab's page, and waited for there: see
        // `web_open` in web_tabs.rs for why a webview is never built anywhere else.
        let (made, mut waiting) = channel(1);
        let holder = window.clone();
        app.run_on_main_thread(move || {
            let built = holder
                .add_child(
                    builder,
                    LogicalPosition::new(0.0, 0.0),
                    LogicalSize::new(1.0, 1.0),
                )
                .map_err(|error| format!("no page could be made to restore into: {error}"));
            if let Ok(view) = &built {
                let _ = view.hide();
            }
            let _ = made.try_send(built);
        })
        .map_err(|error| error.to_string())?;

        let view = match tokio::time::timeout(PATIENCE, waiting.recv()).await {
            Ok(Some(built)) => built?,
            _ => return Err("no page could be made to restore into".to_owned()),
        };
        let hidden = Self { view, loads };
        engine::prepared(&hidden.view).await?;
        Ok(hidden)
    }

    /// The page, to run scripts in and to reach its store's cookies through.
    pub(crate) fn view(&self) -> &Webview {
        &self.view
    }

    /// Makes the page `origin`, empty, and waits until it is.
    pub(crate) async fn visit(&mut self, origin: &str) -> Result<(), String> {
        let address = format!("{origin}{PATH}");
        engine::show(&self.view, &address)?;
        loop {
            match tokio::time::timeout(PATIENCE, self.loads.recv()).await {
                Ok(Some(loaded)) if loaded.starts_with(&address) => return Ok(()),
                Ok(Some(_)) => {}
                _ => return Err(format!("{origin} could not be opened to restore into")),
            }
        }
    }
}

impl Drop for Hidden {
    fn drop(&mut self) {
        let _ = self.view.close();
    }
}

#[cfg(windows)]
mod engine {
    use tauri::{Url, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
    use webview2_com::WebResourceRequestedEventHandler;
    use windows_core::HSTRING;

    use super::super::answer::{answer, Reply};
    use super::PATH;

    /// Answers every request for the restore address in this view, under any origin,
    /// with an empty page, before the network is asked.
    #[allow(
        unsafe_code,
        reason = "WebView2's request interception is reached through its COM interfaces, which have no safe wrapper"
    )]
    pub(super) async fn prepared(view: &Webview) -> Result<(), String> {
        answer("the restore page", |reply: Reply<()>| {
            view.with_webview(move |platform| {
                let environment = platform.environment();
                let handler =
                    WebResourceRequestedEventHandler::create(Box::new(move |_sender, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };
                        // Safe: the environment is this view's own and the arguments are the
                        // engine's for this one request, both on the window's thread.
                        unsafe {
                            let response = environment.CreateWebResourceResponse(
                                None::<&windows_com::Win32::System::Com::IStream>,
                                200,
                                &HSTRING::from("OK"),
                                &HSTRING::from("Content-Type: text/html; charset=utf-8"),
                            )?;
                            args.SetResponse(&response)
                        }
                    }));

                // Safe: the controller is this view's own, the handler is held by the
                // engine for as long as the view is, and this runs on the window's thread.
                let installed = unsafe {
                    platform.controller().CoreWebView2().and_then(|core| {
                        core.AddWebResourceRequestedFilter(
                            &HSTRING::from(format!("*{PATH}")),
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        )?;
                        let mut token = 0i64;
                        core.add_WebResourceRequested(&handler, &raw mut token)
                    })
                };
                reply.say(installed.map_err(|error| error.message()));
            })
            .map_err(|error| error.to_string())
        })
        .await
    }

    pub(super) fn show(view: &Webview, address: &str) -> Result<(), String> {
        let url: Url = address
            .parse()
            .map_err(|_| format!("{address} is not an address"))?;
        view.navigate(url).map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
mod engine {
    use objc2::rc::Retained;
    use objc2_foundation::{NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use tauri::Webview;

    /// Nothing to set up: an HTML string with a base address is the origin already.
    #[allow(
        clippy::unused_async,
        reason = "one signature for every engine; WebView2's has something to wait for"
    )]
    pub(super) async fn prepared(_view: &Webview) -> Result<(), String> {
        Ok(())
    }

    #[allow(
        unsafe_code,
        reason = "loading a string as an origin is WKWebView's Objective-C interface, from the pointer wry hands out"
    )]
    pub(super) fn show(view: &Webview, address: &str) -> Result<(), String> {
        let address = address.to_owned();
        view.with_webview(move |platform| {
            // SAFETY: the WKWebView wry built for this view, retained for the call, on
            // the main thread where `with_webview` runs.
            unsafe {
                let Some(web) = Retained::retain(platform.inner().cast::<WKWebView>()) else {
                    return;
                };
                let base = NSURL::URLWithString(&NSString::from_str(&address));
                let _ = web.loadHTMLString_baseURL(&NSString::from_str(""), base.as_deref());
            }
        })
        .map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "linux")]
mod engine {
    use tauri::Webview;
    use webkit2gtk::WebViewExt as _;

    /// Nothing to set up: an HTML string with a base address is the origin already.
    #[allow(
        clippy::unused_async,
        reason = "one signature for every engine; WebView2's has something to wait for"
    )]
    pub(super) async fn prepared(_view: &Webview) -> Result<(), String> {
        Ok(())
    }

    pub(super) fn show(view: &Webview, address: &str) -> Result<(), String> {
        let address = address.to_owned();
        view.with_webview(move |platform| {
            platform.inner().load_html("", Some(&address));
        })
        .map_err(|error| error.to_string())
    }
}
