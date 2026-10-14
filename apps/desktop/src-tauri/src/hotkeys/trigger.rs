//! A key as the global shortcut plugin writes it - `Control+Alt+Space`, the notation
//! `accelerator.ts` hands the crate - in the notation the desktop portal reads a
//! preferred trigger in: the shortcuts specification's `CTRL+ALT+space`, modifiers by
//! their capitals and the key by its XKB name.

/// The portal's spelling of `accelerator`, or nothing for a key it has no name for.
pub fn preferred(accelerator: &str) -> Option<String> {
    let mut parts: Vec<&str> = accelerator.split('+').collect();
    let key = xkb(parts.pop()?)?;
    let mut said: Vec<String> = parts
        .into_iter()
        .map(|modifier| match modifier {
            "Control" | "Ctrl" | "CommandOrControl" | "CmdOrCtrl" => Some("CTRL"),
            "Alt" | "Option" => Some("ALT"),
            "Shift" => Some("SHIFT"),
            "Super" | "Meta" | "Command" | "Cmd" => Some("LOGO"),
            _ => None,
        })
        .map(|modifier| modifier.map(str::to_owned))
        .collect::<Option<_>>()?;
    said.push(key);
    Some(said.join("+"))
}

/// The XKB name of the key the plugin calls `key`.
fn xkb(key: &str) -> Option<String> {
    if let Some(digit) = key.strip_prefix("Digit") {
        return (digit.len() == 1 && digit.bytes().all(|b| b.is_ascii_digit()))
            .then(|| digit.to_owned());
    }
    if key.len() == 1 && key.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Some(key.to_ascii_lowercase());
    }
    if key.len() > 1 && key.starts_with('F') && key[1..].bytes().all(|b| b.is_ascii_digit()) {
        return Some(key.to_owned());
    }
    let named = match key {
        "Space" => "space",
        "Enter" => "Return",
        "Escape" => "Escape",
        "Tab" => "Tab",
        "Backspace" => "BackSpace",
        "Delete" => "Delete",
        "Home" => "Home",
        "End" => "End",
        "PageUp" => "Page_Up",
        "PageDown" => "Page_Down",
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        "Minus" => "minus",
        "Equal" => "equal",
        "Comma" => "comma",
        "Period" => "period",
        "Slash" => "slash",
        "Semicolon" => "semicolon",
        "Quote" => "apostrophe",
        "BracketLeft" => "bracketleft",
        "BracketRight" => "bracketright",
        "Backslash" => "backslash",
        "Backquote" => "grave",
        _ => return None,
    };
    Some(named.to_owned())
}

#[cfg(test)]
mod tests {
    use super::preferred;

    #[test]
    fn modifiers_go_by_their_capitals_and_the_key_by_its_xkb_name() {
        assert_eq!(
            preferred("Control+Alt+Space").as_deref(),
            Some("CTRL+ALT+space")
        );
        assert_eq!(
            preferred("Control+Super+Alt+Shift+K").as_deref(),
            Some("CTRL+LOGO+ALT+SHIFT+k")
        );
        assert_eq!(preferred("Alt+Digit1").as_deref(), Some("ALT+1"));
        assert_eq!(preferred("F5").as_deref(), Some("F5"));
        assert_eq!(
            preferred("Control+PageDown").as_deref(),
            Some("CTRL+Page_Down")
        );
        assert_eq!(
            preferred("Control+Quote").as_deref(),
            Some("CTRL+apostrophe")
        );
    }

    #[test]
    fn a_key_it_has_no_name_for_is_no_preference() {
        assert_eq!(preferred("Control+Hyper+K"), None);
        assert_eq!(preferred("Control+Numpad7"), None);
        assert_eq!(preferred(""), None);
    }
}
