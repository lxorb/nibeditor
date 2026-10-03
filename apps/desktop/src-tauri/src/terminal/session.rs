//! One shell in one pseudo terminal, and the four threads that keep it moving.
//!
//! - The **reader** takes what the shell prints, as fast as it prints it, into a buffer
//!   shared with the sender - and stops reading while more than [`MOST_UNSEEN`] bytes are
//!   out that the window has not drawn yet, so a `cat` of a large file waits for the
//!   screen rather than filling memory ahead of it.
//! - The **sender** hands that buffer to the window at most once a frame, and at once when
//!   nothing has been sent for a frame: a keystroke's echo is never held back, and a flood
//!   is one message per frame rather than one per read. VS Code's terminal and Windows
//!   Terminal both draw at the frame, and so does xterm.js on the other side.
//! - The **writer** puts keystrokes into the terminal in the order they came, from a
//!   queue, so the command that sends them never waits on a shell that is not reading.
//! - The **waiter** waits for the shell to exit, says so, and closes the terminal, which
//!   on Windows is what lets the reader reach the end of what the console had left to say.

use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::process;
use super::shells::Launch;

/// One frame at sixty a second: the fastest the window is sent anything.
const FRAME: Duration = Duration::from_millis(16);

/// How much the window may be behind before the shell is made to wait: a megabyte, which
/// xterm.js parses in a few frames.
const MOST_UNSEEN: usize = 1 << 20;

/// How long a shell that has exited may leave the terminal held open by something it
/// left running - `sleep 100 &` and `exit` on a Mac - before it is said to be gone.
const LINGER: Duration = Duration::from_millis(500);

/// What the window is sent.
#[derive(Debug, PartialEq, Eq)]
pub enum Out {
    /// What the shell printed since the last message, as bytes: UTF-8 cut wherever a read
    /// happened to end, which xterm.js puts back together.
    Bytes(Vec<u8>),
    /// The shell has exited, with this code. The last message a session sends.
    Exit(i64),
}

/// Where a session's messages go: the window's channel, or a test's list.
pub type Sink = Box<dyn Fn(Out) + Send + Sync>;

/// A running shell, as the commands reach it.
pub struct Session {
    master: Box<dyn MasterPty + Send>,
    input: Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    stream: Arc<Stream>,
}

/// The halves the threads take, handed over once the session has been put where the
/// commands can find it. Two steps because a shell that exits at once would otherwise be
/// forgotten before it had been remembered.
pub struct Started {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    queue: Receiver<Vec<u8>>,
    stream: Arc<Stream>,
}

/// What the reader, the sender and the waiter share.
#[derive(Default)]
struct Stream {
    flow: Mutex<Flow>,
    changed: Condvar,
}

#[derive(Default)]
struct Flow {
    /// Read and not sent yet.
    waiting: Vec<u8>,
    /// Sent and not drawn yet, as far as the window has said.
    unseen: usize,
    /// The reader has reached the end.
    drained: bool,
    /// The shell has exited, with this code.
    exit: Option<i64>,
    /// The window let go of it: nothing more is read or sent.
    ended: bool,
}

impl Stream {
    fn lock(&self) -> MutexGuard<'_, Flow> {
        self.flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn wait<'a>(&self, flow: MutexGuard<'a, Flow>) -> MutexGuard<'a, Flow> {
        self.changed
            .wait(flow)
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl Session {
    /// A shell, started in a terminal of this size. Nothing is read or written until
    /// [`Started::run`].
    pub fn open(launch: &Launch, cols: u16, rows: u16) -> Result<(Self, Started), String> {
        #[cfg(windows)]
        interrupts_reach_shells();

        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|error| format!("could not open a terminal: {error}"))?;

        let mut command = CommandBuilder::new(&launch.program);
        command.args(&launch.args);
        if let Some(folder) = &launch.folder {
            command.cwd(folder);
        }
        for (name, value) in &launch.env {
            command.env(name, value);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("could not start {}: {error}", launch.program.display()))?;
        // The shell holds the other end now. Ours going is what lets the reader see the
        // end of the output once the shell has gone.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| error.to_string())?;
        let (input, queue) = mpsc::channel();
        let stream = Arc::new(Stream::default());

        let session = Self {
            master: pair.master,
            input,
            killer: child.clone_killer(),
            pid: child.process_id(),
            stream: Arc::clone(&stream),
        };
        let started = Started {
            reader,
            writer,
            child,
            queue,
            stream,
        };

        Ok((session, started))
    }

    /// The shell's process id.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Whether this is the session a waiter was started for.
    fn same_stream(&self, stream: &Arc<Stream>) -> bool {
        Arc::ptr_eq(&self.stream, stream)
    }

    /// Keystrokes, in order.
    pub fn write(&self, bytes: Vec<u8>) {
        let _ = self.input.send(bytes);
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(size(cols, rows))
            .map_err(|error| error.to_string())
    }

    /// The window has drawn this much of what it was sent.
    pub fn seen(&self, bytes: usize) {
        let mut flow = self.stream.lock();
        flow.unseen = flow.unseen.saturating_sub(bytes);
        drop(flow);
        self.stream.changed.notify_all();
    }

    /// Whether something besides the shell is running in it; see process.rs.
    pub fn busy(&self) -> bool {
        process::busy(self.pid, &*self.master)
    }

    /// The program in front of the shell, by name, or None while the shell is; see
    /// process.rs.
    pub fn program(&self) -> Option<String> {
        process::program(self.pid, &*self.master)
    }

    /// Which folder the shell is in, where the system can say; see process.rs.
    pub fn folder(&self) -> Option<String> {
        process::folder(self.pid)
    }

    /// The end of it: nothing more is sent, the shell is killed and the terminal closed -
    /// which on Windows sends every console program still attached to it the same close a
    /// console window's cross does. Slow on Windows, where closing waits for the console
    /// host to finish, so the caller does it off the window's thread.
    pub fn end(mut self) {
        self.stream.lock().ended = true;
        self.stream.changed.notify_all();
        let _ = self.killer.kill();
        drop(self);
    }
}

impl Started {
    /// Sets it going. `ended` is called once the shell has exited, to let go of the
    /// session - which closes the terminal - unless it has been let go of already.
    pub fn run(self, sink: Sink, ended: impl FnOnce(&dyn Fn(&Session) -> bool) + Send + 'static) {
        let Self {
            reader,
            writer,
            child,
            queue,
            stream,
        } = self;

        let reading = Arc::clone(&stream);
        thread::spawn(move || read(reader, &reading));

        let sending = Arc::clone(&stream);
        thread::spawn(move || send(&sending, &sink));

        thread::spawn(move || write(writer, &queue));

        thread::spawn(move || {
            wait(child, &stream);
            // Only this session: the window may have let it go and started another under
            // the same name since.
            ended(&|session: &Session| session.same_stream(&stream));
            linger(&stream);
        });
    }
}

/// Ctrl+C, reaching the programs a shell runs.
///
/// Windows keeps a flag on every process that says whether Ctrl+C is ignored, and a
/// process starts with its parent's. Whatever started nib may have set it - a launcher
/// that starts its children in a group of their own, which is how an MSYS shell starts
/// a Windows program - and every shell and every program in every terminal would then
/// have ignored the interrupt: `ping` ran on through Ctrl+C. So nib says, once, that it
/// processes Ctrl+C as a process normally does, which costs a window with no console
/// nothing and is what its shells inherit.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "SetConsoleCtrlHandler is Win32's own call and has no safe wrapper"
)]
fn interrupts_reach_shells() {
    use std::sync::Once;
    use windows::Win32::System::Console::SetConsoleCtrlHandler;

    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: no handler is passed, so nothing of ours is ever called back; the call
        // only clears this process's own flag.
        let _ = unsafe { SetConsoleCtrlHandler(None, false) };
    });
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, 1000),
        cols: cols.clamp(2, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn read(mut reader: Box<dyn Read + Send>, stream: &Stream) {
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        {
            let mut flow = stream.lock();
            while !flow.ended && flow.unseen + flow.waiting.len() > MOST_UNSEEN {
                flow = stream.wait(flow);
            }
        }

        // Read to the end even once the window has let go, and throw it away: a Windows
        // console being closed waits until what it had to say has been taken, and a
        // reader that stopped would leave the close waiting for ever.
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let mut flow = stream.lock();
                if !flow.ended {
                    flow.waiting.extend_from_slice(&buffer[..count]);
                }
                drop(flow);
                stream.changed.notify_all();
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }

    stream.lock().drained = true;
    stream.changed.notify_all();
}

fn send(stream: &Stream, sink: &Sink) {
    let mut last: Option<Instant> = None;

    loop {
        let mut flow = stream.lock();
        while !flow.ended && flow.waiting.is_empty() && !(flow.drained && flow.exit.is_some()) {
            flow = stream.wait(flow);
        }
        if flow.ended {
            return;
        }

        if flow.waiting.is_empty() {
            let code = flow.exit.unwrap_or(-1);
            drop(flow);
            sink(Out::Exit(code));
            return;
        }

        // A frame since the last message, and the rest of what arrives in it goes too.
        if let Some(sent) = last {
            let since = sent.elapsed();
            if since < FRAME {
                drop(flow);
                thread::sleep(FRAME.saturating_sub(since));
                flow = stream.lock();
                if flow.ended {
                    return;
                }
            }
        }

        let bytes = std::mem::take(&mut flow.waiting);
        flow.unseen += bytes.len();
        drop(flow);

        sink(Out::Bytes(bytes));
        last = Some(Instant::now());
    }
}

fn write(mut writer: Box<dyn Write + Send>, queue: &Receiver<Vec<u8>>) {
    for bytes in queue {
        if writer
            .write_all(&bytes)
            .and_then(|()| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

fn wait(mut child: Box<dyn Child + Send + Sync>, stream: &Stream) {
    let code = child
        .wait()
        .map_or(-1, |status| i64::from(status.exit_code()));
    stream.lock().exit = Some(code);
    stream.changed.notify_all();
}

/// After the terminal has been closed: the reader either reaches the end, or something
/// the shell left running holds it open, in which case the shell is said to be gone
/// anyway once [`LINGER`] is up.
fn linger(stream: &Stream) {
    let until = Instant::now() + LINGER;
    let mut flow = stream.lock();

    while !flow.drained && !flow.ended {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        flow = stream
            .changed
            .wait_timeout(flow, left)
            .map_or_else(|poisoned| poisoned.into_inner().0, |(flow, _)| flow);
    }

    flow.drained = true;
    drop(flow);
    stream.changed.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    type Held = Arc<Mutex<Option<Session>>>;

    /// A shell that runs one line and waits for more: Command Prompt on Windows, `sh`
    /// elsewhere.
    fn shell() -> Launch {
        let (program, args): (PathBuf, Vec<String>) = if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
            (
                PathBuf::from(root).join(r"System32\cmd.exe"),
                vec!["/q".to_owned()],
            )
        } else {
            (PathBuf::from("/bin/sh"), Vec::new())
        };

        Launch {
            program,
            args,
            folder: Some(std::env::temp_dir()),
            env: vec![("TERM".to_owned(), "xterm-256color".to_owned())],
        }
    }

    /// A line that prints `nib-ok` without the line itself saying so, since the terminal
    /// echoes what is typed: the two halves are put together by the shell.
    const SAYS_OK: &str = if cfg!(windows) {
        "echo nib-%COMSPEC:~0,0%ok"
    } else {
        r#"echo nib-""ok"#
    };

    /// The end of a typed line, as each shell's console reads Enter.
    const ENTER: &str = if cfg!(windows) { "\r" } else { "\n" };

    /// Starts one, with everything it sends going into a channel the test reads.
    fn started(cols: u16, rows: u16) -> (Held, Receiver<Out>) {
        let (session, parts) = Session::open(&shell(), cols, rows).expect("a shell");
        let held = Arc::new(Mutex::new(Some(session)));
        let (tell, heard) = mpsc::channel();
        let tell = Mutex::new(tell);

        let keeping = Arc::clone(&held);
        parts.run(
            Box::new(move |out| {
                let _ = tell.lock().expect("the channel").send(out);
            }),
            move |mine| {
                let mut slot = keeping.lock().expect("the session");
                if slot.as_ref().is_some_and(mine) {
                    slot.take();
                }
            },
        );

        (held, heard)
    }

    fn typed(held: &Held, bytes: &str) {
        if let Some(session) = held.lock().expect("the session").as_ref() {
            session.write(bytes.as_bytes().to_vec());
        }
    }

    fn line(held: &Held, words: &str) {
        typed(held, &format!("{words}{ENTER}"));
    }

    /// Everything the shell prints until `wanted` has appeared or it exits, answering the
    /// cursor question a Windows console asks as it starts - which xterm.js answers in
    /// the app, and which the console waits for.
    fn printed_until(held: &Held, heard: &Receiver<Out>, wanted: &str) -> (String, Option<i64>) {
        let until = Instant::now() + Duration::from_secs(20);
        let mut bytes = Vec::new();

        while let Ok(out) = heard.recv_timeout(until.saturating_duration_since(Instant::now())) {
            match out {
                Out::Bytes(more) => {
                    if String::from_utf8_lossy(&more).contains("\u{1b}[6n") {
                        typed(held, "\u{1b}[1;1R");
                    }
                    bytes.extend(more);
                    if String::from_utf8_lossy(&bytes).contains(wanted) {
                        break;
                    }
                }
                Out::Exit(code) => {
                    return (String::from_utf8_lossy(&bytes).into_owned(), Some(code));
                }
            }
        }

        (String::from_utf8_lossy(&bytes).into_owned(), None)
    }

    /// The whole of it, the way a tab uses it: a line typed, its answer read, the
    /// terminal made another size, and the shell told to exit, with the code it exited
    /// with arriving last and the session letting itself go.
    #[test]
    fn a_shell_answers_resizes_and_exits() {
        let (held, heard) = started(80, 24);

        line(&held, SAYS_OK);
        let (said, _) = printed_until(&held, &heard, "nib-ok");
        assert!(said.contains("nib-ok"), "the shell printed: {said:?}");

        held.lock()
            .expect("the session")
            .as_ref()
            .expect("still running")
            .resize(120, 40)
            .expect("a resize");

        line(&held, "exit 3");
        let (_, code) = printed_until(&held, &heard, "\u{0}never");
        assert_eq!(code, Some(3));

        let until = Instant::now() + Duration::from_secs(5);
        while held.lock().expect("the session").is_some() && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            held.lock().expect("the session").is_none(),
            "the session outlived its shell"
        );
    }

    /// Closing a tab: the shell is killed, nothing more is said, nothing is left running.
    #[test]
    fn a_session_ended_by_the_window_kills_its_shell() {
        let (held, heard) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "nib-ok");

        let session = held.lock().expect("the session").take().expect("running");
        let pid = session.pid().expect("a pid");
        session.end();

        let quiet_until = Instant::now() + Duration::from_secs(2);
        while let Ok(out) =
            heard.recv_timeout(quiet_until.saturating_duration_since(Instant::now()))
        {
            assert!(
                !matches!(out, Out::Exit(_)),
                "an ended session said its shell exited"
            );
        }

        let until = Instant::now() + Duration::from_secs(10);
        while alive(pid) && Instant::now() < until {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(pid), "the shell {pid} outlived its tab");
    }

    /// Ctrl+C is the interrupt, and a program running in the shell stops for it.
    #[test]
    fn ctrl_c_interrupts_what_is_running() {
        let (held, heard) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "nib-ok");

        let long = if cfg!(windows) {
            "ping -n 30 127.0.0.1"
        } else {
            "sleep 30"
        };
        line(&held, long);
        thread::sleep(Duration::from_millis(1500));
        let busy = |held: &Held| {
            held.lock()
                .expect("the session")
                .as_ref()
                .is_some_and(Session::busy)
        };
        assert!(busy(&held), "{long} was not running");

        typed(&held, "\u{3}");
        let until = Instant::now() + Duration::from_secs(10);
        while busy(&held) && Instant::now() < until {
            let _ = heard.recv_timeout(Duration::from_millis(100));
        }
        assert!(!busy(&held), "Ctrl+C did not stop {long}");

        let session = held.lock().expect("the session").take().expect("running");
        session.end();
    }

    #[test]
    fn a_shell_at_its_prompt_is_not_busy() {
        let (held, heard) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "nib-ok");

        let session = held.lock().expect("the session").take().expect("running");
        assert!(!session.busy());
        session.end();
    }

    #[cfg(windows)]
    fn alive(pid: u32) -> bool {
        let listed = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed.contains(&format!(" {pid} "))
    }

    #[cfg(unix)]
    fn alive(pid: u32) -> bool {
        // A zombie is gone for this purpose, and `ps` says Z for one.
        let state = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .unwrap_or_default();
        !state.is_empty() && !state.starts_with('Z')
    }
}
