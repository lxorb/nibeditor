//! What a terminal's shell is doing: whether something besides it is running, and which
//! folder it is in.
//!
//! **Busy** is the question a tab asks before it closes. VS Code asks before it kills a
//! terminal that has child processes, and iTerm2 before it closes a session running jobs
//! besides the idle ones; an idle shell closes without a word in both. So does this.
//!
//! On a Mac and on Linux the kernel keeps the answer: the terminal's foreground process
//! group is the shell's own while it waits at its prompt, and a program it runs is given
//! the terminal by becoming the foreground group. On Windows there is no such thing, so
//! the shell's descendants are listed, and anything among them that is not a console
//! host or a shell - Git Bash's launcher starts the real bash, `cmd` inside PowerShell is
//! still somebody at a prompt - is something running. A WSL distribution's programs live
//! in the Linux kernel and are not on that list, so a WSL tab closes without asking.
//!
//! **The folder** is what brings a terminal back where it was after a restart. The shells
//! nib starts say it themselves (see shells.rs); on Linux the kernel is asked as well,
//! for the shells that do not.

use portable_pty::MasterPty;

/// One running process, as the list of them says.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub id: u32,
    pub parent: u32,
    pub name: String,
}

/// The programs that are somebody at a prompt rather than something running: shells,
/// and the console hosts and launchers standing between a terminal and one.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
const IDLE: [&str; 13] = [
    "conhost.exe",
    "openconsole.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "bash.exe",
    "sh.exe",
    "zsh.exe",
    "fish.exe",
    "wsl.exe",
    "wslhost.exe",
    "wslrelay.exe",
    "git-bash.exe",
];

/// Whether anything but a shell runs below `root` in a list of processes.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
pub fn busy_below(root: u32, processes: &[Process]) -> bool {
    let mut below = vec![root];
    let mut at = 0;

    while let Some(&parent) = below.get(at) {
        at += 1;
        for one in processes
            .iter()
            .filter(|one| one.parent == parent && one.id != parent)
        {
            if below.contains(&one.id) {
                continue;
            }
            if !IDLE.contains(&one.name.to_ascii_lowercase().as_str()) {
                return true;
            }
            below.push(one.id);
        }
    }

    false
}

/// Whether something besides the shell is running in a terminal.
#[cfg(windows)]
pub fn busy(shell: Option<u32>, _master: &dyn MasterPty) -> bool {
    shell.is_some_and(|root| busy_below(root, &processes()))
}

/// Whether something besides the shell is running in a terminal: the terminal's
/// foreground group is somebody else's.
#[cfg(unix)]
pub fn busy(shell: Option<u32>, master: &dyn MasterPty) -> bool {
    let (Some(shell), Some(front)) = (shell, master.process_group_leader()) else {
        return false;
    };
    i64::from(front) != i64::from(shell)
}

/// Every process on the machine, from the toolhelp snapshot: the one call Windows has
/// that lists them with their parents.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the toolhelp snapshot is Win32's own call and has no safe wrapper"
)]
pub(crate) fn processes() -> Vec<Process> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut found = Vec::new();
    let size = u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(u32::MAX);

    // SAFETY: the snapshot is a handle this function owns and closes; each entry is
    // written by Windows into a structure whose size it is told, and read after the
    // call that filled it succeeded.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return found;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size,
            ..Default::default()
        };

        let mut more = Process32FirstW(snapshot, &raw mut entry).is_ok();
        while more {
            let end = entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len());
            found.push(Process {
                id: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                name: String::from_utf16_lossy(&entry.szExeFile[..end]),
            });
            more = Process32NextW(snapshot, &raw mut entry).is_ok();
        }

        let _ = CloseHandle(snapshot);
    }

    found
}

/// Which folder the shell is in, where the kernel can say: Linux's `/proc`.
#[cfg(target_os = "linux")]
pub fn folder(shell: Option<u32>) -> Option<String> {
    let link = std::fs::read_link(format!("/proc/{}/cwd", shell?)).ok()?;
    Some(link.to_string_lossy().into_owned())
}

/// Nowhere else can, without reading another process's memory; the shells say it
/// themselves instead.
#[cfg(not(target_os = "linux"))]
pub fn folder(_shell: Option<u32>) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(id: u32, parent: u32, name: &str) -> Process {
        Process {
            id,
            parent,
            name: name.to_owned(),
        }
    }

    #[test]
    fn a_shell_at_its_prompt_is_not_busy() {
        let listed = [
            process(10, 1, "nib.exe"),
            process(11, 10, "conhost.exe"),
            process(20, 10, "pwsh.exe"),
        ];
        assert!(!busy_below(20, &listed));
    }

    /// Git Bash is a launcher with the real bash under it, and PowerShell may have a
    /// Command Prompt open inside it: shells all the way down is still a prompt.
    #[test]
    fn shells_inside_shells_are_still_a_prompt() {
        let listed = [
            process(20, 10, "bash.exe"),
            process(21, 20, "bash.exe"),
            process(30, 5, "node.exe"),
        ];
        assert!(!busy_below(20, &listed));

        let nested = [process(20, 10, "pwsh.exe"), process(22, 20, "CMD.EXE")];
        assert!(!busy_below(20, &nested));
    }

    #[test]
    fn anything_else_below_it_is_something_running() {
        let listed = [
            process(20, 10, "pwsh.exe"),
            process(22, 20, "cmd.exe"),
            process(23, 22, "node.exe"),
        ];
        assert!(busy_below(20, &listed));
    }

    /// A process that names itself as its own parent - pid 0 on Windows does - is not a
    /// loop to walk for ever.
    #[test]
    fn a_process_that_is_its_own_parent_ends_the_walk() {
        let listed = [
            process(0, 0, "System Idle Process"),
            process(20, 0, "pwsh.exe"),
        ];
        assert!(!busy_below(20, &listed));
    }
}
