//! The processes Chromium starts beside the browser one - a page's renderer, the GPU,
//! the network - which are this same binary run again with `--type=`.
//!
//! **Why nib runs them itself rather than through the runtime's.** `tauri-runtime-cef`'s
//! own helper gives every page it renders a `window.ipc`: in every frame of every browser,
//! in every world of every frame, read-only and undeletable - which is how the app's own
//! interface reaches its commands, and which a website in a web tab has no business
//! holding. It is also the exact global that broke Google Sheets on the system's engine
//! (`web_worlds.rs`): a classic script may not declare `let ipc` beside a global the page
//! cannot remove, so the spreadsheet's bundle died on its first line. Measured on this
//! build before this file existed: a web tab's page carried `ipc`, `isTauri` and
//! `__TAURI_INTERNALS__`, and so did nib's own world in it.
//!
//! So the renderer here does what the runtime's does, for one kind of document only: the
//! top frame of a page on the app's own origin - nib's interface. A website, a frame
//! inside a website, and a frame inside nib's own interface (a sandboxed code block, an
//! embed) get nothing, which is what a browser gives a page. The other half - the scripts
//! the runtime registers for every document - is taken back per web tab; see
//! `src/web_worlds.rs`.
//!
//! What crosses to the browser process is unchanged: the message name and its two
//! arguments are the runtime's own (`cef_impl/ipc.rs` in `tauri-runtime-cef`), and the
//! runtime's browser side is what receives them. A pin that moves the runtime is proved
//! by the app starting at all - an interface whose commands never arrive is a window that
//! never leaves its first frame.

// The crate's wrapping macros write what they wrap in terms of its own traits, named bare,
// and cast between a wrapper and CEF's own struct by transmuting one reference into the
// other: the glob is the only way to put every trait in scope, and the casts are the
// crate's, written inside the macros rather than here.
#![allow(
    clippy::transmute_ptr_to_ptr,
    reason = "the cef crate's wrap_* macros transmute between a wrapper and the struct it wraps"
)]

#[allow(
    clippy::wildcard_imports,
    reason = "the cef crate's wrap_* macros expand to calls on its traits by their bare names"
)]
use cef::*;

/// The message the runtime's browser side answers as a call from the page. Its name,
/// not nib's.
const MESSAGE: &str = "tauri:ipc";

/// The one function on `window.ipc`.
const POST: &str = "postMessage";

/// Whether this process is one of Chromium's helpers rather than the app.
pub fn is_helper() -> bool {
    std::env::args().any(|arg| arg.starts_with("--type="))
}

/// Whether this helper is a page's renderer: the one kind that never makes a window.
pub fn is_renderer() -> bool {
    std::env::args().any(|arg| arg == "--type=renderer")
}

/// Runs this process as the helper Chromium started it as, and returns when it is done.
pub fn run() {
    let args = args::Args::new();

    // On a Mac a helper enters the sandbox before the framework is loaded, unless the
    // browser process started it without one; and it loads the framework itself, from
    // the bundle it is in. The runtime's own helper does the same two things.
    #[cfg(target_os = "macos")]
    let _sandbox = (!std::env::args().any(|arg| arg == "--no-sandbox")).then(|| {
        let mut sandbox = cef::sandbox::Sandbox::new();
        sandbox.initialize(args.as_main_args());
        sandbox
    });
    #[cfg(target_os = "macos")]
    let _loader = {
        let loader = cef::library_loader::LibraryLoader::new(
            &std::env::current_exe().expect("the helper's own path"),
            true,
        );
        assert!(loader.load(), "the framework beside the helper");
        loader
    };

    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    let mut app = Helper::new();
    let _ = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
}

/// Whether an address is a page of nib's own interface: the origin every Tauri webview on
/// this runtime is served from, `http://tauri.localhost` (or `https`, where the config
/// asks for it). A web tab can never be there: `web_tabs::allowed` refuses the host.
pub fn ours(url: &str) -> bool {
    ["http://tauri.localhost", "https://tauri.localhost"]
        .iter()
        .any(|origin| {
            url.strip_prefix(origin)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
        })
}

wrap_app! {
    struct Helper;

    impl App {
        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(Renderer::new())
        }
    }
}

wrap_render_process_handler! {
    struct Renderer;

    impl RenderProcessHandler {
        fn on_context_created(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            let interface = frame.is_some_and(|frame| {
                frame.is_main() != 0 && ours(&CefString::from(&frame.url()).to_string())
            });
            if interface {
                install(context);
            }
        }
    }
}

wrap_v8_handler! {
    struct Post;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            retval: Option<&mut Option<V8Value>>,
            exception: Option<&mut CefString>,
        ) -> std::os::raw::c_int {
            if name.map(ToString::to_string).as_deref() != Some(POST) {
                return 0;
            }
            let Some(message) = arguments
                .filter(|given| given.len() == 1)
                .and_then(|given| given[0].as_ref())
                .filter(|one| one.is_string() != 0)
            else {
                if let Some(exception) = exception {
                    *exception = CefString::from("window.ipc.postMessage expects a string argument");
                }
                return 1;
            };
            let Some(frame) = v8_context_get_current_context().and_then(|context| context.frame())
            else {
                return 1;
            };

            let body = CefString::from(&message.string_value()).to_string();
            let url = CefString::from(&frame.url()).to_string();
            let mut sent = process_message_create(Some(&CefString::from(MESSAGE)));
            if let Some(list) = sent.as_ref().and_then(ImplProcessMessage::argument_list) {
                list.set_string(0, Some(&CefString::from(url.as_str())));
                list.set_string(1, Some(&CefString::from(body.as_str())));
                frame.send_process_message(ProcessId::BROWSER, sent.as_mut());
            }
            if let Some(retval) = retval {
                *retval = v8_value_create_undefined();
            }
            1
        }
    }
}

/// `window.ipc.postMessage`, as the runtime puts it on a page: read-only, not listed and
/// not deletable, on the page's global object.
fn install(context: Option<&mut V8Context>) {
    let Some(window) = context.and_then(|context| context.global()) else {
        return;
    };
    let fixed = cef::sys::cef_v8_propertyattribute_t(
        [
            cef::sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_READONLY,
            cef::sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_DONTENUM,
            cef::sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_DONTDELETE,
        ]
        .into_iter()
        .fold(0, |all, one| all | one.0),
    )
    .into();
    let Some(mut ipc) = v8_value_create_object(None, None) else {
        return;
    };
    let mut handler = Post::new();
    let post = CefString::from(POST);
    let Some(mut function) = v8_value_create_function(Some(&post), Some(&mut handler)) else {
        return;
    };
    ipc.set_value_bykey(Some(&post), Some(&mut function), fixed);
    window.set_value_bykey(Some(&CefString::from("ipc")), Some(&mut ipc), fixed);
}

#[cfg(test)]
mod tests {
    use super::ours;

    /// nib's own interface, on the origin the runtime serves it from, and nothing that
    /// only looks like it.
    #[test]
    fn only_the_app_s_own_origin_is_the_interface() {
        assert!(ours("http://tauri.localhost/"));
        assert!(ours("http://tauri.localhost/index.html?x"));
        assert!(ours("https://tauri.localhost"));
        assert!(!ours("http://tauri.localhost.example.com/"));
        assert!(!ours("http://tauri.localhostx/"));
        assert!(!ours("https://docs.google.com/spreadsheets/d/1"));
        assert!(!ours("about:blank"));
        assert!(!ours("data:text/html,<p>"));
        assert!(!ours("http://127.0.0.1:1420/"));
    }
}
