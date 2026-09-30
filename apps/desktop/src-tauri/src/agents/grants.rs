//! Who may drive nib, and how far: an agent is a grant (docs/agent-native.md 9.1).
//!
//! A grant is made the first time a client pairs through `nib mcp`, or by hand in
//! Settings > Agents for a client somewhere else, and it is kept in `<config>/agents.json`
//! beside the endpoint's own file, the owner's alone. What a grant holds is what the
//! settings pane shows: the scopes, the spaces, the rules per site, the mode, the
//! questions it always asks and its limits.
//!
//! **The token is never kept.** A client is handed 32 random bytes as hex, once, and nib
//! keeps their SHA-256. A copy of the file is then a list of what each agent may do and
//! not a way to be one. A token that arrives is hashed and compared with every grant's
//! hash in constant time, all of them, so how long the answer takes says nothing about
//! which one was nearly right.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

use super::verbs::Category;
use crate::paths::{config_dir, made, write_privately};

/// The token's length in bytes, which is the endpoint secret's too.
const TOKEN_BYTES: usize = 32;

/// What an agent may reach, by capability (9.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Scope {
    /// Where the reader is: the tab in front, the selection, the lines on screen.
    #[serde(rename = "context")]
    Context,
    /// Reading notes.
    #[serde(rename = "notes.read")]
    NotesRead,
    /// Writing notes.
    #[serde(rename = "notes.write")]
    NotesWrite,
    /// The file tree: moving, renaming, folders.
    #[serde(rename = "tree")]
    Tree,
    /// Tabs and bookmarks, opened behind the tab in front.
    #[serde(rename = "workspace")]
    Workspace,
    /// Changing what the reader is looking at.
    #[serde(rename = "workspace.focus")]
    WorkspaceFocus,
    /// Tabs of its own, out of sight.
    #[serde(rename = "browser")]
    Browser,
    /// The reader's own web tabs.
    #[serde(rename = "browser.reader")]
    BrowserReader,
    /// Scripts in pages, per site on top of this.
    #[serde(rename = "browser.script")]
    BrowserScript,
    /// Response bodies.
    #[serde(rename = "browser.network")]
    BrowserNetwork,
    /// The reader's cookies and storage.
    #[serde(rename = "browser.storage")]
    BrowserStorage,
    /// The short list of settings.
    #[serde(rename = "settings")]
    Settings,
    /// The terminal.
    #[serde(rename = "terminal")]
    Terminal,
}

impl Scope {
    /// Every scope, in the settings pane's order.
    pub const ALL: [Scope; 13] = [
        Scope::Context,
        Scope::NotesRead,
        Scope::NotesWrite,
        Scope::Tree,
        Scope::Workspace,
        Scope::WorkspaceFocus,
        Scope::Browser,
        Scope::BrowserReader,
        Scope::BrowserScript,
        Scope::BrowserNetwork,
        Scope::BrowserStorage,
        Scope::Settings,
        Scope::Terminal,
    ];
}

/// The word `"all"`, which is what `spaces` says for every space.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Every {
    /// Every space.
    All,
}

/// Which spaces an agent may reach. Another space's notes, tabs and store do not exist
/// to it (9.6).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Spaces {
    /// `"all"`.
    All(Every),
    /// These, by name.
    Named(Vec<String>),
}

impl Spaces {
    /// Whether the space with this name is one of them.
    pub fn reach(&self, space: &str) -> bool {
        match self {
            Spaces::All(_) => true,
            Spaces::Named(names) => names.iter().any(|one| one == space),
        }
    }
}

/// What a grant says about one site (9.2, 6.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SiteRule {
    /// Always fine.
    Allow,
    /// Never opened, navigated to or acted in, in any tab.
    Deny,
    /// Only in the agent's own store: mail, a bank.
    AgentStore,
}

/// Whether an agent asks for every write or only for the list in 9.3.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Only what 9.3 lists asks.
    #[default]
    Unsupervised,
    /// Every write asks, batched.
    Confirm,
}

/// How much an agent may do (9.1, 6.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    /// Its own tabs open at once; past that the least recently used is parked.
    pub tabs: u32,
    /// Calls a minute.
    pub calls: u32,
    /// Navigations a minute.
    pub navigations: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            tabs: 4,
            calls: 600,
            navigations: 60,
        }
    }
}

/// An agent, as the settings pane reads and writes it (13.1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Grant {
    /// Its id, made from the client's name: `claude-code`.
    pub id: String,
    /// What the reader calls it.
    pub name: String,
    /// What the client called itself when it paired.
    pub client: String,
    /// What it may reach.
    pub scopes: Vec<Scope>,
    /// Which spaces.
    pub spaces: Spaces,
    /// Rules by site, a registrable domain each (`example.co.uk`).
    #[serde(default)]
    pub sites: BTreeMap<String, SiteRule>,
    /// The sites `browser.script` reaches (9.2): off everywhere until the reader says.
    #[serde(default)]
    pub scripts: Vec<String>,
    /// Unsupervised or confirm.
    #[serde(default)]
    pub mode: Mode,
    /// The categories of 9.3, each on or off. A category left out asks.
    #[serde(default)]
    pub asks: BTreeMap<Category, bool>,
    /// "Always on this site": categories the reader allowed for good on one site.
    #[serde(default)]
    pub always: BTreeMap<String, Vec<Category>>,
    /// The programs `run_terminal` may start without asking (8.9).
    #[serde(default)]
    pub programs: Vec<String>,
    /// Its limits.
    #[serde(default)]
    pub limits: Limits,
    /// When it was made, in milliseconds since 1970.
    #[serde(default)]
    pub created: u64,
}

impl Grant {
    /// A grant for one of the reader's own clients, paired on this machine, with Emil's
    /// defaults (9.1): everything but scripts, the reader's storage, settings and the
    /// terminal; every space; unsupervised; every question on.
    pub fn own(id: String, client: &str) -> Self {
        Grant {
            id,
            name: client.to_string(),
            client: client.to_string(),
            scopes: Scope::ALL
                .into_iter()
                .filter(|one| {
                    !matches!(
                        one,
                        Scope::BrowserScript
                            | Scope::BrowserStorage
                            | Scope::Settings
                            | Scope::Terminal
                    )
                })
                .collect(),
            spaces: Spaces::All(Every::All),
            sites: BTreeMap::new(),
            scripts: Vec::new(),
            mode: Mode::Unsupervised,
            asks: BTreeMap::new(),
            always: BTreeMap::new(),
            programs: Vec::new(),
            limits: Limits::default(),
            created: crate::clock::now(),
        }
    }

    /// A grant for somebody else's tool, made by hand: the same, without the reader's
    /// screen or tabs, and asking for every write (9.1).
    pub fn third_party(id: String, client: &str) -> Self {
        let mut grant = Grant::own(id, client);
        grant
            .scopes
            .retain(|one| !matches!(one, Scope::Context | Scope::BrowserReader));
        grant.mode = Mode::Confirm;
        grant
    }

    /// Whether it holds a scope.
    pub fn holds(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }

    /// Whether a category asks for this agent: on unless the reader turned it off.
    pub fn asks(&self, category: Category) -> bool {
        self.asks.get(&category).copied().unwrap_or(true)
    }

    /// Whether the reader said "always" for this category on this site.
    pub fn always(&self, site: &str, category: Category) -> bool {
        self.always
            .get(site)
            .is_some_and(|categories| categories.contains(&category))
    }
}

/// A grant as the file keeps it: with its token's hash, which never leaves the crate.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Kept {
    #[serde(flatten)]
    grant: Grant,
    /// SHA-256 of the token, as hex.
    token: String,
}

/// The file.
#[derive(Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    agents: Vec<Kept>,
}

/// Every grant, read from the file the first time an agent asks and written back on
/// every change. `None` until then, which is what keeps a launch from reading it.
#[derive(Default)]
pub struct Grants(Mutex<Option<Vec<Kept>>>);

impl Grants {
    /// The grants, read from disk if they have not been yet, handed to `with`.
    fn with<T>(
        &self,
        app: &AppHandle,
        with: impl FnOnce(&mut Vec<Kept>) -> T,
    ) -> Result<T, String> {
        let mut held = self
            .0
            .lock()
            .map_err(|_| "the agents cannot be read just now".to_string())?;
        if held.is_none() {
            *held = Some(read(&file(app)?));
        }
        let kept = held.as_mut().ok_or("the agents cannot be read just now")?;
        Ok(with(kept))
    }

    /// The grant a token belongs to, if any.
    pub fn by_token(&self, app: &AppHandle, token: &str) -> Option<Grant> {
        let said = hashed(token);
        self.with(app, |kept| {
            // Every one compared, none skipped: see the top of this file.
            let mut found = None;
            for one in kept.iter() {
                if same(&said, &one.token) && found.is_none() {
                    found = Some(one.grant.clone());
                }
            }
            found
        })
        .ok()
        .flatten()
    }

    /// The grant with this id.
    pub fn by_id(&self, app: &AppHandle, id: &str) -> Option<Grant> {
        self.with(app, |kept| {
            kept.iter()
                .find(|one| one.grant.id == id)
                .map(|one| one.grant.clone())
        })
        .ok()
        .flatten()
    }

    /// Every grant.
    pub fn all(&self, app: &AppHandle) -> Result<Vec<Grant>, String> {
        self.with(app, |kept| {
            kept.iter().map(|one| one.grant.clone()).collect()
        })
    }

    /// A new grant made from `make` with a fresh id and token, kept; answers the grant
    /// and the token, which is said this once.
    pub fn mint(
        &self,
        app: &AppHandle,
        client: &str,
        make: impl FnOnce(String, &str) -> Grant,
    ) -> Result<(Grant, String), String> {
        let token = fresh_token()?;
        let path = file(app)?;
        self.with(app, |kept| {
            let ids: Vec<&str> = kept.iter().map(|one| one.grant.id.as_str()).collect();
            let grant = make(free_id(client, &ids), client);
            kept.push(Kept {
                grant: grant.clone(),
                token: hashed(&token),
            });
            write(&path, kept).map(|()| (grant, token))
        })?
    }

    /// The settings pane's list, written over what is kept: each grant by id takes the
    /// pane's version, and a grant the pane left out is gone, with its token. A grant
    /// the pane made up is not added; a grant is only ever made with a token.
    pub fn replace(&self, app: &AppHandle, grants: Vec<Grant>) -> Result<Vec<Grant>, String> {
        let path = file(app)?;
        self.with(app, |kept| {
            let mut next = Vec::with_capacity(kept.len());
            for grant in grants {
                if let Some(one) = kept.iter().find(|one| one.grant.id == grant.id) {
                    next.push(Kept {
                        grant: Grant {
                            // Who it was made for, and when, are facts rather than
                            // settings.
                            client: one.grant.client.clone(),
                            created: one.grant.created,
                            ..grant
                        },
                        token: one.token.clone(),
                    });
                }
            }
            *kept = next;
            write(&path, kept).map(|()| kept.iter().map(|one| one.grant.clone()).collect())
        })?
    }

    /// One grant changed in place, and kept.
    pub fn change(
        &self,
        app: &AppHandle,
        id: &str,
        change: impl FnOnce(&mut Grant),
    ) -> Result<(), String> {
        let path = file(app)?;
        self.with(app, |kept| {
            let Some(one) = kept.iter_mut().find(|one| one.grant.id == id) else {
                return Err("there is no such agent".to_string());
            };
            change(&mut one.grant);
            write(&path, kept)
        })?
    }
}

/// A grant as it was last read, without reading the file: for the engine's own events,
/// which have no app to find the file with and come only after a grant was read. `None`
/// for an id no grant has, or before any grant was read.
pub fn cached(id: &str) -> Option<Grant> {
    super::AGENTS
        .get()?
        .grants
        .0
        .lock()
        .ok()?
        .as_ref()?
        .iter()
        .find(|one| one.grant.id == id)
        .map(|one| one.grant.clone())
}

/// Where the grants are kept.
fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("agents.json"))
}

/// The grants in the file; none for a file that is not there or cannot be read, which
/// is an installation with no agents rather than a reason to refuse every call.
fn read(path: &std::path::Path) -> Vec<Kept> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<File>(&text).ok())
        .map(|file| file.agents)
        .unwrap_or_default()
}

/// The grants, written whole and the owner's alone.
fn write(path: &std::path::Path, kept: &[Kept]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        made(dir)?;
    }
    let text = serde_json::to_string_pretty(&File {
        agents: kept.to_vec(),
    })
    .map_err(|error| format!("could not write the agents: {error}"))?;
    write_privately(path, text.as_bytes())
}

/// An id for a client, made from its name and free among `taken`: `Claude Code` is
/// `claude-code`, and a second one `claude-code-2`.
fn free_id(client: &str, taken: &[&str]) -> String {
    let mut stem = String::new();
    for one in client.chars().flat_map(char::to_lowercase) {
        if one.is_ascii_alphanumeric() {
            stem.push(one);
        } else if !stem.is_empty() && !stem.ends_with('-') {
            stem.push('-');
        }
        if stem.len() >= 32 {
            break;
        }
    }
    let stem = stem.trim_end_matches('-');
    let stem = if stem.is_empty() { "agent" } else { stem };

    if !taken.contains(&stem) {
        return stem.to_string();
    }
    (2..10_000)
        .map(|n| format!("{stem}-{n}"))
        .find(|one| !taken.contains(&one.as_str()))
        .unwrap_or_else(|| stem.to_string())
}

/// A token nobody can guess, from the system's own randomness.
fn fresh_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("no randomness to make a token from: {error}"))?;
    Ok(hex(&bytes))
}

/// A token's SHA-256, as hex: what the file keeps.
fn hashed(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

/// Bytes as hex, two characters each.
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Whether two hashes are the same, in a time that does not depend on where they
/// differ. Both are always 64 characters, so the length gives nothing away.
fn same(one: &str, other: &str) -> bool {
    if one.len() != other.len() {
        return false;
    }
    let mut differences = 0_u8;
    for (a, b) in one.bytes().zip(other.bytes()) {
        differences |= a ^ b;
    }
    differences == 0
}

/// The agents, for Settings > Agents.
#[tauri::command(async)]
pub fn agents_read(webview: tauri::Webview, app: AppHandle) -> Result<Vec<Grant>, String> {
    super::from_the_app(&webview)?;
    super::state(&app).grants.all(&app)
}

/// The agents as Settings > Agents changed them: see `Grants::replace`.
#[tauri::command(async)]
pub fn agents_write(
    webview: tauri::Webview,
    app: AppHandle,
    grants: Vec<Grant>,
) -> Result<Vec<Grant>, String> {
    super::from_the_app(&webview)?;
    super::state(&app).grants.replace(&app, grants)
}

/// A grant made by hand for a client somewhere else, or a script (9.1): its token is
/// answered this once, for the reader to paste into that client.
#[tauri::command(async)]
pub fn agents_mint(
    webview: tauri::Webview,
    app: AppHandle,
    name: String,
) -> Result<Minted, String> {
    super::from_the_app(&webview)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("an agent needs a name".into());
    }
    let (grant, token) = super::state(&app)
        .grants
        .mint(&app, name, Grant::third_party)?;
    Ok(Minted { grant, token })
}

/// A grant made by hand, with its token.
#[derive(Serialize)]
pub struct Minted {
    /// The grant.
    pub grant: Grant,
    /// Its token, said once.
    pub token: String,
}

/// Grants held without a file, for the tests.
#[cfg(test)]
impl Grants {
    fn from(kept: Vec<Kept>) -> Self {
        Grants(Mutex::new(Some(kept)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept(id: &str, token: &str) -> Kept {
        Kept {
            grant: Grant::own(id.into(), id),
            token: hashed(token),
        }
    }

    #[test]
    fn a_grant_round_trips_through_the_file_shape() {
        let mut grant = Grant::own("claude-code".into(), "Claude Code");
        grant
            .sites
            .insert("bank.example".into(), SiteRule::AgentStore);
        grant.sites.insert("evil.example".into(), SiteRule::Deny);
        grant.asks.insert(Category::Sending, false);
        grant
            .always
            .insert("shop.example".into(), vec![Category::Paying]);
        grant.spaces = Spaces::Named(vec!["Research".into()]);

        let text = serde_json::to_string(&File {
            agents: vec![Kept {
                grant: grant.clone(),
                token: hashed("t"),
            }],
        })
        .expect("json");
        let back: File = serde_json::from_str(&text).expect("read");
        assert_eq!(back.agents[0].grant, grant);
        assert_eq!(back.agents[0].token, hashed("t"));
        // The shape 13.1 promises, by name.
        let value: serde_json::Value = serde_json::from_str(&text).expect("value");
        let one = &value["agents"][0];
        assert_eq!(one["sites"]["bank.example"], "agent-store");
        assert_eq!(one["spaces"][0], "Research");
        assert_eq!(one["mode"], "unsupervised");
        assert_eq!(one["asks"]["sending"], false);
        assert!(one["scopes"]
            .as_array()
            .expect("scopes")
            .contains(&"browser.reader".into()));
    }

    #[test]
    fn every_space_is_the_word_all() {
        let all: Spaces = serde_json::from_str("\"all\"").expect("all");
        assert_eq!(all, Spaces::All(Every::All));
        assert!(all.reach("anything"));
        let some: Spaces = serde_json::from_str("[\"A\"]").expect("named");
        assert!(some.reach("A"));
        assert!(!some.reach("B"));
        assert_eq!(serde_json::to_string(&all).expect("json"), "\"all\"");
    }

    #[test]
    fn the_defaults_are_emils() {
        let own = Grant::own("a".into(), "A");
        assert!(own.holds(Scope::Browser));
        assert!(own.holds(Scope::BrowserReader));
        assert!(own.holds(Scope::Context));
        assert!(!own.holds(Scope::BrowserScript));
        assert!(!own.holds(Scope::BrowserStorage));
        assert!(!own.holds(Scope::Settings));
        assert!(!own.holds(Scope::Terminal));
        assert_eq!(own.mode, Mode::Unsupervised);
        assert!(own.asks(Category::Paying));
        assert_eq!(
            own.limits,
            Limits {
                tabs: 4,
                calls: 600,
                navigations: 60
            }
        );

        let other = Grant::third_party("b".into(), "B");
        assert!(!other.holds(Scope::Context));
        assert!(!other.holds(Scope::BrowserReader));
        assert_eq!(other.mode, Mode::Confirm);
    }

    #[test]
    fn a_token_finds_its_grant_and_no_other() {
        let grants = Grants::from(vec![kept("a", "one"), kept("b", "two")]);
        let found = |token: &str| {
            grants
                .0
                .lock()
                .expect("lock")
                .as_ref()
                .expect("read")
                .iter()
                .find(|one| same(&hashed(token), &one.token))
                .map(|one| one.grant.id.clone())
        };
        assert_eq!(found("one").as_deref(), Some("a"));
        assert_eq!(found("two").as_deref(), Some("b"));
        assert_eq!(found("three"), None);
        assert_eq!(found(""), None);
    }

    #[test]
    fn a_hash_is_the_same_only_when_every_byte_is() {
        let one = hashed("token");
        assert!(same(&one, &one.clone()));
        assert!(!same(&one, &hashed("tokem")));
        assert!(!same(&one, &one[..63]));
        assert_eq!(one.len(), 64);
        // What is kept is not the token.
        assert_ne!(one, "token");
    }

    #[test]
    fn a_fresh_token_is_64_hex_characters_and_never_the_same_twice() {
        let one = fresh_token().expect("token");
        let two = fresh_token().expect("token");
        assert_eq!(one.len(), TOKEN_BYTES * 2);
        assert!(one.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(one, two);
    }

    #[test]
    fn an_id_comes_from_the_name_and_is_free() {
        assert_eq!(free_id("Claude Code", &[]), "claude-code");
        assert_eq!(free_id("Claude Code", &["claude-code"]), "claude-code-2");
        assert_eq!(
            free_id("Claude Code", &["claude-code", "claude-code-2"]),
            "claude-code-3"
        );
        assert_eq!(free_id("  ", &[]), "agent");
        assert_eq!(free_id("Codex (CLI)", &[]), "codex-cli");
        assert_eq!(free_id("日本", &[]), "agent");
    }
}
