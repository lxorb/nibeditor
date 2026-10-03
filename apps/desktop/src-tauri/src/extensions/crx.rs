//! A CRX file, checked: the format the Chrome Web Store and Edge Add-ons hand an
//! extension out in, and the only one nib takes.
//!
//! A CRX3 file is `Cr24`, the version, a header and a zip. The header is a small protobuf
//! of signatures over that zip, each beside the public key it was made with, and a
//! signed id. Chromium's own checker (`components/crx_file/crx_verifier.cc`) is the rule
//! and this is the same rule:
//!
//! - every signature in the header verifies, RSA and ECDSA alike, over
//!   `"CRX3 SignedData\0"`, the signed data's length, the signed data and the zip;
//! - one of the keys is the developer's, which is the key whose SHA-256 begins with the
//!   signed id - and that id is the extension's, the one the store page named;
//! - the store's own key signed it too. Both stores add a proof of their own to what
//!   they serve, and that proof is what says the file came from the store rather than
//!   from whoever answered the request: Edge's download is plain HTTP after a redirect.
//!
//! Nothing here touches the disk or the network. The verification itself is ring's, through
//! the algorithms rustls already carries, so no crate is added for it.

use rustls::pki_types::{alg_id, SignatureVerificationAlgorithm};
use sha2::{Digest as _, Sha256};

use super::link::Store;

/// What every CRX file starts with.
const MAGIC: &[u8; 4] = b"Cr24";

/// What the signatures are made over, before the signed data.
const SIGNED_PREFIX: &[u8] = b"CRX3 SignedData\0";

/// The largest header taken. Chromium's own cap; a real one is a couple of kilobytes.
const LONGEST_HEADER: usize = 1 << 18;

/// The SHA-256 of the Chrome Web Store's own key, which signs every file it serves.
/// Chromium's `kPublisherKeyHash`.
const CHROME_PUBLISHER: [u8; 32] = [
    0x61, 0xf7, 0xf2, 0xa6, 0xbf, 0xcf, 0x74, 0xcd, 0x0b, 0xc1, 0xfe, 0x24, 0x97, 0xcc, 0x9b, 0x04,
    0x25, 0x4c, 0x65, 0x8f, 0x79, 0xf2, 0x14, 0x53, 0x92, 0x86, 0x7e, 0xa8, 0x36, 0x63, 0x67, 0xcf,
];

/// The SHA-256 of Edge Add-ons' own ECDSA key, which signs every file it serves - read off
/// the files it serves, since Microsoft publishes no constant for it.
const EDGE_PUBLISHER: [u8; 32] = [
    0x67, 0x5b, 0xd8, 0xed, 0xdd, 0x38, 0x50, 0x20, 0x17, 0x7c, 0xcf, 0xed, 0xa2, 0x51, 0x03, 0x89,
    0x57, 0x99, 0xfe, 0x41, 0xec, 0xa5, 0xc9, 0x4e, 0x61, 0xdc, 0x13, 0xdf, 0x35, 0x9d, 0xa1, 0xdc,
];

/// A CRX file that checked out: its id, the developer's key (which goes into the
/// manifest, so the unpacked extension keeps the store's id), and the zip.
#[derive(Debug)]
pub struct Checked<'a> {
    pub id: String,
    /// The developer's public key as `SubjectPublicKeyInfo`, DER.
    pub key: Vec<u8>,
    pub zip: &'a [u8],
}

/// One signature and the key it was made with.
struct Proof<'a> {
    key: &'a [u8],
    signature: &'a [u8],
    ecdsa: bool,
}

/// `bytes`, checked as a CRX3 file for extension `id` from `store`, or why it is not one.
pub fn checked<'a>(bytes: &'a [u8], id: &str, store: Option<Store>) -> Result<Checked<'a>, String> {
    let refused = |why: &str| Err(format!("that extension's file is not one: {why}"));

    if bytes.len() < 12 || &bytes[..4] != MAGIC {
        return refused("no CRX header");
    }
    if u32_at(bytes, 4) != 3 {
        return refused("not CRX3");
    }
    let length = u32_at(bytes, 8) as usize;
    if length > LONGEST_HEADER || bytes.len() < 12 + length {
        return refused("the header is cut short");
    }
    let header = &bytes[12..12 + length];
    let zip = &bytes[12 + length..];

    let mut proofs = Vec::new();
    let mut signed: Option<&[u8]> = None;
    for (field, value) in fields(header)? {
        match field {
            2 | 3 => {
                let mut key = None;
                let mut signature = None;
                for (inner, part) in fields(value)? {
                    match inner {
                        1 => key = Some(part),
                        2 => signature = Some(part),
                        _ => {}
                    }
                }
                let (Some(key), Some(signature)) = (key, signature) else {
                    return refused("a proof without its key or signature");
                };
                proofs.push(Proof {
                    key,
                    signature,
                    ecdsa: field == 3,
                });
            }
            10_000 => signed = Some(value),
            _ => {}
        }
    }
    let Some(signed) = signed else {
        return refused("no signed id");
    };
    let crx_id = fields(signed)?
        .into_iter()
        .find_map(|(field, value)| (field == 1).then_some(value))
        .filter(|value| value.len() == 16)
        .ok_or("that extension's file is not one: no signed id")?;
    if id_of(crx_id) != id {
        return refused("it is another extension");
    }

    let mut message = Vec::with_capacity(SIGNED_PREFIX.len() + 4 + signed.len());
    message.extend_from_slice(SIGNED_PREFIX);
    message.extend_from_slice(
        &u32::try_from(signed.len())
            .unwrap_or(u32::MAX)
            .to_le_bytes(),
    );
    message.extend_from_slice(signed);

    let mut developer = None;
    let mut publisher = false;
    let mut legacy = false;
    for proof in &proofs {
        let hash: [u8; 32] = Sha256::digest(proof.key).into();
        match verified(proof, &message, zip) {
            Verdict::Good => {}
            Verdict::Legacy => legacy = true,
            Verdict::Bad => return refused("a signature does not match"),
        }
        if hash[..16] == *crx_id {
            developer = Some(proof.key.to_vec());
        }
        publisher |= match store {
            Some(Store::Chrome) => hash == CHROME_PUBLISHER,
            Some(Store::Edge) => hash == EDGE_PUBLISHER,
            None => true,
        };
    }
    let Some(key) = developer else {
        return refused("the developer did not sign it");
    };
    // An extension made before 2013 has a 1024-bit RSA key, which Chromium still takes
    // and ring will not check. Its id is still the key's hash, and the id is in the data
    // the store signed: so a store's own signature, checked, is what vouches for it, and
    // a file that came from no store is not taken with one.
    if !publisher || (legacy && store.is_none()) {
        return refused("the store did not sign it");
    }

    Ok(Checked {
        id: id.to_owned(),
        key,
        zip,
    })
}

/// How Chromium writes sixteen bytes as an id: each half-byte a letter from `a`.
pub fn id_of(bytes: &[u8]) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(b'a' + nibble))
        .collect()
}

/// The id an extension with this public key has.
#[cfg(test)]
pub fn id_of_key(key: &[u8]) -> String {
    id_of(&Sha256::digest(key)[..16])
}

/// What a proof's signature came to.
#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    Good,
    Bad,
    /// An RSA key shorter than 2048 bits, which ring does not check; see `checked`.
    Legacy,
}

/// Whether one proof's signature is good over the signed data and the zip.
fn verified(proof: &Proof<'_>, message: &[u8], zip: &[u8]) -> Verdict {
    let Some((algorithm, key)) = spki(proof.key) else {
        return Verdict::Bad;
    };
    if !proof.ecdsa && modulus_bits(key).is_some_and(|bits| (1024..2048).contains(&bits)) {
        return Verdict::Legacy;
    }
    let (want_key, want_signature) = if proof.ecdsa {
        (alg_id::ECDSA_P256, alg_id::ECDSA_SHA256)
    } else {
        (alg_id::RSA_ENCRYPTION, alg_id::RSA_PKCS1_SHA256)
    };
    if algorithm != AsRef::<[u8]>::as_ref(&want_key) {
        return Verdict::Bad;
    }

    let mut whole = Vec::with_capacity(message.len() + zip.len());
    whole.extend_from_slice(message);
    whole.extend_from_slice(zip);

    let good = rustls::crypto::ring::default_provider()
        .signature_verification_algorithms
        .all
        .iter()
        .filter(|one| {
            one.public_key_alg_id() == want_key && one.signature_alg_id() == want_signature
        })
        .any(|one: &&dyn SignatureVerificationAlgorithm| {
            one.verify_signature(key, &whole, proof.signature).is_ok()
        });
    if good {
        Verdict::Good
    } else {
        Verdict::Bad
    }
}

/// How long an RSA key's modulus is, in bits, out of its `RSAPublicKey`.
fn modulus_bits(key: &[u8]) -> Option<usize> {
    let (sequence, _) = tlv(key, 0x30)?;
    let (modulus, _) = tlv(sequence, 0x02)?;
    let first = modulus.iter().position(|byte| *byte != 0)?;
    let top = modulus[first];
    Some((modulus.len() - first - 1) * 8 + (8 - top.leading_zeros() as usize))
}

/// A `SubjectPublicKeyInfo` taken apart: the algorithm's contents and the key's bits.
fn spki(der: &[u8]) -> Option<(&[u8], &[u8])> {
    let (outer, rest) = tlv(der, 0x30)?;
    if !rest.is_empty() {
        return None;
    }
    let (algorithm, rest) = tlv(outer, 0x30)?;
    let (bits, rest) = tlv(rest, 0x03)?;
    if !rest.is_empty() {
        return None;
    }
    let (&unused, key) = bits.split_first()?;
    (unused == 0).then_some((algorithm, key))
}

/// One DER element with tag `tag`: its contents and what follows it.
fn tlv(der: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    let (&found, rest) = der.split_first()?;
    if found != tag {
        return None;
    }
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let length = rest[..count]
            .iter()
            .fold(0usize, |sum, byte| (sum << 8) | usize::from(*byte));
        (length, &rest[count..])
    };
    (rest.len() >= length).then(|| rest.split_at(length))
}

/// A little-endian `u32` at `at`.
fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// A protobuf message's length-delimited fields, in order; anything else is skipped.
fn fields(mut bytes: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    let broken = || "that extension's file is not one: its header is broken".to_string();
    let mut out = Vec::new();
    while !bytes.is_empty() {
        let (key, rest) = varint(bytes).ok_or_else(broken)?;
        bytes = rest;
        match key & 7 {
            0 => bytes = varint(bytes).ok_or_else(broken)?.1,
            2 => {
                let (length, rest) = varint(bytes).ok_or_else(broken)?;
                let length = usize::try_from(length).map_err(|_| broken())?;
                if rest.len() < length {
                    return Err(broken());
                }
                out.push((key >> 3, &rest[..length]));
                bytes = &rest[length..];
            }
            5 if bytes.len() >= 4 => bytes = &bytes[4..],
            1 if bytes.len() >= 8 => bytes = &bytes[8..],
            _ => return Err(broken()),
        }
    }
    Ok(out)
}

/// A protobuf varint and what follows it.
fn varint(bytes: &[u8]) -> Option<(u64, &[u8])> {
    let mut value = 0u64;
    for (at, byte) in bytes.iter().enumerate().take(10) {
        value |= u64::from(byte & 0x7f) << (7 * at);
        if byte & 0x80 == 0 {
            return Some((value, &bytes[at + 1..]));
        }
    }
    None
}

#[cfg(test)]
pub(super) mod tests {
    use std::sync::Arc;

    use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
    use rustls::sign::SigningKey;
    use rustls::SignatureScheme;

    use super::{checked, id_of_key, Store};

    /// A P-256 key made for these tests and nothing else.
    const TEST_KEY: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgIrdk7wzoaVbunNe3G1WiqMyG7WAZ7uWq0bvFl1H+g4ShRANCAAQT3ZpeB5LsoVQo9FvWlzfdRjdZkizPMoz17yyjYQmhmipoU4SMgulQvveYFgxHndV9idYBLgbHDAtIZhed4Yyt";

    fn key() -> Arc<dyn SigningKey> {
        use base64::Engine as _;
        let der = base64::engine::general_purpose::STANDARD
            .decode(TEST_KEY)
            .expect("the test key");
        rustls::crypto::ring::default_provider()
            .key_provider
            .load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(der)))
            .expect("a key")
    }

    fn varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let byte = u8::try_from(value & 0x7f).unwrap_or(0);
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn field(number: u64, value: &[u8], out: &mut Vec<u8>) {
        varint((number << 3) | 2, out);
        varint(value.len() as u64, out);
        out.extend_from_slice(value);
    }

    /// A CRX3 file round `zip`, signed by the test key alone, as `(bytes, id)`.
    pub fn crx(zip: &[u8]) -> (Vec<u8>, String) {
        let key = key();
        let public = key.public_key().expect("its public half").as_ref().to_vec();
        let id = id_of_key(&public);
        let hash = <sha2::Sha256 as sha2::Digest>::digest(&public);

        let mut signed = Vec::new();
        field(1, &hash[..16], &mut signed);

        let mut message = b"CRX3 SignedData\0".to_vec();
        message.extend_from_slice(&u32::try_from(signed.len()).expect("small").to_le_bytes());
        message.extend_from_slice(&signed);
        message.extend_from_slice(zip);
        let signature = key
            .choose_scheme(&[SignatureScheme::ECDSA_NISTP256_SHA256])
            .expect("ECDSA")
            .sign(&message)
            .expect("a signature");

        let mut proof = Vec::new();
        field(1, &public, &mut proof);
        field(2, &signature, &mut proof);
        let mut header = Vec::new();
        field(3, &proof, &mut header);
        field(10_000, &signed, &mut header);

        let mut out = b"Cr24".to_vec();
        out.extend_from_slice(&3u32.to_le_bytes());
        out.extend_from_slice(&u32::try_from(header.len()).expect("small").to_le_bytes());
        out.extend_from_slice(&header);
        out.extend_from_slice(zip);
        (out, id)
    }

    #[test]
    fn a_signed_file_checks_out_with_its_own_id() {
        let (bytes, id) = crx(b"PK not really a zip");
        let checked = checked(&bytes, &id, None).expect("checked");
        assert_eq!(checked.zip, b"PK not really a zip");
        assert_eq!(id_of_key(&checked.key), id);
    }

    #[test]
    fn a_changed_byte_another_id_or_no_store_signature_is_refused() {
        let (mut bytes, id) = crx(b"PK the archive");
        assert!(checked(&bytes, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", None).is_err());
        // Signed by its developer, but by neither store.
        assert!(checked(&bytes, &id, Some(Store::Chrome)).is_err());
        assert!(checked(&bytes, &id, Some(Store::Edge)).is_err());

        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(checked(&bytes, &id, None).is_err());
    }

    /// An extension from before 2013 has a 1024-bit RSA key, which is told apart so the
    /// store's own signature can vouch for it.
    #[test]
    fn a_legacy_key_is_measured_by_its_modulus() {
        use base64::Engine as _;
        let spki = base64::engine::general_purpose::STANDARD
            .decode("MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDlIcw8kMwLZvYHOsJIWvfi+VwtM4qJrny7JJEdJppi2nA8xBrqN9mODIjCs9NjeSCE75TlqG1WZFPVsEF8TiL5yBVtDlbcR9VQjIMNaSCaK+WYnyymP7D0JHIwFoVdhgA7+QZHo8OcrDQFqKdZvzG/lrAQWI7XULPNEcdoKmWtowIDAQAB")
            .expect("the test key");
        let (_, key) = super::spki(&spki).expect("a key");
        assert_eq!(super::modulus_bits(key), Some(1024));
    }

    #[test]
    fn what_is_not_a_crx3_file_is_refused() {
        for bytes in [
            &b""[..],
            b"PK\x03\x04",
            b"Cr24\x02\0\0\0\0\0\0\0",
            b"Cr24\x03\0\0\0\xff\xff\0\0",
        ] {
            assert!(checked(bytes, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", None).is_err());
        }
    }
}
