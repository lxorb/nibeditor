//! One account's sync store on disk: opening it, bringing its schema up to date,
//! asking it questions and changing it, all or nothing.
//!
//! Pure over a path, with no app around it, so every rule here is tested against a
//! real file in a temporary folder; `sync_store.rs` is what finds the path and keeps the
//! store open between commands.

use rusqlite::types::Value as Sql;
use rusqlite::{params_from_iter, Connection, ErrorCode, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::tables::{table, Table};
use super::wire::{from_sql, to_sql, Change, Parts, Query, MOST_PARTS};
use crate::paths::{cannot, made};

/// Every schema the store has had, in order. The store's `meta.schema` row says how
/// many of them it has run; opening runs the rest, each in a transaction of its own
/// with the row that records it, so a store is always at exactly one of them. See
/// `1.sql` for why a migration is never edited once it has shipped.
const MIGRATIONS: [&str; 1] = [include_str!("1.sql")];

/// How long a statement waits for another connection's lock before it gives up. The
/// store has one connection, so this is only ever a second copy of the app during an
/// update, or a probe; long enough for that copy's one transaction.
const PATIENCE: Duration = Duration::from_secs(5);

/// How many rows of the log the store keeps. The log is for a person reading why sync
/// did what it did, and the newest thousand passes are more than anybody reads.
const LOG_ROWS: i64 = 1000;

/// What the window is told about a store it has opened.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// This device's id, made the first time the store was opened and kept for its
    /// life: what the hub and every tree op name this device by.
    pub device: String,
    /// Whether the session before this one ended with the engine saying so. False
    /// after a crash, a kill or a power cut, which is when every document's Yjs client
    /// id has to be rotated before anything new is typed (docs/sync-v2.md 5.2).
    pub was_clean: bool,
    /// The schema the store is at now.
    pub schema: usize,
    /// Whether the file on disk could not be read and a new, empty store was made in
    /// its place. The engine then rebuilds from the account and the files, the way a
    /// first sync does; the unreadable file is kept beside it.
    pub recovered: bool,
}

/// Why a store would not open, apart from the disk refusing outright.
#[derive(Debug)]
pub enum Refused {
    /// The file is not a store this build can read: damaged, or not SQLite at all.
    Damaged(String),
    /// A newer nib has been here and moved the schema past what this one knows. Nothing
    /// is changed; a newer nib is the one that can open it.
    Newer(usize),
    /// Anything else: a folder that cannot be made, a disk that is full.
    Other(String),
}

impl Refused {
    /// The sentence the window is given.
    pub fn said(&self) -> String {
        match self {
            Self::Damaged(why) | Self::Other(why) => why.clone(),
            Self::Newer(schema) => format!(
                "the sync store is at schema {schema}, which a newer nib wrote; this one knows {}",
                MIGRATIONS.len()
            ),
        }
    }
}

impl From<rusqlite::Error> for Refused {
    fn from(error: rusqlite::Error) -> Self {
        if damaged(&error) {
            Self::Damaged(format!("the sync store is damaged: {error}"))
        } else {
            Self::Other(format!("the sync store failed: {error}"))
        }
    }
}

/// Whether an error from SQLite means the file itself is bad, rather than the question
/// or the disk.
fn damaged(error: &rusqlite::Error) -> bool {
    error
        .sqlite_error_code()
        .is_some_and(|code| matches!(code, ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase))
}

/// Why a read or a write did not happen: the sentence, and whether the file turned out
/// to be damaged, which is found by using it as often as by opening it.
#[derive(Debug, PartialEq, Eq)]
pub struct Failed {
    /// What the window is told.
    pub said: String,
    /// Whether the store has to be set aside and made again.
    pub damaged: bool,
}

impl From<rusqlite::Error> for Failed {
    fn from(error: rusqlite::Error) -> Self {
        Self {
            damaged: damaged(&error),
            said: format!("the sync store failed: {error}"),
        }
    }
}

impl From<String> for Failed {
    fn from(said: String) -> Self {
        Self {
            said,
            damaged: false,
        }
    }
}

/// An open store.
pub struct Store {
    conn: Connection,
    /// What opening it found.
    pub opened: Opened,
}

impl Store {
    /// Opens the store at `path`, making it if it is not there, bringing its schema up
    /// to date, and marking this session as not yet ended cleanly.
    ///
    /// A file that cannot be read as a store is set aside, not deleted, and a new
    /// store is made where it was: sync can be rebuilt from the account and the files,
    /// and an app that will not start because of a cache is worse than one that
    /// rebuilds it. VS Code does the same with its state database. A store a newer nib
    /// wrote is refused instead, because nothing about it is wrong.
    pub fn open(path: &Path) -> Result<Self, Refused> {
        if let Some(folder) = path.parent() {
            made(folder).map_err(Refused::Other)?;
        }

        match Self::opened(path, false) {
            Err(Refused::Damaged(_)) => {
                set_aside(path)?;
                Self::opened(path, true)
            }
            other => other,
        }
    }

    fn opened(path: &Path, recovered: bool) -> Result<Self, Refused> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(PATIENCE)?;
        // The write-ahead log: a write is an append to one file and a crash at any
        // moment leaves the store as it was before the transaction or after it. Normal
        // rather than full synchronisation, which skips the flush at every commit and
        // keeps it at every checkpoint. The one thing that costs is the last moments
        // before the machine itself loses power, and a session that ends that way is an
        // unclean exit - which is exactly when the engine rotates every client id and
        // resends what it has. So the flush would buy nothing the protocol does not
        // already give.
        let mode: String =
            conn.pragma_update_and_check(None, "journal_mode", "wal", |row| row.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(Refused::Other(format!(
                "the sync store could not keep a write-ahead log ({mode})"
            )));
        }
        conn.pragma_update(None, "synchronous", "normal")?;

        let schema = migrated_with(&conn, &MIGRATIONS)?;
        let device = device(&conn)?;
        let was_clean = mark_clean(&conn, false)?;

        Ok(Self {
            conn,
            opened: Opened {
                device,
                was_clean,
                schema,
                recovered,
            },
        })
    }

    /// Says whether this session is ending cleanly, and answers what it said before.
    pub fn mark_clean(&self, clean: bool) -> Result<bool, rusqlite::Error> {
        mark_clean(&self.conn, clean)
    }

    /// Answers every query, in order, from one snapshot of the store: rows as JSON
    /// objects by column name, and the bytes of every blob among them as parts.
    pub fn read(&mut self, queries: &[Query]) -> Result<(Json, Vec<Vec<u8>>), Failed> {
        let snapshot = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let mut parts = Parts::default();
        let mut answers = Vec::with_capacity(queries.len());

        for query in queries {
            answers.push(match query {
                Query::Get { table: name, key } => {
                    let table = table(name)?;
                    let sql = format!(
                        "select {} from {} where {} = ?1",
                        table.listed(),
                        table.name,
                        table.keyed()?
                    );
                    let mut rows = rows(
                        &snapshot,
                        table,
                        &sql,
                        &[Sql::Text(key.clone())],
                        &mut parts,
                    )?;
                    rows.pop().unwrap_or(Json::Null)
                }
                Query::Scan { table: name, space } => {
                    let table = table(name)?;
                    let (filter, values) = match (space, table.space) {
                        (None, _) => (String::new(), Vec::new()),
                        (Some(space), Some(column)) => (
                            format!(" where {column} = ?1"),
                            vec![Sql::Text(space.clone())],
                        ),
                        (Some(_), None) => {
                            return Err(format!("{} rows belong to no space", table.name).into())
                        }
                    };
                    let sql = format!(
                        "select {} from {}{filter} order by {}",
                        table.listed(),
                        table.name,
                        table.order
                    );
                    Json::Array(rows(&snapshot, table, &sql, &values, &mut parts)?)
                }
            });
        }

        if parts.len() > MOST_PARTS {
            return Err(format!(
                "a read of {} values of bytes is more than one answer carries ({MOST_PARTS}); ask in batches",
                parts.len()
            )
            .into());
        }
        Ok((Json::Array(answers), parts.into_parts()))
    }

    /// Applies every change in one transaction, and answers how many rows each one
    /// touched. One change the store refuses, or one statement SQLite refuses, and
    /// nothing of the batch is written.
    pub fn write(&mut self, changes: &[Change], parts: &[&[u8]]) -> Result<Vec<usize>, Failed> {
        let batch = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut counts = Vec::with_capacity(changes.len());
        let mut logged = false;

        for change in changes {
            counts.push(match change {
                Change::Put { table: name, row } => {
                    let table = table(name)?;
                    logged |= table.key.is_none();
                    put(&batch, table, row, parts)?
                }
                Change::Patch {
                    table: name,
                    key,
                    set,
                } => patch(&batch, table(name)?, key, set, parts)?,
                Change::Delete { table: name, key } => {
                    let table = table(name)?;
                    let sql = format!("delete from {} where {} = ?1", table.name, table.keyed()?);
                    run(&batch, &sql, vec![Sql::Text(key.clone())])?
                }
                Change::Clear { table: name, space } => {
                    let table = table(name)?;
                    let column = table
                        .space
                        .ok_or_else(|| format!("{} rows belong to no space", table.name))?;
                    let sql = format!("delete from {} where {column} = ?1", table.name);
                    run(&batch, &sql, vec![Sql::Text(space.clone())])?
                }
            });
        }

        // The log is capped in the same transaction that grew it, so it never holds
        // more than its thousand rows, not even between two batches.
        if logged {
            run(
                &batch,
                "delete from log where rowid <= (select max(rowid) from log) - ?1",
                vec![Sql::Integer(LOG_ROWS)],
            )?;
        }

        batch.commit()?;
        Ok(counts)
    }

    /// Closes the store, and says so if SQLite would not.
    pub fn close(self) -> Result<(), String> {
        self.conn
            .close()
            .map_err(|(_, error)| format!("the sync store would not close: {error}"))
    }
}

/// Every row a statement answers, as JSON objects by column name.
fn rows(
    conn: &Connection,
    table: &Table,
    sql: &str,
    values: &[Sql],
    parts: &mut Parts,
) -> Result<Vec<Json>, Failed> {
    let mut statement = conn.prepare_cached(sql)?;
    let mut rows = statement.query(params_from_iter(values))?;
    let mut out = Vec::new();

    while let Some(row) = rows.next()? {
        let mut object = Map::with_capacity(table.columns.len());
        for (at, column) in table.columns.iter().enumerate() {
            let value = row.get_ref(at)?;
            object.insert(column.name.to_owned(), from_sql(column, value, parts)?);
        }
        out.push(Json::Object(object));
    }

    Ok(out)
}

/// One statement, and how many rows it touched.
fn run(conn: &Connection, sql: &str, values: Vec<Sql>) -> Result<usize, Failed> {
    Ok(conn
        .prepare_cached(sql)?
        .execute(params_from_iter(values))?)
}

/// A whole row, over whatever had its key. Every column the row leaves out is empty,
/// which a column that may not be refuses; a name that is no column is refused too.
fn put(
    conn: &Connection,
    table: &Table,
    row: &Map<String, Json>,
    parts: &[&[u8]],
) -> Result<usize, Failed> {
    for name in row.keys() {
        table.column(name)?;
    }

    let mut values = Vec::with_capacity(table.columns.len());
    for column in table.columns {
        let value = row.get(column.name).unwrap_or(&Json::Null);
        values.push(to_sql(table, column, value, parts)?);
    }

    let slots = vec!["?"; values.len()].join(", ");
    let verb = if table.key.is_some() {
        "insert or replace"
    } else {
        "insert"
    };
    let sql = format!(
        "{verb} into {} ({}) values ({slots})",
        table.name,
        table.listed()
    );
    run(conn, &sql, values)
}

/// Some columns of one row. Its key is not one of them: a row that moves is a delete
/// and a put, said as such.
fn patch(
    conn: &Connection,
    table: &Table,
    key: &str,
    set: &Map<String, Json>,
    parts: &[&[u8]],
) -> Result<usize, Failed> {
    let keyed = table.keyed()?;
    if set.is_empty() {
        return Err(format!("a patch of {} changes nothing", table.name).into());
    }

    let mut assignments = Vec::with_capacity(set.len());
    let mut values = Vec::with_capacity(set.len() + 1);
    for (name, value) in set {
        let column = table.column(name)?;
        if column.name == keyed {
            return Err(format!("a patch of {} cannot change its {keyed}", table.name).into());
        }
        assignments.push(format!("{} = ?", column.name));
        values.push(to_sql(table, column, value, parts)?);
    }
    values.push(Sql::Text(key.to_owned()));

    let sql = format!(
        "update {} set {} where {keyed} = ?",
        table.name,
        assignments.join(", ")
    );
    run(conn, &sql, values)
}

/// Runs whatever of `migrations` the store has not run yet, and answers the schema it
/// is at afterwards.
///
/// Takes the list rather than reading `MIGRATIONS`, so a test can hand it a second
/// migration and watch the first one's rows survive it.
pub fn migrated_with(conn: &Connection, migrations: &[&str]) -> Result<usize, Refused> {
    let has_meta: bool = conn.query_row(
        "select exists (select 1 from sqlite_master where type = 'table' and name = 'meta')",
        [],
        |row| row.get(0),
    )?;
    let at: usize = if has_meta {
        let said: Option<i64> = conn
            .query_row("select value from meta where key = 'schema'", [], |row| {
                row.get(0)
            })
            .optional()?;
        said.and_then(|one| usize::try_from(one).ok()).unwrap_or(0)
    } else {
        0
    };

    if at > migrations.len() {
        return Err(Refused::Newer(at));
    }

    for (done, sql) in migrations.iter().enumerate().skip(at) {
        let step = conn.unchecked_transaction()?;
        step.execute_batch(sql)?;
        step.execute(
            "insert or replace into meta (key, value) values ('schema', ?1)",
            [i64::try_from(done + 1).unwrap_or(i64::MAX)],
        )?;
        step.commit()?;
    }

    Ok(migrations.len())
}

/// The schema this build knows, run on a connection: what the tests of the table list
/// hold it to.
#[cfg(test)]
pub fn migrated(conn: &Connection) -> Result<usize, Refused> {
    migrated_with(conn, &MIGRATIONS)
}

/// This device's id: the one the store already has, or a new one kept from now on.
fn device(conn: &Connection) -> Result<String, Refused> {
    let kept: Option<String> = conn
        .query_row("select value from meta where key = 'device'", [], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(kept) = kept {
        return Ok(kept);
    }

    let made = new_id()?;
    conn.execute(
        "insert into meta (key, value) values ('device', ?1)",
        [&made],
    )?;
    Ok(made)
}

/// A random id in the shape the account makes its own in (`crypto.randomUUID()`), so
/// a device id reads like every other id the server keeps.
fn new_id() -> Result<String, Refused> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|error| Refused::Other(format!("no randomness for a device id: {error}")))?;
    // Version 4, variant 1: the two fields that make these bytes a UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex = bytes
        .iter()
        .fold(String::with_capacity(32), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        });
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

/// Writes whether the session is ending cleanly, and answers what the store said
/// before. A store that never said is a new one, which has nothing a rotation could
/// protect, so it reads as clean.
fn mark_clean(conn: &Connection, clean: bool) -> Result<bool, rusqlite::Error> {
    let before: Option<i64> = conn
        .query_row(
            "select value from meta where key = 'clean_exit'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    conn.execute(
        "insert or replace into meta (key, value) values ('clean_exit', ?1)",
        [i64::from(clean)],
    )?;
    Ok(before.is_none_or(|said| said != 0))
}

/// Moves a store that cannot be read out of the way, with the log and the index beside
/// it, keeping the one damaged copy most recently set aside for whoever wants to look.
pub fn set_aside(path: &Path) -> Result<(), Refused> {
    let aside = with_suffix(path, ".damaged");
    let _ = fs::remove_file(&aside);
    fs::rename(path, &aside).map_err(|error| Refused::Other(cannot("set aside", path, &error)))?;
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(with_suffix(path, suffix));
    }
    Ok(())
}

/// Every file a store at `path` is kept in: itself, its log, its index and a damaged
/// copy set aside.
pub fn files_of(path: &Path) -> [PathBuf; 4] {
    [
        path.to_path_buf(),
        with_suffix(path, "-wal"),
        with_suffix(path, "-shm"),
        with_suffix(path, ".damaged"),
    ]
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::{files_of, migrated_with, Refused, Store, MIGRATIONS, MOST_PARTS};
    use crate::sync_store::wire::{frame, unframe, Change, Parts, Query};
    use rusqlite::Connection;
    use serde_json::{json, Value as Json};
    use std::io::{BufRead, BufReader};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::time::Instant;

    fn opened(path: &Path) -> Store {
        match Store::open(path) {
            Ok(store) => store,
            Err(refused) => panic!("{}", refused.said()),
        }
    }

    fn changes(value: Json) -> Vec<Change> {
        serde_json::from_value(value).expect("changes")
    }

    fn queries(value: Json) -> Vec<Query> {
        serde_json::from_value(value).expect("queries")
    }

    /// Parts as a write takes them: borrowed out of the envelope they arrived in.
    fn slices(parts: &[Vec<u8>]) -> Vec<&[u8]> {
        parts.iter().map(Vec::as_slice).collect()
    }

    /// A read as the window gets it: the JSON, and the parts its blobs name.
    fn read(store: &mut Store, asked: Json) -> (Json, Vec<Vec<u8>>) {
        store.read(&queries(asked)).expect("a read")
    }

    fn file(hash: &str) -> Json {
        json!({ "t": "put", "table": "files", "row": { "hash": hash, "state": "here" } })
    }

    #[test]
    fn a_new_store_is_at_the_latest_schema_with_a_device_of_its_own() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("sync").join("account.db");

        let store = opened(&path);
        assert_eq!(store.opened.schema, MIGRATIONS.len());
        assert!(!store.opened.recovered);
        assert!(store.opened.was_clean, "a new store has nothing to rotate");
        let device = store.opened.device.clone();
        assert_eq!(device.len(), 36);
        assert_eq!(&device[14..15], "4", "{device}");
        store.close().expect("closed");

        let again = opened(&path);
        assert_eq!(again.opened.device, device, "the device id is kept");
    }

    /// The flag the engine decides client-id rotation by: false from the moment a
    /// store is opened until the engine says the session ended cleanly.
    #[test]
    fn clean_exit_is_false_until_said_otherwise() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.db");

        opened(&path).close().expect("closed without a word");
        let crashed = opened(&path);
        assert!(!crashed.opened.was_clean, "nothing said it ended cleanly");

        assert_eq!(crashed.mark_clean(true), Ok(false));
        crashed.close().expect("closed");
        let clean = opened(&path);
        assert!(clean.opened.was_clean);
        clean.close().expect("closed");

        // And false again for the session that just opened.
        assert!(!opened(&path).opened.was_clean);
    }

    /// Forward only: a second migration runs once, over the first one's rows, and a
    /// store written by a newer nib is left exactly as it is.
    #[test]
    fn a_migration_runs_once_and_keeps_what_was_there() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.db");
        let mut store = opened(&path);
        store
            .write(&changes(json!([file("h")])), &[])
            .expect("a row");
        store.close().expect("closed");

        let conn = Connection::open(&path).expect("the file");
        let second = [MIGRATIONS[0], "alter table files add column size integer;"];
        assert!(matches!(migrated_with(&conn, &second), Ok(2)));
        assert!(
            matches!(migrated_with(&conn, &second), Ok(2)),
            "and not twice"
        );
        let kept: String = conn
            .query_row("select state from files where hash = 'h'", [], |row| {
                row.get(0)
            })
            .expect("the row survived");
        assert_eq!(kept, "here");
        drop(conn);

        let Err(refused) = Store::open(&path) else {
            panic!("a store from a newer nib was opened");
        };
        assert!(matches!(refused, Refused::Newer(2)), "{}", refused.said());
        let conn = Connection::open(&path).expect("the file");
        let columns: i64 = conn
            .query_row(
                "select count(*) from pragma_table_info('files')",
                [],
                |row| row.get(0),
            )
            .expect("its shape");
        assert_eq!(columns, 3, "left as the newer nib made it");
    }

    #[test]
    fn a_file_that_is_not_a_store_is_set_aside_and_a_new_one_made() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.db");
        std::fs::write(&path, b"this was never a database, not even a little bit").expect("junk");

        let store = opened(&path);
        assert!(store.opened.recovered);
        assert_eq!(store.opened.schema, MIGRATIONS.len());
        let aside = &files_of(&path)[3];
        assert!(aside.exists(), "the damaged copy is kept");
    }

    /// All or nothing: a batch with one bad change writes none of the good ones, and
    /// that holds for a change the store refuses and for one SQLite refuses.
    #[test]
    fn a_batch_that_fails_leaves_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));

        let refused = store.write(
            &changes(json!([
                file("a"),
                file("b"),
                { "t": "put", "table": "files", "row": { "hash": "c", "state": 3 } },
            ])),
            &[],
        );
        assert!(refused.is_err());

        let unknown = store.write(
            &changes(json!([
                file("a"),
                { "t": "patch", "table": "files", "key": "a", "set": { "hash": "z" } },
            ])),
            &[],
        );
        assert!(unknown
            .expect_err("a key changed")
            .said
            .contains("cannot change"));

        let (answer, _) = read(&mut store, json!([{ "t": "scan", "table": "files" }]));
        assert_eq!(answer, json!([[]]));

        assert_eq!(store.write(&changes(json!([file("a")])), &[]), Ok(vec![1]));
    }

    /// Every operation, and what each answers: a put, a patch of some columns, a get,
    /// a scan narrowed to one space in the table's own order, a delete and a clear.
    #[test]
    fn each_operation_does_what_it_says() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));

        let entry = |id: &str, space: &str| {
            json!({ "t": "put", "table": "entries", "row": {
                "id": id, "space_id": space, "kind": "note", "parent": null, "name": format!("{id}.md"),
                "local_path": format!("{id}.md"), "deleted": false,
            } })
        };
        let counts = store
            .write(
                &changes(json!([
                    entry("b", "one"),
                    entry("a", "one"),
                    entry("c", "two"),
                    { "t": "patch", "table": "entries", "key": "a", "set": { "size": 12, "deleted": true } },
                    { "t": "patch", "table": "entries", "key": "missing", "set": { "size": 1 } },
                ])),
                &[],
            )
            .expect("written");
        assert_eq!(counts, [1, 1, 1, 1, 0], "a patch of nothing says so");

        let (answer, _) = read(
            &mut store,
            json!([
                { "t": "get", "table": "entries", "key": "a" },
                { "t": "get", "table": "entries", "key": "nobody" },
                { "t": "scan", "table": "entries", "space": "one" },
            ]),
        );
        assert_eq!(answer[0]["size"], 12);
        assert_eq!(answer[0]["deleted"], true);
        assert_eq!(answer[0]["mtime"], Json::Null);
        assert_eq!(answer[1], Json::Null);
        let ids: Vec<&str> = answer[2]
            .as_array()
            .expect("rows")
            .iter()
            .filter_map(|row| row["id"].as_str())
            .collect();
        assert_eq!(ids, ["a", "b"]);

        let counts = store
            .write(
                &changes(json!([
                    { "t": "delete", "table": "entries", "key": "b" },
                    { "t": "clear", "table": "entries", "space": "two" },
                ])),
                &[],
            )
            .expect("removed");
        assert_eq!(counts, [1, 1]);
        let (answer, _) = read(&mut store, json!([{ "t": "scan", "table": "entries" }]));
        assert_eq!(answer[0].as_array().map(Vec::len), Some(1));

        assert!(store
            .read(&queries(
                json!([{ "t": "scan", "table": "files", "space": "one" }])
            ))
            .is_err());
    }

    /// Bytes in, the same bytes out, through the frame the window speaks: every value
    /// a byte can have, and a document's worth of them.
    #[test]
    fn bytes_come_back_as_they_went() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));

        let every: Vec<u8> = (0..=255).collect();
        let large: Vec<u8> = (0..1_000_000_u32).map(|at| (at % 251) as u8).collect();
        let mut parts = Parts::default();
        let confirmed = parts.add(&large);
        let sv = parts.add(&every);
        let empty = parts.add(&[]);
        let sent = frame(
            &json!([{ "t": "put", "table": "docs", "row": {
                "id": "n", "epoch": 1, "client_id": 4_294_967_295_u32, "confirmed": confirmed,
                "confirmed_sv": sv, "pending": empty, "pending_at": 1_700_000_000_000_i64,
            } }]),
            &parts.into_parts(),
        );

        let (value, tail) = unframe(&sent).expect("the envelope");
        let batch: Vec<Change> = serde_json::from_value(value).expect("changes");
        store.write(&batch, &tail).expect("written");

        let (answer, parts) = read(
            &mut store,
            json!([{ "t": "get", "table": "docs", "key": "n" }]),
        );
        let slice = |value: &Json| {
            let at = usize::try_from(value["$part"].as_u64().expect("a part")).expect("fits");
            parts[at].clone()
        };
        let row = &answer[0];
        assert_eq!(slice(&row["confirmed"]), large);
        assert_eq!(slice(&row["confirmed_sv"]), every);
        assert_eq!(slice(&row["pending"]), Vec::<u8>::new());
        assert_eq!(row["client_id"], 4_294_967_295_u32);
    }

    /// One answer carries at most the envelope's ceiling of parts, which is what the
    /// window's `unframe` holds every envelope to; past it the read says so in words.
    #[test]
    fn a_read_past_the_envelope_is_refused_in_words() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));
        let mut parts = Parts::default();
        let rows: Vec<Json> = (0..=MOST_PARTS / 2)
            .map(|at| {
                json!({ "t": "put", "table": "docs", "row": {
                    "id": format!("doc-{at:05}"), "epoch": 1, "client_id": at,
                    "confirmed": parts.add(&[1]), "confirmed_sv": parts.add(&[2]),
                } })
            })
            .collect();
        store
            .write(&changes(Json::Array(rows)), &slices(&parts.into_parts()))
            .expect("written");

        let refused = store
            .read(&queries(json!([{ "t": "scan", "table": "docs" }])))
            .expect_err("too many parts");
        assert!(refused.said.contains("ask in batches"), "{}", refused.said);
        let (half, _) = read(
            &mut store,
            json!([{ "t": "get", "table": "docs", "key": "doc-00001" }]),
        );
        assert_eq!(half[0]["client_id"], 1);
    }

    #[test]
    fn what_nib_wrote_is_kept_small_and_read_back_whole() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));
        let text = "# Plan\n\nThe same line of prose, written again.\n".repeat(400);

        store
            .write(
                &changes(
                    json!([{ "t": "put", "table": "written", "row": { "id": "n", "text": text } }]),
                ),
                &[],
            )
            .expect("written");
        let (answer, _) = read(
            &mut store,
            json!([{ "t": "get", "table": "written", "key": "n" }]),
        );
        assert_eq!(answer[0]["text"], text);
    }

    #[test]
    fn the_log_keeps_its_newest_thousand_rows() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.db"));

        let rows: Vec<Json> = (0..1200)
            .map(|at| json!({ "t": "put", "table": "log", "row": { "at": at, "space": "s", "pulled": 1 } }))
            .collect();
        store
            .write(&changes(Json::Array(rows)), &[])
            .expect("logged");

        let (answer, _) = read(
            &mut store,
            json!([{ "t": "scan", "table": "log", "space": "s" }]),
        );
        let kept = answer[0].as_array().expect("rows");
        assert_eq!(kept.len(), 1000);
        assert_eq!(kept[0]["at"], 200, "the oldest went first");
        assert_eq!(kept[999]["at"], 1199);
    }

    /// The name of the test the killed writer runs as, and the variable that tells it
    /// where its store is. Run on its own it does nothing: it is a child's half.
    const CHILD: &str = "sync_store::store::tests::a_child_writes_and_waits_to_be_killed";
    const CHILD_STORE: &str = "NIB_SYNC_STORE_CHILD";

    #[test]
    #[ignore = "the child half of `a_kill_between_write_and_checkpoint_loses_nothing`"]
    fn a_child_writes_and_waits_to_be_killed() {
        let Some(path) = std::env::var_os(CHILD_STORE) else {
            return;
        };
        let mut store = opened(Path::new(&path));
        store
            .conn
            .pragma_update(None, "wal_autocheckpoint", 0)
            .expect("no checkpoint");
        let rows: Vec<Json> = (0..50).map(|at| file(&format!("h{at}"))).collect();
        store
            .write(&changes(Json::Array(rows)), &[])
            .expect("written");

        println!("written");
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    /// The crash the write-ahead log is for: a process killed after its transaction
    /// committed and before anything was copied into the database file. Another
    /// process opens the store and finds every row.
    #[test]
    fn a_kill_between_write_and_checkpoint_loses_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.db");

        let mut child = Command::new(std::env::current_exe().expect("this test binary"))
            .args([
                CHILD,
                "--exact",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_STORE, &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("a child");
        let stdout = child.stdout.take().expect("its output");
        let said = BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
            .any(|line| line.contains("written"));
        child.kill().expect("killed");
        let _ = child.wait();
        assert!(said, "the child never wrote");

        let log = std::fs::metadata(&files_of(&path)[1]).map(|meta| meta.len());
        assert!(
            log.is_ok_and(|size| size > 0),
            "the rows were only in the log"
        );

        let mut store = opened(&path);
        assert!(!store.opened.was_clean, "a kill is not a clean exit");
        let (answer, _) = read(&mut store, json!([{ "t": "scan", "table": "files" }]));
        assert_eq!(answer[0].as_array().map(Vec::len), Some(50));
    }

    /// The two numbers the brief holds the store to, measured on a store the size of a
    /// large account. A timing test, so it is run by hand, in release, and its numbers
    /// go in the commit message:
    ///
    ///     cargo test --release --lib sync_store::store::tests::measured -- --ignored --nocapture
    #[test]
    #[ignore = "a measurement, run by hand in release"]
    fn measured() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.db");
        let confirmed = vec![7_u8; 4096];
        let sv = vec![1_u8; 24];
        let doc = |id: usize, parts: &mut Parts| {
            json!({ "t": "put", "table": "docs", "row": {
                "id": format!("doc-{id:06}"), "epoch": 1, "client_id": id,
                "confirmed": parts.add(&confirmed), "confirmed_sv": parts.add(&sv),
                "pending": null, "pending_at": null,
            } })
        };

        let mut store = opened(&path);
        for thousand in 0..10 {
            let mut parts = Parts::default();
            let rows: Vec<Json> = (0..1000)
                .map(|at| doc(thousand * 1000 + at, &mut parts))
                .collect();
            store
                .write(&changes(Json::Array(rows)), &slices(&parts.into_parts()))
                .expect("rows");
        }
        store.mark_clean(true).expect("clean");
        store.close().expect("closed");

        let started = Instant::now();
        let mut store = opened(&path);
        let open = started.elapsed();
        assert!(store.opened.was_clean);

        let mut parts = Parts::default();
        let rows: Vec<Json> = (0..500).map(|at| doc(20_000 + at, &mut parts)).collect();
        let batch = changes(Json::Array(rows));
        let tail = parts.into_parts();
        let started = Instant::now();
        store.write(&batch, &slices(&tail)).expect("500 rows");
        let write = started.elapsed();

        // What the crate's half of the bridge costs for the same five hundred documents,
        // framed against spelled as JSON number arrays, which is what Tauri's IPC does
        // with bytes that are not sent raw.
        let bytes: Vec<u8> = (0..500 * (4096 + 24_u32))
            .map(|at| (at % 251) as u8)
            .collect();
        let started = Instant::now();
        let framed = frame(
            &json!({ "one": { "$part": 0 } }),
            std::slice::from_ref(&bytes),
        );
        let (_, tail) = unframe(&framed).expect("an envelope");
        let raw = started.elapsed();
        assert_eq!(tail[0].len(), bytes.len());
        let started = Instant::now();
        let spelled = serde_json::to_string(&bytes).expect("json");
        let back: Vec<u8> = serde_json::from_str(&spelled).expect("json back");
        let as_json = started.elapsed();
        assert_eq!(back.len(), bytes.len());

        println!("open with 10,000 docs: {open:?}; a batch of 500 docs: {write:?}");
        println!(
            "500 docs' bytes ({} B): framed {raw:?}, as JSON numbers {as_json:?} ({} B)",
            bytes.len(),
            spelled.len()
        );
        assert!(open.as_millis() < 20, "{open:?}");
        assert!(write.as_millis() < 50, "{write:?}");
    }
}
