//! The arithmetic of carrying web logins end to end: nothing here touches a keychain,
//! a file or an engine, so all of it is tested on its own.
//!
//! Three kinds of key, as docs/sync-v2.md 6.6 lays out:
//!
//! - **a device key**: an X25519 key pair per computer. The public half is what the
//!   account knows the computer by; the private half never leaves the keychain.
//! - **the web key**: 32 random bytes and a generation, the same on every approved
//!   computer, which the account only ever holds **wrapped** to one computer's public
//!   key. A wrap is a sealed box: libsodium's shape (an ephemeral key per box, the
//!   output `ephemeral public key || ciphertext`, the sender anonymous) with the
//!   design's primitives, as HPKE's base mode has them - X25519, HKDF-SHA256 over the
//!   shared secret with both public keys as salt for the key and nonce, and
//!   `XChaCha20-Poly1305`. The generation is associated data, so a server cannot hand a
//!   computer last year's key as this year's.
//! - **what the web key derives**: a sealing key (`XChaCha20-Poly1305`, a random 24-byte
//!   nonce per object, the store, site, generation and kind as associated data, so a
//!   chunk of one site cannot be passed off as another's or as a manifest), and a
//!   naming key (HMAC-SHA256), which names lease keys and chunks without saying what
//!   they are.
//!
//! And the six digits two screens compare while a new computer is approved, from the
//! new computer's public key: a server that swapped in a key of its own would show
//! different ones.

use chacha20poly1305::aead::{Aead as _, KeyInit as _, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac as _};
use sha2::{Digest as _, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

/// How long every key here is, in bytes: an X25519 key and the web key both.
pub(crate) const KEY: usize = 32;

/// How long a nonce is: `XChaCha20`'s, long enough to be picked at random every time.
const NONCE: usize = 24;

/// The first byte of everything sealed or wrapped, so a format that changes one day can
/// be told from this one rather than failing to open for no stated reason.
const FORMAT: u8 = 1;

/// Why each key is derived, as HKDF's `info`: one purpose, one key.
const SEALING: &[u8] = b"nib web seal v1";
const NAMING: &[u8] = b"nib web names v1";
const WRAPPING: &[u8] = b"nib sealed box v1";

/// What an object sealed with the web key is bound to: opening it anywhere else fails.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A bundle's manifest.
    Manifest,
    /// One `IndexedDB` database of a bundle.
    Chunk,
}

/// The store and site an object belongs to, and which of the two it is.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Bound<'a> {
    pub kind: Kind,
    pub store: &'a str,
    pub site: &'a str,
}

/// Fresh bytes from the system's own randomness.
fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|error| format!("no randomness to make a key: {error}"))?;
    Ok(bytes)
}

/// One 32-byte key out of another, for one purpose.
fn derived(key: &[u8], purpose: &[u8]) -> Zeroizing<[u8; KEY]> {
    let mut out = Zeroizing::new([0u8; KEY]);
    // Thirty-two bytes is far below HKDF's limit of 255 hash lengths, so this cannot fail.
    let _ = Hkdf::<Sha256>::new(None, key).expand(purpose, out.as_mut());
    out
}

/// A computer's own key pair.
pub(crate) struct DeviceKey {
    secret: StaticSecret,
}

impl DeviceKey {
    /// A new pair, from the system's randomness.
    pub(crate) fn fresh() -> Result<Self, String> {
        Ok(Self::from_bytes(Zeroizing::new(random::<KEY>()?)))
    }

    /// The pair whose private half these bytes are.
    pub(crate) fn from_bytes(bytes: Zeroizing<[u8; KEY]>) -> Self {
        Self {
            secret: StaticSecret::from(*bytes),
        }
    }

    /// The private half, for the keychain and nothing else.
    pub(crate) fn secret_bytes(&self) -> Zeroizing<[u8; KEY]> {
        Zeroizing::new(self.secret.to_bytes())
    }

    /// The public half: what the account knows this computer by.
    pub(crate) fn public(&self) -> [u8; KEY] {
        PublicKey::from(&self.secret).to_bytes()
    }
}

/// The web key of one generation.
pub(crate) struct WebKey {
    bytes: Zeroizing<[u8; KEY]>,
    generation: u32,
}

impl WebKey {
    /// A new one, from the system's randomness.
    pub(crate) fn fresh(generation: u32) -> Result<Self, String> {
        Ok(Self::from_bytes(
            Zeroizing::new(random::<KEY>()?),
            generation,
        ))
    }

    /// The key these bytes are.
    pub(crate) fn from_bytes(bytes: Zeroizing<[u8; KEY]>, generation: u32) -> Self {
        Self { bytes, generation }
    }

    /// The key itself, for the keychain and for a wrap, and nothing else.
    pub(crate) fn bytes(&self) -> &[u8; KEY] {
        &self.bytes
    }

    /// Which generation it is.
    pub(crate) fn generation(&self) -> u32 {
        self.generation
    }

    /// Seals `plaintext` for `bound`: `FORMAT || nonce || ciphertext and tag`.
    pub(crate) fn seal(&self, bound: Bound<'_>, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let key = derived(self.bytes.as_ref(), SEALING);
        let cipher = XChaCha20Poly1305::new(key.as_ref().into());
        let nonce = random::<NONCE>()?;
        let sealed = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: &associated(bound, self.generation),
                },
            )
            .map_err(|_| "that could not be sealed".to_owned())?;

        let mut out = Vec::with_capacity(1 + NONCE + sealed.len());
        out.push(FORMAT);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    /// Opens what `seal` made for the same `bound` under this key, and refuses anything
    /// else: another key, another generation, another store, site or kind, or a single
    /// byte changed.
    pub(crate) fn open(&self, bound: Bound<'_>, sealed: &[u8]) -> Result<Vec<u8>, String> {
        let refused = || "that web state does not open with this key".to_owned();
        let (&format, rest) = sealed.split_first().ok_or_else(refused)?;
        if format != FORMAT || rest.len() < NONCE {
            return Err(refused());
        }
        let (nonce, ciphertext) = rest.split_at(NONCE);

        let key = derived(self.bytes.as_ref(), SEALING);
        XChaCha20Poly1305::new(key.as_ref().into())
            .decrypt(
                XNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &associated(bound, self.generation),
                },
            )
            .map_err(|_| refused())
    }

    /// An opaque name for `parts` taken together: HMAC-SHA256 under the naming key,
    /// in lower-case hex. The same parts always make the same name under one key, and
    /// nothing about them can be read back out of it.
    pub(crate) fn name(&self, parts: &[&[u8]]) -> String {
        let key = derived(self.bytes.as_ref(), NAMING);
        // HMAC takes a key of any length, so this cannot fail.
        let mut mac = <Hmac<Sha256> as hmac::Mac>::new_from_slice(key.as_ref())
            .unwrap_or_else(|_| unreachable!("HMAC takes any key length"));
        for part in parts {
            mac.update(part);
        }
        hex(&mac.finalize().into_bytes())
    }

    /// The lease key of a site in a store, as the hub is told it: `HMAC(store + "\n" +
    /// site)`, exactly as docs/sync-v2.md 6.2 has it, so the hub never learns which sites
    /// anybody is signed in to.
    pub(crate) fn lease(&self, store: &str, site: &str) -> String {
        self.name(&[store.as_bytes(), b"\n", site.as_bytes()])
    }

    /// A chunk's name: its plaintext, bound to the store and site it was taken from. The
    /// same database unchanged is the same name, so it is never uploaded twice; the same
    /// bytes in two stores are two names, because each is sealed for its own store.
    pub(crate) fn chunk(&self, store: &str, site: &str, plaintext: &[u8]) -> String {
        self.name(&[
            b"chunk\n",
            store.as_bytes(),
            b"\n",
            site.as_bytes(),
            b"\n",
            plaintext,
        ])
    }
}

/// What a sealed object is bound to, as bytes: every field with its length in front,
/// so no two different bindings are ever the same bytes.
fn associated(bound: Bound<'_>, generation: u32) -> Vec<u8> {
    let kind: &[u8] = match bound.kind {
        Kind::Manifest => b"manifest",
        Kind::Chunk => b"chunk",
    };
    let mut out = b"nib web state v1".to_vec();
    for field in [kind, bound.store.as_bytes(), bound.site.as_bytes()] {
        out.extend_from_slice(&u32::try_from(field.len()).unwrap_or(u32::MAX).to_be_bytes());
        out.extend_from_slice(field);
    }
    out.extend_from_slice(&generation.to_be_bytes());
    out
}

/// The key and nonce a sealed box is made under, from the shared secret and both
/// public keys.
fn boxed(shared: &[u8; KEY], ephemeral: &[u8; KEY], recipient: &[u8; KEY]) -> Zeroizing<[u8; 56]> {
    let mut salt = [0u8; 2 * KEY];
    salt[..KEY].copy_from_slice(ephemeral);
    salt[KEY..].copy_from_slice(recipient);
    let mut out = Zeroizing::new([0u8; 56]);
    // Fifty-six bytes is far below HKDF's limit, so this cannot fail.
    let _ = Hkdf::<Sha256>::new(Some(&salt), shared).expand(WRAPPING, out.as_mut());
    out
}

/// What a wrap is bound to: the generation, and the computer it is for.
fn wrapped_for(generation: u32, recipient: &[u8; KEY]) -> Vec<u8> {
    let mut out = b"nib web key v1".to_vec();
    out.extend_from_slice(&generation.to_be_bytes());
    out.extend_from_slice(recipient);
    out
}

/// The web key sealed to one computer's public key: `FORMAT || ephemeral public key ||
/// ciphertext and tag`, 81 bytes, which only that computer's private key opens.
pub(crate) fn wrap(web: &WebKey, recipient: &[u8; KEY]) -> Result<Vec<u8>, String> {
    let ephemeral = StaticSecret::from(random::<KEY>()?);
    let ephemeral_public = PublicKey::from(&ephemeral).to_bytes();
    let shared = ephemeral.diffie_hellman(&PublicKey::from(*recipient));
    // A public key of low order gives every sender the same secret; it is not a
    // computer's key, whatever the account says.
    if !shared.was_contributory() {
        return Err("that is not a computer's key".to_owned());
    }

    let derived = boxed(shared.as_bytes(), &ephemeral_public, recipient);
    let (key, nonce) = derived.split_at(KEY);
    let sealed = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: web.bytes().as_ref(),
                aad: &wrapped_for(web.generation(), recipient),
            },
        )
        .map_err(|_| "the web key could not be wrapped".to_owned())?;

    let mut out = Vec::with_capacity(1 + KEY + sealed.len());
    out.push(FORMAT);
    out.extend_from_slice(&ephemeral_public);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// The web key out of a wrap made for this computer and this generation.
pub(crate) fn unwrap(
    wrapped: &[u8],
    generation: u32,
    device: &DeviceKey,
) -> Result<WebKey, String> {
    let refused = || "that web key was not wrapped for this computer".to_owned();
    let (&format, rest) = wrapped.split_first().ok_or_else(refused)?;
    if format != FORMAT || rest.len() != KEY + KEY + 16 {
        return Err(refused());
    }
    let (ephemeral, sealed) = rest.split_at(KEY);
    let mut ephemeral_public = [0u8; KEY];
    ephemeral_public.copy_from_slice(ephemeral);

    let recipient = device.public();
    let shared = device
        .secret
        .diffie_hellman(&PublicKey::from(ephemeral_public));
    if !shared.was_contributory() {
        return Err(refused());
    }

    let derived = boxed(shared.as_bytes(), &ephemeral_public, &recipient);
    let (key, nonce) = derived.split_at(KEY);
    let opened = Zeroizing::new(
        XChaCha20Poly1305::new(key.into())
            .decrypt(
                XNonce::from_slice(nonce),
                Payload {
                    msg: sealed,
                    aad: &wrapped_for(generation, &recipient),
                },
            )
            .map_err(|_| refused())?,
    );

    let mut bytes = Zeroizing::new([0u8; KEY]);
    if opened.len() != KEY {
        return Err(refused());
    }
    bytes.copy_from_slice(&opened);
    Ok(WebKey::from_bytes(bytes, generation))
}

/// The six digits both screens show while a computer is approved: SHA-256 of its public
/// key, read as one big-endian number, modulo a million, with its leading zeros.
pub(crate) fn digits(public: &[u8]) -> String {
    let hash = Sha256::digest(public);
    let left = hash.iter().fold(0u32, |left, byte| {
        (left * 256 + u32::from(*byte)) % 1_000_000
    });
    format!("{left:06}")
}

/// Bytes as lower-case hex.
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

#[cfg(test)]
mod tests {
    use super::{digits, unwrap, wrap, Bound, DeviceKey, Kind, WebKey, KEY};
    use zeroize::Zeroizing;

    fn key(fill: u8, generation: u32) -> WebKey {
        WebKey::from_bytes(Zeroizing::new([fill; KEY]), generation)
    }

    const MANIFEST: Bound<'static> = Bound {
        kind: Kind::Manifest,
        store: "global",
        site: "ethz.ch",
    };

    /// What is sealed opens again, under the same key and binding, to the same bytes.
    #[test]
    fn a_sealed_object_opens_to_what_went_in() {
        let web = key(7, 1);
        let large = vec![0u8; 100_000];
        for plaintext in [&b""[..], b"x", &large[..]] {
            let sealed = web.seal(MANIFEST, plaintext).expect("sealed");
            assert_eq!(sealed.len(), 1 + 24 + plaintext.len() + 16);
            assert_eq!(web.open(MANIFEST, &sealed).expect("opened"), plaintext);
        }
    }

    /// A fresh nonce every time: the same plaintext sealed twice is two ciphertexts.
    #[test]
    fn the_same_plaintext_seals_differently_each_time() {
        let web = key(7, 1);
        assert_ne!(web.seal(MANIFEST, b"x").ok(), web.seal(MANIFEST, b"x").ok());
    }

    /// One byte changed anywhere, and it does not open.
    #[test]
    fn a_tampered_ciphertext_is_refused() {
        let web = key(7, 1);
        let sealed = web.seal(MANIFEST, b"a login").expect("sealed");
        for at in 0..sealed.len() {
            let mut changed = sealed.clone();
            changed[at] ^= 1;
            assert!(
                web.open(MANIFEST, &changed).is_err(),
                "byte {at} went unnoticed"
            );
        }
        assert!(web.open(MANIFEST, &sealed[..sealed.len() - 1]).is_err());
        assert!(web.open(MANIFEST, &[]).is_err());
    }

    /// Sealed for one store, site, kind or generation, it opens for no other.
    #[test]
    fn the_wrong_associated_data_is_refused() {
        let web = key(7, 1);
        let sealed = web.seal(MANIFEST, b"a login").expect("sealed");
        for other in [
            Bound {
                kind: Kind::Chunk,
                ..MANIFEST
            },
            Bound {
                store: "space_1",
                ..MANIFEST
            },
            Bound {
                site: "uzh.ch",
                ..MANIFEST
            },
            // The two fields' boundary moved: length prefixes keep these apart.
            Bound {
                store: "globale",
                site: "thz.ch",
                ..MANIFEST
            },
        ] {
            assert!(web.open(other, &sealed).is_err(), "{other:?} opened it");
        }
        assert!(
            key(7, 2).open(MANIFEST, &sealed).is_err(),
            "another generation opened it"
        );
        assert!(
            key(8, 1).open(MANIFEST, &sealed).is_err(),
            "another key opened it"
        );
    }

    /// Wrapped to one computer's key, the web key comes out of the other end whole, and
    /// only there.
    #[test]
    fn a_wrap_opens_for_its_computer_only() {
        let web = WebKey::fresh(3).expect("a key");
        let laptop = DeviceKey::fresh().expect("a laptop");
        let desktop = DeviceKey::fresh().expect("a desktop");

        let wrapped = wrap(&web, &desktop.public()).expect("wrapped");
        assert_eq!(wrapped.len(), 81);
        let opened = unwrap(&wrapped, 3, &desktop).expect("unwrapped");
        assert_eq!(opened.bytes(), web.bytes());
        assert_eq!(opened.generation(), 3);

        assert!(
            unwrap(&wrapped, 3, &laptop).is_err(),
            "another computer opened it"
        );
        assert!(
            unwrap(&wrapped, 4, &desktop).is_err(),
            "another generation opened it"
        );
        let mut changed = wrapped.clone();
        changed[40] ^= 1;
        assert!(unwrap(&changed, 3, &desktop).is_err());
        assert!(unwrap(&wrapped[..80], 3, &desktop).is_err());
    }

    /// A public key of low order is not anybody's: nothing is wrapped to it.
    #[test]
    fn a_low_order_key_is_refused() {
        let web = key(1, 1);
        assert!(wrap(&web, &[0u8; KEY]).is_err());
        let mut one = [0u8; KEY];
        one[0] = 1;
        assert!(wrap(&web, &one).is_err());
    }

    /// A device key made again from its private half is the same key.
    #[test]
    fn a_device_key_survives_the_keychain() {
        let made = DeviceKey::fresh().expect("a key");
        let again = DeviceKey::from_bytes(made.secret_bytes());
        assert_eq!(made.public(), again.public());
        assert_ne!(made.public(), DeviceKey::fresh().expect("another").public());
    }

    /// Six digits, always, the same for the same key, pinned for one key so the other
    /// screen's arithmetic (and a change here) can be checked against it.
    #[test]
    fn the_digits_are_six_and_stable() {
        let public = [9u8; KEY];
        assert_eq!(digits(&public), digits(&public));
        assert_eq!(digits(&public).len(), 6);
        assert!(digits(&public).bytes().all(|one| one.is_ascii_digit()));
        // SHA-256 of thirty-two nines, 0x8c0cc17a..., as one number, modulo a million;
        // worked out apart from this code, in Python.
        assert_eq!(digits(&public), "358277");
        for fill in 0..=255u8 {
            assert_eq!(digits(&[fill; KEY]).len(), 6);
        }
    }

    /// Names are hex, stable under one key, different under another, and never the
    /// same for two different things.
    #[test]
    fn names_are_stable_and_say_nothing() {
        let web = key(7, 1);
        let lease = web.lease("global", "ethz.ch");
        assert_eq!(lease.len(), 64);
        assert!(lease
            .bytes()
            .all(|one| one.is_ascii_hexdigit() && !one.is_ascii_uppercase()));
        assert_eq!(lease, web.lease("global", "ethz.ch"));
        assert_ne!(lease, web.lease("global", "uzh.ch"));
        assert_ne!(lease, web.lease("space_1", "ethz.ch"));
        assert_ne!(lease, key(8, 1).lease("global", "ethz.ch"));
        assert!(!lease.contains("ethz"));

        let chunk = web.chunk("global", "ethz.ch", b"database");
        assert_eq!(chunk, web.chunk("global", "ethz.ch", b"database"));
        assert_ne!(chunk, web.chunk("space_1", "ethz.ch", b"database"));
        assert_ne!(chunk, web.chunk("global", "ethz.ch", b"database!"));
        assert_ne!(chunk, lease);
        // Pinned, worked out apart from this code in Python (HKDF-SHA256 with no salt,
        // then HMAC-SHA256): a change to how names are made would orphan every lease and
        // chunk on the account.
        assert_eq!(
            lease,
            "351d3c2f49279fa6234226b82565a9a05d6790115261a6598ea33e0d294fc13c"
        );
        assert_eq!(
            web.name(&[b"a"]),
            web.name(&[b"", b"a", b""]),
            "a name is of the bytes, however they are cut"
        );
    }
}
