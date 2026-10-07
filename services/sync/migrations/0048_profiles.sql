-- A person, as the others see them (docs/chats.md 4.9 and 4.10): a picture, a few words
-- about themselves, a status that clears itself, the accent their initial is drawn on,
-- and the time zone their card tells the time in. Every column is null until it is set,
-- which is what an account made before this one has.
--
-- `avatar` is two blobs the device made, as JSON: `{"s": hash of 96 px, "l": hash of
-- 512 px}`, both WebP and both rows of `blobs` the account holds, served by `/i/:hash`.
-- `status` is `{"emoji", "text", "until", "quiet"}`, read as nothing once `until` has
-- passed. `hidden` is Appear offline: whatever the devices say, the others read offline.
alter table users add column avatar text;
alter table users add column pronouns text;
alter table users add column bio text;
alter table users add column status text;
alter table users add column accent text;
alter table users add column zone text;
alter table users add column hidden integer not null default 0;

-- Whether a person is at a device: active while any of their devices is in use, away
-- while one is connected and none is, offline with none. Written by the account's hub
-- when the answer changes and only then, so reading it is one query.
create table presence (
  user_id text primary key references users(id) on delete cascade,
  state text not null check (state in ('active', 'away', 'offline')),
  at integer not null
);

-- What somebody is called in one space, chosen by them; the account's name everywhere
-- else.
create table space_nicks (
  space_id text not null references spaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  nick text not null,
  primary key (space_id, user_id)
);
create index space_nicks_user on space_nicks (user_id);
