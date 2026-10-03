//! A page nobody sees, on the system's engine of a Mac (`WKWebView`) and of Linux
//! (`WebKitGTK`): every way the engine offers to have one, each measured the way the spike
//! measured `WebView2` (docs/agent-native.md 3 and 12), with nothing of the app around it.
//!
//! The ways, each a page with a counter of animation frames, a 10 ms timer, its visibility
//! and the events it saw:
//!
//! - `front`: a child webview on the window, in sight - what a tab in front gets.
//! - `away`: a child webview outside the window's content, as `WebView2`'s agent tab is.
//! - `away-none` (Mac): the same, then told `inactiveSchedulingPolicy = .none` (macOS 14),
//!   through the configuration wry built it with.
//! - `own-none` (Mac): a `WKWebView` made here with that policy in its configuration from
//!   the start, outside the window's content.
//! - `offscreen` (Linux): a `WebKitGTK` view in a `GtkOffscreenWindow`, which renders and
//!   is mapped with no window on any screen.
//! - `hidden`: a child webview the engine is told is hidden - the control.
//!
//! Then, on the pages out of sight: a picture (`takeSnapshot`, `webkit_web_view_get_snapshot`),
//! a press from an isolated world (`WKContentWorld`, a script world) and whether the page
//! can tell it from a person's (`isTrusted`), and on a Mac a press and a key as `NSEvent`s
//! sent to the view itself, with whether the window was key or the app active before and
//! after. Prints one JSON document and exits.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tao::event::Event;
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;

/// The page every way loads.
const PAGE: &str = r#"<!doctype html><meta charset=utf-8><title>probe</title>
<body style="margin:0;background:#ff00ff">
<button id="b" style="position:absolute;left:20px;top:20px;width:200px;height:60px">Press</button>
<input id="i" aria-label="Box" style="position:absolute;left:20px;top:120px;width:200px">
<script>
window.raf = 0; window.ticks = 0; window.events = []
;(function loop () { window.raf++; requestAnimationFrame(loop) })()
setInterval(function () { window.ticks++ }, 10)
document.getElementById('b').addEventListener('click', function (e) { window.events.push(['click', e.isTrusted]) })
addEventListener('keydown', function (e) { window.events.push(['key', e.key, e.isTrusted]) })
window.m = function () {
  return JSON.stringify({ raf: window.raf, ticks: window.ticks, at: Date.now(),
    state: document.visibilityState, focus: document.hasFocus(), events: window.events })
}
</script>"#;

/// What a press from an isolated world does, and what it can see of the page's world.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "linux")),
    allow(dead_code, reason = "the probe measures a Mac and Linux")
)]
const WORLD_PRESS: &str = "(function () { document.getElementById('b').click(); return JSON.stringify({ pageGlobal: typeof window.m, button: !!document.getElementById('b') }) })()";

/// Where an out-of-sight page sits: as `WebView2`'s agent tab does.
const AWAY: f64 = -10_000.0;
const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 800.0;

/// Things measured, in the order they arrive.
type Log = Arc<Mutex<Vec<Value>>>;

/// One way of having a page, and what can be asked of it.
struct Way {
    name: &'static str,
    samples: Log,
    notes: Log,
    sample: Box<dyn Fn(Log)>,
    world_press: Option<Box<dyn Fn(Log)>>,
    native_input: Option<Box<dyn Fn(Log)>>,
    picture: Option<Box<dyn Fn(Log)>>,
}

/// A JSON answer that may be a JSON string of a JSON document.
fn unwrapped(said: &str) -> Value {
    match serde_json::from_str::<Value>(said) {
        Ok(Value::String(inner)) => serde_json::from_str(&inner).unwrap_or(Value::String(inner)),
        Ok(value) => value,
        Err(_) => Value::String(said.to_string()),
    }
}

fn push(log: &Log, value: Value) {
    log.lock().unwrap().push(value);
}

/// A page through wry, as a child of the window at `bounds`.
fn wry_way(
    name: &'static str,
    window: &tao::window::Window,
    position: (f64, f64),
    visible: bool,
) -> (Way, std::rc::Rc<wry::WebView>) {
    let view = wry::WebViewBuilder::new()
        .with_html(PAGE)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(position.0, position.1).into(),
            size: wry::dpi::LogicalSize::new(WIDTH, HEIGHT).into(),
        })
        .with_focused(false);
    #[cfg(target_os = "linux")]
    let view = {
        use wry::WebViewBuilderExtUnix as _;
        view.build_gtk(&platform::fixed(window))
    };
    #[cfg(not(target_os = "linux"))]
    let view = view.build_as_child(window);
    let view = std::rc::Rc::new(view.expect("a webview"));
    if !visible {
        let _ = view.set_visible(false);
    }
    let sampling = std::rc::Rc::clone(&view);
    let way = Way {
        name,
        samples: Log::default(),
        notes: Log::default(),
        sample: Box::new(move |log| {
            let _ = sampling.evaluate_script_with_callback("window.m()", move |said| {
                push(&log, unwrapped(&said));
            });
        }),
        world_press: None,
        native_input: None,
        picture: None,
    };
    (way, view)
}

/// Frames and timer ticks a second between two samples, and the state at the second.
fn rates(samples: &[Value]) -> Value {
    let (Some(first), Some(second)) = (samples.first(), samples.get(1)) else {
        return json!({ "error": "fewer than two samples", "samples": samples });
    };
    let at = |one: &Value, key: &str| one.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let seconds = (at(second, "at") - at(first, "at")) / 1000.0;
    if seconds <= 0.0 {
        return json!({ "error": "no time between samples", "samples": samples });
    }
    json!({
        "rAF per s": ((at(second, "raf") - at(first, "raf")) / seconds * 10.0).round() / 10.0,
        "10 ms interval per s": ((at(second, "ticks") - at(first, "ticks")) / seconds * 10.0).round() / 10.0,
        "visibilityState": second.get("state"),
        "hasFocus": second.get("focus"),
    })
}

fn main() {
    let event_loop = EventLoopBuilder::new().build();
    let window = WindowBuilder::new()
        .with_title("webkit agent probe")
        .with_inner_size(tao::dpi::LogicalSize::new(900.0, 700.0))
        .with_focused(false)
        .build(&event_loop)
        .expect("a window");

    let mut ways = Vec::new();
    let mut kept: Vec<Box<dyn std::any::Any>> = Vec::new();

    let (front, view) = wry_way("front", &window, (0.0, 0.0), true);
    ways.push(front);
    kept.push(Box::new(view));

    let (mut away, view) = wry_way("away", &window, (AWAY, AWAY), true);
    platform::extend(&mut away, &view, &window, false);
    ways.push(away);
    kept.push(Box::new(view));

    #[cfg(target_os = "macos")]
    {
        let (mut none, view) = wry_way("away-none", &window, (AWAY, AWAY), true);
        platform::extend(&mut none, &view, &window, true);
        ways.push(none);
        kept.push(Box::new(view));
    }

    for (way, keep) in platform::own_ways(&window) {
        ways.push(way);
        kept.push(keep);
    }

    let (hidden, view) = wry_way("hidden", &window, (0.0, 0.0), false);
    ways.push(hidden);
    kept.push(Box::new(view));

    let started = Instant::now();
    let mut step = 0;
    let window_states = Log::default();
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(50));
        let _ = &kept;
        if !matches!(event, Event::NewEvents(_) | Event::MainEventsCleared) {
            return;
        }
        let at = started.elapsed();
        match step {
            0 if at > Duration::from_secs(4) => {
                for way in &ways {
                    (way.sample)(Arc::clone(&way.samples));
                }
                step = 1;
            }
            1 if at > Duration::from_secs(9) => {
                for way in &ways {
                    (way.sample)(Arc::clone(&way.samples));
                }
                push(
                    &window_states,
                    platform::window_state(&window, "before input"),
                );
                for way in &ways {
                    if let Some(press) = &way.world_press {
                        press(Arc::clone(&way.notes));
                    }
                }
                step = 2;
            }
            2 if at > Duration::from_secs(10) => {
                for way in &ways {
                    if let Some(input) = &way.native_input {
                        input(Arc::clone(&way.notes));
                    }
                    if let Some(picture) = &way.picture {
                        picture(Arc::clone(&way.notes));
                    }
                }
                step = 3;
            }
            3 if at > Duration::from_secs(12) => {
                push(
                    &window_states,
                    platform::window_state(&window, "after input"),
                );
                for way in &ways {
                    (way.sample)(Arc::clone(&way.samples));
                }
                step = 4;
            }
            4 if at > Duration::from_secs(14) => {
                let report: serde_json::Map<String, Value> = ways
                    .iter()
                    .map(|way| {
                        let samples = way.samples.lock().unwrap().clone();
                        let events = samples.last().and_then(|one| one.get("events")).cloned();
                        (
                            way.name.to_string(),
                            json!({
                                "rates": rates(&samples),
                                "events the page saw": events,
                                "notes": way.notes.lock().unwrap().clone(),
                            }),
                        )
                    })
                    .collect();
                let out = json!({
                    "engine": platform::ENGINE,
                    "os": platform::os(),
                    "ways": report,
                    "window": window_states.lock().unwrap().clone(),
                });
                println!("{}", serde_json::to_string_pretty(&out).unwrap());
                *flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use std::rc::Rc;
    use std::sync::Arc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSImage, NSView,
    };
    use objc2_foundation::{NSError, NSPoint, NSRect, NSSize, NSString};
    use objc2_web_kit::{
        WKContentWorld, WKInactiveSchedulingPolicy, WKWebView, WKWebViewConfiguration,
    };
    use serde_json::{json, Value};
    use wry::WebViewExtMacOS as _;

    use super::{push, unwrapped, Log, Way, AWAY, HEIGHT, PAGE, WIDTH, WORLD_PRESS};

    pub const ENGINE: &str = "WKWebView";

    pub fn os() -> String {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .unwrap_or_default()
    }

    fn evaluate(
        web: &WKWebView,
        script: &str,
        world: Option<&WKContentWorld>,
        log: Log,
        label: &'static str,
    ) {
        let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let said = unsafe {
                if let Some(error) = error.as_ref() {
                    json!({ label: { "error": error.localizedDescription().to_string() } })
                } else if let Some(text) = value.as_ref().and_then(|v| v.downcast_ref::<NSString>())
                {
                    if label == "sample" {
                        unwrapped(&text.to_string())
                    } else {
                        json!({ label: unwrapped(&text.to_string()) })
                    }
                } else {
                    json!({ label: "no value" })
                }
            };
            push(&log, said);
        });
        let script = NSString::from_str(script);
        unsafe {
            match world {
                Some(world) => web.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                    &script,
                    None,
                    world,
                    Some(&done),
                ),
                None => web.evaluateJavaScript_completionHandler(&script, Some(&done)),
            }
        }
    }

    fn world() -> Retained<WKContentWorld> {
        let mtm = MainThreadMarker::new().expect("the main thread");
        unsafe { WKContentWorld::worldWithName(&NSString::from_str("nib-probe"), mtm) }
    }

    fn picture(web: &WKWebView, log: Log) {
        let done = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let said = unsafe {
                if let Some(image) = image.as_ref() {
                    let size = image.size();
                    json!({ "picture": { "width": size.width, "height": size.height } })
                } else if let Some(error) = error.as_ref() {
                    json!({ "picture": { "error": error.localizedDescription().to_string() } })
                } else {
                    json!({ "picture": "nothing" })
                }
            };
            push(&log, said);
        });
        unsafe { web.takeSnapshotWithConfiguration_completionHandler(None, &done) };
    }

    /// A press on the button and the letter a into the box, as events sent to the view
    /// itself, never through the system's queue.
    fn native_input(web: &WKWebView, log: Log) {
        let view: &NSView = web;
        let Some(window) = view.window() else {
            push(&log, json!({ "native input": "the view has no window" }));
            return;
        };
        let flipped = view.isFlipped();
        let local = |x: f64, y: f64| NSPoint::new(x, if flipped { y } else { HEIGHT - y });
        let point = view.convertPoint_toView(local(120.0, 50.0), None);
        let number = window.windowNumber();
        let mouse = |kind: NSEventType| {
            NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                kind,
                point,
                NSEventModifierFlags::empty(),
                0.0,
                number,
                None,
                0,
                1,
                1.0,
            )
        };
        if let (Some(down), Some(up)) = (
            mouse(NSEventType::LeftMouseDown),
            mouse(NSEventType::LeftMouseUp),
        ) {
            view.mouseDown(&down);
            view.mouseUp(&up);
        }
        evaluate(
            web,
            "document.getElementById('i').focus(); 'focused'",
            Some(&world()),
            Arc::clone(&log),
            "focus from the world",
        );
        let key = |kind: NSEventType| {
            NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                kind,
                point,
                NSEventModifierFlags::empty(),
                0.0,
                number,
                None,
                &NSString::from_str("a"),
                &NSString::from_str("a"),
                false,
                0,
            )
        };
        if let (Some(down), Some(up)) = (key(NSEventType::KeyDown), key(NSEventType::KeyUp)) {
            view.keyDown(&down);
            view.keyUp(&up);
        }
        push(
            &log,
            json!({ "native input": { "sent at": [point.x, point.y], "flipped": flipped } }),
        );
    }

    /// The press from the isolated world, the native events and the picture, on a page
    /// through wry; and with `none`, the scheduling policy set on wry's configuration.
    pub fn extend(
        way: &mut Way,
        view: &Rc<wry::WebView>,
        _window: &tao::window::Window,
        none: bool,
    ) {
        let web = view.webview();
        if none {
            let read = unsafe {
                let preferences = web.configuration().preferences();
                preferences.setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
                web.configuration().preferences().inactiveSchedulingPolicy()
            };
            push(
                &way.notes,
                json!({ "policy read back": read.0, "none is": WKInactiveSchedulingPolicy::None.0 }),
            );
        }
        let (a, b, c) = (Rc::clone(view), Rc::clone(view), Rc::clone(view));
        way.world_press = Some(Box::new(move |log| {
            evaluate(
                &a.webview(),
                WORLD_PRESS,
                Some(&world()),
                log,
                "world press",
            );
        }));
        way.native_input = Some(Box::new(move |log| native_input(&b.webview(), log)));
        way.picture = Some(Box::new(move |log| picture(&c.webview(), log)));
    }

    /// A `WKWebView` of this probe's own, with the policy in its configuration from the
    /// start, outside the window's content.
    pub fn own_ways(window: &tao::window::Window) -> Vec<(Way, Box<dyn std::any::Any>)> {
        use tao::platform::macos::WindowExtMacOS as _;
        let mtm = MainThreadMarker::new().expect("the main thread");
        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        unsafe {
            configuration
                .preferences()
                .setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
        }
        let frame = NSRect::new(NSPoint::new(AWAY, AWAY), NSSize::new(WIDTH, HEIGHT));
        let web = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &configuration)
        };
        let content: &NSView = unsafe { &*(window.ns_view().cast::<NSView>()) };
        content.addSubview(&web);
        unsafe {
            web.loadHTMLString_baseURL(&NSString::from_str(PAGE), None);
        }
        let web = Rc::new(web);
        let (a, b, c, d) = (
            Rc::clone(&web),
            Rc::clone(&web),
            Rc::clone(&web),
            Rc::clone(&web),
        );
        let way = Way {
            name: "own-none",
            samples: Log::default(),
            notes: Log::default(),
            sample: Box::new(move |log| evaluate(&a, "window.m()", None, log, "sample")),
            world_press: Some(Box::new(move |log| {
                evaluate(&b, WORLD_PRESS, Some(&world()), log, "world press")
            })),
            native_input: Some(Box::new(move |log| native_input(&c, log))),
            picture: Some(Box::new(move |log| picture(&d, log))),
        };
        vec![(way, Box::new(web) as Box<dyn std::any::Any>)]
    }

    pub fn window_state(window: &tao::window::Window, when: &str) -> Value {
        use tao::platform::macos::WindowExtMacOS as _;
        let mtm = MainThreadMarker::new().expect("the main thread");
        let ns_window: &objc2_app_kit::NSWindow =
            unsafe { &*(window.ns_window().cast::<objc2_app_kit::NSWindow>()) };
        json!({
            "when": when,
            "window is key": ns_window.isKeyWindow(),
            "app active": NSApplication::sharedApplication(mtm).isActive(),
        })
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::rc::Rc;

    use gtk::prelude::*;
    use javascriptcore::ValueExt as _;
    use serde_json::{json, Value};
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt as _};
    use wry::WebViewExtUnix as _;

    use super::{push, unwrapped, Log, Way, HEIGHT, PAGE, WIDTH, WORLD_PRESS};

    pub const ENGINE: &str = "WebKitGTK";

    pub fn os() -> String {
        format!(
            "WebKitGTK {}.{}.{}",
            webkit2gtk::functions::major_version(),
            webkit2gtk::functions::minor_version(),
            webkit2gtk::functions::micro_version()
        )
    }

    thread_local! {
        static FIXED: std::cell::RefCell<Option<gtk::Fixed>> = const { std::cell::RefCell::new(None) };
    }

    /// The window's one fixed container, which every child page is placed in, as Tauri
    /// places a child webview.
    pub fn fixed(window: &tao::window::Window) -> gtk::Fixed {
        use tao::platform::unix::WindowExtUnix as _;
        FIXED.with_borrow_mut(|held| {
            held.get_or_insert_with(|| {
                let fixed = gtk::Fixed::new();
                if let Some(vbox) = window.default_vbox() {
                    vbox.pack_start(&fixed, true, true, 0);
                }
                fixed.show_all();
                fixed
            })
            .clone()
        })
    }

    fn evaluate(
        web: &webkit2gtk::WebView,
        script: &str,
        world: Option<&str>,
        log: Log,
        label: &'static str,
    ) {
        web.evaluate_javascript(
            script,
            world,
            None,
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let said = match result {
                    Ok(value) if value.is_string() => {
                        let text = value.to_str().to_string();
                        if label == "sample" {
                            unwrapped(&text)
                        } else {
                            json!({ label: unwrapped(&text) })
                        }
                    }
                    Ok(_) => json!({ label: "no string" }),
                    Err(error) => json!({ label: { "error": error.to_string() } }),
                };
                push(&log, said);
            },
        );
    }

    fn picture(web: &webkit2gtk::WebView, log: Log) {
        web.snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let said = match result {
                    Ok(surface) => match cairo::ImageSurface::try_from(surface) {
                        Ok(image) => json!({ "picture": { "width": image.width(), "height": image.height() } }),
                        Err(_) => json!({ "picture": "not an image surface" }),
                    },
                    Err(error) => json!({ "picture": { "error": error.to_string() } }),
                };
                push(&log, said);
            },
        );
    }

    fn scripted(way: &mut Way, web: &webkit2gtk::WebView) {
        let (a, b) = (web.clone(), web.clone());
        way.world_press = Some(Box::new(move |log| {
            evaluate(&a, WORLD_PRESS, Some("nib-probe"), log, "world press")
        }));
        way.picture = Some(Box::new(move |log| picture(&b, log)));
        way.native_input = Some(Box::new(|log| {
            push(
                &log,
                json!({ "native input": "not attempted: no event a WebKitGTK view takes from outside the toolkit's queue was found to measure" }),
            );
        }));
    }

    pub fn extend(
        way: &mut Way,
        view: &Rc<wry::WebView>,
        _window: &tao::window::Window,
        _none: bool,
    ) {
        let web = view.webview();
        scripted(way, &web);
    }

    /// A page in an off-screen window: mapped, rendered, and on no screen.
    pub fn own_ways(_window: &tao::window::Window) -> Vec<(Way, Box<dyn std::any::Any>)> {
        let offscreen = gtk::OffscreenWindow::new();
        let web = webkit2gtk::WebView::new();
        web.set_size_request(WIDTH as i32, HEIGHT as i32);
        offscreen.add(&web);
        offscreen.show_all();
        web.load_html(PAGE, None);
        let sampling = web.clone();
        let mut way = Way {
            name: "offscreen",
            samples: Log::default(),
            notes: Log::default(),
            sample: Box::new(move |log| evaluate(&sampling, "window.m()", None, log, "sample")),
            world_press: None,
            native_input: None,
            picture: None,
        };
        scripted(&mut way, &web);
        vec![(way, Box::new((offscreen, web)) as Box<dyn std::any::Any>)]
    }

    pub fn window_state(window: &tao::window::Window, when: &str) -> Value {
        json!({ "when": when, "window has focus": window.is_focused() })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use std::rc::Rc;

    use serde_json::{json, Value};

    use super::Way;

    pub const ENGINE: &str = "none: this probe is the Mac's and Linux's";

    pub fn os() -> String {
        String::new()
    }

    pub fn extend(
        _way: &mut Way,
        _view: &Rc<wry::WebView>,
        _window: &tao::window::Window,
        _none: bool,
    ) {
    }

    pub fn own_ways(_window: &tao::window::Window) -> Vec<(Way, Box<dyn std::any::Any>)> {
        Vec::new()
    }

    pub fn window_state(_window: &tao::window::Window, when: &str) -> Value {
        json!({ "when": when })
    }
}
