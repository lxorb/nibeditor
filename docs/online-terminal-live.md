# The online terminal: going live

What switching the online terminal on needs on Emil's Cloudflare account, read on 2026-10-05
with read-only API calls, and the steps in order. Nothing here has been done yet. It is the
checklist of `docs/online-terminal.md` 6.3, made concrete.

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

1. **Lanes on main**, gate green: `@nib/online`, `services/machine` (the image and `nibd`),
   this Worker lane, the client.
2. **The image's two requirements from this lane**: `nibd` listens on port **8080** and takes
   the link at `GET /link` with `authorization: Bearer <NIBD_SECRET>` (the secret is in the
   start environment, new every boot); and the image carries `sandbox-shim` for the home
   backups:
   `COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim`
   (the tag matches the pinned `@cloudflare/sandbox` 1.0.0).
3. **The bucket** (EU):
   `wrangler r2 bucket create nib-homes --jurisdiction eu`
4. **The migration** on the real database:
   `pnpm --filter @nib/sync migrate:remote` (applies `0045_machines.sql`; Emil's account
   `78180341-d10b-4bea-92dc-f327035ebfac` is on the allow-list and is the admin from it).
5. **Move the machines into the deployed config**: copy the `MACHINES` binding, the `v3`
   migration tag, the `containers` block, the `HOMES` bucket and `MACHINE_EGRESS` from
   `services/sync/wrangler.machines.jsonc` into `wrangler.jsonc`, and point `main` at
   `src/machines/entry.ts`. CI then builds the image with Docker (the deploy job runs on
   `ubuntu-latest`, which has it), pushes it to `registry.cloudflare.com` and makes the
   container application `nib-sync-machines`. **This is the first moment anything costs
   money.** Locally, `wrangler deploy --dry-run --containers-rollout=none --config
   wrangler.machines.jsonc` proves the bundle and the bindings without Docker.
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

## Kill switches, for reference

- the service: `online_service.online` to `off` (every machine sleeps at its next minute, every
  route answers 404);
- an account: `POST /v2/online/admin/allow {"email", "online": false}` (stops it now);
- a machine: `POST /v2/online/admin/machines/:id/stop {"flag": true}`, held until
  `/release`;
- the budget: past the ceiling no machine wakes, and an awake one gets ten minutes.
