//! Delete browsing data: a store's cookies and other site data, and its cached files, over
//! a time range, through each engine's own call.
//!
//! Chrome keeps this inside the browser (Ctrl+Shift+Delete), and so does nib: Emil's
//! browser vision, 2026-09-13. The window decides what goes - the range, the two kinds,
//! which stores - and clears its own history beside it; see lib/web-tab/clearing.ts. This
//! is the half only an engine can do, and every engine has a call for it:
//!
//! | engine | call |
//! | --- | --- |
//! | `WebView2` | `ICoreWebView2Profile2::ClearBrowsingDataInTimeRange`, or `ClearBrowsingData` for all time |
//! | `WKWebView` | `WKWebsiteDataStore removeDataOfTypes:modifiedSince:` |
//! | `WebKitGTK` | `webkit_website_data_manager_clear`, with the range as a time span back from now |
//! | nib's own Chromium | the `DevTools` Protocol: `Storage.clearDataForOrigin` for each site the range visited, every cookie and the cache for all time |
//!
//! **A store is reached through a page built in it.** Each engine hands its store out
//! through a webview - a profile, a data store, a data manager - and a store may have no
//! tab open at all: a space's own store, the day after its last tab closed. So a page is
//! built for the clearing, a pixel wide and out of sight, on the same seam a tab's page is
//! built on (`engine::web_store`), and closed again once the engine has answered. A
//! private tab's store is in memory and goes with its last tab; nothing here reaches it.
//!
//! nib's own Chromium has no call that takes a time range. There the range decides which
//! sites' data goes - each site the window says the range visited, with everything it
//! stored, cookies included - and the cache, which is no site's, goes whole: what a
//! reader loses to that is a few pictures fetched again. Said in docs/web-tabs.md.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager as _, Webview, WebviewBuilder, WebviewUrl,
};

/// How long one store is given to answer. A clearing that deletes a large cache can take
/// a while; one that never answers is reported rather than waited on for ever.
const PATIENCE: Duration = Duration::from_secs(30);

/// The pages built for a clearing are numbered, so two clearings never share a label.
static NEXT: AtomicU64 = AtomicU64::new(0);

/// What goes. `since` is when the range starts, in milliseconds since 1970, and nought
/// is all time.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clearing {
    pub since: f64,
    /// Cookies and other site data: every cookie, `localStorage`, `IndexedDB`, service
    /// workers, the cache API, file systems.
    pub site: bool,
    /// Cached images and files: the HTTP cache.
    pub cache: bool,
}

impl Clearing {
    /// Whether it asks for anything at all.
    const fn any(self) -> bool {
        self.site || self.cache
    }

    /// Whether the range is all time.
    fn always(self) -> bool {
        self.since <= 0.0
    }
}

/// Clears what `clearing` says from each of `stores` - `None` for the store every space
/// shares, a name for a space's or a site's own - one after the other. `sites` are the
/// origins the range visited, which only nib's own Chromium needs; see above.
#[tauri::command]
pub async fn web_clear(
    webview: Webview,
    stores: Vec<Option<String>>,
    clearing: Clearing,
    sites: Vec<String>,
) -> Result<(), String> {
    if !clearing.any() {
        return Ok(());
    }
    let app = webview.app_handle().clone();
    for store in stores {
        let store = crate::web_stores::named(store.as_deref())?.map(str::to_string);
        let page = page_in_store(&app, &webview.window(), store.as_deref()).await?;
        let cleared = engine::clear(&page, clearing, &sites).await;
        let _ = page.close();
        cleared?;
    }
    Ok(())
}

/// A page in `store`, out of sight: what the engine's store is reached through.
async fn page_in_store(
    app: &AppHandle,
    window: &tauri::Window,
    store: Option<&str>,
) -> Result<Webview, String> {
    let label = format!("web-clearing-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let blank: tauri::Url = "about:blank"
        .parse()
        .map_err(|_| "the data could not be reached".to_string())?;
    // Never the keyboard, and nothing dropped on it: it is a store, not a page.
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(blank))
        .focused(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, store)?;

    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let building = window.clone();
    #[cfg(all(windows, not(feature = "cef")))]
    let (anchoring, storing) = (app.clone(), store.map(str::to_string));
    app.run_on_main_thread(move || {
        // On the session its store's tabs share, so the profile cleared is theirs; see
        // `on_shared_session`.
        #[cfg(all(windows, not(feature = "cef")))]
        let builder =
            crate::web_tabs::on_shared_session(builder, &building, &anchoring, storing.as_deref());
        let made = building
            .add_child(
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map(|view| {
                let _ = view.hide();
            })
            .map_err(|error| format!("the data could not be reached: {error}"));
        let _ = sending.try_send(made);
    })
    .map_err(|error| format!("the data could not be reached: {error}"))?;

    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("the data could not be reached".to_string()))?;
    app.get_webview(&label)
        .ok_or_else(|| "the data could not be reached".to_string())
}

/// The milliseconds since 1970 that `clearing` starts at, as seconds: what `WebView2`
/// and `WKWebView` count in.
#[cfg_attr(
    any(feature = "cef", target_os = "linux"),
    allow(
        dead_code,
        reason = "WebKitGTK counts back from now, and nib's own Chromium has no range"
    )
)]
fn seconds(clearing: Clearing) -> f64 {
    clearing.since / 1000.0
}

/// How far back `clearing` reaches from `now`, both in milliseconds, as the microseconds
/// `WebKitGTK` takes: nought for all time, which is that engine's own word for it.
#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only WebKitGTK counts back from now")
)]
fn span(clearing: Clearing, now: f64) -> i64 {
    if clearing.always() {
        return 0;
    }
    #[allow(
        clippy::cast_possible_truncation,
        reason = "a span of milliseconds since 1970 is far inside an i64 of microseconds"
    )]
    let micros = ((now - clearing.since).max(1.0) * 1000.0) as i64;
    micros
}

/// `WebView2`.
#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS,
        COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    };
    use windows_core::Interface as _;

    use super::{seconds, Clearing, PATIENCE};

    /// The kinds the two rows mean to `WebView2`.
    fn kinds(clearing: Clearing) -> COREWEBVIEW2_BROWSING_DATA_KINDS {
        let mut kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(0);
        if clearing.site {
            kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE;
        }
        if clearing.cache {
            kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
        }
        kinds
    }

    #[allow(
        unsafe_code,
        reason = "a profile's data is cleared through WebView2's own COM interfaces, on the page's own thread"
    )]
    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
        page.with_webview(move |platform| {
            let failed = sending.clone();
            let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                let _ = sending.try_send(
                    result.map_err(|error| format!("the data could not be deleted: {error}")),
                );
                Ok(())
            }));
            // Safe: the controller is this page's, asked on the thread it was built on.
            let asked = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_13>())
                    .and_then(|core| core.Profile())
                    .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
                    .and_then(|profile| {
                        if clearing.always() {
                            profile.ClearBrowsingData(kinds(clearing), &handler)
                        } else {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map_or(0.0, |since| since.as_secs_f64());
                            profile.ClearBrowsingDataInTimeRange(
                                kinds(clearing),
                                seconds(clearing),
                                now + 60.0,
                                &handler,
                            )
                        }
                    })
            };
            if let Err(error) = asked {
                let _ = failed.try_send(Err(format!("the data could not be deleted: {error}")));
            }
        })
        .map_err(|error| format!("the data could not be reached: {error}"))?;

        super::within(PATIENCE, waiting.recv()).await
    }
}

/// `WKWebView`.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDate, NSSet, NSString};
    use objc2_web_kit::{
        WKWebView, WKWebsiteDataStore, WKWebsiteDataTypeCookies, WKWebsiteDataTypeDiskCache,
        WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeIndexedDBDatabases,
        WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeMemoryCache,
        WKWebsiteDataTypeOfflineWebApplicationCache, WKWebsiteDataTypeServiceWorkerRegistrations,
        WKWebsiteDataTypeSessionStorage, WKWebsiteDataTypeWebSQLDatabases,
    };

    use super::{seconds, Clearing, PATIENCE};

    /// The types the two rows mean to `WKWebsiteDataStore`: all of them for both.
    #[allow(
        unsafe_code,
        reason = "the data types are WebKit's own constants, read as the statics they are"
    )]
    fn types(clearing: Clearing, mtm: MainThreadMarker) -> Retained<NSSet<NSString>> {
        if clearing.site && clearing.cache {
            // SAFETY: a class method of WebKit's, on the main thread.
            return unsafe { WKWebsiteDataStore::allWebsiteDataTypes(mtm) };
        }
        // SAFETY: WebKit's own constants, which live for the program.
        let named: Vec<&NSString> = unsafe {
            if clearing.site {
                vec![
                    WKWebsiteDataTypeCookies,
                    WKWebsiteDataTypeLocalStorage,
                    WKWebsiteDataTypeSessionStorage,
                    WKWebsiteDataTypeIndexedDBDatabases,
                    WKWebsiteDataTypeWebSQLDatabases,
                    WKWebsiteDataTypeServiceWorkerRegistrations,
                    WKWebsiteDataTypeFetchCache,
                    WKWebsiteDataTypeOfflineWebApplicationCache,
                ]
            } else {
                vec![WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
            }
        };
        NSSet::from_slice(&named)
    }

    #[allow(
        unsafe_code,
        reason = "the data store is reached through WKWebView's Objective-C interface, from the pointer wry hands out"
    )]
    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
        page.with_webview(move |platform| {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = sending.try_send(Err("the data could not be reached".to_string()));
                return;
            };
            // SAFETY: the pointer is the WKWebView wry built for this page, alive for as
            // long as the page is, and retained while its store is asked.
            let Some(view) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) })
            else {
                let _ = sending.try_send(Err("the data could not be reached".to_string()));
                return;
            };
            let since = if clearing.always() {
                NSDate::distantPast()
            } else {
                NSDate::dateWithTimeIntervalSince1970(seconds(clearing))
            };
            let done = RcBlock::new(move || {
                let _ = sending.try_send(Ok(()));
            });
            // SAFETY: the webview's own store, asked on its own thread; the engine copies
            // the block and calls it once.
            unsafe {
                view.configuration()
                    .websiteDataStore()
                    .removeDataOfTypes_modifiedSince_completionHandler(
                        &types(clearing, mtm),
                        &since,
                        &done,
                    );
            }
        })
        .map_err(|error| format!("the data could not be reached: {error}"))?;

        super::within(PATIENCE, waiting.recv()).await
    }
}

/// `WebKitGTK`.
#[cfg(all(target_os = "linux", not(feature = "cef")))]
mod engine {
    use webkit2gtk::{
        gio, glib, WebViewExt as _, WebsiteDataManagerExtManual as _, WebsiteDataTypes,
    };

    use super::{span, Clearing, PATIENCE};

    /// The types the two rows mean to `WebKitGTK`.
    fn types(clearing: Clearing) -> WebsiteDataTypes {
        let cache = WebsiteDataTypes::DISK_CACHE | WebsiteDataTypes::MEMORY_CACHE;
        match (clearing.site, clearing.cache) {
            (true, true) => WebsiteDataTypes::ALL,
            (true, false) => WebsiteDataTypes::ALL - cache,
            _ => cache,
        }
    }

    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0.0, |since| since.as_secs_f64() * 1000.0);
        page.with_webview(move |platform| {
            let Some(manager) = platform.inner().website_data_manager() else {
                let _ = sending.try_send(Err("the data could not be reached".to_string()));
                return;
            };
            manager.clear(
                types(clearing),
                glib::TimeSpan::from_microseconds(span(clearing, now)),
                None::<&gio::Cancellable>,
                move |result| {
                    let _ =
                        sending
                            .try_send(result.map_err(|error| {
                                format!("the data could not be deleted: {error}")
                            }));
                },
            );
        })
        .map_err(|error| format!("the data could not be reached: {error}"))?;

        super::within(PATIENCE, waiting.recv()).await
    }
}

/// nib's own Chromium, through the `DevTools` Protocol.
#[cfg(feature = "cef")]
mod engine {
    use serde_json::{json, Value};

    use super::{Clearing, PATIENCE};

    /// What the protocol is asked for, in order: each site the range visited with
    /// everything it stored, and for all time every cookie as well; the cache, which no
    /// site owns, whole.
    pub(super) fn asks(clearing: Clearing, sites: &[String]) -> Vec<(&'static str, Value)> {
        let mut asks = Vec::new();
        if clearing.site {
            if clearing.always() {
                asks.push(("Network.clearBrowserCookies", json!({})));
            }
            for origin in sites {
                asks.push((
                    "Storage.clearDataForOrigin",
                    json!({ "origin": origin, "storageTypes": "all" }),
                ));
            }
        }
        if clearing.cache {
            asks.push(("Network.clearBrowserCache", json!({})));
        }
        asks
    }

    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        sites: &[String],
    ) -> Result<(), String> {
        let page = page.clone();
        let asks = asks(clearing, sites);
        // The protocol's answers arrive on the window's thread, so they are waited for
        // anywhere but there; see engine/devtools.rs.
        tauri::async_runtime::spawn_blocking(move || {
            for (method, params) in asks {
                crate::engine::devtools::call(&page, None, method, &params, PATIENCE)?;
            }
            Ok(())
        })
        .await
        .map_err(|error| format!("the data could not be deleted: {error}"))?
    }
}

/// Every other build has no web tab, so nothing to clear.
#[cfg(not(any(feature = "cef", windows, target_os = "macos", target_os = "linux")))]
mod engine {
    use super::Clearing;

    pub async fn clear(
        _page: &tauri::Webview,
        _clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        Ok(())
    }
}

/// An engine's answer, or a word that it never came.
#[cfg_attr(
    feature = "cef",
    allow(dead_code, reason = "the protocol's calls wait for themselves")
)]
async fn within(
    patience: Duration,
    answer: impl std::future::Future<Output = Option<Result<(), String>>>,
) -> Result<(), String> {
    match tokio::time::timeout(patience, answer).await {
        Ok(Some(said)) => said,
        Ok(None) => Err("the data could not be deleted".to_string()),
        Err(_) => Err("the engine did not answer in time".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{span, Clearing};

    /// All time is nought to `WebKitGTK`, and a range is how far back it reaches.
    #[test]
    fn a_range_is_how_far_back_it_reaches() {
        let always = Clearing {
            since: 0.0,
            site: true,
            cache: false,
        };
        let now = 1_791_000_000_000.0;
        assert_eq!(span(always, now), 0);

        let hour = Clearing {
            since: now - 3_600_000.0,
            ..always
        };
        assert_eq!(span(hour, now), 3_600_000_000);
    }

    /// The window's words for it, read as the crate reads them.
    #[test]
    fn what_the_window_says_is_read() {
        let said: Clearing =
            serde_json::from_str(r#"{"since":1700000000000,"site":true,"cache":false}"#)
                .expect("a clearing");
        assert_eq!(
            said,
            Clearing {
                since: 1_700_000_000_000.0,
                site: true,
                cache: false
            }
        );
        assert!(!said.always());
    }

    /// nib's own Chromium: every cookie only for all time, each site the range visited,
    /// and the cache whole.
    #[cfg(feature = "cef")]
    #[test]
    fn chromium_is_asked_site_by_site() {
        let sites = vec!["https://a.example".to_string()];
        let ranged = Clearing {
            since: 5.0,
            site: true,
            cache: true,
        };
        let methods: Vec<&str> = super::engine::asks(ranged, &sites)
            .into_iter()
            .map(|(method, _)| method)
            .collect();
        assert_eq!(
            methods,
            ["Storage.clearDataForOrigin", "Network.clearBrowserCache"]
        );

        let always = Clearing {
            since: 0.0,
            ..ranged
        };
        assert_eq!(
            super::engine::asks(always, &sites)[0].0,
            "Network.clearBrowserCookies"
        );
    }
}
