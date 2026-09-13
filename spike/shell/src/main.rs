//! A Tauri window, two web tabs beside the app's own interface, one Chromium.
//!
//! This is the shape docs/browser.md recommends, reduced to one file. There is no
//! transport, no helper process, no cross-process window handle and no second
//! engine: `tauri-runtime-cef` puts CEF where `tauri-runtime-wry` puts WebView2 and
//! WebKitGTK, so nib's own interface and a website are two webviews in one window
//! on one engine, and a web tab is `Window::add_child` with bounds - which is the
//! same two lines `apps/desktop/src-tauri/src/web_tabs.rs` already calls.
//!
//! What it has to prove:
//!
//! - **one browser process** for the app's own webview and both web tabs. The
//!   harness counts; a `--type=`-less process other than this one would be a
//!   second Chromium and the whole premise wrong.
//! - **`chrome://settings` in a tab**, which is what Emil asked for by name and
//!   what a WebView2 host is documented not to be able to do at all.
//! - **an unpacked extension**, loaded by a switch the runtime forwards.
//! - that the window, the strip and the bars stay **nib's**: CEF's Chrome style
//!   draws no toolbar unless a host asks for one, and this asks for none.
//!
//! `cef_entry_point` is what makes the same binary serve as Chromium's renderer,
//! GPU and utility processes: it runs `execute_process` before anything else and
//! returns, which has to happen before a single allocation on another thread.

use std::time::Instant;
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl, WindowBuilder};
use tauri_runtime_cef::{Cef, SandboxPolicy};

/// Where the two tabs go.
const TAB_A: &str = "https://example.com/";
const TAB_B: &str = "chrome://settings/";

fn say(fields: &str, start: Instant) {
    println!("{{\"at\":{},{fields}}}", start.elapsed().as_millis());
    use std::io::Write;
    let _ = std::io::stdout().flush();
}

#[tauri_runtime_cef::cef_entry_point]
fn main() {
    let start = Instant::now();

    // The engine, configured. Three things and no more:
    //
    // 1. The extension, as a Chromium switch. There is no host API for installing
    //    one - CEF's own issue for that is still open - and there does not need to
    //    be: `chrome://extensions` is the management surface, and Chromium's
    //    policy mechanisms are how a shipped build would install from the account.
    // 2. The profile, in a directory of its own, which is what makes a web tab's
    //    cookies not the app's.
    // 3. The sandbox, off, because a CI runner cannot give Linux's `chrome-sandbox`
    //    the setuid bit and Windows has no sandbox on this path yet at all. Both
    //    are named as ship gates in docs/browser.md; neither is a thing to leave
    //    off quietly.
    let mut engine = Cef::default().sandbox(SandboxPolicy::Disabled);
    if let Ok(path) = std::env::var("NIB_SPIKE_EXTENSION") {
        engine = engine.command_line_arg("load-extension", Some(path));
    }
    if let Ok(path) = std::env::var("NIB_SPIKE_CACHE") {
        engine = engine.cache_path(std::path::PathBuf::from(path));
    }

    let no_browser = std::env::args().any(|arg| arg == "--no-browser");

    tauri::Builder::default()
        .runtime(engine)
        .setup(move |app| {
            say("\"event\":\"cef-initialised\"", start);

            let window = WindowBuilder::new(app, "main")
                .title("nib spike shell")
                .inner_size(1560.0, 940.0)
                .build()?;

            // The app's own interface, on the left third. Under this runtime it is
            // a CEF browser like the two beside it, which is the other half of why
            // this shape is the recommendation: nib's editor stops being WebKit on
            // two desktops and Chromium on the third.
            window.add_child(
                WebviewBuilder::new("shell", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(520.0, 940.0),
            )?;
            say("\"event\":\"window-shown\"", start);

            if no_browser {
                say("\"event\":\"no-browser\"", start);
                say(
                    "\"event\":\"check\",\"name\":\"a shell with no web tab\",\"ok\":true,\"note\":\"CEF is up either way under this runtime\"",
                    start,
                );
                app.handle().exit(0);
                return Ok(());
            }

            for (label, url, x) in [("tab-a", TAB_A, 520.0), ("tab-b", TAB_B, 1040.0)] {
                let at: tauri::Url = url.parse()?;
                window.add_child(
                    WebviewBuilder::new(label, WebviewUrl::External(at)),
                    LogicalPosition::new(x, 0.0),
                    LogicalSize::new(520.0, 940.0),
                )?;
                say(&format!("\"event\":\"tab\",\"label\":\"{label}\",\"url\":\"{url}\""), start);
            }

            let handle = app.handle().clone();
            let started = start;
            std::thread::spawn(move || {
                // Long enough for both tabs to have painted. The harness counts
                // processes and photographs on `ready`, which is the one
                // measurement the whole design rests on.
                std::thread::sleep(std::time::Duration::from_secs(12));
                let webviews = handle.webviews().len();
                say(
                    &format!(
                        "\"event\":\"check\",\"name\":\"three webviews in one window\",\"ok\":{},\"note\":\"{webviews} webviews\"",
                        webviews == 3
                    ),
                    started,
                );
                say(&format!("\"event\":\"first-load-end\",\"webviews\":{webviews}"), started);
                say(&format!("\"event\":\"ready\",\"pid\":{}", std::process::id()), started);
                std::thread::sleep(std::time::Duration::from_secs(8));
                say("\"event\":\"shot:tauri-window\"", started);
                std::thread::sleep(std::time::Duration::from_secs(6));
                say("\"event\":\"finishing\"", started);
                handle.exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the shell would not run");
}
