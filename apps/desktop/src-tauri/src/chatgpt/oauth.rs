//! The arithmetic of Sign in with `ChatGPT`: the address the browser is sent to, the
//! callback read back, and the forms and answers of the token endpoint. Pure, so every
//! part of it is tested without a network; see chatgpt.rs for the requests.
//!
//! The flow is `OpenAI`'s own for open-source apps that let a reader spend their `ChatGPT`
//! plan, documented at <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>:
//! the first sign-in registers this installation (`client_id=dynamic_agent_client`, the
//! host's `ext_agent_host_id`, the app's name in `agent_name_hint`) and the callback
//! hands back the `client_id` issued to it, which every later request uses. PKCE with
//! S256, a loopback callback on `127.0.0.1` where only the port may change, and the
//! `resource` the tokens are for.

use std::fmt::Write as _;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Where the browser signs in.
pub const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";

/// Where a code or a refresh token is exchanged.
pub const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";

/// Where the revocation endpoint is named; see `sign_out` in chatgpt.rs.
pub const CONFIGURATION: &str = "https://auth.openai.com/.well-known/openid-configuration";

/// The client id a first sign-in registers through, and never the one kept.
pub const REGISTERING: &str = "dynamic_agent_client";

/// What the tokens are for: the Responses API, and nothing of `ChatGPT`'s own.
pub const RESOURCE: &str = "https://api.openai.com/v1";

/// What is asked for: who the reader is, a refresh token, and the plan's use.
pub const SCOPE: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

/// The app's name as the reader's `ChatGPT` settings list it.
pub const NAME: &str = "nibeditor";

/// The path the loopback callback arrives on.
pub const CALLBACK_PATH: &str = "/auth/callback";

/// A PKCE pair and the two values that tie a callback to the request that caused it.
pub struct Attempt {
    /// The verifier, kept here and sent only with the code.
    pub verifier: String,
    /// What the callback must bring back.
    pub state: String,
    /// What the id token must carry.
    pub nonce: String,
}

impl Attempt {
    /// Made from 96 random bytes, which is all the randomness PKCE, the state and the
    /// nonce need between them.
    pub fn from_random(random: &[u8; 96]) -> Self {
        Self {
            verifier: URL_SAFE_NO_PAD.encode(&random[..48]),
            state: URL_SAFE_NO_PAD.encode(&random[48..72]),
            nonce: URL_SAFE_NO_PAD.encode(&random[72..]),
        }
    }

    /// The S256 challenge of the verifier.
    pub fn challenge(&self) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.as_bytes()))
    }
}

/// The loopback address the browser comes back to.
pub fn redirect(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

/// Percent-encoding for a query or a form: everything but the unreserved characters.
pub fn encoded(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// A query or a form, written out.
pub fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(name, value)| format!("{}={}", encoded(name), encoded(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Where the browser is sent: registering where no client has been issued yet, and as
/// the issued one after.
pub fn authorize_url(attempt: &Attempt, port: u16, host: &str, client: Option<&str>) -> String {
    let redirect = redirect(port);
    let challenge = attempt.challenge();
    let mut pairs = vec![
        ("response_type", "code"),
        ("client_id", client.unwrap_or(REGISTERING)),
        ("redirect_uri", redirect.as_str()),
        ("scope", SCOPE),
        ("resource", RESOURCE),
        ("state", attempt.state.as_str()),
        ("nonce", attempt.nonce.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("ext_agent_host_id", host),
    ];
    if client.is_none() {
        pairs.push(("agent_name_hint", NAME));
    }
    format!("{AUTHORIZE}?{}", form(&pairs))
}

/// `%XX` and `+` undone.
pub fn decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'+' => out.push(b' '),
            b'%' if at + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[at + 1..at + 3]).unwrap_or("");
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    at += 3;
                    continue;
                }
                out.push(b'%');
            }
            other => out.push(other),
        }
        at += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What came back to the loopback.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    /// Signed in: the code, and the client issued where this was a registration.
    Code {
        /// The authorization code.
        code: String,
        /// The client issued to this installation, on a first sign-in.
        client: Option<String>,
    },
    /// Refused, in `OpenAI`'s own words where it sent some.
    Refused(String),
    /// Not the callback: a favicon, or a state that is not this attempt's.
    Other,
}

/// Reads the first line of a request that reached the loopback.
pub fn callback(request_line: &str, state: &str) -> Callback {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Other;
    };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Callback::Other;
    }

    let mut code = None;
    let mut client = None;
    let mut said_state = None;
    let mut error = None;
    let mut description = None;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = decoded(value);
        match name {
            "code" => code = Some(value),
            "client_id" => client = Some(value),
            "state" => said_state = Some(value),
            "error" => error = Some(value),
            "error_description" => description = Some(value),
            _ => {}
        }
    }

    if said_state.as_deref() != Some(state) {
        return Callback::Other;
    }
    if let Some(error) = error {
        return Callback::Refused(description.unwrap_or(error));
    }
    match code {
        Some(code) if !code.is_empty() => Callback::Code {
            code,
            client: client.filter(|one| !one.is_empty()),
        },
        _ => Callback::Refused("no code came back".to_owned()),
    }
}

/// The token endpoint's answer.
#[derive(Debug, Deserialize)]
pub struct Tokens {
    /// For the Responses API, for an hour.
    pub access_token: String,
    /// For the next access token; replaced by every refresh.
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Who signed in.
    #[serde(default)]
    pub id_token: Option<String>,
    /// Seconds the access token lasts.
    #[serde(default)]
    pub expires_in: Option<u64>,
}

/// What the token endpoint said went wrong, where it said.
pub fn token_error(body: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let error = value.get("error")?;
    let code = error
        .as_str()
        .or_else(|| error.get("code").and_then(serde_json::Value::as_str))?;
    Some(code.to_owned())
}

/// Whether a refresh failed because the grant is gone - revoked, expired, never valid -
/// rather than because the network was down: the one case where signing in again is
/// the answer.
pub fn grant_gone(code: &str) -> bool {
    matches!(
        code,
        "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_reused"
            | "refresh_token_invalidated"
    )
}

/// The email an id token names, read without checking its signature: it is shown to the
/// reader as whose plan this is and trusted for nothing else.
pub fn email_in(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("email")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

/// This installation's host id, made once: a URN of a random UUID.
pub fn host_id(random: &[u8; 16]) -> String {
    let mut bytes = *random;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let mut hex = String::with_capacity(32);
    for byte in bytes {
        let _ = write!(hex, "{byte:02x}");
    }
    format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt() -> Attempt {
        let mut random = [0_u8; 96];
        for (at, byte) in random.iter_mut().enumerate() {
            *byte = u8::try_from(at).unwrap_or(0);
        }
        Attempt::from_random(&random)
    }

    #[test]
    fn a_first_sign_in_registers_with_the_app_s_name_and_host() {
        let url = authorize_url(&attempt(), 1455, "urn:uuid:x", None);
        assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
        assert!(url.contains("client_id=dynamic_agent_client"));
        assert!(url.contains("agent_name_hint=nibeditor"));
        assert!(url.contains("ext_agent_host_id=urn%3Auuid%3Ax"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
        assert!(url.contains("scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct"));
        assert!(url.contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn a_later_sign_in_is_the_issued_client() {
        let url = authorize_url(&attempt(), 50123, "urn:uuid:x", Some("oaiapp_1"));
        assert!(url.contains("client_id=oaiapp_1"));
        assert!(!url.contains("dynamic_agent_client"));
        assert!(url.contains("127.0.0.1%3A50123"));
    }

    #[test]
    fn the_challenge_is_s256_of_the_verifier() {
        // RFC 7636's own example.
        let example = Attempt {
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".to_owned(),
            state: String::new(),
            nonce: String::new(),
        };
        assert_eq!(
            example.challenge(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert!(attempt().verifier.len() >= 43);
    }

    #[test]
    fn the_callback_is_read_only_with_this_attempt_s_state() {
        let state = attempt().state;
        let line =
            format!("GET /auth/callback?code=abc%2Fd&state={state}&client_id=oaiapp_9 HTTP/1.1");
        assert_eq!(
            callback(&line, &state),
            Callback::Code {
                code: "abc/d".to_owned(),
                client: Some("oaiapp_9".to_owned())
            }
        );
        assert_eq!(
            callback("GET /auth/callback?code=abc&state=other HTTP/1.1", &state),
            Callback::Other
        );
        assert_eq!(
            callback("GET /favicon.ico HTTP/1.1", &state),
            Callback::Other
        );
        assert_eq!(
            callback(
                &format!("GET /auth/callback?error=access_denied&error_description=You+said+no&state={state} HTTP/1.1"),
                &state
            ),
            Callback::Refused("You said no".to_owned())
        );
    }

    #[test]
    fn decoding_leaves_a_stray_percent_alone() {
        assert_eq!(decoded("a%20b+c"), "a b c");
        assert_eq!(decoded("100%"), "100%");
        assert_eq!(decoded("%zz"), "%zz");
    }

    #[test]
    fn an_id_token_names_whose_plan_it_is() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"reader@example.com","sub":"x"}"#);
        assert_eq!(
            email_in(&format!("h.{payload}.s")),
            Some("reader@example.com".to_owned())
        );
        assert_eq!(email_in("not a token"), None);
    }

    #[test]
    fn a_refresh_that_is_gone_is_told_from_one_that_failed() {
        assert_eq!(
            token_error(br#"{"error":"invalid_grant"}"#).as_deref(),
            Some("invalid_grant")
        );
        assert_eq!(
            token_error(br#"{"error":{"code":"token_expired","message":"x"}}"#).as_deref(),
            Some("token_expired")
        );
        assert!(grant_gone("invalid_grant"));
        assert!(!grant_gone("invalid_client"));
        assert_eq!(token_error(b"<html>"), None);
    }

    #[test]
    fn a_host_id_is_a_version_four_uuid() {
        let id = host_id(&[0xff; 16]);
        assert_eq!(id, "urn:uuid:ffffffff-ffff-4fff-bfff-ffffffffffff");
    }
}
