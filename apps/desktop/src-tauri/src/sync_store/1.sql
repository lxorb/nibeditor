-- The sync store's first schema: docs/sync-v2.md section 9.2, table for table.
--
-- A migration is frozen the day it ships. A later change to the store is a second
-- file beside this one that alters what this one made, never an edit here: a device
-- that already ran this file will never run it again, so an edit would only reach the
-- devices that had not opened a store yet, and two devices would disagree about what
-- the same schema number means. See `MIGRATIONS` in sync_store.rs.

-- The device id, the schema number and whether the last session ended cleanly.
create table meta (key text primary key, value blob);

create table spaces (space_id text primary key, root text not null,
                     cursor integer not null default 0, role text, store text);

create table entries (id text primary key, space_id text not null, kind text not null,
                      parent text, name text not null, local_path text not null,
                      file_key text, written_hash text, mtime integer, size integer,
                      seq integer, deleted integer not null default 0);

-- What nib last wrote, compressed.
create table written (id text primary key, text blob not null);

create table docs (id text primary key, epoch integer not null, client_id integer not null,
                   confirmed blob not null, confirmed_sv blob not null,
                   pending blob, pending_at integer);

create table outbox (op_id text primary key, space_id text not null, op blob not null,
                     seen integer not null, made_at integer not null);

create table held (id text primary key, remote blob not null, remote_sv blob not null,
                   device text, at integer not null);

-- here, wanted, sending
create table files (hash text primary key, state text not null);

create table web (key text primary key, fence integer, version integer, applied integer);

create table log (at integer not null, space text, pulled integer, pushed integer,
                  failed text);

-- What a scan by space reads through, and the order it reads in: a space's entries
-- by id, its queued ops oldest first, the log as it was written.
create index entries_space on entries (space_id);
create index outbox_space on outbox (space_id, made_at);
create index log_space on log (space);
