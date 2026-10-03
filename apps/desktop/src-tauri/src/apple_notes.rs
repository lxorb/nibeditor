//! Apple Notes, read out of the database Notes keeps on this Mac.
//!
//! Notes has no export. What it offers is a PDF per note, which is a picture of a
//! note rather than a note, so the only way in is the database itself:
//! `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`, with the
//! attachments in folders beside it. That is what Obsidian's importer reads, and
//! this reads the same rows the same way.
//!
//! Which is why this is a Mac-only command. nib runs on Windows, Linux, Android
//! and in a browser as well, and on those there is no database to read: the sheet
//! says so, and what it offers instead is the folder an exporter wrote.
//!
//! macOS keeps that folder behind Full Disk Access, so the first read of it fails
//! with the system's own refusal. That is answered as `no access`, which the sheet
//! turns into a line and a button that opens the setting.
//!
//! The words of a note are `apple_text`'s business; this module is the rows: which
//! folders there are, which notes are in them, when each was written, and which
//! file an attachment is.

use serde::Serialize;

/// One note, in the shape the import's own readers hand over: where it goes,
/// what it says, and when it was written.
#[derive(Serialize, Debug)]
pub struct Note {
    /// The folders it sat in, its own name, and `.md`, which is what a link from
    /// another note points at as well. Whether a name may be spelled that way is
    /// the window's to decide, the way it is for every other import.
    pub path: String,
    /// What Notes listed it as, for a note whose words do not open with a title.
    pub title: String,
    /// The note, as markdown.
    pub text: String,
    /// Seconds since 1970, or zero for a note whose row says nothing. Apple
    /// counts from 2001; the shift happens here so the window reads one clock.
    pub created: i64,
    /// The same for the day it was last edited.
    pub modified: i64,
}

/// One attachment: where it goes beside the notes, and its bytes.
#[derive(Serialize, Debug)]
pub struct Media {
    /// Relative to the import, like a note's.
    pub path: String,
    /// Base64, which is how bytes cross the bridge everywhere else in here.
    pub bytes: String,
}

/// Everything one read of the database found, counts included, so the sheet can
/// say what is not coming with them before it writes anything.
#[derive(Serialize, Default, Debug)]
pub struct Read {
    /// In no particular order: the import sorts nothing, and the folders each
    /// note names are what put it where it goes.
    pub notes: Vec<Note>,
    /// The attachments those notes point at, each written once however many
    /// notes show it.
    pub media: Vec<Media>,
    /// Notes behind a password, which nothing but Notes can open.
    pub locked: u32,
    /// Notes in Recently Deleted, which stay there.
    pub binned: u32,
    /// Drawings and scanned pages with no picture of them on this Mac: Notes draws one
    /// for each as it is shown, and one it has not drawn here is not on the disk.
    pub drawn: u32,
    /// Tables inside notes that could not be read as one.
    pub tables: u32,
    /// Attachments whose file is in iCloud rather than on this disk.
    pub missing: u32,
}

/// Every note on this Mac, read out of Notes' own database.
#[tauri::command(async)]
pub fn read_apple_notes() -> Result<Read, String> {
    #[cfg(target_os = "macos")]
    {
        mac::read()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Apple Notes keeps its notes on a Mac, and this is not one".to_string())
    }
}

/// Opens the setting that would let the app read that database. Said as its own
/// command because a sheet that asks for a permission and leaves the reader to
/// find the pane themselves has asked them to do the work twice.
#[tauri::command(async)]
pub fn open_full_disk_access() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::open_setting()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Full Disk Access is a setting a Mac has".to_string())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    //! The database itself, which only a Mac has.

    use std::collections::{HashMap, HashSet};
    use std::path::{Path, PathBuf};

    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use rusqlite::{Connection, OpenFlags};

    use super::{Media, Note, Read};
    use crate::apple_text::{self, Body, Parts};

    /// What the window is answered when macOS refuses the folder, which is what
    /// it does until nibeditor has Full Disk Access. The sheet reads these two
    /// rather than showing them, so they are words the window knows and not words
    /// a reader is shown.
    const NO_ACCESS: &str = "no access";

    /// And where Notes has never been used, so there is no database at all.
    const NO_DATABASE: &str = "no database";

    /// Where Notes keeps everything, under the reader's home folder.
    const CONTAINER: &str = "Library/Group Containers/group.com.apple.notes";

    /// The database, and the two files it may be mid-write into.
    const DATABASE: &str = "NoteStore.sqlite";
    const ALONGSIDE: [&str; 2] = ["NoteStore.sqlite-wal", "NoteStore.sqlite-shm"];

    /// Apple counts seconds from 2001 where everything else counts from 1970.
    const FROM_2001: f64 = 978_307_200.0;

    /// A folder Notes made for itself rather than one somebody named.
    const TRASH: i64 = 1;
    const SMART: i64 = 3;

    /// The attachments that are words rather than files: a tag, a mention of
    /// somebody, and a link to another note.
    const HASHTAG: &str = "com.apple.notes.inlinetextattachment.hashtag";
    const MENTION: &str = "com.apple.notes.inlinetextattachment.mention";
    const INTERNAL: &str = "com.apple.notes.inlinetextattachment.link";
    /// A link Notes drew a card for.
    const CARD: &str = "public.url";
    /// A table inside a note, which is a document of its own in another row.
    const TABLE: &str = "com.apple.notes.table";

    /// A sketch, in the three shapes Notes has stored one in. What it keeps is the
    /// strokes; the picture of them is the fallback image Notes draws beside the
    /// database for whatever cannot draw strokes, which is what comes over.
    const DRAWINGS: [&str; 3] = [
        "com.apple.paper",
        "com.apple.drawing",
        "com.apple.drawing.2",
    ];

    /// A scan: a gallery of pages, each page a picture attachment of its own.
    const SCAN: &str = "com.apple.notes.gallery";

    /// A scan somebody has marked up, which Notes keeps as the PDF it made of it.
    const MARKED_SCAN: &str = "com.apple.paper.doc.scan";

    /// What a picture is, for the difference between a note showing a file and a
    /// note linking to one.
    const PICTURES: [&str; 9] = [
        "png", "jpg", "jpeg", "gif", "heic", "heif", "webp", "tiff", "bmp",
    ];

    /// Every note in Notes on this Mac.
    pub fn read() -> Result<Read, String> {
        let home = std::env::var_os("HOME").ok_or_else(|| "there is no home folder".to_string())?;
        let base = PathBuf::from(home).join(CONTAINER);

        read_from(&base)
    }

    /// Opens Full Disk Access in System Settings.
    pub fn open_setting() -> Result<(), String> {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles")
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("that setting would not open: {error}"))
    }

    /// Every note under one group container, which is the reader's own on a Mac
    /// and a folder of test files under `cargo test`.
    pub fn read_from(base: &Path) -> Result<Read, String> {
        let copied = copy_out(base)?;
        let db = Connection::open_with_flags(
            copied.path().join(DATABASE),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|error| format!("that database would not open: {error}"))?;

        let keys = keys(&db)?;
        let known = columns(&db, "ziccloudsyncingobject")?;
        let folders = folders(&db, &keys)?;
        let rows = notes(&db, &keys, &known)?;

        let mut read = Read::default();
        let mut where_notes_went = HashMap::new();
        let mut taken = HashSet::new();
        let mut kept = Vec::new();

        for row in rows {
            if row.locked {
                read.locked += 1;
                continue;
            }

            // A note whose folder is not in the table is still a note, and it
            // arrives at the top of the import rather than not at all.
            if folders
                .get(&row.folder)
                .is_some_and(|one| one.kind == TRASH)
            {
                read.binned += 1;
                continue;
            }

            let Some(place) = place_of(&row, &folders, &mut taken) else {
                continue;
            };

            where_notes_went.insert(row.identifier.to_uppercase(), place.clone());
            kept.push((row, place));
        }

        let roots = roots(&db, &keys, base)?;
        let mut found = Found::new(&db, roots, where_notes_went, known);

        for (row, place) in kept {
            let text = apple_text::markdown(&row.body, &mut found);
            let title = apple_text::title(&row.body).unwrap_or_else(|| row.title.clone());
            read.notes.push(Note {
                path: format!("{place}.md"),
                title,
                text,
                created: unix(row.created),
                modified: unix(row.modified),
            });
        }

        found.report(&mut read);

        Ok(read)
    }

    /// The database, copied somewhere it cannot change while it is being read.
    ///
    /// Notes is very likely running, and a note written halfway through an import
    /// leaves the read looking at a page that moved. The copy is also where the
    /// system's refusal shows up, which is the whole of the Full Disk Access
    /// story: the folder is readable or it is not.
    fn copy_out(base: &Path) -> Result<tempfile::TempDir, String> {
        let copied =
            tempfile::tempdir().map_err(|error| format!("no temporary folder: {error}"))?;

        // The copy is the permission check as well, and it is the honest one: with
        // Full Disk Access off macOS refuses to open this file at all, and asking
        // whether it is even there is answered by the same refusal.
        if let Err(error) = std::fs::copy(base.join(DATABASE), copied.path().join(DATABASE)) {
            return Err(refusal(base, error));
        }

        // Both of these are only there while Notes has the database open, and a
        // copy without them is the database as of the last time it was closed -
        // which is a note or two behind rather than unreadable, so failing to copy
        // them is not failing to import.
        for name in ALONGSIDE {
            let _ = std::fs::copy(base.join(name), copied.path().join(name));
        }

        Ok(copied)
    }

    /// Why the database could not be copied: one of the two marks the sheet knows,
    /// or the system's own words.
    fn refusal(base: &Path, error: std::io::Error) -> String {
        // A group container that is there and holds no database is a Mac whose
        // owner has never opened Notes. Anything else - refused outright, or not
        // there at all - is the system declining to say, which is what it does
        // about this folder until the app is allowed to read it.
        match error.kind() {
            std::io::ErrorKind::NotFound if base.is_dir() => NO_DATABASE.to_string(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => {
                NO_ACCESS.to_string()
            }
            _ => format!("that database would not be read: {error}"),
        }
    }

    /// Seconds since 1970 out of Apple's own clock, or zero for a row that says
    /// nothing.
    fn unix(seconds: f64) -> i64 {
        let shifted = seconds + FROM_2001;
        if seconds <= 0.0 || !shifted.is_finite() {
            return 0;
        }

        whole(shifted)
    }

    /// A count of seconds with its fraction dropped. A day is what the note will
    /// carry, so the fraction of a second Apple stores is of no use to anybody
    /// here, and an `as` is how a float is made whole.
    #[allow(clippy::cast_possible_truncation)]
    fn whole(seconds: f64) -> i64 {
        seconds.trunc() as i64
    }

    /// Which number each of Core Data's own kinds is on this machine, since the
    /// numbers are assigned per database rather than fixed.
    fn keys(db: &Connection) -> Result<HashMap<String, i64>, String> {
        let mut statement = db
            .prepare("SELECT z_name, z_ent FROM z_primarykey")
            .map_err(|error| format!("that database is not Notes': {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("that database is not Notes': {error}"))?;

        let mut found = HashMap::new();
        for row in rows {
            let (name, ent) =
                row.map_err(|error| format!("that database is not Notes': {error}"))?;
            found.insert(name, ent);
        }

        Ok(found)
    }

    /// The columns one table has, because Notes has added some over the years and
    /// a database written by an older macOS has fewer.
    fn columns(db: &Connection, table: &str) -> Result<HashSet<String>, String> {
        let mut statement = db
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("that database would not be read: {error}"))?;

        let rows = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("that database would not be read: {error}"))?;

        let mut found = HashSet::new();
        for row in rows {
            let name = row.map_err(|error| format!("that database would not be read: {error}"))?;
            found.insert(name.to_lowercase());
        }

        Ok(found)
    }

    /// One of Notes' own folders.
    struct Folder {
        title: String,
        parent: Option<i64>,
        /// A default folder, the bin, or a smart folder.
        kind: i64,
        /// Notes in the folder Notes starts with go straight into the import,
        /// because `Notes` inside a folder called Apple Notes is a folder saying
        /// the same thing twice.
        first: bool,
    }

    fn folders(
        db: &Connection,
        keys: &HashMap<String, i64>,
    ) -> Result<HashMap<i64, Folder>, String> {
        let ent = keys.get("ICFolder").copied().unwrap_or(0);
        let mut statement = db
            .prepare(
                "SELECT z_pk, ztitle2, zparent, zfoldertype, zidentifier
                 FROM ziccloudsyncingobject WHERE z_ent = ?1",
            )
            .map_err(|error| format!("those folders would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| {
                let identifier = row.get::<_, Option<String>>(4)?.unwrap_or_default();
                Ok((
                    row.get::<_, i64>(0)?,
                    Folder {
                        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        parent: row.get::<_, Option<i64>>(2)?,
                        kind: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                        first: identifier.starts_with("DefaultFolder"),
                    },
                ))
            })
            .map_err(|error| format!("those folders would not be read: {error}"))?;

        let mut found = HashMap::new();
        for row in rows {
            let (id, folder) =
                row.map_err(|error| format!("those folders would not be read: {error}"))?;
            found.insert(id, folder);
        }

        Ok(found)
    }

    /// One note's row, with its body already decoded.
    struct Row {
        title: String,
        folder: i64,
        identifier: String,
        created: f64,
        modified: f64,
        locked: bool,
        body: Body,
    }

    fn notes(
        db: &Connection,
        keys: &HashMap<String, i64>,
        known: &HashSet<String>,
    ) -> Result<Vec<Row>, String> {
        let ent = keys.get("ICNote").copied().unwrap_or(0);
        let created = first_of(
            known,
            &["zcreationdate3", "zcreationdate2", "zcreationdate1"],
        );
        let modified = first_of(known, &["zmodificationdate1", "zmodificationdate"]);
        let locked = if known.contains("zispasswordprotected") {
            "note.zispasswordprotected"
        } else {
            "0"
        };

        let query = format!(
            "SELECT note.ztitle1, note.zfolder, note.zidentifier, {created}, {modified},
                    {locked}, data.zdata
             FROM zicnotedata AS data
             JOIN ziccloudsyncingobject AS note ON note.z_pk = data.znote
             WHERE note.z_ent = ?1 AND note.ztitle1 IS NOT NULL"
        );

        let mut statement = db
            .prepare(&query)
            .map_err(|error| format!("those notes would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| {
                Ok(Row {
                    title: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    folder: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    identifier: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    created: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    modified: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    locked: row.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0,
                    body: row
                        .get::<_, Option<Vec<u8>>>(6)?
                        .as_deref()
                        .and_then(apple_text::decode)
                        .unwrap_or_default(),
                })
            })
            .map_err(|error| format!("those notes would not be read: {error}"))?;

        let mut found = Vec::new();
        for row in rows {
            found.push(row.map_err(|error| format!("those notes would not be read: {error}"))?);
        }

        Ok(found)
    }

    /// The first of these columns this database has, as something to select, and
    /// a zero where it has none of them.
    fn first_of(known: &HashSet<String>, names: &[&str]) -> String {
        let mut said: Vec<String> = names
            .iter()
            .filter(|name| known.contains(**name))
            .map(|name| format!("note.{name}"))
            .collect();

        match said.len() {
            0 => "0".to_string(),
            1 => said.remove(0),
            // The newest one that has anything in it, which is how Notes has
            // moved the date from column to column across its versions.
            _ => format!("COALESCE({})", said.join(", ")),
        }
    }

    /// Where one note goes inside the import: the folders it sat in, and its own
    /// name stepped aside from a name already taken.
    fn place_of(
        row: &Row,
        folders: &HashMap<i64, Folder>,
        taken: &mut HashSet<String>,
    ) -> Option<String> {
        let mut parts = Vec::new();
        let mut walked = HashSet::new();
        let mut at = Some(row.folder);

        // Up through the parents, so a folder inside a folder arrives as one. A
        // folder that is its own parent is a database nobody should trust, and
        // the walk stops rather than going round.
        while let Some(id) = at {
            if !walked.insert(id) {
                break;
            }

            let Some(one) = folders.get(&id) else { break };
            if one.kind == SMART {
                return None;
            }

            if !one.first && !one.title.is_empty() {
                parts.push(one.title.replace('/', " "));
            }

            at = one.parent;
        }

        parts.reverse();
        let name = apple_text::title(&row.body).unwrap_or_else(|| row.title.clone());
        let name = name.replace('/', " ");
        parts.push(if name.trim().is_empty() {
            "Untitled".to_string()
        } else {
            name
        });

        Some(stepped(parts.join("/"), taken))
    }

    /// A path nothing else in this read has taken, stepped the way the app's own
    /// new notes step: `Plan 2`.
    fn stepped(path: String, taken: &mut HashSet<String>) -> String {
        let mut said = path.clone();
        let mut at = 1;

        while !taken.insert(said.to_lowercase()) {
            at += 1;
            said = format!("{path} {at}");
        }

        said
    }

    /// Where each account keeps its attachments. A note's own account is on its
    /// folder's row, but the folders of an account with nothing in them are the
    /// same shape, so every account's folder is tried in turn: there are two of
    /// them on a busy Mac and one on most.
    fn roots(
        db: &Connection,
        keys: &HashMap<String, i64>,
        base: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let ent = keys.get("ICAccount").copied().unwrap_or(0);
        let mut statement = db
            .prepare("SELECT zidentifier FROM ziccloudsyncingobject WHERE z_ent = ?1")
            .map_err(|error| format!("those accounts would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| row.get::<_, Option<String>>(0))
            .map_err(|error| format!("those accounts would not be read: {error}"))?;

        let mut roots = Vec::new();
        for row in rows {
            let said = row.map_err(|error| format!("those accounts would not be read: {error}"))?;
            if let Some(uuid) = said {
                roots.push(base.join("Accounts").join(uuid));
            }
        }

        // Where an older Notes kept them, which is beside the database itself.
        roots.push(base.to_path_buf());

        Ok(roots)
    }

    /// What an attachment becomes in a note's words, and the files that go with
    /// them.
    struct Found<'a> {
        db: &'a Connection,
        roots: Vec<PathBuf>,
        /// Where each note went, by the identifier a link inside another note
        /// points at.
        notes: HashMap<String, String>,
        known: HashSet<String>,
        media: Vec<Media>,
        /// Attachments already written, so a picture in two notes is one file.
        written: HashMap<String, String>,
        taken: HashSet<String>,
        drawn: u32,
        tables: u32,
        missing: u32,
    }

    impl<'a> Found<'a> {
        fn new(
            db: &'a Connection,
            roots: Vec<PathBuf>,
            notes: HashMap<String, String>,
            known: HashSet<String>,
        ) -> Self {
            Self {
                db,
                roots,
                notes,
                known,
                media: Vec::new(),
                written: HashMap::new(),
                taken: HashSet::new(),
                drawn: 0,
                tables: 0,
                missing: 0,
            }
        }

        /// Hands what it found to the answer.
        fn report(self, read: &mut Read) {
            read.media = self.media;
            read.drawn = self.drawn;
            read.tables = self.tables;
            read.missing = self.missing;
        }

        /// One column of the row an attachment's identifier names.
        fn column(&self, id: &str, name: &str) -> Option<String> {
            if !self.known.contains(&name.to_lowercase()) {
                return None;
            }

            let query =
                format!("SELECT {name} FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1");

            self.db
                .query_row(&query, [id], |row| row.get::<_, Option<String>>(0))
                .ok()
                .flatten()
        }

        /// A tag or a mention, which Notes stores as an attachment holding the
        /// words it draws.
        fn words(&self, id: &str) -> Option<String> {
            self.column(id, "zalttext")
        }

        /// A link to another note, which becomes a link to wherever that note
        /// went. The import turns it into a wikilink afterwards, the way it does
        /// for every other export's links.
        fn link(&self, id: &str) -> Option<String> {
            let said = self.column(id, "ztokencontentidentifier")?;
            let uuid = said.rsplit('/').next().unwrap_or(said.as_str());
            let uuid = uuid.split('?').next().unwrap_or(uuid).to_uppercase();
            let path = self.notes.get(&uuid)?;
            let name = path.rsplit('/').next().unwrap_or(path.as_str()).to_string();

            Some(format!("[{name}]({path}.md)"))
        }

        /// A card Notes drew for a link somebody pasted.
        fn card(&self, id: &str) -> Option<String> {
            let url = self.column(id, "zurlstring")?;
            let title = self.column(id, "ztitle").unwrap_or_else(|| url.clone());

            Some(format!("[{title}]({url})"))
        }

        /// A real file: a picture, a recording, a paper. The row says which file
        /// it is and the bytes come off the disk beside the database.
        fn file(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let (name, at) = self.media_row(id)?;
            let Some(bytes) = self.on_disk(&[Path::new("Media").join(&at)]) else {
                self.missing += 1;
                return None;
            };

            Some(shown(&self.keep(id, &name, bytes)))
        }

        /// The bytes of the first of these files that is under one of the accounts'
        /// folders.
        fn on_disk(&self, candidates: &[PathBuf]) -> Option<Vec<u8>> {
            self.roots.iter().find_map(|root| {
                candidates
                    .iter()
                    .find_map(|one| std::fs::read(root.join(one)).ok())
            })
        }

        /// An attachment's bytes, written beside the notes once under a name nothing
        /// else took: where it went.
        fn keep(&mut self, id: &str, name: &str, bytes: Vec<u8>) -> String {
            let path = format!("assets/{}", free(name, &mut self.taken));
            self.media.push(Media {
                path: path.clone(),
                bytes: STANDARD.encode(bytes),
            });
            self.written.insert(id.to_string(), path.clone());
            path
        }

        /// The merged document an attachment's own row holds: a table's cells, or a
        /// scan's pages.
        fn merged(&self, id: &str) -> Option<Vec<u8>> {
            if !self.known.contains("zmergeabledata1") {
                return None;
            }

            self.db
                .query_row(
                    "SELECT zmergeabledata1 FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| row.get::<_, Option<Vec<u8>>>(0),
                )
                .ok()
                .flatten()
        }

        /// A table, as a markdown table of its own between the lines around it.
        fn table(&mut self, id: &str) -> Option<String> {
            let data = self.merged(id)?;
            let table = apple_text::table(&data, self)?;
            Some(format!("\n\n{table}\n\n"))
        }

        /// The picture Notes drew of a sketch: `FallbackImages/<id>/<generation>/` on a
        /// Mac from macOS 14 on, and a JPEG named after the sketch before that.
        fn drawing(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            if own.is_empty() {
                return None;
            }
            let generation = self
                .column(id, "zfallbackimagegeneration")
                .map(|one| segment(&one))
                .unwrap_or_default();

            let mut candidates = Vec::new();
            if !generation.is_empty() {
                candidates.push(
                    Path::new("FallbackImages")
                        .join(&own)
                        .join(&generation)
                        .join("FallbackImage.png"),
                );
            }
            candidates.push(Path::new("FallbackImages").join(format!("{own}.jpg")));
            candidates.push(Path::new("FallbackImages").join(format!("{own}.png")));

            let (at, bytes) = candidates
                .iter()
                .find_map(|one| Some((one, self.on_disk(std::slice::from_ref(one))?)))?;
            let extension = at.extension().and_then(|one| one.to_str()).unwrap_or("png");
            let name = format!("Drawing.{extension}");

            Some(shown(&self.keep(id, &name, bytes)))
        }

        /// A scan, a picture a page: the page as Notes cropped it where that preview is
        /// on this Mac, and the page's own photograph where it is not.
        fn scan(&mut self, id: &str) -> Option<String> {
            let pages = apple_text::gallery(&self.merged(id)?);
            let shown: Vec<String> = pages
                .iter()
                .filter_map(|page| self.scanned_page(page))
                .collect();

            if shown.is_empty() {
                return None;
            }

            Some(format!("\n\n{}\n\n", shown.join("\n\n")))
        }

        /// One page of a scan.
        fn scanned_page(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            let size = self
                .db
                .query_row(
                    "SELECT zsizewidth, zsizeheight FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
                )
                .ok();

            if let (false, Some((Some(width), Some(height)))) = (own.is_empty(), size) {
                let preview = Path::new("Previews").join(format!(
                    "{own}-1-{}x{}-0.jpeg",
                    measure(width),
                    measure(height)
                ));
                if let Some(bytes) = self.on_disk(&[preview]) {
                    return Some(shown(&self.keep(id, "Scan Page.jpg", bytes)));
                }
            }

            self.file(id)
        }

        /// A scan somebody marked up, as the PDF Notes made of it.
        fn marked_scan(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            let generation = self
                .column(id, "zfallbackpdfgeneration")
                .map(|one| segment(&one))
                .unwrap_or_default();
            if own.is_empty() {
                return None;
            }

            let mut at = Path::new("FallbackPDFs").join(&own);
            if !generation.is_empty() {
                at.push(&generation);
            }
            at.push("FallbackPDF.pdf");

            let bytes = self.on_disk(&[at])?;
            Some(shown(&self.keep(id, "Scan.pdf", bytes)))
        }

        /// The file name an attachment has, and where under `Media` it sits.
        fn media_row(&self, id: &str) -> Option<(String, PathBuf)> {
            let media = self
                .db
                .query_row(
                    "SELECT zmedia FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .ok()
                .flatten()?;

            let generation = if self.known.contains("zgeneration1") {
                "zgeneration1"
            } else {
                "''"
            };
            let query = format!(
                "SELECT zidentifier, zfilename, {generation}
                 FROM ziccloudsyncingobject WHERE z_pk = ?1"
            );

            let (folder, name, generation) = self
                .db
                .query_row(&query, [media], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                })
                .ok()?;

            // Each of the three is a name rather than a path, whatever the row
            // says; see `segment`.
            let (folder, name, generation) =
                (segment(&folder), segment(&name), segment(&generation));

            if name.is_empty() || folder.is_empty() {
                return None;
            }

            let mut at = PathBuf::from(folder);
            if !generation.is_empty() {
                at.push(generation);
            }
            at.push(&name);

            Some((name, at))
        }
    }

    impl Parts for Found<'_> {
        fn attachment(&mut self, id: &str, uti: &str) -> Option<String> {
            if uti == HASHTAG || uti == MENTION {
                return self.words(id);
            }

            if uti == INTERNAL {
                return self.link(id);
            }

            if uti == CARD {
                return self.card(id);
            }

            if uti == TABLE {
                let table = self.table(id);
                self.tables += u32::from(table.is_none());
                return table;
            }

            let drawn = if DRAWINGS.contains(&uti) {
                Some(self.drawing(id))
            } else if uti == SCAN {
                Some(self.scan(id))
            } else if uti == MARKED_SCAN {
                Some(self.marked_scan(id))
            } else {
                None
            };

            if let Some(drawn) = drawn {
                self.drawn += u32::from(drawn.is_none());
                return drawn;
            }

            self.file(id)
        }
    }

    /// How a file is written into a note: shown where it is a picture, linked
    /// where it is a paper or a recording, which is what nib writes itself.
    fn shown(path: &str) -> String {
        let name = path.rsplit('/').next().unwrap_or(path);
        let extension = name.rsplit('.').next().unwrap_or("").to_lowercase();

        if PICTURES.contains(&extension.as_str()) {
            return format!("![]({path})");
        }

        format!("[{name}]({path})")
    }

    /// A width or a height the way Notes writes one into a preview's name: a whole
    /// number of points with no fraction after it.
    fn measure(points: f64) -> String {
        if points.fract().abs() < f64::EPSILON {
            format!("{points:.0}")
        } else {
            points.to_string()
        }
    }

    /// What no file may be called on Windows, which is the strictest of the three
    /// systems and so the list a name has to pass everywhere. The same list
    /// `packages/markdown/src/paths.ts` holds a note's own name to.
    const FORBIDDEN: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

    /// One name out of the database, as the name of a file and nothing else.
    ///
    /// Every name in this module comes out of the store being read, and that store
    /// is a file somebody was handed - an export, a backup, a folder off somebody
    /// else's disk. A row of one written by hand can say its attachment is called
    /// `../../../.ssh/authorized_keys`, or that its bytes sit at `C:\Windows\win.ini`,
    /// and both ends of the read join what the row says onto a folder: the name goes
    /// under the space's `assets/`, and the folder and the name together are read
    /// from under `Media/`. `Path::join` with an absolute path throws away the root
    /// it was joined onto, so the second is how a crafted store reads any file on
    /// the machine into a note.
    ///
    /// So a name is the last segment of whatever was written, with the separators,
    /// the colon a drive letter needs and the control characters taken out, and the
    /// dots that would leave `..` trimmed off either end. Empty is a row the caller
    /// steps over.
    fn segment(name: &str) -> String {
        let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
        let said: String = last
            .chars()
            .map(|one| {
                if FORBIDDEN.contains(&one) || one.is_control() {
                    ' '
                } else {
                    one
                }
            })
            .collect();

        said.trim().trim_matches('.').trim().to_string()
    }

    /// A file name nothing else in this read has taken.
    fn free(name: &str, taken: &mut HashSet<String>) -> String {
        let (stem, extension) = match name.rsplit_once('.') {
            Some((stem, extension)) => (stem.to_string(), format!(".{extension}")),
            None => (name.to_string(), String::new()),
        };

        let mut said = name.to_string();
        let mut at = 1;

        while !taken.insert(said.to_lowercase()) {
            at += 1;
            said = format!("{stem} {at}{extension}");
        }

        said
    }

    #[cfg(test)]
    mod tests {
        use super::{read_from, segment};

        /// The store is a file somebody was handed, and every name in it is a name
        /// it chose: the one on the way out is joined onto the space's `assets/`,
        /// and the ones on the way in are joined onto `Media/`, where an absolute
        /// path would replace the folder rather than sit under it.
        #[test]
        fn a_name_in_the_store_is_a_name_and_not_a_path() {
            assert_eq!(segment("photo.png"), "photo.png");
            assert_eq!(segment("Some paper (2).pdf"), "Some paper (2).pdf");

            assert_eq!(segment("../../../.ssh/authorized_keys"), "authorized_keys");
            assert_eq!(segment(r"..\..\Windows\win.ini"), "win.ini");
            assert_eq!(segment("/etc/passwd"), "passwd");
            assert_eq!(segment(r"C:\Windows\win.ini"), "win.ini");
            assert_eq!(segment("C:/Windows/win.ini"), "win.ini");
            assert_eq!(segment("a\nb.png"), "a b.png");

            // Nothing left is a row the caller steps over.
            assert_eq!(segment(".."), "");
            assert_eq!(segment("..."), "");
            assert_eq!(segment("/"), "");
            assert_eq!(segment(""), "");
        }

        /// The database under `tests/apple-notes`, which is Notes' own schema with
        /// four notes in it. Built by `scripts/apple-notes-fixture.py`, which says
        /// what each row is for.
        fn fixture() -> std::path::PathBuf {
            crate::app_dir().join("tests/apple-notes")
        }

        #[test]
        fn every_note_arrives_under_the_folder_it_sat_in() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let paths: Vec<&str> = read.notes.iter().map(|note| note.path.as_str()).collect();

            // The first folder's notes go straight in; a named folder is a folder.
            assert!(paths.contains(&"Groceries.md"), "{paths:?}");
            assert!(paths.contains(&"Work/Ideas.md"), "{paths:?}");
            assert!(paths.contains(&"Work/Deeper/Nested.md"), "{paths:?}");
        }

        #[test]
        fn a_note_carries_its_words_its_title_and_its_day() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Groceries.md")
                .expect("the first note");

            assert_eq!(note.title, "Groceries");
            assert!(note.text.starts_with("# Groceries"), "{}", note.text);
            assert!(note.text.contains("- [x] Milk"), "{}", note.text);
            // 2026-09-04, as seconds since 1970.
            assert_eq!(note.created, 1_788_480_000);
        }

        #[test]
        fn a_locked_note_is_counted_and_the_bin_stays_the_bin() {
            let read = read_from(&fixture()).expect("the fixture reads");

            assert_eq!(read.locked, 1);
            assert_eq!(read.binned, 1);
            assert!(!read.notes.iter().any(|note| note.path.contains("Locked")));
        }

        #[test]
        fn an_attachment_arrives_beside_the_notes_and_the_note_shows_it() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Work/Ideas.md")
                .expect("the second note");

            assert!(note.text.contains("![](assets/photo.png)"), "{}", note.text);
            let photos = read
                .media
                .iter()
                .filter(|one| one.path == "assets/photo.png")
                .count();
            assert_eq!(photos, 1);
        }

        #[test]
        fn a_link_to_another_note_points_at_where_that_note_went() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Work/Ideas.md")
                .expect("the second note");

            assert!(
                note.text.contains("[Groceries](Groceries.md)"),
                "{}",
                note.text
            );
        }

        fn plans(read: &super::Read) -> &super::Note {
            read.notes
                .iter()
                .find(|note| note.path == "Work/Plans.md")
                .expect("the note with a table, sketches and scans in it")
        }

        /// A table is a document of its own on its attachment's row, and arrives as a
        /// markdown table with its columns where Notes draws them.
        #[test]
        fn a_table_arrives_as_a_markdown_table() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = plans(&read);

            assert!(
                note.text
                    .contains("Table\n\n| How much | Item |\n| --- | --- |\n| 2 litres | Milk |"),
                "{}",
                note.text
            );
            assert_eq!(read.tables, 0);
        }

        /// A sketch is the picture Notes drew of it; a scan is a picture a page, the
        /// cropped preview where Notes left one and the page's photograph where it did
        /// not; a marked-up scan is the PDF Notes made of it.
        #[test]
        fn sketches_and_scans_arrive_as_the_pictures_notes_drew() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = plans(&read);

            for shown in [
                "![](assets/Drawing.png)",
                "![](assets/Scan Page.jpg)",
                "![](assets/page-two.png)",
                "[Scan.pdf](assets/Scan.pdf)",
            ] {
                assert!(note.text.contains(shown), "{shown} in {}", note.text);
            }

            let written: Vec<&str> = read.media.iter().map(|one| one.path.as_str()).collect();
            for path in [
                "assets/Drawing.png",
                "assets/Scan Page.jpg",
                "assets/page-two.png",
                "assets/Scan.pdf",
            ] {
                assert!(written.contains(&path), "{path} in {written:?}");
            }
        }

        /// A sketch whose picture is not on this Mac is the one thing left to say.
        #[test]
        fn a_sketch_with_no_picture_on_this_mac_is_counted() {
            let read = read_from(&fixture()).expect("the fixture reads");

            assert_eq!(read.drawn, 1);
            assert!(plans(&read).text.contains("Lost"));
        }

        #[test]
        fn a_folder_with_no_database_in_it_says_so_rather_than_failing() {
            let empty = tempfile::tempdir().expect("a folder");
            assert_eq!(read_from(empty.path()).unwrap_err(), super::NO_DATABASE);
        }

        #[test]
        fn a_folder_that_is_not_there_reads_as_a_refusal() {
            let missing = fixture().join("nowhere");
            assert_eq!(read_from(&missing).unwrap_err(), super::NO_ACCESS);
        }
    }
}
