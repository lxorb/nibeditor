//! A `ChatGPT` plan, spent directly: Sign in with `ChatGPT`, the way `OpenAI` documents it
//! for open-source apps that run on the reader's own machine.
//!
//! **Why this is allowed and the other way is not.** `OpenAI` offers "`ChatGPT` plan usage"
//! to open-source and locally hosted apps (<https://developers.openai.com/siwc/token-sharing-open-source>):
//! the app registers itself through the reader's own sign-in and calls the Responses API
//! at `api.openai.com` with the token it is given. nibeditor is open source and the
//! desktop app runs here, so it qualifies; the web app at nibeditor.com is hosted and does
//! not, and never offers this. What is *not* done is what several tools did before this
//! existed - borrowing the Codex CLI's own client id and calling `ChatGPT`'s private
//! `backend-api` - which is somebody else's identity. See docs/ai.md.
//!
//! **Where the tokens are.** The refresh token is in the machine's keychain under a name
//! the page's own `secret_read` refuses (a dot is not a character a provider id has; see
//! `named` in secrets.rs), so the webview never holds it. The access token lives here, in
//! memory, for its hour, and the page asks for it per request (`chatgpt_token`) to make
//! that request itself, the way it uses an API key. The installation's host id and the
//! client id issued to it are not secrets and are a file in the app's folder.

mod oauth;

use std::io::{BufRead as _, BufReader, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

use oauth::{Attempt, Callback, Tokens};

/// Where the refresh token is kept: the keychain's nibeditor service, under a name no
/// provider id can be.
const REFRESH: &str = "chatgpt.refresh";

/// The port the first sign-in listens on, as `OpenAI`'s own example has it; any free port
/// after that, since only the port may change between sign-ins.
const PORT: u16 = 1455;

/// How long a sign-in waits for the browser to come back.
const SIGNING_IN: Duration = Duration::from_secs(300);

/// How long before an access token's hour is up it is replaced.
const EARLY: Duration = Duration::from_secs(120);

/// What this installation is to `OpenAI`: its host id, and the client issued to it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Installation {
    host: String,
    #[serde(default)]
    client: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

/// The access token of the hour, and the sign-in in progress.
#[derive(Default)]
pub struct ChatGpt {
    access: tokio::sync::Mutex<Option<(String, Instant)>>,
    signing: std::sync::Mutex<Option<Arc<AtomicBool>>>,
}

/// Who is signed in, for the pane.
#[derive(Serialize)]
pub struct Account {
    email: Option<String>,
}

/// The window this call came from, when it is one of ours.
fn owner(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err("not a window of this app".to_owned())
    }
}

fn installation_file(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder.join("chatgpt.json"))
}

fn installation(app: &AppHandle) -> Result<Installation, String> {
    let file = installation_file(app)?;
    if let Some(found) = std::fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Installation>(&bytes).ok())
        .filter(|found| !found.host.is_empty())
    {
        return Ok(found);
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let made = Installation {
        host: oauth::host_id(&random),
        ..Installation::default()
    };
    keep(app, &made)?;
    Ok(made)
}

fn keep(app: &AppHandle, installation: &Installation) -> Result<(), String> {
    let text = serde_json::to_vec(installation).map_err(|error| error.to_string())?;
    std::fs::write(installation_file(app)?, text).map_err(|error| error.to_string())
}

fn refresh_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(crate::secrets::SERVICE, REFRESH).map_err(|error| error.to_string())
}

fn refresh_token() -> Result<Option<String>, String> {
    match refresh_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    // Rustls with no provider of its own, as the updater builds it; see
    // engine_switch/fetch.rs.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

/// One form sent to the token endpoint, and its answer.
async fn tokens(form: &[(&str, &str)]) -> Result<Tokens, String> {
    let answer = client()?
        .post(oauth::TOKEN)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(oauth::form(form))
        .send()
        .await
        .map_err(|error| format!("could not reach OpenAI: {error}"))?;
    let status = answer.status();
    let body = answer.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let code = oauth::token_error(&body).unwrap_or_else(|| status.as_u16().to_string());
        return Err(if oauth::grant_gone(&code) {
            "signed out".to_owned()
        } else {
            code
        });
    }
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

/// Waits on the loopback for the browser to come back, answering it with a line it can
/// be closed on.
fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    stop: &AtomicBool,
) -> Result<(String, Option<String>), String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    while started.elapsed() < SIGNING_IN {
        if stop.load(Ordering::SeqCst) {
            return Err("stopped".to_owned());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(result) = answer_callback(stream, state) {
                    return result;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("timed out".to_owned())
}

/// Reads one request off the loopback; `None` for one that was not the callback.
fn answer_callback(
    mut stream: TcpStream,
    state: &str,
) -> Option<Result<(String, Option<String>), String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line).ok()?;

    let (status, words, result) = match oauth::callback(&line, state) {
        Callback::Code { code, client } => (
            "200 OK",
            "nibeditor is signed in to ChatGPT. This tab can be closed.",
            Some(Ok((code, client))),
        ),
        Callback::Refused(why) => (
            "200 OK",
            "nibeditor was not signed in to ChatGPT.",
            Some(Err(why)),
        ),
        Callback::Other => ("404 Not Found", "", None),
    };
    let page = format!(
        "<!doctype html><meta charset=utf-8><title>nibeditor</title>\
         <p style=\"font:16px system-ui;margin:3em;text-align:center\">{words}</p>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}",
        page.len()
    );
    result
}

/// Signs in: opens the reader's browser on `OpenAI`'s sign-in and waits for it to come
/// back to the loopback, up to five minutes. A second press gives up the first wait.
#[tauri::command]
pub async fn chatgpt_sign_in(webview: Webview) -> Result<Account, String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();

    let stop = Arc::new(AtomicBool::new(false));
    let earlier = state
        .signing
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .replace(Arc::clone(&stop));
    if let Some(earlier) = earlier {
        earlier.store(true, Ordering::SeqCst);
        // Long enough for the earlier wait to see it and let go of its port.
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let mut found = installation(&app)?;
    let mut random = [0_u8; 96];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let attempt = Attempt::from_random(&random);

    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, PORT)))
        .or_else(|_| TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))))
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let url = oauth::authorize_url(&attempt, port, &found.host, found.client.as_deref());
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())?;

    let expected = attempt.state.clone();
    let waiting = Arc::clone(&stop);
    let (code, issued) = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(&listener, &expected, &waiting)
    })
    .await
    .map_err(|error| error.to_string())??;

    let client_id = issued
        .or_else(|| found.client.clone())
        .ok_or_else(|| "OpenAI issued no client".to_owned())?;
    let redirect = oauth::redirect(port);
    let got = tokens(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &code),
        ("code_verifier", &attempt.verifier),
        ("redirect_uri", &redirect),
        ("resource", oauth::RESOURCE),
    ])
    .await?;

    let refresh = got
        .refresh_token
        .clone()
        .ok_or_else(|| "OpenAI sent no refresh token".to_owned())?;
    refresh_entry()?
        .set_password(&refresh)
        .map_err(|error| error.to_string())?;

    found.client = Some(client_id);
    found.email = got.id_token.as_deref().and_then(oauth::email_in);
    keep(&app, &found)?;
    *state.access.lock().await = Some(fresh(&got));
    Ok(Account { email: found.email })
}

/// The access token with the moment it should be replaced.
fn fresh(got: &Tokens) -> (String, Instant) {
    let lasts = Duration::from_secs(got.expires_in.unwrap_or(3600)).saturating_sub(EARLY);
    (got.access_token.clone(), Instant::now() + lasts)
}

/// Who is signed in, or `None`.
#[tauri::command(async)]
pub fn chatgpt_account(webview: Webview) -> Result<Option<Account>, String> {
    owner(&webview)?;
    if refresh_token()?.is_none() {
        return Ok(None);
    }
    let found = installation(webview.app_handle())?;
    Ok(Some(Account { email: found.email }))
}

/// An access token for one request, replaced when its hour is nearly up. One refresh at
/// a time: a rotating refresh token used twice is a refresh token lost.
#[tauri::command]
pub async fn chatgpt_token(webview: Webview) -> Result<String, String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();
    let mut access = state.access.lock().await;
    if let Some((token, until)) = access.as_ref() {
        if Instant::now() < *until {
            return Ok(token.clone());
        }
    }

    let refresh = refresh_token()?.ok_or_else(|| "signed out".to_owned())?;
    let found = installation(&app)?;
    let client_id = found.client.ok_or_else(|| "signed out".to_owned())?;
    let got = match tokens(&[
        ("grant_type", "refresh_token"),
        ("client_id", &client_id),
        ("refresh_token", &refresh),
        ("resource", oauth::RESOURCE),
    ])
    .await
    {
        Ok(got) => got,
        Err(error) => {
            if error == "signed out" {
                let _ = refresh_entry()?.delete_credential();
            }
            return Err(error);
        }
    };
    if let Some(next) = &got.refresh_token {
        refresh_entry()?
            .set_password(next)
            .map_err(|error| error.to_string())?;
    }
    let (token, until) = fresh(&got);
    *access = Some((token.clone(), until));
    Ok(token)
}

/// Signs out: the refresh token revoked at `OpenAI` where it can be reached, and forgotten
/// here either way, with the client issued to it.
#[tauri::command]
pub async fn chatgpt_sign_out(webview: Webview) -> Result<(), String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();
    *state.access.lock().await = None;

    let mut found = installation(&app)?;
    if let (Some(refresh), Some(client_id)) = (refresh_token()?, found.client.clone()) {
        let _ = revoke(&refresh, &client_id).await;
    }
    match refresh_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(error.to_string()),
    }
    found.client = None;
    found.email = None;
    keep(&app, &found)
}

/// Revokes a refresh token at the endpoint `OpenAI`'s configuration names.
async fn revoke(refresh: &str, client_id: &str) -> Result<(), String> {
    let http = client()?;
    let configuration: serde_json::Value = serde_json::from_slice(
        &http
            .get(oauth::CONFIGURATION)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .bytes()
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let endpoint = configuration
        .get("revocation_endpoint")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "no revocation endpoint".to_owned())?;
    http.post(endpoint)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(oauth::form(&[
            ("token", refresh),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id),
        ]))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
