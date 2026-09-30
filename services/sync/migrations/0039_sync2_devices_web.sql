-- The account's computers, and the web logins that travel between them.
--
-- A device is what keeps one socket to the account's hub: a desktop, a phone, a
-- browser. Its id is made by the device and kept in its own sync store, one per
-- account; the session it signed in with is written beside it so that ending the
-- one ends the other. `public_key` is its X25519 key, which is what the web key is
-- wrapped to; `app` is the version it runs, which is what says when an account's
-- devices can all speak sync v2. See src/hub/devices.ts and docs/sync-v2.md 6.6.
create table devices (
  id           text    primary key,
  user_id      text    not null references users(id) on delete cascade,
  session_id   text,
  name         text    not null,
  platform     text    not null,
  public_key   text,
  app          text,
  created_at   integer not null,
  last_seen_at integer,
  revoked_at   integer
);
create index devices_user on devices(user_id);
create index devices_session on devices(session_id);

-- The newest state of one site's login, one row per lease key. The bytes are in R2
-- at `web/<user>/<key>`, encrypted on a device; the key is an HMAC nobody but the
-- account's computers can read. Written only by the hub, after it has checked the
-- fence, so that a download never has to wake it. See src/hub/upload.ts.
create table web_states (
  user_id    text    not null references users(id) on delete cascade,
  key        text    not null,
  fence      integer not null,
  version    integer not null,
  generation integer not null,
  size       integer not null,
  device_id  text    not null,
  at         integer not null,
  primary key (user_id, key)
);

-- The parts of those states that are big and change rarely (one per IndexedDB
-- database), named by their contents so one that did not change is never sent
-- twice. At `web/<user>/chunks/<name>` in R2.
create table web_chunks (
  user_id text    not null references users(id) on delete cascade,
  name    text    not null,
  size    integer not null,
  at      integer not null,
  primary key (user_id, name)
);

-- The web key, wrapped to each approved device's public key: the only form the
-- account ever holds it in.
create table web_keys (
  user_id    text    not null references users(id) on delete cascade,
  device_id  text    not null references devices(id) on delete cascade,
  wrapped    text    not null,
  generation integer not null,
  primary key (user_id, device_id)
);

-- Which store a space's web pages live in on every computer, chosen by its owner:
-- the account's one shared store, one per space, or one per site. On the account
-- rather than on each device so the same logins follow the space.
alter table spaces add column web_store text not null default 'global'
  check (web_store in ('global', 'space', 'site'));
