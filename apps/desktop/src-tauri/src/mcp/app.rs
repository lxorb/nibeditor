//! The running app, as `nib mcp` reaches it: the endpoint file it writes at every launch,
//! one request to that endpoint, and starting the app when it is not running.
//!
//! **The file is read, never trusted to be current.** The app writes its port, its pid
//! and the installation's secret into `automation.json` as it starts and leaves the file
//! behind when it ends, so a port in it may be a port nobody listens on any more, or one
//! something else has taken since. Before the secret or a token is sent to a port, the
//! port is asked once with neither, and only nib's own refusal - a 401 with a sentence in
//! JSON - counts as nib. See endpoint.rs for the other side.
//!
//! **Started minimised, and without the keyboard.** A client that runs `nib mcp` while nib
//! is closed gets nib, the way the design says (docs/agent-native.md 10), and the reader
//! gets nothing in their face: on Windows through `start /min`, which is the first window
//! a process shows taking `SW_SHOWMINNOACTIVE` from its start-up info; on a Mac through
//! `open -g -j`, in the background and hidden. The app is handed nothing of this process's
//! stdio, which is the client's protocol, not even by inheritance.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;

/// How long a connection to the loopback may take before the app counts as not there.
const CONNECT: Duration = Duration::from_secs(2);

/// How long a started app has to open its endpoint. A cold launch of `WebView2` on a slow
/// machine is a few seconds; the endpoint comes up before the window does.
const STARTING: Duration = Duration::from_secs(30);

/// What the endpoint file says.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Endpoint {
    /// The port of this launch.
    pub port: u16,
    /// The installation's secret: the reader's own command line, and pairing.
    pub secret: String,
    /// The process that wrote it.
    #[serde(default)]
    pub pid: u32,
}

/// The endpoint file in the settings folder, read; `None` when there is none or it
/// cannot be read.
pub fn endpoint(dir: &Path) -> Option<Endpoint> {
    let text = std::fs::read_to_string(dir.join("automation.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// One answer from the endpoint: its status and its body, read as JSON where it is.
#[derive(Debug)]
pub struct Said {
    /// The HTTP status.
    pub status: u16,
    /// The body; a string when it was not JSON.
    pub body: Value,
}

/// One verb posted to the endpoint, with `bearer` as its credential, waiting at most
/// `patience` for the answer. An error is the endpoint not being there at all.
pub fn post(
    endpoint: &Endpoint,
    bearer: Option<&str>,
    body: &Value,
    patience: Duration,
) -> std::io::Result<Said> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, endpoint.port));
    let mut stream = TcpStream::connect_timeout(&address, CONNECT)?;
    stream.set_read_timeout(Some(patience))?;
    stream.set_write_timeout(Some(CONNECT))?;

    let body = body.to_string();
    let credential = bearer
        .map(|token| format!("authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    let head = format!(
        "POST / HTTP/1.1\r\nhost: 127.0.0.1:{}\r\ncontent-type: application/json\r\n{credential}content-length: {}\r\nconnection: close\r\n\r\n",
        endpoint.port,
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()?;

    // The endpoint answers once and closes, so the answer is everything until then.
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    parse(&bytes)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "not an HTTP answer"))
}

/// An HTTP answer: the status off the first line, the body after the blank line.
fn parse(bytes: &[u8]) -> Option<Said> {
    let text = String::from_utf8_lossy(bytes);
    let (head, body) = text.split_once("\r\n\r\n")?;
    let status = head
        .lines()
        .next()?
        .split(' ')
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let body = serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_owned()));
    Some(Said { status, body })
}

/// Whether nib answers on the file's port: asked with no credential at all, which nib
/// refuses in its own words. Anything else listening there is not told a secret.
pub fn answers(endpoint: &Endpoint) -> bool {
    let asked = serde_json::json!({ "verb": "agent_status" });
    post(endpoint, None, &asked, CONNECT).is_ok_and(|said| {
        said.status == 401 && said.body.get("error").is_some_and(Value::is_string)
    })
}

/// The app's endpoint, when an app is answering on it.
pub fn running(dir: &Path) -> Option<Endpoint> {
    endpoint(dir).filter(answers)
}

/// Starts the app, minimised and without the keyboard, and waits for its endpoint.
pub fn start(dir: &Path) -> Result<Endpoint, String> {
    let before = endpoint(dir);
    launch()?;

    let started = Instant::now();
    while started.elapsed() < STARTING {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(now) = endpoint(dir) {
            // A file left by a launch that has ended names that launch's port; a new
            // launch writes its own.
            if Some(&now) != before.as_ref() && answers(&now) {
                return Ok(now);
            }
        }
    }
    Err("nib did not start in 30 seconds".to_owned())
}

/// The app, started. On Windows through `cmd /c start /min`, run with no console of its
/// own: `start` gives the app its minimised, unfocused first window. None of the client's
/// pipes goes with it; see `keep_the_pipes`.
#[cfg(windows)]
fn launch() -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;

    /// `CREATE_NO_WINDOW`: cmd runs without a console window of its own.
    const NO_WINDOW: u32 = 0x0800_0000;

    keep_the_pipes();
    let program = super::program::program()?;
    let shell = std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into());
    let mut command = Command::new(shell);
    command
        .raw_arg(format!("/d /c start \"\" /min \"{}\"", program.display()))
        .creation_flags(NO_WINDOW);
    if let Some(folder) = program.parent() {
        command.current_dir(folder);
    }
    quiet(&mut command)
        .status()
        .map_err(|error| format!("nib could not be started: {error}"))
        .map(drop)
}

/// This process's stdin, stdout and stderr kept to itself. They are the client's pipes,
/// handed over inheritable, and `start` passes every inheritable handle on to the program
/// it starts - measured: a pipe cmd was given stayed open until the started program
/// ended. The app would then hold the client's stdout for as long as nib runs, and a
/// client waiting for this server's output to end would wait for nib to quit. The app
/// asks the same before it starts Claude Code or Codex; see `ai_cli/family.rs`.
#[allow(
    unsafe_code,
    reason = "whether a handle is inherited is Win32's own flag, with no safe wrapper"
)]
#[cfg(windows)]
pub(crate) fn keep_the_pipes() {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::{
        SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
    };

    let handles = [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ];
    for raw in handles.into_iter().filter(|one| !one.is_null()) {
        // SAFETY: each is one of this process's own standard handles, open for as long as
        // it runs; only whether a child inherits it changes.
        let _ =
            unsafe { SetHandleInformation(HANDLE(raw), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) };
    }
}

/// The app, started. On a Mac through `open`, in the background (`-g`) and hidden
/// (`-j`); outside a bundle, a development build, as itself.
#[cfg(target_os = "macos")]
fn launch() -> Result<(), String> {
    let program = super::program::program()?;
    let bundle = program
        .ancestors()
        .find(|one| one.extension().is_some_and(|ext| ext == "app"));
    match bundle {
        Some(bundle) => quiet(Command::new("open").args(["-g", "-j"]).arg(bundle))
            .status()
            .map(drop)
            .map_err(|error| format!("nib could not be started: {error}")),
        None => detached(&program),
    }
}

/// The app, started, in a process group of its own. Linux has no minimised start a
/// program can ask for without the window system's own calls, so the window opens as it
/// always does.
#[cfg(all(unix, not(target_os = "macos")))]
fn launch() -> Result<(), String> {
    detached(&super::program::program()?)
}

/// A program started with nothing of this process's stdio and outside its process group,
/// so the client's Ctrl+C is not the app's; waited for on a thread of its own so it
/// leaves nothing behind when it ends first.
#[cfg(unix)]
fn detached(program: &Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt as _;

    let mut child = quiet(Command::new(program).process_group(0))
        .spawn()
        .map_err(|error| format!("nib could not be started: {error}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// No stdio of this process's: its stdout is the protocol.
fn quiet(command: &mut Command) -> &mut Command {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn an_answer_is_its_status_and_its_json() {
        let said = parse(b"HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n\r\n{\"error\":\"no\"}")
            .expect("an answer");
        assert_eq!(said.status, 401);
        assert_eq!(said.body["error"], "no");
        let said = parse(b"HTTP/1.1 200 OK\r\n\r\nnot json").expect("an answer");
        assert_eq!(said.body, Value::String("not json".into()));
        assert!(parse(b"garbage").is_none());
    }

    #[test]
    fn the_file_reads_as_the_app_writes_it() {
        let dir = tempfile::tempdir().expect("a folder");
        assert_eq!(endpoint(dir.path()), None);
        std::fs::write(
            dir.path().join("automation.json"),
            r#"{"port":4321,"secret":"ab","eval":false,"pid":77}"#,
        )
        .expect("written");
        assert_eq!(
            endpoint(dir.path()),
            Some(Endpoint {
                port: 4321,
                secret: "ab".into(),
                pid: 77
            })
        );
    }

    /// Something else on the port is not nib, and is never sent a credential: the
    /// question that decides it carries none.
    #[test]
    fn a_stranger_on_the_port_is_not_nib() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("its address").port();
        let heard = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a caller");
            let mut request = vec![0_u8; 4096];
            let read = stream.read(&mut request).expect("a request");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi")
                .expect("an answer");
            String::from_utf8_lossy(&request[..read]).to_lowercase()
        });
        let stranger = Endpoint {
            port,
            secret: "s3cret".into(),
            pid: 0,
        };
        assert!(!answers(&stranger));
        let request = heard.join().expect("the stranger");
        assert!(!request.contains("authorization"), "{request}");
        assert!(!request.contains("s3cret"));
    }

    #[test]
    fn nobody_on_the_port_is_not_nib() {
        let port = TcpListener::bind("127.0.0.1:0")
            .and_then(|one| one.local_addr())
            .expect("a port")
            .port();
        // The listener is gone: the port now answers nothing.
        assert!(!answers(&Endpoint {
            port,
            secret: String::new(),
            pid: 0
        }));
    }
}
