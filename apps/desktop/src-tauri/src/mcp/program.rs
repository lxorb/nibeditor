//! The program an agent's client runs as `nib mcp`: this binary, where it is installed.
//! The settings pane asks for it to write the line a reader pastes into their client
//! (`src/lib/agents/mcp.ts`), and `nib mcp` starts the app with it when nib is closed.
//!
//! An `AppImage` is the one place the running binary is the wrong answer: it runs from a
//! folder mounted for that run alone, gone once it ends, and the program to name is the
//! `AppImage` itself, which its runtime says in `APPIMAGE`.

use std::path::PathBuf;

/// This program's path, as a client should run it.
pub fn program() -> Result<PathBuf, String> {
    if cfg!(target_os = "linux") {
        if let Some(image) = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|one| one.is_absolute())
        {
            return Ok(image);
        }
    }
    std::env::current_exe().map_err(|error| format!("this program cannot find itself: {error}"))
}

/// The program the settings pane's copy line names, for the reader to paste into an
/// agent's client: `claude mcp add --scope user nib -- "<this>" mcp`.
#[tauri::command]
pub fn mcp_program(webview: tauri::Webview) -> Result<String, String> {
    crate::agents::from_the_app(&webview)?;
    program().map(|path| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_is_this_one() {
        let found = program().expect("a path");
        assert!(found.is_absolute());
        if !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_none() {
            assert_eq!(found, std::env::current_exe().expect("this test"));
        }
    }
}
