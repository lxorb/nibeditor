//! How much of the machine's memory the engine is holding, so an agent cannot make the
//! reader's machine slow (docs/agent-native.md 6.4).
//!
//! Every engine process is a child of the app's own: the browser process, the renderers,
//! the GPU and the utilities. Their working sets together are the engine's cost to the
//! reader, and past 3 GB an agent's `browser_open` is refused with the reason rather
//! than adding another page to it. Asked only when an agent opens a tab.

/// The engine's working set past which an agent opens no more tabs.
const CEILING: u64 = 3 * 1024 * 1024 * 1024;

/// Why an agent may not open another tab now, or `None` when it may.
pub fn too_much() -> Option<String> {
    let used = engine_bytes();
    (used > CEILING).then(|| {
        format!(
            "the browser is using {} MB of memory, past nib's ceiling of {} MB for agents: close or finish some tabs first",
            used / (1024 * 1024),
            CEILING / (1024 * 1024)
        )
    })
}

/// The working sets of every process below the app's own, together.
pub fn engine_bytes() -> u64 {
    let own = std::process::id();
    let all = crate::terminal::process::processes();
    let mut below = vec![own];
    let mut at = 0;
    while at < below.len() {
        let parent = below[at];
        for one in &all {
            if one.parent == parent && one.id != parent && !below.contains(&one.id) {
                below.push(one.id);
            }
        }
        at += 1;
    }
    below.iter().skip(1).map(|pid| working_set(*pid)).sum()
}

/// One process's working set, in bytes; nothing for a process that cannot be asked.
#[allow(
    unsafe_code,
    reason = "a process's memory is Win32's own question and has no safe wrapper"
)]
fn working_set(pid: u32) -> u64 {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let size = u32::try_from(std::mem::size_of::<PROCESS_MEMORY_COUNTERS>()).unwrap_or(u32::MAX);
    // SAFETY: the handle is this function's own and closed before it returns; the
    // counters are written by Windows into a structure whose size it is told.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return 0;
        };
        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: size,
            ..Default::default()
        };
        let read = K32GetProcessMemoryInfo(handle, &raw mut counters, size).as_bool();
        let _ = CloseHandle(handle);
        if read {
            u64::try_from(counters.WorkingSetSize).unwrap_or(0)
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_test_runner_itself_holds_no_engine() {
        // The test binary starts no webview, so nothing below it is an engine; what is
        // asserted is that asking does not fail or take the machine's whole process list.
        assert!(super::engine_bytes() < super::CEILING);
        assert!(super::too_much().is_none());
    }
}
