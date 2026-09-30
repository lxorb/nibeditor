//! A program and everything it starts, as one thing to end.
//!
//! Claude Code and Codex are rarely one process: an npm install is `cmd.exe` starting
//! `node` starting the real program, and the program may start more. Ending the first
//! of them leaves the rest running with nobody reading them - the zombie that other apps
//! doing this are reported for. So what is ended is the family, by what nib itself
//! started and never by a name:
//!
//! - **Windows**: a job object the child is put in as it starts, which ends every process
//!   in it when asked, and on its own when nib lets go of it - including when nib itself
//!   ends in a way nobody planned, since the system closes the handle then. The child is
//!   started with no console window of its own, and with nib's own standard handles kept
//!   out of it (`keep_the_pipes`, the fix `nib mcp` needed for the same reason).
//! - **A Mac and Linux**: a process group of its own, led by the child, and the whole
//!   group killed while the leader is still there to name it.

use std::io;
use std::process::{Child, Command};

/// Everything one started program is, to be ended at once.
pub struct Family {
    pid: u32,
    #[cfg(windows)]
    job: Option<std::os::windows::io::OwnedHandle>,
}

/// Starts `command` as the head of a family.
pub fn spawn(command: &mut Command) -> io::Result<(Child, Family)> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;

        /// `CREATE_NO_WINDOW`: a console program started by a GUI app gets a console
        /// window of its own otherwise, which would flash up in front of everything.
        const NO_WINDOW: u32 = 0x0800_0000;

        crate::mcp::keep_the_pipes();
        command.creation_flags(NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }

    let child = command.spawn()?;
    let family = Family {
        pid: child.id(),
        #[cfg(windows)]
        job: job_for(&child),
    };
    Ok((child, family))
}

impl Family {
    /// Ends every process in the family. On a Mac and Linux only while the head has not
    /// been waited for, since its number names the group only until then; see run.rs,
    /// which asks under the same lock it waits under.
    pub fn end(&self) {
        #[cfg(windows)]
        {
            if let Some(job) = &self.job {
                end_job(job);
                return;
            }
            // A job could not be made - nib itself in a job that allows no other - so the
            // family is found by its head's number instead.
            let _ =
                quiet(Command::new("taskkill").args(["/T", "/F", "/PID", &self.pid.to_string()]))
                    .status();
        }
        #[cfg(unix)]
        {
            let _ = quiet(Command::new("kill").args(["-KILL", "--", &format!("-{}", self.pid)]))
                .status();
        }
    }
}

/// A command run for its effect alone, with nothing of this process's stdio, and on
/// Windows without a console window.
fn quiet(command: &mut Command) -> &mut Command {
    use std::process::Stdio;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}

/// A job object holding `child`, that ends everything in it when it is closed.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a job object is Win32's own and has no safe wrapper in the crates nib uses"
)]
fn job_for(child: &Child) -> Option<std::os::windows::io::OwnedHandle> {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let size = u32::try_from(std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).ok()?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    // SAFETY: the job is a handle this function creates and hands to an `OwnedHandle` at
    // once, which closes it exactly once; the limits are a structure of the size Windows
    // is told, read during the call; the process handle is the child's own, open for as
    // long as `child` is borrowed.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
        let owned = OwnedHandle::from_raw_handle(job.0);
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            size,
        )
        .ok()?;
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).ok()?;
        Some(owned)
    }
}

/// Ends every process in a job.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a job object is Win32's own and has no safe wrapper in the crates nib uses"
)]
fn end_job(job: &std::os::windows::io::OwnedHandle) {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::TerminateJobObject;

    // SAFETY: the handle is the job's, open for as long as `job` is borrowed.
    let _ = unsafe { TerminateJobObject(HANDLE(job.as_raw_handle()), 1) };
}
