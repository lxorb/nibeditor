-- The chats' store's first schema: docs/chats.md section 4.17, beside the sync store.
--
-- Frozen the day it ships, as 1.sql is: a later change is a second file.

-- The schema number.
create table meta (key text primary key, value blob);

-- Every chat this device has heard of: the log's place it holds every event up to
-- (`seq`), the reader's read place, the oldest message it holds and whether that is the
-- chat's first (`complete`), and the account's last listing row for it, as JSON.
create table chats (id text primary key, space text not null,
                    seq integer not null default 0, read_seq integer not null default 0,
                    oldest integer, complete integer not null default 0, row text);

-- Every message as it stands. `main` is whether the chat itself shows it (not a reply,
-- or a reply also sent to the chat); `has` is `hasOf` in @nib/chats, each word between
-- spaces, so a filter and a column mean one thing; `upto` is the log's place this copy
-- is current to; `json` is the message, `marks` what the in-order fold keeps beside it.
create table messages (chat text not null, id text not null, seq integer not null,
                       at integer not null, author text not null, parent text,
                       main integer not null, deleted integer not null, body text not null,
                       has text not null, upto integer not null, json text not null,
                       marks text, primary key (chat, id));
create index messages_main on messages (chat, main, seq);
create index messages_parent on messages (chat, parent, seq);
create index messages_at on messages (at);

-- The words of every message, kept by the three triggers below.
create virtual table words using fts5(body, content = 'messages', content_rowid = 'rowid',
                                      tokenize = 'unicode61 remove_diacritics 2');

create trigger messages_made after insert on messages begin
  insert into words (rowid, body) values (new.rowid, new.body);
end;
create trigger messages_gone after delete on messages begin
  insert into words (words, rowid, body) values ('delete', old.rowid, old.body);
end;
create trigger messages_reworded after update of body on messages begin
  insert into words (words, rowid, body) values ('delete', old.rowid, old.body);
  insert into words (rowid, body) values (new.rowid, new.body);
end;

-- What this device said that the account has not placed yet, oldest first, and why the
-- account would not take it, once it would not.
create table outbox (id text primary key, chat text not null, event text not null,
                     made_at integer not null, tries integer not null default 0,
                     refused text);
create index outbox_chat on outbox (chat, made_at);

-- The composer's words per chat.
create table drafts (chat text primary key, text text not null, at integer not null);
