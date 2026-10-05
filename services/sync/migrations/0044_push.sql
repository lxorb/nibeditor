-- Push to a device that has not opened nib since (docs/tasks.md 5.10 and decision 5,
-- docs/chats.md 4.11): where each device can be reached, and the reminders still to
-- ring, kept from the task lines the notes arrive with. One push module for chats and
-- reminders both; see services/sync/src/push.
--
-- A device registers a target: a Web Push subscription (its endpoint as the token, its
-- two keys beside it), an FCM token or an APNs token, with the time zone it is in, which
-- is what a task's floating time is read in. One row per token: a device registering
-- again replaces its own row.
create table push_targets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text,
  kind text not null check (kind in ('fcm', 'apns', 'webpush')),
  token text not null,
  keys text,
  zone text,
  created_at integer not null,
  failed_at integer,
  unique (user_id, token)
);
create index push_targets_user on push_targets (user_id);

-- The next reminders of every note of an account that has a target, rewritten each time
-- the note is saved: the reminder's id (the one every device makes for it, so a phone
-- that set the alarm itself stays quiet), the moment, the words to show and where the
-- task is. Sent once, at its minute, by the cron each minute, and let go a day later.
create table push_reminders (
  note_id text not null,
  id text not null,
  user_id text not null,
  space_id text not null,
  at integer not null,
  title text not null,
  body text not null,
  path text not null,
  hash text not null,
  line integer not null,
  sent_at integer,
  primary key (note_id, id)
);
create index push_reminders_due on push_reminders (at) where sent_at is null;
create index push_reminders_user on push_reminders (user_id);
