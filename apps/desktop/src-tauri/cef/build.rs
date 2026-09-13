//! What linking Chromium needs that the app's own build script cannot do.
//!
//! `tauri_build::build()` is deliberately *not* called here. It runs next door, in
//! the app's own build script, where the config, the capabilities and the Windows
//! resource belong - and running it twice in one build would embed two application
//! manifests and two icons and leave the linker to choose. What it would do
//! differently for a CEF application is two things, and only one of them matters to
//! a build that is measured rather than installed:
//!
//! - on Linux, an rpath of `$ORIGIN`, because the executable links `libcef.so` and
//!   that library sits beside it rather than on the system's library path. That is
//!   below.
//! - on Windows, a slightly different application manifest - CEF's own
//!   `compatibility.manifest`, which adds a `maxversiontested` for the XAML islands
//!   media path. The app's usual manifest is what this build gets instead, which is
//!   a packaging row for batch 7 rather than a reason for a build script here.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }
}
