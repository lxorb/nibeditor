//! The reader's AI accounts, kept once for every window of the app (docs/ai.md,
//! "Accounts").
//!
//! **Why a file of the crate's.** The accounts used to be a row in the page's own
//! storage, and a page's storage belongs to one browsing profile: the system's engine
//! and nib's own Chromium are two profiles, so switching engines started with no
//! accounts and the reader typed every key again, though each was still in the
//! keychain under its account's id. A file in the app's data folder is the same file
//! for every window, both engines and every space, and survives an update.
//!
//! **What is in it.** Which accounts there are, which of each provider is active, and
//! what each feature asks: the window's JSON, checked by the window on the way back in
//! (`src/lib/ai/accounts.ts`). Nothing secret. A key is in the keychain under the
//! account's id (secrets.rs), and a program's sign-in is the program's own.
//!
//! **Two windows at once.** A write names the stamp of the text it changed; a write
//! made over a text that has changed since is refused, and the window reads the new text
//! and makes its change again. Each write is said to every window, so a switch in one is
//! a switch in all of them.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::paths::{made, write_privately};

/// What every window hears when the accounts change.
const EVENT: &str = "nib://ai-accounts";

/// The most the file may be: hundreds of accounts, and a ceiling on one write.
const MOST_BYTES: usize = 256 * 1024;

/// One write at a time, so two windows' writes cannot interleave between the stamp
/// being checked and the file being written.
static WRITING: Mutex<()> = Mutex::new(());

/// Whether the call came from the app's own page rather than a web page in it.
fn ours(webview: &tauri::Webview) -> Result<(), String> {
    let label = webview.label();
    #[cfg(desktop)]
    let own = crate::launch::is_document_window(label);
    #[cfg(mobile)]
    let own = true;
    if own && label == webview.window().label() {
        Ok(())
    } else {
        Err("only nib's own window may ask that".into())
    }
}

/// The folder the accounts and the homes kept for them are under: the app's local data,
/// beside the threads, and not the roaming settings, since it names folders that hold
/// sign-ins.
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(folder.join("ai"))
}

fn file(root: &Path) -> PathBuf {
    root.join("accounts.json")
}

/// The stamp of a text: its 64-bit FNV-1a hash in sixteen hex digits, and the empty
/// string for no text at all. A stamp tells two versions of one small file apart, not a
/// secret, so a hash every build and every platform computes alike is all it needs.
fn stamp_of(text: Option<&str>) -> String {
    text.map(|text| {
        let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        });
        format!("{hash:016x}")
    })
    .unwrap_or_default()
}

/// The file's text, or nothing where there is none.
fn read_text(root: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(file(root)) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read the accounts: {error}")),
    }
}

/// What a read answers: the text, and the stamp a write of a change to it names.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Kept {
    text: Option<String>,
    stamp: String,
}

pub fn read(root: &Path) -> Result<Kept, String> {
    let text = read_text(root)?;
    let stamp = stamp_of(text.as_deref());
    Ok(Kept { text, stamp })
}

/// Writes `text` over the text whose stamp is `over`, and answers the new stamp. Refused
/// with `stale` where the file changed since that stamp was read, with nothing written.
pub fn write(root: &Path, text: &str, over: &str) -> Result<String, String> {
    if text.len() > MOST_BYTES {
        return Err("too many accounts to keep".into());
    }
    let shape: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "that is not the accounts".to_owned())?;
    if !shape.is_object() {
        return Err("that is not the accounts".into());
    }
    let _held = WRITING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if stamp_of(read_text(root)?.as_deref()) != over {
        return Err("stale".into());
    }
    made(root)?;
    write_privately(&file(root), text.as_bytes())?;
    Ok(stamp_of(Some(text)))
}

/// Whether `id` is kept as an account that is a second sign-in to `kind`'s program, and
/// so has a home of nib's: the window says so (`own`), and only for a program's kind.
/// Read here rather than taken from the window, so a page can name an account and never
/// a folder.
#[cfg(desktop)]
pub fn has_own_home(root: &Path, id: &str, kind: &str) -> Result<bool, String> {
    if kind != "claude-code" && kind != "codex" {
        return Ok(false);
    }
    let Some(text) = read_text(root)? else {
        return Ok(false);
    };
    let kept: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "the accounts cannot be read".to_owned())?;
    let account = kept
        .get("accounts")
        .and_then(serde_json::Value::as_array)
        .and_then(|all| {
            all.iter()
                .find(|one| one.get("id").and_then(serde_json::Value::as_str) == Some(id))
        });
    match account {
        None => Err(format!("{id} is not an account")),
        Some(one) => Ok(
            one.get("kind").and_then(serde_json::Value::as_str) == Some(kind)
                && one.get("own").and_then(serde_json::Value::as_bool) == Some(true),
        ),
    }
}

/// The folder a second sign-in's program keeps its login in: `homes/<id>` under the
/// accounts. An id is the window's own, letters, digits, `-` and `_`, so it can only
/// ever name a folder there.
#[cfg(desktop)]
pub fn home_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    let fits = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(root.join("homes").join(id))
    } else {
        Err(format!("{id} is not an account"))
    }
}

/// The accounts as they are kept.
#[tauri::command(async)]
pub fn ai_accounts_read(webview: tauri::Webview, app: AppHandle) -> Result<Kept, String> {
    ours(&webview)?;
    read(&root(&app)?)
}

/// The accounts written over the text stamped `stamp`, said to every window.
#[tauri::command(async)]
pub fn ai_accounts_write(
    webview: tauri::Webview,
    app: AppHandle,
    text: String,
    stamp: String,
) -> Result<String, String> {
    ours(&webview)?;
    let written = write(&root(&app)?, &text, &stamp)?;
    let _ = app.emit(EVENT, &written);
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nib-ai-accounts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn nothing_kept_reads_as_no_text_and_the_empty_stamp() {
        let root = folder("none");
        assert_eq!(
            read(&root).expect("read"),
            Kept {
                text: None,
                stamp: String::new()
            }
        );
    }

    #[test]
    fn a_write_reads_back_with_its_stamp() {
        let root = folder("round");
        let stamp = write(&root, r#"{"accounts":[]}"#, "").expect("written");
        let kept = read(&root).expect("read");
        assert_eq!(kept.text.as_deref(), Some(r#"{"accounts":[]}"#));
        assert_eq!(kept.stamp, stamp);
        assert_eq!(stamp.len(), 16);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_write_over_a_text_that_changed_since_is_refused() {
        let root = folder("stale");
        let first = write(&root, r#"{"a":1}"#, "").expect("first");
        // A second window wrote, from the same first read.
        write(&root, r#"{"a":2}"#, &first).expect("second");
        assert_eq!(write(&root, r#"{"a":3}"#, &first), Err("stale".to_owned()));
        // A first write is refused as well where something is already there.
        assert_eq!(write(&root, r#"{"a":4}"#, ""), Err("stale".to_owned()));
        assert_eq!(
            read(&root).expect("read").text.as_deref(),
            Some(r#"{"a":2}"#)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(desktop)]
    #[test]
    fn only_a_second_sign_in_to_that_program_has_a_home_of_its_own() {
        let root = folder("homes");
        let text = r#"{"accounts":[
            {"id":"claude-code","kind":"claude-code","name":"","model":""},
            {"id":"claude-code-2","kind":"claude-code","name":"","model":"","own":true},
            {"id":"anthropic","kind":"anthropic","name":"","model":"","own":true}
        ]}"#;
        write(&root, text, "").expect("written");
        assert_eq!(has_own_home(&root, "claude-code", "claude-code"), Ok(false));
        assert_eq!(
            has_own_home(&root, "claude-code-2", "claude-code"),
            Ok(true)
        );
        // A home is a program's: neither another program's nor a key's.
        assert_eq!(has_own_home(&root, "claude-code-2", "codex"), Ok(false));
        assert_eq!(has_own_home(&root, "anthropic", "anthropic"), Ok(false));
        assert!(has_own_home(&root, "nobody", "claude-code").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(desktop)]
    #[test]
    fn a_home_is_always_a_folder_under_the_homes() {
        let root = PathBuf::from("ai");
        assert_eq!(
            home_dir(&root, "codex-2"),
            Ok(root.join("homes").join("codex-2"))
        );
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:", &"x".repeat(65)] {
            assert!(home_dir(&root, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_an_object_is_kept() {
        let root = folder("shape");
        for text in ["[]", "nonsense", "\"x\"", ""] {
            assert!(write(&root, text, "").is_err(), "{text:?}");
        }
        assert!(write(
            &root,
            &format!("{{\"a\":\"{}\"}}", "x".repeat(MOST_BYTES)),
            ""
        )
        .is_err());
        assert_eq!(read(&root).expect("read").text, None);
    }
}
