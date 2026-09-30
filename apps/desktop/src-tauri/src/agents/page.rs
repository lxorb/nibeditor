//! What an agent does to a page, through the engine and nothing else
//! (docs/agent-native.md 5.2, 7.2).
//!
//! Every act is the `DevTools` Protocol on that one webview: a press is
//! `Input.dispatchMouseEvent` at the element's middle, words are `Input.insertText`, a key
//! is `Input.dispatchKeyEvent` into the page. Trusted events, inside the page, that move
//! neither the system's pointer nor its keyboard; the spike and the probe measure that
//! the window in front and the app's focus never change.
//!
//! **Every act settles** the way Chrome `DevTools` MCP's `waitForEventsAfterAction` does:
//! if the page's own frame starts a navigation within 50 ms, its load is waited for (up
//! to 3 s), and then the document is waited on until it has not changed for 80 ms (up to
//! 3 s). So an agent rarely needs `browser_wait` after a press, and a dialog the act
//! raised ends the wait and rides on the answer instead.
//!
//! **What is never done**: a `<select>`, a date field or a colour field is never pressed
//! or keyed open, because its list is a window of the engine's own (6.5); they are set
//! through the page. A password field is never typed into, never read and never
//! photographed while focused, and no secret field's value - a password's, a code's, a
//! card's - is read back in any shape, not even as the bullets that count it: a picture
//! has each filled one painted over (9.4).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{json, Value};
use tauri::Webview;

use super::cdp::{self, Heard};
use super::keys::{self, Key};
use super::policy::{self, Facts, Field};
use super::snapshot::{self, Part};
use super::verbs::{Answer, Code, Cookie, FieldValue, Match, Moment, Picture, Until};

/// What an agent's refs are resolved and scripts run under, in the page.
const WORLD: &str = "nib-agent";

/// How long an act waits for a navigation it may have started to begin.
const NAVIGATION_STARTS: Duration = Duration::from_millis(50);

/// How long an act waits for a navigation's load, and for the document to settle.
const SETTLES: Duration = Duration::from_secs(3);

/// How long the document has to be still to be settled.
const STILL: Duration = Duration::from_millis(80);

/// How long the element about to be pressed in a reader's tab is lit first (7.1).
const LIT: Duration = Duration::from_millis(300);

/// The tallest full-page picture, in CSS pixels.
const TALLEST: f64 = 16_384.0;

/// How the page's scripts read a field, as the policy's `Field` has it: shared by `FACTS`
/// and the secret scan, so the two never read one field two ways. Reports what the page
/// says - type, `autocomplete`, words, whether its style masks it, whether a message box
/// @-mentions somebody - and leaves every judgement to `policy`.
const FIELDS: &str = r"
  const text = (one) => String(one || '').replace(/\s+/g, ' ').trim()
  const labelOf = (field) => {
    const parts = [field.getAttribute('aria-label')]
    if (field.labels) for (const one of field.labels) parts.push(one.innerText)
    const by = field.getAttribute('aria-labelledby')
    if (by) for (const id of by.split(/\s+/)) {
      const named = field.ownerDocument.getElementById(id)
      if (named) parts.push(named.innerText)
    }
    return text(parts.filter(Boolean).join(' '))
  }
  const describe = (one) => {
    const tag = one.tagName.toLowerCase()
    const role = String(one.getAttribute('role') || '').toLowerCase()
    const box = tag === 'textarea' || (!!one.isContentEditable && tag !== 'input')
    let type = tag === 'input' ? String(one.type || 'text').toLowerCase() : tag === 'textarea' ? 'textarea' : box ? 'editable' : tag
    if (role === 'searchbox' || (box && role === 'combobox')) type = 'search'
    const label = labelOf(one) || text(one.getAttribute('placeholder'))
    let masked = false
    try {
      const style = one.ownerDocument.defaultView.getComputedStyle(one)
      masked = type !== 'password' && String(style.webkitTextSecurity || 'none') !== 'none'
    } catch (_) {}
    const words = box ? String(tag === 'textarea' ? one.value : one.innerText || '').slice(0, 5000) : ''
    return {
      type,
      autocomplete: String(one.getAttribute('autocomplete') || '').toLowerCase(),
      said: text([one.name, one.id, one.getAttribute('placeholder'), labelOf(one)].filter(Boolean).join(' ')).slice(0, 200),
      label: label.slice(0, 200),
      masked,
      mentions: /(^|\s)@[\p{L}\p{N}_.-]{2,}/u.test(words),
    }
  }
";

/// What a page's element says about itself and its form, for the policy and for what
/// may be done to it. Run with the element as `this`.
const FACTS_BODY: &str = r"
  let el = this.nodeType === 1 ? this : this.parentElement
  if (!el) return {}
  // A part of a field the engine draws itself (a date's picker button) is that field.
  const root = el.getRootNode && el.getRootNode()
  if (root && root.host && ['INPUT', 'SELECT', 'TEXTAREA'].includes(root.host.tagName)) el = root.host
  const tag = el.tagName.toLowerCase()
  const kind = tag === 'input' ? String(el.type || 'text').toLowerCase() : ''
  const pressed = el.closest('button, a, [role=button], [role=link], [role=menuitem], input[type=submit], input[type=button], input[type=image], summary') || el
  const name = text(labelOf(pressed) || pressed.innerText || (pressed.tagName === 'INPUT' ? pressed.value : '') || pressed.getAttribute('title') || pressed.getAttribute('alt')).slice(0, 200)
  const form = el.form || el.closest('form')
  const buttonType = pressed.tagName === 'BUTTON' ? String(pressed.getAttribute('type') || 'submit').toLowerCase() : ''
  const submit = !!form && ((pressed.tagName === 'BUTTON' && buttonType === 'submit') || (pressed.tagName === 'INPUT' && ['submit', 'image'].includes(String(pressed.type).toLowerCase())))
  const link = pressed.tagName === 'A' && !/^\s*(#|javascript:|$)/i.test(String(pressed.getAttribute('href') || ''))
  const editable = !!(el.isContentEditable || tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'image', 'file', 'reset', 'hidden', 'range', 'color'].includes(kind)))
  // The form's fields, or the page's when it is in none: a webmail's Send and a chat
  // widget's are in no form, and their message box is an editable region.
  const fields = []
  for (const one of (form || el.ownerDocument).querySelectorAll('input, select, textarea, [contenteditable]:not([contenteditable=false])')) {
    if (fields.length >= 200) break
    fields.push(describe(one))
  }
  return { tag, type: kind, name, autocomplete: String(el.getAttribute('autocomplete') || '').toLowerCase(), submit, link, editable, in_form: !!form, fields, field: describe(el) }
";

/// `FACTS_BODY` with `FIELDS` in front of it, as the function the protocol runs.
static FACTS: LazyLock<String> =
    LazyLock::new(|| ["function () {", FIELDS, FACTS_BODY, "}"].concat());

/// Every field words can be typed into, over the page and its frames of the same origin:
/// the array the secret scan reads, one element at a time.
const TYPED_INTO: &str = r"(() => {
  const all = []
  const walk = (doc) => {
    for (const one of doc.querySelectorAll('input, textarea')) all.push(one)
    for (const frame of doc.querySelectorAll('iframe, frame')) { try { if (frame.contentDocument) walk(frame.contentDocument) } catch (_) {} }
  }
  walk(document)
  return all
})()";

/// What the secret scan's handles are held under, and let go of together.
const SECRETS: &str = "nib-agent-secrets";

/// Each of `TYPED_INTO`'s fields described, in its order, and whether it holds anything.
static DESCRIBED: LazyLock<String> = LazyLock::new(|| {
    [
        "function () {",
        FIELDS,
        "return this.map((one) => Object.assign(describe(one), { filled: String(one.value || '') !== '' })) }",
    ]
    .concat()
});

/// The grey a filled secret field is painted in a picture of the page.
const PAINTED: [u8; 3] = [128, 128, 128];

/// A secret field on the page: which node, and whether anything is in it.
struct Secret {
    /// Its part's prefix, as its ref starts.
    prefix: String,
    /// Its node.
    backend: u64,
    /// Whether it holds a value.
    filled: bool,
}

/// The element that has the keyboard, into frames of the same origin.
const ACTIVE: &str = r"(() => {
  let at = document.activeElement
  try { while (at && at.contentDocument && at.contentDocument.activeElement) at = at.contentDocument.activeElement } catch (_) {}
  return at
})()";

/// A key in a reader's page as the page's own events, and its default done the page's
/// way; answers `type` when the key's text is still to be inserted.
const IN_PAGE_KEY: &str = r"function (key, code, modifiers) {
  const init = { key, code, bubbles: true, cancelable: true, composed: true, altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8) }
  const went = this.dispatchEvent(new KeyboardEvent('keydown', init))
  let answer = ''
  if (went) {
    const form = this.form || (this.closest && this.closest('form'))
    if (key === 'Enter' && this.tagName !== 'TEXTAREA' && !this.isContentEditable) {
      if (form) { form.requestSubmit ? form.requestSubmit() : form.submit() }
    } else if (key === 'Tab') {
      const all = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter((one) => !one.disabled && one.tabIndex >= 0 && one.getClientRects().length > 0)
      const at = all.indexOf(this)
      const next = all[(at + (init.shiftKey ? -1 : 1) + all.length) % all.length]
      if (next) next.focus()
    } else if (key === 'Backspace' || key === 'Delete') {
      document.execCommand(key === 'Backspace' ? 'delete' : 'forwardDelete')
    } else if (!init.ctrlKey && !init.altKey && !init.metaKey) {
      answer = 'type'
    }
  }
  this.dispatchEvent(new KeyboardEvent('keyup', init))
  return answer
}";

/// The page as the reader reads it, for `browser_read` as text.
const TEXT: &str = r"(() => ({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' }))()";

/// The whole page's HTML with its links made absolute and its scripts left out, for
/// `browser_read` as markdown. No field's value goes with it: a password field is
/// dropped and every other field's `value` too, so a page that writes a secret into the
/// markup (a prefilled password, a card number) has nothing read back whatever the
/// converter makes of a field. `innerText`, the text shape, never holds a field's value.
const WHOLE: &str = r"(() => {
  const copy = document.body ? document.body.cloneNode(true) : document.createElement('body')
  for (const one of copy.querySelectorAll('script, style, noscript, template, svg, canvas, iframe')) one.remove()
  for (const one of copy.querySelectorAll('[href]')) { try { one.setAttribute('href', one.href) } catch (_) { one.removeAttribute('href') } }
  for (const one of copy.querySelectorAll('[src]')) { try { one.setAttribute('src', one.src) } catch (_) { one.removeAttribute('src') } }
  for (const one of copy.querySelectorAll('input[type=password]')) one.remove()
  for (const one of copy.querySelectorAll('input[value]')) one.removeAttribute('value')
  return { url: location.href, title: document.title, html: copy.innerHTML.slice(0, 4000000), text: document.body ? document.body.innerText : '' }
})()";

/// Whether the document has stopped changing: resolves once nothing moved for `still`
/// milliseconds, or at `most`.
const SETTLED: &str = r"(still, most) => new Promise((done) => {
  if (!document.body) return done(true)
  let quiet
  const watcher = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(end, still) })
  const end = () => { watcher.disconnect(); done(true) }
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  quiet = setTimeout(end, still)
  setTimeout(end, most)
})";

/// A page's trees, and the secret fields among their nodes.
pub type Tree = (Vec<Part>, HashSet<(String, u64)>);

/// A page an agent is acting on.
pub struct Page<'a> {
    /// Its webview.
    pub view: &'a Webview,
    /// Its label.
    pub label: String,
    /// Whether it is an agent's own tab rather than the reader's.
    pub own: bool,
    /// The stop the call started under.
    pub since: u64,
}

/// An element, resolved from a ref.
#[derive(Clone, Debug)]
pub struct Element {
    /// The frame's session, for an element in a process of its own.
    session: Option<String>,
    /// The frame's id there.
    frame: Option<String>,
    /// The node.
    pub backend: u64,
}

impl Page<'_> {
    fn heard(&self) -> Arc<Mutex<Heard>> {
        cdp::heard(&self.label)
    }

    /// One call on the page's own session. A call the page cannot answer because it is
    /// holding a dialog - the press that raised it, a navigation it asked to be asked
    /// about - answers nothing rather than waiting for the agent to answer the dialog.
    fn call(&self, method: &str, params: &Value) -> Result<Value, Answer> {
        cdp::call_until(self.view, None, method, params, || {
            super::quiet::dialog_of(&self.label).is_some()
        })
        .map(Option::unwrap_or_default)
        .map_err(|why| Answer::error(Code::Failed, why))
    }

    fn call_on(&self, element: &Element, method: &str, params: &Value) -> Result<Value, Answer> {
        cdp::call_until(
            self.view,
            element.session.as_deref(),
            method,
            params,
            || super::quiet::dialog_of(&self.label).is_some(),
        )
        .map(Option::unwrap_or_default)
        .map_err(|why| stale(&why))
    }

    /// Where the page is.
    pub fn url(&self) -> String {
        self.view
            .url()
            .map(|one| one.to_string())
            .unwrap_or_default()
    }

    /// An element from a ref the agent passed.
    pub fn element(&self, reference: &str) -> Result<Element, Answer> {
        let Some((frame, backend)) = snapshot::parse_ref(reference) else {
            return Err(Answer::error(
                Code::NoSuchRef,
                format!("{reference} is not a ref: refs look like e12 or f2e17"),
            ));
        };
        let Some(number) = frame else {
            return Ok(Element {
                session: None,
                frame: None,
                backend,
            });
        };
        let found = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frame(number);
        found
            .map(|one| Element {
                session: Some(one.session),
                frame: Some(one.id),
                backend,
            })
            .ok_or_else(|| {
                Answer::error(
                    Code::NoSuchRef,
                    format!("the frame of {reference} is gone: take a snapshot again"),
                )
            })
    }

    /// A handle to an element in the page, for a function to run on.
    fn object(&self, element: &Element) -> Result<String, Answer> {
        let resolved = self.call_on(
            element,
            "DOM.resolveNode",
            &json!({ "backendNodeId": element.backend, "objectGroup": WORLD }),
        )?;
        resolved
            .pointer("/object/objectId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| stale("the element has no object"))
    }

    /// Runs a function on an element, with arguments, answering its value.
    fn run_on(
        &self,
        element: &Element,
        function: &str,
        arguments: &[Value],
    ) -> Result<Value, Answer> {
        let object = self.object(element)?;
        let arguments: Vec<Value> = arguments
            .iter()
            .map(|one| json!({ "value": one }))
            .collect();
        let answered = self.call_on(
            element,
            "Runtime.callFunctionOn",
            &json!({
                "objectId": object,
                "functionDeclaration": function,
                "arguments": arguments,
                "returnByValue": true,
                "awaitPromise": true,
            }),
        )?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// What an element says about itself and its form.
    pub fn facts(&self, element: &Element) -> Result<Facts, Answer> {
        let said = self.run_on(element, &FACTS, &[])?;
        Ok(serde_json::from_value(said).unwrap_or_default())
    }

    /// What the element with the keyboard says about itself, if one has it.
    pub fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        let found = self.call(
            "Runtime.evaluate",
            &json!({ "expression": ACTIVE, "returnByValue": false }),
        )?;
        let Some(object) = found.pointer("/result/objectId").and_then(Value::as_str) else {
            return Ok(None);
        };
        let said = self.call(
            "Runtime.callFunctionOn",
            &json!({ "objectId": object, "functionDeclaration": FACTS.as_str(), "returnByValue": true }),
        )?;
        Ok(said
            .pointer("/result/value")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok()))
    }

    /// Runs an expression in nib's own world in the page's frame, answering its value.
    pub fn isolated(&self, expression: &str) -> Result<Value, Answer> {
        let context = self.world()?;
        let answered = self.call(
            "Runtime.evaluate",
            &json!({
                "expression": expression,
                "contextId": context,
                "returnByValue": true,
                "awaitPromise": true,
            }),
        )?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// nib's own world in the page's frame: the page's document, none of its globals.
    fn world(&self) -> Result<i64, Answer> {
        let frame = self.main_frame()?;
        let made = self.call(
            "Page.createIsolatedWorld",
            &json!({ "frameId": frame, "worldName": WORLD }),
        )?;
        made.get("executionContextId")
            .and_then(Value::as_i64)
            .ok_or_else(|| Answer::error(Code::Failed, "the page has no world for nib"))
    }

    /// The page's own frame.
    fn main_frame(&self) -> Result<String, Answer> {
        if let Some(frame) = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .main_frame
            .clone()
        {
            return Ok(frame);
        }
        let tree = self.call("Page.getFrameTree", &json!({}))?;
        let frame = tree
            .pointer("/frameTree/frame/id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| Answer::error(Code::Failed, "the page has no frame"))?;
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .main_frame = Some(frame.clone());
        Ok(frame)
    }

    /// Waits for an act to settle; see the top of this file.
    pub fn settle(&self, navigations_before: u64) {
        let started = Instant::now();
        let navigated = loop {
            let navigations = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .navigations;
            if navigations > navigations_before {
                break true;
            }
            if started.elapsed() >= NAVIGATION_STARTS || self.interrupted() {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        if navigated {
            let loads = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .loads;
            let waiting = Instant::now();
            while waiting.elapsed() < SETTLES && !self.interrupted() {
                if self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .loads
                    > loads
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        if self.interrupted() {
            return;
        }
        let Ok(context) = self.world() else {
            return;
        };
        let expression = format!(
            "({SETTLED})({}, {})",
            STILL.as_millis(),
            SETTLES.as_millis()
        );
        let _ = cdp::call_in(
            self.view,
            None,
            "Runtime.evaluate",
            &json!({ "expression": expression, "contextId": context, "awaitPromise": true, "returnByValue": true }),
            SETTLES + Duration::from_millis(500),
        );
    }

    /// Whether a wait should end early: the stop was pressed, or the page is holding a
    /// dialog, which stops everything in it.
    fn interrupted(&self) -> bool {
        super::stop::cancelled(self.since) || super::quiet::dialog_of(&self.label).is_some()
    }

    /// How many navigations of the page's own frame have started, for `settle`.
    pub fn navigations(&self) -> u64 {
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .navigations
    }

    /// Where an element's middle is in the page's viewport, scrolled into view first.
    fn point(&self, element: &Element) -> Result<(f64, f64), Answer> {
        let _ = self.call_on(
            element,
            "DOM.scrollIntoViewIfNeeded",
            &json!({ "backendNodeId": element.backend }),
        );
        let quads = self.call_on(
            element,
            "DOM.getContentQuads",
            &json!({ "backendNodeId": element.backend }),
        )?;
        let (x, y) = quads
            .get("quads")
            .and_then(Value::as_array)
            .and_then(|all| {
                all.iter().find_map(|quad| {
                    let at: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
                    (at.len() == 8 && area(&at) > 1.0).then(|| {
                        (
                            (at[0] + at[2] + at[4] + at[6]) / 4.0,
                            (at[1] + at[3] + at[5] + at[7]) / 4.0,
                        )
                    })
                })
            })
            .ok_or_else(|| {
                Answer::error(
                    Code::Failed,
                    "the element is not visible: nothing of it is on the page",
                )
            })?;
        let (dx, dy) = self.frame_offset(element)?;
        Ok((x + dx, y + dy))
    }

    /// Where a frame in a process of its own sits in the page, for its elements' points.
    fn frame_offset(&self, element: &Element) -> Result<(f64, f64), Answer> {
        let Some(frame) = &element.frame else {
            return Ok((0.0, 0.0));
        };
        let owner = self.call("DOM.getFrameOwner", &json!({ "frameId": frame }))?;
        let Some(backend) = owner.get("backendNodeId").and_then(Value::as_u64) else {
            return Ok((0.0, 0.0));
        };
        let model = self.call("DOM.getBoxModel", &json!({ "backendNodeId": backend }))?;
        let content: Vec<f64> = model
            .pointer("/model/content")
            .and_then(Value::as_array)
            .map(|all| all.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        Ok((
            content.first().copied().unwrap_or_default(),
            content.get(1).copied().unwrap_or_default(),
        ))
    }

    /// Whether the element is what a press at the point lands on - it, something inside
    /// it, or a label for it - and what does when it is not.
    fn lands_on(&self, element: &Element, (x, y): (f64, f64)) -> Result<(), Answer> {
        if element.session.is_some() {
            return Ok(());
        }
        let Ok(hit) = self.call(
            "DOM.getNodeForLocation",
            &json!({ "x": whole(x), "y": whole(y), "includeUserAgentShadowDOM": false, "ignorePointerEventsNone": true }),
        ) else {
            return Ok(());
        };
        let Some(hit) = hit.get("backendNodeId").and_then(Value::as_u64) else {
            return Ok(());
        };
        if hit == element.backend {
            return Ok(());
        }
        let covered = Element {
            session: None,
            frame: None,
            backend: hit,
        };
        let target = self.object(element)?;
        let above = self.object(&covered)?;
        let inside = self.call(
            "Runtime.callFunctionOn",
            &json!({
                "objectId": above,
                "functionDeclaration": "function (target) { const el = this.nodeType === 1 ? this : this.parentElement; if (!el) return true; if (target === el || target.contains(el) || el.contains(target)) return true; const label = el.closest('label'); if (label && (label.control === target || label.contains(target))) return true; return el.tagName === 'IFRAME' || el.tagName === 'FRAME' }",
                "arguments": [{ "objectId": target }],
                "returnByValue": true,
            }),
        )?;
        if inside.pointer("/result/value").and_then(Value::as_bool) != Some(false) {
            return Ok(());
        }
        let what = self
            .run_on(&covered, "function () { const el = this.nodeType === 1 ? this : this.parentElement; return el ? (el.getAttribute('aria-label') || el.innerText || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 80) : '' }", &[])
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default();
        Err(Answer::error(
            Code::Failed,
            format!("e{} is covered by e{hit} (\u{201c}{what}\u{201d}) where it would be pressed: deal with that first", element.backend),
        ))
    }

    /// Lights an element with the engine's own inspector highlight for a beat: drawn by
    /// the renderer, not put into the page (7.1).
    fn light(&self, element: &Element) {
        if element.session.is_some() {
            return;
        }
        let _ = self.call("Overlay.enable", &json!({}));
        let lit = self.call(
            "Overlay.highlightNode",
            &json!({
                "backendNodeId": element.backend,
                "highlightConfig": {
                    "contentColor": { "r": 111, "g": 76, "b": 255, "a": 0.18 },
                    "borderColor": { "r": 111, "g": 76, "b": 255, "a": 0.9 },
                },
            }),
        );
        if lit.is_ok() {
            std::thread::sleep(LIT);
            let _ = self.call("Overlay.hideHighlight", &json!({}));
        }
    }

    fn mouse(
        &self,
        kind: &str,
        (x, y): (f64, f64),
        button: &str,
        count: u8,
        modifiers: u8,
    ) -> Result<(), Answer> {
        let buttons = match (kind, button) {
            ("mousePressed", "left") => 1,
            ("mousePressed", "right") => 2,
            ("mousePressed", "middle") => 4,
            _ => 0,
        };
        self.call(
            "Input.dispatchMouseEvent",
            &json!({
                "type": kind, "x": x, "y": y, "button": button, "buttons": buttons,
                "clickCount": count, "modifiers": modifiers,
            }),
        )
        .map(|_| ())
    }

    /// Presses an element: into view, lit for a beat in a reader's tab, then the
    /// engine's own press at its middle. Refused on a field whose list is a window.
    pub fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
    ) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        if facts.picker() {
            return Err(Answer::error(
                Code::BadArguments,
                "that opens a list of the engine's own: set it with browser_select or browser_fill_form",
            ));
        }
        let point = self.point(element)?;
        self.lands_on(element, point)?;
        if !self.own {
            self.light(element);
        }
        let before = self.navigations();
        self.mouse("mouseMoved", point, "none", 0, modifiers)?;
        for press in 1..=count.max(1) {
            self.mouse("mousePressed", point, button, press, modifiers)?;
            self.mouse("mouseReleased", point, button, press, modifiers)?;
        }
        self.settle(before);
        Ok(())
    }

    /// The pointer over an element.
    pub fn hover(&self, element: &Element) -> Result<(), Answer> {
        let point = self.point(element)?;
        self.mouse("mouseMoved", point, "none", 0, 0)
    }

    /// Words into a field, as text rather than keys; replacing what is there when asked.
    pub fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        refuse_secret(&facts)?;
        if facts.sensitive() {
            super::log::sensitive();
        }
        if facts.tag == "select" {
            return Err(Answer::error(
                Code::BadArguments,
                "that is a list: use browser_select",
            ));
        }
        if facts.kind == "file" {
            return Err(Answer::error(
                Code::BadArguments,
                "that takes files: use browser_upload",
            ));
        }
        if facts.picker() {
            return self.set_value(element, text);
        }
        if !facts.editable {
            return Err(Answer::error(
                Code::BadArguments,
                "that is not a field words can be typed into",
            ));
        }
        self.call_on(
            element,
            "DOM.focus",
            &json!({ "backendNodeId": element.backend }),
        )?;
        let placing = if replace {
            "function () { if (this.select) { this.select() } else { const range = document.createRange(); range.selectNodeContents(this); const now = getSelection(); now.removeAllRanges(); now.addRange(range) } }"
        } else {
            "function () { try { if (this.setSelectionRange) { const end = String(this.value || '').length; this.setSelectionRange(end, end) } } catch (_) {} }"
        };
        self.run_on(element, placing, &[])?;
        if text.is_empty() {
            if replace {
                self.press_key(
                    &keys::chord("Delete").map_err(|why| Answer::error(Code::Failed, why))?,
                )?;
            }
            return Ok(());
        }
        self.call("Input.insertText", &json!({ "text": text }))
            .map(|_| ())
    }

    /// A value set through the page, with the events a person's choice raises: for the
    /// fields whose own picker is a window (a date, a time, a colour).
    fn set_value(&self, element: &Element, text: &str) -> Result<(), Answer> {
        let said = self.run_on(
            element,
            "function (value) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').set; setter.call(this, value); this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return this.value }",
            &[json!(text)],
        )?;
        if said.as_str() == Some(text) || text.is_empty() {
            Ok(())
        } else {
            Err(Answer::error(
                Code::BadArguments,
                format!("the field did not take {text:?}: a date is written 2026-09-30, a time 14:30, a colour #336699"),
            ))
        }
    }

    /// Options of a `<select>` chosen through the page, never by opening its list.
    pub fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer> {
        let said = self.run_on(
            element,
            r"function (values) {
  if (this.tagName !== 'SELECT') return { error: 'that is not a <select>: press it and then the option you want' }
  const options = Array.from(this.options)
  const pick = (value) => options.find((one) => one.value === value) || options.find((one) => one.label.trim() === value.trim()) || options.find((one) => one.label.trim().toLowerCase() === value.trim().toLowerCase())
  const wanted = values.map(pick)
  const missing = values.find((_, at) => !wanted[at])
  if (missing !== undefined) return { error: 'there is no option ' + JSON.stringify(missing) + ': the options are ' + options.slice(0, 40).map((one) => JSON.stringify(one.label.trim())).join(', ') }
  if (!this.multiple && wanted.length > 1) return { error: 'this list takes one option' }
  for (const one of options) one.selected = wanted.includes(one)
  this.dispatchEvent(new Event('input', { bubbles: true }))
  this.dispatchEvent(new Event('change', { bubbles: true }))
  return { chosen: wanted.map((one) => one.value) }
}",
            &[json!(values)],
        )?;
        if let Some(error) = said.get("error").and_then(Value::as_str) {
            return Err(Answer::error(Code::BadArguments, error));
        }
        Ok(said
            .get("chosen")
            .and_then(Value::as_array)
            .map(|all| {
                all.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    /// One field of a form set to a value, by what kind of field it is.
    pub fn fill(&self, element: &Element, value: &FieldValue) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        refuse_secret(&facts)?;
        if facts.sensitive() {
            super::log::sensitive();
        }
        match value {
            FieldValue::Ticked(wanted) => {
                if !matches!(facts.kind.as_str(), "checkbox" | "radio") {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "true and false are for a checkbox or a radio button",
                    ));
                }
                let now = self.run_on(element, "function () { return this.checked }", &[])?;
                if now.as_bool() != Some(*wanted) {
                    self.click(element, "left", 1, 0)?;
                }
                Ok(())
            }
            FieldValue::Options(values) => self.select(element, values).map(|_| ()),
            FieldValue::Words(text) if facts.tag == "select" => {
                self.select(element, std::slice::from_ref(text)).map(|_| ())
            }
            FieldValue::Words(text) => self.type_text(element, text, true),
        }
    }

    /// One key or chord pressed inside the page. Refused where it would open a picker,
    /// or type into a password field.
    pub fn press(&self, key: &Key) -> Result<(), Answer> {
        if let Some(facts) = self.active_facts()? {
            if facts.picker() && key.opens_a_picker() {
                return Err(Answer::error(
                    Code::BadArguments,
                    "that key would open a list of the engine's own: use browser_select or browser_fill_form",
                ));
            }
            if facts.password() && key.text.is_some() {
                return Err(Answer::error(
                    Code::PasswordField,
                    "the field with the keyboard is a password field: signing in is the reader's, ask with browser_takeover",
                ));
            }
        }
        let before = self.navigations();
        self.press_key(key)?;
        self.settle(before);
        Ok(())
    }

    /// One key or chord in a reader's page, as the page's own key events rather than the
    /// engine's: a reader's tab hands the engine's keys to the window, which then takes
    /// the keyboard (see reader.rs). The key's default is done the page's way - Enter
    /// submits the field's form, Tab moves along, Backspace and Delete delete - and its
    /// text is inserted as text.
    pub fn press_in_page(&self, key: &Key) -> Result<(), Answer> {
        let found = self.call(
            "Runtime.evaluate",
            &json!({ "expression": format!("{ACTIVE} || document.body"), "returnByValue": false }),
        )?;
        let Some(object) = found.pointer("/result/objectId").and_then(Value::as_str) else {
            return Err(Answer::error(
                Code::Failed,
                "the page has nothing to press a key in",
            ));
        };
        let before = self.navigations();
        let said = self.call(
            "Runtime.callFunctionOn",
            &json!({
                "objectId": object,
                "functionDeclaration": IN_PAGE_KEY,
                "arguments": [{ "value": key.name }, { "value": key.code }, { "value": key.modifiers }],
                "returnByValue": true,
            }),
        )?;
        let went = said
            .pointer("/result/value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if went == "type" {
            if let Some(text) = key.text.as_deref() {
                let text = if text == "\r" { "\n" } else { text };
                self.call("Input.insertText", &json!({ "text": text }))?;
            }
        }
        self.settle(before);
        Ok(())
    }

    fn press_key(&self, key: &Key) -> Result<(), Answer> {
        for event in key.events() {
            self.call("Input.dispatchKeyEvent", &event)?;
        }
        Ok(())
    }

    /// An element into view, or the page moved by an amount with the wheel at its middle.
    pub fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer> {
        if let Some(element) = element {
            self.call_on(
                element,
                "DOM.scrollIntoViewIfNeeded",
                &json!({ "backendNodeId": element.backend }),
            )?;
            return Ok(());
        }
        let (width, height, x, y) = self.viewport()?;
        self.call(
            "Input.dispatchMouseEvent",
            &json!({ "type": "mouseWheel", "x": width / 2.0, "y": height / 2.0, "deltaX": dx, "deltaY": dy }),
        )?;
        // The wheel is what a person's scroll is, and what a page's own scrolling listens
        // to; a page it did not move is scrolled as a whole instead.
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(400) {
            std::thread::sleep(Duration::from_millis(50));
            let (_, _, now_x, now_y) = self.viewport()?;
            if (now_x - x).abs() > 0.5 || (now_y - y).abs() > 0.5 {
                return Ok(());
            }
        }
        self.isolated(&format!(
            "window.scrollBy({{ left: {dx}, top: {dy}, behavior: 'instant' }})"
        ))?;
        Ok(())
    }

    /// One element dragged onto another, with the engine's own drag when the page drags
    /// and plain presses and moves when it only listens to the pointer. The engine's drag
    /// is intercepted rather than started, so no drag of the system's ever begins.
    pub fn drag(&self, from: &Element, to: &Element) -> Result<(), Answer> {
        let start = self.point(from)?;
        let end = self.point(to)?;
        self.call("Input.setInterceptDrags", &json!({ "enabled": true }))?;
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .dragged = None;
        let dragged = (|| {
            self.mouse("mouseMoved", start, "none", 0, 0)?;
            self.mouse("mousePressed", start, "left", 1, 0)?;
            for step in 1..=8u8 {
                let at = f64::from(step) / 8.0;
                let point = (
                    start.0 + (end.0 - start.0) * at,
                    start.1 + (end.1 - start.1) * at,
                );
                self.call(
                    "Input.dispatchMouseEvent",
                    &json!({ "type": "mouseMoved", "x": point.0, "y": point.1, "button": "left", "buttons": 1 }),
                )?;
                std::thread::sleep(Duration::from_millis(16));
            }
            let data = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .dragged
                .take();
            if let Some(data) = data {
                for kind in ["dragEnter", "dragOver", "drop"] {
                    self.call(
                        "Input.dispatchDragEvent",
                        &json!({ "type": kind, "x": end.0, "y": end.1, "data": data }),
                    )?;
                }
            }
            self.mouse("mouseReleased", end, "left", 1, 0)
        })();
        let _ = self.call("Input.setInterceptDrags", &json!({ "enabled": false }));
        dragged
    }

    /// Files handed to a file input: the input itself, or the chooser a press on the
    /// element opens, which the engine intercepts rather than shows (6.2).
    pub fn upload(&self, element: &Element, files: &[String]) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        let input = if facts.kind == "file" {
            element.clone()
        } else {
            self.heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .chooser = None;
            self.click(element, "left", 1, 0)?;
            let waiting = Instant::now();
            let chosen = loop {
                if let Some(node) = self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .chooser
                    .take()
                {
                    break Some(node);
                }
                if waiting.elapsed() > Duration::from_secs(3) || self.interrupted() {
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            };
            let Some(backend) = chosen else {
                return Err(Answer::error(
                    Code::Failed,
                    "pressing it opened no file chooser: pass the file input's ref",
                ));
            };
            Element {
                session: element.session.clone(),
                frame: element.frame.clone(),
                backend,
            }
        };
        self.call_on(
            &input,
            "DOM.setFileInputFiles",
            &json!({ "files": files, "backendNodeId": input.backend }),
        )?;
        Ok(())
    }

    /// The viewport in CSS pixels, where it is scrolled to, and the device's pixels per
    /// CSS pixel: `(width, height, x, y)` and the ratio in `ratio`.
    fn viewport(&self) -> Result<(f64, f64, f64, f64), Answer> {
        let metrics = self.call("Page.getLayoutMetrics", &json!({}))?;
        let get = |path: &str| {
            metrics
                .pointer(path)
                .and_then(Value::as_f64)
                .unwrap_or_default()
        };
        Ok((
            get("/cssVisualViewport/clientWidth"),
            get("/cssVisualViewport/clientHeight"),
            get("/cssVisualViewport/pageX"),
            get("/cssVisualViewport/pageY"),
        ))
    }

    fn ratio(&self) -> f64 {
        self.call("Page.getLayoutMetrics", &json!({}))
            .ok()
            .and_then(|metrics| {
                let device = metrics.pointer("/layoutViewport/clientWidth")?.as_f64()?;
                let css = metrics
                    .pointer("/cssLayoutViewport/clientWidth")?
                    .as_f64()?;
                (css > 0.0).then_some(device / css)
            })
            .filter(|ratio| *ratio > 0.0)
            .unwrap_or(1.0)
    }

    /// A PNG of the page: what fits in the tab, the whole page, or one element; scaled to
    /// one image pixel per CSS pixel unless asked. Refused while a password field has the
    /// keyboard (9.4).
    pub fn screenshot(
        &self,
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        if self.active_facts()?.is_some_and(|facts| facts.password()) {
            return Err(Answer::error(
                Code::PasswordField,
                "a password field has the keyboard: nothing is photographed while one does",
            ));
        }
        let (width, height, x, y) = self.viewport()?;
        let clip = match (element, full) {
            (Some(element), _) => {
                let _ = self.call_on(
                    element,
                    "DOM.scrollIntoViewIfNeeded",
                    &json!({ "backendNodeId": element.backend }),
                );
                let [left, top, right, bottom] = self.page_rect(element)?;
                (left, top, right - left, bottom - top)
            }
            (None, true) => {
                let metrics = self.call("Page.getLayoutMetrics", &json!({}))?;
                let content_width = metrics
                    .pointer("/cssContentSize/width")
                    .and_then(Value::as_f64)
                    .unwrap_or(width);
                let content_height = metrics
                    .pointer("/cssContentSize/height")
                    .and_then(Value::as_f64)
                    .unwrap_or(height);
                (0.0, 0.0, content_width, content_height.min(TALLEST))
            }
            (None, false) => (x, y, width, height),
        };
        if clip.2 < 1.0 || clip.3 < 1.0 {
            return Err(Answer::error(
                Code::Failed,
                "nothing of it is on the page to photograph",
            ));
        }
        let wanted = scale.unwrap_or(1.0).clamp(0.1, 4.0);
        let shot = self.call(
            "Page.captureScreenshot",
            &json!({
                "format": "png",
                "captureBeyondViewport": full || element.is_some(),
                "clip": { "x": clip.0, "y": clip.1, "width": clip.2, "height": clip.3, "scale": wanted / self.ratio() },
            }),
        )?;
        let png = shot
            .get("data")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let (width, height) = png_size(&png).unwrap_or_default();
        let png = self.painted_over(png, clip, (width, height))?;
        Ok(Picture { png, width, height })
    }

    /// Where an element is on the page, in CSS pixels from the page's top left: its
    /// left, top, right and bottom, through the frame it is in.
    fn page_rect(&self, element: &Element) -> Result<[f64; 4], Answer> {
        let model = self.call_on(
            element,
            "DOM.getBoxModel",
            &json!({ "backendNodeId": element.backend }),
        )?;
        let border: Vec<f64> = model
            .pointer("/model/border")
            .and_then(Value::as_array)
            .map(|all| all.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        if border.len() != 8 {
            return Err(Answer::error(
                Code::Failed,
                "the element is not on the page",
            ));
        }
        let (offset_x, offset_y) = self.frame_offset(element)?;
        let (_, _, x, y) = self.viewport()?;
        let xs = [border[0], border[2], border[4], border[6]];
        let ys = [border[1], border[3], border[5], border[7]];
        let (left, right) = (
            xs.iter().copied().fold(f64::INFINITY, f64::min),
            xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        let (top, bottom) = (
            ys.iter().copied().fold(f64::INFINITY, f64::min),
            ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        let (dx, dy) = (offset_x + x, offset_y + y);
        Ok([left + dx, top + dy, right + dx, bottom + dy])
    }

    /// A picture of the page with every filled secret field in it painted over (9.4): a
    /// password's bullets say how long it is, and a card's number is its digits. A field
    /// that is not drawn is not in the picture; one that cannot be painted over keeps the
    /// picture from being handed out at all.
    fn painted_over(
        &self,
        png: String,
        clip: (f64, f64, f64, f64),
        size: (u32, u32),
    ) -> Result<String, Answer> {
        let mut prefixes = vec![String::new()];
        prefixes.extend(
            self.heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .frames()
                .into_iter()
                .map(|(number, _)| format!("f{number}")),
        );
        let (across, down) = (f64::from(size.0) / clip.2, f64::from(size.1) / clip.3);
        let rects: Vec<[f64; 4]> = self
            .secrets(prefixes)
            .into_iter()
            .filter(|one| one.filled)
            .filter_map(|one| {
                let element = self
                    .element(&format!("{}e{}", one.prefix, one.backend))
                    .ok()?;
                self.page_rect(&element).ok()
            })
            .map(|[left, top, right, bottom]| {
                [
                    (left - clip.0) * across,
                    (top - clip.1) * down,
                    (right - clip.0) * across,
                    (bottom - clip.1) * down,
                ]
            })
            .collect();
        if rects.is_empty() {
            return Ok(png);
        }
        paint_over(&png, &rects).map_err(|why| {
            Answer::error(
                Code::Failed,
                format!(
                    "a secret field could not be hidden in the picture, so there is none: {why}"
                ),
            )
        })
    }

    /// The page's accessibility tree, with its frames, as the parts `snapshot` writes.
    pub fn parts(&self) -> Result<Tree, Answer> {
        let own = self.call("Accessibility.getFullAXTree", &json!({}))?;
        let mut parts = vec![Part {
            prefix: String::new(),
            nodes: nodes_of(&own),
            owner: None,
        }];
        let away: Vec<(usize, cdp::Frame)> = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames();
        let away_ids: HashSet<String> = away.iter().map(|(_, frame)| frame.id.clone()).collect();

        // Frames in the page's own process: a tree each, under their frame element.
        let tree = self.call("Page.getFrameTree", &json!({}))?;
        let mut same = Vec::new();
        collect_frames(
            tree.get("frameTree").unwrap_or(&Value::Null),
            true,
            &mut same,
        );
        for frame in same.into_iter().filter(|one| !away_ids.contains(one)) {
            let Ok(nodes) = self.call("Accessibility.getFullAXTree", &json!({ "frameId": frame }))
            else {
                continue;
            };
            let owner = self.owner_in(&parts, &frame);
            parts.push(Part {
                prefix: String::new(),
                nodes: nodes_of(&nodes),
                owner,
            });
        }
        // Frames in processes of their own, through their sessions.
        for (number, frame) in away {
            let Ok(nodes) = cdp::call_in(
                self.view,
                Some(&frame.session),
                "Accessibility.getFullAXTree",
                &json!({}),
                cdp::PATIENCE,
            ) else {
                continue;
            };
            let owner = self.owner_in(&parts, &frame.id);
            parts.push(Part {
                prefix: format!("f{number}"),
                nodes: nodes_of(&nodes),
                owner,
            });
        }
        let secret = self.secret_fields(&parts);
        Ok((parts, secret))
    }

    /// The frame element a frame hangs under: the part holding it, and its node.
    fn owner_in(&self, parts: &[Part], frame: &str) -> Option<(usize, u64)> {
        let owner = self
            .call("DOM.getFrameOwner", &json!({ "frameId": frame }))
            .ok()?;
        let backend = owner.get("backendNodeId")?.as_u64()?;
        let part = parts.iter().position(|part| {
            part.prefix.is_empty()
                && part.nodes.iter().any(|node| {
                    node.get("backendDOMNodeId").and_then(Value::as_u64) == Some(backend)
                })
        })?;
        Some((part, backend))
    }

    /// Every secret field in the parts of the page, by part prefix and node, so that
    /// nothing of theirs is written whatever the tree says.
    fn secret_fields(&self, parts: &[Part]) -> HashSet<(String, u64)> {
        let prefixes: HashSet<String> = parts.iter().map(|part| part.prefix.clone()).collect();
        self.secrets(prefixes)
            .into_iter()
            .map(|one| (one.prefix, one.backend))
            .collect()
    }

    /// Every secret field (`policy::secret`: a password, a one-time code, a card) in the
    /// page's parts with these prefixes. The page describes each field it has; the policy
    /// judges; only the secret ones are resolved to nodes.
    fn secrets(&self, prefixes: impl IntoIterator<Item = String>) -> Vec<Secret> {
        let mut found = Vec::new();
        for prefix in prefixes {
            let session = if prefix.is_empty() {
                None
            } else {
                prefix
                    .trim_start_matches('f')
                    .parse::<usize>()
                    .ok()
                    .and_then(|number| {
                        self.heard()
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .frame(number)
                    })
                    .map(|frame| frame.session)
            };
            let call = |method: &str, params: &Value| {
                cdp::call_in(self.view, session.as_deref(), method, params, cdp::PATIENCE)
            };
            let Some(list) = call(
                "Runtime.evaluate",
                &json!({ "expression": TYPED_INTO, "objectGroup": SECRETS }),
            )
            .ok()
            .and_then(|value| {
                value
                    .pointer("/result/objectId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }) else {
                continue;
            };
            let secret: HashMap<String, bool> = call(
                "Runtime.callFunctionOn",
                &json!({ "objectId": list, "functionDeclaration": DESCRIBED.as_str(), "returnByValue": true }),
            )
            .ok()
            .and_then(|value| value.pointer("/result/value")?.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .filter(|(_, said)| {
                serde_json::from_value::<Field>(said.clone()).is_ok_and(|field| policy::secret(&field))
            })
            .map(|(at, said)| {
                let filled = said.get("filled").and_then(Value::as_bool) != Some(false);
                (at.to_string(), filled)
            })
            .collect();
            if !secret.is_empty() {
                let properties = call(
                    "Runtime.getProperties",
                    &json!({ "objectId": list, "ownProperties": true }),
                )
                .unwrap_or_default();
                for one in properties
                    .get("result")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(&filled) = one
                        .get("name")
                        .and_then(Value::as_str)
                        .and_then(|at| secret.get(at))
                    else {
                        continue;
                    };
                    let Some(field) = one.pointer("/value/objectId").and_then(Value::as_str) else {
                        continue;
                    };
                    if let Some(backend) = call("DOM.describeNode", &json!({ "objectId": field }))
                        .ok()
                        .and_then(|described| described.pointer("/node/backendNodeId")?.as_u64())
                    {
                        found.push(Secret {
                            prefix: prefix.clone(),
                            backend,
                            filled,
                        });
                    }
                }
            }
            let _ = call(
                "Runtime.releaseObjectGroup",
                &json!({ "objectGroup": SECRETS }),
            );
        }
        found
    }

    /// The page as text, as markdown, or its article as markdown. Markdown is the
    /// clipper's own converter's, asked of the window; without a window it is the text.
    pub fn read(
        &self,
        app: &tauri::AppHandle,
        shape: super::verbs::ReadAs,
    ) -> Result<(String, String, String), Answer> {
        use super::verbs::ReadAs;
        let said = match shape {
            ReadAs::Text => self.isolated(TEXT)?,
            ReadAs::Markdown => self.isolated(WHOLE)?,
            ReadAs::Article => self.isolated(&crate::web_tabs::reader(false))?,
        };
        let text_at = |key: &str| {
            said.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let (url, title) = (text_at("url"), text_at("title"));
        if shape == ReadAs::Text {
            return Ok((url, title, text_at("text")));
        }
        let html = text_at("html");
        let markdown = crate::endpoint::ask(
            app,
            super::verbs::window::MARKDOWN,
            serde_json::to_value(super::verbs::window::Convert {
                html: html.clone(),
                url: url.clone(),
            })
            .unwrap_or_default(),
            Duration::from_secs(5),
        )
        .ok()
        .and_then(|value| value.as_str().map(str::to_string));
        let words = markdown.unwrap_or_else(|| {
            let text = text_at("text");
            if text.is_empty() {
                strip_tags(&html)
            } else {
                text
            }
        });
        Ok((url, title, words))
    }

    /// Waits for what the agent asked, stop and dialogs ending it early.
    pub fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer> {
        let started = Instant::now();
        loop {
            let done = match until {
                Until::Moment(Moment::Load) => self
                    .isolated("document.readyState")
                    .is_ok_and(|state| state.as_str() == Some("complete")),
                Until::Moment(Moment::NetworkIdle) => self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .idle_for(Duration::from_millis(500)),
                Until::Text { text } => self
                    .isolated(&format!(
                        "(document.body ? document.body.innerText : '').includes({})",
                        json!(text)
                    ))
                    .is_ok_and(|found| found.as_bool() == Some(true)),
                Until::Element { element } => self.element(element).is_ok_and(|element| {
                    self.call_on(
                        &element,
                        "DOM.getContentQuads",
                        &json!({ "backendNodeId": element.backend }),
                    )
                    .ok()
                    .and_then(|quads| {
                        quads
                            .get("quads")
                            .and_then(Value::as_array)
                            .map(|all| !all.is_empty())
                    }) == Some(true)
                }),
                Until::Url { url } => self.url().contains(url.as_str()),
            };
            let spent = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            if done {
                return Ok(spent);
            }
            if super::stop::cancelled(self.since) {
                return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
            }
            if super::quiet::dialog_of(&self.label).is_some() {
                return Err(Answer::error(
                    Code::Failed,
                    "the page is holding a dialog: answer it with browser_dialog",
                ));
            }
            if started.elapsed() >= most {
                let waiting = match until {
                    Until::Moment(Moment::NetworkIdle) => {
                        let open = self
                            .heard()
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .in_flight();
                        format!(": still in flight, {}", open.join(", "))
                    }
                    _ => String::new(),
                };
                return Err(Answer::error(
                    Code::Timeout,
                    format!("not in {} ms{waiting}", most.as_millis()),
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// A script run in the page, in nib's world or the page's own, answering its value.
    pub fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer> {
        if !page_world {
            return self.isolated(expression);
        }
        let answered = self.call(
            "Runtime.evaluate",
            &json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
        )?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// Goes to an address, and waits for it to load, up to ten seconds.
    pub fn navigate(&self, url: &str) -> Result<(), Answer> {
        let loads = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .loads;
        let went = self.call("Page.navigate", &json!({ "url": url }))?;
        if let Some(error) = went
            .get("errorText")
            .and_then(Value::as_str)
            .filter(|one| !one.is_empty())
        {
            return Err(Answer::error(
                Code::Failed,
                format!("the page could not be reached: {error}"),
            ));
        }
        self.loaded_after(loads, Duration::from_secs(10));
        Ok(())
    }

    /// One step along the tab's history, or the same page again.
    pub fn step(&self, by: i64) -> Result<(), Answer> {
        let loads = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .loads;
        if by == 0 {
            self.call("Page.reload", &json!({}))?;
        } else {
            let history = self.call("Page.getNavigationHistory", &json!({}))?;
            let at = history
                .get("currentIndex")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                + by;
            let entry = history
                .get("entries")
                .and_then(Value::as_array)
                .and_then(|all| all.get(usize::try_from(at).ok()?))
                .and_then(|one| one.get("id"))
                .cloned()
                .ok_or_else(|| Answer::error(Code::BadArguments, "there is nowhere to step to"))?;
            self.call("Page.navigateToHistoryEntry", &json!({ "entryId": entry }))?;
        }
        self.loaded_after(loads, Duration::from_secs(10));
        Ok(())
    }

    fn loaded_after(&self, loads: u64, most: Duration) {
        let started = Instant::now();
        while started.elapsed() < most && !self.interrupted() {
            if self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .loads
                > loads
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// The cookies the page's address would be sent.
    pub fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        let said = self.call("Network.getCookies", &json!({ "urls": [self.url()] }))?;
        Ok(said
            .get("cookies")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|one| Cookie {
                name: text(one, "name"),
                value: text(one, "value"),
                domain: Some(text(one, "domain")),
                path: Some(text(one, "path")),
                expires: one
                    .get("expires")
                    .and_then(Value::as_f64)
                    .filter(|at| *at > 0.0),
                http_only: one
                    .get("httpOnly")
                    .and_then(Value::as_bool)
                    .unwrap_or_default(),
                secure: one
                    .get("secure")
                    .and_then(Value::as_bool)
                    .unwrap_or_default(),
            })
            .collect())
    }

    /// Sets a cookie for the page's address.
    pub fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer> {
        let mut params = json!({
            "name": cookie.name, "value": cookie.value, "path": cookie.path.clone().unwrap_or_else(|| "/".into()),
            "httpOnly": cookie.http_only, "secure": cookie.secure,
        });
        match &cookie.domain {
            Some(domain) => params["domain"] = json!(domain),
            None => params["url"] = json!(self.url()),
        }
        if let Some(expires) = cookie.expires {
            params["expires"] = json!(expires);
        }
        let said = self.call("Network.setCookie", &params)?;
        if said.get("success").and_then(Value::as_bool) == Some(false) {
            return Err(Answer::error(
                Code::Failed,
                "the engine refused that cookie",
            ));
        }
        Ok(())
    }

    /// Every cookie and bit of storage of the page's origin, gone.
    pub fn clear(&self) -> Result<(), Answer> {
        for cookie in self.cookies()? {
            let _ = self.call(
                "Network.deleteCookies",
                &json!({ "name": cookie.name, "domain": cookie.domain, "path": cookie.path }),
            );
        }
        let origin = tauri::Url::parse(&self.url())
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_default();
        self.call(
            "Storage.clearDataForOrigin",
            &json!({ "origin": origin, "storageTypes": "all" }),
        )?;
        Ok(())
    }

    /// The page's `localStorage`.
    pub fn local(&self) -> Result<serde_json::Map<String, Value>, Answer> {
        let said = self.isolated("(() => { const out = {}; for (let at = 0; at < localStorage.length; at++) { const key = localStorage.key(at); out[key] = localStorage.getItem(key) } return out })()")?;
        Ok(said.as_object().cloned().unwrap_or_default())
    }

    /// The elements that match, over every frame.
    pub fn find(&self, wanted: &snapshot::Wanted<'_>) -> Result<Vec<Match>, Answer> {
        let (parts, secret) = self.parts()?;
        Ok(snapshot::find(&parts, &secret, wanted))
    }
}

/// A coordinate as the whole number the protocol takes for a hit test.
#[allow(
    clippy::cast_possible_truncation,
    reason = "a point on a page is a few thousand pixels at most"
)]
fn whole(value: f64) -> i64 {
    value.round() as i64
}

/// The error an element that is gone answers with: take a snapshot again.
///
/// A node of a document the tab has since left is refused by `WebView2` itself, before the
/// protocol says anything, with the system's `E_INVALIDARG`: "The parameter is incorrect."
/// Every call this reads for names its element by that node, so that sentence is the
/// element being gone too (measured by scripts/mcp-probe.py: a ref of one page pressed
/// after the tab went to the next).
fn stale(why: &str) -> Answer {
    let gone = why.contains("No node")
        || why.contains("Could not find node")
        || why.contains("does not belong")
        || why.contains("No object")
        || why.contains("The parameter is incorrect");
    if gone {
        Answer::error(
            Code::NoSuchRef,
            "that element is gone: take a snapshot again",
        )
    } else {
        Answer::error(Code::Failed, why.to_string())
    }
}

/// The page's own exception, from an answer that threw.
fn thrown(answered: &Value) -> Result<(), Answer> {
    let Some(details) = answered.get("exceptionDetails") else {
        return Ok(());
    };
    let said = details
        .pointer("/exception/description")
        .and_then(Value::as_str)
        .or_else(|| details.get("text").and_then(Value::as_str))
        .unwrap_or("the script threw");
    Err(Answer::error(
        Code::Failed,
        cdp::cut(said.to_string(), 2_000),
    ))
}

/// A password field, or any field of a sign-in form, refused: signing in is a takeover.
fn refuse_secret(facts: &Facts) -> Result<(), Answer> {
    if facts.password() || facts.sign_in() {
        return Err(Answer::error(
            Code::PasswordField,
            "that is a sign-in: the reader types it, ask with browser_takeover",
        ));
    }
    Ok(())
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn nodes_of(tree: &Value) -> Vec<Value> {
    tree.get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Every frame under the page's own, by id.
fn collect_frames(tree: &Value, top: bool, out: &mut Vec<String>) {
    if !top {
        if let Some(id) = tree.pointer("/frame/id").and_then(Value::as_str) {
            out.push(id.to_string());
        }
    }
    for child in tree
        .get("childFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_frames(child, false, out);
    }
}

/// A quad's area, to skip the empty ones an inline element has.
fn area(at: &[f64]) -> f64 {
    let mut twice = 0.0;
    for corner in 0..4 {
        let (x1, y1) = (at[corner * 2], at[corner * 2 + 1]);
        let next = (corner + 1) % 4;
        let (x2, y2) = (at[next * 2], at[next * 2 + 1]);
        twice += x1 * y2 - x2 * y1;
    }
    (twice / 2.0).abs()
}

/// A PNG's size, read from its header.
fn png_size(base64: &str) -> Option<(u32, u32)> {
    let head = base64.get(..44)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(head)
        .ok()?;
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    Some((width, height))
}

/// A PNG, base64, with rectangles in its own pixels - left, top, right, bottom - painted
/// flat grey.
fn paint_over(png: &str, rects: &[[f64; 4]]) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png)
        .map_err(|why| why.to_string())?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().map_err(|why| why.to_string())?;
    let mut pixels = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("the picture is too big")?
    ];
    let info = reader
        .next_frame(&mut pixels)
        .map_err(|why| why.to_string())?;
    let channels = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => 4,
        (png::ColorType::Rgb, png::BitDepth::Eight) => 3,
        other => return Err(format!("a picture of {other:?}")),
    };
    for &[left, top, right, bottom] in rects {
        let (x0, x1) = (pixel(left, info.width), pixel(right.ceil(), info.width));
        let (y0, y1) = (pixel(top, info.height), pixel(bottom.ceil(), info.height));
        for row in y0..y1 {
            for column in x0..x1 {
                let at = row * info.line_size + column * channels;
                pixels[at..at + 3].copy_from_slice(&PAINTED);
                if channels == 4 {
                    pixels[at + 3] = u8::MAX;
                }
            }
        }
    }
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, info.width, info.height);
    encoder.set_color(info.color_type);
    encoder.set_depth(info.bit_depth);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|why| why.to_string())?;
    writer
        .write_image_data(&pixels[..info.buffer_size()])
        .map_err(|why| why.to_string())?;
    writer.finish().map_err(|why| why.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// A coordinate as a pixel index, held inside a picture `most` pixels across.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the picture first, which is a few thousand pixels at most"
)]
fn pixel(value: f64, most: u32) -> usize {
    value.floor().clamp(0.0, f64::from(most)) as usize
}

/// Markup's words, for a page the window could not convert.
fn strip_tags(html: &str) -> String {
    // A script's or a style's insides are not words on the page.
    let mut kept = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find('<') {
        kept.push_str(&rest[..at]);
        rest = &rest[at..];
        let lower = rest.get(..8).unwrap_or(rest).to_ascii_lowercase();
        let closing = if lower.starts_with("<script") {
            Some("</script>")
        } else if lower.starts_with("<style") {
            Some("</style>")
        } else {
            None
        };
        let past = closing.and_then(|end| {
            rest.to_ascii_lowercase()
                .find(end)
                .map(|found| found + end.len())
        });
        if let Some(past) = past {
            rest = &rest[past..];
        } else {
            let end = rest.find('>').map_or(rest.len(), |found| found + 1);
            kept.push(' ');
            rest = &rest[end..];
        }
    }
    kept.push_str(rest);
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_quad_is_no_place_to_press() {
        assert!((area(&[0.0, 0.0, 10.0, 0.0, 10.0, 5.0, 0.0, 5.0]) - 50.0).abs() < f64::EPSILON);
        assert!(area(&[3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0]) < 1.0);
    }

    #[test]
    fn a_pngs_size_is_in_its_header() {
        // A 1 by 1 PNG.
        let one = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        assert_eq!(png_size(one), Some((1, 1)));
        assert_eq!(png_size("nope"), None);
    }

    #[test]
    fn a_secret_is_painted_over_and_nothing_else_moves() {
        // A 4 by 2 picture, every pixel white, and a field over its middle two columns.
        let mut raw = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut raw, 4, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("a header");
            writer.write_image_data(&[255; 32]).expect("the pixels");
            writer.finish().expect("a picture");
        }
        let white = base64::engine::general_purpose::STANDARD.encode(raw);
        let painted = paint_over(&white, &[[1.2, -5.0, 2.5, 9.0]]).expect("painted");
        assert_eq!(png_size(&painted), Some((4, 2)));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(painted)
            .expect("base64");
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .expect("a png");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
        reader.next_frame(&mut pixels).expect("a frame");
        let grey = [128, 128, 128, 255];
        let white = [255; 4];
        for row in 0..2 {
            let at = |column: usize| &pixels[(row * 4 + column) * 4..(row * 4 + column + 1) * 4];
            assert_eq!(at(0), white);
            assert_eq!(at(1), grey);
            assert_eq!(at(2), grey);
            assert_eq!(at(3), white);
        }
        assert!(paint_over("not a picture", &[]).is_err());
    }

    #[test]
    fn frames_are_every_one_under_the_page() {
        let tree = json!({ "frame": { "id": "top" }, "childFrames": [
            { "frame": { "id": "a" }, "childFrames": [{ "frame": { "id": "b" } }] },
            { "frame": { "id": "c" } },
        ]});
        let mut out = Vec::new();
        collect_frames(&tree, true, &mut out);
        assert_eq!(out, ["a", "b", "c"]);
    }

    #[test]
    fn a_gone_element_says_to_look_again() {
        assert!(matches!(
            stale("No node with given id found"),
            Answer::Error {
                code: Code::NoSuchRef,
                ..
            }
        ));
        assert!(matches!(
            stale("The parameter is incorrect."),
            Answer::Error {
                code: Code::NoSuchRef,
                ..
            }
        ));
        assert!(matches!(
            stale("Target closed"),
            Answer::Error {
                code: Code::Failed,
                ..
            }
        ));
        assert_eq!(strip_tags("<p>a <b>b</b></p>"), "a b");
        assert_eq!(
            strip_tags("<p>words</p><script>let x = 1</script><STYLE>p{}</STYLE> more"),
            "words more"
        );
    }
}
