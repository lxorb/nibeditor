//! The connection to the running app, from finding it to the last call: the app found or
//! started, the client paired, its grant read, and all of it watched while the session
//! lasts.
//!
//! **Nothing here holds up the client.** `initialize` is answered at once and all of this
//! happens on a thread of its own: Codex gives a server ten seconds to start, and the reader
//! may be away from the bubble for an hour. The server waits for the link only as long as a
//! client would wait anyway (`seen`), and the tools a client was shown change when the link
//! does (`heard`, which sends `notifications/tools/list_changed`).
//!
//! **The pairing** (docs/agent-native.md 9.1): a client with a kept token proves it with
//! `agent_status`; one without asks through `agent_pair`, which raises the bubble, and waits
//! for it twenty seconds at a time, looking between the waits for a token a second run of
//! the same client may have been given meanwhile. A no is final for this run; so is a token
//! that stops working, which is the reader having removed the agent, and a client that asked
//! again at once would be arguing with them.
//!
//! **Watched, not polled.** Every two seconds the modified times of two files are read,
//! nothing more: `automation.json`, which a launch writes (the app started again, on another
//! port), and `agents.json`, which every change to a grant writes (a scope added, the agent
//! removed). Only a change costs a call.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use super::app::{self, Endpoint};
use super::pairing::{self, Client, Kept};
use super::results::Outcome;
use crate::agents::grants::Grant;

/// How long one pairing question is waited on inside one call, before looking again.
const PAIRING_WAIT: Duration = Duration::from_secs(20);

/// How often the two files are looked at.
const LOOK_EVERY: Duration = Duration::from_secs(2);

/// The longest a call waits for its answer: a browser wait is 120 s at most, and the
/// settling after it a few more.
const PATIENCE: Duration = Duration::from_secs(150);

/// How long the sidebar's own session waits for the reader to approve a call: with the
/// call made again after it (`PATIENCE`), inside the ten minutes each program gives a
/// tool (`src/ai_cli/args.rs`).
const APPROVAL_WAIT: Duration = Duration::from_secs(7 * 60);

/// How often a waiting call looks for the reader's answer.
const APPROVAL_LOOK: Duration = Duration::from_millis(400);

/// How long a window that is still loading has to say which verbs it answers before
/// the link settles without them; the watch asks again every two seconds after.
const WINDOW_WAIT: Duration = Duration::from_secs(5);

/// Where the link stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Standing {
    /// Finding the app, starting it, or reading the kept token.
    Connecting,
    /// The reader has been asked about this client and has not answered.
    Asked,
    /// The reader said no.
    Refused,
    /// The token stopped working: the reader removed this agent.
    Removed,
    /// No app to reach, and why.
    Unreachable(String),
    /// Paired: the token works.
    Paired,
}

/// What the server reads of the link at one moment.
#[derive(Clone, Debug)]
pub struct Seen {
    /// Where it stands.
    pub standing: Standing,
    /// The agent's grant, once paired.
    pub grant: Option<Grant>,
    /// The window's verbs, once it has said.
    pub window: Option<BTreeSet<String>>,
}

/// Why a token was not taken.
enum Refusal {
    /// nib does not know it.
    Unknown,
    /// nib did not answer.
    Unreachable(String),
}

#[derive(Default)]
struct Held {
    standing: Option<Standing>,
    endpoint: Option<Endpoint>,
    kept: Option<Kept>,
    grant: Option<Grant>,
    window: Option<BTreeSet<String>>,
}

/// The link, shared by the server's threads.
pub struct Link {
    dir: Option<PathBuf>,
    /// The client it is for.
    pub client: Client,
    held: Mutex<Held>,
    changed: Condvar,
    heard: Box<dyn Fn() + Send + Sync>,
}

impl Link {
    /// A link for a client, started on a thread of its own. `heard` is called whenever
    /// something the tool list is made from changed.
    pub fn open(client: Client, heard: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        let link = Arc::new(Link {
            dir: super::home::config_dir(),
            client,
            held: Mutex::new(Held::default()),
            changed: Condvar::new(),
            heard: Box::new(heard),
        });
        let running = Arc::clone(&link);
        std::thread::spawn(move || running.run());
        link
    }

    fn held(&self) -> MutexGuard<'_, Held> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Where it stands, and what it knows.
    fn seen_now(&self) -> Seen {
        let held = self.held();
        Seen {
            standing: held.standing.clone().unwrap_or(Standing::Connecting),
            grant: held.grant.clone(),
            window: held.window.clone(),
        }
    }

    /// What the link knows, once it is past connecting - and past the reader's answer to
    /// the pairing, when `through_asking` - or once `patience` has gone by.
    pub fn seen(&self, patience: Duration, through_asking: bool) -> Seen {
        let started = Instant::now();
        let mut held = self.held();
        while match held.standing {
            None | Some(Standing::Connecting) => true,
            Some(Standing::Asked) => through_asking,
            Some(_) => false,
        } {
            let Some(left) = patience.checked_sub(started.elapsed()) else {
                break;
            };
            held = self
                .changed
                .wait_timeout(held, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        drop(held);
        self.seen_now()
    }

    /// Changes what is held, and tells whoever waits and the server.
    fn change(&self, change: impl FnOnce(&mut Held)) {
        change(&mut self.held());
        self.changed.notify_all();
        (self.heard)();
    }

    fn settle(&self, standing: Standing) {
        self.change(|held| held.standing = Some(standing));
    }

    /// Settles where a pairing ended without one.
    fn ended(&self, standing: Standing) -> bool {
        self.settle(standing);
        false
    }

    /// The whole session's work: reach the app, then watch the two files.
    fn run(&self) {
        let Some(dir) = self.dir.clone() else {
            self.settle(Standing::Unreachable(
                "this machine does not say where nib keeps its settings".to_owned(),
            ));
            return;
        };
        match app::running(&dir).map_or_else(|| app::start(&dir), Ok) {
            Ok(endpoint) => self.reach(&dir, endpoint),
            Err(why) => self.settle(Standing::Unreachable(why)),
        }
        self.watch(&dir);
    }

    /// Pairs with the app on this endpoint, and asks its window which verbs it answers
    /// before settling, so the first list a client is given is already the whole one.
    fn reach(&self, dir: &Path, endpoint: Endpoint) {
        self.change(|held| {
            held.endpoint = Some(endpoint.clone());
            held.window = None;
        });
        if self.pair(dir, &endpoint) {
            self.ask_window(&endpoint, WINDOW_WAIT);
            self.settle(Standing::Paired);
        }
    }

    /// The kept token proved, or the reader asked until they answer. Answers whether the
    /// client is paired; every other end is settled here.
    fn pair(&self, dir: &Path, endpoint: &Endpoint) -> bool {
        if let Some(token) = handed() {
            return self.prove_handed(endpoint, token);
        }
        loop {
            if let Some(kept) = pairing::kept(dir, &self.client) {
                match grant_of(endpoint, &kept.token) {
                    Ok(grant) => {
                        self.change(|held| {
                            held.kept = Some(kept);
                            held.grant = Some(grant);
                        });
                        return true;
                    }
                    Err(Refusal::Unknown) => pairing::forget(dir, &self.client),
                    Err(Refusal::Unreachable(why)) => {
                        return self.ended(Standing::Unreachable(why));
                    }
                }
            }

            let asked = json!({
                "verb": "agent_pair",
                "args": {
                    "client": self.client.name,
                    "wait_ms": u64::try_from(PAIRING_WAIT.as_millis()).unwrap_or(u64::MAX),
                },
            });
            let said = match app::post(
                endpoint,
                Some(&endpoint.secret),
                &asked,
                PAIRING_WAIT + Duration::from_secs(30),
            ) {
                Ok(said) => Outcome::from_endpoint(said.status, &said.body),
                Err(_) => {
                    return self.ended(Standing::Unreachable("nib stopped answering".to_owned()))
                }
            };
            match said {
                Outcome::Done { result, .. } => {
                    let Ok(kept) = serde_json::from_value::<Kept>(json!({
                        "agent": result.get("agent"),
                        "token": result.get("token"),
                    })) else {
                        return self.ended(Standing::Unreachable(
                            "nib paired this client without a token".to_owned(),
                        ));
                    };
                    if let Err(why) = pairing::keep(dir, &self.client, &kept) {
                        return self.ended(Standing::Unreachable(why));
                    }
                    // Round again: the token is read back from the file and proved.
                }
                Outcome::Asked { .. } => {
                    if self.seen_now().standing != Standing::Asked {
                        self.settle(Standing::Asked);
                    }
                }
                Outcome::Failed { code, .. } if code == "denied" => {
                    return self.ended(Standing::Refused)
                }
                Outcome::Failed { message, .. } => {
                    return self.ended(Standing::Unreachable(message))
                }
            }
        }
    }

    /// A token the app handed this run (see `handed`), proved and never written down: a
    /// no is final, since nobody can be asked on the app's own agent's behalf.
    fn prove_handed(&self, endpoint: &Endpoint, token: String) -> bool {
        match grant_of(endpoint, &token) {
            Ok(grant) => {
                self.change(|held| {
                    held.kept = Some(Kept {
                        agent: grant.id.clone(),
                        token,
                    });
                    held.grant = Some(grant);
                });
                true
            }
            Err(Refusal::Unknown) => self.ended(Standing::Removed),
            Err(Refusal::Unreachable(why)) => self.ended(Standing::Unreachable(why)),
        }
    }

    /// Asks the window which verbs it answers, until it says or `patience` runs out: a
    /// window still loading, or none open, answers nothing yet. A window that is loading
    /// never hears the question at all, so each is given up on after a moment rather than
    /// the endpoint's thirty seconds.
    fn ask_window(&self, endpoint: &Endpoint, patience: Duration) {
        let started = Instant::now();
        loop {
            let asked = json!({ "verb": "verbs", "args": {}, "rest": [] });
            let said = app::post(
                endpoint,
                Some(&endpoint.secret),
                &asked,
                Duration::from_secs(2),
            )
            .map(|said| Outcome::from_endpoint(said.status, &said.body));
            if let Ok(Outcome::Done { result, .. }) = said {
                let verbs: BTreeSet<String> = result
                    .get("verbs")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect();
                return self.change(|held| held.window = Some(verbs));
            }
            if started.elapsed() >= patience {
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    /// Looks at the two files every two seconds for as long as the session lasts.
    fn watch(&self, dir: &Path) {
        let automation = dir.join("automation.json");
        let grants = dir.join("agents.json");
        let mut launched = modified(&automation);
        let mut granted = modified(&grants);
        loop {
            std::thread::sleep(LOOK_EVERY);

            let now = modified(&automation);
            if now != launched {
                launched = now;
                self.relaunched(dir);
            }
            let now = modified(&grants);
            if now != granted {
                granted = now;
                self.regrant();
            }

            let seen = self.seen_now();
            if seen.standing == Standing::Paired && seen.window.is_none() {
                if let Some(endpoint) = self.held().endpoint.clone() {
                    self.ask_window(&endpoint, Duration::ZERO);
                }
            }
        }
    }

    /// The app wrote its endpoint file again: a launch, perhaps on another port.
    fn relaunched(&self, dir: &Path) {
        let Some(now) = app::endpoint(dir) else {
            return;
        };
        if self.held().endpoint.as_ref() == Some(&now) || !app::answers(&now) {
            return;
        }
        match self.seen_now().standing {
            // The reader's answer holds for the whole run.
            Standing::Refused | Standing::Removed => {}
            _ => self.reach(dir, now),
        }
    }

    /// A grant changed somewhere: this agent's is read again.
    fn regrant(&self) {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        let (Some(endpoint), Some(kept)) = (endpoint, kept) else {
            return;
        };
        match grant_of(&endpoint, &kept.token) {
            Ok(grant) => {
                if self.held().grant.as_ref() != Some(&grant) {
                    self.change(|held| held.grant = Some(grant));
                }
            }
            Err(Refusal::Unknown) => self.removed(),
            Err(Refusal::Unreachable(_)) => {}
        }
    }

    /// The reader removed this agent: its token is forgotten, and its tools go.
    fn removed(&self) {
        if let (Some(dir), None) = (&self.dir, handed()) {
            pairing::forget(dir, &self.client);
        }
        self.change(|held| {
            held.kept = None;
            held.grant = None;
            held.standing = Some(Standing::Removed);
        });
    }

    /// One verb, called as this agent. The sidebar's own sessions wait on a question
    /// the call raised, the way the sidebar's own loop does (`answered`): the reader
    /// approves inline, and the call goes ahead then.
    pub fn call(&self, verb: &str, args: &Value) -> Outcome {
        let outcome = self.call_once(verb, args);
        let Outcome::Asked { approval, .. } = &outcome else {
            return outcome;
        };
        if handed().is_none() {
            return outcome;
        }
        match self.answered(approval) {
            Some(true) => self.call_once(verb, args),
            Some(false) => Outcome::failed("denied", "the reader said no"),
            None => outcome,
        }
    }

    /// Waits for the reader's answer to a question: allowed, refused, or `None` when it
    /// was not answered in time (the model is then told it was asked, as an outside
    /// agent is).
    fn answered(&self, approval: &str) -> Option<bool> {
        let started = Instant::now();
        while started.elapsed() < APPROVAL_WAIT {
            let asked = self.call_once("approval_status", &json!({ "id": approval }));
            let Outcome::Done { result, .. } = asked else {
                return None;
            };
            match result["approval"]["answer"].as_str() {
                Some("allowed" | "done") => return Some(true),
                Some("denied") => return Some(false),
                Some("pending") => std::thread::sleep(APPROVAL_LOOK),
                _ => return None,
            }
        }
        None
    }

    /// One verb, called once. A call that finds no app on the port it knew looks at the
    /// endpoint file once, for a launch on another port.
    fn call_once(&self, verb: &str, args: &Value) -> Outcome {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        let (Some(endpoint), Some(kept)) = (endpoint, kept) else {
            return Outcome::failed("not_paired", self.sentence());
        };
        let asked = json!({ "verb": verb, "args": args, "rest": [] });
        let said = match app::post(&endpoint, Some(&kept.token), &asked, PATIENCE) {
            Ok(said) => said,
            Err(first) => {
                let again = self
                    .dir
                    .as_deref()
                    .and_then(app::running)
                    .filter(|now| *now != endpoint);
                let Some(now) = again else {
                    return Outcome::failed("unavailable", unreachable(&first));
                };
                self.change(|held| held.endpoint = Some(now.clone()));
                match app::post(&now, Some(&kept.token), &asked, PATIENCE) {
                    Ok(said) => said,
                    Err(second) => return Outcome::failed("unavailable", unreachable(&second)),
                }
            }
        };
        if said.status == 401 {
            self.removed();
            return Outcome::failed("not_paired", self.sentence());
        }
        Outcome::from_endpoint(said.status, &said.body)
    }

    /// The client is going: its tabs close in ten minutes unless it comes back.
    pub fn bye(&self) {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        if let (Some(endpoint), Some(kept)) = (endpoint, kept) {
            let asked = json!({ "verb": "agent_bye", "args": {} });
            let _ = app::post(&endpoint, Some(&kept.token), &asked, Duration::from_secs(3));
        }
    }

    /// Where the link stands, in a sentence for a model: what `agent_status` answers
    /// before the pairing, and why a call could not be made.
    pub fn sentence(&self) -> String {
        let name = &self.client.name;
        match self.seen_now().standing {
            Standing::Connecting => "nib is starting.".to_owned(),
            Standing::Asked => format!(
                "nib is asking the reader whether {name} may work in it. Ask them to press Allow in nib; its tools appear once they do."
            ),
            Standing::Refused => format!(
                "The reader did not allow {name} in nib. Restart {name} to ask again."
            ),
            Standing::Removed => format!(
                "The reader removed {name} from nib's agents. Restart {name} to ask again."
            ),
            Standing::Unreachable(why) => format!("nib cannot be reached: {why}."),
            Standing::Paired => format!("{name} is paired with nib."),
        }
    }
}

/// The token the app itself handed this run, when it started the client: the AI
/// sidebar's Claude Code or Codex, whose only tool is `nib mcp` under the sidebar's own
/// grant (`src/ai_cli.rs`). It comes in the environment, never on a command line, and it
/// stands in for pairing: the client's own kept file, which is the reader's pairing of
/// their own Claude Code, is neither read nor written nor forgotten.
fn handed() -> Option<String> {
    std::env::var("NIB_MCP_TOKEN")
        .ok()
        .filter(|token| !token.is_empty() && token.bytes().all(|one| one.is_ascii_alphanumeric()))
}

/// A token proved: the grant it belongs to, or why not.
fn grant_of(endpoint: &Endpoint, token: &str) -> Result<Grant, Refusal> {
    let asked = json!({ "verb": "agent_status", "args": {} });
    let said = app::post(endpoint, Some(token), &asked, Duration::from_secs(10))
        .map_err(|error| Refusal::Unreachable(unreachable(&error)))?;
    if said.status == 401 {
        return Err(Refusal::Unknown);
    }
    match Outcome::from_endpoint(said.status, &said.body) {
        Outcome::Done { result, .. } => result
            .get("grant")
            .cloned()
            .and_then(|grant| serde_json::from_value(grant).ok())
            .ok_or_else(|| Refusal::Unreachable("nib answered no grant".to_owned())),
        Outcome::Failed { message, .. } => Err(Refusal::Unreachable(message)),
        Outcome::Asked { .. } => Err(Refusal::Unreachable("nib asked instead".to_owned())),
    }
}

/// Why nib did not answer, in a sentence: the reader closed it, most likely.
fn unreachable(error: &std::io::Error) -> String {
    format!("nib is not running or did not answer ({error}); ask the reader to open nib, then call again")
}

/// When a file last changed; `None` for a file that is not there.
fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|one| one.modified()).ok()
}
