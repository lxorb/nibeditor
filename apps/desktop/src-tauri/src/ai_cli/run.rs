//! One run of a program: the question on its stdin, the answer as lines, and its end,
//! whichever way it came - it finished, it was stopped, or it ran out of time. Or a run
//! that is kept talking to (`open`), a line at a time, until it is stopped or has been
//! idle too long: a session of the sidebar's.
//!
//! Nothing here knows what the lines mean. Claude Code's stream-json and Codex's JSONL
//! are read by the app (`lib/ai/local`), where they are tested beside the other
//! providers' wires; this is the plumbing that has to be right on three systems.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::family::{self, Family};

/// The longest line passed on. A stream-json line holds one event, and the longest of
/// those is a whole answer; a line past this is dropped rather than held in memory.
const LONGEST_LINE: u64 = 8 << 20;

/// How much of stderr is kept for the sentence a failure is read from: its last part,
/// which is where a program says why it stopped.
const ERR_TAIL: usize = 16 << 10;

/// Something a run said.
#[derive(Debug, PartialEq, Eq)]
pub enum Heard {
    /// One line of stdout, without its line break. Empty lines are not passed on.
    Line(String),
    /// The end; always the last thing heard, and heard once.
    End(Ended),
}

/// How a run ended.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    /// The exit code, where the program exited with one.
    pub code: Option<i32>,
    /// Whether it was ended for running too long.
    pub timed_out: bool,
    /// Whether it was ended because somebody stopped it.
    pub stopped: bool,
    /// The end of what it wrote to stderr.
    pub err: String,
}

struct Shared {
    /// The head of the family, until it has been waited for.
    child: Mutex<Option<Child>>,
    family: Family,
    stopped: AtomicBool,
    timed_out: AtomicBool,
    /// Its stdin, for a run that is kept talking to (`open`); `None` once closed.
    input: Mutex<Option<ChildStdin>>,
    /// When it was started, and how long after that it last said or was told anything,
    /// in milliseconds: what an idle run is measured by.
    born: Instant,
    last: AtomicU64,
}

impl Shared {
    fn child(&self) -> MutexGuard<'_, Option<Child>> {
        self.child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn input(&self) -> MutexGuard<'_, Option<ChildStdin>> {
        self.input
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Ends the family, while its head is still there to be named by.
    fn end(&self) {
        let held = self.child();
        if held.is_some() {
            self.family.end();
        }
    }

    /// Something was said or heard just now.
    fn touch(&self) {
        let now = u64::try_from(self.born.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.last.store(now, Ordering::SeqCst);
    }

    /// How long nothing has been said or heard.
    fn quiet_for(&self) -> Duration {
        let last = Duration::from_millis(self.last.load(Ordering::SeqCst));
        self.born.elapsed().saturating_sub(last)
    }
}

/// A run in progress, which can be stopped, and for one that was `open`ed, told more.
#[derive(Clone)]
pub struct Running(Arc<Shared>);

impl Running {
    /// Ends the program and everything it started. What it said before is kept; the
    /// end is heard as `stopped`.
    pub fn stop(&self) {
        self.0.stopped.store(true, Ordering::SeqCst);
        self.0.end();
    }

    /// Writes one line to the program's stdin. Refused once the input was closed.
    pub fn write_line(&self, line: &str) -> io::Result<()> {
        let mut held = self.0.input();
        let input = held
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "the input is closed"))?;
        input.write_all(line.as_bytes())?;
        input.write_all(b"
")?;
        input.flush()?;
        drop(held);
        self.0.touch();
        Ok(())
    }

    /// Closes the program's stdin: a program reading it to its end takes that as the
    /// last word, and ends once it has answered.
    pub fn close_input(&self) {
        self.0.input().take();
    }
}

/// When a run is ended for its time.
#[derive(Clone, Copy, Debug)]
enum Limit {
    /// However far it got, this long after it started.
    Total(Duration),
    /// Once nothing has been said to it or by it for this long.
    Idle(Duration),
}

/// Starts `command` with `input` on its stdin, which is then closed, and hands `heard`
/// each line of its stdout and then its end. `timeout` ends it however far it got.
pub fn start(
    command: Command,
    input: Vec<u8>,
    timeout: Duration,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    launch(command, Some(input), Limit::Total(timeout), heard)
}

/// Starts `command` with its stdin kept open for `Running::write_line`, and hands `heard`
/// each line of its stdout and then its end. It is ended once neither side has said
/// anything for `idle`: a conversation nobody is having.
pub fn open(
    command: Command,
    idle: Duration,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    launch(command, None, Limit::Idle(idle), heard)
}

fn launch(
    mut command: Command,
    input: Option<Vec<u8>>,
    limit: Limit,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, family) = family::spawn(&mut command)?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (once, kept) = match input {
        Some(bytes) => (stdin.map(|stdin| (stdin, bytes)), None),
        None => (None, stdin),
    };
    let shared = Arc::new(Shared {
        child: Mutex::new(Some(child)),
        family,
        stopped: AtomicBool::new(false),
        timed_out: AtomicBool::new(false),
        input: Mutex::new(kept),
        born: Instant::now(),
        last: AtomicU64::new(0),
    });

    // The question, and then the end of it: a program reading stdin to its end waits
    // for this close.
    if let Some((mut stdin, input)) = once {
        thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }

    let err = stderr.map(|stderr| thread::spawn(move || tail(stderr)));

    let (done, waiting) = mpsc::channel::<()>();
    let watched = Arc::clone(&shared);
    thread::spawn(move || watch(&watched, &waiting, limit));

    let reading = Arc::clone(&shared);
    thread::spawn(move || {
        if let Some(stdout) = stdout {
            lines(stdout, &|one| {
                reading.touch();
                heard(one);
            });
        }
        reading.input().take();
        let code = reap(&reading);
        let _ = done.send(());
        let err = err.and_then(|one| one.join().ok()).unwrap_or_default();
        heard(Heard::End(Ended {
            code,
            timed_out: reading.timed_out.load(Ordering::SeqCst),
            stopped: reading.stopped.load(Ordering::SeqCst),
            err,
        }));
    });

    Ok(Running(shared))
}

/// What a short run printed, all of it: for the questions asked of a program rather
/// than of a model, whether it is signed in and what flags it has.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Said {
    /// Its stdout, line by line.
    pub out: String,
    /// How it ended, with its stderr.
    #[serde(flatten)]
    pub ended: Ended,
}

/// Runs `command` to its end, or to `timeout`, with nothing on its stdin.
pub fn run_to_end(command: Command, timeout: Duration) -> io::Result<Said> {
    let (sent, heard) = mpsc::channel();
    start(command, Vec::new(), timeout, move |one| {
        let _ = sent.send(one);
    })?;

    let mut out = Vec::new();
    for one in heard {
        match one {
            Heard::Line(line) => out.push(line),
            Heard::End(ended) => {
                return Ok(Said {
                    out: out.join("\n"),
                    ended,
                })
            }
        }
    }
    Err(io::Error::other("the run ended without saying so"))
}

/// Ends a run at its limit, unless `waiting` hears that it ended first.
fn watch(shared: &Shared, waiting: &Receiver<()>, limit: Limit) {
    match limit {
        Limit::Total(timeout) => {
            if waiting.recv_timeout(timeout) != Err(RecvTimeoutError::Timeout) {
                return;
            }
        }
        Limit::Idle(idle) => {
            let tick = idle.min(Duration::from_secs(1));
            loop {
                if waiting.recv_timeout(tick) != Err(RecvTimeoutError::Timeout) {
                    return;
                }
                if shared.quiet_for() >= idle {
                    break;
                }
            }
        }
    }
    shared.timed_out.store(true, Ordering::SeqCst);
    shared.end();
}

/// Every line of `out`, as it arrives.
fn lines(out: impl Read, heard: &impl Fn(Heard)) {
    let mut reader = BufReader::new(out);
    let mut line = Vec::new();

    loop {
        line.clear();
        match (&mut reader)
            .take(LONGEST_LINE)
            .read_until(b'\n', &mut line)
        {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if !line.ends_with(b"\n") && line.len() as u64 == LONGEST_LINE {
            skip_line(&mut reader);
            continue;
        }

        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end_matches(['\r', '\n']);
        if !text.is_empty() {
            heard(Heard::Line(text.to_owned()));
        }
    }
}

/// Reads past the rest of a line too long to keep.
fn skip_line(reader: &mut impl BufRead) {
    loop {
        let Ok(buffer) = reader.fill_buf() else {
            return;
        };
        if buffer.is_empty() {
            return;
        }
        if let Some(at) = buffer.iter().position(|&byte| byte == b'\n') {
            reader.consume(at + 1);
            return;
        }
        let all = buffer.len();
        reader.consume(all);
    }
}

/// The last `ERR_TAIL` bytes of `err`.
fn tail(mut err: impl Read) -> String {
    let mut kept = Vec::new();
    let mut chunk = [0_u8; 8192];
    while let Ok(read) = err.read(&mut chunk) {
        if read == 0 {
            break;
        }
        kept.extend_from_slice(&chunk[..read]);
        if kept.len() > 2 * ERR_TAIL {
            kept.drain(..kept.len() - ERR_TAIL);
        }
    }
    let from = kept.len().saturating_sub(ERR_TAIL);
    String::from_utf8_lossy(&kept[from..]).into_owned()
}

/// Waits for the head of the family, under the same lock `end` asks under, so the
/// family is never named by a number that may already be somebody else's.
fn reap(shared: &Shared) -> Option<i32> {
    loop {
        {
            let mut held = shared.child();
            let child = held.as_mut()?;
            match child.try_wait() {
                Ok(Some(status)) => {
                    *held = None;
                    return status.code();
                }
                Ok(None) => {}
                Err(_) => {
                    *held = None;
                    return None;
                }
            }
        }
        thread::sleep(Duration::from_millis(15));
    }
}
