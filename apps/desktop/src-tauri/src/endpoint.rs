//! The socket the `nib` command drives the running app through.
//!
//! What it is: a listener on 127.0.0.1, on a port the system hands out at every
//! launch, behind a secret this installation keeps in the app's own config
//! folder. A request is one POST carrying a verb; the answer is what the window
//! said about it.
//!
//! Why it is shaped that way. The window is where the verbs actually live - it
//! holds the spaces, the link index, the search and the command registry the
//! palette reads - so this module does not know what a verb means and never
//! answers one itself. It reads the request, decides whether the caller is
//! allowed to ask at all, hands it to the window and waits. A second road to any
//! of those things would be a second answer to the same question; see
//! apps/desktop/src/lib/automation.
//!
//! Who is allowed to ask. Anybody who can read a file that only this user can
//! read, which is the same bar as "can open the notes". Four things are checked
//! before the secret is even looked at, and all four are about a page in a
//! browser rather than about a program: a page cannot read the file, cannot send
//! the two headers this requires to another origin without a preflight nothing
//! here answers, and cannot put this endpoint's own address in the host header
//! while pointing a name of its own at 127.0.0.1.
//!
//! Desktop only. A browser tab has no socket to listen on and a phone has no
//! command line, so neither build compiles this and the CLI says so rather than
//! failing to connect; see docs/automation.md.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::paths::{cannot, config_dir, made};

/// What the window hears a request on.
const ASKED: &str = "nib://automation";

/// The window that answers. A second window is a second view of the same notes,
/// so the one the CLI drives is the one the app started with.
const WINDOW: &str = "main";

/// How much of a request is read. A note is the longest thing anybody sends, and
/// this is the same ceiling a note has everywhere else.
const MOST_BYTES: usize = 8 * 1024 * 1024;

/// How long the window has to answer. Long enough to search a large space, short
/// enough that a wedged window frees the socket rather than holding it forever.
const PATIENCE: Duration = Duration::from_secs(30);

/// How long a caller has to finish sending, and to read what comes back. Without
/// it a connection that opened and said nothing would hold a thread for good.
const SLOWEST: Duration = Duration::from_secs(10);

/// The secret's length in bytes. Written down as hex, so twice that in
/// characters.
const SECRET_BYTES: usize = 32;

/// Which request an answer belongs to. Counted rather than random: it never
/// leaves this machine and two requests only have to tell each other apart.
static NEXT: AtomicU64 = AtomicU64::new(1);

/// What the file in the config folder says, which is everything a caller needs to
/// reach the app and nothing else.
#[derive(serde::Serialize, serde::Deserialize)]
struct Kept {
    /// The port this launch is listening on. New every launch, which is the
    /// reason the file is written again every launch rather than once.
    port: u16,
    /// This installation's secret, kept across launches: a caller that has it has
    /// read a file only this user can read.
    secret: String,
    /// Whether `eval` is answered at all.
    ///
    /// Off unless somebody wrote `true` here by hand, and there is deliberately
    /// no way to turn it on from outside this machine - not through a request,
    /// not through a link. It runs whatever it is sent inside the window, so
    /// turning it on should cost opening the file the secret is in.
    #[serde(default)]
    eval: bool,
    /// Which process is listening on that port.
    ///
    /// For `nib screenshot`, which has to photograph the window of the app that
    /// answered it. Two nibs can be running - a build somebody is working on beside
    /// the one they use - and a capture that went looking for a process by name
    /// photographed whichever of them Windows happened to list first.
    ///
    /// Right by construction rather than by being asked for: whoever wrote this file
    /// is whoever opened that socket, so the port and the process below it are one
    /// fact written at one moment. Never read back - the file is rewritten every
    /// launch, and a pid from a launch that has ended names nothing or names somebody
    /// else's process.
    #[serde(default)]
    pid: u32,
}

/// The requests the window has not answered yet, by the id each was given.
#[derive(Default)]
pub struct Waiting(Mutex<HashMap<u64, SyncSender<String>>>);

/// Opens the socket and starts answering on it.
///
/// Says nothing where it cannot: an app whose endpoint did not come up is an app
/// without a command line, not an app that failed to start, and the one thing
/// worse than no CLI would be no editor.
pub fn start(app: &AppHandle) {
    // Port zero, so the system names it. A port written down here would be a port
    // something else on the machine could be sitting on, and a fixed one is also
    // a port anything could guess at.
    let Ok(listener) = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))) else {
        return;
    };
    let Ok(address) = listener.local_addr() else {
        return;
    };

    let app = app.clone();
    let port = address.port();
    std::thread::spawn(move || {
        // The file the port and the secret are written down in, written on this
        // thread rather than before it. It is a read, a folder made and a write,
        // and `start` is called from the setup hook - the thread the window is
        // about to be shown on, where the disk is the one thing that can hold a
        // launch up. The socket is already listening by the time this runs, so a
        // request that arrives in the same moment waits in the backlog instead of
        // finding nothing there.
        let Ok(kept) = remember(&app, port) else {
            return;
        };

        for incoming in listener.incoming() {
            let Ok(stream) = incoming else { continue };

            let app = app.clone();
            let secret = kept.secret.clone();
            let port = kept.port;
            let eval = kept.eval;
            // A thread each, so a caller that stopped reading halfway cannot keep
            // the next one waiting.
            std::thread::spawn(move || {
                let _ = answer(&app, stream, &secret, port, eval);
            });
        }
    });
}

/// The window's answer to one request, handed back to whoever asked.
///
/// Passed through exactly as the window said it: the verbs and the shape of what
/// each answers belong to the dispatcher in the window, and an opinion about them
/// here would be a second dispatcher.
#[tauri::command]
pub fn automation_result(waiting: tauri::State<'_, Waiting>, id: u64, result: serde_json::Value) {
    let Ok(mut held) = waiting.0.lock() else {
        return;
    };

    if let Some(send) = held.remove(&id) {
        // The caller may have given up and gone. A channel nobody is listening
        // to is nothing to report.
        let _ = send.try_send(result.to_string());
    }
}

/// The file, read for what it already holds and written again with this launch's
/// port. Answers what is now in it.
fn remember(app: &AppHandle, port: u16) -> Result<Kept, String> {
    let path = endpoint_file(app)?;
    let held: Option<Kept> = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());

    let kept = Kept {
        port,
        // A secret of the wrong length is one somebody edited or a file that was
        // written half way, and either way it is not a secret any more.
        secret: match held.as_ref() {
            Some(one) if one.secret.len() == SECRET_BYTES * 2 => one.secret.clone(),
            _ => fresh_secret()?,
        },
        eval: held.is_some_and(|one| one.eval),
        pid: std::process::id(),
    };

    let written = serde_json::to_string_pretty(&kept)
        .map_err(|error| format!("could not write the endpoint file: {error}"))?;
    fs::write(&path, written).map_err(|error| cannot("write", &path, &error))?;
    only_the_owner(&path);

    Ok(kept)
}

/// Where the file lives: the app's own settings folder, which exists by the time
/// this returns.
fn endpoint_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;

    made(&dir)?;
    Ok(dir.join("automation.json"))
}

/// A secret nobody can guess, from the system's own randomness.
fn fresh_secret() -> Result<String, String> {
    let mut bytes = [0_u8; SECRET_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("no randomness to make a secret from: {error}"))?;

    Ok(as_hex(&bytes))
}

/// Bytes as hex, two characters each, which is what makes the length known.
fn as_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        // Into a string that cannot fail to be written to.
        let _ = write!(out, "{byte:02x}");
    }

    out
}

/// Readable by this user and nobody else, where the platform says so in a mode.
/// On Windows the config folder is already the user's own and there is no mode to
/// set.
#[cfg(unix)]
fn only_the_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt as _;

    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn only_the_owner(_path: &Path) {}

/// One request, from the first byte to the last.
///
/// Every refusal is a status and a sentence. A caller that is told nothing cannot
/// tell a wrong secret from an app that is not running, and the first thing
/// anybody does with a new command is get the secret wrong.
fn answer(
    app: &AppHandle,
    mut stream: TcpStream,
    secret: &str,
    port: u16,
    eval: bool,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(SLOWEST))?;
    stream.set_write_timeout(Some(SLOWEST))?;

    let Some(request) = read_request(&mut stream)? else {
        return say(
            &mut stream,
            400,
            &refused("that is not a request this endpoint reads"),
        );
    };

    if request.method != "POST" {
        return say(&mut stream, 405, &refused("this endpoint reads a POST"));
    }
    if request.header("origin").is_some() {
        return say(
            &mut stream,
            403,
            &refused("a page in a browser is not a caller here"),
        );
    }
    if !is_json(request.header("content-type")) {
        return say(&mut stream, 415, &refused("send JSON"));
    }
    if !is_local(request.header("host"), port) {
        return say(
            &mut stream,
            400,
            &refused("that is not this endpoint's address"),
        );
    }
    if !same_secret(request.header("authorization"), secret) {
        return say(
            &mut stream,
            401,
            &refused("that is not this installation's secret"),
        );
    }

    let Ok(mut asked) = serde_json::from_str::<serde_json::Value>(&request.body) else {
        return say(&mut stream, 400, &refused("that body is not JSON"));
    };
    // Owned, because the value is written into a moment later and a borrow of it
    // would still be alive.
    let verb = asked
        .get("verb")
        .and_then(|one| one.as_str())
        .map(str::to_owned);
    let Some(verb) = verb else {
        return say(&mut stream, 400, &refused("say which verb"));
    };

    if verb == "eval" && !eval {
        return say(
            &mut stream,
            403,
            &refused("eval is off: set \"eval\": true in the endpoint file to turn it on"),
        );
    }

    match ask_the_window(app, &mut asked) {
        Ok(answered) => say(&mut stream, 200, &answered),
        Err(reason) => say(&mut stream, 503, &refused(&reason)),
    }
}

/// Hands the request to the window and waits for its answer.
fn ask_the_window(app: &AppHandle, asked: &mut serde_json::Value) -> Result<String, String> {
    // The window, not the webview window: a window with a page in a tab is not one
    // of those, and every request would be refused for as long as a website was
    // open. See web_tabs.rs.
    if app.get_window(WINDOW).is_none() {
        return Err("the app has no window open to ask".to_owned());
    }

    let Some(body) = asked.as_object_mut() else {
        return Err("that body is not an object".to_owned());
    };

    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    body.insert("id".to_owned(), serde_json::Value::from(id));

    let (send, answered) = sync_channel::<String>(1);
    let waiting = app.state::<Waiting>();

    {
        let Ok(mut held) = waiting.0.lock() else {
            return Err("the app cannot take a request just now".to_owned());
        };
        held.insert(id, send);
    }

    let outcome = app
        .emit_to(WINDOW, ASKED, &*asked)
        .map_err(|error| format!("the window could not be asked: {error}"))
        .and_then(|()| {
            answered
                .recv_timeout(PATIENCE)
                .map_err(|_| "the window did not answer".to_owned())
        });

    // However that went, nothing is left waiting: an entry per request that timed
    // out would be a map that only grows.
    if let Ok(mut held) = waiting.0.lock() {
        held.remove(&id);
    }

    outcome
}

/// One answer, written and done with. The connection closes, which is what a
/// caller that sent one request and is waiting for one answer expects.
fn say(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        reason(status),
        body.len()
    );

    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

/// The word beside the number, for the statuses this endpoint answers with.
fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        415 => "Unsupported Media Type",
        _ => "Service Unavailable",
    }
}

/// A refusal the caller can print. JSON, because everything else here is, so one
/// shape is read whether the answer is an answer or a no.
fn refused(why: &str) -> String {
    serde_json::json!({ "error": why }).to_string()
}

/// A request, as far as this endpoint reads one.
struct Request {
    method: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Request {
    /// One header, by its folded name.
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(held, _)| held == name)
            .map(|(_, value)| value.as_str())
    }
}

/// A request as far as this endpoint reads one: the method, the headers, and a
/// body as long as `content-length` says. None for anything that is not shaped
/// like a request at all, which is the shape a port scanner arrives in.
fn read_request(stream: &mut impl Read) -> std::io::Result<Option<Request>> {
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = [0_u8; 8192];

    // Where the next look for the end of the head starts. Three bytes back from
    // what has been read, because a blank line can straddle two chunks and cannot
    // straddle more than that: looking over the whole of what has arrived per chunk
    // reads a head in the square of its length, which for the eight megabytes
    // allowed here is minutes of a thread for one caller that sends no blank line.
    let mut scanned = 0;

    let ends = loop {
        if let Some(at) = find(&bytes[scanned..], b"\r\n\r\n") {
            break scanned + at;
        }
        scanned = bytes.len().saturating_sub(3);

        if bytes.len() > MOST_BYTES {
            return Ok(None);
        }

        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..read]);
    };

    let Ok(head) = std::str::from_utf8(&bytes[..ends]) else {
        return Ok(None);
    };
    let Some((method, headers)) = parse_head(head) else {
        return Ok(None);
    };

    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if length > MOST_BYTES {
        return Ok(None);
    }

    let mut body = bytes[ends + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    let Ok(body) = String::from_utf8(body) else {
        return Ok(None);
    };

    Ok(Some(Request {
        method,
        headers,
        body,
    }))
}

/// Where `needle` starts in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|one| one == needle)
}

/// The method and the headers, with every header name folded to lowercase. None
/// for a first line that is not a request line, which is not a request.
fn parse_head(head: &str) -> Option<(String, Vec<(String, String)>)> {
    let mut lines = head.split("\r\n");
    let mut words = lines.next()?.split(' ');

    let method = words.next()?.to_owned();
    if method.is_empty() {
        return None;
    }
    // The target and the version have to be there and have nothing to say: one
    // socket, one caller, and the verb is in the body.
    words.next()?;
    words.next()?;

    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_owned()))
        .collect();

    Some((method, headers))
}

/// Whether the caller said it is sending JSON.
///
/// Required, and not out of pedantry: a form, plain text and multipart are what a
/// page in a browser may send to another origin without being allowed to first.
/// JSON is not one of them.
fn is_json(said: Option<&str>) -> bool {
    said.is_some_and(|one| one.trim().to_lowercase().starts_with("application/json"))
}

/// Whether the request was addressed to this endpoint rather than to a name that
/// happens to resolve here. A page served from a domain whose record points at
/// 127.0.0.1 arrives with that domain in the host header.
fn is_local(said: Option<&str>, port: u16) -> bool {
    let Some(host) = said else { return false };

    ["127.0.0.1", "localhost", "[::1]"]
        .iter()
        .any(|name| host == format!("{name}:{port}"))
}

/// Whether the bearer token is this installation's secret, compared in a way that
/// takes the same time however wrong it is. The length is public - it is always
/// the same - so comparing that first gives nothing away.
fn same_secret(said: Option<&str>, secret: &str) -> bool {
    let Some(header) = said else { return false };
    let Some(token) = header
        .strip_prefix("Bearer ")
        .or_else(|| header.strip_prefix("bearer "))
    else {
        return false;
    };

    if token.len() != secret.len() {
        return false;
    }

    let mut differences = 0_u8;
    for (one, other) in token.bytes().zip(secret.bytes()) {
        differences |= one ^ other;
    }

    differences == 0
}

#[cfg(test)]
mod tests {
    use super::{
        as_hex, find, is_json, is_local, parse_head, read_request, reason, refused, same_secret,
        Kept, Request, MOST_BYTES, SECRET_BYTES,
    };

    /// What the file says about who is answering on that port.
    ///
    /// `nib screenshot` photographs the window of the app that answered it, and the only
    /// thing that can say which process that is, is the process that opened the socket.
    /// So the pid is written beside the port, as this process's own.
    #[test]
    fn says_which_process_is_listening() {
        let text = serde_json::to_string(&Kept {
            port: 1234,
            secret: "a".repeat(SECRET_BYTES * 2),
            eval: false,
            pid: std::process::id(),
        })
        .expect("a kept endpoint is serialisable");

        let read: Kept = serde_json::from_str(&text).expect("and readable again");
        assert_eq!(read.pid, std::process::id());
        assert_eq!(read.port, 1234);
    }

    /// A file written before this version knew about the pid still reads, and says
    /// nothing about a process rather than refusing to be read at all.
    #[test]
    fn reads_a_file_written_without_one() {
        let read: Kept = serde_json::from_str(r#"{"port":9,"secret":"ab"}"#).expect("a Kept");

        assert_eq!(read.pid, 0);
        assert!(!read.eval);
    }

    #[test]
    fn reads_a_request_line_and_folds_the_header_names() {
        let (method, headers) =
            parse_head("POST / HTTP/1.1\r\nContent-Type: application/json\r\nHost: 127.0.0.1:9")
                .expect("a request");

        assert_eq!(method, "POST");
        assert_eq!(
            headers,
            vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("host".to_string(), "127.0.0.1:9".to_string()),
            ]
        );
    }

    #[test]
    fn refuses_anything_that_is_not_a_request_line() {
        assert!(parse_head("hello").is_none());
        assert!(parse_head("POST /").is_none());
        assert!(parse_head(" / HTTP/1.1").is_none());
    }

    #[test]
    fn finds_where_the_head_ends() {
        assert_eq!(find(b"ab\r\n\r\ncd", b"\r\n\r\n"), Some(2));
        assert_eq!(find(b"ab", b"\r\n\r\n"), None);
    }

    /// One request off the wire. Read through `Read` rather than off a socket,
    /// because what is being checked is what this makes of the bytes: the caller is
    /// whatever found the port, and most of what finds a port is not the `nib`
    /// command.
    fn read(said: &[u8]) -> Option<Request> {
        read_request(&mut std::io::Cursor::new(said.to_vec())).expect("a cursor cannot fail")
    }

    #[test]
    fn reads_a_whole_request_off_the_wire() {
        let request = read(b"POST / HTTP/1.1\r\ncontent-type: application/json\r\ncontent-length: 16\r\n\r\n{\"verb\":\"open\"}\n")
            .expect("a request");

        assert_eq!(request.method, "POST");
        assert_eq!(request.header("content-type"), Some("application/json"));
        assert_eq!(request.body, "{\"verb\":\"open\"}\n");
    }

    /// What a port scanner sends: a line, or nothing, and then the connection goes.
    /// None rather than a wait or a panic - and the socket's own read timeout is the
    /// other half of that; see `SLOWEST`.
    #[test]
    fn anything_that_is_not_a_request_is_no_request() {
        assert!(read(b"").is_none());
        assert!(read(b"GET /\r\n").is_none());
        assert!(read(b"\x16\x03\x01\x02\x00\x01\x00").is_none());
    }

    /// A caller that opens with eight megabytes and no blank line in them. It is
    /// refused for being longer than a request may be - and it is refused in a
    /// moment, which is the half worth measuring: the head is read in chunks, and
    /// looking over all of what has arrived per chunk costs the square of its
    /// length. That was a minute and a half of a thread for one caller, and any
    /// program on this machine can be that caller before the secret is even looked
    /// at.
    #[test]
    fn a_head_that_never_ends_is_refused_without_being_read_twice() {
        let started = std::time::Instant::now();

        assert!(read(&vec![b'a'; MOST_BYTES + 1]).is_none());

        let spent = started.elapsed();
        assert!(spent.as_secs() < 5, "{spent:?} for a head of 8 MB");
    }

    #[test]
    fn a_body_longer_than_a_note_is_not_read_at_all() {
        let said = format!(
            "POST / HTTP/1.1\r\ncontent-length: {}\r\n\r\n",
            MOST_BYTES + 1
        );

        assert!(read(said.as_bytes()).is_none());
    }

    /// A caller that promised more than it sent. What arrived is what is read: the
    /// verb is then not JSON and the request is refused by the reader above, which
    /// is the same answer as for any other nonsense.
    #[test]
    fn a_body_shorter_than_it_said_is_what_arrived() {
        let request =
            read(b"POST / HTTP/1.1\r\ncontent-length: 99\r\n\r\n{\"verb\"").expect("a request");

        assert_eq!(request.body, "{\"verb\"");
    }

    /// And one that sent more than it promised: the rest is not part of this
    /// request, so a second request smuggled behind the first is not read either.
    #[test]
    fn a_body_longer_than_it_said_is_cut_where_it_said() {
        let request = read(b"POST / HTTP/1.1\r\ncontent-length: 2\r\n\r\n{}POST /").expect("one");

        assert_eq!(request.body, "{}");
    }

    #[test]
    fn a_body_that_is_not_text_is_no_request() {
        assert!(read(b"POST / HTTP/1.1\r\ncontent-length: 2\r\n\r\n\xff\xfe").is_none());
    }

    #[test]
    fn only_json_is_a_body_it_reads() {
        assert!(is_json(Some("application/json")));
        assert!(is_json(Some("Application/JSON; charset=utf-8")));
        // The three a page may send to another origin unasked.
        assert!(!is_json(Some("text/plain")));
        assert!(!is_json(Some("application/x-www-form-urlencoded")));
        assert!(!is_json(Some("multipart/form-data")));
        assert!(!is_json(None));
    }

    #[test]
    fn only_this_endpoints_own_address_is_its_address() {
        assert!(is_local(Some("127.0.0.1:1500"), 1500));
        assert!(is_local(Some("localhost:1500"), 1500));
        assert!(!is_local(Some("notes.example.com:1500"), 1500));
        assert!(!is_local(Some("127.0.0.1:1501"), 1500));
        assert!(!is_local(None, 1500));
    }

    #[test]
    fn only_the_secret_itself_gets_in() {
        let secret = as_hex(&[7_u8; SECRET_BYTES]);

        assert!(same_secret(Some(&format!("Bearer {secret}")), &secret));
        assert!(same_secret(Some(&format!("bearer {secret}")), &secret));
        assert!(!same_secret(Some(&secret), &secret));
        assert!(!same_secret(Some("Bearer "), &secret));
        assert!(!same_secret(Some(&format!("Bearer {secret}x")), &secret));
        assert!(!same_secret(None, &secret));

        let wrong = as_hex(&[8_u8; SECRET_BYTES]);
        assert!(!same_secret(Some(&format!("Bearer {wrong}")), &secret));
    }

    #[test]
    fn a_secret_is_two_characters_a_byte() {
        assert_eq!(as_hex(&[0_u8, 15, 16, 255]), "000f10ff");
        assert_eq!(as_hex(&[0_u8; SECRET_BYTES]).len(), SECRET_BYTES * 2);
    }

    #[test]
    fn every_status_it_answers_with_has_a_word() {
        for status in [200_u16, 400, 401, 403, 405, 415, 503] {
            assert!(!reason(status).is_empty());
        }
        assert_eq!(reason(200), "OK");
    }

    #[test]
    fn a_refusal_is_json_with_the_reason_in_it() {
        assert_eq!(refused("no"), r#"{"error":"no"}"#);
        // A quote in the reason cannot break the shape.
        assert_eq!(refused(r#"say "yes""#), r#"{"error":"say \"yes\""}"#);
    }
}
