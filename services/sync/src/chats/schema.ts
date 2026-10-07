/** What one `ChatLog` keeps in its own SQLite (docs/chats.md 4.3).
 *
 *  `events` is the log and the truth: every event with the place it was given here and
 *  nowhere else, and for a post the message it makes and the message it answers, so the
 *  events about one message are an indexed read. `messages` is every message as it
 *  stands, as `apply` from `@nib/chats` makes it, kept by the same write that appends
 *  the event, so a page of current state is one indexed read; `words` is its full-text
 *  index, kept by triggers (FTS5 runs in a Durable Object's SQLite, proved under workerd
 *  before this was written). The rest is the object's bookkeeping: the chat's settings,
 *  each person's read place and the posts that call them, posts waiting for their time,
 *  hub pokes being coalesced, and the pace each person posts at.
 *
 *  Made on every wake with `if not exists`, so a fresh object and one the account
 *  emptied are the same thing. */

export const SCHEMA = `
create table if not exists events (
  seq integer primary key,
  id text not null unique,
  kind text not null,
  target text,
  message text,
  parent text,
  author text not null,
  device text,
  at integer not null,
  made_at integer,
  body text not null
);
create index if not exists events_target on events(target) where target is not null;
create index if not exists events_message on events(message) where message is not null;
create index if not exists events_parent on events(parent) where parent is not null;
create table if not exists messages (
  seq integer primary key,
  id text not null unique,
  author text not null,
  at integer not null,
  parent text,
  deleted integer not null default 0,
  replies integer not null default 0,
  body text not null,
  json text not null
);
create virtual table if not exists words using fts5(body, content='messages', content_rowid='seq');
create trigger if not exists messages_in after insert on messages begin
  insert into words(rowid, body) values (new.seq, new.body);
end;
create trigger if not exists messages_changed after update of body on messages begin
  insert into words(words, rowid, body) values ('delete', old.seq, old.body);
  insert into words(rowid, body) values (new.seq, new.body);
end;
create table if not exists meta (key text primary key, value text);
create table if not exists members (
  who text primary key,
  read_seq integer not null default 0,
  dirty integer not null default 0
);
create table if not exists mentioned (
  who text not null,
  seq integer not null,
  primary key (who, seq)
);
create table if not exists scheduled (
  id text primary key,
  message text not null,
  author text not null,
  device text,
  send_at integer not null,
  post text not null,
  refused text
);
create table if not exists pokes (
  id text primary key,
  sent_at integer not null default 0,
  seq integer,
  at integer,
  by text,
  mention integer not null default 0
);
create table if not exists paces (
  who text not null,
  kind text not null,
  since integer not null,
  count integer not null,
  primary key (who, kind)
);
`
