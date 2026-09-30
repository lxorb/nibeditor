//! The app's own build, run from the app's own folder.
//!
//! This package compiles `../src/lib.rs`, so everything `tauri_build` reads - the
//! config, the capabilities, the icons - is the app's, one folder up: the working
//! directory is moved there first, which is the pattern Tauri's own build script
//! documents for "a crate generating a context byte-identical to the app's". What it
//! writes for this package is its own: the Windows resource, with the icon, the
//! version and the application manifest, is linked into `nib-chromium` because this is
//! the package whose build script emitted it. And the identifier and the version the
//! library's `nib mcp` is compiled with, as the app's build says them; see identity.rs.

#[path = "../identity.rs"]
mod identity;

fn main() {
    std::env::set_current_dir("..").expect("the app's own folder");
    tauri_build::build();
    identity::say();
}
