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
//! nib starts say it themselves (see shells.rs); on Linux and on a Mac the kernel is asked
//! as well, for the shells that do not - zsh and fish, a Mac's own among them.

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

/// The programs that start another and are not what anybody would call it by: npm's
/// Codex is a Node script that starts `codex.exe`. One of these below the program in
/// front is the one the tab is named for.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
const AGENTS: [&str; 2] = ["claude.exe", "codex.exe"];

/// Whether a process is somebody at a prompt rather than something running.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
fn idle(one: &Process) -> bool {
    IDLE.contains(&one.name.to_ascii_lowercase().as_str())
}

/// The first process below `root`, nearest first, that `stop` answers for, walking down
/// only through the processes `through` lets by.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
fn first_below(
    root: u32,
    processes: &[Process],
    through: impl Fn(&Process) -> bool,
    stop: impl Fn(&Process) -> bool,
) -> Option<&Process> {
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
            if stop(one) {
                return Some(one);
            }
            if through(one) {
                below.push(one.id);
            }
        }
    }

    None
}

/// The program in front below `root` in a list of processes: the first that is not a
/// shell, walking down through shells - VS Code's reading of a Windows terminal - or an
/// agent that program started. None while only shells run.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
pub fn front_below(root: u32, processes: &[Process]) -> Option<&Process> {
    let front = first_below(root, processes, idle, |one| !idle(one))?;
    let agent = |one: &Process| AGENTS.contains(&one.name.to_ascii_lowercase().as_str());
    if agent(front) {
        return Some(front);
    }
    Some(first_below(front.id, processes, |_| true, agent).unwrap_or(front))
}

/// Whether anything but a shell runs below `root` in a list of processes.
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
pub fn busy_below(root: u32, processes: &[Process]) -> bool {
    first_below(root, processes, idle, |one| !idle(one)).is_some()
}

/// A program's name as a tab says it: the file's, without Windows' `.exe`.
fn program_name(file: &str) -> String {
    let stem = file
        .len()
        .checked_sub(4)
        .filter(|&at| file.is_char_boundary(at) && file[at..].eq_ignore_ascii_case(".exe"))
        .map_or(file, |at| &file[..at]);
    stem.to_owned()
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

/// The program in front of the shell, by name, or None while the shell is: what a tab
/// is named for. See `front_below`.
#[cfg(windows)]
pub fn program(shell: Option<u32>, _master: &dyn MasterPty) -> Option<String> {
    let processes = processes();
    front_below(shell?, &processes).map(|one| program_name(&one.name))
}

/// The program in front of the shell, by name: the terminal's foreground group, where
/// it is somebody else's.
#[cfg(unix)]
pub fn program(shell: Option<u32>, master: &dyn MasterPty) -> Option<String> {
    let front = master.process_group_leader()?;
    if i64::from(front) == i64::from(shell?) {
        return None;
    }
    name_of(u32::try_from(front).ok()?).map(|name| program_name(&name))
}

/// What a process is called, out of Linux's `/proc`.
#[cfg(target_os = "linux")]
fn name_of(pid: u32) -> Option<String> {
    let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

/// What a process is called, out of a Mac's `proc_pidpath`: the last part of the path
/// of the program it runs.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "proc_pidpath is the kernel's own call and has no safe wrapper"
)]
fn name_of(pid: u32) -> Option<String> {
    let pid = libc::c_int::try_from(pid).ok()?;
    let mut buffer = vec![0_u8; 4096];
    let size = u32::try_from(buffer.len()).ok()?;

    // SAFETY: the buffer is as long as the kernel is told, and it writes no more.
    let written = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), size) };
    let written = usize::try_from(written).ok().filter(|&length| length > 0)?;

    let path = String::from_utf8_lossy(&buffer[..written.min(buffer.len())]).into_owned();
    path.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// Elsewhere there is no kernel to ask.
#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn name_of(_pid: u32) -> Option<String> {
    None
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

/// Which folder the shell is in, where the kernel can say: a Mac's `proc_pidinfo`, which
/// is what `lsof -d cwd` asks. zsh, a Mac's own shell, is taught nothing about saying its
/// folder, so this is how a terminal of it comes back where it was.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "proc_pidinfo is the kernel's own call and has no safe wrapper"
)]
pub fn folder(shell: Option<u32>) -> Option<String> {
    let pid = libc::c_int::try_from(shell?).ok()?;
    let size = libc::c_int::try_from(std::mem::size_of::<libc::proc_vnodepathinfo>()).ok()?;
    let mut info = std::mem::MaybeUninit::<libc::proc_vnodepathinfo>::zeroed();

    // SAFETY: the buffer is a whole `proc_vnodepathinfo`, `size` says as much, and the
    // kernel writes no more than it is told it may.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if written != size {
        return None;
    }

    // SAFETY: zeroed and then filled by the kernel, and every field of it is plain data.
    let info = unsafe { info.assume_init() };
    let path: Vec<u8> = info
        .pvi_cdir
        .vip_path
        .iter()
        .flatten()
        .map(|one| one.to_ne_bytes()[0])
        .take_while(|one| *one != 0)
        .collect();
    (!path.is_empty()).then(|| String::from_utf8_lossy(&path).into_owned())
}

/// Windows cannot, without reading another process's memory; the shells say it
/// themselves instead.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
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

    #[test]
    fn the_program_in_front_is_the_first_that_is_not_a_shell() {
        let listed = [
            process(20, 10, "pwsh.exe"),
            process(21, 20, "conhost.exe"),
            process(22, 20, "cmd.exe"),
            process(23, 22, "node.exe"),
            process(24, 23, "esbuild.exe"),
        ];
        assert_eq!(front_below(20, &listed).map(|one| one.id), Some(23));
        assert_eq!(front_below(20, &listed[..3]), None);
    }

    /// npm's Codex is Node starting `codex.exe`, and Claude Code's `.cmd` is a Command
    /// Prompt starting `claude.exe`: the tab is named for the agent either way.
    #[test]
    fn an_agent_a_launcher_started_is_the_program_in_front() {
        let codex = [
            process(20, 10, "pwsh.exe"),
            process(30, 20, "node.exe"),
            process(31, 30, "codex.exe"),
            process(32, 31, "git.exe"),
        ];
        assert_eq!(front_below(20, &codex).map(|one| one.id), Some(31));

        let claude = [
            process(20, 10, "pwsh.exe"),
            process(40, 20, "cmd.exe"),
            process(41, 40, "claude.exe"),
            process(42, 41, "node.exe"),
        ];
        assert_eq!(front_below(20, &claude).map(|one| one.id), Some(41));
    }

    #[test]
    fn a_program_is_named_without_its_ending() {
        assert_eq!(program_name("node.exe"), "node");
        assert_eq!(program_name("Python.EXE"), "Python");
        assert_eq!(program_name("nvim"), "nvim");
        assert_eq!(program_name(".exe"), "");
        assert_eq!(program_name("ä.exe"), "ä");
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

    /// The kernel's own answer, on the two systems that have one: a process started in a
    /// folder is found there, which is what brings a zsh or fish tab back where it was.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn the_kernel_says_where_a_process_is() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .current_dir(dir.path())
            .spawn()
            .unwrap();
        let found = folder(Some(child.id()));
        let _ = child.kill();
        let _ = child.wait();

        // A Mac's temporary folder is under a link, and the kernel answers the real path.
        let wanted = dir.path().canonicalize().unwrap();
        assert_eq!(found.map(std::path::PathBuf::from), Some(wanted));
        assert_eq!(folder(None), None);
    }
}
