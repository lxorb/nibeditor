//! Tauri's own build step: it generates the context the app is compiled with,
//! which is where the config, the icons and the permissions come from.
//!
//! And two facts `nib mcp` needs without any of that, the identifier and the version;
//! see identity.rs, which the Chromium build's own build script runs as well.

#[path = "identity.rs"]
mod identity;

fn main() {
    tauri_build::build();
    identity::say();
}
