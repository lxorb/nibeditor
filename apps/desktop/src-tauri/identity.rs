//! Two facts `nib mcp` needs without Tauri's generated context: the identifier, which
//! names the folder the running app keeps its endpoint file in, and the version it says
//! it is. Read from the same files and the same `TAURI_CONFIG` tauri-build reads, so a
//! probe built with an identifier of its own is a probe whose `nib mcp` finds that probe
//! and never the reader's own nib. See src/mcp/home.rs.
//!
//! A file of its own because two build scripts say them: the app's (`build.rs`) and the
//! Chromium build's (`cef/build.rs`), which compiles the same library and so needs the
//! same two variables. Both run it from the app's folder, after `tauri_build::build`.

/// Says both to the crate being built.
pub fn say() {
    let config = config();
    let said = |key: &str| {
        config
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    println!("cargo:rustc-env=NIB_IDENTIFIER={}", said("identifier"));
    println!("cargo:rustc-env=NIB_VERSION={}", said("version"));
}

/// The configuration as tauri-build reads it: the file, the platform's own file over it,
/// and what `--config` put in `TAURI_CONFIG` over both, key by key at the top, which is
/// all the two keys above need of a merge.
fn config() -> serde_json::Value {
    let target = std::env::var("TARGET").unwrap_or_default();
    let here = std::env::current_dir().expect("the build runs in the app's folder");
    let (mut config, _) = tauri_utils::config::parse::read_from(
        tauri_utils::platform::Target::from_triple(&target),
        &here,
    )
    .expect("tauri.conf.json, which tauri-build has just read");

    let asked = std::env::var("TAURI_CONFIG").ok();
    let over = asked
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok());
    if let (Some(serde_json::Value::Object(over)), serde_json::Value::Object(held)) =
        (over, &mut config)
    {
        held.extend(over);
    }
    config
}
