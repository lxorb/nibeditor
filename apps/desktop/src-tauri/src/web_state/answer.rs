//! Waiting, from a command's own thread, for an answer the engine gives on the window's.
//!
//! Every engine answers on its own thread and in its own time: a `DevTools` call's
//! completion handler, a script's callback, a page that has finished loading. A capture
//! is a dozen of those one after another, so each is turned into something to `await`,
//! with a patience of its own: an engine that never answers is a capture that fails
//! with a sentence, never a command that hangs for ever.

use std::time::Duration;

use tauri::async_runtime::{channel, Sender};

/// How long one question to the engine may take. A script over a large database is the
/// slowest thing asked, and it is seconds, not this.
pub(crate) const PATIENCE: Duration = Duration::from_secs(60);

/// Where one answer goes. Cloned into whichever callback may give it; the first answer
/// is the one heard.
pub(crate) struct Reply<T>(Sender<Result<T, String>>);

impl<T> Clone for Reply<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Reply<T> {
    /// Gives the answer, if nobody has yet.
    pub(crate) fn say(&self, answer: Result<T, String>) {
        let _ = self.0.try_send(answer);
    }
}

/// Asks, and waits for the answer: `ask` is handed where to say it, and returns an
/// error only when the question could not even be put.
pub(crate) async fn answer<T: Send + 'static>(
    what: &str,
    ask: impl FnOnce(Reply<T>) -> Result<(), String>,
) -> Result<T, String> {
    let (sender, mut receiver) = channel(1);
    ask(Reply(sender))?;
    match tokio::time::timeout(PATIENCE, receiver.recv()).await {
        Ok(Some(answer)) => answer,
        Ok(None) => Err(format!("{what}: the engine went away without answering")),
        Err(_) => Err(format!("{what}: the engine did not answer")),
    }
}
