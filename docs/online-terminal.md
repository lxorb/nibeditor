# The online terminal

A design and a plan. It decides how nib gets a terminal whose shell runs on a Linux machine in
the cloud rather than on the reader's computer: the same terminal on every nib that opens it,
watched and typed in by the people of a space, and still running - an agent included - when
every window is closed. Section 6 is the plan the lanes build from.

Emil, 2026-10-03:

> I want to call it "online terminal". It's like a normal terminal, but connected remotely to
> some Linux machine (possibly virtualized, and we have to make sure sandboxing works so you
> can't break out of it). That means you can leave your agent running unattended, and it still
> has access to its whole own machine. And there should be a single terminal for that which is
> synced across all nib instances accessing it: a terminal allowing remote collaboration.

And then: "the shared terminal should run in the CLOUD, not on the user's own machine."

Read with `docs/terminal.md` (the local terminal and Remote, whose surface, names, marks and
keys this reuses), `docs/sync-v2.md` (the hub, rooms, devices and the Durable Objects this
builds on), `docs/chats.md` (the other new document kind that lives in a space and is shared
through its roles), `docs/sharing.md` and `docs/collaboration.md` (the roles), `docs/ai.md`
(what nib may and may not do with somebody's Claude or ChatGPT login) and
`docs/agent-native.md` (the agent's verbs). Nothing here loosens any of them. Prices and limits
were read from each provider's own pages on 2026-10-04 (Sources).

## Decisions for Emil

Each has a recommendation, and the design below assumes it.

1. **Provider: Cloudflare Containers**, through Cloudflare's Sandbox SDK, on the account nib
   already runs on. Fly.io Machines stays the fallback behind the same interface (6.1).
2. **One machine per person, not per space.** Its terminals are documents put in any space;
   the space's roles decide who watches and who types.
3. **Who pays: Emil, for a small free allowance**: 20 awake hours a month on a small machine
   (½ vCPU, 2 GiB, 5 GB home), asleep after 15 idle minutes. That is at most about **$0.80 per
   person a month**, under a **hard ceiling of $30 a month for the whole service**, past which
   no machine wakes. No paid tier yet; one comes with Stripe later (4.9).
4. **Who gets one: an allow-list Emil keeps** while it is new. Later, any account with a second
   factor on and at least seven days old.
5. **The web only, out of a machine**: HTTP and HTTPS to anywhere; no SSH, mail, raw TCP or UDP
   out (git over HTTPS works; git over SSH does not).
6. **In the EU only**: Cloudflare's `eu` jurisdiction for the machines and their objects.
7. **Watching, not typing, by default.** Others in a shared space watch; the machine's owner
   switches typing on per terminal. Link guests only ever watch.
8. **Claude Code and Codex preinstalled, unmodified**; each person signs in with their own
   login inside their machine, and nib never reads it.
9. **A home is kept 90 days after its machine was last awake**, with a mail at 60, then deleted.

## The short version

1. **A machine per person.** The first Online terminal makes the account its machine: a
   Firecracker microVM on Cloudflare (its own kernel, nobody else's processes), Ubuntu 24.04
   with node, python, git and both coding agents, run by a Durable Object, `Machine`, one per
   account, in the EU.
2. **An online terminal is a document in a space**, `Build.term`, made from Ctrl+T's new card
   (**O**), renamed, moved, bookmarked and trashed like a note. It names one shell session on
   its owner's machine. Every nib that opens it - another computer of the same person, a phone,
   the browser at nibeditor.com, a colleague in the space - shows the same session.
3. **One shell, many screens.** In the machine, a small daemon, `nibd`, owns every session's
   pty and keeps its screen in a headless xterm.js, so a late joiner is sent the screen as it
   is (colours, modes, the program on the second screen) and then the stream; a reconnect is
   sent only what it missed. The `Machine` object is the one door: it checks the space's role
   for every socket and fans the output out to them.
4. **The size follows whoever typed last** (tmux's `latest`), so a phone that only watches
   never narrows the desktop's terminal; a screen smaller than the session scales it down.
5. **Who is here and who is typing**: the people watching are faces on the tab; the cursor
   wears the colour of the last person who typed, with their name beside it for a moment.
6. **Agents keep running.** A process in a session outlives every window. The machine stays
   awake while anybody is using a terminal or anything in it is working (output, CPU or
   network in the last 15 minutes), and sleeps 15 minutes after neither. An agent waiting on a
   question sleeps with the machine; its tab offers **Resume** (`claude --continue`) when the
   machine wakes.
7. **Sleep keeps the files, not the processes.** Cloudflare keeps no memory across a sleep, so
   the disk is snapshotted as the machine sleeps and the home is also backed up to R2 nightly;
   the screens are saved and come back above a fresh prompt, as a local terminal's do after a
   restart.
8. **Fenced in.** A microVM per machine, no privileged anything outside it, CPU, memory, disk
   and process ceilings by the instance type, web-only egress enforced on the host, metered
   hours with hard caps, a global budget breaker, kill switches per machine, per account and
   for the whole service, and an audit of who connected and typed when - never what.

## 1. What it is for

Three things a local terminal cannot do:

- **Keep working when nib is closed.** An agent given a task at night is still running in the
  morning, on a machine that is its own, with no laptop left open.
- **Be the same terminal everywhere.** The session started on the desktop is the one on the
  phone on the train and in the browser on somebody else's computer, mid-command, with its
  history.
- **Be shared.** Two people look at, and when the owner lets them, type into one shell: pair
  debugging, watching an agent work, showing a teammate a failure.

And one it does that nib did not: **a terminal on a phone and in the browser build**, which have
no shell of their own to give (`docs/terminal.md`).

What matters to a person using it, in order: it is there at once and looks like the terminal
they know; nothing they did is lost (files, the screen, the agent's conversation); nobody can
reach their machine who was not given it; it costs them nothing surprising; and a stranger's
machine can never reach theirs.

## 2. What others do

### 2.1 By product

| product | what it is | does well | people complain about |
| --- | --- | --- | --- |
| **GitHub Codespaces** ([lifecycle][cs-life], [security][cs-sec], [timeout][cs-timeout]) | a container in a VM of its own per codespace, opened from the browser or VS Code | "Two codespaces are never co-located on the same VM"; a new VM on every restart; idle stop after 30 minutes where "terminal activity, either input or output" counts; stopped codespaces kept 30 days | "the visible contents of the terminal window are not preserved"; everything outside `/workspaces` is cleared on a rebuild; a hard 12-hour lifetime; a long job with no output is stopped |
| **VS Code Live Share** ([shared terminal][ls-term]) | the host's own terminal shared to guests | terminals are not shared by default; only the host starts one; read-only or read/write chosen per terminal; read/write "gives guests the same access to your terminal that you have" | the host's machine must stay on; no persistence |
| **tmate** ([tmate][tmate]) | a tmux fork that relays a session over SSH | instant; a read-only id beside the read/write one | read/write by default, so the link that leaks is the one that types |
| **sshx** ([sshx][sshx]) | many terminals on a shared canvas in the browser | live cursors of everybody, read-only links, reconnection, latency estimates, "predictive echo" as mosh does | no persistence; runs where the sharer runs it |
| **Replit Shell** ([Shell2][replit-shell]) | persisted, multiplayer shells in a cloud workspace | the screen is kept in **xterm-headless on the server**, because "naively preserving a circular buffer of PTY output is not enough" (escape sequences are stateful); raw bytes copied, never parsed | the size is "the minimum number of columns and rows" of every open pane, so one small pane narrows everyone's |
| **Warp** ([session sharing][warp-share]) | a terminal session shared by link | view and edit permissions | sharing moved behind its own cloud and account |
| **E2B, Daytona, Modal** (section 3) | sandboxes for agents, by API | pause and resume with memory (E2B, Daytona's VMs, Modal's experimental snapshots) | session caps of 1 to 24 hours; priced for short runs |
| **tmux** | sessions that outlive their client | `window-size latest`: the size of the client used last | needs a machine of your own |

### 2.2 What nib takes, and what it leaves

- **Takes** Codespaces' idle stop with output counting as activity, and its kept disk; Replit's
  server-side screen; Live Share's read-only default and "only the owner starts one";
  tmux's `latest` size; sshx's presence; Codespaces' VM per person.
- **Leaves** Codespaces' lost screen (nib's terminals already keep theirs, `docs/terminal.md`);
  tmate's typing-by-default link; Replit's smallest-pane size; any lifetime cap on a machine
  that is working; any idle rule that only counts keystrokes, which would stop an agent.

## 3. Where it runs

### 3.1 The hosts, compared

Prices in US dollars unless marked. "Small" below is ½ to 1 vCPU and 2 GiB, the smallest that
runs Claude Code and a node build comfortably.

| | **Cloudflare Containers / Sandbox SDK** | **Fly.io Machines** | **E2B** | **Daytona** | **Modal Sandboxes** | **Codespaces** (model only) | **Hetzner, self-hosted** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| isolation | Firecracker microVM per instance, "its own kernel and network. No other workload ... shares that kernel" ([architecture][cf-arch]) | Firecracker microVM | Firecracker microVM | container ("dedicated namespaces") by default; a VM class with its own kernel ([isolation][dt-iso]) | gVisor by default; VMs on request ([sandboxes][modal-sb]) | a VM per codespace | what you build: gVisor on a cloud server, or Firecracker on a dedicated one |
| cold start | "often in the 1-3 second range", by image size | ~2 s+; resume from suspend "a few hundred ms" ([suspend][fly-suspend]) | resume ~1 s ([persistence][e2b-persist]) | - | - | - | yours |
| disk that stays | ephemeral; snapshots of the root filesystem (30 days, refreshed on restore, tied to the image) and R2 backups of a directory ([lifetime][cf-sb-life], [files][cf-sb-files], [snapshots][cf-snap]) | volumes, "tied to that hardware", daily snapshots kept 5 days ([volumes][fly-vol]) | kept with the paused sandbox, indefinitely | kept while stopped; archived after 7 days stopped | filesystem snapshots, 30 days ([snapshots][modal-snap]) | `/workspaces` kept; the rest cleared on rebuild | yours |
| sleep with processes kept | **no**: memory and processes end; files only | **yes**, suspend up to 2 GB memory | **yes**, pause (~4 s per GiB) | VM class only | memory snapshots, experimental, 7 days | no | with Firecracker snapshots, yours to build |
| longest run | none fixed, but "does not guarantee that any container instance will run for a set period"; SIGTERM, then up to 15 minutes ([FAQ][cf-faq]) | none | 1 h (Hobby) or 24 h (Pro), reset by a pause | none (auto-stop configurable) | 24 h | 12 h | none |
| egress control | **on the host**: `enableInternet`, `allowedHosts`, `deniedHosts`, outbound handlers in the Worker; other ports only while internet is on ([outbound][cf-out]) | none of its own documented | allow and deny lists by IP, CIDR and domain; a SOCKS5 proxy ([internet][e2b-net]) | block all, IP or domain allow lists | `block_network`, CIDR allow lists | outbound open | yours (nftables) |
| vCPU-hour | $0.072, **active CPU only** since 2025-11-21 ([pricing][cf-price], [change][cf-cpu]) | shared-cpu-1x 2 GB $13.39 a month ([pricing][fly-price]) | $0.0504 | $0.0504 | $0.142 per core (2 vCPU) ([pricing][modal-price]) | $0.18 per 2-core hour ([pricing][cs-price]) | fixed |
| GiB-hour | $0.009 (provisioned) | in the above | $0.0162 | $0.0162 | $0.024 | in the above | fixed |
| GB-month on disk | $0.18 while awake; snapshots unpriced, R2 $0.015 ([R2][r2-price]) | $0.15 (volume or stopped rootfs) | included (10 or 20 GiB) | $0.079 after 5 GiB free ([pricing][dt-price]) | - | $0.07 | in the server |
| egress | 1 TB a month included, then $0.025/GB (Europe) | $0.02/GB (Europe) | - | - | - | - | 20 TB included |
| free | 25 GiB-h, 375 vCPU-min, 200 GB-h a month per account on Workers Paid (already paid) | a 2-hour or 7-day trial, then none | $100 once ([pricing][e2b-price]) | $200 once | $30 a month | 120 core-hours (GitHub Free) | none |
| limits | instance types to 4 vCPU, 12 GiB, 20 GB disk; at least 3 GiB per vCPU; 1,500 vCPU and 6 TiB per account ([limits][cf-limits]) | suspend needs ≤ 2 GB, no swap | 20 (Hobby) or 100 (Pro, $150/month) at once | org quotas | - | - | the box |
| regions near Zurich | `eu` jurisdiction (WEUR, EEUR) ([placement][cf-place]); a container may start away from its object | fra, ams, cdg; no Swiss region ([regions][fly-regions]) | EU on Pro, by support | `eu` | multiplier 1.15-1.75× when pinned | - | Falkenstein, Nuremberg, Helsinki |
| another vendor for nib | no: same account, same Worker, D1, R2 and Durable Objects | yes | yes | yes | yes | not offerable to others | yes, and the ops |

### 3.2 Isolation, and how often it broke

- **Firecracker** (Cloudflare, Fly, E2B): a heap overflow in its vsock device in 2019
  (CVE-2019-18960, [oss-security][fc-2019]), then nothing until two advisories in 2026 - a
  symlink in the jailer that could overwrite a host file (GHSA-36j2-f825-qvgc, January) and an
  out-of-bounds write in the virtio-pci transport (CVE-2026-5747, April), which needs the
  opt-in `--enable-pci`; "the legacy MMIO transport is the default and is not affected"
  ([AWS bulletin][fc-bulletin], [advisories][fc-adv]). Both fixed by the operators, not by nib.
- **gVisor** (Modal; self-hosted on a VPS): one escape, CVE-2018-16359; the recent ones
  (CVE-2024-10026, CVE-2024-10603, CVE-2025-2713) are leaks, not escapes ([gVisor][gvisor-sec]).
  A kernel written again in Go, so a kernel bug in Linux is not an escape.
- **Plain containers** (runc; Daytona's default class, Docker on a VPS): a shared kernel, and an
  escape a year - CVE-2019-5736, CVE-2024-21626 ("Leaky Vessels"), and in November 2025
  CVE-2025-31133, -52565 and -52881 ([Sysdig][runc-2025]). Not enough for strangers' code.

Emil asked that you "can't break out of it". A VM per person, run by a company that patches
it, is the strongest of these that nib can afford; a container of nib's own on a VPS is the
weakest, and makes Emil the one who patches it at night.

### 3.3 What one machine costs

Awake rates, from 3.1. Cloudflare's small is a custom type of ½ vCPU, 2 GiB and an 8 GB disk
(≥ 3 GiB per vCPU allows it), its CPU assumed busy 10% of the time always-on and 25% while in
use; the `Machine` object is billed only while a socket is open (about 60 hours a month), and
falls inside the account's 400,000 GB-s ([Durable Objects][do-price]). "Typical" is 120 awake
hours a month: two hours a day at the keyboard and two of an agent working alone.

| | always on, a month | asleep when idle, typical month | an awake hour |
| --- | --- | --- | --- |
| **Cloudflare** small | memory $13.14 + disk $1.47 + CPU $2.63 + object $0.34 + R2 $0.08 = **≈ $17.70** | memory $2.16 + disk $0.24 + CPU $1.08 + object $0.34 + R2 $0.08 = **≈ $3.90** | ≈ $0.035 |
| Fly shared-cpu-1x 2 GB | $13.39 + 8 GB volume $1.20 = **≈ $14.60** | $2.20 + volume $1.20 + stopped rootfs $0.30 = **≈ $3.70**, plus a relay on Cloudflare | ≈ $0.018 |
| E2B or Daytona, 1 vCPU 2 GiB | **≈ $60.40** (and E2B's Pro, $150, for runs past an hour) | **≈ $9.90** | $0.083 |
| Modal, 1 vCPU 2 GiB | not possible past 24 h; ≈ $87 if it were | **≈ $14.30** (× 1.15-1.75 in the EU) | $0.119 |
| Codespaces, 2-core | not possible past 12 h | ≈ $21.60 | $0.18 |
| Hetzner CX33 (4 shared vCPU, 8 GB, 80 GB, €8.49) with gVisor | €8.49 for perhaps ten small idle people, ≈ €0.85 each - and the ops | the same, fixed | - |
| Hetzner AX42 (8 cores, 64 GB, €97.30 + €49 setup, [June 2026 prices][hz-price]) with Firecracker | ≈ €3.90 each for 25 always-on | the same, fixed | - |

### 3.4 The recommendation: Cloudflare

**Cloudflare Containers through the Sandbox SDK**, because:

- **It is where nib already is.** The `Machine` is a Durable Object beside `NoteRoom` and
  `AccountHub`, in the same Worker; the door asks the same D1 for the same roles; the home's
  backups go to the same R2; the account is already on Workers Paid; and the bill is one bill.
  Every other host is a second vendor, account, card, abuse inbox and deploy.
- **The strongest isolation that is somebody else's job**: a Firecracker microVM per machine.
- **Egress is enforced outside the VM**, by the host, where a root user inside cannot undo it -
  the one thing Fly does not offer, and the thing that keeps a free machine from sending mail
  or scanning ports.
- **Pay for CPU used**, not CPU reserved: an agent waiting on the model costs memory, not CPU.
- **In the EU** by configuration, near Zurich.
- **The SDK already has** a WebSocket PTY behind the object, snapshots, R2 directory backups and
  an outbound policy, so nib writes the product, not the platform.

What it costs nib in design, and how each is met:

- **No memory across a sleep.** Processes end; files are kept by snapshot and backup (4.3),
  screens by `nibd` (4.6), and an agent's conversation by the agent itself (`claude --continue`,
  4.7). Fly would keep the processes; it is the fallback behind the same interface if this
  proves to matter more than egress control.
- **Restarts nobody asked for** ("host server restarts occur irregularly"). `nibd` saves on
  SIGTERM, which waits up to 15 minutes; the tab offers Resume.
- **Snapshots are per image and expire in 30 days**, so the home is also backed up to R2,
  which outlives both (4.3).
- **A young SDK.** Pinned to one version; the lanes code against `MachineHost` (6.1), not the
  SDK, so the SDK can change under one file.

## 4. The design

### 4.1 One machine per person

A machine belongs to one account and is paid from that account's allowance. Not one per space:

- **A login is a person's.** An agent signs in with its owner's Claude or ChatGPT plan
  (`docs/ai.md`); a machine shared by a space would be one person's plan used by many, which
  neither maker allows, or nobody's.
- **Cost has an owner.** Hours, disk and the ceiling are counted against somebody who can be
  told and can stop it.
- **"Its whole own machine"** for the agent is a machine nobody else installs into.

Sharing happens one level up: **a terminal on that machine is a document in a space**, and the
space's people reach that session and nothing else of the machine (4.5, 4.6). A team that wants
a common box puts the owner's terminals in the team's space.

The account record is a row in D1, `machines (id, user, state, size, region, created_at,
woke_at, slept_at, home_bytes, backup_at, image)`; the machine itself is the `Machine` object
named by that id, created in the `eu` jurisdiction.

### 4.2 The image

**Ubuntu 24.04 LTS** (`ubuntu:24.04`), because it is what Claude Code's, Codex's and most
tutorials' instructions are written for, and Codespaces' images are built on it; Debian 13 would
be smaller by little and different from what people paste. One image, built in CI from
services/machine/Dockerfile, around 1.5 GB, so a cold start stays in Cloudflare's 1-3 s:

- `bash` (the default; `zsh` and `fish` installed, chosen by `chsh` as anywhere), `sudo`
  without a password for the one user, `nib` (uid 1000), `git`, `gh`, `curl`, `wget`,
  `ca-certificates`, `build-essential`, `python3` with `pip` and `venv`, `uv`, **node 22 LTS**
  with `npm` and `corepack`, `ripgrep`, `fd-find`, `jq`, `tmux`, `vim`, `nano`, `less`,
  `unzip`, `zip`, `openssh-client` (for `ssh-keygen`; outbound SSH is closed, decision 5),
  `locales` with `C.UTF-8`, and `tzdata` set from the account's time zone.
- **Claude Code** by Anthropic's own installer and **Codex** by npm, both **into the home on
  first boot** (`~/.local/bin`), from where their own updaters keep them current. Unmodified,
  every sign-in method left in, as Anthropic's terms for "preinstalling or running Claude Code
  in your products or services (e.g. in hosted sandboxes ...)" require - terms Emil accepted
  for nibeditor on 2026-10-01 ([Anthropic][cc-legal]).
- **`nibd`** (4.6), the one program of nib's in the machine, as root, started by the image's
  entrypoint, which also puts Cloudflare's per-instance CA into the trust store (4.8) and sets
  `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` for everything after it.

The user is root in their VM through `sudo` - `apt install` is the point of having a machine.
Root inside is not the boundary; the VM is (4.8).

### 4.3 The home, snapshots and backups

Three layers, each for what the one under it cannot do:

| layer | what | when | kept | restores |
| --- | --- | --- | --- | --- |
| **the disk** | the whole root filesystem: the home, what `apt` installed, `nibd`'s saved screens | while awake | until the machine sleeps | - |
| **a snapshot** (`snapshotContainer`) | the writable root filesystem, without memory or processes | as the machine sleeps, on SIGTERM, and every 6 awake hours | 30 days from its making or last restore; only on the same image | every wake, in one step |
| **a backup** (R2 directory backup) | `/home/nib`, compressed | nightly while the machine was awake that day, and before an image change | until the home is deleted (decision 9) | when there is no usable snapshot: after 30 asleep days, after an image upgrade, after a lost snapshot |

So a wake within 30 days on the same image finds the machine exactly as it went to sleep,
`apt` installs included; anything later finds its **home** as it was and a fresh system around
it - Codespaces' `/workspaces` rule, but for the whole home, and said once on the screen
("Restored from 2 Oct; packages reinstall"). `~/.nib/packages` (a plain list, kept by `nibd`
from `apt` history) is offered to put them back with one command.

The **home quota** is 5 GB on the free allowance (an 8 GB disk less the image), measured by
`nibd` and enforced by the disk itself: past 90% the terminal's tab mark says so, at 100% writes
fail as they would on a full disk. **Download home** in Settings is the latest backup as one
`.tar.zst`, by a signed R2 address, so leaving is always possible. **Reset machine** is a fresh
system from the image with the home put back; **Delete machine** is everything, asked first.

### 4.4 Awake and asleep

A machine is **asleep** (nothing billed but storage), **starting**, **awake**, or **stopping**.
Cloudflare stops an instance "shortly after the Durable Object becomes inactive" unless told to
wait, up to 6 hours (`setInactivityTimeout`, [lifetime][cf-sb-life]); `Machine` keeps that wait
at 20 minutes and decides itself, on an alarm every minute while awake, with one pure function
(`awake` in `@nib/online`, 6.1). The machine stays awake while **any** of:

- **somebody is using one of its terminals**: a socket is open from a device whose person is
  **active** by the hub's own rule - a key or the pointer in nib in the last 5 minutes
  (`docs/sync-v2.md`, 6.2) - and that terminal is on their screen. A tab left open on a second
  monitor overnight does not keep a machine awake;
- **something in it is working**: in the last 15 minutes a session printed anything, or the
  machine used more than 5% of its CPU, or moved more than 50 KB a minute over the network
  (`nibd`'s `activity`, every 30 seconds). This is what an agent looks like while it works:
  it prints, it thinks on the network, it runs builds. A long build that prints nothing still
  uses the CPU, which Codespaces does not count;
- **Keep awake** is on (not on the free allowance; 4.9).

Otherwise, 15 minutes after the last of them, it sleeps: `nibd` saves every session's screen
and which program was in front, the snapshot is taken, the instance stops. An agent at its own
prompt waiting for an answer is not working, so it sleeps with the machine; that is the price
of a machine that costs nothing asleep, and Resume (4.7) is what makes it cheap to pay.

It **wakes** when a terminal of it is put on screen (never when a restored tab merely exists,
as a Remote tab does not knock on its host at launch, `docs/terminal.md`), from Settings, or
from the palette's **Start online machine**. Waking a machine that has used its hours is
refused with the month's reset date (4.9).

### 4.5 A session is a document

An online terminal is a file, `Build.term`, in a space, of a new tree kind `term`. Its text is
three fields and is never edited by hand:

```json
{ "v": 1, "machine": "m_7J2...", "session": "s_01J..." }
```

It is what makes everything else about the terminal free, as a chat's file does for chats:
**the space decides who reaches it** (the server keys access by the file's id and its space,
never by the JSON - a copy pasted into another space reaches nothing); **renaming** it is
renaming the tab; **Move to space** moves the audience; **bookmarks, search by name,
the file list and the session restore** carry it; **Reopen closed tab** reopens it; and
another device of the same person opens the same file and so the same session.

- **Made** by the Ctrl+T card, in the folder new notes go to, named `Terminal`, `Terminal 2`...
  A session is opened on the maker's own machine, which is started if it sleeps. Making one in
  somebody else's space is making a terminal on **your** machine that their people can watch.
- **Closing its tab** never ends the session: the shell and everything in it go on, as tmux's
  do when a client leaves.
- **`exit`**, or the shell ending: the file stays, the last screen stays readable with the
  local terminal's dim line saying the code, and Enter starts a new shell in the same session.
- **Deleting it** puts it in the trash, closes everybody's sockets but the owner's, and leaves
  the session running, reachable by its owner from Settings; **emptying the trash** ends it.
  A writer in a space can delete files; they cannot end somebody's agent by doing it.
- **Duplicate** makes a new session on the duplicator's own machine, in the same folder.
- **At most 8 sessions** a machine; a ninth is refused with the list of the eight.

### 4.6 The shared session

```
nib (desktop, phone, browser)          Worker                     the machine (microVM)
  xterm.js  ── socket ──►  Machine (Durable Object, eu)  ── one link ──►  nibd
  xterm.js  ── socket ──►     door: role, typing, quotas                 ├ pty 1 + headless xterm
  xterm.js  ── socket ──►     fan-out, presence, sizes                   ├ pty 2 + headless xterm
                                                                         └ activity, saves
```

**`nibd`** owns the ptys and the truth of every screen. One per machine, in node (the same
`@xterm/headless` and serialise addon the app's xterm.js reads, so a screen sent is a screen
drawn byte for byte), with `node-pty`:

- a session is a pty running the user's login shell as `nib` in the home, plus a **headless
  xterm** fed every byte it prints, with 5,000 lines of scrollback (the local terminal's);
- output is sent on at most once a frame and at once after a quiet one, as the local engine's
  sender does (`docs/terminal.md`, _The engine_), and at once for the first two reads after a
  key even inside a busy frame, so an echo never waits behind a spinner's frame; as binary
  frames numbered by a byte offset
  (`seq`), and the last megabyte of them is kept to answer a reconnect;
- it tells which program is in front and the title it set, by the local crate's rules
  (`/proc` and the foreground process group), so the tab is named and marked as a local one is;
- it reports `activity` (output, CPU, network) every 30 seconds, and the home's size hourly;
- on `sleep` or SIGTERM it writes each screen's serialisation and program to
  `/var/lib/nibd`, so the next boot draws them above a fresh prompt with the dim line saying
  when they are from - the local terminal's restore, `docs/terminal.md`.

**`Machine`** is the one door and the one fan-out. It holds one link to `nibd` (the SDK's
`containerFetch` to its port, upgraded) while anyone is connected or the machine is working,
and the people's sockets through the WebSocket hibernation API. The SDK's own `terminal()`
([terminals][cf-sb-term]) is the same shape for one viewer, with a raw replay buffer; `nibd`
is what adds many viewers, roles, sizes and whole screens. For every socket `Machine` asks, in
one query as the rooms do, whether the person reaches the `.term`'s space and as what, and whether
the account owns the machine. Everything typed is checked against that before it is passed on.

**Joining late, and coming back.** A new socket says `hello` with the `seq` it last drew, if
any. If `nibd` still holds everything after it, only that is sent; otherwise the **screen**
(the headless terminal serialised: the visible rows, the scrollback, colours, the cursor, the
second screen and every mode a program switched on), and then the stream from its `seq`. A
ring of raw output would draw a full-screen program's half-escapes as garbage; this is
Replit's lesson.

**The size.** A pty has one size. It is the size of **whoever typed last** - tmux's `latest`,
not Replit's smallest - and a typist's first key resizes it to them. Everybody else draws that
size: a screen too small scales the type down to fit the width, to 7 px, then scrolls
sideways; a screen too big draws it at their size with the rest left blank. A phone watching
never narrows the desktop's build log.

**Who is here.** Every socket is a person on a device; the tab shows their faces (the avatars
of `docs/chats.md`'s profiles lane) and a typing dot on whoever typed in the last two seconds.
The cursor - a pty has one - wears the colour of the person whose input came last, and their
first name beside it for 1.5 seconds after each burst, as a caret's flag does in a shared note
(`packages/editor/src/carets.ts`). Two people typing at once interleave, as in tmux and Live
Share; each frame (a key, a paste) arrives whole. Nobody's pointer or selection is sent: a
terminal's selection is a local thing.

**Who may.** The space's roles (`docs/collaboration.md`), and one setting per terminal,
`typing`, which only the machine's owner changes: `owner` (the default) or `writers`.

| | read | write | the space's owner | the machine's owner |
| --- | --- | --- | --- | --- |
| watch, scroll, copy, find, see who is here | yes | yes | yes | yes |
| type, paste, resize | | if `typing` is `writers` | if `typing` is `writers` | yes |
| `typing`, end the session, Resume | | | | yes |
| rename, move, delete, bookmark the `.term` | | as for a note | as for a note | as for a note |
| start, stop, reset or delete the machine; its usage | | | | yes |

- **A link guest only ever watches**, whatever their role: a person with no account typing on
  somebody's machine is a person nobody can hold to the terms.
- **Typing on** is a toggle in the tab's people popover, with one line under it the first time:
  _Typing here is typing on your machine._ Whoever can type can read every file on it - a
  coding agent's login included - as Live Share warns of read/write terminals.
- **Taken out** of a space, or `typing` turned off, closes or downgrades their sockets in the
  same request, as `roomsRevoked` does for notes.

**The wire**, typed in `@nib/online/wire` and framed with `@nib/sync-core/wire`:

- `GET /v2/online/:term/socket`, upgraded; subprotocols `nib.token.<token>` and
  `nib.device.<id>`, as the hub's. From the app: `hello {since?, cols, rows}`, `in {data}`
  (text) or a binary frame (raw bytes), `size {cols, rows}`, `start`, `resume`. To the app:
  binary output frames (8 bytes of `seq`, then bytes), `screen {seq, cols, rows, data}`,
  `size {cols, rows, by}`, `people [{who, device, typing}]`, `typed {who, seq}`,
  `program {name, title, mark}`, `machine {state, reason?}`, `role {type}`, `ended {code}`,
  `refused {error}`.
- Between `Machine` and `nibd`, one socket, every frame naming its session: `open`, `in`,
  `size`, `want {since}`, `close`, `sleep`; and back `out`, `screen`, `program`, `ended`,
  `activity`, `saved`. `nibd` takes the link only with the secret `Machine` hands it at boot.
- The hub gains one frame, `{t:'machine', state}`, to every device of the owner, so a status
  dot changes everywhere at once; a `.term` reaches the space's other devices as any file does.

**Bounds.** 25 sockets a session; 100 input frames a second a person, 64 KB a frame; a
socket more than 1 MB behind is sent a fresh screen instead of the backlog; output is coalesced
in `nibd`, so a flood is sixty frames a second, not one per read.

### 4.7 Unattended agents

An agent is a program in a session, nothing more: `claude` or `codex` typed at the prompt, in a
machine that keeps running while it works (4.4).

**Signing in** is the agent's own flow, inside the machine, as `docs/ai.md` requires: the
person types `claude` (Claude Code shows Anthropic's sign-in address and asks for the code it
gives back) or `codex login --device-auth` (OpenAI's device code, which the person allows once
in ChatGPT's security settings, [auth][codex-auth]). The address is a link in the terminal, and
Ctrl+click opens it in a web tab beside it, as any link does. The credentials land in the
person's home (`~/.claude`, `~/.codex/auth.json`), which is theirs as a laptop's would be.

What this is, in Anthropic's words, and why nib may do it ([legal][cc-legal]): the same page
that forbids developers to "collect, store, or intermediate Claude.ai credentials" says it does
not "prevent an end user from signing in to the unmodified Claude Code binary with their own
Claude subscription, including where a platform hosts Claude Code". So nib keeps to the four
things it keeps to on the desktop:

- the binary is Anthropic's, unmodified, with every sign-in method left in;
- every person signs in with their own credentials, and nib never pays for, resells or routes
  anybody's usage;
- **no code of nib's reads a token**: `nibd` never opens anything under `~/.claude` or
  `~/.codex`, the Worker never sees the providers' traffic decrypted (4.8), and the backups are
  bytes nib stores and never parses;
- nib says "runs Claude Code" in plain words, and never uses its name or logo as its own.

OpenAI says to treat `auth.json` "like a password". It is one: whoever can type in a session
can read it, which is why typing is the owner's alone by default (4.6).

**Resume.** When a machine wakes and a session's saved program was `claude` or `codex`, the tab
shows one quiet bar under the restored screen, **Resume**, which types `claude --continue` or
`codex resume --last` into the fresh shell. Enter is Resume too. The agents keep their own
conversations in the home, so nothing of nib's holds them.

**Notifications.** An agent that stops to ask, or finishes, sets its title (Claude Code does),
and the owner's devices are told through the push module `docs/chats.md` lane 6 builds, once it
exists: _Build is waiting._ Until then the tab's mark shows it.

**Later**: nib's own agent verbs (`run_terminal`, `docs/agent-native.md`) reaching an online
terminal under the same grant and questions as a local one.

### 4.8 Security

**Isolation.** A Firecracker microVM per machine (3.2). Nothing privileged runs outside it on
nib's behalf: there is no host of nib's, no Docker socket, no shared volume between machines.
Inside, the user is root by `sudo`, which is the point; the VM is the boundary. Machines cannot
reach each other: no private network is configured, and `deniedHosts` holds every private
range and the metadata addresses.

**Ceilings by the instance type**: ½ vCPU, 2 GiB of memory and an 8 GB disk on the free
allowance; a process limit of 4,096 (`nibd` sets `pids.max` on the sessions' cgroup), so a
fork bomb ends in its own session.

**Egress.** `enableInternet = false`, so nothing leaves on any port but HTTP and HTTPS: no mail
(port 25), no SSH, no raw TCP or UDP, no port scans; Cloudflare enforces it outside the VM
([outbound][cf-out]). HTTP and HTTPS go anywhere not in `deniedHosts` (private ranges, metadata
addresses, a maintained list of mining pools). HTTPS through the host needs `interceptHttps`
and the per-instance CA Cloudflare puts at `/etc/cloudflare/certs/`, whose key "never leaves
the container runtime sidecar" ([egress][cf-egress-src]). **The rule nib holds to**: the AI
providers' traffic is forwarded by Cloudflare's sidecar and never handed to a Worker handler of
nib's, because a handler would hold the person's token in the clear (4.7). The infra lane proves on day one
which configuration gives that (an allow-list forward with no catch-all handler; or handlers by
host only for what nib meters); if none does, nib installs no outbound handler at all and
meters egress from Cloudflare's own figures.

**Rate limits**, as `limits` rows: machine starts 6 an hour, sessions made 30 a day, sockets per
session 25, input 100 frames a second a person; egress 20 GB a month on the free allowance.

**Abuse**:

- **mining**: CPU is metered and capped (10 vCPU-hours a month free), so it earns nothing;
  `Machine` also flags a machine above 80% CPU for an hour with nobody connected, and `nibd`
  reports known miners' process names (a cheap signal a root user can hide, never the only one);
- **mail and scanning**: impossible with the internet off (above);
- **HTTP floods and scraping**: the egress cap, and a flag past 1 GB an hour;
- a **flag** stops the machine, mails Emil and the owner, and keeps it stopped until Emil lets
  it go (`/admin/machines/:id`). Reports reach `abuse@nibeditor.com`.

**Secrets.** Cloudflare's advice is to "assume that the code uses everything it can reach"
([security][cf-sb-sec]), so nib puts none of its own in a machine: no Worker secret, no
account token, no key of nib's. `nibd`'s link secret is per boot and opens only `nibd`. A
person's own secrets are theirs, in their home; Settings never offers to inject any (Codespaces' secrets are a
later feature, if ever). Backups are encrypted at rest by R2; the operator could read a home,
as any host could, and nib's code never does - stated in the terms, as chats state their own.

**Kill switches**, each one request:

- **a machine**: the owner's Stop; Emil's `/admin/machines/:id/stop`;
- **an account**: `users.online` cleared, which stops its machine and refuses a start;
- **the service**: `online` off in the Worker's settings row, after which every `Machine`
  stops itself at its next minute and nothing starts;
- **the budget breaker**: the month's estimated spend (4.9) reaching Emil's ceiling refuses
  every wake; awake machines get ten minutes and a line on their screens.

**Audit.** `machine_events (machine, at, kind, who, device, detail)`: start, wake, sleep, stop,
snapshot, backup, restore, a socket opened and closed with its role, `typing` changed, Resume,
flags, the hourly egress and CPU. **Never a keystroke or a screen.** Kept 90 days; the owner
sees their machine's in Settings, Emil sees all.

**Who gets one** (decision 4): the allow-list (`users.online`), signed in; later any account
with a second factor on (a stolen session would be a machine holding somebody's agent login)
and at least seven days old. **Terms**: nib has none published yet. Before anybody outside the
allow-list: a page at nibeditor.com/terms with the online terminal's part - no mining, mail,
scanning, attacks or illegal content; no getting round the limits; nib may stop a machine and
reads its metadata (the audit above), never its contents unless the law makes it; homes are
deleted 90 days after the machine was last awake; no promise it is always there; a machine is
for its owner's use, as the agents' own plans are.

### 4.9 Cost control

**Measured, not guessed.** `Machine` adds up, per account per month, awake seconds × memory,
disk and the object, CPU seconds from Cloudflare's metrics, and egress
(`machine_usage (user, month, awake_s, cpu_s, mem_gib_s, disk_gb_s, egress_bytes)`), and the
same sums for the whole service give the month's estimated spend for the budget breaker.

**The free allowance** (decision 3): 20 awake hours, 10 vCPU-hours, 5 GB of home, 20 GB of
egress, one small machine, sleep after 15 idle minutes, no Keep awake. Worst case per person ≈
$0.70 awake + $0.08 stored ≈ **$0.80 a month**; a hundred people using all of it are $80, so
the service ceiling (default $30, Emil's to set) is the real bound, and the allow-list is how
it is kept far from it.

**The meter.** Settings › Online terminal shows the month as one bar per allowance (hours, CPU,
home, egress) and the reset date; the machine's mark on a tab turns amber at 80% of hours. At
100% the machine finishes the minute, saves, sleeps, and its tab says until when.

**Options for Emil, later** (none built in this round):

- **a paid tier**, through Stripe (nib takes no payment today): for example CHF 6 a month for
  150 awake hours, 20 GB of home, a 1 vCPU / 4 GiB machine, and **Keep awake** for CHF 20 more
  (a small machine always on costs about $17.70, 3.3);
- **bring your own machine**: `nibd` installed on a server of the person's own, dialling out to
  their `Machine`, so sharing and every screen work the same at no cost to nib. Remote (SSH)
  already covers using one's own server alone;
- **bring your own cloud key**: the person's own Cloudflare or Fly account running their
  machine. Possible behind `MachineHost`, but a key of theirs held by nib is a secret nib would
  have to keep; the least attractive of the three.

### 4.10 In the app

- **Ctrl+T**: a card **Online terminal**, letter **O**, after Remote; on the desktop, the phone
  and the browser build (it is the one terminal those two can have). The same row in the tab
  strip's plus menu, the palette (_New online terminal_) and an empty pane. With no machine yet
  it makes one; signed out it opens the account sheet; not allowed yet it says so once.
- **The tab** is the terminal tab (`TerminalTab.svelte`, xterm.js, the look, the keys, find,
  links, paste rules - all of `docs/terminal.md`), fed by the socket instead of a pty. Named by
  `naming.ts`'s order - a name the reader gave it (here: the file's, unless it is still the
  `Terminal` it was made as), the program's title, the program and the folder, the shell and
  the folder - and marked by the program in front, with a small cloud in the mark's corner
  so it never reads as a local shell. The people watching are faces at the tab's end.
- **The machine's state** is the mark's dot: none while awake, hollow while asleep, turning
  while starting, amber near the allowance. A terminal of a sleeping machine draws its last
  screen dimmed at once (kept in the sync store from the last visit) and wakes the machine
  when it is on screen; it is live 1-3 seconds later.
- **Settings › Online terminal**: the machine (state, size, region, Start/Stop), the month's
  usage, the sessions (each with its space, who is watching, End), the audit, **Download
  home**, **Reset machine**, **Delete machine**. The palette has Start and Stop.
- **Move to space** moves the `.term` (4.5); the session goes on, and the audience changes.
- **Restore** after a restart is the file reopening; its tab draws the cached screen and
  connects when looked at. Split and Open another make a new `.term` beside it.
- **Closing** an online terminal's tab never asks: nothing ends.
- **Later: the machine's files as a space**, a space whose folder is the machine's home, so a
  note written by the agent is a note in nib. It needs the same remote file operations
  `docs/terminal.md` leaves for the SFTP space, and is designed with it.
- **Later: ports**: a server the person runs in the machine opened in a web tab through the
  Sandbox SDK's preview address, behind the owner's session.

### 4.11 On a phone, and in the browser

- **Watching** works as on the desktop: the session scaled to the phone's width down to 7 px
  type, then panned; pinch changes the type size for this phone only.
- **Typing**: the bar over the keyboard (`docs/mobile.md`, _The bar over the keyboard_) gains
  the terminal's row while one has the keyboard: Esc, Tab, Ctrl and Alt (sticky for one key, as
  Termux's extra keys are), the four arrows, `|`, `~`, `/`, `-`. A long press pastes. The
  first key typed makes the phone the size (4.6), so a phone that types gets a terminal that
  fits it, and the desktop scales until somebody types there.
- **The browser build** has the same terminal; the session is the same session.

### 4.12 Fast

- Nothing of it is in front of the first paint: the card's row is a word and a letter; the
  surface reuses `terminalSurface` and its lazily fetched xterm.js; `lib/online/` is fetched
  with the first online terminal.
- The last screen is drawn from the local cache before the socket opens, so a tab is never
  blank, and a sleeping machine's 1-3 s start is spent looking at it.
- Machines in the EU: an object is placed where its first request came from, in the EU
  jurisdiction, and its container beside it (the first machine, from Zurich: both in Prague,
  read 2026-10-05). Containers that `Machine` starts itself take no placement constraint
  (wrangler refuses `constraints` for them), and an object never moves.
- A key's path waits on nothing: `Machine` forwards input before any bookkeeping and with no
  storage or query, sends the echo on as it comes, and its 30-second activity write is
  unconfirmed so it never holds frames behind it (the output gate).
- **Predictive echo**, mosh's and VS Code's local echo: at a shell prompt, printable keys are
  drawn at once, dim and underlined, over the screen (never into it), once the measured echo
  is 30 ms or slower; the first key after Enter or a wrong guess is a hidden probe, so a
  password is never drawn. See `apps/desktop/src/lib/online/echo.ts`.

### 4.13 As if it were here

Emil, 2026-10-05: "I want the online terminal to integrate nicely, e.g. when I Ctrl+Click a
link there it should open in my browser" - after `claude` printed its sign-in address to be
copied by hand. VS Code Remote and Codespaces solved the same: a `BROWSER` helper that opens
on the person's computer, port forwarding for the sign-in's way back, and the clipboard.

- **The machine's browser is its owner's.** `nib-open` (services/machine) is `xdg-open`,
  `sensible-browser`, `x-www-browser`, `www-browser` and `$BROWSER` on the machine. It posts
  the address and `$NIB_SESSION` to `nibd` on a Unix socket (`/run/nibd/open.sock`, every
  user of the machine may write, since every user is its owner), which says `browse
  {session, url}` up the link; `Machine` sends `browse {url}` to **one** socket of the
  machine's owner on that session - the device that typed there last, else the one seen
  last - and to nobody else: a watcher is never sent a page by somebody else's machine.
  Only `http` and `https` (`isWebUrl` in `@nib/online/urls`), at most ten a minute at
  `nibd` and at `Machine`, six a minute a terminal in the app. With no nib connected,
  `nib-open` fails and the program prints the address, as it does on any headless box.
- **Where it opens** is where a link from the terminal opens (`lib/online/opening.svelte.ts`):
  a web tab beside the terminal on a desktop - in front while the terminal is what the
  person looks at, behind while an agent works alone - the system browser on a phone, and
  in the browser build, which may not open a window nobody pressed for, the site's name on
  the terminal's quiet bar, one press away (Codespaces' notification button).
- **A sign-in's way back.** Claude Code (read from its binary on 2026-10-05) opens a browser
  only when `$BROWSER` is set or there is a display, and sends that browser back to its own
  listener, `http://localhost:<49152-65535>/callback`; Codex to `localhost:1455`. That page
  is on the machine. So a tab opened for an address whose query names a loopback page is
  watched, and when it lands on that origin - and only that one (`isCallbackOf`) - the app
  says `callback {url}`; `Machine` passes it on for the owner alone, and `nibd` makes the
  one GET on the machine, loopback only, ten seconds at most, redirects not followed, and
  answers `called {url, status}`. On a 2xx or 3xx the tab closes and the terminal is in
  front again, where the program says it is signed in; otherwise the tab stays to show the
  error. VS Code forwards the whole port; one request is all a sign-in needs, and nothing
  else of the machine is reachable from the person's computer. A phone and the browser
  build cannot watch a tab, so they do not open such an address at all, and the address
  the program printed (Claude Code's manual one) stands.
- **Pasting** is every terminal's: Ctrl+Shift+V, Shift+Insert, Ctrl+V on Windows, Cmd+V,
  the menu, with the local rules for several lines and bracketed paste. Input goes up in
  frames of at most `MOST_INPUT` (64 KB) of UTF-8, never cut inside a character
  (`inputChunks`), at no more than half the `Machine`'s rate, so a pasted log arrives whole
  inside one pair of paste brackets instead of being refused as one frame `large`.
- **The clipboard** (OSC 52) and **notifications** (OSC 9, OSC 777, the bell) are every
  terminal's too (docs/terminal.md), with one rule of the online terminal's: OSC 52 is
  written only in a window that may type in the session.
- **The same environment as a local terminal**: `TERM_PROGRAM=nib` beside `TERM` and
  `COLORTERM`, and the title a program sets names the tab (4.10).
- **Left out**: the folder a shell reports (OSC 7) - a folder on the machine is nothing
  this computer can open; forwarding any other port (ports, 4.10's later); and asking a
  browser build's permission to notify, which the page does not ask for a terminal.

### 4.14 Never frozen

2026-10-06: after seven awake hours Emil's terminal stopped answering - no output, keys going
nowhere, new terminals loading for ever - and the Stop that followed saved neither the home nor
the disk. An awake machine either works or says it does not, and comes back by itself
(Kubernetes' liveness probe, systemd's watchdog, mosh's "last contact").

- **The link is pinged.** `Machine` pings `nibd` every 15 s (`PING_EVERY`); a link that says
  nothing at all for 40 s (`SILENT_FOR`: no pong, no output, no activity) is dead whether or
  not it ever closes. `nibd` drops a link that pinged and then fell silent, so ptys paused
  behind a half-open link are read again.
- **A dead link is made again** (`recover`): every socket is told `starting` at once, the
  link is made again within 20 s, and the sockets are told `awake`. Where it cannot be, the
  machine **restarts**: a snapshot first (60 s at most), the stop, a wake from that snapshot -
  `starting` all the way, never `asleep` in between. A terminal opened or typed in while the
  link is gone starts this at once rather than at the next minute.
- **A restarted object adopts its instance.** Every deploy restarts `Machine`; the first link
  after one sets the inactivity timeout and the backups' route again (Cloudflare stops a
  container whose object went quiet without them), and a wake that finds an instance still
  running (a sleep a deploy cut short) links to it as it is.
- **`nibd` watches itself.** A worker thread ends `nibd` when its event loop has not turned
  for a minute (`watchdog.ts`); the entrypoint starts it again in the same machine, so the
  disk and the home stay, and the screens come back from a save at most five minutes old.
  Five ends in ten minutes end the machine instead, which `Machine` answers with a restart.
  The sessions' cgroup gets the machine's memory less 512 MiB, so a build that eats it all
  is ended by the kernel inside the sessions, not by a machine thrashing around `nibd`.
- **The app's socket beats** every 10 s, answered by the runtime without waking the object;
  three unanswered beats drop and reopen it. A live terminal told `starting` shows the card
  again over its dimmed screen until its session's screen is back.
- **Saves in the right order.** A sleep snapshots first (what the next wake boots from), then
  backs the home up if due. A wake from a backup never waits for it: the machine is awake at
  once, the sessions open once the home is back or could not be (then one dim line, _Your
  home folder could not be restored_). Every failure is written to `machine_events` with its
  reason (`failureOf`: the step, the error's name and code, its words with home paths cut).

## 5. What nib does not do

- **Machines per space**, or machines several people pay for (4.1).
- **Memory across a sleep** on Cloudflare (3.4); Fly behind `MachineHost` if it is ever needed.
- **SSH into the machine from outside**, or inbound ports: the way in is nib.
- **Secrets injected by nib**, or nib's own login for any agent (4.7).
- **Typing by link guests** (4.6).
- **Recording keystrokes or screens** for anybody but the person's own screen cache (4.8).
- **GPUs, Windows machines, several machines per person.** Later, if ever.

## 6. The implementation plan

Six lanes in three waves, at most six agents at once. Each lane reads this document,
`docs/conventions.md` and the rules for every nib agent first, writes tests for its logic, adds
every new string to every catalogue in `apps/desktop/src/locales`, and never raises the
first-paint budget. Files in the app are relative to `apps/desktop/src`, in the Worker to
`services/sync/src`; the new package is packages/online, `@nib/online`; the machine's own code
is services/machine/.

**Nothing in the cloud until Emil says go.** A push to main deploys the Worker (`check.yml`'s
`deploy` job), so the `containers` block, the `Machine` binding and its migration tag stay in
services/sync/wrangler.machines.jsonc, which CI does not deploy, and the routes answer 404
while `online` is off. No lane creates a Cloudflare resource, pushes an image or spends money;
everything is tested against a fake host and a local `nibd`. Going live is the checklist in 6.3.

### 6.1 The interfaces the lanes meet at

Written first, by lane 1, in `@nib/online`'s `types.ts`:

```ts
type MachineState = 'asleep' | 'starting' | 'awake' | 'stopping'
type Typing = 'owner' | 'writers'
interface Term { v: 1; machine: string; session: string }

interface Activity { at: number; output: number; cpu: number; net: number; homeBytes: number }
interface Watcher { who: string; device: string; active: boolean; onScreen: boolean }
interface Allowance { awakeS: number; cpuS: number; homeBytes: number; egressBytes: number }

// The one rule of 4.4: whether the machine stays awake, and why not if not.
function awake(now: number, watchers: readonly Watcher[], recent: readonly Activity[],
  keepAwake: boolean, used: Allowance, limit: Allowance, budgetLeft: number):
  { stay: true } | { stay: false; reason: 'idle' | 'allowance' | 'budget' | 'off' }

// Who decides the pty's size (4.6).
function sizeOf(typed: readonly { who: string; at: number; cols: number; rows: number }[]):
  { cols: number; rows: number } | null

function mayType(role: 'read' | 'write' | 'owner' | null, guest: boolean, ownsMachine: boolean,
  typing: Typing): boolean
```

`@nib/online/wire` types every frame of 4.6, both links, with codecs and their tests.

The host behind `Machine` is one interface, so the SDK (or Fly) is one file:

```ts
interface MachineHost {
  start(id: string, image: string, env: Record<string, string>): Promise<void>
  stop(id: string, grace: number): Promise<void>
  link(id: string): Promise<WebSocket>              // to nibd
  snapshot(id: string): Promise<string>
  backup(id: string, dir: string): Promise<string>
  restore(id: string, from: { snapshot?: string; backup?: string }): Promise<void>
  usage(id: string, since: number): Promise<{ cpuS: number; egressBytes: number }>
}
```

`nibd` is told nothing of nib's accounts: it speaks the link protocol and nothing else.

### 6.2 The lanes

| lane | owns | builds | tests | wave |
| --- | --- | --- | --- | --- |
| **1 `online-core`** | packages/online (new); `packages/sync-core/src/tree.ts` (the `term` kind) | the types above; `awake`, `sizeOf`, `mayType`; the wire frames and codecs; the `.term` text read and written; usage arithmetic (4.9) | `awake` as a table of every case of 4.4 (active vs idle watchers, on screen or not, output, CPU, network, each allowance, the budget, `off`) plus property tests (more activity never sleeps sooner); `sizeOf` with phones watching and typing; `mayType` for every row of 4.6's table and a guest at each role; codec round trips; `tree.test.ts` with `.term` entries moved, renamed, trashed | 1 |
| **2 `online-nibd`** | services/machine/ (new): `nibd` in node, the `Dockerfile`, the entrypoint (CA, environment, first-boot installs of Claude Code and Codex) | ptys with `node-pty`; a headless xterm per session; frames numbered by offset and the last megabyte kept; screens serialised for joiners; program and title in front; `activity` and the home's size; saving screens on `sleep` and SIGTERM and drawing them after a boot; the process limit; the link secret | on Linux in CI (`ubuntu-latest`): a session's echo; a late joiner's screen equal to a client that saw everything, with vim on the second screen and colours mid-stream (the serialised screen and the stream after it compared cell by cell); a reconnect inside and outside the kept megabyte; activity counted; screens back after SIGTERM and a restart; a fork bomb contained; the image built and `nibd` answering in it with `docker run`, no cloud | 1 |
| **3 `online-machine`** | `machines/` in the Worker (new): `Machine`, its routes, the door, `MachineHost` over the Sandbox SDK and a fake; `wrangler.machines.jsonc` (new); migration `00xx_machines.sql` (`machines`, `machine_usage`, `machine_events`, `term_sessions`, `users.online`); the hub's `machine` frame (`hub/frames.ts`); `guestMayReach`; `erase.ts` and `leftovers` for the new tables | 4.1, 4.3, 4.4 and 4.6's server side: start, wake, the minute alarm with `awake`, sleep with save, snapshot, backup and restore by the rules of 4.3; the fan-out with hibernating sockets; the door through the rooms' one query; revocation closing sockets; Download home; the trash rule of 4.5; the egress configuration of 4.8, with the day-one proof that providers' traffic never reaches a handler | route tests against real SQL with the fake host: 4.6's table for five holders (two guests); a socket refused typing; revocation; a copied `.term` reaching nothing; sleep and wake through the fake with the alarm driven by a clock; restore choosing snapshot or backup; `erase.test.ts` with the new tables; `wrangler deploy --dry-run --config wrangler.machines.jsonc` | 1 |
| **4 `online-guard`** | `machines/limits.ts`, `machines/meter.ts`, `machines/admin.ts`, `machines/budget.ts` (new, in the Worker); the `limits` rows; the abuse flags; the terms page text (`terms.ts` in the Worker, new) | 4.8's rate limits, flags, kill switches (machine, account, service), the budget breaker, the audit writes and reads; 4.9's meter and allowance; the allow-list | each limit at its edge; the breaker refusing a wake and giving ten minutes; the service switch stopping every machine at the next alarm; a flag stopping and holding a machine; the audit never holding input (a test that types a secret and finds it nowhere in D1) | 2 |
| **5 `online-client`** | `lib/online/` (new: the socket, the screen cache, the people popover, Resume, the phone's key row); the `online` kind in `lib/new-kinds.ts`, `lib/openers.ts` and `lib/file-mark.ts`; the terminal surface's source switch in `lib/terminal/` (one seam: a pty or a socket); `lib/terminal/naming.ts` and `marks.ts` (the cloud corner); Settings › Online terminal (new pane); `lib/sync2/kinds.ts` (a `.term` entry) | 4.10 and 4.11: the card on O, the tab, its name and mark, faces and the typing dot, the cursor's colour and flag, the size rule's scaling, the cached screen, waking on screen, Resume, Move to space, restore, the Settings pane and meter, the phone's keys and pinch | component tests per surface; a drive `test/e2e/online.py` against the Worker with the fake host and a local `nibd`: two browsers on one shared space, one typing and the other seeing it within 100 ms, the typist's colour, a reader refused typing, a late joiner's screen equal to the typist's, the phone width scaling, a restart restoring the tab and its screen; `weight.test.ts` unchanged; probes only through `run_probe()` with the lane's own identifier | 2 |
| **6 `online-agent`** | services/machine/ (the agents' first-boot install, with lane 2); `lib/online/resume.ts`; the waiting notice through `docs/chats.md` lane 6's push module; `docs/ai.md` (a section on hosted machines) | 4.7: Claude Code and Codex installed unmodified into the home and kept updating; the sign-in links; Resume for both; the title-based waiting notice | in the image in CI: `claude --version` and `codex --version` run, the installers' checksums verified, no file under `~/.claude` or `~/.codex` opened by `nibd` (an `strace`-style test over a scripted session); Resume typing exactly the documented command; `docs/ai.md`'s rules unchanged | 3 |

**Wave 1** is lanes 1, 2 and 3: a pure package, the machine's own code and the Worker, which
meet at 6.1 and nothing else. **Wave 2** is lanes 4 and 5 once 1 and 3 are on main (2 may
still run), each against the fake host until the other lands. **Wave 3** is lane 6. With
`docs/chats.md`'s and `docs/tasks.md`'s waves running too, the manager's cap of six decides the
order; lane 3 and chats' lane 2 both add a Durable Object class and a migration tag, so
whichever lands second takes the next tag.

Docs each lane updates: lane 1 `docs/conventions.md` (the package, the words _online terminal_
and _machine_); lane 3 `docs/sync-v2.md` sections 7 and 8; lane 5 `docs/terminal.md` (a
section _An online terminal_), `docs/keyboard.md`, `docs/design.md` and `docs/mobile.md`; lane
6 `docs/ai.md` and `docs/agent-native.md`.

### 6.3 Going live (Emil, after the waves)

1. Emil answers the decisions above and sets the ceiling.
2. The terms page is published; `abuse@nibeditor.com` exists.
3. The container block, the binding and the tag move from `wrangler.machines.jsonc` into
   `wrangler.jsonc`; the image is built and pushed by `wrangler deploy` (Cloudflare's own
   registry, 50 GB per account, one image). This is the first moment anything costs money.
4. A budget alert in Cloudflare's dashboard at the same ceiling, as a second breaker.
5. `online` on; Emil's account on the allow-list; a week of his own use with the drives
   against the real host; then the allow-list grows.

### 6.4 Risks

- **The Sandbox SDK is young.** Everything goes through `MachineHost`; the version is pinned;
  lane 3 proves start, link, snapshot, backup and restore on day one against Cloudflare's
  local runner where Docker is available, and documents what could not be proved locally.
- **HTTPS egress and the providers' tokens.** If no configuration keeps them out of nib's
  handlers, nib runs with no handler and meters from Cloudflare's figures (4.8). Never the
  other way round.
- **Restarts nobody asked for** kill a working agent. Saving on SIGTERM and Resume make it an
  interruption, not a loss; if it proves frequent, Fly's suspend behind `MachineHost`.
- **A container may start away from its object**, which adds latency; the `WEUR`/`EEUR`
  constraint bounds it, and lane 5's drive measures keystroke round trips.
- **Cost from a bug**, not from use (a machine that never sleeps). The breaker, the
  dashboard alert, the minute alarm's tests, and the audit's hourly CPU line are four separate
  ways it is noticed.
- **A shared login.** Whoever can type can read the agents' credentials. Typing is the owner's
  by default, the line says so once, and the terms say a machine is its owner's.

## Sources

[cf-arch]: https://developers.cloudflare.com/containers/platform-details/architecture/
[cf-price]: https://developers.cloudflare.com/containers/pricing/
[cf-cpu]: https://developers.cloudflare.com/changelog/post/2025-11-21-new-cpu-pricing/
[cf-limits]: https://developers.cloudflare.com/containers/platform-details/limits/
[cf-faq]: https://developers.cloudflare.com/containers/faq/
[cf-out]: https://developers.cloudflare.com/containers/configuration/outbound-traffic/
[cf-place]: https://developers.cloudflare.com/containers/platform-details/placement/
[cf-snap]: https://developers.cloudflare.com/containers/guides/snapshots/
[cf-sb-life]: https://developers.cloudflare.com/sandbox/concepts/lifetime/
[cf-sb-files]: https://developers.cloudflare.com/sandbox/files/
[cf-sb-sec]: https://developers.cloudflare.com/sandbox/concepts/security/
[cf-sb-term]: https://developers.cloudflare.com/sandbox/guides/browser-terminals/
[cf-egress-src]: https://github.com/cloudflare/containers/blob/main/docs/egress.md
[do-price]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[r2-price]: https://developers.cloudflare.com/r2/pricing/
[fly-price]: https://docs.fly.io/about/pricing
[fly-suspend]: https://docs.fly.io/reference/suspend-resume
[fly-regions]: https://docs.fly.io/reference/regions
[fly-vol]: https://docs.fly.io/volumes/overview
[e2b-price]: https://e2b.dev/pricing
[e2b-persist]: https://docs.e2b.dev/sandbox/persistence
[e2b-net]: https://e2b.dev/docs/network/internet-access
[dt-price]: https://www.daytona.io/pricing
[dt-iso]: https://www.daytona.io/docs/en/isolation/
[modal-price]: https://modal.com/pricing
[modal-sb]: https://modal.com/docs/guide/sandboxes
[modal-snap]: https://modal.com/docs/guide/sandbox-snapshots
[cs-price]: https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
[cs-life]: https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
[cs-sec]: https://docs.github.com/en/codespaces/reference/security-in-github-codespaces
[cs-timeout]: https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces
[hz-price]: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
[fc-bulletin]: https://aws.amazon.com/security/security-bulletins/2026-015-aws
[fc-adv]: https://github.com/firecracker-microvm/firecracker/security/advisories
[fc-2019]: https://www.openwall.com/lists/oss-security/2019/12/10/1
[gvisor-sec]: https://gvisor.dev/security/
[runc-2025]: https://www.sysdig.com/blog/runc-container-escape-vulnerabilities
[ls-term]: https://learn.microsoft.com/en-us/visualstudio/liveshare/use/share-server-visual-studio-code
[tmate]: https://tmate.io/
[sshx]: https://github.com/ekzhang/sshx
[replit-shell]: https://replit.com/blog/shell2
[warp-share]: https://docs.warp.dev/knowledge-and-collaboration/session-sharing
[cc-legal]: https://code.claude.com/docs/en/legal-and-compliance
[codex-auth]: https://learn.chatgpt.com/docs/auth
