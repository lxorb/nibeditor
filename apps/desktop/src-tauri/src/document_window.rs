//! A window as the system sees the document in it: its title, whether what is in
//! it is saved, and which file it is.
//!
//! The bar across the top draws the note's name itself, so on a Mac the system's
//! title is hidden (`hiddenTitle` in tauri.macos.conf.json). It is still read,
//! though, by everything that lists windows rather than looking at one: Mission
//! Control, the Window menu, switching windows from the keyboard, the Dock's menu, and a screen
//! reader. So the title is the note's name, as it is in `TextEdit` and Typora.
//!
//! Two more things a Mac window carries for its document, which Tauri does not
//! reach and `AppKit` keeps on the `NSWindow`: the dot in the red close button that
//! says the document is unsaved, which is how every Mac document app says it
//! (`TextEdit`, Typora, Pages), and the file it stands for, which is what a
//! Cmd+click on the title shows the folders of wherever the title is on screen.
//! Elsewhere neither exists, and the title is all there is.
//!
//! And, on a Mac only, the plugin that puts the main window back where it was at
//! the last launch; see `remembered_frame`.

use tauri::Window;

/// Says what the window is showing: the title every platform lists it under, and
/// on a Mac whether it is unsaved and which file it is.
///
/// `path` is the note's file, or nothing for a note that has none yet and for a
/// tab that is not a file at all.
#[tauri::command]
pub fn show_document(
    window: Window,
    title: String,
    edited: bool,
    path: Option<String>,
) -> Result<(), String> {
    window
        .set_title(&title)
        .map_err(|error| format!("the window could not be retitled: {error}"))?;

    #[cfg(target_os = "macos")]
    mark(&window, edited, path.unwrap_or_default())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (edited, path);

    Ok(())
}

/// The edited dot and the represented file, set on the `NSWindow` on the main
/// thread, which is the only thread `AppKit` lets touch a window.
#[cfg(target_os = "macos")]
fn mark(window: &Window, edited: bool, path: String) -> Result<(), String> {
    let on = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(handle) = on.ns_window() {
                set_document_state(handle, edited, &path);
            }
        })
        .map_err(|error| format!("the window could not be marked: {error}"))
}

/// Writes the two onto the window behind `handle`, which is the `NSWindow` Tauri
/// hands out as a bare pointer.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "Tauri hands the NSWindow over as a bare pointer, and reading one as the object is the only way to it"
)]
fn set_document_state(handle: *mut std::ffi::c_void, edited: bool, path: &str) {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSString;

    if handle.is_null() {
        return;
    }

    // SAFETY: `ns_window` answers the window's own NSWindow, which the window
    // holds for as long as it exists, and this runs on the main thread inside a
    // closure the window itself scheduled, so the window is still alive and
    // AppKit's one-thread rule is kept.
    let ns_window: &NSWindow = unsafe { &*handle.cast::<NSWindow>() };
    ns_window.setDocumentEdited(edited);
    // An empty path is AppKit's own way of saying the window stands for no file.
    ns_window.setRepresentedFilename(&NSString::from_str(path));
}

/// The plugin that puts the main window back where it was at the last launch, the
/// way a Mac app reopens its window where it was left. Only the main window, which
/// is the one a launch opens; a second window opens at the default size, as it
/// did.
///
/// Only the size, the place and whether it was maximised. Not whether it is
/// visible: the launch shows the window itself, at once in the colour it was last
/// seen in or once the page is up (see ground.rs), and the plugin showing it
/// would undo exactly that. Nor its frame, which is the reader's setting (see
/// appearance.rs). A place on a display that is no longer connected is not put
/// back - the plugin checks it lands on a screen there is - so the system chooses
/// one instead.
///
/// A Mac's alone for now, since the window has to be put back before it is shown:
/// see `show_where_left`, which is why the plugin is told not to do that part itself.
/// Elsewhere the window is built on screen at once, before a webview that takes a
/// third of a second to start on Windows, and the move would be seen.
#[cfg(target_os = "macos")]
pub fn remembered_frame() -> tauri::plugin::TauriPlugin<crate::Engine> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(REMEMBERED)
        .with_filter(|label| label == "main")
        .skip_initial_state("main")
        .build()
}

/// Shows the main window where it was left, as the launch's last step.
///
/// The plugin would put it back by itself, but only when the event loop next comes
/// round, and the launch showed the window before that: it stood at the default size
/// and place for a moment and then jumped, which `jumpwatch` caught at fourteen
/// milliseconds. Putting it back here first is not enough either, because tao moves
/// and sizes a Mac window on the main queue rather than at once, and shows it at
/// once. So the showing goes on that queue too, behind the move, and the window is
/// first seen where it was left.
#[cfg(target_os = "macos")]
pub fn show_where_left(window: &tauri::WebviewWindow) {
    use tauri_plugin_window_state::WindowExt as _;
    let _ = window.restore_state(REMEMBERED);

    let window = window.clone();
    dispatch2::DispatchQueue::main().exec_async(move || {
        let _ = window.show();
    });
}

/// What is remembered of the main window: its size, its place and whether it was
/// maximised.
#[cfg(target_os = "macos")]
const REMEMBERED: tauri_plugin_window_state::StateFlags =
    tauri_plugin_window_state::StateFlags::SIZE
        .union(tauri_plugin_window_state::StateFlags::POSITION)
        .union(tauri_plugin_window_state::StateFlags::MAXIMIZED);

/// Writes down where the main window is, now, while it still exists. A quit takes the
/// windows down without the close request the plugin reads a window's frame on, so it
/// kept whatever the last resize it heard had said: a step short of where a drag
/// ended, which the next launch opened a few points larger, or the size the window
/// was built at when nothing it heard was a drag.
#[cfg(target_os = "macos")]
pub fn remember_frame(app: &tauri::AppHandle) {
    use tauri_plugin_window_state::AppHandleExt as _;
    let _ = app.save_window_state(REMEMBERED);
}
