-- Chats (docs/chats.md 4.2, 4.3): a channel people write in together, kept in a space.
--
-- What a chat holds - its log, every message, its full-text index - is its own
-- Durable Object's, `ChatLog`, named by the chat's id. These tables are what the
-- rest of the service needs without waking one: which chats there are and where,
-- each person's read place and what pings them, the files a chat's messages name,
-- and who has a chat open right now.

-- One row per chat. The id is the account's, `c_` and 32 hex digits, made when the
-- chat is, and is the chat whichever sync a device runs: a `.chat` pointer in the
-- space names it, and access is this row's space, never the pointer. `file_id` is the
-- pointer's own note row once it has arrived in the chat's space by either sync,
-- which is what an item share of a private chat is about. `last_*` and the settings
-- are the object's, written at most once a second, so the Chats panel lists every chat
-- in one query; `last_by` is who wrote last, as the chat's events name them. A chat
-- ends when its pointer or its space is purged (`ended_at`), and is erased 30 days on.
create table chats (
  id         text    primary key,
  space_id   text    not null references spaces(id) on delete cascade,
  file_id    text,
  created_at integer not null,
  last_seq   integer not null default 0,
  last_at    integer,
  last_by    text,
  topic      text    not null default '',
  posting    text    not null default 'writers' check (posting in ('writers', 'owner')),
  slowmode   integer not null default 0,
  ended_at   integer
);

create index chats_space on chats(space_id);
create unique index chats_file on chats(file_id) where file_id is not null;
create index chats_ended on chats(ended_at) where ended_at is not null;

-- Per person per chat: where they have read to and how many unread messages call
-- them, written by the object; what pings them, written by the person (`notify` all,
-- mentions or nothing, null for the chat's default; `muted_until`). `who` is the
-- account or the guest, as `room_sockets` names them.
create table chat_reads (
  chat_id     text    not null,
  who         text    not null,
  read_seq    integer not null default 0,
  mentions    integer not null default 0,
  notify      text    check (notify in ('all', 'mentions', 'nothing')),
  muted_until integer,
  primary key (chat_id, who)
);

create index chat_reads_who on chat_reads(who);

-- The blobs a chat's messages name, which is what lets the chat's members fetch them
-- through the chat. A row goes when no message names its hash any more; the bytes are
-- the uploader's blob, kept and let go of as every blob is.
create table chat_files (
  chat_id text    not null,
  hash    text    not null,
  size    integer not null,
  type    text    not null,
  name    text    not null,
  at      integer not null,
  primary key (chat_id, hash)
);

create index chat_files_hash on chat_files(hash);

-- Who has a chat open, so a revocation reaches their socket in the same request; the
-- same idea, and the same reasons, as `room_sockets` (0020).
create table chat_sockets (
  chat_id   text    not null,
  space_id  text    not null,
  who       text    not null,
  opened_at integer not null,
  primary key (chat_id, who)
);

create index chat_sockets_space on chat_sockets(space_id, who);
create index chat_sockets_opened on chat_sockets(opened_at);
