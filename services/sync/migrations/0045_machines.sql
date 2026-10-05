-- The online terminal (docs/online-terminal.md): a Linux machine in the cloud per
-- person, run by the `Machine` Durable Object, whose terminals are files in spaces.
--
-- Nothing here runs anything. Until `online` below is switched on and the Worker is
-- deployed with services/sync/wrangler.machines.jsonc, every route answers 404 and no
-- machine can be made; see src/machines/.

-- Who may have a machine while the service is new (decision 4): an allow-list Emil
-- keeps, one flag per account. Clearing it is the account's kill switch: its machine
-- stops at its next minute and no start is let through.
alter table users add column online integer not null default 0;

-- One machine per account. `state` mirrors what the object last said, for Settings and
-- the meter; the object itself is the truth. `held` is a stop nobody but Emil lifts: a
-- flag, or his own Stop. `backup` is the latest R2 copy of the home, as the key it was
-- written under and the record the restore needs; `snapshot` the latest root filesystem
-- snapshot, with the image it is only good on and when it was made (4.3).
create table machines (
  id text primary key,
  user_id text not null unique references users(id) on delete cascade,
  state text not null default 'asleep'
    check (state in ('asleep', 'starting', 'awake', 'stopping')),
  size text not null default 'small',
  region text not null default 'eu',
  image text not null default '',
  created_at integer not null,
  woke_at integer,
  slept_at integer,
  home_bytes integer not null default 0,
  backup_at integer,
  backup_key text,
  backup text,
  snapshot text,
  snapshot_at integer,
  snapshot_image text,
  held text,
  keep_awake integer not null default 0
);

-- What each account used, per calendar month (UTC, 'YYYY-MM'): what the allowance is
-- counted against and what the budget breaker sums over the whole service (4.9).
create table machine_usage (
  user_id text not null,
  month text not null,
  awake_s integer not null default 0,
  cpu_s real not null default 0,
  mem_gib_s real not null default 0,
  disk_gb_s real not null default 0,
  egress_bytes integer not null default 0,
  primary key (user_id, month)
);
create index machine_usage_month on machine_usage (month);

-- The audit (4.8): who connected and typed when, and what the machine did - never what
-- anybody typed or saw. `detail` is a word or a number, never input. Kept 90 days.
create table machine_events (
  id integer primary key autoincrement,
  machine text not null,
  at integer not null,
  kind text not null,
  who text,
  device text,
  detail text
);
create index machine_events_machine on machine_events (machine, at);
create index machine_events_at on machine_events (at);

-- A `.term` file's session (4.5): keyed by the file's id and nothing in its text, so a
-- copy pasted elsewhere names no session. `user_id` is the machine's owner, who made
-- it; `typing` is who else may type (4.6). `ended_at` is set when its owner ends it.
create table term_sessions (
  term text primary key,
  machine text not null,
  session text not null unique,
  user_id text not null,
  typing text not null default 'owner' check (typing in ('owner', 'writers')),
  created_at integer not null,
  ended_at integer
);
create index term_sessions_machine on term_sessions (machine);
create index term_sessions_user on term_sessions (user_id);

-- The service's own switches, one row each: whether it runs at all (the service kill
-- switch; every machine stops at its next minute when it is off), the month's ceiling
-- in US dollars (the budget breaker), and the account that may use the admin routes.
create table online_service (
  key text primary key,
  value text not null
);
insert into online_service (key, value) values
  ('online', 'off'),
  ('ceiling', '30'),
  ('admin', '78180341-d10b-4bea-92dc-f327035ebfac');

-- Emil's own account, first on the allow-list.
update users set online = 1 where id = '78180341-d10b-4bea-92dc-f327035ebfac';
