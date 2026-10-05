//! The browser as an agent drives it: every verb's name, what it takes and what it
//! answers, and what the crate tells the window on `nib://agent`.
//!
//! One file, because it is where three lanes meet (docs/agent-native.md 13.1). The MCP
//! server's tool schemas are written from these types, the activity panel is built
//! against the events, and `src/lib/agents/verbs.ts` mirrors every shape here for the
//! window. A test at the bottom holds the list of names to the table, and the mirror's
//! own test holds the mirror to this file, so a verb cannot drift on one side only.
//!
//! **What a caller sends.** One POST to the endpoint, `{"verb": "browser_click", "args":
//! {...}}`, with an agent's token (or the installation's secret) as its bearer. The
//! arguments are read strictly: a name the verb does not take is refused rather than
//! ignored, because an agent that misspelt `ref` would otherwise press the wrong thing
//! with nothing said.
//!
//! **What comes back** is always an `Answer`: `ok` with the verb's own result, or
//! `needs_approval` at once (9.3), or `error` with a code an agent can act on. A dialog
//! the page is holding rides on every one of them, so the agent hears about it on
//! whatever it calls next.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The event every agent's news reaches the window on.
pub const EVENT: &str = "nib://agent";

/// A tab as an agent names it: an agent tab's id (`a3`), or a reader's web tab's id as
/// `browser_tabs` lists it.
pub type TabId = String;

/// An element as an agent names it: `e4812` for the engine's node 4812 in the page, and
/// `f2e17` for node 17 inside the page's second frame that runs in a process of its own.
/// Stable for as long as the element lives, which is longer than a snapshot.
pub type Ref = String;

// ---------------------------------------------------------------------------------------
// What each verb takes.
// ---------------------------------------------------------------------------------------

/// A verb that takes nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Nothing {}

/// A verb that takes only a tab.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OnTab {
    /// The tab.
    pub tab: TabId,
}

/// Which store an agent tab's cookies and logins are in (6.3).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Store {
    /// The store the reader's own tabs of that space use: signed in where they are.
    #[default]
    Reader,
    /// A store of the agent's own, signed out until somebody signs in there, kept
    /// across runs.
    Agent,
    /// Another space's store, with that space granted.
    Space,
}

/// `browser_open`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Open {
    /// Where the page goes: `http` or `https`.
    pub url: String,
    /// Which store it is in.
    #[serde(default)]
    pub store: Store,
    /// The space whose store `space` means, or whose reader's store `reader` means.
    /// The open space when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    /// Its width in CSS pixels, 1280 when not said: a page lays itself out for the
    /// width it has, independent of the reader's window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Its height in CSS pixels, 800 when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

/// `browser_navigate`: an address, or one of the three steps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Navigate {
    /// The tab.
    pub tab: TabId,
    /// Where to, unless one of the steps below is asked for instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// One step back along the tab's history.
    #[serde(default)]
    pub back: bool,
    /// One step forward.
    #[serde(default)]
    pub forward: bool,
    /// The same page again.
    #[serde(default)]
    pub reload: bool,
}

/// What `browser_wait` waits for as a word.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Moment {
    /// The page's `load` event, which is `document.readyState` complete.
    Load,
    /// No request in flight for 500 ms, counted from the engine's own network events.
    NetworkIdle,
}

/// What `browser_wait` waits for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Until {
    /// `"load"` or `"network_idle"`.
    Moment(Moment),
    /// `{"text": "Saved"}`: those words anywhere in the page's text.
    Text {
        /// The words.
        text: String,
    },
    /// `{"ref": "e12"}`: that element in the page and visible.
    Element {
        /// The element.
        #[serde(rename = "ref")]
        element: Ref,
    },
    /// `{"url": "/done"}`: the page's address containing that.
    Url {
        /// Part of the address.
        url: String,
    },
}

/// `browser_wait`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wait {
    /// The tab.
    pub tab: TabId,
    /// What for.
    #[serde(rename = "for")]
    pub until: Until,
    /// How long at most, 30 s when not said and never more than 120 s.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

/// `browser_snapshot`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    /// The tab.
    pub tab: TabId,
    /// Only the part of the tree under this element.
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    /// The longest answer, in characters; 40,000 when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

/// `browser_find`: by the words an element carries, or by its role and name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Find {
    /// The tab.
    pub tab: TabId,
    /// Words the element's name or text contains, ignoring case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Its accessible role: `button`, `link`, `textbox`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Its accessible name, or part of it, ignoring case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// How `browser_read` answers the page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadAs {
    /// The page's visible words, as a person would copy them.
    Text,
    /// The whole page as markdown, through the clipper's own converter.
    #[default]
    Markdown,
    /// Only the article, as the clipper picks it, as markdown.
    Article,
}

/// `browser_read`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Read {
    /// The tab.
    pub tab: TabId,
    /// How.
    #[serde(default, rename = "as")]
    pub shape: ReadAs,
    /// The longest answer, in characters; 100,000 when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

/// What `capture_to_note` asks the crate for when it puts a page into a note: the
/// window's `agents_capture`, never an agent's own verb (docs/agent-native.md 5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureAs {
    /// The article as the clip button picks it, as HTML for the clipper's converter.
    Clip,
    /// A picture of the page, every filled secret field painted over.
    Screenshot,
    /// The page printed to a PDF on the reader's paper.
    Pdf,
}

/// Which mouse button.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Button {
    /// The main one.
    #[default]
    Left,
    /// The context menu's.
    Right,
    /// The wheel.
    Middle,
}

/// A key held during a press.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Modifier {
    /// Alt, Option on a Mac.
    Alt,
    /// Control.
    Control,
    /// The Windows key, Command on a Mac.
    Meta,
    /// Shift.
    Shift,
}

/// `browser_click`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Click {
    /// The tab.
    pub tab: TabId,
    /// What to press.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// Which button; the main one when not said.
    #[serde(default)]
    pub button: Button,
    /// How many presses, 2 for a double click; one when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u8>,
    /// Keys held while pressing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<Modifier>,
}

/// `browser_type`: words into a field, as text rather than keys. Refused on a
/// password field (9.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Type {
    /// The tab.
    pub tab: TabId,
    /// The field.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// The words.
    pub text: String,
    /// Enter afterwards.
    #[serde(default)]
    pub submit: bool,
    /// Empty the field first rather than adding to what is there.
    #[serde(default)]
    pub replace: bool,
}

/// `browser_press`: one key or one chord, pressed inside that page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Press {
    /// The tab.
    pub tab: TabId,
    /// `Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+A`, `Shift+Tab`.
    pub keys: String,
}

/// `browser_scroll`: an element into view, or the page by an amount.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scroll {
    /// The tab.
    pub tab: TabId,
    /// The element to bring into view.
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    /// Across, in CSS pixels.
    #[serde(default)]
    pub dx: f64,
    /// Down, in CSS pixels.
    #[serde(default)]
    pub dy: f64,
}

/// `browser_select`: options of a `<select>` chosen through the page, by value or by
/// the words they show, never by opening its list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Select {
    /// The tab.
    pub tab: TabId,
    /// The `<select>`.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// The options, each by its value or its label.
    pub values: Vec<String>,
}

/// What a field is set to by `browser_fill_form`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FieldValue {
    /// A checkbox or a radio button, ticked or not.
    Ticked(bool),
    /// Words for a text field, or one option of a `<select>`, or a date as
    /// `2026-09-30` for a date field.
    Words(String),
    /// Several options of a `<select multiple>`.
    Options(Vec<String>),
}

/// One field of a form.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    /// The field.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// What it is set to.
    pub value: FieldValue,
}

/// `browser_fill_form`: several fields in one call.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FillForm {
    /// The tab.
    pub tab: TabId,
    /// The fields, in order.
    pub fields: Vec<Field>,
}

/// `browser_hover`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hover {
    /// The tab.
    pub tab: TabId,
    /// What to hold the pointer over.
    #[serde(rename = "ref")]
    pub element: Ref,
}

/// `browser_drag`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Drag {
    /// The tab.
    pub tab: TabId,
    /// What is picked up.
    pub from: Ref,
    /// Where it is dropped.
    pub to: Ref,
}

/// `browser_upload`: files for a file input, from inside a space. A path outside
/// every space asks first (9.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    /// The tab.
    pub tab: TabId,
    /// The file input, or the element whose press opens the file chooser.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// Each file, as an absolute path or relative to the spaces folder
    /// (`Research/paper.pdf`).
    pub files: Vec<String>,
}

/// `browser_screenshot`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Screenshot {
    /// The tab.
    pub tab: TabId,
    /// Only this element.
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    /// The whole page rather than what fits in the tab.
    #[serde(default)]
    pub full_page: bool,
    /// Image pixels per CSS pixel; 1 when not said, whatever the screen's scale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
}

/// `browser_console`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Console {
    /// The tab.
    pub tab: TabId,
    /// Only lines after this one, as `next` answered it last time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    /// Only lines of this level: `error`, `warning`, `info`, `log`, `debug`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
}

/// `browser_network`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Network {
    /// The tab.
    pub tab: TabId,
    /// Only requests after this one, as `next` answered it last time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    /// Only requests whose address contains this.
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub matching: Option<String>,
    /// Each response's body too, which needs `browser.network`.
    #[serde(default)]
    pub bodies: bool,
}

/// Where `browser_evaluate` runs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum World {
    /// A world of nib's own: the page's document, none of its globals.
    #[default]
    Isolated,
    /// The page's own world, as the page.
    Page,
}

/// `browser_evaluate`: only with `browser.script` for that site (9.2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evaluate {
    /// The tab.
    pub tab: TabId,
    /// A JavaScript expression; a promise is waited for.
    pub expression: String,
    /// Where.
    #[serde(default)]
    pub world: World,
}

/// `browser_dialog`: the answer to the dialog the page is holding.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnswerDialog {
    /// The tab.
    pub tab: TabId,
    /// OK, or Cancel.
    pub accept: bool,
    /// What a `prompt` is answered with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// `browser_downloads`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Downloads {
    /// Only that tab's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<TabId>,
}

/// What `browser_storage` does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageOp {
    /// The cookies the page's address would be sent.
    Cookies,
    /// Sets `cookie`.
    SetCookie,
    /// Every cookie and every bit of storage of the page's site, gone.
    Clear,
    /// The page's `localStorage`.
    Local,
}

/// A cookie, as `browser_storage` reads and writes one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cookie {
    /// Its name.
    pub name: String,
    /// Its value.
    pub value: String,
    /// Its domain; the page's host when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Its path; `/` when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// When it ends, in seconds since 1970; with the session when not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    /// Out of the page's scripts' reach.
    #[serde(default)]
    pub http_only: bool,
    /// Only over https.
    #[serde(default)]
    pub secure: bool,
}

/// `browser_storage`: an agent's own store, unless it holds `browser.storage` for the
/// reader's.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Storage {
    /// The tab.
    pub tab: TabId,
    /// What to do.
    pub op: StorageOp,
    /// The cookie `set_cookie` sets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookie: Option<Cookie>,
}

/// `browser_takeover`: the reader asked to do one step in that tab, which the agent
/// keeps all the while.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Takeover {
    /// The tab.
    pub tab: TabId,
    /// The one line the reader reads: `Sign in to the bank`.
    pub reason: String,
}

/// `approval_status`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalAsk {
    /// The approval, as `needs_approval` named it.
    pub id: String,
}

/// `agent_pair`: a client asking to become an agent. Only with the installation's
/// secret, which is what `nib mcp` reads out of the endpoint file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pair {
    /// The client's name as it gives it: `Claude Code`.
    pub client: String,
    /// How long to wait for the reader's answer before answering `needs_approval`;
    /// 0 when not said, and never more than five minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_ms: Option<u64>,
}

// ---------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------

/// The verbs, written once: the enum, the list of names and the reading of a request
/// all come out of this one table.
macro_rules! verbs {
    ($( $(#[$doc:meta])* $name:literal => $variant:ident($args:ty) -> $answer:ty, )*) => {
        /// One call, read.
        #[derive(Clone, Debug, PartialEq)]
        pub enum Verb {
            $( $(#[$doc])* $variant($args), )*
        }

        /// Every verb the crate answers, by name, in the table's order.
        #[allow(dead_code, reason = "the list the MCP server's schemas and the tests read")]
        pub const NAMES: &[&str] = &[$($name),*];

        /// What each verb answers, by name, for the schemas. The type named is the
        /// `result` of an `ok`.
        #[allow(dead_code, reason = "the list the MCP server's schemas and the tests read")]
        pub const ANSWERS: &[(&str, &str)] = &[$(($name, stringify!($answer))),*];

        impl Verb {
            /// The verb a request names, with its arguments checked. `None` for a name
            /// that is not one of these, which the endpoint then hands to the window.
            pub fn read(name: &str, args: Value) -> Option<Result<Self, String>> {
                // A verb that takes nothing may be sent with no arguments at all.
                let args = if args.is_null() { Value::Object(Default::default()) } else { args };
                match name {
                    $( $name => Some(
                        serde_json::from_value::<$args>(args)
                            .map(Verb::$variant)
                            .map_err(|error| format!("{}: {error}", $name)),
                    ), )*
                    _ => None,
                }
            }

            /// The verb's name.
            pub fn name(&self) -> &'static str {
                match self {
                    $( Verb::$variant(_) => $name, )*
                }
            }
        }
    };
}

verbs! {
    /// The reader's web tabs and this agent's own.
    "browser_tabs" => Tabs(Nothing) -> TabList,
    /// An agent tab, out of sight.
    "browser_open" => Open(Open) -> Opened,
    /// An address, back, forward or reload.
    "browser_navigate" => Navigate(Navigate) -> Acted,
    /// Until the page has loaded, gone quiet, or shows something.
    "browser_wait" => Wait(Wait) -> Waited,
    /// The accessibility tree as text with refs.
    "browser_snapshot" => Snapshot(Snapshot) -> Snapped,
    /// The refs that match.
    "browser_find" => Find(Find) -> Found,
    /// The page as words.
    "browser_read" => Read(Read) -> PageText,
    /// Scrolled into view, lit for a beat, pressed.
    "browser_click" => Click(Click) -> Acted,
    /// Words into a field.
    "browser_type" => Type(Type) -> Acted,
    /// A key inside the page.
    "browser_press" => Press(Press) -> Acted,
    /// An element into view, or the page by an amount.
    "browser_scroll" => Scroll(Scroll) -> Acted,
    /// Options of a `<select>`.
    "browser_select" => Select(Select) -> Acted,
    /// Several fields at once.
    "browser_fill_form" => FillForm(FillForm) -> Acted,
    /// The pointer over an element.
    "browser_hover" => Hover(Hover) -> Acted,
    /// One element dragged onto another.
    "browser_drag" => Drag(Drag) -> Acted,
    /// Files for a file input.
    "browser_upload" => Upload(Upload) -> Acted,
    /// A PNG.
    "browser_screenshot" => Screenshot(Screenshot) -> Picture,
    /// The page's console.
    "browser_console" => Console(Console) -> ConsoleLines,
    /// The page's requests.
    "browser_network" => Network(Network) -> Requests,
    /// A script in the page.
    "browser_evaluate" => Evaluate(Evaluate) -> Evaluated,
    /// The answer to the dialog the page is holding.
    "browser_dialog" => Dialog(AnswerDialog) -> Acted,
    /// What the agent's tabs downloaded.
    "browser_downloads" => Downloads(Downloads) -> DownloadList,
    /// Cookies and storage.
    "browser_storage" => Storage(Storage) -> Stored,
    /// An agent tab closed.
    "browser_close" => Close(OnTab) -> Closed,
    /// An agent tab made a tab of the reader's; asks first.
    "browser_show" => Show(OnTab) -> Acted,
    /// The reader asked to do one step; asks.
    "browser_takeover" => Takeover(Takeover) -> Acted,
    /// This agent's grant, tabs, questions and pauses.
    "agent_status" => Status(Nothing) -> Status,
    /// What the reader answered.
    "approval_status" => ApprovalStatus(ApprovalAsk) -> ApprovalState,
    /// A client asking to become an agent; the installation's secret only.
    "agent_pair" => Pair(Pair) -> Paired,
    /// A client going away: its tabs are closed after ten minutes unless it comes
    /// back.
    "agent_bye" => Bye(Nothing) -> Nothing,
}

// ---------------------------------------------------------------------------------------
// What comes back.
// ---------------------------------------------------------------------------------------

/// Why a call was not done, as a word an agent can act on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    /// This engine has no honest way to do it (section 12).
    UnsupportedOnThisEngine,
    /// The arguments were not what the verb takes.
    BadArguments,
    /// The grant does not reach it: a scope, a space or a site.
    NotGranted,
    /// The site is denied to this agent.
    SiteDenied,
    /// There is no such tab, or not one this agent may see.
    NoSuchTab,
    /// The element is gone, or never was: take a snapshot again.
    NoSuchRef,
    /// The stop was pressed.
    Stopped,
    /// A password field: signing in is a takeover (9.4).
    PasswordField,
    /// Too many tabs, too many calls, or the machine's memory.
    Limit,
    /// It did not happen in time.
    Timeout,
    /// The page said no, or the engine did.
    Failed,
    /// The page is holding no dialog.
    NoDialog,
    /// The reader said no.
    Denied,
    /// Another device is using that site's login (7.4).
    InUseElsewhere,
}

/// A dialog the page is holding open until `browser_dialog` answers it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dialog {
    /// Which kind.
    pub kind: DialogKind,
    /// What it says.
    pub message: String,
    /// What a `prompt` offers as its answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_text: Option<String>,
    /// The page that raised it.
    pub url: String,
    /// How long it has been open, in milliseconds. An `alert` is accepted after 30 s
    /// unanswered, and a `confirm`, a `prompt` or a `beforeunload` dismissed.
    pub open_ms: u64,
}

/// The kinds of dialog a page raises.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DialogKind {
    /// `alert()`.
    Alert,
    /// `confirm()`.
    Confirm,
    /// `prompt()`.
    Prompt,
    /// Leaving a page that asked to be asked.
    Beforeunload,
}

/// Every answer, whatever the verb.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Answer {
    /// Done; `result` is the verb's own answer.
    Ok {
        /// The verb's own answer.
        result: Value,
        /// Where the words in `result` came from, when they came from a page: the MCP
        /// server marks them untrusted (9.6).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        untrusted: Option<String>,
        /// A dialog the page is holding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dialog: Option<Box<Dialog>>,
    },
    /// Not done, and asked: `approval_status` says what the reader answered.
    NeedsApproval {
        /// Which question.
        approval: String,
        /// What the reader is asked, in one line.
        summary: String,
    },
    /// Not done.
    Error {
        /// Why, as a word.
        code: Code,
        /// Why, in a sentence.
        message: String,
        /// A dialog the page is holding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dialog: Option<Box<Dialog>>,
    },
}

impl Answer {
    /// Done, with a result.
    pub fn ok(result: impl Serialize) -> Self {
        Answer::Ok {
            result: serde_json::to_value(result).unwrap_or(Value::Null),
            untrusted: None,
            dialog: None,
        }
    }

    /// Not done.
    pub fn error(code: Code, message: impl Into<String>) -> Self {
        Answer::Error {
            code,
            message: message.into(),
            dialog: None,
        }
    }

    /// The same answer, carrying the dialog a page is holding.
    #[must_use]
    pub fn with_dialog(mut self, held: Option<Dialog>) -> Self {
        match &mut self {
            Answer::Ok { dialog, .. } | Answer::Error { dialog, .. } => {
                *dialog = held.map(Box::new);
            }
            Answer::NeedsApproval { .. } => {}
        }
        self
    }

    /// The word the audit log files it under.
    pub fn status(&self) -> &'static str {
        match self {
            Answer::Ok { .. } => "ok",
            Answer::NeedsApproval { .. } => "needs_approval",
            Answer::Error { .. } => "error",
        }
    }

    /// The window's answer to a verb it answered for an agent, as the audit log files it:
    /// by its `status`, the contract's own word, because a question asked is `ok` to the
    /// endpoint and not a thing done; by `ok` alone for a verb that answers in the
    /// command line's `{ok, value}`. A code the contract does not have is a failure, in
    /// the window's words.
    pub fn from_window(text: &str) -> Self {
        if let Ok(answer) = serde_json::from_str::<Answer>(text) {
            return answer;
        }
        let said: Value = serde_json::from_str(text).unwrap_or_default();
        let message = ["message", "error"]
            .iter()
            .find_map(|key| said.get(key).and_then(Value::as_str))
            .unwrap_or_default();
        let done = match said.get("status").and_then(Value::as_str) {
            Some(status) => status == "ok",
            None => said.get("ok").and_then(Value::as_bool) == Some(true),
        };
        if done {
            Answer::ok(said.get("result").or_else(|| said.get("value")))
        } else {
            Answer::error(Code::Failed, message)
        }
    }
}

/// A reader's web tab, as `browser_tabs` lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReaderTab {
    /// Its id.
    pub id: TabId,
    /// What the page calls itself.
    pub title: String,
    /// Where it is.
    pub url: String,
    /// Which space it is in, when the window said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    /// Whether it is the tab in front of its pane.
    pub front: bool,
    /// Whether any of it is on the screen.
    pub on_screen: bool,
}

/// An agent's own tab.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentTab {
    /// Its id.
    pub id: TabId,
    /// Where it is.
    pub url: String,
    /// What the page calls itself.
    pub title: String,
    /// Whether a page is still loading.
    pub loading: bool,
    /// Which store it is in.
    pub store: Store,
    /// Whether its page was closed to save memory. The next call on it builds it again
    /// at the same address.
    pub parked: bool,
}

/// `browser_tabs`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TabList {
    /// The reader's, when the grant holds `browser.reader`.
    pub reader: Vec<ReaderTab>,
    /// This agent's own.
    pub agent: Vec<AgentTab>,
}

/// `browser_open`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opened {
    /// The new tab.
    pub tab: TabId,
    /// The store it is in: the agent's own when the site is kept to it (6.3), whatever
    /// was asked.
    pub store: Store,
}

/// What a verb that acts answers.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Acted {
    /// The page's address afterwards.
    pub url: String,
    /// Tabs the act opened: a link with `target=_blank`, a sign-in popup.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opened: Vec<TabId>,
}

/// `browser_wait`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waited {
    /// How long it took, in milliseconds.
    pub ms: u64,
    /// The page's address then.
    pub url: String,
}

/// `browser_snapshot`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapped {
    /// Where the page is.
    pub url: String,
    /// What it calls itself.
    pub title: String,
    /// The tree, one element a line: `- button "Save" [ref=e4812]`.
    pub text: String,
    /// Whether it was cut at `max_chars`.
    pub truncated: bool,
}

/// One element that matched.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Match {
    /// Its ref.
    #[serde(rename = "ref")]
    pub element: Ref,
    /// Its role.
    pub role: String,
    /// Its name.
    pub name: String,
}

/// `browser_find`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Found {
    /// Every element that matched, in the page's order.
    pub matches: Vec<Match>,
}

/// `browser_read`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageText {
    /// Where the page is.
    pub url: String,
    /// What it calls itself.
    pub title: String,
    /// The words.
    pub text: String,
    /// Whether they were cut at `max_chars`.
    pub truncated: bool,
}

/// `browser_screenshot`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Picture {
    /// The PNG, as base64.
    pub png: String,
    /// Its width in pixels.
    pub width: u32,
    /// Its height in pixels.
    pub height: u32,
}

/// `agents_capture`: the page as the window writes it into a note. One of the three is
/// there, the one asked for.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Captured {
    /// Where the page is.
    pub url: String,
    /// What it calls itself.
    pub title: String,
    /// The article's HTML, links made absolute and no field's value in it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// The picture, as base64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub png: Option<String>,
    /// The PDF, as base64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf: Option<String>,
}

/// One line of a page's console.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConsoleLine {
    /// Its place in the tab's count, for `since`.
    pub seq: u64,
    /// `error`, `warning`, `info`, `log` or `debug`.
    pub level: String,
    /// What it said.
    pub text: String,
    /// Where, when the engine said: an address and a line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// `browser_console`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConsoleLines {
    /// The lines, oldest first; the last 500 at most.
    pub lines: Vec<ConsoleLine>,
    /// What to pass as `since` next time.
    pub next: u64,
}

/// One request a page made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    /// Its place in the tab's count, for `since`.
    pub seq: u64,
    /// `GET`, `POST`.
    pub method: String,
    /// Where to.
    pub url: String,
    /// What the server answered, once it has.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// What kind of thing: `Document`, `XHR`, `Fetch`, `Script`, `Image`.
    pub kind: String,
    /// How long it took, once it is done, in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms: Option<u64>,
    /// Why it failed, when it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    /// The response's body, with `bodies` and `browser.network`, cut at 100,000
    /// characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// `browser_network`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requests {
    /// The requests, oldest first; the last 500 at most.
    pub requests: Vec<Request>,
    /// What to pass as `since` next time.
    pub next: u64,
}

/// `browser_evaluate`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evaluated {
    /// What the expression came to, as JSON.
    pub value: Value,
}

/// Where a download has got to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    /// On its way.
    Going,
    /// In the folder.
    Done,
    /// It stopped, and there is no file.
    Failed,
    /// Past 500 MB, and stopped.
    TooLarge,
}

/// One file an agent's tab downloaded.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Download {
    /// The tab that fetched it.
    pub tab: TabId,
    /// Where from.
    pub url: String,
    /// Where it is, in `Downloads/nib agents/<agent>`.
    pub path: String,
    /// How far along it is.
    pub state: DownloadState,
}

/// `browser_downloads`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadList {
    /// Oldest first.
    pub downloads: Vec<Download>,
}

/// `browser_storage`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    /// The cookies, for `cookies`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Cookie>>,
    /// The page's `localStorage`, for `local`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<serde_json::Map<String, Value>>,
}

/// `browser_close`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Closed {
    /// The tab that is gone.
    pub tab: TabId,
}

/// What a question is about (9.3), and the questions nib asks for itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    /// A card field, a press that reads as paying, a payment processor.
    Paying,
    /// Send, post, reply, publish or submit on a mail, messaging or social site.
    Sending,
    /// Anything in nib that puts words where somebody else can read them.
    Publishing,
    /// Delete, remove, erase: for good.
    Deleting,
    /// A password field or a sign-in form, which is a takeover.
    SigningIn,
    /// `write_setting`.
    Settings,
    /// A command not on the agent's list.
    Terminal,
    /// A file from outside every space handed to a page.
    Files,
    /// Any write, in `confirm` mode.
    Writing,
    /// An agent tab made a tab of the reader's (6.7).
    Showing,
    /// The reader asked to do one step (7.3).
    Takeover,
    /// A client asking to become an agent (9.1).
    Pairing,
}

/// Where a question has got to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalAnswer {
    /// Nobody has answered yet.
    Pending,
    /// Allowed: the agent calls again and it goes through.
    Allowed,
    /// Refused.
    Denied,
    /// Unanswered for a day.
    Expired,
    /// A step the reader said they did.
    Done,
}

/// A question the reader is asked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    /// Its id, `a17`.
    pub id: String,
    /// The agent asking, by id.
    pub agent: String,
    /// The agent's name.
    pub name: String,
    /// What it is about.
    pub category: Category,
    /// One line: `Place order on shop.example`.
    pub summary: String,
    /// The site, when a page is what it is about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    /// The tab, when a page is what it is about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<TabId>,
    /// The verb whose call asked, so the AI sidebar finds the call it is about.
    #[serde(default)]
    pub verb: String,
    /// When it was asked, in milliseconds since 1970.
    pub asked: u64,
    /// Where it has got to.
    pub answer: ApprovalAnswer,
}

/// `approval_status`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalState {
    /// The question.
    pub approval: Approval,
}

/// `agent_status`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Status {
    /// The grant, as the settings pane shows it.
    pub grant: super::grants::Grant,
    /// Whether the reader stopped it: everybody, or this agent alone.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stopped: bool,
    /// Its own tabs.
    pub tabs: Vec<AgentTab>,
    /// Its questions nobody has answered yet.
    pub approvals: Vec<Approval>,
}

/// `agent_pair`, once the reader allowed it. The token is said once and kept by the
/// client; nib keeps only its hash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Paired {
    /// The agent's id.
    pub agent: String,
    /// Its token.
    pub token: String,
}

// ---------------------------------------------------------------------------------------
// What the window hears.
// ---------------------------------------------------------------------------------------

/// News from the crate, on `EVENT`. The activity panel is built against exactly these.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    /// An agent is acting in a tab now: the reader's tab wears the mark and the frame.
    Acting {
        /// The agent.
        agent: String,
        /// The tab.
        tab: TabId,
        /// The verb.
        verb: String,
    },
    /// One agent stopped on its own.
    Paused {
        /// The agent.
        agent: String,
    },
    /// The stop lifted: one agent's, or everybody's when the agent is empty.
    Resumed {
        /// The agent.
        agent: String,
    },
    /// A question for the reader.
    Asked {
        /// The question.
        approval: Approval,
    },
    /// A question answered, or expired.
    Answered {
        /// The question, with its answer.
        approval: Approval,
    },
    /// An agent tab opened, or moved, or was renamed by its page.
    Tab {
        /// The agent.
        agent: String,
        /// The tab.
        id: TabId,
        /// Where it is.
        url: String,
        /// What it calls itself.
        title: String,
    },
    /// An agent tab closed.
    Closed {
        /// The agent.
        agent: String,
        /// The tab.
        id: TabId,
    },
    /// The stop was pressed: every call cancelled and every agent paused, and on the
    /// second press every agent tab closed.
    Stopped {
        /// Whether the tabs were closed too.
        closed: bool,
    },
    /// Which agents are connected now: those that called in the last ten minutes and
    /// did not say goodbye. Said whenever the list changes; see shell.rs.
    Connected {
        /// Their ids.
        agents: Vec<String>,
    },
}

// ---------------------------------------------------------------------------------------
// What the crate asks the window.
// ---------------------------------------------------------------------------------------

/// The window's verbs the crate asks on the agents' behalf, through the endpoint's own
/// road (`nib://automation`). Each is answered by the window's dispatcher; when it is
/// not (an older window, or no window at all) the crate answers from what it knows.
pub mod window {
    use serde::{Deserialize, Serialize};

    use crate::agents::grants::Scope;

    /// The window's verbs an agent may call (sections 5.1, 5.3, 5.4), with the scope
    /// each needs at the least. The crate refuses anything else from an agent before the
    /// window hears it: the command line's own verbs (`files.write`, `eval`) predate
    /// agents and check nothing about them. The window checks the rest - spaces, which
    /// op, what asks - with the grant it is handed alongside.
    pub const AGENT_VERBS: &[(&str, Option<Scope>)] = &[
        ("get_context", Some(Scope::Context)),
        ("list_spaces", None),
        ("list_notes", Some(Scope::NotesRead)),
        ("search_notes", Some(Scope::NotesRead)),
        ("list_backlinks", Some(Scope::NotesRead)),
        ("read_note", Some(Scope::NotesRead)),
        ("list_versions", Some(Scope::NotesRead)),
        ("read_canvas", Some(Scope::NotesRead)),
        ("read_pdf", Some(Scope::NotesRead)),
        ("pdf_highlights", Some(Scope::NotesRead)),
        ("edit_note", Some(Scope::NotesWrite)),
        ("write_note", Some(Scope::NotesWrite)),
        ("append_note", Some(Scope::NotesWrite)),
        ("set_property", Some(Scope::NotesWrite)),
        ("set_task", Some(Scope::NotesWrite)),
        ("list_tasks", Some(Scope::NotesRead)),
        ("add_task", Some(Scope::NotesWrite)),
        ("update_task", Some(Scope::NotesWrite)),
        ("query_base", Some(Scope::NotesRead)),
        ("add_row", Some(Scope::NotesWrite)),
        ("edit_rows", Some(Scope::NotesWrite)),
        ("edit_base", Some(Scope::NotesWrite)),
        ("create_note", Some(Scope::NotesWrite)),
        ("restore_version", Some(Scope::NotesWrite)),
        ("edit_canvas", Some(Scope::NotesWrite)),
        ("capture_to_note", Some(Scope::NotesWrite)),
        ("attach_agent_log", Some(Scope::NotesWrite)),
        ("move_file", Some(Scope::Tree)),
        ("trash_file", Some(Scope::Tree)),
        ("create_folder", Some(Scope::Tree)),
        ("workspace_tabs", Some(Scope::Workspace)),
        ("bookmarks", Some(Scope::Workspace)),
        ("run_command", Some(Scope::Workspace)),
        ("read_setting", None),
        ("write_setting", Some(Scope::Settings)),
        ("run_terminal", Some(Scope::Terminal)),
        ("read_terminal", Some(Scope::Context)),
        ("type_terminal", Some(Scope::Terminal)),
        ("recently_deleted", Some(Scope::Tree)),
    ];

    /// The reader's web tabs, of every space's set, with what only the window knows
    /// about them: which space, whether in front, whether on screen. Answers
    /// `Vec<super::ReaderTab>`.
    pub const READER_TABS: &str = "agent.reader_tabs";

    /// A reader's tab lent to an agent: its page built if it has none (parked, or never
    /// shown since a launch) and kept running out of sight - shown to the engine, outside
    /// the window - while it is not on screen, until the agent's mark on it lapses. Takes
    /// `Lend`, answers once the page is there.
    pub const LEND: &str = "agent.lend";

    /// `LEND`'s arguments.
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Lend {
        /// The reader's tab.
        pub tab: String,
    }

    /// Which store the reader's tabs of a space use for an address, as `web-data.ts`
    /// decides. Takes `StoreAsk`, answers `StoreSaid`.
    pub const STORE_FOR: &str = "agent.store_for";

    /// A page's HTML as markdown, through the clipper's own converter
    /// (`@nib/markdown/from-html`). Takes `Convert`, answers a string.
    pub const MARKDOWN: &str = "agent.markdown";

    /// `STORE_FOR`'s arguments.
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct StoreAsk {
        /// The space; the open one when there is none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space: Option<String>,
        /// The address the tab is for.
        pub url: String,
    }

    /// `STORE_FOR`'s answer.
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct StoreSaid {
        /// The space it answered for.
        pub space: String,
        /// The store: `None` for the one every space shares, `space_<id>` or
        /// `site_<id>_<site>`; see `web_stores.rs`.
        #[serde(default)]
        pub store: Option<String>,
    }

    /// `MARKDOWN`'s arguments.
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Convert {
        /// The page's HTML, links already absolute.
        pub html: String,
        /// The page's address.
        pub url: String,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The window answers an agent's verb in the contract's shape with `ok` beside it
    /// (automation/caller.ts `AgentAnswer`), and the command line's verbs as `{ok,
    /// value}`: the log files each by what it says, not by whether it says `ok`.
    #[test]
    fn a_window_answer_is_read_by_its_status() {
        let read = Answer::from_window;
        assert_eq!(
            read(r#"{"ok":true,"status":"ok","result":{"path":"a.md"}}"#).status(),
            "ok"
        );
        assert_eq!(
            read(
                r#"{"ok":true,"status":"needs_approval","approval":"a17","summary":"Publish Notes"}"#
            ),
            Answer::NeedsApproval {
                approval: "a17".into(),
                summary: "Publish Notes".into(),
            }
        );
        assert!(matches!(
            read(r#"{"ok":false,"status":"error","code":"not_granted","message":"no","error":"no"}"#),
            Answer::Error { code: Code::NotGranted, ref message, .. } if message == "no"
        ));
        // A code the contract does not have is a failure, in the window's words.
        assert!(matches!(
            read(r#"{"ok":false,"status":"error","code":"nope","message":"why"}"#),
            Answer::Error { code: Code::Failed, ref message, .. } if message == "why"
        ));
        // The command line's own shape, which has no status.
        assert_eq!(read(r#"{"ok":true,"value":3}"#).status(), "ok");
        assert!(matches!(
            read(r#"{"ok":false,"error":"gone"}"#),
            Answer::Error { code: Code::Failed, ref message, .. } if message == "gone"
        ));
        // Words that only hold `"ok":true` are no ok, and nothing readable is a failure.
        assert_eq!(
            read(r#"{"ok":false,"status":"error","code":"failed","message":"\"ok\":true"}"#)
                .status(),
            "error"
        );
        assert_eq!(read("not json").status(), "error");
    }

    /// Every name in the table reads back as the verb it names, and there is no name
    /// twice.
    #[test]
    fn every_name_is_its_own_verb() {
        let mut seen = std::collections::HashSet::new();
        for name in NAMES {
            assert!(seen.insert(*name), "{name} is in the table twice");
            assert!(Verb::read(name, json!({})).is_some(), "{name} is not read");
        }
        assert_eq!(NAMES.len(), ANSWERS.len());
    }

    #[test]
    fn a_name_that_is_not_a_browser_verb_is_the_windows() {
        assert!(Verb::read("files.read", json!({})).is_none());
        assert!(Verb::read("eval", json!({})).is_none());
    }

    #[test]
    fn a_verb_that_takes_nothing_may_be_sent_nothing() {
        assert_eq!(
            Verb::read("browser_tabs", Value::Null),
            Some(Ok(Verb::Tabs(Nothing {})))
        );
    }

    #[test]
    fn arguments_it_does_not_take_are_refused() {
        let read = Verb::read("browser_click", json!({ "tab": "a1", "reff": "e2" }));
        assert!(matches!(read, Some(Err(_))));
    }

    #[test]
    fn a_click_reads_its_ref_and_its_defaults() {
        let read = Verb::read("browser_click", json!({ "tab": "a1", "ref": "f2e17" }));
        let Some(Ok(Verb::Click(click))) = read else {
            panic!("{read:?}");
        };
        assert_eq!(click.element, "f2e17");
        assert_eq!(click.button, Button::Left);
        assert!(click.modifiers.is_empty());
    }

    #[test]
    fn a_wait_is_a_word_or_one_of_three_shapes() {
        let read =
            |until: Value| match Verb::read("browser_wait", json!({ "tab": "a1", "for": until })) {
                Some(Ok(Verb::Wait(wait))) => wait.until,
                other => panic!("{other:?}"),
            };
        assert_eq!(read(json!("load")), Until::Moment(Moment::Load));
        assert_eq!(
            read(json!("network_idle")),
            Until::Moment(Moment::NetworkIdle)
        );
        assert_eq!(
            read(json!({ "text": "Saved" })),
            Until::Text {
                text: "Saved".into()
            }
        );
        assert_eq!(
            read(json!({ "ref": "e4" })),
            Until::Element {
                element: "e4".into()
            }
        );
        assert_eq!(
            read(json!({ "url": "/done" })),
            Until::Url {
                url: "/done".into()
            }
        );
    }

    #[test]
    fn a_field_is_ticked_or_words_or_options() {
        let fields: Vec<Field> = serde_json::from_value(json!([
            { "ref": "e1", "value": true },
            { "ref": "e2", "value": "Ada" },
            { "ref": "e3", "value": ["a", "b"] },
        ]))
        .expect("fields");
        assert_eq!(fields[0].value, FieldValue::Ticked(true));
        assert_eq!(fields[1].value, FieldValue::Words("Ada".into()));
        assert_eq!(
            fields[2].value,
            FieldValue::Options(vec!["a".into(), "b".into()])
        );
    }

    /// The shape of 9.3's example, to the byte.
    #[test]
    fn a_question_answers_at_once_in_the_documents_shape() {
        let asked = Answer::NeedsApproval {
            approval: "a17".into(),
            summary: "Place order on shop.example".into(),
        };
        assert_eq!(
            serde_json::to_value(&asked).expect("json"),
            json!({ "status": "needs_approval", "approval": "a17", "summary": "Place order on shop.example" })
        );
    }

    #[test]
    fn an_error_says_its_code_and_any_dialog() {
        let dialog = Dialog {
            kind: DialogKind::Confirm,
            message: "Delete this?".into(),
            default_text: None,
            url: "https://shop.example/".into(),
            open_ms: 12,
        };
        let said =
            Answer::error(Code::Stopped, "the reader pressed the stop").with_dialog(Some(dialog));
        assert_eq!(
            serde_json::to_value(&said).expect("json"),
            json!({
                "status": "error",
                "code": "stopped",
                "message": "the reader pressed the stop",
                "dialog": { "kind": "confirm", "message": "Delete this?", "url": "https://shop.example/", "open_ms": 12 },
            })
        );
    }

    #[test]
    fn an_event_says_its_kind() {
        let event = Event::Paused {
            agent: "claude-code".into(),
        };
        assert_eq!(
            serde_json::to_value(&event).expect("json"),
            json!({ "kind": "paused", "agent": "claude-code" })
        );
        assert_eq!(
            serde_json::to_value(Event::Stopped { closed: false }).expect("json"),
            json!({ "kind": "stopped", "closed": false })
        );
    }
}
