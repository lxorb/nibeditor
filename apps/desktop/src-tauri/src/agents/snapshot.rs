//! A page's accessibility tree as the lines an agent reads (docs/agent-native.md 5.2).
//!
//! The shape is Playwright MCP's, which agents are trained on - one element a line,
//! indented under its parent, `- button "Save" [ref=e4812]` - with the states Chrome
//! `DevTools` MCP writes (`[checked]`, `[disabled]`, `[expanded]`, `[level=2]`,
//! `[value="..."]`, a link's `[url=...]`). What differs is the ref: it is the engine's
//! own node id (`backendDOMNodeId`), not a counter, so it stays good for as long as the
//! element lives rather than until the next snapshot; `f2e17` is node 17 inside the
//! second frame that runs in a process of its own.
//!
//! What is left out, because it is noise to a reader of the page: containers that say
//! nothing (`generic`, `none`) give their children to their parent; the engine's text
//! boxes and line breaks; a text node that only repeats its parent's name.
//!
//! **A secret field says only whether it is filled** (9.4): a password, a one-time code,
//! a card's number or code is one line, `- textbox "Password" [filled] [ref=e137]`, with
//! no value and nothing under it. The engine writes a password's value as one bullet a
//! character, and again as the words inside the field, so either would say how long it
//! is; and a name the engine builds out of a field's value (a label that holds the field,
//! an `aria-labelledby` that points at it) is written with that value taken out. Which
//! fields are secret is `policy::secret`, asked of the page; a field whose value is
//! nothing but the engine's mask is one whatever the page said, which covers a frame the
//! page's own scan could not reach.
//!
//! Pure: it reads the protocol's JSON and writes text, so the tests run on trees recorded
//! from real pages.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use serde_json::Value;

use super::verbs::Match;

/// The longest name written on a line, in characters.
const LONGEST_NAME: usize = 160;

/// The shortest secret value taken out of other names: a shorter one would take ordinary
/// words and digits out of the page with it, and says next to nothing.
const SHORTEST_ECHO: usize = 3;

/// The longest snapshot when none is asked for, in characters.
pub const MOST: usize = 40_000;

/// One document's tree: the page's own, a frame in the same process, or a frame in a
/// process of its own.
pub struct Part {
    /// What its refs start with: empty for the page's own session, `f2` for the second
    /// frame in a process of its own. Same-process frames share the page's.
    pub prefix: String,
    /// The protocol's nodes, as `Accessibility.getFullAXTree` answered them.
    pub nodes: Vec<Value>,
    /// The frame element it hangs under: the part it is in, and that element's node.
    pub owner: Option<(usize, u64)>,
}

/// A tree written out.
pub struct Written {
    /// The lines.
    pub text: String,
    /// Whether it was cut.
    pub truncated: bool,
}

/// What `render` is asked for.
pub struct Asked<'a> {
    /// Only under this element: its part's prefix and its node.
    pub under: Option<(&'a str, u64)>,
    /// The longest answer.
    pub most: usize,
    /// The secret fields, by part prefix and node: neither their values nor anything
    /// under them is written, only whether they are filled.
    pub secret: &'a HashSet<(String, u64)>,
    /// The page's origin, which a link's address is written relative to.
    pub origin: &'a str,
}

/// One node, read.
struct Node<'a> {
    raw: &'a Value,
}

impl<'a> Node<'a> {
    fn ignored(&self) -> bool {
        self.raw.get("ignored").and_then(Value::as_bool) == Some(true)
    }

    fn role(&self) -> String {
        let raw = self
            .raw
            .pointer("/role/value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        spoken_role(raw)
    }

    fn name(&self) -> &'a str {
        self.raw
            .pointer("/name/value")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    fn value(&self) -> Option<String> {
        match self.raw.pointer("/value/value")? {
            Value::String(text) => Some(text.clone()),
            Value::Null => None,
            other => Some(other.to_string()),
        }
    }

    fn backend(&self) -> Option<u64> {
        self.raw.get("backendDOMNodeId").and_then(Value::as_u64)
    }

    fn children(&self) -> Vec<&'a str> {
        self.raw
            .get("childIds")
            .and_then(Value::as_array)
            .map(|ids| ids.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    }

    fn property(&self, name: &str) -> Option<&'a Value> {
        self.raw
            .get("properties")?
            .as_array()?
            .iter()
            .find(|one| one.get("name").and_then(Value::as_str) == Some(name))?
            .pointer("/value/value")
    }
}

/// A role as the agent reads it: the protocol's own words, but `document`, `iframe`,
/// `text` and `label` for the four it spells as internal names.
fn spoken_role(raw: &str) -> String {
    match raw {
        "RootWebArea" | "WebArea" => "document".into(),
        "Iframe" | "IframePresentational" => "iframe".into(),
        "StaticText" => "text".into(),
        "LabelText" => "label".into(),
        "" => "generic".into(),
        other => {
            let mut chars = other.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_lowercase().chain(chars).collect()
            })
        }
    }
}

/// Whether a role only holds other things and says nothing itself.
fn silent(role: &str, name: &str) -> bool {
    matches!(
        role,
        "generic" | "none" | "presentation" | "genericContainer"
    ) && name.is_empty()
}

/// Whether a role is the engine's own furniture, never worth a line.
fn furniture(role: &str) -> bool {
    matches!(role, "inlineTextBox" | "lineBreak")
}

/// Roles whose insides are the engine's own: a date field's day, month and year and its
/// "Show date picker" button, a colour well's swatch. The field is one line with its
/// value, and nothing inside it has a ref, because pressing the picker's button would
/// open a window of the engine's own (6.5).
fn sealed(role: &str) -> bool {
    matches!(
        role,
        "date" | "dateTime" | "inputTime" | "time" | "colorWell" | "month" | "week"
    )
}

/// Roles a person presses or types into, which words inside them stand for.
fn pressable_role(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "link"
            | "menuitem"
            | "menuItem"
            | "tab"
            | "checkbox"
            | "radio"
            | "switch"
            | "option"
            | "textbox"
            | "combobox"
            | "treeitem"
            | "cell"
            | "row"
            | "listitem"
            | "heading"
            | "label"
    )
}

/// Roles whose value is what somebody typed or chose.
fn has_value(role: &str) -> bool {
    matches!(
        role,
        "textbox"
            | "searchbox"
            | "combobox"
            | "spinbutton"
            | "slider"
            | "textField"
            | "date"
            | "dateTime"
            | "inputTime"
            | "time"
            | "colorWell"
    )
}

/// A name on one line, quoted, and cut.
fn quoted(name: &str) -> String {
    let flat: String = name
        .chars()
        .map(|one| if one.is_control() { ' ' } else { one })
        .collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut = match flat.char_indices().nth(LONGEST_NAME) {
        Some((at, _)) => format!("{}\u{2026}", &flat[..at]),
        None => flat,
    };
    format!("\"{}\"", cut.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A link's address, relative to the page's origin when it is on it.
fn short_url(url: &str, origin: &str) -> String {
    match url.strip_prefix(origin) {
        Some(rest) if rest.starts_with('/') => rest.to_string(),
        _ => url.to_string(),
    }
}

/// The states worth a word, in the order they are written; the value is `value_of`'s.
fn states(node: &Node<'_>, role: &str, origin: &str) -> String {
    let mut out = String::new();
    let on = |name: &str| node.property(name).and_then(Value::as_bool) == Some(true);
    if on("focused") {
        out.push_str(" [focused]");
    }
    if on("disabled") {
        out.push_str(" [disabled]");
    }
    match node.property("checked").and_then(Value::as_str) {
        Some("true") => out.push_str(" [checked]"),
        Some("mixed") => out.push_str(" [checked=mixed]"),
        _ => {}
    }
    match node.property("pressed").and_then(Value::as_str) {
        Some("true") => out.push_str(" [pressed]"),
        Some("mixed") => out.push_str(" [pressed=mixed]"),
        _ => {}
    }
    match node.property("expanded").and_then(Value::as_bool) {
        Some(true) => out.push_str(" [expanded]"),
        Some(false) => out.push_str(" [expanded=false]"),
        None => {}
    }
    if on("selected") {
        out.push_str(" [selected]");
    }
    if on("required") {
        out.push_str(" [required]");
    }
    if on("readonly") {
        out.push_str(" [readonly]");
    }
    if node
        .property("invalid")
        .and_then(Value::as_str)
        .is_some_and(|one| one != "false")
    {
        out.push_str(" [invalid]");
    }
    if let Some(level) = node.property("level").and_then(Value::as_u64) {
        let _ = write!(out, " [level={level}]");
    }
    if role == "link" {
        if let Some(url) = node.property("url").and_then(Value::as_str) {
            let _ = write!(out, " [url={}]", short_url(url, origin));
        }
    }
    out
}

/// A field's value as its line writes it: a secret's only as whether it is filled.
fn value_of(node: &Node<'_>, role: &str, secret: bool, forest: &Forest<'_>) -> String {
    if !has_value(role) {
        return String::new();
    }
    let Some(value) = node.value().filter(|one| !one.is_empty()) else {
        return String::new();
    };
    if secret {
        return " [filled]".into();
    }
    let value = forest.scrubbed(&value);
    if value.trim().is_empty() {
        String::new()
    } else {
        format!(" [value={}]", quoted(&value))
    }
}

/// Whether a value is the engine's own mask over a secret: nothing but bullets.
fn masked(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|one| matches!(one, '\u{2022}' | '\u{25cf}' | '*' | '\u{b7}'))
}

/// A tree of parts, indexed for walking.
struct Forest<'a> {
    parts: &'a [Part],
    by_id: Vec<HashMap<&'a str, &'a Value>>,
    /// Which part hangs under which frame element: (part, node) to the part's index.
    hung: HashMap<(usize, u64), usize>,
    /// The secret fields the page named.
    secret: &'a HashSet<(String, u64)>,
    /// The secret fields' values, as they would read inside another element's name.
    echoes: Vec<String>,
}

impl<'a> Forest<'a> {
    fn new(parts: &'a [Part], secret: &'a HashSet<(String, u64)>) -> Self {
        let by_id = parts
            .iter()
            .map(|part| {
                part.nodes
                    .iter()
                    .filter_map(|node| Some((node.get("nodeId")?.as_str()?, node)))
                    .collect()
            })
            .collect();
        let hung = parts
            .iter()
            .enumerate()
            .filter_map(|(at, part)| part.owner.map(|owner| (owner, at)))
            .collect();
        let mut forest = Forest {
            parts,
            by_id,
            hung,
            secret,
            echoes: Vec::new(),
        };
        let mut echoes: Vec<String> = parts
            .iter()
            .enumerate()
            .flat_map(|(at, part)| part.nodes.iter().map(move |raw| (at, Node { raw })))
            .filter(|(at, node)| forest.secret(*at, node))
            .filter_map(|(_, node)| node.value())
            .filter(|value| value.trim().chars().count() >= SHORTEST_ECHO)
            .collect();
        // The longest first, so a value inside another is not taken out of it first.
        echoes.sort_by_key(|one| std::cmp::Reverse(one.len()));
        echoes.dedup();
        forest.echoes = echoes;
        forest
    }

    /// Whether a node is a secret field: one the page named, or one whose value is
    /// nothing but the engine's mask.
    fn secret(&self, part: usize, node: &Node<'_>) -> bool {
        let named = node.backend().is_some_and(|backend| {
            self.parts
                .get(part)
                .is_some_and(|one| self.secret.contains(&(one.prefix.clone(), backend)))
        });
        named || node.value().is_some_and(|value| masked(&value))
    }

    /// Words with every secret's value taken out of them.
    fn scrubbed<'n>(&self, words: &'n str) -> Cow<'n, str> {
        let mut out = Cow::Borrowed(words);
        for echo in &self.echoes {
            if out.contains(echo.as_str()) {
                out = Cow::Owned(out.replace(echo.as_str(), ""));
            }
        }
        out
    }

    fn root(&self, part: usize) -> Option<&'a Value> {
        let nodes = &self.parts.get(part)?.nodes;
        nodes
            .iter()
            .find(|node| node.get("parentId").is_none())
            .or_else(|| nodes.first())
    }

    fn child(&self, part: usize, id: &str) -> Option<&'a Value> {
        self.by_id.get(part)?.get(id).copied()
    }

    /// The node for a backend id in a part.
    fn backend(&self, part: usize, backend: u64) -> Option<&'a Value> {
        self.parts
            .get(part)?
            .nodes
            .iter()
            .find(|node| node.get("backendDOMNodeId").and_then(Value::as_u64) == Some(backend))
    }
}

/// Writes the tree out.
pub fn render(parts: &[Part], asked: &Asked<'_>) -> Written {
    let forest = Forest::new(parts, asked.secret);
    let mut writer = Writer {
        text: String::new(),
        most: asked.most,
        truncated: false,
        origin: asked.origin,
    };

    let start = match asked.under {
        Some((prefix, backend)) => parts
            .iter()
            .position(|part| part.prefix == prefix)
            .and_then(|part| Some((part, forest.backend(part, backend)?))),
        None => forest.root(0).map(|root| (0, root)),
    };
    if let Some((part, node)) = start {
        let skip_root = asked.under.is_none();
        writer.walk(
            &forest,
            part,
            node,
            &Around {
                depth: 0,
                skip: skip_root,
                said: &[],
                in_list: false,
            },
        );
    }
    if writer.truncated {
        let _ = write!(
            writer.text,
            "- \u{2026} cut at {} characters: ask for one part with its ref",
            asked.most
        );
    }
    Written {
        text: writer.text.trim_end().to_string(),
        truncated: writer.truncated,
    }
}

/// Whether a part of the page holds a node, for a ref an agent passed.
pub fn holds(parts: &[Part], prefix: &str, backend: u64) -> bool {
    let none = HashSet::new();
    let forest = Forest::new(parts, &none);
    parts
        .iter()
        .position(|part| part.prefix == prefix)
        .is_some_and(|part| forest.backend(part, backend).is_some())
}

struct Writer<'a> {
    text: String,
    most: usize,
    truncated: bool,
    origin: &'a str,
}

/// Where a node is being written: how deep, and what around it already says.
struct Around<'a> {
    depth: usize,
    /// The root of a frame's document, which its frame element already stands for.
    skip: bool,
    /// The names a text node would only repeat: its parent's, and its siblings'.
    said: &'a [String],
    /// Inside a `<select>`: its options are chosen with `browser_select`, never pressed.
    in_list: bool,
}

impl Writer<'_> {
    fn walk(&mut self, forest: &Forest<'_>, part: usize, raw: &Value, around: &Around<'_>) {
        if self.truncated {
            return;
        }
        let node = Node { raw };
        let role = node.role();
        let name = forest.scrubbed(node.name());
        let name = name.as_ref();
        let prefix = &forest.parts[part].prefix;
        let secret = forest.secret(part, &node);
        let mut inner = around.depth;

        let repeats = |text: &str| around.said.iter().any(|one| one == text.trim());
        let quiet = around.skip
            || node.ignored()
            || silent(&role, name)
            || furniture(&role)
            || role == "menuListPopup"
            || (role == "label" && name.is_empty())
            || (role == "text" && (name.trim().is_empty() || repeats(name)));
        if !quiet {
            let mut line = format!("{}- {role}", "  ".repeat(around.depth));
            if !name.trim().is_empty() {
                line.push(' ');
                line.push_str(&quoted(name));
            }
            line.push_str(&states(&node, &role, self.origin));
            line.push_str(&value_of(&node, &role, secret, forest));
            // Words on their own have a ref too: a `<div>` with a listener and no role is
            // still somewhere a person presses, and its words are how an agent names it.
            let pressable = !(around.in_list && role == "option");
            if let Some(backend) = node.backend().filter(|_| pressable) {
                let _ = write!(line, " [ref={prefix}e{backend}]");
            }
            line.push('\n');
            if self.text.len() + line.len() > self.most {
                self.truncated = true;
                return;
            }
            self.text.push_str(&line);
            inner = around.depth + 1;
        }

        // Nothing under a secret field is written: the engine's words inside a password
        // field are its bullets.
        if sealed(&role) || secret {
            return;
        }
        // What the children would only repeat: this node's name, and every name a
        // sibling of theirs already says (a label's words beside the field they name).
        let children: Vec<&Value> = node
            .children()
            .into_iter()
            .filter_map(|id| forest.child(part, id))
            .collect();
        let mut said: Vec<String> = if quiet {
            around.said.to_vec()
        } else {
            vec![name.trim().to_string()]
        };
        said.extend(children.iter().filter_map(|child| {
            let child = Node { raw: child };
            let named = forest.scrubbed(child.name());
            (child.role() != "text" && !named.trim().is_empty()).then(|| named.trim().to_string())
        }));
        let within = Around {
            depth: inner,
            skip: false,
            said: &said,
            in_list: around.in_list || role == "combobox" || role == "listBox",
        };
        for child in children {
            self.walk(forest, part, child, &within);
        }
        // A frame's document hangs under the frame element.
        if let Some(backend) = node.backend() {
            if let Some(&under) = forest.hung.get(&(part, backend)) {
                if let Some(root) = forest.root(under) {
                    let framed = Around {
                        depth: inner,
                        skip: true,
                        said: &[],
                        in_list: false,
                    };
                    self.walk(forest, under, root, &framed);
                }
            }
        }
    }
}

/// What `find` is asked for.
pub struct Wanted<'a> {
    /// Words in the element's name or text, lower case.
    pub text: Option<&'a str>,
    /// Its role, lower case.
    pub role: Option<&'a str>,
    /// Words in its name, lower case.
    pub name: Option<&'a str>,
}

/// The elements that match: by role and name, or by words in their name or text.
/// Named elements only, each once, in the page's order; never anything inside a secret
/// field, and no name with a secret's value in it.
pub fn find(parts: &[Part], secret: &HashSet<(String, u64)>, wanted: &Wanted<'_>) -> Vec<Match> {
    let forest = Forest::new(parts, secret);
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    if let Some(root) = forest.root(0) {
        search(&forest, 0, root, None, wanted, &mut (&mut found, &mut seen));
    }
    found
}

/// The nearest element above a text node that an agent can name: its ref, role and name.
type Holder = (String, String, String);

/// What `search` fills: the matches, and the refs already in them.
type Found<'a> = (&'a mut Vec<Match>, &'a mut HashSet<String>);

fn search(
    forest: &Forest<'_>,
    part: usize,
    raw: &Value,
    holder: Option<&Holder>,
    wanted: &Wanted<'_>,
    found: &mut Found<'_>,
) {
    let node = Node { raw };
    let role = node.role();
    let name = forest.scrubbed(node.name());
    let name = name.trim();
    let prefix = &forest.parts[part].prefix;
    let reference = node.backend().map(|backend| format!("{prefix}e{backend}"));
    let lower = name.to_lowercase();

    let mut push = |element: &str, role: &str, name: &str| {
        if found.1.insert(element.to_string()) {
            found.0.push(Match {
                element: element.to_string(),
                role: role.to_string(),
                name: name.to_string(),
            });
        }
    };

    let visible = !node.ignored() && !silent(&role, name) && !furniture(&role);
    if visible {
        if role == "text" {
            // Words found: the control they are the words of, or the words themselves when
            // they belong to nothing an agent would name (a `<div>` with a listener).
            if wanted.text.is_some_and(|text| lower.contains(text)) {
                match holder {
                    Some((element, role, name))
                        if pressable_role(role)
                            && wanted.role.is_none_or(|one| one == role.to_lowercase()) =>
                    {
                        push(element, role, name);
                    }
                    _ => {
                        if let (Some(element), None) = (&reference, wanted.role) {
                            push(element, "text", name.trim());
                        }
                    }
                }
            }
        } else if let Some(element) = &reference {
            let by_text = wanted.text.is_none_or(|text| lower.contains(text));
            let by_role = wanted.role.is_none_or(|one| one == role.to_lowercase());
            let by_name = wanted.name.is_none_or(|one| lower.contains(one));
            if by_text && by_role && by_name && !name.is_empty() && role != "document" {
                push(element, &role, name);
            }
        }
    }

    let here: Option<Holder> = match (&reference, visible && role != "text") {
        (Some(element), true) => Some((element.clone(), role.clone(), name.to_string())),
        _ => None,
    };
    let holding = here.as_ref().or(holder);
    if sealed(&role) || forest.secret(part, &node) {
        return;
    }
    for id in node.children() {
        if let Some(child) = forest.child(part, id) {
            search(forest, part, child, holding, wanted, found);
        }
    }
    if let Some(backend) = node.backend() {
        if let Some(&under) = forest.hung.get(&(part, backend)) {
            if let Some(root) = forest.root(under) {
                search(forest, under, root, None, wanted, found);
            }
        }
    }
}

/// A ref, read: the frame's number (`None` for the page's own session) and the node.
pub fn parse_ref(reference: &str) -> Option<(Option<usize>, u64)> {
    let reference = reference.trim();
    if let Some(rest) = reference.strip_prefix('f') {
        let (frame, node) = rest.split_once('e')?;
        let frame = frame.parse::<usize>().ok().filter(|one| *one > 0)?;
        return Some((Some(frame), node.parse().ok()?));
    }
    Some((None, reference.strip_prefix('e')?.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, role: &str, name: &str, backend: u64, children: &[&str]) -> Value {
        json!({
            "nodeId": id,
            "ignored": false,
            "role": { "type": "role", "value": role },
            "name": { "type": "computedString", "value": name },
            "backendDOMNodeId": backend,
            "childIds": children,
        })
    }

    fn with(mut raw: Value, key: &str, value: Value) -> Value {
        raw[key] = value;
        raw
    }

    fn page() -> Vec<Value> {
        vec![
            node("1", "RootWebArea", "Shop", 1, &["2"]),
            with(
                node("2", "generic", "", 2, &["3", "5", "7", "9", "11", "13"]),
                "parentId",
                json!("1"),
            ),
            with(
                node("3", "heading", "Basket", 3, &["4"]),
                "parentId",
                json!("2"),
            ),
            with(
                node("4", "StaticText", "Basket", 4, &[]),
                "parentId",
                json!("3"),
            ),
            with(
                with(
                    node("5", "textbox", "Card number", 5, &[]),
                    "parentId",
                    json!("2"),
                ),
                "value",
                json!({ "type": "string", "value": "4242 4242" }),
            ),
            with(
                with(
                    node("7", "checkbox", "Keep me", 7, &[]),
                    "parentId",
                    json!("2"),
                ),
                "properties",
                json!([{ "name": "checked", "value": { "type": "tristate", "value": "true" } }]),
            ),
            with(
                with(
                    node("9", "link", "Help", 9, &["10"]),
                    "parentId",
                    json!("2"),
                ),
                "properties",
                json!([{ "name": "url", "value": { "type": "string", "value": "https://shop.example/help" } }]),
            ),
            with(
                node("10", "StaticText", "Help", 10, &[]),
                "parentId",
                json!("9"),
            ),
            with(
                with(
                    node("11", "textbox", "Password", 11, &[]),
                    "parentId",
                    json!("2"),
                ),
                "value",
                json!({ "type": "string", "value": "hunter2" }),
            ),
            with(node("13", "Iframe", "", 13, &[]), "parentId", json!("2")),
        ]
    }

    fn frame() -> Vec<Value> {
        vec![
            node("1", "RootWebArea", "Pay", 1, &["2"]),
            with(
                node("2", "button", "Pay now", 20, &["3"]),
                "parentId",
                json!("1"),
            ),
            with(
                node("3", "StaticText", "Pay now", 21, &[]),
                "parentId",
                json!("2"),
            ),
        ]
    }

    fn parts() -> Vec<Part> {
        vec![
            Part {
                prefix: String::new(),
                nodes: page(),
                owner: None,
            },
            Part {
                prefix: "f1".into(),
                nodes: frame(),
                owner: Some((0, 13)),
            },
        ]
    }

    fn written(parts: &[Part], under: Option<(&str, u64)>, most: usize) -> Written {
        let secret: HashSet<(String, u64)> = [(String::new(), 11)].into_iter().collect();
        render(
            parts,
            &Asked {
                under,
                most,
                secret: &secret,
                origin: "https://shop.example",
            },
        )
    }

    #[test]
    fn a_page_is_one_element_a_line_with_its_ref() {
        let text = written(&parts(), None, MOST).text;
        assert_eq!(
            text,
            [
                "- heading \"Basket\" [ref=e3]",
                "- textbox \"Card number\" [value=\"4242 4242\"] [ref=e5]",
                "- checkbox \"Keep me\" [checked] [ref=e7]",
                "- link \"Help\" [url=/help] [ref=e9]",
                "- textbox \"Password\" [filled] [ref=e11]",
                "- iframe [ref=e13]",
                "  - button \"Pay now\" [ref=f1e20]",
            ]
            .join("\n")
        );
    }

    #[test]
    fn a_password_fields_value_is_never_written() {
        assert!(!written(&parts(), None, MOST).text.contains("hunter2"));
        // Nor a mask that stands for one.
        assert!(masked("\u{2022}\u{2022}\u{2022}"));
        assert!(!masked("4242"));
        assert!(!masked(""));
    }

    /// A card form as the engine answers it: the number's field with its words inside,
    /// a button whose name the engine built out of the number, and a field whose value is
    /// only the engine's mask, which no scan named.
    fn card_page() -> Vec<Value> {
        let field = |id: &str, name: &str, value: &str, backend: u64, children: &[&str]| {
            with(
                with(
                    node(id, "textbox", name, backend, children),
                    "parentId",
                    json!("1"),
                ),
                "value",
                json!({ "type": "string", "value": value }),
            )
        };
        vec![
            node("1", "RootWebArea", "Pay", 1, &["2", "5", "6", "8"]),
            field("2", "Card number", "4242 4242 4242 4242", 2, &["3"]),
            with(node("3", "generic", "", 3, &["4"]), "parentId", json!("2")),
            with(
                node("4", "StaticText", "4242 4242 4242 4242", 4, &[]),
                "parentId",
                json!("3"),
            ),
            with(
                node("5", "button", "Pay with 4242 4242 4242 4242", 5, &[]),
                "parentId",
                json!("1"),
            ),
            field("6", "PIN", "\u{2022}\u{2022}\u{2022}\u{2022}", 6, &["7"]),
            with(
                node(
                    "7",
                    "StaticText",
                    "\u{2022}\u{2022}\u{2022}\u{2022}",
                    7,
                    &[],
                ),
                "parentId",
                json!("6"),
            ),
            field("8", "Empty code", "", 8, &[]),
        ]
    }

    #[test]
    fn a_secret_field_says_only_that_it_is_filled() {
        let parts = vec![Part {
            prefix: String::new(),
            nodes: card_page(),
            owner: None,
        }];
        let secret: HashSet<(String, u64)> = [(String::new(), 2), (String::new(), 8)]
            .into_iter()
            .collect();
        let text = render(
            &parts,
            &Asked {
                under: None,
                most: MOST,
                secret: &secret,
                origin: "https://shop.example",
            },
        )
        .text;
        assert_eq!(
            text,
            [
                "- textbox \"Card number\" [filled] [ref=e2]",
                "- button \"Pay with\" [ref=e5]",
                "- textbox \"PIN\" [filled] [ref=e6]",
                "- textbox \"Empty code\" [ref=e8]",
            ]
            .join("\n")
        );
        // Nor is anything inside one found, nor a name that says its value.
        let found = find(
            &parts,
            &secret,
            &Wanted {
                text: Some("4242"),
                role: None,
                name: None,
            },
        );
        assert!(found.is_empty(), "{found:?}");
        let named = find(
            &parts,
            &secret,
            &Wanted {
                text: None,
                role: Some("button"),
                name: None,
            },
        );
        assert_eq!(named.len(), 1);
        assert_eq!(named[0].name, "Pay with");
    }

    #[test]
    fn a_part_of_the_page_is_that_element_and_under_it() {
        let text = written(&parts(), Some(("f1", 20)), MOST).text;
        assert_eq!(text, "- button \"Pay now\" [ref=f1e20]");
        assert!(holds(&parts(), "f1", 20));
        assert!(!holds(&parts(), "", 20));
    }

    #[test]
    fn a_long_page_is_cut_and_says_so() {
        let cut = written(&parts(), None, 80);
        assert!(cut.truncated);
        assert!(cut.text.ends_with("ask for one part with its ref"));
        assert!(cut.text.lines().count() < 4);
    }

    #[test]
    fn find_matches_role_and_name_and_words_in_text() {
        let found = |text: Option<&str>, role: Option<&str>, name: Option<&str>| {
            let secret = HashSet::new();
            find(&parts(), &secret, &Wanted { text, role, name })
                .into_iter()
                .map(|one| one.element)
                .collect::<Vec<_>>()
        };
        assert_eq!(found(None, Some("textbox"), None), ["e5", "e11"]);
        assert_eq!(found(None, Some("button"), Some("pay")), ["f1e20"]);
        assert_eq!(found(Some("help"), None, None), ["e9"]);
    }

    /// Trees recorded from headless Chromium, the engine `WebView2` is, on the probe's
    /// own shop and sign-in pages (scripts/agent-tab-probe.py).
    fn recorded(page: &str) -> Vec<Part> {
        let all: Value =
            serde_json::from_str(include_str!("fixtures.json")).expect("recorded trees");
        vec![Part {
            prefix: String::new(),
            nodes: all[page].as_array().expect("a page").clone(),
            owner: None,
        }]
    }

    #[test]
    fn a_recorded_shop_reads_as_its_form() {
        // Every field once, by its label; a list's options without refs, because they are
        // chosen with browser_select; a date field whole, because its insides - its
        // picker's button above all - are the engine's own windows (6.5); and the words a
        // label only repeats beside its field not said twice. The card's three fields are
        // secret, and empty, so they say nothing more than their names.
        let secret: HashSet<(String, u64)> = [47, 50, 53]
            .into_iter()
            .map(|node| (String::new(), node))
            .collect();
        let text = render(
            &recorded("/shop"),
            &Asked {
                under: None,
                most: MOST,
                secret: &secret,
                origin: "about:blank",
            },
        )
        .text;
        assert_eq!(
            text,
            [
                "- main [ref=e9]",
                "  - heading \"Basket\" [level=1] [ref=e10]",
                "  - paragraph [ref=e11]",
                "    - text \"One lamp, 42.00\" [ref=e67]",
                "  - form [ref=e12]",
                "    - textbox \"Name\" [ref=e14]",
                "    - combobox \"Quantity\" [expanded=false] [value=\"One\"] [ref=e17]",
                "      - option \"One\" [selected]",
                "      - option \"Two\"",
                "      - option \"Three\"",
                "    - date \"Delivery\" [ref=e34]",
                "    - checkbox \"Gift wrap\" [ref=e45]",
                "    - textbox \"Card number\" [ref=e47]",
                "    - textbox \"Expiry\" [ref=e50]",
                "    - textbox \"Security code\" [ref=e53]",
                "    - button \"Receipt\" [ref=e56]",
                "    - button \"Place order\" [ref=e59]",
                "  - paragraph [ref=e60]",
                "    - link \"Terms\" [ref=e61]",
                "    - link \"Invoice\" [ref=e62]",
                "  - status [ref=e63]",
            ]
            .join("\n")
        );
    }

    #[test]
    fn a_recorded_sign_in_never_says_its_password() {
        let parts = recorded("/signin");
        let secret: HashSet<(String, u64)> = HashSet::new();
        let text = render(
            &parts,
            &Asked {
                under: None,
                most: MOST,
                secret: &secret,
                origin: "about:blank",
            },
        )
        .text;
        // The engine's value is one bullet a character, and so are the words inside the
        // field; with no scan to say so, the mask alone makes it a secret.
        assert!(
            text.contains("- textbox \"Password\" [filled] [ref=e137]"),
            "{text}"
        );
        assert!(!text.contains("hunter2"), "{text}");
        assert!(!text.contains("[value="), "{text}");
        assert!(!text.contains('\u{2022}'), "{text}");
        let secret = HashSet::new();
        let found = find(
            &parts,
            &secret,
            &Wanted {
                text: Some("\u{2022}"),
                role: None,
                name: None,
            },
        );
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn a_ref_is_a_node_or_a_node_in_a_frame() {
        assert_eq!(parse_ref("e4812"), Some((None, 4812)));
        assert_eq!(parse_ref("f2e17"), Some((Some(2), 17)));
        assert_eq!(parse_ref("f0e17"), None);
        assert_eq!(parse_ref("x1"), None);
        assert_eq!(parse_ref("e"), None);
    }

    #[test]
    fn a_name_is_one_line_quoted_and_cut() {
        assert_eq!(quoted("a \"b\"\nc"), "\"a \\\"b\\\" c\"");
        assert!(quoted(&"x".repeat(500)).ends_with("\u{2026}\""));
    }

    #[test]
    fn the_protocols_internal_roles_read_as_words() {
        assert_eq!(spoken_role("RootWebArea"), "document");
        assert_eq!(spoken_role("StaticText"), "text");
        assert_eq!(spoken_role("button"), "button");
        assert_eq!(spoken_role("DescriptionListTerm"), "descriptionListTerm");
    }
}
