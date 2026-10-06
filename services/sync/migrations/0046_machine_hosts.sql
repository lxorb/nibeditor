-- Where a machine runs (docs/online-terminal.md 4.15): a Cloudflare container that sleeps,
-- or a Hetzner server of its own that is always on. Machines made from now on are
-- Hetzner's (routes.ts); the ones there already stay where they are until the admin
-- switches them (`POST /v2/online/admin/machines/:id/host`), which saves the container's
-- home to R2 one last time first. So deploying this strands nobody before the Hetzner
-- secrets are set.
alter table machines add column host text not null default 'cloudflare'
  check (host in ('cloudflare', 'hetzner'));

-- The server, as the Hetzner API last said it: its id and status; `region` and `size`
-- (the table's own columns) are its location and type. `spec` is the type's cores,
-- memory and disk, as JSON; `price_month` what it costs a month with VAT, in
-- `price_currency`, read from Hetzner's prices as it was made and summed by the budget
-- breaker (budget.ts).
alter table machines add column server_id integer;
alter table machines add column server_status text;
alter table machines add column spec text;
alter table machines add column price_month real;
alter table machines add column price_currency text;

-- The owner's SSH public key for an emergency, or null (the default): while it is set,
-- the server's firewall lets port 22 in and the key may log in as the machine's user.
alter table machines add column ssh_key text;

-- The disk the home is on, as `nibd` last said it: what Settings shows and warns about,
-- since a full one is what froze a machine on 2026-10-06.
alter table machines add column disk_used integer not null default 0;
alter table machines add column disk_total integer not null default 0;
