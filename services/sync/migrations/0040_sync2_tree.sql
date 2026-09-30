-- Sync v2's tree: folders as rows with ids, a note's place as a folder and a name, and
-- the operations that move either applied once each. See docs/sync-v2.md sections 5.9
-- and 8, and services/sync/src/sync2/.
--
-- Numbered 0040 although 0041 to 0043 landed first. `wrangler d1 migrations apply`
-- applies every file whose name is not yet in `d1_migrations`, in name order, so on a
-- database that already has those this one simply runs next; nothing in it reads or
-- writes what they made.

-- A folder, which until now was only a word in a path. `name_key` is the name as a
-- folder on Windows or a Mac compares it (NFC, without case), which is what two live
-- siblings may not share. `deleted_in` is the cursor of the delete that took it, so a
-- folder restored brings back what went with it and nothing that went before.
create table folders (
  id         text    primary key,
  space_id   text    not null references spaces(id) on delete cascade,
  parent_id  text,
  name       text    not null,
  name_key   text    not null,
  seq        integer not null,
  deleted    integer not null default 0,
  deleted_at integer,
  deleted_in integer,
  updated_at integer not null,
  updated_by text
);
create unique index folders_live_name on folders(space_id, coalesce(parent_id, ''), name_key)
  where deleted = 0;
create index folders_space_seq on folders(space_id, seq);

-- A note's place, kept beside its `path`, which publishing, the connector and
-- nib-sync.mjs go on reading and which every tree operation keeps current. `kind` is
-- what the entry is (note, canvas, pages, url, or a file whose bytes are a blob);
-- `epoch` and `epoch_base` say which document the note's room holds and which text it
-- was seeded from (0: none yet); `doc_seq` and `doc_by` are the cursor and the device
-- of its latest content change, `updated_by` of its latest change of any sort.
alter table notes add column folder_id text;
alter table notes add column name text;
alter table notes add column name_key text;
alter table notes add column kind text not null default 'note';
alter table notes add column epoch integer not null default 0;
alter table notes add column epoch_base text;
alter table notes add column doc_seq integer;
alter table notes add column doc_by text;
alter table notes add column updated_by text;
alter table notes add column deleted_in integer;
create unique index notes_live_name on notes(space_id, coalesce(folder_id, ''), name_key)
  where deleted = 0 and name_key is not null;

-- What each tree operation was answered, by its id, so one sent again is answered the
-- same way rather than applied twice. The id is the space's and the device's together
-- (`<space>/<op>`), so no device can reach another space's answers by guessing ids.
-- Swept after thirty days.
create table tree_ops (
  op_id    text    primary key,
  space_id text    not null,
  result   text    not null,
  at       integer not null
);
create index tree_ops_at on tree_ops(at);

-- Which protocol an account's devices speak: 1 until the account is moved to 2.
alter table users add column sync_version integer not null default 1;

-- When a space's tree was first kept as rows. Null until a v2 device asks for it; from
-- then on every write that places a note (a v1 one included) keeps the rows current.
alter table spaces add column prepared_at integer;

-- The maps a space keeps about its own tree, one row per entry rather than one value
-- for the lot, so two devices changing different entries both keep theirs: bookmarks,
-- folder icons and their colours, the manual order, the graph's settings and what is
-- left out of search. The whole-value columns on `spaces` stay, as what a v1 app reads;
-- they are written from these rows. `value` null is an entry taken away. See
-- src/sync2/maps.ts and docs/sync-v2.md section 5.11.
create table space_entries (
  space_id text    not null references spaces(id) on delete cascade,
  map      text    not null,
  key      text    not null,
  value    text,
  seq      integer not null,
  at       integer not null,
  by       text,
  primary key (space_id, map, key)
);
create index space_entries_seq on space_entries(space_id, seq);
