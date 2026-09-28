//! The system's own list of recently opened documents. Notes the reader opens are
//! handed to the shell, which is what fills the taskbar Jump List's Recent
//! category and the Start menu's recent documents. Windows keeps and orders the
//! list itself; there is nothing to store here.

/// Tells the shell a note was opened. Nothing is remembered on this side, so
/// there is nothing here that can fail.
///
/// Not `async`, because the shell orders the list by when each note was added and
/// a pool of threads would add them in any order; but not done on the calling
/// thread either, which is the one the window's message loop is on. The shell
/// takes about two milliseconds to file a note and, now and then, most of a tenth
/// of a second - 85 ms measured on Windows 11, for every note opened. So the note
/// goes to a thread of the shell's own, in order. See lane.rs.
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

#[cfg(not(target_os = "windows"))]
fn handed(_path: String) {
    // Other desktops read recent documents from their own files, which the
    // portal writes; nothing for the app to do.
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::PATH_AS_WIDE_STRING;
    use windows::Win32::UI::Shell::SHARD_PATHW;

    #[test]
    fn the_flag_is_the_one_the_shell_documents() {
        assert_eq!(i32::try_from(PATH_AS_WIDE_STRING), Ok(SHARD_PATHW.0));
    }
}
