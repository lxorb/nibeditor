//! What a Linux desktop needs of the app beyond what GTK does by itself, and Wayland
//! above all.
//!
//! **Before GTK starts** (`prepare`, the first thing a launch does). `WebKitGTK` draws
//! through DMA-BUF buffers, which NVIDIA's own driver does not hand it the way Mesa does:
//! the window opens blank, or the session's compositor drops it with a protocol error.
//! Every Tauri app on that driver sets `WEBKIT_DISABLE_DMABUF_RENDERER`, and every
//! package of one sets it again for itself; here the app sets it, once, where the driver
//! is NVIDIA's and the reader has not said otherwise, so every package gets it. One file
//! looked for, which is microseconds of a launch.
//!
//! **Coming forward.** A Wayland compositor gives the front only to a window that shows
//! a token from the press that asked for it (xdg-activation): the launcher's, handed to
//! a launch as `XDG_ACTIVATION_TOKEN`, or the portal's, handed with a key from any app.
//! GTK 3 reads the launcher's only under its old name, `DESKTOP_STARTUP_ID`, so the first
//! window is handed it under that one. A second launch's token is the second launch's,
//! so it travels with its arguments to the app already running (`handover.rs`), and
//! `placement::raised` gives it to GTK just before the window is brought forward. Without one the
//! compositor is right to refuse, and GNOME says the app is ready instead.
//!
//! **Where a window is.** Wayland never tells an app where its windows are and never
//! lets one put them anywhere: the compositor places every window itself. So a window's
//! size and whether it was maximised come back on a launch, and its place does not
//! (`places_windows`).
//!
//! **Where a web tab's page is.** Tauri hands a web tab's page to GTK packed into the
//! window's column beside the window's own page, where GTK shares the height out between
//! them and takes no notice of the bounds the page is given: the site came up in the
//! bottom half of the window, cut off, and the app's own page squeezed into the top half
//! (a 1.77 screen under Hyprland, 2026-10-14, and every Linux desktop alike). So the
//! column goes into an overlay of its own, once per window, and each page is laid over
//! it at its bounds, in GTK's own pixels, which are the window's CSS pixels at any scale
//! (`page_over`).

use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

/// The switch `WebKitGTK` reads to draw without DMA-BUF.
const DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Present only while NVIDIA's own kernel driver is loaded; nouveau has no such file.
const NVIDIA: &str = "/proc/driver/nvidia/version";

/// The token a launcher hands the program it starts, and the name GTK 3 reads it by.
const TOKEN: &str = "XDG_ACTIVATION_TOKEN";
const STARTUP_ID: &str = "DESKTOP_STARTUP_ID";

/// How long a token is worth holding on to: the compositor hands one out for a press,
/// and a press is answered at once or not at all.
const FRESH: Duration = Duration::from_secs(10);

/// The launcher's token, read before GTK took it.
static LAUNCHED_WITH: OnceLock<Option<String>> = OnceLock::new();

/// A token that arrived for the next window to come forward, and when.
static PENDING: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Whether GTK draws on Wayland, as it said on the event loop's thread; see `learn`.
static DRAWN_ON_WAYLAND: OnceLock<bool> = OnceLock::new();

/// Before GTK and before any thread: DMA-BUF off on NVIDIA's driver, and the launcher's
/// token where GTK 3 looks for it.
pub fn prepare() {
    if dmabuf_off(
        std::path::Path::new(NVIDIA).exists(),
        std::env::var_os(DMABUF).is_some(),
    ) {
        std::env::set_var(DMABUF, "1");
    }
    let token = std::env::var(TOKEN).ok().filter(|token| !token.is_empty());
    if let Some(token) = &token {
        if std::env::var_os(STARTUP_ID).is_none() {
            std::env::set_var(STARTUP_ID, token);
        }
        // Not handed on to a terminal's shells, whose programs would show a token that
        // was never theirs.
        std::env::remove_var(TOKEN);
    }
    let _ = LAUNCHED_WITH.set(token);
}

/// Whether to turn DMA-BUF off: NVIDIA's driver, and nobody having set it either way.
fn dmabuf_off(nvidia: bool, already_said: bool) -> bool {
    nvidia && !already_said
}

/// The token this launch was started with, if the launcher gave one.
pub fn launched_with() -> Option<&'static str> {
    LAUNCHED_WITH.get().and_then(Option::as_deref)
}

/// Whether this is a Wayland session, whatever GTK was told to draw with: under one, no
/// app hears a key pressed in another, `XWayland`'s included.
pub fn wayland_session() -> bool {
    static SESSION: OnceLock<bool> = OnceLock::new();
    *SESSION.get_or_init(|| {
        session_is_wayland(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        )
    })
}

fn session_is_wayland(display: Option<&str>, kind: Option<&str>) -> bool {
    display.is_some_and(|display| !display.is_empty()) || kind == Some("wayland")
}

/// Asks GTK which display it opened. On the event loop's thread, once, before any window
/// is placed: GTK may be asked nothing anywhere else.
pub fn learn() {
    let _ = DRAWN_ON_WAYLAND.get_or_init(gdk_on_wayland);
}

fn gdk_on_wayland() -> bool {
    use gtk::glib::object::ObjectExt as _;
    gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay")
}

/// Whether the app may put its windows anywhere: not on Wayland, where the compositor
/// places them.
pub fn places_windows() -> bool {
    !DRAWN_ON_WAYLAND.get().copied().unwrap_or(false)
}

/// A token for the next window to come forward: a second launch's, or a key's from any
/// app.
pub fn token_arrived(token: String) {
    *PENDING.lock().unwrap_or_else(PoisonError::into_inner) = Some((token, Instant::now()));
}

/// The token waiting, where it is still fresh, taken.
fn fresh_token() -> Option<String> {
    let (token, at) = PENDING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()?;
    (at.elapsed() < FRESH).then_some(token)
}

/// The token waiting for the window coming forward now, where there is a compositor to
/// show it to; `raised` in placement.rs hands it to GTK on the event loop's thread, then
/// brings the window forward.
pub fn token_for_raise() -> Option<String> {
    if places_windows() {
        return None;
    }
    fresh_token()
}

/// The token handed to GTK, which shows it to the compositor with the next window that
/// asks to come forward.
#[allow(
    unsafe_code,
    reason = "GTK 3's Wayland display has no safe binding for its startup token"
)]
pub fn hand_gtk(token: &str) {
    use gtk::glib::object::{ObjectExt as _, ObjectType as _};

    let Some(display) = gtk::gdk::Display::default() else {
        return;
    };
    if display.type_().name() != "GdkWaylandDisplay" {
        return;
    }
    let Ok(token) = std::ffi::CString::new(token) else {
        return;
    };
    // SAFETY: the display is GDK's Wayland display, checked just above and alive for the
    // call, and GDK copies the string before it returns.
    unsafe {
        gdkwayland_sys::gdk_wayland_display_set_startup_notification_id(
            display.as_ptr().cast(),
            token.as_ptr(),
        );
    }
}

/// A web tab's page over the window's own, at `left`, `top`, `width` and `height` in GTK's
/// own pixels: taken out of the window's column into an overlay over it the first time,
/// and moved there every time after. On the event loop's thread, where GTK is.
pub fn page_over(view: &tauri::Webview, (left, top, width, height): (i32, i32, u32, u32)) {
    let _ = view.with_webview(move |platform| {
        use gtk::glib::object::Cast as _;
        let page: gtk::Widget = platform.inner().upcast();
        over(&page, left, top, width, height);
    });
}

fn over(page: &gtk::Widget, left: i32, top: i32, width: u32, height: u32) {
    use gtk::glib::object::{Cast as _, ObjectExt as _};
    use gtk::prelude::{ContainerExt as _, OverlayExt as _, WidgetExt as _};

    let Some(parent) = page.parent() else {
        return;
    };
    if !parent.is::<gtk::Overlay>() {
        let Ok(column) = parent.downcast::<gtk::Box>() else {
            return;
        };
        let Some(overlay) = overlay_round(&column) else {
            return;
        };
        column.remove(page);
        // From the window's top left corner whichever way the reader's language runs: a
        // page's bounds are measured from there.
        page.set_direction(gtk::TextDirection::Ltr);
        page.set_halign(gtk::Align::Start);
        page.set_valign(gtk::Align::Start);
        overlay.add_overlay(page);
    }
    page.set_margin_start(left.max(0));
    page.set_margin_top(top.max(0));
    page.set_size_request(
        i32::try_from(width).unwrap_or(i32::MAX),
        i32::try_from(height).unwrap_or(i32::MAX),
    );
}

/// The overlay the window's column sits in, made the first time a page is laid over it.
fn overlay_round(column: &gtk::Box) -> Option<gtk::Overlay> {
    use gtk::glib::object::Cast as _;
    use gtk::prelude::{ContainerExt as _, WidgetExt as _};

    let holder = column.parent()?;
    if let Ok(overlay) = holder.clone().downcast::<gtk::Overlay>() {
        return Some(overlay);
    }
    let holder = holder.downcast::<gtk::Container>().ok()?;
    let overlay = gtk::Overlay::new();
    holder.remove(column);
    overlay.add(column);
    holder.add(&overlay);
    overlay.show();
    Some(overlay)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dmabuf_goes_off_on_nvidia_unless_somebody_said() {
        assert!(dmabuf_off(true, false));
        assert!(!dmabuf_off(true, true));
        assert!(!dmabuf_off(false, false));
    }

    #[test]
    fn a_session_is_wayland_by_its_display_or_its_type() {
        assert!(session_is_wayland(Some("wayland-0"), None));
        assert!(session_is_wayland(None, Some("wayland")));
        assert!(!session_is_wayland(Some(""), Some("x11")));
        assert!(!session_is_wayland(None, None));
    }

    #[test]
    fn a_token_is_taken_once() {
        token_arrived("one".into());
        assert_eq!(fresh_token().as_deref(), Some("one"));
        assert_eq!(fresh_token(), None);
    }
}
