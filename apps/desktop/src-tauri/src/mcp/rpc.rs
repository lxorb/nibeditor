//! JSON-RPC over stdio, as MCP has it: one message a line, in and out.
//!
//! **Stdout is the protocol and nothing else.** Every byte this process writes there goes
//! through `Out`, one whole message and a newline at a time under one lock, so two calls
//! answered at once on two threads never interleave, and nothing else in the process may
//! print. A message never holds a newline of its own: JSON writes one inside a string as
//! `\n`.

use std::io::{BufRead, Write};
use std::sync::Mutex;

use serde_json::{json, Value};

/// JSON-RPC's own codes for a message that is not one.
pub const NOT_JSON: i64 = -32700;
/// A message that is JSON but not a request.
pub const NOT_A_REQUEST: i64 = -32600;
/// A method nobody here answers.
pub const NO_SUCH_METHOD: i64 = -32601;
/// Arguments the method cannot take: an unknown tool among them, as MCP says.
pub const BAD_PARAMS: i64 = -32602;

/// One message from the client.
#[derive(Debug, PartialEq)]
pub enum Message {
    /// Asks for an answer, by `id`.
    Request {
        /// Echoed back as it came.
        id: Value,
        /// What is asked.
        method: String,
        /// With what; an empty object when it came without.
        params: Value,
    },
    /// Says something and wants nothing back.
    Notification {
        /// What is said.
        method: String,
        /// With what.
        params: Value,
    },
    /// The client's answer to a request of ours, of which there are none.
    Answer,
}

/// A line that is not a message: the answer to send, with the id when one could be read.
#[derive(Debug, PartialEq)]
pub struct Unreadable {
    /// The request's id, or null.
    pub id: Value,
    /// JSON-RPC's code.
    pub code: i64,
    /// Why, in words.
    pub message: &'static str,
}

/// One line, read.
pub fn read(line: &str) -> Result<Message, Unreadable> {
    let refused = |id: Value, code, message| Unreadable { id, code, message };
    let value: Value =
        serde_json::from_str(line).map_err(|_| refused(Value::Null, NOT_JSON, "not JSON"))?;
    if value.is_array() {
        // MCP took batches out of JSON-RPC in 2025-06-18; nobody sends one now.
        return Err(refused(
            Value::Null,
            NOT_A_REQUEST,
            "batches are not answered",
        ));
    }
    let Some(fields) = value.as_object() else {
        return Err(refused(Value::Null, NOT_A_REQUEST, "not a request"));
    };
    let id = fields.get("id").cloned();
    let params = fields
        .get("params")
        .filter(|one| one.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    match (fields.get("method").and_then(Value::as_str), id) {
        (Some(method), Some(id)) if id.is_string() || id.is_number() => Ok(Message::Request {
            id,
            method: method.to_owned(),
            params,
        }),
        (Some(_), Some(id)) => Err(refused(id, NOT_A_REQUEST, "an id is a string or a number")),
        (Some(method), None) => Ok(Message::Notification {
            method: method.to_owned(),
            params,
        }),
        (None, Some(_)) if fields.contains_key("result") || fields.contains_key("error") => {
            Ok(Message::Answer)
        }
        (None, id) => Err(refused(
            id.unwrap_or(Value::Null),
            NOT_A_REQUEST,
            "say which method",
        )),
    }
}

/// The next line on stdin, without its line ending; `None` once the client has closed
/// it, which is how a session ends. Bytes that are not UTF-8 are read as the replacement
/// character, which then fails as JSON like any other nonsense.
pub fn next_line(input: &mut impl BufRead) -> Option<String> {
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match input.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&bytes);
        let line = line.trim_end_matches(['\n', '\r']);
        if !line.trim().is_empty() {
            return Some(line.to_owned());
        }
    }
}

/// An answer to a request.
pub fn answer(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// A refusal of a request.
pub fn failure(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// A notification of ours.
pub fn notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

/// Stdout, one whole message at a time.
pub struct Out<W: Write + Send>(Mutex<W>);

impl<W: Write + Send> Out<W> {
    /// Messages written to `to`.
    pub fn new(to: W) -> Self {
        Out(Mutex::new(to))
    }

    /// One message and its newline, flushed. A client that stopped reading is a client
    /// that is going: its stdin closing is what ends the session, so a write that fails
    /// is not reported anywhere.
    pub fn send(&self, message: &Value) {
        let mut line = message.to_string();
        line.push('\n');
        let mut to = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = to.write_all(line.as_bytes()).and_then(|()| to.flush());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_a_notification_and_an_answer_are_told_apart() {
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
            Ok(Message::Request {
                id: json!(1),
                method: "tools/list".into(),
                params: json!({}),
            })
        );
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
            Ok(Message::Notification {
                method: "notifications/initialized".into(),
                params: json!({}),
            })
        );
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","id":"a","result":{}}"#),
            Ok(Message::Answer)
        );
    }

    #[test]
    fn what_is_not_a_request_is_said_with_the_id_it_had() {
        assert_eq!(read("hello").map_err(|one| one.code), Err(NOT_JSON));
        assert_eq!(read("[]").map_err(|one| one.code), Err(NOT_A_REQUEST));
        let refused = read(r#"{"id":7}"#).expect_err("no method");
        assert_eq!((refused.id, refused.code), (json!(7), NOT_A_REQUEST));
        let refused = read(r#"{"id":{},"method":"ping"}"#).expect_err("an object id");
        assert_eq!(refused.code, NOT_A_REQUEST);
    }

    #[test]
    fn params_that_are_not_an_object_are_read_as_none() {
        let Ok(Message::Request { params, .. }) = read(r#"{"id":1,"method":"ping","params":3}"#)
        else {
            panic!("a request");
        };
        assert_eq!(params, json!({}));
    }

    #[test]
    fn lines_are_read_to_the_end_of_input_past_blank_ones() {
        let mut input = std::io::Cursor::new(b"\r\n{\"a\":1}\r\n\n{\"b\":2}".to_vec());
        assert_eq!(next_line(&mut input).as_deref(), Some("{\"a\":1}"));
        assert_eq!(next_line(&mut input).as_deref(), Some("{\"b\":2}"));
        assert_eq!(next_line(&mut input), None);
    }

    /// Every message is one line: the newline inside a string is written as JSON writes
    /// it, and a client splitting on newlines reads one message.
    #[test]
    fn a_message_is_exactly_one_line() {
        let out = Out::new(Vec::new());
        out.send(&answer(&json!(1), json!({ "text": "two\nlines" })));
        out.send(&notification("notifications/tools/list_changed", json!({})));
        let written = String::from_utf8(out.0.into_inner().expect("lock")).expect("utf-8");
        let lines: Vec<&str> = written.lines().collect();
        assert_eq!(lines.len(), 2);
        for line in lines {
            serde_json::from_str::<Value>(line).expect("each line is a message");
        }
    }
}
