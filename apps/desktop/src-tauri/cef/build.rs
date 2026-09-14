//! What linking Chromium needs that the app's own build script cannot do.
//!
//! `tauri_build::build()` is deliberately *not* called here. It runs next door, in
//! the app's own build script, where the config, the capabilities and the Windows
//! resource belong - and running it twice in one build would embed two application
//! manifests and two icons and leave the linker to choose. What it would do
//! differently for a CEF application is two things, and one of them is the reason
//! the flagged build did not start on Windows at all:
//!
//! - on Linux, an rpath of `$ORIGIN`, because the executable links `libcef.so` and
//!   that library sits beside it rather than on the system's library path. That is
//!   below.
//! - on Windows, an application manifest. **The app's own manifest does not reach
//!   this binary, and that is a fact about cargo rather than an oversight.**
//!   `tauri_build::build()` compiles its resource through `embed-resource`, which
//!   emits `cargo:rustc-link-arg-bins` - and cargo applies that only to the binary
//!   targets of the package whose build script emitted it. The app's crate is a
//!   *dependency* here, so its manifest and its icon are linked into the app's own
//!   binary next door and into nothing else. A Windows binary with no manifest is
//!   given `comctl32.dll` 5.82 out of the system folder instead of the version 6
//!   side-by-side assembly, and an import of anything only version 6 exports then
//!   fails in the loader with `STATUS_ENTRYPOINT_NOT_FOUND` before the first line of
//!   the program runs - which is what batch 1 measured and could not name. `MANIFEST`
//!   below is the manifest CEF's own `cefsimple` carries rather than an invention, and
//!   `gate.py`'s loader walk prints the manifest a binary actually has beside the entry
//!   point the loader could not bind, so the two can be read against each other.
//!
//! See docs/browser.md, section 8.

/// The application manifest the flagged binary embeds on Windows.
///
/// Two sections and nothing else, so that it merges cleanly with the one rustc
/// embeds of its own (which says `longPathAware` and asks for no privileges): the
/// compatibility list CEF's `cefsimple` carries, whose `maxversiontested` the XAML
/// islands media path wants, and the dependency on version 6 of the common controls
/// that every Windows program with a UI has had since Vista and that the loader
/// refuses to start this one without.
const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Vista, 7, 8, 8.1 and 10, which is what CEF's own compatibility.manifest says. -->
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <!-- Required for XAML islands in the process, for media. -->
      <maxversiontested Id="10.0.18362.0"/>
    </application>
  </compatibility>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Written rather than kept as a file beside this one, so that the text and the
        // reason for it are in the same place. `/MANIFESTINPUT` is merged with whatever
        // else the linker was given, which is how rustc's own manifest survives.
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("a build directory"));
        let manifest = out.join("nib-cef.exe.manifest");
        std::fs::write(&manifest, MANIFEST).expect("the manifest");
        println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
