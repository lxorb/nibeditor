-- Whether an account's web logins travel between its computers: sync v2's web leases,
-- section 11 of docs/sync-v2.md. Off for every account, and flipped by hand, one account
-- at a time, after the account's notes are on sync v2. The app reads it from `/v1/me` at
-- launch; with it off, a web tab behaves exactly as it did before there were leases.
alter table users add column web_sync integer not null default 0;
