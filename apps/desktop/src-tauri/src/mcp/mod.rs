//! `nib mcp`: the app's own binary as a Model Context Protocol server over stdio, which
//! is the whole of setting nib up in an agent's client (docs/agent-native.md 10):
//!
//! ```text
//! claude mcp add --scope user nib -- "%LOCALAPPDATA%\Nib\nib.exe" mcp
//! ```
//!
//! **Nothing of the app starts.** `main.rs` reads its arguments before Tauri does and
//! hands `mcp` here: no window, no webview, no hand-off to a nib that is running, no
//! updater, and nothing on stdout but the protocol. The running app is reached through
//! the endpoint the `nib` command uses (`automation.json`), with the agent's own token,
//! so what an agent may do is decided where it always is, in the crate and the window
//! of the app that runs. This process speaks the protocol, keeps the token, and writes
//! each answer the way a model reads it.
//!
//! | file | what it owns |
//! | --- | --- |
//! | `rpc` | JSON-RPC on stdin and stdout: a line read, the one writer |
//! | `server` | the protocol: initialize, the tools, ping, cancellation |
//! | `link` | the connection to the app: found or started, paired, watched |
//! | `home` | where the app keeps its files, found without Tauri |
//! | `app` | the running app: its endpoint file, a request to it, starting it |
//! | `pairing` | the client's name and token, asked for once and kept |
//! | `tools` | the tool table, and the part of it an agent's grant reaches |
//! | `results` | an answer as the model reads it |
//! | `shared` | the six tools the account connector has too, in its words |
//! | `marks` | the untrusted marks round words from outside |
//! | `program` | the program the settings pane's copy line names |
//! | `host` | the same tools and answers, for the AI sidebar's agent inside the app |
//!
//! Std and serde only, beside the crate's own types and one Win32 flag (`app.rs`): it
//! starts in milliseconds and grows no dependency graph of its own.

mod app;
mod home;
// The AI sidebar's agent, served from inside the app; see ai_agent.rs.
pub(crate) mod host;
mod link;
mod marks;
mod pairing;
pub(crate) mod program;
mod results;
mod rpc;
mod server;
mod shared;
mod tools;

/// This process's standard handles kept out of the programs it starts, which the app
/// needs too; see `keep_the_pipes` in app.rs.
#[cfg(windows)]
pub(crate) use app::keep_the_pipes;

/// Serves one client on stdin and stdout until it closes stdin, and answers the exit
/// code: 0, since a client going away is how every session ends.
#[must_use]
pub fn serve() -> i32 {
    server::run()
}
