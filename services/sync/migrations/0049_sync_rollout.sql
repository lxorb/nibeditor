-- Sync v2 for everybody (docs/sync-v2.md section 11): one switch for the whole service,
-- and a record of every account that moved.
--
-- `sync_rollout` is the switch, a row per key like `online_service`. `mode` is `off`
-- (only the admin's route moves an account), `new` (an account made from now on starts
-- on v2) or `all` (that, and an account on v1 moves by itself the moment every live
-- device of it runs an app no older than `min`). `since` is when `mode` was last set, so
-- an account a person moved back after it stays back until somebody sets the mode again.
create table sync_rollout (
  key   text primary key,
  value text not null
);

insert into sync_rollout (key, value) values ('mode', 'off');

-- Every move of an account between v1 and v2, by whom: `admin` for the route, `hello`
-- for the automatic move a device's hello set off, `everyone` for the way back for all.
-- `min` is the oldest app the move allowed, null on the way back.
create table sync_flips (
  user_id      text    not null references users(id) on delete cascade,
  at           integer not null,
  from_version integer not null,
  to_version   integer not null,
  why          text    not null,
  min          text
);
create index sync_flips_user on sync_flips (user_id, at);
create index sync_flips_at on sync_flips (at);
