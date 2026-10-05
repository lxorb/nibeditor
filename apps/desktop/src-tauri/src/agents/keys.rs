//! A key an agent names - `Enter`, `Control+A`, `Shift+Tab` - as the events the engine's
//! `Input.dispatchKeyEvent` takes: the key, its code, its Windows virtual key, the text it
//! types and the modifiers held. Pressed inside one page, never through the system.
//!
//! The names are the DOM's own `KeyboardEvent.key` values, which is what Playwright and
//! Chrome `DevTools` MCP take too, so an agent's habit carries over.

use serde_json::{json, Value};

/// Alt, as the protocol counts modifiers.
const ALT: u8 = 1;
/// Control.
const CONTROL: u8 = 2;
/// Meta (the Windows key).
const META: u8 = 4;
/// Shift.
const SHIFT: u8 = 8;

/// One key, as the engine is told about it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Key {
    /// `KeyboardEvent.key`.
    pub name: String,
    /// `KeyboardEvent.code`.
    pub code: String,
    /// The Windows virtual key.
    pub windows_code: u32,
    /// What it types, when it types something and no modifier but Shift is held.
    pub text: Option<String>,
    /// The modifiers held.
    pub modifiers: u8,
}

impl Key {
    /// The events one press is: down (with the text it types, if any) and up.
    pub fn events(&self) -> [Value; 2] {
        let down = json!({
            "type": if self.text.is_some() { "keyDown" } else { "rawKeyDown" },
            "modifiers": self.modifiers,
            "key": self.name,
            "code": self.code,
            "windowsVirtualKeyCode": self.windows_code,
            "nativeVirtualKeyCode": self.windows_code,
            "text": self.text.clone().unwrap_or_default(),
            "unmodifiedText": self.text.clone().unwrap_or_default(),
        });
        let up = json!({
            "type": "keyUp",
            "modifiers": self.modifiers,
            "key": self.name,
            "code": self.code,
            "windowsVirtualKeyCode": self.windows_code,
            "nativeVirtualKeyCode": self.windows_code,
        });
        [down, up]
    }

    /// Whether this press would open a `<select>`'s list or a picker, which the tools
    /// never do (6.5): Space, Enter, F4 and Alt+Down on such a field.
    pub fn opens_a_picker(&self) -> bool {
        matches!(self.name.as_str(), " " | "Enter" | "F4")
            || (matches!(self.name.as_str(), "ArrowDown" | "ArrowUp") && self.modifiers & ALT != 0)
    }

    /// Whether this press changes the words of the field it lands in: anything that
    /// types, a delete either way, and a paste or a cut. Never into a password field
    /// (9.4), which in a reader's tab may be the one they are typing into.
    pub fn changes_words(&self) -> bool {
        self.text.is_some()
            || matches!(self.name.as_str(), "Backspace" | "Delete")
            || (self.modifiers & (CONTROL | META) != 0
                && matches!(self.name.to_ascii_lowercase().as_str(), "v" | "x"))
    }

    /// Whether this press submits the form the field is in.
    pub fn submits(&self) -> bool {
        self.name == "Enter" && self.modifiers & (CONTROL | ALT | META) == 0
    }

    /// Whether this press is what sends from a message box: Enter, or Control+Enter
    /// where Enter is a new line (a mail's body, a comment). Shift+Enter is the new line
    /// in a chat, and sends nothing.
    pub fn sends(&self) -> bool {
        self.name == "Enter" && self.modifiers & (ALT | SHIFT) == 0
    }
}

/// A chord read: `Control+Shift+A` is A with two modifiers. `None` for a name that is not
/// a key, with the reason.
pub fn chord(said: &str) -> Result<Key, String> {
    let said = said.trim();
    if said.is_empty() {
        return Err("say which key".into());
    }
    // `Control++` is Control and the plus key.
    let (held, last) = match said.strip_suffix("++") {
        Some(front) => (front, "+"),
        None => match said.rsplit_once('+') {
            Some((front, last)) if !last.is_empty() => (front, last),
            _ => ("", said),
        },
    };
    let mut modifiers = 0u8;
    for one in held.split('+').filter(|one| !one.is_empty()) {
        modifiers |= match one.to_ascii_lowercase().as_str() {
            "alt" | "option" => ALT,
            "control" | "ctrl" | "controlormeta" => CONTROL,
            "meta" | "command" | "cmd" | "win" | "super" => META,
            "shift" => SHIFT,
            _ => {
                return Err(format!(
                    "{one} is not a modifier: Alt, Control, Meta or Shift"
                ))
            }
        };
    }
    let mut key = named(last).ok_or_else(|| format!("{last} is not a key name"))?;
    key.modifiers = modifiers;
    // A letter with Shift types its capital; anything held but Shift types nothing.
    if modifiers & (CONTROL | ALT | META) != 0 {
        key.text = None;
    } else if modifiers & SHIFT != 0 {
        key.text = key.text.map(|text| text.to_uppercase());
        if key.name.chars().count() == 1 {
            key.name = key.name.to_uppercase();
        }
    }
    Ok(key)
}

/// One key by its DOM name, or a single character.
fn named(name: &str) -> Option<Key> {
    let plain = |name: &str, code: &str, windows_code: u32, text: Option<&str>| Key {
        name: name.to_string(),
        code: code.to_string(),
        windows_code,
        text: text.map(str::to_string),
        modifiers: 0,
    };
    let lower = name.to_ascii_lowercase();
    Some(match lower.as_str() {
        "enter" | "return" => plain("Enter", "Enter", 13, Some("\r")),
        "tab" => plain("Tab", "Tab", 9, None),
        "escape" | "esc" => plain("Escape", "Escape", 27, None),
        "backspace" => plain("Backspace", "Backspace", 8, None),
        "delete" | "del" => plain("Delete", "Delete", 46, None),
        "insert" => plain("Insert", "Insert", 45, None),
        "space" | " " => plain(" ", "Space", 32, Some(" ")),
        "arrowup" | "up" => plain("ArrowUp", "ArrowUp", 38, None),
        "arrowdown" | "down" => plain("ArrowDown", "ArrowDown", 40, None),
        "arrowleft" | "left" => plain("ArrowLeft", "ArrowLeft", 37, None),
        "arrowright" | "right" => plain("ArrowRight", "ArrowRight", 39, None),
        "home" => plain("Home", "Home", 36, None),
        "end" => plain("End", "End", 35, None),
        "pageup" => plain("PageUp", "PageUp", 33, None),
        "pagedown" => plain("PageDown", "PageDown", 34, None),
        _ => return function_key(&lower).or_else(|| character(name)),
    })
}

/// `F1` to `F12`.
fn function_key(lower: &str) -> Option<Key> {
    let number: u32 = lower.strip_prefix('f')?.parse().ok()?;
    (1..=12).contains(&number).then(|| Key {
        name: format!("F{number}"),
        code: format!("F{number}"),
        windows_code: 111 + number,
        text: None,
        modifiers: 0,
    })
}

/// A single character: a letter, a digit, or a sign.
fn character(name: &str) -> Option<Key> {
    let mut chars = name.chars();
    // A letter is its small one unless Shift is held, as the DOM names it.
    let one = chars.next()?.to_ascii_lowercase();
    if chars.next().is_some() {
        return None;
    }
    let (code, windows_code) = if one.is_ascii_alphabetic() {
        let upper = one.to_ascii_uppercase();
        (format!("Key{upper}"), u32::from(upper))
    } else if one.is_ascii_digit() {
        (format!("Digit{one}"), u32::from(one))
    } else {
        match one {
            '+' | '=' => ("Equal".into(), 187),
            '-' => ("Minus".into(), 189),
            ',' => ("Comma".into(), 188),
            '.' => ("Period".into(), 190),
            '/' => ("Slash".into(), 191),
            ';' => ("Semicolon".into(), 186),
            '\'' => ("Quote".into(), 222),
            '[' => ("BracketLeft".into(), 219),
            ']' => ("BracketRight".into(), 221),
            '\\' => ("Backslash".into(), 220),
            '`' => ("Backquote".into(), 192),
            _ => (String::new(), 0),
        }
    };
    Some(Key {
        name: one.to_string(),
        code,
        windows_code,
        text: Some(one.to_string()),
        modifiers: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_changes_a_fields_words_is_told_from_what_moves_about() {
        for words in [
            "a",
            "Shift+B",
            "Enter",
            "Backspace",
            "Delete",
            "Control+V",
            "Meta+x",
        ] {
            assert!(chord(words).expect(words).changes_words(), "{words}");
        }
        for moving in [
            "Tab",
            "Shift+Tab",
            "Escape",
            "ArrowDown",
            "Control+A",
            "Control+C",
        ] {
            assert!(!chord(moving).expect(moving).changes_words(), "{moving}");
        }
    }

    #[test]
    fn enter_types_a_return_and_submits() {
        let key = chord("Enter").expect("key");
        assert_eq!(key.windows_code, 13);
        assert_eq!(key.text.as_deref(), Some("\r"));
        assert!(key.submits());
        let [down, up] = key.events();
        assert_eq!(down["type"], "keyDown");
        assert_eq!(up["type"], "keyUp");
    }

    #[test]
    fn a_chord_holds_its_modifiers_and_types_nothing() {
        let key = chord("Control+A").expect("key");
        assert_eq!(key.name, "a");
        assert_eq!(key.code, "KeyA");
        assert_eq!(key.windows_code, 65);
        assert_eq!(key.modifiers, CONTROL);
        assert_eq!(key.text, None);
        assert_eq!(key.events()[0]["type"], "rawKeyDown");

        let shifted = chord("Shift+Tab").expect("key");
        assert_eq!(shifted.modifiers, SHIFT);
        assert_eq!(chord("Shift+a").expect("key").text.as_deref(), Some("A"));
        assert_eq!(chord("Control++").expect("key").name, "+");
        assert_eq!(
            chord("Control+Shift+R").expect("key").modifiers,
            CONTROL | SHIFT
        );
    }

    #[test]
    fn a_name_that_is_not_a_key_is_refused() {
        assert!(chord("").is_err());
        assert!(chord("Hyper+A").is_err());
        assert!(chord("Banana").is_err());
        assert_eq!(chord("F5").expect("key").windows_code, 116);
        assert!(chord("F13").is_err());
    }

    #[test]
    fn the_presses_that_open_a_picker_are_known() {
        assert!(chord("Space").expect("key").opens_a_picker());
        assert!(chord("Alt+ArrowDown").expect("key").opens_a_picker());
        assert!(!chord("ArrowDown").expect("key").opens_a_picker());
        assert!(!chord("Control+Enter").expect("key").submits());
    }

    #[test]
    fn enter_and_control_enter_send_and_shift_enter_is_a_new_line() {
        assert!(chord("Enter").expect("key").sends());
        assert!(chord("Control+Enter").expect("key").sends());
        assert!(chord("Meta+Enter").expect("key").sends());
        assert!(!chord("Shift+Enter").expect("key").sends());
        assert!(chord("Shift+Enter").expect("key").submits());
        assert!(!chord("Alt+Enter").expect("key").sends());
        assert!(!chord("a").expect("key").sends());
    }
}
