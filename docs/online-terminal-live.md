# The online terminal: going live

What switching the online terminal on needs, and the steps in order: first the move to a
Hetzner server of its own (2026-10-06, `docs/online-terminal.md` 4.15), then the Cloudflare
containers it began on, read on 2026-10-05 with read-only API calls (`docs/online-terminal.md`
6.3, made concrete).

## Going live on Hetzner (2026-10-06)

The design is `docs/online-terminal.md` 4.15. The push that brought it changed nothing that
runs: migration 0046 leaves every machine on `cloudflare`, and a Hetzner machine without its
secrets is refused as `off`. Nothing on Hetzner exists and nothing costs money until step 5.
Do the steps in order.

### 1. The Hetzner token

Hetzner Cloud Console (console.hetzner.cloud):

1. Make a project of its own, **`nib-machines`**, so the token reaches nothing else of Emil's.
2. In it, **Security > API tokens > Generate API token**, permission **Read & Write** (Hetzner's
   tokens are per project and have no narrower write scope). Description `nib-sync worker`.
3. `cd services/sync && pnpm wrangler secret put HETZNER_TOKEN`, paste it.
4. Check the project's limits (**Limits** in the project): at least 1 server, 1 firewall and 1
   primary IPv4 free. A new Hetzner account may need its limits raised before its first
   `cx43`.

### 2. The Cloudflare token the Worker makes tunnels with

dash.cloudflare.com > My Profile > **API Tokens > Create Token > Custom token**:

| | |
| --- | --- |
| name | `nib machines: tunnels and DNS` |
| permission 1 | **Account** > **Cloudflare Tunnel** > **Edit** (shown as "Cloudflare One Connector: cloudflared Write" in the newer list; either is the one) |
| permission 2 | **Zone** > **DNS** > **Edit** |
| account resources | Include > **Emil Vinu** (`b0e98c15b1f905a394ecd6a849e8e99f`) only |
| zone resources | Include > Specific zone > **nibeditor.com** only |
| client IP filtering, TTL | none (a Worker has no fixed address) |

Nothing else: no Workers, no Access, no other zone. Then
`pnpm wrangler secret put MACHINE_TUNNEL_TOKEN`. (`CF_ACCOUNT_ID` and `CF_ZONE_ID` are vars in
wrangler.jsonc already.)

### 3. Access in front of the machines' hostnames

Cloudflare Zero Trust (one.dash.cloudflare.com; the free plan is enough):

1. **Access > Service auth > Service tokens > Create service token**, name `nib-machines`,
   duration **non-expiring** (or a year, with a reminder to rotate). Copy the **Client ID** and
   **Client Secret** (shown once):
   `pnpm wrangler secret put MACHINE_ACCESS_ID` and `pnpm wrangler secret put MACHINE_ACCESS_SECRET`.
2. **Access > Applications > Add an application > Self-hosted**: name `nib machines`, domain
   subdomain `m-*`, domain `nibeditor.com` (the partial wildcard covers every machine), session
   duration any. One policy: action **Service Auth**, include **Service Token** =
   `nib-machines`. No other policy, no identity provider.
3. From the application's **Overview**, the **Application Audience (AUD) Tag**:
   `pnpm wrangler secret put MACHINE_ACCESS_AUD`; and the team name (the `<team>` of
   `<team>.cloudflareaccess.com`, Settings > Custom pages):
   `pnpm wrangler secret put MACHINE_ACCESS_TEAM`.

Steps 1 and 2 alone make it work; step 3 adds Access in front, and every start writes the
tunnel's route again, so Access can also be added later.

### 4. Check what the Worker sees

`GET https://nibeditor.com/v2/online/admin` signed in as Emil: `hetzner.missing` is `[]`.
`GET https://nibeditor.com/v2/online/machine/current` answers 64 hex characters.

### 5. Move Emil's machine (this is when it starts to cost money)

1. `POST /v2/online/admin/machines/<id>/host {"host": "hetzner"}` (the id is in the admin
   answer's `machines`). If the container is awake it is saved one last time - a snapshot,
   and the home to `nib-homes` whatever the last backup's age - and stopped. Its 17 GB home
   is in R2 under the row's `backup_key` from then on.
2. Open an online terminal (Ctrl+T, then O). The first start makes the tunnel, the hostname,
   the firewall and the server; the terminal says _Starting machine…_ for the five to ten
   minutes cloud-init takes (packages, node, cloudflared, nibd, swap), and is live after.
   Then Claude Code and Codex install in the background.
3. `select at, kind, detail from machine_events where machine = '<id>' order by at desc`:
   `wake fresh`, no `failed`. Settings > Online terminal: _CX43 · 8 vCPU · 16 GB · 160 GB ·
   €… a month_ and the disk bar.

### 6. Prove it

1. From outside: `curl -s -o /dev/null -w '%{http_code}' https://m-<id without m_>.nibeditor.com/health`
   is 302 or 403 (Access), never 200 (200 only while step 3 is not done: then `nibd`'s secret
   is the one lock). In the Hetzner console the server's firewall has no
   inbound rule.
2. In the terminal: `df -h ~` says about 150 GB; `nproc` 8; `uname -m` x86_64;
   `systemctl is-active nibd cloudflared` both active; `sudo cat /var/log/cloud-init-output.log | grep -c NIBD_SECRET` is 0.
3. Close every tab, wait an hour, open one: the same shell, `sleep 9999` still running (no
   sleep on a server).
4. `sudo systemctl kill -s KILL nibd`: within seconds `relink`; the shells end with it and the
   screens come back (systemd restarts nibd).
5. Settings > Online terminal > **Restart**: a `restart` row, the terminal back in seconds.
6. Admin Reboot, `POST /v2/online/admin/machines/<id>/reboot`: `reboot`, then `wake restart`
   a minute or two later; the files are all there.
7. Push anything: the terminal shows _Starting machine…_ for a moment and comes back with a
   `relink` row, and nothing on the server restarted.

### 7. The old home, by hand

The container's home is a `.tar.zst` in `nib-homes` (EU). To put it on the server:
`pnpm wrangler r2 object get "nib-homes/<backup_key>" --jurisdiction eu --remote --file home.tar.zst`
on this computer, then either the emergency SSH key (below) and
`scp home.tar.zst nib@<server ip>:` followed by `tar --zstd -xf home.tar.zst -C ~`, or any
file host the terminal can `curl` from.

### Switches and costs

- **Emergency SSH**: `POST /v2/online/admin/machines/<id>/ssh {"key": "ssh-ed25519 ..."}` opens
  port 22; on a server already made, also `sudo systemctl enable --now ssh` and the key into
  `~/.ssh/authorized_keys` in a terminal. `{"key": ""}` closes it again.
- **Stop paying**: `POST /v2/online/admin/machines/<id>/remove` deletes the server, its
  firewall, its tunnel and its hostname (and its disk). The next terminal makes a new one.
- **Back to Cloudflare**: `POST /v2/online/admin/machines/<id>/host {"host": "cloudflare"}`;
  the server keeps running (and costing) until it is removed.
- **The ceiling**: a server is refused (`budget`) when its price would take the month's fixed
  prices past it; at $30, one CX43 (about €14, counted as about $18) fits and a second does not.
- **Hetzner's own billing**: a server is billed by the hour up to its monthly price, from its
  making until its removal, whether anybody uses it or not.

## What the account has

| | state on 2026-10-05 |
| --- | --- |
| account | `Emil Vinu`, `b0e98c15b1f905a394ecd6a849e8e99f` |
| Workers Paid | **active** ($5 a month), which Containers needs; nothing else to buy |
| Containers | the API answers; **no application yet** |
| registry | `registry.cloudflare.com`, the account's default, already there (made 2026-08-31) |
| R2 | R2 Paid on; `nib-notes` exists; **`nib-homes` does not**, and no bucket is in the `eu` jurisdiction yet |

So no plan change is needed. Two resources are made at going live: the `nib-homes` bucket,
and the container application, which the first `wrangler deploy` of the machines config makes
(and builds and pushes the image to the registry for).

## Decisions still open

1. **Egress.** Sandbox SDK 1.0 has no host allow-list of its own: with the internet off,
   HTTP and HTTPS leave a container only through an outbound handler the Worker registers,
   and for HTTPS that handler holds the cleartext while it forwards it. That breaks 4.8's
   rule that no handler of nib's sees the AI providers' traffic. The design's answer ("never
   the other way round") is the default here: `MACHINE_EGRESS = "open"`, the internet on and
   no handler at all, so nothing of nib's sees a byte, at the price of other ports being open
   (mail, SSH, raw TCP). `"web"` is one variable away: internet off, HTTP and HTTPS through
   `Egress` (src/machines/entry.ts), which reads the hostname only and refuses private and
   metadata addresses. With the allow-list being Emil alone, `open` costs nothing in abuse;
   before anybody else is let in, Emil chooses.
2. **The ceiling**: $30 a month is the default in `online_service`; change it with the admin
   route or one SQL statement.

## Steps

1. **Lanes on main**, gate green: `@nib/online`, the machine's image and `nibd` (lane `online-nibd`),
   this Worker lane, the client.
2. **The image's two requirements from this lane**: `nibd` listens on port **7680** and takes
   the link at `GET /link` with `authorization: Bearer <NIBD_SECRET>` (the secret is in the
   start environment, new every boot); and the image carries `sandbox-shim` for the home
   backups:
   `COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim`
   (the tag matches the pinned `@cloudflare/sandbox` 1.0.0). In the Dockerfile since 2026-10-05,
   and checked by the machine workflow.
3. **The bucket** (EU):
   `wrangler r2 bucket create nib-homes --jurisdiction eu`
4. **The migration** on the real database:
   `pnpm --filter @nib/sync migrate:remote` (applies `0045_machines.sql`; Emil's account
   `78180341-d10b-4bea-92dc-f327035ebfac` is on the allow-list and is the admin from it).
5. **Move the machines into the deployed config** (done 2026-10-05): the `MACHINES`
   binding, the `v3` migration tag, the `containers` block, the `HOMES` bucket and
   `MACHINE_EGRESS` are in `wrangler.jsonc`, and `main` is `src/machines/entry.ts`; CI's
   deploy job builds nibd first. CI then builds the image with Docker (the deploy job runs on
   `ubuntu-latest`, which has it), pushes it to `registry.cloudflare.com` and makes the
   container application `nib-sync-machines`. **This is the first moment anything costs
   money.** Locally, `wrangler deploy --dry-run --containers-rollout=none` proves the bundle and the bindings without Docker.
6. **A budget alert** in the dashboard (Billing > Budget alerts) at the same $30: the second
   breaker.
7. **Switch it on**, one statement:
   `wrangler d1 execute nib --remote --command "update online_service set value = 'on' where key = 'online'"`
   or `POST /v2/online/admin/service {"online": true}` signed in as Emil.
8. **Prove on the real host** what could not be proved locally: a cold start and the link
   to `nibd` within the link's 10 seconds; a sleep writing the home to `nib-homes` and a
   snapshot; a wake restoring from the snapshot, and (with `snapshot_at` set back 31 days)
   from the backup; egress as chosen above. Then a week of Emil's own use before the
   allow-list grows.

## What the first week taught (2026-10-05 and 06, from Workers Logs)

- **Deploys cut sleeps short.** Every push to main redeploys the Worker and restarts every
  `Machine` ("Durable Object reset because its code was updated"). 18:11 on the 5th, mid-
  snapshot ("Network connection lost."); 06:51 on the 6th, a backup that had run 146 s
  ("sandbox-shim returned truncated control data"), after which the snapshot found the
  container gone ("cannot be called on a container that is not running"). So no snapshot was
  ever kept, and the home's last backup was from 18:11. A sleep now snapshots first, and a
  restarted object adopts its running instance (`docs/online-terminal.md` 4.14).
- **A backup can be slow.** The home is compressed with zstd on half a vCPU; how long a real
  home takes is the thing to measure next (below).
- To read these again: Workers Logs, filter `$workers.entrypoint = Machine`, or
  `select at, kind, detail from machine_events where machine = ? order by at desc`, whose
  `failed` rows now carry the reason.

## Checks after the health changes go live

1. Open a terminal; in `machine_events`, a `wake` and no `failed`.
2. `kill -STOP $(pgrep -f nibd.cjs)` in the machine (as root, `sudo`): within about a
   minute the terminal shows _Starting machine…_, then `relink` fails and the machine
   restarts (`failed` with `link: …`, `sleep restart`, `wake snapshot`); the screen comes back
   with the dim line from the last save. `kill -CONT` is not needed: the stop ended it.
3. `sudo pkill -KILL -f nibd.cjs`: within seconds a `relink` row, no restart, the same disk.
4. Stop the machine from Settings: `snapshot` then `backup` (or a `failed` row saying why),
   then `sleep`. Time it; the backup's time is the number for "a backup can be slow".
5. Push anything while a terminal is open: the terminal shows _Starting machine…_ for a
   moment and comes back, with a `relink` row and no `failed`.

## A drive against a local `nibd`, before any of that

No container and no Cloudflare resource: the `Machine` object drives a `nibd` already running
on this computer (`DevHost` in services/sync/src/machines/host.ts).

1. Start `nibd` with a secret, listening on `127.0.0.1:7680` (`NIBD_SECRET=dev`).
2. In services/sync, a `.dev.vars` (never committed):
   `MACHINE_DEV_NIBD="http://127.0.0.1:7680"` and `MACHINE_DEV_SECRET="dev"`. Any address
   that is not this computer's is ignored.
3. `pnpm wrangler d1 migrations apply nib --local`, then switch the service on locally:
   `pnpm wrangler d1 execute nib --local --command "update online_service set value = 'on' where key = 'online'"`
   and put the drive's account on the list:
   `... --command "update users set online = 1 where email = '<address>'"`.
4. `pnpm wrangler dev --enable-containers=false`.

Start, link, input, output, screens, sizes, Resume and the minute's sleep all run for real;
the backup and snapshot are skipped (the dev host keeps none). workerd has no jurisdictions,
so with `MACHINE_DEV_NIBD` set the `Machine` objects are asked outside the EU one (ask.ts).

`scripts/online-e2e.mjs` is all of this in one command, against a machine booted from the
image: CI's machine workflow runs it on every change to the image, nibd or the Worker's
machines (a session made as sync v1 makes one, typing, a reconnect with `since`, a late
joiner's screen).

## Kill switches, for reference

- the service: `online_service.online` to `off` (every machine sleeps at its next minute, every
  route answers 404);
- an account: `POST /v2/online/admin/allow {"email", "online": false}` (stops it now);
- a machine: `POST /v2/online/admin/machines/:id/stop {"flag": true}`, held until
  `/release`;
- the budget: past the ceiling no machine wakes, and an awake one gets ten minutes.
