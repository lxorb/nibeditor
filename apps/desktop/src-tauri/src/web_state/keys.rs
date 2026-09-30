//! Where this computer's keys for web logins live: the system keychain, under the same
//! service as an AI provider's key (`secrets.rs`), and nowhere else.
//!
//! | account | what |
//! | --- | --- |
//! | `web-device-key` | this computer's X25519 private key, base64 |
//! | `web-key-<n>` | the web key of generation `n`, base64 |
//! | `web-key-generation` | which generation is current |
//!
//! A build under any identifier but the shipped one adds `@<identifier>` to each name,
//! so a probe never touches the keys of the app somebody installed.
//!
//! Older generations are kept, because a bundle sealed a moment before a rotation is
//! still worth opening; forgetting takes all of them. Nothing here ever hands a
//! private key or the web key to the window: the commands in `web_state.rs` answer with
//! public keys, wraps, digits and names.
//!
//! The rules are written against `Vault`, so they are tested with a map rather than the
//! machine's own keychain.

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use zeroize::Zeroizing;

use super::crypto::{unwrap, DeviceKey, WebKey, KEY};

/// The keychain account of this computer's private key.
const DEVICE: &str = "web-device-key";

/// The keychain account that says which generation of the web key is current.
const CURRENT: &str = "web-key-generation";

/// The keychain account of one generation's web key.
fn generation(number: u32) -> String {
    format!("web-key-{number}")
}

/// A place secrets are kept by name.
pub(crate) trait Vault {
    /// The secret kept under `name`, or nothing where none is.
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String>;
    /// Keeps `secret` under `name`, replacing what was there.
    fn write(&self, name: &str, secret: &str) -> Result<(), String>;
    /// Takes the secret under `name` away; one that was never there is not a failure.
    fn forget(&self, name: &str) -> Result<(), String>;
}

/// The identifier the app ships under: its keys are filed under the plain names above.
const SHIPPED: &str = "ch.emilvinu.nib";

/// The machine's own keychain, as one build of the app sees it.
///
/// The app that ships files its keys under the plain names; any other build (a probe,
/// a development build under an identifier of its own) under the same names with
/// `@<identifier>` after them. The keychain is the user's and outlives every build, so
/// a probe's keys must never be the ones the app somebody installed finds there.
pub(crate) struct Keychain {
    scope: String,
}

impl Keychain {
    /// The keychain as this build of the app files keys in it.
    pub(crate) fn of(app: &tauri::AppHandle) -> Self {
        let identifier = &app.config().identifier;
        Self {
            scope: if identifier == SHIPPED {
                String::new()
            } else {
                format!("@{identifier}")
            },
        }
    }

    fn entry(&self, name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(crate::secrets::SERVICE, &format!("{name}{}", self.scope))
            .map_err(|error| error.to_string())
    }
}

impl Vault for Keychain {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
        match self.entry(name)?.get_password() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn write(&self, name: &str, secret: &str) -> Result<(), String> {
        self.entry(name)?
            .set_password(secret)
            .map_err(|error| error.to_string())
    }

    fn forget(&self, name: &str) -> Result<(), String> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// A vault in memory, for the tests.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct Memory(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl Vault for Memory {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
        let held = self.0.lock().map_err(|_| "poisoned".to_owned())?;
        Ok(held.get(name).cloned().map(Zeroizing::new))
    }

    fn write(&self, name: &str, secret: &str) -> Result<(), String> {
        let mut held = self.0.lock().map_err(|_| "poisoned".to_owned())?;
        held.insert(name.to_owned(), secret.to_owned());
        Ok(())
    }

    fn forget(&self, name: &str) -> Result<(), String> {
        let mut held = self.0.lock().map_err(|_| "poisoned".to_owned())?;
        held.remove(name);
        Ok(())
    }
}

/// Thirty-two bytes out of base64, or why not.
fn key_bytes(text: &str) -> Result<Zeroizing<[u8; KEY]>, String> {
    let decoded = Zeroizing::new(
        STANDARD
            .decode(text.trim())
            .map_err(|_| "a key in the keychain is not base64".to_owned())?,
    );
    let mut out = Zeroizing::new([0u8; KEY]);
    if decoded.len() != KEY {
        return Err("a key in the keychain is the wrong length".to_owned());
    }
    out.copy_from_slice(&decoded);
    Ok(out)
}

/// A public key the window handed over, out of base64.
pub(crate) fn public_key(text: &str) -> Result<[u8; KEY], String> {
    let decoded = STANDARD
        .decode(text.trim())
        .map_err(|_| "that is not a computer's key".to_owned())?;
    decoded
        .try_into()
        .map_err(|_| "that is not a computer's key".to_owned())
}

/// This computer's key pair, made and kept the first time it is asked for.
pub(crate) fn device(vault: &impl Vault) -> Result<DeviceKey, String> {
    if let Some(kept) = vault.read(DEVICE)? {
        return Ok(DeviceKey::from_bytes(key_bytes(&kept)?));
    }
    let made = DeviceKey::fresh()?;
    let text = Zeroizing::new(STANDARD.encode(made.secret_bytes().as_ref()));
    vault.write(DEVICE, &text)?;
    Ok(made)
}

/// Which generation of the web key is current here, or none on a computer that has
/// not been given one.
pub(crate) fn current_generation(vault: &impl Vault) -> Result<Option<u32>, String> {
    vault
        .read(CURRENT)?
        .map(|text| {
            text.trim()
                .parse()
                .map_err(|_| "the web key's generation in the keychain is not a number".to_owned())
        })
        .transpose()
}

/// The web key of one generation, if this computer has it.
pub(crate) fn at(vault: &impl Vault, number: u32) -> Result<Option<WebKey>, String> {
    vault
        .read(&generation(number))?
        .map(|text| Ok(WebKey::from_bytes(key_bytes(&text)?, number)))
        .transpose()
}

/// The current web key, if this computer has one.
pub(crate) fn current(vault: &impl Vault) -> Result<Option<WebKey>, String> {
    match current_generation(vault)? {
        Some(number) => at(vault, number),
        None => Ok(None),
    }
}

/// Keeps one generation's key, and makes it current unless a newer one already is.
fn keep(vault: &impl Vault, key: &WebKey) -> Result<(), String> {
    let text = Zeroizing::new(STANDARD.encode(key.bytes().as_ref()));
    vault.write(&generation(key.generation()), &text)?;
    if current_generation(vault)?.is_none_or(|now| now < key.generation()) {
        vault.write(CURRENT, &key.generation().to_string())?;
    }
    Ok(())
}

/// A new web key, one generation on from the current one (or the first), kept and
/// made current: the first computer to upload web state makes one, and so does the
/// next upload after a computer was ended.
pub(crate) fn rotate(vault: &impl Vault) -> Result<WebKey, String> {
    let next = current_generation(vault)?.map_or(1, |now| now.saturating_add(1));
    let made = WebKey::fresh(next)?;
    keep(vault, &made)?;
    Ok(made)
}

/// Takes a web key another computer wrapped to this one's public key, and keeps it. A
/// generation older than the current one is kept for opening old bundles but does not
/// become current: an approval that arrives late never takes a computer back.
pub(crate) fn accept(vault: &impl Vault, wrapped: &[u8], number: u32) -> Result<(), String> {
    let key = unwrap(wrapped, number, &device(vault)?)?;
    keep(vault, &key)
}

/// Every key of this computer's taken away: what signing out does. Generations are
/// walked down from the current one, since a keychain cannot be listed.
pub(crate) fn forget(vault: &impl Vault) -> Result<(), String> {
    if let Some(now) = current_generation(vault)? {
        for number in (1..=now).rev() {
            vault.forget(&generation(number))?;
        }
    }
    vault.forget(CURRENT)?;
    vault.forget(DEVICE)
}

#[cfg(test)]
mod tests {
    use super::super::crypto::wrap;
    use super::{accept, at, current, current_generation, device, forget, rotate, Memory, Vault};

    /// The first ask makes a key pair and every later one answers the same.
    #[test]
    fn the_device_key_is_made_once() {
        let vault = Memory::default();
        let first = device(&vault).expect("made").public();
        assert_eq!(device(&vault).expect("kept").public(), first);
    }

    /// The first rotation is generation one, the next two, and each is current.
    #[test]
    fn a_rotation_moves_the_generation_on() {
        let vault = Memory::default();
        assert!(current(&vault).expect("read").is_none());
        let one = rotate(&vault).expect("one");
        assert_eq!(one.generation(), 1);
        let two = rotate(&vault).expect("two");
        assert_eq!(two.generation(), 2);
        assert_eq!(current_generation(&vault).expect("read"), Some(2));
        assert_eq!(
            current(&vault).expect("read").expect("a key").bytes(),
            two.bytes()
        );
        // The older one is still there, for bundles sealed before the rotation.
        assert_eq!(
            at(&vault, 1).expect("read").expect("kept").bytes(),
            one.bytes()
        );
    }

    /// A key wrapped on one computer is the same key on the other, and a late approval
    /// of an older generation does not take the newer one's place.
    #[test]
    fn a_wrapped_key_is_accepted_on_the_other_computer() {
        let laptop = Memory::default();
        let desktop = Memory::default();
        let key = rotate(&laptop).expect("made");
        let desktop_public = device(&desktop).expect("a key pair").public();

        let wrapped = wrap(&key, &desktop_public).expect("wrapped");
        accept(&desktop, &wrapped, 1).expect("accepted");
        let there = current(&desktop).expect("read").expect("a key");
        assert_eq!(there.bytes(), key.bytes());
        assert_eq!(
            there.lease("global", "ethz.ch"),
            key.lease("global", "ethz.ch")
        );

        let newer = rotate(&laptop).expect("rotated");
        accept(
            &desktop,
            &wrap(&newer, &desktop_public).expect("wrapped"),
            2,
        )
        .expect("accepted");
        accept(&desktop, &wrapped, 1).expect("accepted again");
        assert_eq!(current_generation(&desktop).expect("read"), Some(2));

        // Wrapped for the laptop, it does not open on the desktop.
        let laptop_public = device(&laptop).expect("a key pair").public();
        assert!(accept(&desktop, &wrap(&key, &laptop_public).expect("wrapped"), 1).is_err());
    }

    /// Forgetting leaves nothing behind: no key pair, no generation, no web key.
    #[test]
    fn forgetting_takes_every_key() {
        let vault = Memory::default();
        device(&vault).expect("made");
        rotate(&vault).expect("one");
        rotate(&vault).expect("two");
        forget(&vault).expect("forgotten");
        for name in [
            "web-device-key",
            "web-key-generation",
            "web-key-1",
            "web-key-2",
        ] {
            assert!(
                vault.read(name).expect("read").is_none(),
                "{name} is still there"
            );
        }
    }
}
