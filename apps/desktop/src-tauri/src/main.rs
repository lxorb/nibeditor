//! The desktop app. Everything it does lives in the library beside this file;
//! this is only the entry point, and the attribute that keeps a console window
//! from opening behind the app on Windows.
//!
//! One argument is read here, before anything of Tauri starts: `nib mcp` is not the app
//! but the server an agent's client runs, speaking the Model Context Protocol on stdin
//! and stdout. Branching this early is what keeps it that: no window, no webview, no
//! hand-off to a nib that is already running, no updater, and nothing on stdout but the
//! protocol. See src/mcp/mod.rs.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(desktop)]
    if std::env::args_os()
        .nth(1)
        .is_some_and(|first| first == "mcp")
    {
        std::process::exit(nib_lib::mcp::serve());
    }
    nib_lib::run();
}
