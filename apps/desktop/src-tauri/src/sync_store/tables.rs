//! What the store's tables hold, column by column, as the one list both directions
//! are checked against.
//!
//! The SQL in `1.sql` makes the tables; this says what may go into each column and
//! what comes out of it, which SQL cannot: SQLite keeps whatever it is handed in any
//! column, so a number where a name was meant is stored without a word and read back
//! as a surprise a week later. Every value the window sends is held to this before a
//! statement is built, and every column name in a statement comes from here rather
//! than from the window, so no name the window sends is ever written into SQL.
//!
//! The same list is written once more in the window, in `src/lib/sync2/store.ts`, for
//! the rows that come back and for the browser's own store. Both are held to what the
//! migrations actually make: the test below here, and `store.test.ts` there, which runs
//! the same `.sql` files in Node's SQLite.

/// What a column holds, which decides what the window may send for it and what it is
/// given back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A string.
    Text,
    /// A whole number, within what the window's numbers hold exactly.
    Integer,
    /// A yes or no, kept as 0 or 1 because SQLite has no other way to keep one.
    Bool,
    /// Bytes, which cross the bridge as bytes; see wire.rs.
    Blob,
    /// A string the store compresses on the way in and opens on the way out, so the
    /// window deals in text and the disk holds a third of it; see `pack` in wire.rs.
    Packed,
    /// Whatever a `meta` row holds: a string, a number, bytes or nothing.
    Any,
}

/// One column: its name in SQL, what it holds, and whether it may be empty.
#[derive(Debug)]
pub struct Column {
    /// The name the SQL gave it, which is also the name the window sends it under.
    pub name: &'static str,
    /// What it holds.
    pub kind: Kind,
    /// Whether it was declared `not null`.
    pub required: bool,
}

/// One table: its columns, and the three things a batch needs to know about it.
#[derive(Debug)]
pub struct Table {
    /// The name the SQL gave it.
    pub name: &'static str,
    /// The column a row is found by. Every table has one but the log, whose rows are
    /// only ever added and read in order.
    pub key: Option<&'static str>,
    /// The column that says which space a row belongs to, for the tables a scan may
    /// be narrowed to one space in.
    pub space: Option<&'static str>,
    /// The order a scan answers in, the same order the browser's store answers in:
    /// see `scan` in src/lib/web/sync-store.ts.
    pub order: &'static str,
    /// Every column, in the order the SQL declares them.
    pub columns: &'static [Column],
}

/// A column that may be empty.
const fn maybe(name: &'static str, kind: Kind) -> Column {
    Column {
        name,
        kind,
        required: false,
    }
}

/// A column that may not.
const fn always(name: &'static str, kind: Kind) -> Column {
    Column {
        name,
        kind,
        required: true,
    }
}

/// Every table, as schema 1 made it.
pub const TABLES: [Table; 10] = [
    Table {
        name: "meta",
        key: Some("key"),
        space: None,
        order: "key",
        columns: &[always("key", Kind::Text), maybe("value", Kind::Any)],
    },
    Table {
        name: "spaces",
        key: Some("space_id"),
        space: None,
        order: "space_id",
        columns: &[
            always("space_id", Kind::Text),
            always("root", Kind::Text),
            always("cursor", Kind::Integer),
            maybe("role", Kind::Text),
            maybe("store", Kind::Text),
        ],
    },
    Table {
        name: "entries",
        key: Some("id"),
        space: Some("space_id"),
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("space_id", Kind::Text),
            always("kind", Kind::Text),
            maybe("parent", Kind::Text),
            always("name", Kind::Text),
            always("local_path", Kind::Text),
            maybe("file_key", Kind::Text),
            maybe("written_hash", Kind::Text),
            maybe("mtime", Kind::Integer),
            maybe("size", Kind::Integer),
            maybe("seq", Kind::Integer),
            always("deleted", Kind::Bool),
        ],
    },
    Table {
        name: "written",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[always("id", Kind::Text), always("text", Kind::Packed)],
    },
    Table {
        name: "docs",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("epoch", Kind::Integer),
            always("client_id", Kind::Integer),
            always("confirmed", Kind::Blob),
            always("confirmed_sv", Kind::Blob),
            maybe("pending", Kind::Blob),
            maybe("pending_at", Kind::Integer),
        ],
    },
    Table {
        name: "outbox",
        key: Some("op_id"),
        space: Some("space_id"),
        order: "made_at, op_id",
        columns: &[
            always("op_id", Kind::Text),
            always("space_id", Kind::Text),
            always("op", Kind::Blob),
            always("seen", Kind::Integer),
            always("made_at", Kind::Integer),
        ],
    },
    Table {
        name: "held",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("remote", Kind::Blob),
            always("remote_sv", Kind::Blob),
            maybe("device", Kind::Text),
            always("at", Kind::Integer),
        ],
    },
    Table {
        name: "files",
        key: Some("hash"),
        space: None,
        order: "hash",
        columns: &[always("hash", Kind::Text), always("state", Kind::Text)],
    },
    Table {
        name: "web",
        key: Some("key"),
        space: None,
        order: "key",
        columns: &[
            always("key", Kind::Text),
            maybe("fence", Kind::Integer),
            maybe("version", Kind::Integer),
            maybe("applied", Kind::Integer),
        ],
    },
    Table {
        name: "log",
        key: None,
        space: Some("space"),
        order: "rowid",
        columns: &[
            always("at", Kind::Integer),
            maybe("space", Kind::Text),
            maybe("pulled", Kind::Integer),
            maybe("pushed", Kind::Integer),
            maybe("failed", Kind::Text),
        ],
    },
];

/// The table a name the window sent means, or the sentence that says it means none.
pub fn table(name: &str) -> Result<&'static Table, String> {
    TABLES
        .iter()
        .find(|one| one.name == name)
        .ok_or_else(|| format!("the sync store has no table {name}"))
}

impl Table {
    /// The column a name the window sent means.
    pub fn column(&self, name: &str) -> Result<&'static Column, String> {
        self.columns
            .iter()
            .find(|one| one.name == name)
            .ok_or_else(|| format!("{} has no column {name}", self.name))
    }

    /// The column a row is found by, or the refusal for the log, which has none.
    pub fn keyed(&self) -> Result<&'static str, String> {
        self.key
            .ok_or_else(|| format!("{} rows have no key to find one by", self.name))
    }

    /// Every column's name, comma separated, in the order they are declared: what a
    /// `select` and an `insert` both list.
    pub fn listed(&self) -> String {
        self.columns
            .iter()
            .map(|one| one.name)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::{table, Kind, TABLES};
    use crate::sync_store::store::migrated;
    use rusqlite::Connection;

    /// The list is what the migrations make: every table, every column, in the SQL's
    /// order, with the SQL's `not null`. A column added to one and not the other is a
    /// value refused for no reason, or one stored unchecked.
    #[test]
    fn the_list_is_what_the_migrations_make() {
        let conn = Connection::open_in_memory().expect("a store in memory");
        migrated(&conn).expect("the migrations");

        for one in &TABLES {
            let mut asked = conn
                .prepare(&format!("pragma table_info({})", one.name))
                .expect("the table's shape");
            let made: Vec<(String, String, bool, bool)> = asked
                .query_map([], |row| {
                    Ok((
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get::<_, i64>(5)? > 0,
                    ))
                })
                .expect("its columns")
                .collect::<Result<_, _>>()
                .expect("every column");

            let names: Vec<&str> = made.iter().map(|(name, ..)| name.as_str()).collect();
            let listed: Vec<&str> = one.columns.iter().map(|column| column.name).collect();
            assert_eq!(names, listed, "{}", one.name);

            for (column, (name, declared, not_null, key)) in one.columns.iter().zip(&made) {
                // A text primary key may be null in SQLite, for old compatibility; the
                // store holds it to what a key means instead.
                assert_eq!(column.required, *not_null || *key, "{}.{name}", one.name);
                assert_eq!(one.key == Some(column.name), *key, "{}.{name}", one.name);
                let fits = match column.kind {
                    Kind::Text => declared == "TEXT",
                    Kind::Integer | Kind::Bool => declared == "INTEGER",
                    Kind::Blob | Kind::Packed | Kind::Any => declared == "BLOB",
                };
                assert!(fits, "{}.{name} is {declared}", one.name);
            }
        }

        let count: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type = 'table'",
                [],
                |row| row.get(0),
            )
            .expect("the tables");
        assert_eq!(usize::try_from(count).ok(), Some(TABLES.len()));
    }

    #[test]
    fn a_name_nobody_made_is_refused() {
        assert!(table("docs").is_ok());
        assert!(table("sqlite_master").is_err());
        assert!(table("docs; drop table docs").is_err());
        assert!(table("docs")
            .and_then(|docs| docs.column("id; --"))
            .is_err());
        assert!(table("log").and_then(super::Table::keyed).is_err());
    }
}
