//! The system's own list of recently opened documents. Notes the reader opens are
//! handed to the shell, which is what fills the taskbar Jump List's Recent
//! category and the Start menu's recent documents on Windows, and the Dock icon's
//! menu and the Apple menu's Recent Items on a Mac. The system keeps and orders the
//! list itself; there is nothing to store here.
//!
//! The app's own File > Open Recent on a Mac is not this list but the one the
//! palette reads, so it names the same notes everywhere in the app; see
//! native-menu.ts.

/// Tells the shell a note was opened. Nothing is remembered on this side, so
/// there is nothing here that can fail.
///
/// Not `async`, because the shell orders the list by when each note was added and
/// a pool of threads would add them in any order; but not done on the calling
/// thread either, which is the one the window's message loop is on. The shell
/// takes about two milliseconds to file a note and, now and then, most of a tenth
/// of a second - 85 ms measured on Windows 11, for every note opened. So the note
/// goes to a thread of the shell's own, in order. See lane.rs.
///
/// A Mac's is filed on the calling thread after all, which is the main one: `AppKit`
/// takes it on no other, and filing one is a message to the Dock that returns at
/// once.
#[tauri::command]
pub fn remember_recent(path: String) {
    handed(path);
}

#[cfg(target_os = "windows")]
fn handed(path: String) {
    use std::sync::mpsc::Sender;
    use std::sync::OnceLock;

    static SHELL: OnceLock<Sender<String>> = OnceLock::new();

    // A thread that has gone takes nothing with it but a note missing from a list
    // the shell keeps for convenience.
    let _ = SHELL
        .get_or_init(|| crate::lane::lane(|path: String| add_to_recent(&path)))
        .send(path);
}

#[cfg(target_os = "macos")]
fn handed(path: String) {
    add_to_recent(&path);
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn handed(_path: String) {
    // Linux desktops read recent documents from their own files, which the
    // portal writes; nothing for the app to do.
}

/// Empties the list, as File > Open Recent > Clear Menu does in any Mac app: the
/// app's own menu and the Dock icon's menu are one list to a reader, and clearing
/// one of them leaves the other naming the very notes they asked to forget.
/// `TextEdit`'s Clear Menu empties both.
#[tauri::command]
pub fn forget_recent() {
    clear_recent();
}

/// `SHARD_PATHW`: the thing being added is a path, given as a wide string.
/// Spelled out because the crate offers it signed and the call wants it
/// unsigned, and a cast between the two is worth less than a constant with a
/// test on it.
#[cfg(target_os = "windows")]
const PATH_AS_WIDE_STRING: u32 = 3;

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "the shell's recent documents list is a C call with no safe wrapper"
)]
fn add_to_recent(path: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::SHAddToRecentDocs;

    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // Safe: the pointer is a null-terminated buffer that outlives the call, and
    // the shell only reads from it. The call needs nothing of the thread it is made
    // on - no COM started first - which is what lets it be made off the window's.
    unsafe {
        SHAddToRecentDocs(PATH_AS_WIDE_STRING, Some(wide.as_ptr().cast()));
    }
}

/// `NSDocumentController` keeps the Mac's list even for an app that is not built on
/// its documents, and the Dock shows it for every file type the bundle declares,
/// which `.md` is; see `fileAssociations` in tauri.conf.json.
#[cfg(target_os = "macos")]
fn add_to_recent(path: &str) {
    use objc2_app_kit::NSDocumentController;
    use objc2_foundation::{MainThreadMarker, NSString, NSURL};

    // AppKit is only ever called on the main thread. A command without `async` is
    // run there (see the top of lib.rs), so this is always the answer; if it ever is
    // not, the note is simply not listed, which is better than calling AppKit from
    // the wrong thread.
    let Some(main) = MainThreadMarker::new() else {
        return;
    };

    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    NSDocumentController::sharedDocumentController(main).noteNewRecentDocumentURL(&url);
}

/// Only this app's documents: the Dock menu and Recent Items under its name. Like
/// `add_to_recent`, only ever on the main thread.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "objc2 marks the call unsafe only for the sender it may be handed, and none is"
)]
fn clear_recent() {
    use objc2_app_kit::NSDocumentController;
    use objc2_foundation::MainThreadMarker;

    let Some(main) = MainThreadMarker::new() else {
        return;
    };

    // SAFETY: on the main thread, with no sender, which is how a menu item that is
    // not AppKit's own asks for it.
    unsafe { NSDocumentController::sharedDocumentController(main).clearRecentDocuments(None) };
}

/// Nothing elsewhere. Windows has no call that empties one app's recent
/// documents - the shell's only one empties the whole Recent folder, every app's -
/// and nothing but the Mac's menu bar has a Clear Menu to ask for it.
#[cfg(not(target_os = "macos"))]
fn clear_recent() {}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::PATH_AS_WIDE_STRING;
    use windows::Win32::UI::Shell::SHARD_PATHW;

    #[test]
    fn the_flag_is_the_one_the_shell_documents() {
        assert_eq!(i32::try_from(PATH_AS_WIDE_STRING), Ok(SHARD_PATHW.0));
    }
}
