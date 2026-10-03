//! The AI sidebar's threads, kept on this device (docs/ai-sidebar.md 4.11).
//!
//! A thread holds the words of every note it read and every page it was shown, so it is
//! kept where nothing syncs it: the app's local data folder, `ai/threads/<space>/`, one
//! file a thread (`<id>.json`) and one list per space (`index.json`) holding what the
//! thread list shows without reading a thread whole. Every file is written whole, the
//! owner's alone, so a crash leaves the old file or the new one and never half of either.
//!
//! This module only keeps what the window hands it: a thread is the window's JSON, and
//! the window checks it on the way back in (`src/lib/ai/chat/threads.ts`). What is
//! checked here is everything that names a file: a space and a thread are each an id the
//! window made (a UUID), and anything else is refused rather than made safe, so no id can
//! name a file outside the folder. Only nib's own window may ask.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::paths::{made, write_privately};

/// How large a thread may be: a long one with pictures in it, and a ceiling on one write.
const MOST_BYTES: usize = 64 * 1024 * 1024;

/// One list at a time is read, changed and written, so two threads written at once both
/// stay in it.
static LISTS: Mutex<()> = Mutex::new(());

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

/// An id as the name of a file or a folder: the window's own ids are UUIDs.
fn named(id: &str) -> Result<&str, String> {
    let fits = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(id)
    } else {
        Err(format!("{id} is not an id"))
    }
}

/// The folder every space's threads are kept under.
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(folder.join("ai").join("threads"))
}

/// One space's folder.
fn space_dir(root: &Path, space: &str) -> Result<PathBuf, String> {
    Ok(root.join(named(space)?))
}

/// A space's list, by thread id; empty where there is none or it cannot be read, which
/// is a list to start again rather than a reason to refuse a write.
fn read_list(dir: &Path) -> BTreeMap<String, Value> {
    fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_list(dir: &Path, list: &BTreeMap<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string(list).map_err(|error| error.to_string())?;
    write_privately(&dir.join("index.json"), text.as_bytes())
}

/// The list's heads.
pub fn list(root: &Path, space: &str) -> Result<Vec<Value>, String> {
    let dir = space_dir(root, space)?;
    Ok(read_list(&dir).into_values().collect())
}

/// One thread's JSON, or nothing where there is none.
pub fn read(root: &Path, space: &str, id: &str) -> Result<Option<String>, String> {
    let path = space_dir(root, space)?.join(format!("{}.json", named(id)?));
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read that thread: {error}")),
    }
}

/// Writes one thread and its line in the list.
pub fn write(root: &Path, space: &str, id: &str, head: Value, body: &str) -> Result<(), String> {
    if body.len() > MOST_BYTES {
        return Err("that thread is too long to keep".into());
    }
    let dir = space_dir(root, space)?;
    let file = format!("{}.json", named(id)?);
    made(&dir)?;
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    write_privately(&dir.join(file), body.as_bytes())?;
    let mut list = read_list(&dir);
    list.insert(id.to_owned(), head);
    write_list(&dir, &list)
}

/// Deletes one thread for good.
pub fn delete(root: &Path, space: &str, id: &str) -> Result<(), String> {
    let dir = space_dir(root, space)?;
    let path = dir.join(format!("{}.json", named(id)?));
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not delete that thread: {error}")),
    }
    let mut list = read_list(&dir);
    if list.remove(id).is_some() {
        write_list(&dir, &list)?;
    }
    Ok(())
}

/// Deletes every thread of a space, with the space.
pub fn forget(root: &Path, space: &str) -> Result<(), String> {
    let dir = space_dir(root, space)?;
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not delete those threads: {error}")),
    }
}

/// The space's threads, as the list shows them.
#[tauri::command(async)]
pub fn ai_threads_list(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
) -> Result<Vec<Value>, String> {
    ours(&webview)?;
    list(&root(&app)?, &space)
}

/// One thread, whole.
#[tauri::command(async)]
pub fn ai_thread_read(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
) -> Result<Option<String>, String> {
    ours(&webview)?;
    read(&root(&app)?, &space, &id)
}

/// One thread written down, with its head.
#[tauri::command(async)]
pub fn ai_thread_write(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
    head: Value,
    body: String,
) -> Result<(), String> {
    ours(&webview)?;
    write(&root(&app)?, &space, &id, head, &body)
}

/// One thread deleted.
#[tauri::command(async)]
pub fn ai_thread_delete(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
) -> Result<(), String> {
    ours(&webview)?;
    delete(&root(&app)?, &space, &id)
}

/// Every thread of a space deleted.
#[tauri::command(async)]
pub fn ai_threads_forget(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
) -> Result<(), String> {
    ours(&webview)?;
    forget(&root(&app)?, &space)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nib-ai-threads-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_thread_written_reads_back_with_its_line_in_the_list() {
        let root = folder("round");
        write(
            &root,
            "space-1",
            "t-1",
            json!({"id": "t-1", "title": "Herons"}),
            "{\"id\":\"t-1\"}",
        )
        .expect("written");
        write(
            &root,
            "space-1",
            "t-2",
            json!({"id": "t-2", "title": "Egrets"}),
            "{\"id\":\"t-2\"}",
        )
        .expect("written");
        assert_eq!(
            read(&root, "space-1", "t-1").expect("read").as_deref(),
            Some("{\"id\":\"t-1\"}")
        );
        let titles: Vec<String> = list(&root, "space-1")
            .expect("listed")
            .iter()
            .map(|head| head["title"].as_str().unwrap_or_default().to_owned())
            .collect();
        assert_eq!(titles, ["Herons", "Egrets"]);
        assert!(list(&root, "space-2").expect("listed").is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writing_again_replaces_the_line_rather_than_adding_one() {
        let root = folder("again");
        write(&root, "s", "t", json!({"title": "one"}), "1").expect("written");
        write(&root, "s", "t", json!({"title": "two"}), "2").expect("written");
        let heads = list(&root, "s").expect("listed");
        assert_eq!(heads.len(), 1);
        assert_eq!(heads[0]["title"], "two");
        assert_eq!(read(&root, "s", "t").expect("read").as_deref(), Some("2"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_thread_deleted_is_gone_from_the_folder_and_the_list() {
        let root = folder("delete");
        write(&root, "s", "t", json!({}), "x").expect("written");
        delete(&root, "s", "t").expect("deleted");
        assert_eq!(read(&root, "s", "t").expect("read"), None);
        assert!(list(&root, "s").expect("listed").is_empty());
        delete(&root, "s", "t").expect("deleting nothing is fine");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_space_forgotten_takes_every_thread_and_no_other_space() {
        let root = folder("forget");
        write(&root, "a", "t", json!({}), "x").expect("written");
        write(&root, "b", "t", json!({}), "y").expect("written");
        forget(&root, "a").expect("forgotten");
        assert_eq!(read(&root, "a", "t").expect("read"), None);
        assert_eq!(read(&root, "b", "t").expect("read").as_deref(), Some("y"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_id_that_could_name_another_file_is_refused() {
        let root = folder("names");
        for bad in ["", "..", "../x", "a/b", "a\\b", "c:", &"x".repeat(65)] {
            assert!(
                write(&root, bad, "t", json!({}), "x").is_err(),
                "space {bad:?}"
            );
            assert!(
                write(&root, "s", bad, json!({}), "x").is_err(),
                "thread {bad:?}"
            );
            assert!(read(&root, "s", bad).is_err(), "read {bad:?}");
        }
        assert!(!root.exists());
    }

    #[test]
    fn a_thread_too_long_to_keep_is_refused() {
        let root = folder("long");
        let body = "x".repeat(MOST_BYTES + 1);
        assert!(write(&root, "s", "t", json!({}), &body).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
