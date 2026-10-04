//! Tauri's global shortcut plugin, added to the app the first time a key from any app
//! is wanted and never at launch: the agents' stop (`agents/shell.rs`) and quick add
//! (`quick_add.rs`) both hold one, and a plugin added twice is refused the second time,
//! which would leave whichever came second with no key at all.
//!
//! On the event loop's own thread, which both callers are on: a plugin added at run
//! time, and a hot key registered, have to live there.

use std::sync::OnceLock;

use tauri::AppHandle;

static READY: OnceLock<bool> = OnceLock::new();

/// Whether the plugin is in the app, added now where it was not yet.
pub fn ready(app: &AppHandle) -> bool {
    *READY.get_or_init(|| {
        app.plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .is_ok()
    })
}
