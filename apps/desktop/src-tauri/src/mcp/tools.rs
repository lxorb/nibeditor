//! The tools, as a model is shown them: one table, `tools.json`, and the part of it an
//! agent's grant reaches (docs/agent-native.md 5).
//!
//! **One table, held to the verbs.** Each row is a verb of the crate's table
//! (agents/verbs.rs `NAMES`) or one of the window's verbs an agent may call
//! (`window::AGENT_VERBS`), and nothing else: the tests below fail when a verb has no row
//! or a row no verb. A crate verb's schema is checked against the verb's own arguments by
//! serde itself - every field it takes, which of them it needs, every word an enum
//! accepts, and a sample of each shape read back - so a verb and its tool cannot drift.
//! The window's verbs have no Rust type to check against; their argument names are the
//! table's, which the window's dispatcher reads, and `services/sync/test/local-tools.test.ts`
//! holds the six the account connector shares to its names.
//!
//! **Descriptions are written for a model**: what the tool does, when to use it rather
//! than another, and what an answer means for the next call. The instructions
//! (`server.rs`) carry what every tool shares, once.
//!
//! **Only what the grant reaches is listed**, so an agent with notes and no browser spends
//! no context on the browser. And of the window's verbs, only those the running window
//! answers, once it has said: a tool that could only answer "there is no such verb" is not
//! offered.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::agents::grants::{Grant, Scope};
use crate::agents::verbs::{window::AGENT_VERBS, NAMES};

/// One row of the table.
#[derive(Debug, Deserialize)]
pub struct Tool {
    /// The tool's name, which is its verb's.
    pub name: String,
    /// What a model reads about it.
    pub description: String,
    /// Its arguments, as JSON Schema.
    #[serde(rename = "inputSchema")]
    pub input: Value,
    /// Hints for the client: read-only, destructive, open world.
    #[serde(default)]
    pub annotations: Option<Value>,
}

impl Tool {
    /// The row as `tools/list` answers it.
    pub fn listed(&self) -> Value {
        let mut said = json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input,
        });
        if let Some(annotations) = &self.annotations {
            said["annotations"] = annotations.clone();
        }
        said
    }
}

/// The table.
pub fn table() -> &'static [Tool] {
    static TABLE: OnceLock<Vec<Tool>> = OnceLock::new();
    TABLE.get_or_init(|| {
        // The table is part of this binary and a test reads it whole; a row that did
        // not read would have failed the build's tests long before it could fail here.
        serde_json::from_str(include_str!("tools.json")).unwrap_or_default()
    })
}

/// A tool by name.
pub fn find(name: &str) -> Option<&'static Tool> {
    table().iter().find(|tool| tool.name == name)
}

/// Whether a tool is one of the crate's verbs, answered without the window.
pub fn of_the_crate(name: &str) -> bool {
    NAMES.contains(&name)
}

/// Whether a grant reaches a tool at all.
pub fn reaches(grant: &Grant, name: &str) -> bool {
    let browsing = grant.holds(Scope::Browser) || grant.holds(Scope::BrowserReader);
    match name {
        "agent_status" | "approval_status" => true,
        // A tab of the agent's own, and what only its own tabs do.
        "browser_open" | "browser_close" | "browser_show" | "browser_downloads" => {
            grant.holds(Scope::Browser)
        }
        // Scripts need the scope and at least one site they are allowed on (9.2).
        "browser_evaluate" => {
            browsing && grant.holds(Scope::BrowserScript) && !grant.scripts.is_empty()
        }
        name if name.starts_with("browser_") => browsing,
        name => AGENT_VERBS
            .iter()
            .find(|(verb, _)| *verb == name)
            .is_some_and(|(_, needs)| needs.is_none_or(|scope| grant.holds(scope))),
    }
}

/// The tools a paired agent is shown: what its grant reaches, and of the window's verbs
/// only those the window answers, once it has said which. Until it has, none of them.
pub fn listed(grant: &Grant, window: Option<&BTreeSet<String>>) -> Vec<&'static Tool> {
    table()
        .iter()
        .filter(|tool| reaches(grant, &tool.name))
        .filter(|tool| {
            of_the_crate(&tool.name) || window.is_some_and(|verbs| verbs.contains(&tool.name))
        })
        .collect()
}

/// The one tool of a client nib has not paired yet: `agent_status`, answered by this
/// process with where the pairing stands.
pub fn unpaired() -> Vec<&'static Tool> {
    find("agent_status").into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::verbs::Verb;
    use std::collections::BTreeMap;

    /// The verbs of the crate's table that `nib mcp` calls itself and a model never does.
    const OWN: [&str; 2] = ["agent_pair", "agent_bye"];

    const PROBE: &str = "__nib_probe";

    fn names() -> BTreeSet<&'static str> {
        table().iter().map(|tool| tool.name.as_str()).collect()
    }

    #[test]
    fn the_table_reads_whole_with_one_row_a_name() {
        let raw: Vec<Value> =
            serde_json::from_str(include_str!("tools.json")).expect("tools.json is JSON");
        assert_eq!(table().len(), raw.len(), "a row did not read");
        assert_eq!(names().len(), table().len(), "a name is in the table twice");
        for tool in table() {
            assert_eq!(tool.input["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty(), "{}", tool.name);
            let properties = tool.input["properties"].as_object().expect("properties");
            for needed in tool.input["required"].as_array().into_iter().flatten() {
                let needed = needed.as_str().expect("a name");
                assert!(properties.contains_key(needed), "{}: {needed}", tool.name);
            }
        }
    }

    /// Every verb a model may call has a row, and every row is such a verb.
    #[test]
    fn every_verb_is_a_tool_and_every_tool_a_verb() {
        let verbs: BTreeSet<&str> = NAMES
            .iter()
            .copied()
            .filter(|name| !OWN.contains(name))
            .chain(AGENT_VERBS.iter().map(|(name, _)| *name))
            .collect();
        assert_eq!(names(), verbs);
    }

    /// A sample value of a schema: the first word of an enum, the first shape of several.
    fn sample(schema: &Value) -> Value {
        if let Some(first) = schema.get("enum").and_then(|all| all.get(0)) {
            return first.clone();
        }
        if let Some(first) = schema.get("anyOf").and_then(|all| all.get(0)) {
            return sample(first);
        }
        match schema.get("type").and_then(Value::as_str) {
            Some("integer") => json!(1),
            Some("number") => json!(1.5),
            Some("boolean") => json!(true),
            Some("array") => json!([sample(&schema["items"])]),
            Some("object") => Value::Object(
                schema["properties"]
                    .as_object()
                    .map(|all| {
                        all.iter()
                            .map(|(key, one)| (key.clone(), sample(one)))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            _ => json!("e1"),
        }
    }

    /// Every object schema inside a tool's, by where it sits: `[]` for the arguments
    /// themselves, `["cookie"]`, `["fields", 0]`.
    fn objects(schema: &Value, at: &[Value], found: &mut Vec<(Vec<Value>, Value)>) {
        if schema.get("type").and_then(Value::as_str) == Some("object")
            && schema.get("properties").is_some()
        {
            found.push((at.to_vec(), schema.clone()));
            for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                let mut deeper = at.to_vec();
                deeper.push(json!(key));
                objects(one, &deeper, found);
            }
        }
        if schema.get("type").and_then(Value::as_str) == Some("array") {
            let mut deeper = at.to_vec();
            deeper.push(json!(0));
            objects(&schema["items"], &deeper, found);
        }
    }

    /// The value at a place in a sample.
    fn at<'a>(value: &'a mut Value, place: &[Value]) -> &'a mut Value {
        place.iter().fold(value, |inside, step| match step {
            Value::String(key) => &mut inside[key.as_str()],
            _ => &mut inside[0],
        })
    }

    /// What serde says about arguments it refuses.
    fn refusal(verb: &str, args: Value) -> String {
        match Verb::read(verb, args.clone()) {
            Some(Err(why)) => why,
            other => panic!("{verb} took {args}: {other:?}"),
        }
    }

    /// The words serde lists in backticks after `expected` in a refusal.
    fn expected(why: &str) -> BTreeSet<String> {
        let Some((_, after)) = why.split_once("expected") else {
            return BTreeSet::new();
        };
        after
            .split('`')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }

    fn keys(schema: &Value) -> BTreeSet<String> {
        schema["properties"]
            .as_object()
            .map(|all| all.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn required(schema: &Value) -> BTreeSet<String> {
        schema["required"]
            .as_array()
            .map(|all| {
                all.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Every crate verb's schema, held to the verb's own arguments by serde: the fields
    /// each object takes, which of them it needs, and every word each enum accepts.
    #[test]
    fn every_crate_tools_schema_is_its_verbs_own() {
        for tool in table().iter().filter(|tool| of_the_crate(&tool.name)) {
            let verb = tool.name.as_str();
            let full = sample(&tool.input);
            assert!(
                matches!(Verb::read(verb, full.clone()), Some(Ok(_))),
                "{verb}: a sample of its schema does not read: {full}"
            );

            let mut found = Vec::new();
            objects(&tool.input, &[], &mut found);
            for (place, schema) in found {
                // The fields: an object holding only a name nobody takes is refused with
                // the list of every name that is taken.
                let mut probed = full.clone();
                *at(&mut probed, &place) = json!({ PROBE: 0 });
                let why = refusal(verb, probed);
                let takes = if why.contains("there are no fields") {
                    BTreeSet::new()
                } else {
                    expected(&why)
                };
                assert_eq!(keys(&schema), takes, "{verb} at {place:?}: {why}");

                // Which of them it needs: each left out in turn.
                let mut needs = BTreeSet::new();
                for key in keys(&schema) {
                    let mut without = full.clone();
                    at(&mut without, &place)
                        .as_object_mut()
                        .expect("an object")
                        .remove(&key);
                    match Verb::read(verb, without) {
                        Some(Ok(_)) => {}
                        Some(Err(why)) if why.contains(&format!("missing field `{key}`")) => {
                            needs.insert(key);
                        }
                        other => panic!("{verb} without {key}: {other:?}"),
                    }
                }
                assert_eq!(required(&schema), needs, "{verb} at {place:?}");

                // Every word an enum takes, where serde holds it to a list.
                for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                    let (words, inside_a_list) = match (one.get("enum"), one["items"].get("enum")) {
                        (Some(words), _) => (words, false),
                        (None, Some(words)) => (words, true),
                        _ => continue,
                    };
                    let mut bogus = full.clone();
                    let bad = if inside_a_list {
                        json!(["__nib_bogus"])
                    } else {
                        json!("__nib_bogus")
                    };
                    at(&mut bogus, &place)[key.as_str()] = bad;
                    let Some(Err(why)) = Verb::read(verb, bogus) else {
                        // A string the verb takes whatever it says; the list is advice.
                        continue;
                    };
                    let listed: BTreeSet<String> = words
                        .as_array()
                        .expect("a list")
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect();
                    assert_eq!(listed, expected(&why), "{verb}.{key}: {why}");
                }
            }
        }
    }

    /// The shapes a value may take, each read back: `browser_wait`'s `for` is a word or
    /// one of three objects, a form field's value a tick, words or a list.
    #[test]
    fn every_shape_of_several_reads_back() {
        for tool in table().iter().filter(|tool| of_the_crate(&tool.name)) {
            let full = sample(&tool.input);
            let mut found = Vec::new();
            objects(&tool.input, &[], &mut found);
            for (place, schema) in found {
                for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                    for shape in one["anyOf"].as_array().into_iter().flatten() {
                        let words = shape["enum"].as_array().cloned().unwrap_or_default();
                        let values = if words.is_empty() {
                            vec![sample(shape)]
                        } else {
                            words
                        };
                        for value in values {
                            let mut args = full.clone();
                            at(&mut args, &place)[key.as_str()] = value.clone();
                            assert!(
                                matches!(Verb::read(&tool.name, args), Some(Ok(_))),
                                "{}.{key} = {value}",
                                tool.name
                            );
                        }
                    }
                }
            }
        }
    }

    fn grant(scopes: &[Scope]) -> Grant {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes = scopes.to_vec();
        grant
    }

    fn listed_names(grant: &Grant, window: Option<&BTreeSet<String>>) -> BTreeSet<String> {
        listed(grant, window)
            .into_iter()
            .map(|tool| tool.name.clone())
            .collect()
    }

    #[test]
    fn an_agent_with_notes_and_no_browser_is_shown_no_browser() {
        let every: BTreeSet<String> = AGENT_VERBS
            .iter()
            .map(|(one, _)| (*one).to_owned())
            .collect();
        let shown = listed_names(&grant(&[Scope::NotesRead]), Some(&every));
        assert!(shown.contains("read_note"));
        assert!(shown.contains("list_spaces"));
        assert!(shown.contains("agent_status"));
        assert!(!shown.iter().any(|one| one.starts_with("browser_")));
        assert!(!shown.contains("edit_note"));
    }

    #[test]
    fn the_readers_tabs_alone_reach_acting_but_not_a_tab_of_its_own() {
        let shown = listed_names(&grant(&[Scope::BrowserReader]), None);
        assert!(shown.contains("browser_click"));
        assert!(shown.contains("browser_snapshot"));
        assert!(!shown.contains("browser_open"));
        assert!(!shown.contains("browser_downloads"));
    }

    #[test]
    fn scripts_need_the_scope_and_a_site() {
        let mut scripted = grant(&[Scope::Browser, Scope::BrowserScript]);
        assert!(!reaches(&scripted, "browser_evaluate"));
        scripted.scripts.push("example.com".into());
        assert!(reaches(&scripted, "browser_evaluate"));
        assert!(!reaches(&grant(&[Scope::Browser]), "browser_evaluate"));
    }

    #[test]
    fn the_windows_verbs_wait_for_the_window_to_say_it_has_them() {
        let own = Grant::own("a".into(), "A");
        let before = listed_names(&own, None);
        assert!(before.contains("browser_open"));
        assert!(!before.contains("read_note"));
        let some: BTreeSet<String> = ["read_note".to_owned()].into();
        let after = listed_names(&own, Some(&some));
        assert!(after.contains("read_note"));
        assert!(!after.contains("edit_note"));
    }

    /// Emil's own defaults (9.1) reach everything but scripts, the reader's storage,
    /// settings and the terminal.
    #[test]
    fn emils_defaults_list_all_but_four_kinds() {
        let every: BTreeSet<String> = AGENT_VERBS
            .iter()
            .map(|(one, _)| (*one).to_owned())
            .collect();
        let shown = listed_names(&Grant::own("a".into(), "A"), Some(&every));
        let hidden: BTreeSet<&str> = names()
            .into_iter()
            .filter(|one| !shown.contains(*one))
            .collect();
        assert_eq!(
            hidden,
            BTreeSet::from(["browser_evaluate", "run_terminal", "write_setting"])
        );
    }

    #[test]
    fn a_client_not_yet_paired_is_shown_its_status_alone() {
        let names: Vec<&str> = unpaired().iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, ["agent_status"]);
    }

    /// What the table costs a model's context, per tool and in all, as characters of the
    /// JSON a client is sent: printed for the record, held under a ceiling so a
    /// description cannot grow without anybody deciding it should.
    #[test]
    fn the_table_stays_small() {
        let mut sizes = BTreeMap::new();
        for tool in table() {
            sizes.insert(tool.name.clone(), tool.listed().to_string().len());
        }
        let total: usize = sizes.values().sum();
        assert!(
            total < 24_000,
            "the tools are {total} characters: {sizes:?}"
        );
        for (name, size) in &sizes {
            assert!(*size < 1_600, "{name} is {size} characters");
        }
    }
}
