//! The keys an AI provider is reached with, kept in the machine's own keychain.
//!
//! A provider key is the one secret nib holds that is worth money to whoever takes
//! it, and it is the reader's own: it belongs on the device and nowhere else. The
//! account never sees one, sync never carries one, and no log ever prints one.
//!
//! So it goes where the operating system keeps secrets: the Credential Manager on
//! Windows, the Keychain on macOS, and the Secret Service on Linux, which is
//! gnome-keyring or `KWallet` depending on the desktop. The `keyring` crate is the
//! one interface to the three of them.
//!
//! The desktops and the iPhone, whose keychain is the Mac's own store under the same
//! crate feature. Android keeps them in `EncryptedSharedPreferences`, which is its own
//! answer and is reached through the activity rather than through Rust; see `Secrets`
//! in MainActivity.kt and `keys.ts` in the app. A browser has no keychain at all and
//! says so; see web/commands.ts. Until 2026-09-29 the iPhone had none of this: the
//! commands were the desktop's alone, so a key typed into the AI pane on an iPhone
//! went nowhere while the pane said it was kept safe.
//!
//! Three commands and nothing else: a key can be written, read back by the app
//! that wrote it, and taken away. Reading it back is what lets a provider be used
//! at all, since the request is made in the webview.

use keyring::{Entry, Error};

/// What the keychain files these under. One service for the app, with the
/// provider's own id as the account, so a reader looking at their keychain sees
/// one nibeditor entry per provider rather than an unexplained blob.
const SERVICE: &str = "nibeditor";

/// Refuses a name that is not one of ours.
///
/// The name reaches here from the webview, and a keychain is a store the whole
/// machine shares: without this, a page could ask for the entry another
/// application keeps under a name it guessed. Every name the app uses is a
/// provider id, which it makes itself out of these characters; see `providers.ts`.
fn named(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '-' || one == '_');

    if ok {
        Ok(name.to_owned())
    } else {
        Err("that is not a key nib keeps".to_owned())
    }
}

fn entry(name: &str) -> Result<Entry, String> {
    let account = named(name)?;
    Entry::new(SERVICE, &account).map_err(|error| error.to_string())
}

/// The key kept under `name`, or nothing where none is. An unreadable keychain is
/// an error and not an absence: a reader whose keyring is locked should be told
/// that rather than told their key has gone.
#[tauri::command(async)]
pub fn secret_read(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Writes one, replacing whatever was there.
#[tauri::command(async)]
pub fn secret_write(name: String, secret: String) -> Result<(), String> {
    entry(&name)?
        .set_password(&secret)
        .map_err(|error| error.to_string())
}

/// Takes one away. A key that was never there is not a failure: taking away what
/// is already gone is what the caller asked for.
#[tauri::command(async)]
pub fn secret_forget(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::named;

    #[test]
    fn accepts_a_provider_id() {
        assert_eq!(named("openai").as_deref(), Ok("openai"));
        assert_eq!(named("compatible-1").as_deref(), Ok("compatible-1"));
        assert_eq!(named("a_b").as_deref(), Ok("a_b"));
    }

    #[test]
    fn refuses_anything_else() {
        for name in ["", "with space", "sl/ash", "Chrome Safe Storage", "ö"] {
            assert!(named(name).is_err(), "{name}");
        }
    }

    #[test]
    fn refuses_a_name_longer_than_any_of_ours() {
        assert!(named(&"a".repeat(65)).is_err());
    }
}
