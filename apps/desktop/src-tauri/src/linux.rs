//! Runtime choices for the system `WebKitGTK` engine on Linux.

/// Disable accelerated compositing for native Wayland sessions, before `WebKitGTK` starts.
///
/// `WebKitGTK`'s accelerated compositing has produced repeated blank or partially rendered
/// frames on Wayland. Its software compositing path avoids that surface handoff. Leave
/// X11 alone, and let a reader's explicit setting take precedence.
pub fn prepare_rendering() {
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some() {
        return;
    }

    let wayland = std::env::var_os("GDK_BACKEND").map_or_else(
        || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|display| !display.is_empty()),
        |backend| {
            backend
                .to_string_lossy()
                .split(',')
                .next()
                .is_some_and(|one| one.trim().eq_ignore_ascii_case("wayland"))
        },
    );
    if wayland {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}
