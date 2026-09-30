# Sync, version 2

A design, not a build. It decides how nib moves notes, files and web logins between
devices for the next several years, and it ends in a plan that eight agents can build in
parallel. `docs/sync.md` and `docs/collaboration.md` describe what ships today; this is
what replaces the parts of them that hand people conflict files.

Emil, 2026-09-30:

> I want to rework the entire syncing backend of our application. Our goal with the
> syncing should be to abstract as much as possible away from the user and always prevent
> having conflicts when possible, to handle stuff automatically.
>
> **Web pages:** effectively, you LOCK a web page while using it. If another device of the
> same account tries opening the same web note, it gets a message making clear it's in use
> somewhere else right now. There's a button to acquire the lock, and then the other device
> loses it and shows that message instead. After some inactivity the lock is automatically
> released, including if the PC crashes from one millisecond to the next. For web notes,
> syncing can be very aggressive: we just override whatever was saved as state for that
> website with our current version. The state of the website should be synced as accurately
> as possible. Not just some basic cookies, but basically the same way as closing and
> reopening Chrome.
>
> **Markdown notes and the rest:** think really hard about how we want syncing to be for the
> best user experience, so users don't get random merge-conflict files all the time, even if
> they work offline for some time. In the worst case, when stuff completely diverges, don't
> just create a merge-conflict file. Instead show a modal with the options: overwrite, keep
> cloud version, or save as copy / keep both.

## The short version

1. **Every document is a CRDT on every device, not only while a room is open.** The Yjs
   document nib already uses for live editing is kept on disk beside the note, and the
   markdown file is what that document writes. Offline edits merge character by character
   on the way back, the way live keystrokes already do. Conflict files are gone.
2. **Confirmed and pending.** Each device keeps what the account has acknowledged and what
   it has not yet sent, the way Replicache and Logseq's sync rebase queued writes. A device
   coming back with offline edits sees the account's changes before it sends its own.
3. **The modal is the only question, and it is asked rarely and exactly.** Only the device
   whose edits arrive second checks, and it asks only when both sides rewrote the same text
   (more than a sentence of overlap) or one side deleted a paragraph the other rewrote. Keep
   mine, keep the other device's, keep both. Nothing else ever produces a second file.
4. **Files edited by other programs** are folded in with a three-way merge against the text
   nib last wrote, so git, Obsidian and a text editor are ordinary writers.
5. **The tree gets ids.** Folders are rows with ids; rename and move are operations on an
   id, applied by the account in arrival order. An edit beats a delete, a rename never
   loses history, two creates of one name become two names (or one day's note).
6. **Every file in a space syncs**, pictures, sound and PDFs included, as content-addressed
   blobs; large ones arrive when opened.
7. **Pokes instead of polling.** One hibernating socket per device to a per-account Durable
   Object; a change reaches the other devices in about a second, and an idle socket costs
   nothing.
8. **A web login is a lease.** What is locked is the site's session in its web store (a
   Gmail note and a Calendar note share one Google login, so they lock together). A device
   holds it while it is in use, beats every 10 s, and loses it 30 s after it stops beating
   or 5 minutes after the person stops touching it. "Use here" takes it, the other device
   hands over its latest state first, and every upload carries a fencing token.
9. **The state that moves is what Chrome keeps across a restart**: cookies (session,
   HttpOnly and partitioned ones included), localStorage, the tab's sessionStorage,
   IndexedDB, the tab's history and scroll, zoom and site permissions. Not the caches,
   which the site refills. Moved through each engine's APIs, because cookie databases are
   encrypted to the machine and cannot be copied.
10. **Web state is end-to-end encrypted.** The server holds ciphertext under opaque names.
    A new computer is approved once from one that already has the key, by comparing six
    digits; with no computer left, you sign in to the sites again. No recovery code.
11. **One protocol for everything, with v1 kept alive** for older apps: a v1 client looks to
    the account exactly like a device that cannot reach a room does today.

---

## 1. What there is today, and where the second files come from

### The pieces

| | what it does | where |
| --- | --- | --- |
| the pass | pulls a page of changes since a cursor, then pushes every file whose hash moved, whole, naming the version it edited | `apps/desktop/src/lib/sync/mirror.ts`, `sync.svelte.ts` |
| the mirror | per space: cursor, and per path `{id, version, hash}` plus the writes in the air | `localStorage` key `nib:mirrors` |
| the loop | a pass every 20 s after activity, doubling to 2 min, 10 min when hidden; a nudge 2 s after a save | `backoff.ts` |
| the conflict rule | `both` (a copy beside), `newest` (file time against the account's), `ask` (held for the Sync pane) | `sync/conflicts.ts`, `sync/record.svelte.ts` |
| rooms | live collaboration: one Durable Object per open file holding a Yjs document (a CRDT; OT was weighed and rejected in `collaboration.md`), joined by every device that has the file open; the device keeps no Yjs state once it closes; settles markdown into D1 and R2 1.2 s after typing stops | `services/sync/src/rooms`, `apps/desktop/src/lib/rooms` |
| joining a room | compares the file with the room against the hash the account last handed over: `take`, `offer`, or `apart` | `rooms/join.ts`, `rooms/apart.ts` |
| versions | every push is a version (one per 5 min), bodies in R2 by hash, thinned with age | `services/sync/src/versions.ts` |
| the account's notes | D1 `notes` (id, path, seq, version, hash) and R2 `spaces/<space>/<id>` | `services/sync/src/notes.ts` |
| files that are not notes | PDFs and `publish.css/js` go up as blobs for publishing and never come down; pasted pictures go to the account's blob store when signed in, beside the note otherwise; sound and dropped files stay beside the note and never travel | `mirror.ts` `pushFiles`, `assets.ts` |
| files changed by other programs | only files outside a space are watched; a changed file under unsaved words turns the light red | `watch.svelte.ts` |
| web data | a WebView2 user data folder (or WebKit store) per Global, Space or Site store, on this device only; session cookies given a 400-day expiry | `web_stores.rs`, `web_cookies.rs`, `web-tab/web-data.ts` |
| web notes | a `.url` file (`URL`, which follows the reading two seconds after it settles, `Title`, `Nib-Added`, `Nib-Home`, `Nib-Icon` as a `data:` PNG); syncs as a small note and is never in a room; the scroll and the trail stay on the device (`nib:web-places`) | `web-tab/shortcut.ts`, `web-tab/keep.ts`, `web-tab/place.ts` |

### Every road to a second file, or to lost work

Read off the code on main at d4f88dc9. Each is a case the design below has to close, and
the tests in section 12 name them.

1. **Two devices edit a note while apart.** The pull finds the file moved and the account
   moved (`mirror.ts:410`, `diverged`) and, under the default rule, writes
   `Plan (from another device 2026-09-30).md` (`mirror.ts:494`). The same happens on a
   push that is refused with 409 (`keepBoth`, `mirror.ts:933`). The file has no common
   ancestor text, only its hash, so nothing finer than a whole-file choice is possible.
2. **The app was closed while its room moved on.** The device comes back with a file and no
   Yjs history, so `meeting()` answers `apart` whenever both sides wrote, and the rule
   writes a copy (`rooms/apart.ts:74`). This is the case `collaboration.md` calls "the one
   place this is coarser than character-by-character merging", and it is the common one:
   laptops get closed.
3. **The account keeps a copy of its own.** A room about to settle over a version it never
   saw writes that version beside the note on the server (`room.ts:827`, `keptBeside`,
   `notes.ts:191`, `noteBeside`).
4. **Two devices create the same name.** An offline `Untitled.md` on each, or the day's
   note a shortcut appends to, made on laptop and phone: the second create gets 409, is
   paired with the first as if they were one note (`mirror.ts:867`), and differing words
   become a conflict copy.
5. **A delete wins over edits nobody saw.** A pull that sees a tombstone deletes the local
   file without asking whether it was written in since the last pass (`mirror.ts:327`),
   and `delete_note` is `fs::remove_file` (`notes.rs:148`): no trash, no snapshot, so words
   typed offline into a note another device deleted are gone for good. This one is worth
   fixing in v1 now, not only in v2: skip the delete when the file no longer reads as the
   tracked hash, and let the push create it again. The other direction: a push that finds a
   file missing deletes the note on the account without asking whether another device wrote
   in it meanwhile (`mirror.ts:730`); that one lands in Recently deleted. **Fixed in v1
   since:** `deletedThere` in `sync/pass.ts` keeps an edited file for the push and sends an
   unchanged one to the device trash with a version, and a space deleted elsewhere goes to
   the device trash too.
6. **An offline rename loses the note's identity.** `movedHere` only runs online. Offline,
   the next pass reads the rename off the folder as a create (new id, history gone) and a
   delete; if another device edited the note meanwhile, the delete takes those edits into
   Recently deleted and the renamed file carries the old words.
7. **A storage that filled up.** `localStorage` holds five megabytes, the mirror is about
   130 bytes a note, and when it will not fit the caches are thrown away (`sync.svelte.ts:852`,
   `withoutCaches`), which the pass then has to tell apart from a stranger's folder.
8. **Slow news widens every window.** A closed note changed on one device reaches another
   in 20 s to 10 min (`backoff.ts:5`), so two online devices behave like offline ones.
9. **Space columns written whole.** Bookmarks, icons, folder icons, the manual order, graph
   settings and exclusions are written as one value (`spaces/columns.ts`); two devices
   changing different entries lose one of them.
10. **Canvas cards.** A card's text is one field, last writer wins (`packages/rooms/src/plane.ts`),
    so two edits of one card while apart keep one.
11. **Attachments do not travel.** A recording, a dropped file, or a picture pasted while
    signed out is an embed that is broken on every other device.
12. **Files changed by other programs** (Obsidian on the same folder, a `git pull`) are only
    seen at the next pass, as local edits; if the account moved too, that is road 1.
13. **Web logins do not travel at all.** Only the `.url` file syncs. Each computer signs in
    to every site on its own, and the store choice per space is itself per device.

Roads 1 to 6 are what Emil means by random merge-conflict files. They share one cause: the
device keeps a hash of the common ancestor, not the ancestor, and not the history that
would let two sets of edits be merged. Everything in section 5 follows from fixing that.

---

## 2. What others do

### Note apps

**Obsidian Sync** merges markdown with Google's diff-match-patch, merges JSON settings by
key, and uses last-modified-wins for everything else, canvases included. Its own help
admits the merge "may sometimes create duplicate text or formatting problems", and since
1.9.7 a device can choose conflict files instead, named `note (Conflicted copy device
YYYYMMDDHHMM).md`, holding the local version while the note keeps the remote one
([Obsidian][obsidian]). The forum is the other half: a merge that "overwrote newer data for
old" or "duplicates both old and new data within the same note", notes whose first lines
appear two or three times, and daily notes created on two devices with the template's
fields doubled ([forum 1][ob-robust], [forum 2][ob-dup], [forum 3][ob-daily]). Staff answer that merge plus history is the
choice. **Lesson:** a merge without a real common ancestor duplicates text; the daily note
is the classic collision; history is the right safety net.

**Apple Notes** uses CRDTs, reverse-engineered as "topotext" for text and an ordered set of
row and column ids with a map of cells for tables, with iCloud serialising the merges
([HN][apple-hn], [notesutils][apple-notes]). Nobody sees a conflict. **Lesson:** a CRDT
behind a serialising server is what "it just works" is made of.

**Bear** on CloudKit never merges: "Bear will display all affected versions in the Note
List so you can review and pick which one to keep", and conflicted notes jump above pinned
ones ([Bear][bear]). **Lesson:** safe, and exactly the chore Emil does not want.

**Notion** made pages available offline in 2025 by migrating them "to our new CRDT data
model for conflict-resolution", only for pages marked offline ([Notion][notion]).
**Lesson:** even a block-model product needed a CRDT once edits could be made apart.

**Craft** runs its own operation-based protocol ([Craft][craft-proto]) and still tells
people that "in rare cases ... a part of a document can be overwritten" ([Craft
offline][craft]). **Logseq**'s file sync was notorious for conflicts; its database version
syncs transactions over a socket and rebases pending local transactions on remote ones
([Logseq][logseq]).

**Standard Notes** keeps every differing copy ("conflicted copy"), which users describe as
a list filling with copies during server trouble ([Standard Notes][sn]). **Joplin** copies
the local version into a Conflicts notebook and overwrites the note with the remote one,
and does no merging at all ([Joplin][joplin]); its tracker has users with every note in
Conflicts ([Joplin forum][joplin-all]). **Dropbox** and **Syncthing** write `conflicted
copy` and `.sync-conflict-<date>-<time>-<device>` files, and the older file is the one
renamed ([Dropbox][dropbox], [Syncthing][syncthing]). **Lesson:** this row is the product
nib must not be.

**Google Docs** serialises everything through a server with operational transformation;
**Figma** serialises through a server with last-writer-wins per property and says text
"will be either AB or BC but never ABC"; both are in `collaboration.md`. **Linear**'s
engine asks for everything after the last sync id, applies it, "then rebases its own
queued writes on top", last writer wins per field ([Linear][linear]). **Replicache** does
the same "git-style rebase": rewind to the last server version, apply the patch, replay
pending mutations ([Replicache][replicache]). Neil Fraser's **Differential
Synchronization** keeps a shadow of the last agreed text on both sides and exchanges
diffs, relying on a fuzzy patch ([Fraser][diffsync]). **Lesson:** keep what the server
confirmed apart from what is pending, and rebase the second on the first.

### CRDTs for text

**Yjs** is already nib's engine for rooms (`collaboration.md` has the reasoning): runs of
typing are one item, deleted content is discarded under garbage collection, and "the deleted
set size in a snapshot is only 4.5Kb" for a 260,000-operation trace ([Yjs
internals][yjs-internals]). **Automerge 3** (July 2025) now keeps its columnar format in
memory and cut memory "by over 10x", Moby Dick from 700 MB to 1.3 MB ([Automerge][am3]).
**Loro** has shallow snapshots "70-90% smaller" and a movable-tree CRDT ([Loro][loro]).
**Eg-walker** and **diamond-types** keep an event graph and build CRDT state only to merge
([Eg-walker][eg]).

**Decision: Yjs, everywhere.** It is in the bundle, the Worker and the tests already; the
binding to nib's shared document exists (`rooms/bind.ts`); the deleted-set cost is small;
and a second library would be a second format on disk for years. Loro's movable tree was
the one real temptation, for the file tree, and the tree is better served by the account
serialising operations (section 5.9) than by a tree CRDT, because the account is the one
place every device already agrees on.

**Seeding one document on many devices.** Two devices inserting the same text into two
empty Yjs documents make two different documents, and merging them duplicates the text;
the cure is to make the seed once and hand the same bytes to everybody
([Buesing][yjs-seed]), or to derive the seed's client id from a hash of the content so
two devices produce byte-identical updates that Yjs merges into one ([OpenCloud][oc-seed]).
Section 5.3 uses the second.

### Three-way merge

`diff3` merges two texts against their common ancestor and marks overlapping hunks as
conflicts; diff-match-patch diffs characters with a semantic cleanup and applies patches
fuzzily. nib needs both halves: a character diff to turn a file into operations
(`diff-match-patch-es`, maintained, Apache-2.0), and a three-way analysis to decide
whether two sets of edits overlap. Fuzzy patching is what duplicates Obsidian's text, so it
is not used: operations go through the CRDT, and the three-way analysis only decides
whether to ask.

### Browser state

**Chrome sync does not sync cookies**: download history, cookies and search terms stay on
the machine ([Chrome help][chrome-sync]). **Arc Sync** is end-to-end encrypted and syncs
spaces, folders and tabs, and profiles (which scope logins and cookies) do not sync
([Arc][arc]). Edge, Firefox and Opera sync bookmarks, passwords, history and tabs, never
sessions. **Ferdium, Station, Shift, Rambox and Wavebox** partition sessions per service
and keep them on the machine; moving computers means signing in to every service again
([comparison][ferdium]).

The products that do move sessions are **cloud browser profiles**. GoLogin syncs "cookies,
local storage, and extensions" when a profile is closed, and warns that "only one of the
concurrently launched profiles can be synced" ([GoLogin][gologin]). Multilogin shows an
"Active session lock" when a profile runs on another device, with Unlock to take it over,
and a profile that crashed leaves a stale lock that somebody has to unlock by hand
([Multilogin lock][multilogin]). **Lesson:** the lock is the right idea, sync-on-close loses a crash's
work, and a lock without a lease is a lock somebody has to break by hand.

**WhatsApp Web** is the UX role model: "WhatsApp is open in another window. Click Use here
to use WhatsApp in this window", and pressing it ends the other session
([whatsapp-web.js][whatsapp]). Spotify Connect moves playback between devices the same way.

**Why the lock is not optional.** Many sites rotate refresh tokens. RFC 9700 describes the
server's side: "If a refresh token is compromised and subsequently used by both the
attacker and the legitimate client, one of them will present an invalidated refresh token
... it will revoke the active refresh token" ([RFC 9700 §4.14.2][rfc9700]). Two computers
running one copied session look exactly like that, and the site signs both out. Google
goes further with **Device Bound Session Credentials**, generally available in Chrome on
Windows since Chrome 146 (April 2026): the session is bound to a TPM key, so a copied
session cannot refresh on another machine at all ([Google][dbsc]). And a cookie database
cannot be copied between machines in the first place: Chromium encrypts cookies with a key
protected by DPAPI on Windows (app-bound since Chrome 127) and by the Keychain on a Mac
([app-bound][appbound], [DPAPI][dpapi]).

**What an engine will hand out.** The DevTools Protocol, which WebView2 exposes through
`CallDevToolsProtocolMethod` and CEF through `ExecuteDevToolsMethod`, can read and write
cookies with their partition key (`Storage.getCookies`, `Storage.setCookies`) and
localStorage (`DOMStorage.setDOMStorageItem`), but can only **read** IndexedDB and Cache
Storage (`IndexedDB.requestData`, `CacheStorage.requestEntries`; there is no put)
([CDP][cdp]). WKWebView has `WKHTTPCookieStore` and `interactionState` (the back-forward
list with scroll and form state, macOS 12+) ([Apple][interaction]). WebKitGTK has
`webkit_cookie_manager_get_all_cookies` and `replace_cookies` since 2.42 ([WebKitGTK][gtk-cookies]).

### Locks and leases

A lease is a lock with an expiry that the holder keeps renewing: Chubby's sessions,
etcd's leases, and Kubernetes, where the kubelet's heartbeat is an update to a Lease
object and leader election defaults to 15 s leases renewed every 2 s ([Kubernetes][k8s-lease],
[defaults][k8s-defaults]). Kleppmann's point is the one that matters here: a holder can
pause past its lease and still write, so the store must check "a number that increases
... every time a client acquires the lock" and "reject any writes on which the token has
gone backwards" ([Kleppmann][fencing]). And every timing decision belongs to one clock: the
lock service's, never the clients'.

On Cloudflare, a hibernating WebSocket can answer an application-level ping without waking
the Durable Object (`setWebSocketAutoResponse`), and the runtime keeps
`getWebSocketAutoResponseTimestamp(ws)`, "the most recent Date on which the given WebSocket
sent an auto-response" ([Durable Object state][do-state]). That is a heartbeat and a
liveness clock that cost nothing while nobody asks.

---

## 3. Principles

The promise, in one sentence: **nothing anybody writes is lost, nobody is handed a file to
sort out, and the one question nib ever asks is asked only when two people really wrote two
different things in the same place.**

- **Merge by default, ask by exception.** Silence is the normal outcome of every sync. The
  modal is reserved for overlapping rewrites, and has three answers.
- **The history is the safety net, not the file list.** Everything that loses a merge is a
  version on the device and on the account. A second file exists only when somebody chose
  Keep both.
- **Ask where the person is looking.** The modal appears when the note is on screen, never
  over another note while somebody types.
- **The account is the one clock and the one order.** Leases, fences and tree operations
  are decided by the account's arrival order; a device's clock decides nothing.
- **Say nothing that does not help.** The corner light, one mark on a held note, one lock
  surface, one modal, one approval prompt. No settings for conflict rules.
- **A web login follows the person, not the machine.** It is where you last used it, and
  only one computer holds it at a time, as with WhatsApp.
- **Fast is part of correct.** Nothing at launch before the first paint, nothing per
  keystroke that grows with the note, one socket per device.

---

## 4. What the reader sees, case by case

### Notes and files

| case | what happens | on screen |
| --- | --- | --- |
| one device, online | written to disk 1.2 s after typing stops (autosave), sent to the account at the same moment | the light, nothing else |
| two devices, both online, same note | live, keystroke by keystroke, as rooms do today | the other device's caret and dot |
| two devices online, different notes | the other device's change arrives within about a second (a poke) | the file list and any open tab update in place |
| offline for an hour or a week | every edit is kept on the device as the file and as CRDT updates; nothing is asked while away | the light is hollow (offline), never red |
| back online, the account did not move | pending edits go up | nothing |
| back online, both wrote, different places | merged character by character | nothing; each merge is a version in the history |
| both fixed the same typo | identical edits count once | nothing |
| both changed the same word differently (a small overlap, up to 80 characters in all) | the newer edit wins that span, the older is a version | nothing |
| both appended to the same list or day's note | both kept, in a stable order | nothing |
| both rewrote the same sentence or paragraph (overlap above 80 characters), or one deleted a paragraph the other rewrote | **the note is held on this device** and not sent | a mark on the row; the modal when the note is on screen |
| one deleted a note, the other edited it | the edit wins; the note comes back where it was | a toast on the device that deleted it |
| one renamed or moved it, the other edited | both hold: identity is the id | nothing |
| both renamed it | the later rename wins | nothing |
| both created `Untitled.md` | two notes: `Untitled.md` and `Untitled 2.md` | the second device's row renames itself |
| both appended to a day's note that did not exist yet (a shortcut, the append action) | one note, both lines kept | nothing |
| a file edited by git or another editor | merged three-way against what nib last wrote | nothing |
| the app crashed | at most the last 1.2 s of typing is lost, as with any autosave; everything written is resent | nothing |
| a picture, recording or PDF added | uploaded once by content; other devices fetch it (large ones when opened) | the embed draws |
| the same picture file replaced on two devices while apart | cannot merge: the modal, when opened | as below |

**The divergence modal.** A sheet over the note, in the existing sheet shape
(`.nib-layer`, the scrim, `--dur-*`), with the note's name as its title and two cards side
by side, each a version:

```
                         Plan
 ┌───────────────────────────┐ ┌───────────────────────────┐
 │ This Laptop       10:42   │ │ iPhone            09:15   │
 │                           │ │                           │
 │ ...the passage as it      │ │ ...the same passage as    │
 │ reads here, the words     │ │ it reads there, the words │
 │ that differ marked...     │ │ that differ marked...     │
 │                  [ Keep ] │ │                  [ Keep ] │
 └───────────────────────────┘ └───────────────────────────┘
                       [ Keep both ]
```

Exact copy, and nothing else: the title is the note's name; each card is headed by a
device name (`This {device}` for this one) and the time of its last edit through `when()`;
the excerpt is the first contested passage from each side with the differing words in the
highlight ink; the buttons are **Keep**, **Keep**, **Keep both**. Escape, or a press on the
scrim, closes it and changes nothing: the note stays held and asks again next time it is on
screen. The keyboard: Left and Right move between the cards, Enter keeps the focused one.

What each answer does, in Emil's words:

| Emil's option | button | the note | the other version |
| --- | --- | --- | --- |
| overwrite | Keep on this device's card | this device's text everywhere | a version on the account, named after the other device |
| keep cloud version | Keep on the other card | the account's text everywhere; this device's pending edits dropped | a version on this device and on the account, named after this device |
| save as copy / keep both | Keep both | the account's text keeps the name | this device's text becomes `Plan (Laptop).md` beside it, opened in a tab next to the note |

For a canvas or a page note the excerpts are two small renders of the contested cards. For
a binary file they are the two files' names, sizes and times (and thumbnails for pictures).

A held note's row wears one mark: two overlapping squares in the muted ink, the shape
`SharedMark.svelte` uses for its own mark. The Sync pane's waiting list becomes the list of
held notes; a press opens the note, which opens the modal.

**The delete toast.** On the device that deleted a note someone else edited:
`{name} is back: {device} was writing in it`, with the usual undo toast's shape and
lifetime. (One row in every catalogue.)

**What goes away.** The `Sync` pane's conflict rule (Keep both copies / Let the newest win
/ Ask me each time) and `Plan (from another device ...)` names. A v1 app still makes them
(section 11).

### Web notes

| case | what happens | on screen |
| --- | --- | --- |
| open a site nobody else is using | the lease is taken silently, the latest state is already here (prefetched) or restored first | the page |
| open a site another device is using right now | nothing loads | the lock surface |
| press **Use here** | the other device captures its latest state, uploads it, freezes its pages of that site; this device restores it and loads | the page, a moment later |
| the other device's person stops using it (5 min without input) | its lease turns idle; this device takes it without asking, after the other hands over its latest state | the lock surface lifts by itself if it was up |
| the other device's lid is shut | 30 s later its lease is free | the same |
| the other device crashes or loses power | 30 s after its last heartbeat the lease is free; the state is its last upload (at most two minutes old) | the lock surface lifts by itself |
| come back to the device that lost it | it asks for the lease again: taken without asking if free, the lock surface if in use | the page reloads with the newer state if another device used it meanwhile |
| a new computer | pages work but signed out until an existing computer approves it once | on the old computer, the approval prompt |
| offline | the page opens with this device's own state, no lease is needed; when back, the newer state wins | nothing |
| a phone | web notes open in the phone's browser, as today; no web state travels to phones | nothing |

**The lock surface.** Over the pane, centred, on the page's last still picture dimmed (or
the plain pane when there is none): the site's mark, then one line, then one button.

```
            [site mark]
         Open on Laptop
           [ Use here ]
```

Exact copy: `Open on {device}` and `Use here`. The device that loses the lease shows the
same surface naming the device that took it. While a handover is running the button shows
its pressed state and the page follows as soon as it lands. (Two rows in every catalogue.)

**The approval prompt** on a computer that already holds the key, as a small layer at the
top right, the shape the site-permission bubble uses:

```
   Desktop wants your web logins   482 913
                     [ Don't allow ]  [ Allow ]
```

and on the new computer, where the pages are, a quiet line in the web tab's bar area:
`Waiting for Laptop  482 913`. The six digits are derived from the new computer's public
key; they must match on both screens. (Three rows: `{device} wants your web logins`,
`Waiting for {device}`, and the existing `Don't allow` / `Allow`.)

---

## 5. Notes: the architecture

### 5.1 A CRDT per document, kept on every device

Every markdown note, canvas and page note in a synced space has a Yjs document on every
device that holds the space, persisted in the device's sync store (section 9.2), and on the
account in the note's Durable Object (the existing `NoteRoom`) with a snapshot in R2. The
file on disk is the document's projection: nib writes it whenever the document changes and
autosave's pause has passed, exactly as it writes today.

What this changes, in one line: **a room is no longer something a note is in while two
devices have it open; it is the note's home, and a device that is offline is a device whose
socket to it is down.** The binding between the editor's shared document and the Yjs text
is the one that exists (`rooms/bind.ts`). The fold-on-join (`rooms/join.ts`, `apart.ts`)
disappears, because a device never arrives holding only a file any more: it arrives holding
the document it edited.

The markdown on the account (`notes` row, R2 body) stays the canonical *read* form:
publishing, the connector, the glasses, search, `nib-sync.mjs` and the versions read it,
and the room's settle writes it exactly as today. The Yjs document is the canonical *merge*
form.

### 5.2 Confirmed and pending

Per note, a device keeps two things:

- **confirmed**: the document as the account has acknowledged it (an encoded Yjs update) and
  its state vector;
- **pending**: the updates this device made that the account has not acknowledged.

The live document is confirmed plus pending. Updates arriving from the account (over the
socket, or in a pull) are applied to both. On an acknowledgement the account names the
state vector it has made durable, and whatever pending that covers moves into confirmed.
This is Replicache's rebase and Differential Synchronization's shadow, with the CRDT doing
the replay: nothing has to be re-executed, because Yjs updates commute.

**Write order, which is the crash story.** A keystroke goes into the live document, into
the socket if it is up, and into the pending buffer in memory. On autosave's pause the file
is written and the pending buffer is appended to the store in one transaction. On an
acknowledgement confirmed moves on. After an unclean exit (the store's `clean_exit` flag
was not set) a document's Yjs client id is rotated before anything new is typed, because
the account may hold operations under the old id that the store never received; reusing
the id would create two different operations with one name. Otherwise a device reuses one
client id per note, so a state vector stays one entry per device rather than one per
session for years.

**Acknowledgement is batched with the settle.** The room does not write to storage per
keystroke (that was measured and removed); it acknowledges at the settle, after the
snapshot is durable. A device therefore holds a few seconds of pending while typing live,
which costs nothing and survives a lost socket: pending is resent, and Yjs ignores what it
already has.

### 5.3 The seed and the epoch

A note gets its document in one of two ways. A note made by v2 is a document from its first
character. A note that already exists, or that a v1 client, the connector or a rollback
wrote as text, is **seeded**: an empty document into which the text is inserted in one
operation, in a transaction whose client id is `hash32(noteId, epoch)`. Two devices seeding
the same text for the same note and epoch produce byte-identical updates, which Yjs merges
into one ([OpenCloud][oc-seed]). The client id is used for the seed and never again. Texts
are seeded, hashed and compared with line endings as `\n`, which is how the editor holds
them; a file keeps its own endings on disk (`as_written` in `src-tauri/src/notes.rs`).

The account records per note `epoch` (0 means no document yet) and `epoch_base` (the hash
of the text the epoch was seeded from). Migration (section 11) marks every note of a space
epoch 1 with its current body's hash in one statement, and the room seeds itself the first
time it wakes; a device whose file already reads as `epoch_base` builds the same document
without downloading anything.

**Once a note has an epoch, its room is the only thing that writes it.** A v1 push, the
connector, a rollback and `nib-sync.mjs` all hand their text to the room's `ingest` instead
of calling `saveNote` themselves. So the room always wakes and seeds from the body
`epoch_base` names before anything changes that body, and nothing has to keep old bodies
around for seeding.

A new epoch is rare and deliberate: a document found corrupt, one past its ceiling, or an
operator reset. The room closes its sockets with code 4001, devices on the old epoch
cannot merge operations into the new one, and so they fall back to the three-way path
(section 5.5) with their confirmed text as the ancestor, which is exactly what it is.

### 5.4 When a merge is silent, and when it asks

Only one device ever asks, and it is the one whose edits arrive second. When a device sends
pending updates it names the confirmed state vector they were made on. If the account has
moved past it, the account answers `moved` with what the device is missing instead of
applying them. The device then has three texts:

- **B**, the ancestor: its confirmed document as text;
- **L**, local: confirmed plus pending;
- **R**, remote: confirmed plus what the account sent;

and computes **M**, the CRDT merge of both, in a scratch document. The classifier
(`@nib/sync/diverge`) diffs B to L and B to R at character level with semantic cleanup, in
B's coordinates, and looks at the edits that meet:

- **Identical edits** (same span, same replacement) count once. Both fixed the typo. The
  CRDT would keep both insertions (`thethe`), so the second copy is removed from M as part
  of what the device sends.
- **Pure insertions at the same point** are not a conflict: both are kept, in the order Yjs
  gives, which is the same on every device. Both appended to the list.
- **Overlapping edits**: spans that intersect, or an insertion strictly inside a span the
  other side replaced. Their size is the characters of both replacements plus the ancestor
  text they cover.

The verdict:

| verdict | when | what the device does |
| --- | --- | --- |
| `clean` | no overlapping edits | sends pending, applies R. M is the note |
| `minor` | overlapping edits of **80 characters or fewer in all**, and no block deleted on one side and edited on the other | for each overlap, the newer edit's text stands (pending updates carry the time they were made; the account's carries `updated_at`), expressed as operations on M; sends pending plus those operations |
| `diverged` | any overlap above 80 characters; or a paragraph, list item, heading, fenced block or table row deleted on one side and edited by more than 16 characters on the other; or M breaks a structure both L and R kept (front matter that no longer parses, a code fence left open) | **holds the note**: applies nothing, sends nothing, marks the row; the modal when the note is on screen |

Eighty characters is about a sentence: a word or two changed on both sides merges quietly,
a sentence written two ways asks. It is one constant, `CONTESTED`, and an open question
(section 14).

The account never classifies. It applies what a device sends once that device says which
state it checked against (`checked`), and refuses again if it has moved since, so two
devices returning at once cannot both be second: whichever lands first is first, and the
other checks against it.

Live sockets never go through this. Keystrokes exchanged while both devices are connected
were seen as they happened, and a connected device applies what the room forwards even
with a few seconds of its own typing still pending. The check runs at exactly two moments:
an HTTP push answered `moved`, and a socket opening while the device holds pending edits.
In the second case the device opens with sync step 1 carrying its **confirmed** state
vector, classifies what the room sends back, and only then sends its pending edits (or
holds the note and stays out of the room, reading nothing into the document, until the
modal is answered).

**The three answers**, precisely:

- **Keep (this device)**: apply R to the live document, then the operations that turn M's
  text into L's (`@nib/sync/textops`, a character diff to Yjs operations), and send pending
  plus those, checked against R's state. Every device ends at L. R is a version.
- **Keep (the other device)**: drop pending (it was never sent), set the live document to
  confirmed plus R. L is written to this device's history first and pushed to the account as
  a version (`POST /v2/docs/keep`), so any device can put it back.
- **Keep both**: as the previous, and a new note is created from L at `Name (Device).md`
  beside the original (numbered if taken), with a fresh document.

An answer is carried out against what the account holds when it is given, not when the
modal was drawn: the device pulls first, so words another device added in the meantime are
kept by Keep (the other device) and Keep both, and are a version under Keep (this device).

### 5.5 Files edited by other programs

Space folders are watched (`notify`: ReadDirectoryChangesW, FSEvents, inotify), debounced,
and read once in full after each launch in the background. Each file's last write by nib is
known (hash, size, modification time, file identity). A file whose hash is not nib's last
write was changed by something else. Its new text F is folded in as a three-way merge:

- ancestor: the text nib last wrote or read (kept as the store's `written` for that note);
- theirs: F;
- ours: the live document's text now (which may have moved since, from the account).

If ours is still the ancestor (the common case: nib was closed, or nobody else wrote), the
change is simply `textops(ancestor, F)` applied as this device's operations. Otherwise the
classifier above runs with B = ancestor, L = F, R = ours, and a `diverged` verdict holds the
note with the same modal. After a `git checkout` of another branch this is many notes at
once; they are processed in the background, a hundred a tick, never on the UI thread.

A file created by another program is a create; one removed is a delete; one moved (same
file identity, new path) is a move. File identity is the volume and file id on Windows
(`GetFileInformationByHandle`) and the device and inode elsewhere; a move across volumes
is recognised by hash against what was deleted in the same scan.

With `no-local-files` shipping, nib opens nothing outside a space, so `watch.svelte.ts`'s
clash for outside files is retired and this is the only road for foreign edits.

### 5.6 Canvases and page notes

A canvas is already a Yjs map of objects by id (`packages/rooms/src/plane.ts`), merged
object by object and field by field, and it becomes a persisted document exactly like a
note. One change: a card's `text` becomes a `Y.Text` inside its map instead of a string,
so two edits of one card merge like prose (road 10). The file format does not change: the
settle still writes what `format.ts` writes, byte for byte.

The classifier for a plane: objects changed on both sides in the same field are overlaps;
geometry and colour resolve silently to the newer; card text uses the note classifier on
the card; a card deleted on one side and its text edited on the other is `diverged` above
16 characters. The modal is the same, with the two versions of the contested cards drawn.

### 5.7 Web note files

A `.url` file has no words anybody writes; its `URL` follows the reading. It is synced as a
small last-writer-wins document: pushed whole, no ancestor check, no modal, the account's
arrival order decides, and the loser is a version. In practice the device holding the site's
lease is the only writer.

### 5.8 Attachments and every other file

Every file in a space that is not a note, canvas, page note or `.url` is an entry of kind
`file` in the tree with a hash and a size, and its bytes are a blob addressed by that hash
(the existing `blobs` table and R2 `blobs/<hash>`, per account, counted against the owner's
quota as today). Nothing merges: a replacement is a new hash, last writer wins by arrival,
the old hash stays a version for 30 days. Two devices replacing one file while apart is
`diverged` and asks, when the file is opened.

Down: a file up to 8 MB is fetched as soon as it is listed; a larger one is listed with a
cloud mark and fetched when opened or embedded on screen (the `evicted` shape iCloud notes
already use, `notes/icloud.rs`). Up: blobs up to 64 MB in one request, larger in 8 MB
parts through R2 multipart. The folder-local copies of pasted pictures (signed out) become
ordinary files and travel.

Serving a blob to anybody but its owner goes through the space: `GET /v2/files/:space/:id`
checks membership, where `/i/:hash` stays for published pages.

### 5.9 The tree

Folders become rows with ids. A note's place is `folder_id` and `name`; `path` stays as a
column the account derives and keeps current, because publishing, the connector and
`nib-sync.mjs` read it. Operations name ids, carry an operation id (idempotent) and the
space cursor the device had seen (`seen`):

| op | fields |
| --- | --- |
| `mkdir` | id, parent, name |
| `create` | id, kind, parent, name, (hash for a file), (`mergeable` and the text it started from) |
| `rename` | id, name |
| `move` | id, parent, (name) |
| `delete` | id |
| `restore` | id |

The account applies them in arrival order and answers each with the result (final name and
parent, or a refusal), and devices apply the account's feed the same way, so every device
converges on the account's order. The rules, all in `@nib/sync/tree` and shared by the
Worker and the client (which applies its own ops optimistically):

- **Names are unique per folder, case-insensitively and after NFC normalisation**
  (`name_key`), because Windows and macOS folders are. A create, rename or move into a
  taken name is numbered like the file list numbers a duplicate (`Plan 2.md`), and the
  device renames its own file to match.
- **Two creates of one day's note merge.** Some creates mean "this note, made if it is not
  there yet": the append action (`appendNote` in `automation/acts.ts`, which shortcuts and
  `nib://` links use to add a line to the day's note) and, when it exists, a journal
  command. Those carry `mergeable` and the text they started from (empty, or a template).
  A mergeable create landing on a live note of the same name in the same folder answers
  `merged` with the existing id; the device merges its document into that note three-way
  against the text both started from, and drops its own id. Two appends are two pure
  insertions, so they merge silently; two people rewriting the same line of the day asks.
  Every other create keeps its own identity and is numbered.
- **An edit beats a delete.** A `delete` whose note has content changes after `seen` is
  refused as `edited`, and the device that deleted it puts it back (the toast). A folder
  delete takes what the device had seen; anything created or edited in it since survives
  and keeps the folder.
- **A move or create into a deleted folder brings the folder back** (with its ancestors).
- **A move that would put a folder inside itself** (two concurrent moves making a cycle) is
  refused as `cycle` and the device undoes it locally. Kleppmann's move operation for trees
  solves the same problem inside a CRDT ([move-op][move-op]); with the account serialising,
  refusing the second is enough.
- **Rename against rename**: the later wins.
- **A name one platform cannot hold** (`CON`, `a:b`, a trailing dot on Windows) is kept on
  the account as written and mapped to a safe local name in the device's store, so the
  account never sees the local spelling.

Folder icons, colours and the manual order become keyed by folder id, so a rename no longer
orphans them.

### 5.10 Live rooms, and what the file sync used to do

The room keeps everything it does today (sockets, awareness, carets, hibernation, the
settle, the door, read-only sockets) and gains four things: it is reachable by HTTP for
devices without a socket (`push`, `pull`); it writes each HTTP push durably before
answering; it writes an R2 snapshot at every settle so pulls never wake it; and it
acknowledges at the settle. Every note has a room whether or not anybody has it open,
because the room is simply where its document lives; a room nobody has touched is a
Durable Object that does not exist yet.

The pass shrinks to the tree and the documents the feed names (section 7), and the whole of
`join.ts`, `apart.ts`, `conflicts.ts`, the `keptBeside` and `noteBeside` copies, `offered`,
`dropped`, `held` and the `nib:mirrors` blob go (after the v1 fallback is retired).

### 5.11 Space and account settings

Bookmarks, space icon and colour, folder icons, the manual order, graph settings and
exclusions become **maps with a timestamp per entry** instead of whole values: a device
sends the entries it changed, and the account keeps, per entry, the one that arrived last.
The manual order uses fractional positions per item (Figma's approach, in
`collaboration.md`), so two devices reordering different items both keep their moves.
Account settings (`users.settings`) are merged per key the same way. The routes accept the
old whole-value writes from v1 clients and read them as "every entry changed".

### 5.12 Pokes, not polling

Every device keeps one socket to its account's hub (section 6.2). After any write that moves
a space's cursor (a push, a settle, a tree op, a blob list), the Worker tells the hub of every
account that can reach the space (the owner, members, guests: one query) and the hubs poke
their devices: `{space, seq}`. A poked device runs a pass for that space at once. Polling
stays as the fallback at a fixed 5 minutes, and a device whose hub socket is down polls at
today's cadence.

### 5.13 In the autosave-only world

- A new tab becomes a file on its first character (agent `autosave-only`). In v2 that
  moment also makes the note's id on the device, a new document, and a queued `create`.
  There is no waiting for the account to hand out an id, so the note can be live the moment
  the device is online.
- The name follows the first line while it is being typed; renames queue as `rename` ops and
  the outbox coalesces them, so a title typed in ten seconds is one rename (or folds into the
  `create` if it has not gone yet).
- There is no dirty state, so nothing ever refuses to take the account's words into an open
  note (`sync.svelte.ts` `refresh` goes). Ctrl+S is a flush, and v2 makes it a push as well.
- Web tabs are ephemeral until kept. The lease is about the site session (section 6.1), so
  an ephemeral tab on a site is covered exactly like a web note, and keeping it as a
  `.url` changes nothing about the lease.

---

## 6. Web notes: the architecture

### 6.1 What is locked: a site session

Emil asked for a lock on a web page. The thing that must not run on two computers at once
is a **login**, and a login belongs to a site in a web store, not to a note: a Gmail note
and a Calendar note in the Global store are one Google session, and running it on two
computers is two clients presenting one refresh token (section 2). So the lease key is
**(account, store, site)**:

- **store**: the store the page is in, named as `web-data.ts` names it (`global`,
  `space_<id>`, `site_<id>_<site>`);
- **site**: the registrable domain of the page's top-level address (`siteOf`, public suffix
  list), which is already where nib draws the line between strangers.

Every page of that site in that store on a device, whether a web note or an ephemeral tab,
needs the lease; one device holds it for all of its tabs. Opening a Calendar note while the
Gmail note is in use on the laptop shows `Open on Laptop`, because it is. With the idle rule
below this is rare: people use one computer at a time.

The store choice (`Global`, `Space`, `Site`) moves from the device (`nib:web-data`) to the
space on the account, so every computer puts a space's pages in the same store and the same
logins follow it (open question 3).

### 6.2 The lease protocol

**Where it lives.** One Durable Object per account, `AccountHub`, named by the account id,
SQLite-backed, with hibernating WebSockets: one socket per signed-in device (desktop,
phone, browser build), carrying pokes (5.12), leases, presence and key exchange. Lease keys
are opaque to the hub: `HMAC(webKey, store + "\n" + site)`, so the server never learns which
sites anybody is logged in to.

**Heartbeat.** The device sends the text frame `beat` every 10 s; the hub has
`setWebSocketAutoResponse(beat, ok)`, so beats never wake it. A device is **alive** while its
socket is open and `getWebSocketAutoResponseTimestamp` is under 30 s old: three missed beats.
A device is **active** while somebody has pressed a key or moved the pointer in nib within
the last 5 minutes, or a page of the site is playing sound; the device says `active` and
`idle` on transitions only.

**States of a lease**, judged only on the hub's clock:

| state | meaning |
| --- | --- |
| free | nobody, or a holder that is not alive |
| held, active | the holder is alive and active |
| held, idle | the holder is alive and idle |

**Messages** (JSON text frames; section 7 has the full shapes):

| from device | meaning |
| --- | --- |
| `acquire {key, take}` | I want this site. `take` is true after Use here |
| `release {key, version}` | I am done; my last upload is `version` |
| `flushed {key, version}` | the final state you asked for is uploaded |
| `active`, `idle` | my person came back, or went away |

| from hub | meaning |
| --- | --- |
| `granted {key, fence, version}` | it is yours; the newest state is `version` |
| `busy {key, device}` | somebody is using it: show the lock surface |
| `flush {key, fence}` | upload what you have now and stop your pages of this site |
| `lost {key, device}` | it is somebody else's now: stop your pages, show the lock surface |
| `free {key}` | a lease you were waiting on is free |
| `state {key, version}` | a newer state exists (prefetch it when nothing here uses the site) |

**Acquire**, decided by the hub:

1. Free, or already this device's: `granted` with `fence + 1` (unchanged if already held).
2. Held, idle, or `take` is set: a **handover**. The hub sends `flush` to the holder and waits
   for `flushed` up to 10 s (an alarm), then grants with `fence + 1` and sends `lost` to the
   old holder. The holder, on `flush`, captures and uploads with its fence and stops its
   pages of the site, and shows the lock surface.
3. Held, active, no `take`: `busy`. The asking device shows the lock surface and the hub
   remembers it is waiting; when the lease becomes free or idle, the hub sends `free` and the
   device acquires again on its own (the surface lifts if the tab is on screen).

**Losing and coming back.** A device that went idle keeps its lease (so coming back to it is
instant) until somebody else acquires. Whenever it becomes active again, or a hidden tab of
the site comes back on screen, it acquires again: if the answer's `version` is newer than
what it holds, it restores that state and reloads its pages of the site before they run.

**Crash.** Nothing is sent. Three missed beats later the holder is not alive, the lease is
free, and a waiting device is told by the hub's alarm (set at last beat + 30 s whenever
somebody waits). The state is the holder's last upload.

**Fencing.** Every upload names the fence it was made under. The hub refuses an upload
whose fence is lower than the lease's (`409 fenced`), so a device that paused past its lease
(a laptop that slept mid-upload) cannot write over the new holder's state. The fence is a
per-key integer in the hub's storage and only ever grows.

**Clock skew.** Every time above is the hub's. Devices send nothing but frames and version
numbers; their clocks decide only when to send the next beat.

**Offline, or no hub.** A device that cannot reach its hub opens pages on its own state
without a lease; there is nobody to ask, and a page that needs the network will not run
anyway. When it reconnects it acquires; if the fence moved while it was away, the newer
state wins and its pages reload. That window is the one place two computers can run one
session at once, and it is bounded by how long a computer is online to a site but not to
nib.

**Rates.** Acquisitions are limited to 30 a minute per device (a flapping tab), uploads to
60 an hour per site; both are rows in the existing `limits` machinery.

### 6.3 What is captured

"The same way as closing and reopening Chrome" means what Chrome brings back when it
continues where it left off. Each row, and whether it travels:

| state | Chrome keeps it | travels | why |
| --- | --- | --- | --- |
| cookies, including session, HttpOnly, Secure, SameSite, partitioned (CHIPS), priority | yes | **yes** | the login |
| localStorage, per origin | yes | **yes** | tokens and settings live here |
| sessionStorage, per tab | yes, for restored tabs | **yes, for the web note's tab** | forms and wizards mid-way |
| IndexedDB, per origin | yes | **yes, up to 16 MB per database**; larger ones are left and noted | WhatsApp's keys, offline apps; the limit keeps a mail cache from being a hundred megabytes a handover |
| the tab's back and forward trail and scroll position | yes | **yes, for web notes** (`place.ts`) | "the exact same page you had open" |
| zoom per site | yes | **yes** (`sites.ts`) | |
| site permissions nib granted | yes | **yes** (`nib:web-grants`) | asked once, not per computer |
| Cache Storage, service workers | yes | no | the site registers and fills them again on its next visit |
| the HTTP cache | yes | no | a cache |
| Origin Private File System | yes | no, for now | rare; the same page-script route can add it |
| WebSQL | removed from Chromium | no | |
| passwords and autofill | Chrome syncs these | no | Chromium's own under CEF, a separate decision |
| extensions' own storage | no (Chrome syncs it through Google) | no | `browser.md` already says so |

### 6.4 How, per engine

Files cannot be copied: cookie databases are encrypted with a key bound to the machine and
user (DPAPI or app-bound on Windows, the Keychain on a Mac), and origin storage folders are
engine- and version-specific. So everything moves through APIs into a neutral bundle, which
also makes it portable between a Windows WebView2 and a Mac WebKit.

| | WebView2 (Windows today) | WKWebView (macOS) | WebKitGTK (Linux) | CEF (the planned engine) |
| --- | --- | --- | --- | --- |
| cookies out | `Storage.getCookies` over `CallDevToolsProtocolMethod` (has `partitionKey`), filtered to the site | `WKHTTPCookieStore.getAllCookies` | `webkit_cookie_manager_get_all_cookies` (2.42+) | `Storage.getCookies` over `ExecuteDevToolsMethod`, or `CefCookieManager::VisitAllCookies` |
| cookies in | `Storage.setCookies` after `Storage.clearCookies` for the site's domains | `setCookie`, `deleteCookie` | `webkit_cookie_manager_replace_cookies` for the site | `Storage.setCookies` |
| localStorage, sessionStorage, IndexedDB out | a script in an **isolated world** of a page on the origin (`Page.createIsolatedWorld` + `Runtime.evaluate`) | a script in a `WKContentWorld` | a script in an isolated world (`webkit_script_world_new`) | as WebView2 |
| the same in | a hidden restore view in the same store, navigated to `https://<origin>/__nib_restore`, answered with an empty page by `WebResourceRequested`, then the script writes | a hidden view given `loadHTMLString("", baseURL: origin)`, which runs as that origin | `webkit_web_view_load_html("", origin)` | a `CefResourceRequestHandler` answering the restore address |
| sessionStorage in | a document-created script on the tab's first load after a restore, guarded by origin | the same with a `WKUserScript` at document start | a user script | the same |
| trail and scroll | nib's own (`place.ts`) | nib's own (`interactionState` is WebKit-only and opaque, so not used) | nib's own | the engine's back-forward list, restored by navigation |

The dump script walks `indexedDB.databases()`, each store's schema (key path,
auto-increment, indexes) and its records by cursor, and encodes values with a tagged
structured-clone encoding (objects, arrays, cycles by reference, `Date`, `RegExp`, `Map`,
`Set`, `BigInt`, `ArrayBuffer` and typed arrays, `Blob` and `File` as bytes). The restore
script deletes the origin's databases and recreates them at their version with the same
schema and records. Both live in `src-tauri/src/web_state/scripts/`, are the same file on
every engine, and are tested in a headless browser against a corpus of structured-clone
values. Running in an isolated world means the site's own scripts cannot see or alter the
dump.

Sites get what they would get in Chrome after a restart, with three honest exceptions:
sessions bound to an IP address or a user agent may ask for a sign-in on the other
computer (especially Mac WebKit against Windows Chromium); Google sessions bound with DBSC
cannot refresh anywhere but where they were made, so Google asks for a sign-in once per
computer; and a database over 16 MB starts empty and is refilled by the site. In each case
the new sign-in is simply the new state that travels next.

### 6.5 When it moves

**Up**, always as the lease holder, always with the fence:

- on `flush` (a handover) and on `release`;
- when the device goes idle, so the next computer gets the latest without a handover;
- as the window closes or the app quits, inside the close's existing two-second hold
  (which already waits for the session-cookie expiry);
- while active, cookies and localStorage every 2 minutes if their hash changed, and after a
  page load settles (at most once a minute); IndexedDB only on the first three.

At most the last two minutes of cookie changes are lost to a crash, which is the right cost
for state Emil calls not fragile.

**Down**: a device learns of a newer state from `granted` and `state`. It fetches and
decrypts it at once, and applies cookies into its store only while no page of that site is
live on it; storage for an origin is applied the first time the site is opened after the
fetch (before the page loads, with the page's still picture on screen). So opening a site
after using it elsewhere is usually instant: the state is already there.

**The bundle**: a manifest (store, site, fence, engine, time, cookies, localStorage per
origin, the web note tabs' session storage and trail, zoom, grants, and a list of chunks)
plus chunks (one per IndexedDB database), each compressed and then encrypted. A chunk's name
is `HMAC(webKey, plaintext)`, so an unchanged database is never uploaded twice and the
server cannot tell two accounts' identical data apart. A bundle is at most 32 MB; an
account holds at most 512 MB of web state, a quota of its own.

### 6.6 End-to-end encryption

Web state is live credentials for every site a person uses. It is encrypted on the device
and the account holds only ciphertext and opaque names.

- **Device key.** Each desktop device makes an X25519 key pair; the private key is in the
  system keychain through the `keyring` crate (as provider keys are, `secrets.rs`), the
  public key is registered with the device.
- **Web key.** 32 random bytes and a generation, made by the first computer that uploads web
  state. The account stores it only wrapped (a sealed box, X25519 + HKDF-SHA256 +
  XChaCha20-Poly1305) to each approved device's public key.
- **Bundles** are XChaCha20-Poly1305 with a random nonce per object and the store, site and
  generation as associated data; lease keys and chunk names are HMAC-SHA256 under a key
  derived from the web key.
- **A new computer** registers its public key and asks its hub for the web key. The hub
  relays the request to the account's other computers, which show the approval prompt with
  six digits derived from the new public key (`SHA-256(pub)` read as a number, mod 10^6),
  while the new computer shows the same digits. **Allow** wraps the web key to that public
  key. A server that substituted its own key would show different digits. Until it is
  approved, a computer takes no leases and uploads nothing (it cannot name a lease without
  the key): its pages run on its own fresh state, signed out, like a new browser.
- **No recovery code.** If every computer is gone, the new one makes a fresh web key and
  the person signs in to their sites again; the old bundles are deleted. Losing web state is
  losing logins, not writing.
- **A device ended** from Account (the sessions list) is revoked on the hub: its wrapped key
  is deleted and the next upload by any remaining computer rotates to a new generation,
  wrapped to the remaining devices. What the ended device already had on its disk is its
  own; nothing on the account is readable to it after the rotation.
- **A security mail** goes to the account's address when a computer is given the web key,
  through `email.ts` and the existing per-address gap and daily ceiling; a mail that cannot
  go out never blocks the approval.

Phones and the browser build never hold the web key: they have no web tabs.

### 6.7 Pitfalls, collected

| pitfall | answer |
| --- | --- |
| cookie databases are machine-bound (DPAPI, app-bound encryption, Keychain) | APIs only, never files |
| two computers on one session revoke it (RFC 9700 rotation) | the lease, the handover's flush before the grant, and fencing |
| DBSC-bound Google sessions | cannot move by design; Google asks once per computer; the lease still prevents concurrent use |
| sessions bound to IP or user agent | the site asks for a sign-in; that sign-in becomes the travelling state |
| a dump observed or altered by the site | isolated worlds |
| huge IndexedDB (mail, chat caches) | 16 MB per database, 32 MB per bundle, content-addressed chunks, IndexedDB only at release |
| the server holding everybody's sessions | end-to-end encryption, opaque names, approval by matching digits |
| a stale lock after a crash (Multilogin's problem) | a lease with a 30 s TTL, not a lock |
| a paused holder writing late | fencing |
| an ephemeral tab using a leased site | leases are per site session, not per file |

---

## 7. The protocol

All routes are under `/v2`, behind the session guard like `/v1`, and every refusal a
person can cause is an English sentence with a row in every catalogue. Binary payloads
(Yjs updates, state vectors, blobs, bundles) travel as `application/octet-stream` inside a
small framed envelope (`@nib/sync/wire`: a JSON header, then length-prefixed binary
parts), because base64 would cost a third more on every update.

### Tree and feed

- `GET /v2/spaces/:space/feed?since=<seq>` returns
  `{ items: Item[], cursor, more }` where `Item` is
  `{ id, kind: 'note'|'canvas'|'pages'|'url'|'file'|'folder', parent, name, deleted, seq,
  docSeq?, epoch?, epochBase?, hash, size, by, at }`, at most 1000 per page, tree and
  content changes in one order.
- `POST /v2/spaces/:space/ops` with `{ ops: Op[] }` (at most 200) returns
  `{ results: [{ op, ok } | { op, ok, id, parent, name } | { op, merged: id } | { op,
  refused: 'cycle'|'edited'|'role'|'gone' }], cursor }`. An op id seen before answers its
  original result.

### Documents

- `POST /v2/docs/pull` with `{ docs: [{ id, epoch, sv }] }` (at most 200). The Worker reads
  each R2 snapshot and answers `Y.diffUpdateV2(snapshot, sv)`, or `{ id, epoch: newer,
  epochBase }` when the device is on an old epoch. No room is woken.
- `POST /v2/docs/push` with `{ docs: [{ id, epoch, base: sv, checked?: sv, update, at }] }`
  (at most 50; each goes to its room). Per document: `{ id, ok, sv }`, `{ id, moved:
  update, sv }`, `{ id, epoch: newer }`, or `{ id, refused }`.
- `POST /v2/docs/keep` with `{ id, text, device }`: the losing side of a modal answer, kept
  as a version.
- `GET /v2/spaces/:space/snapshot?after=<id>`: the first sync's bulk read, documents in id
  order, about 4 MB a page.
- The room's socket (`/rooms/:id`) keeps y-protocols and gains, under the subprotocol
  `nib.v2`: `ACK (sv)` from the room at each settle, and `EPOCH (epoch, epochBase)` before
  it closes with 4001. A socket without `nib.v2` is a v1 client and hears neither.

### Files

- `PUT /v1/blobs/:hash` as today; `POST /v2/blobs/parts` for R2 multipart above 64 MB.
- `GET /v2/files/:space/:id`: the bytes, for members.

### Hub

- `GET /v2/hub`, upgraded, with the token and `nib.device.<id>` in the subprotocol. Text
  frames: `beat` (auto-answered `ok`), `{t:'hello', device, name, platform, app}`,
  `{t:'active'}`, `{t:'idle'}`, `{t:'acquire', key, take}`, `{t:'release', key, version}`,
  `{t:'flushed', key, version}`, `{t:'want-key', pub}`, `{t:'grant-key', to, wrapped,
  generation}`, `{t:'deny-key', to}`; and from the hub `{t:'poke', space, seq}`,
  `{t:'granted', key, fence, version}`, `{t:'busy', key, device}`, `{t:'flush', key,
  fence}`, `{t:'lost', key, device}`, `{t:'free', key}`, `{t:'state', key, version}`,
  `{t:'key-wanted', device, name, pub}`, `{t:'key', wrapped, generation}`, `{t:'key-denied'}`.
- `PUT /v2/web/:key` (header `x-nib-fence`), the manifest; `PUT /v2/web/chunks/:name`, a
  chunk; `GET` of both. `409 fenced`, `413` past the ceilings, `507` past the web quota.
- `GET /v2/devices`, `PATCH /v2/devices/:id` (a name), `DELETE /v2/devices/:id` (ends its
  sessions, revokes its key, closes its sockets and rooms).

### What a program token may reach

`nib_...` tokens (`programs.ts`) reach the feed, `/v2/docs/pull`, and the v1 note routes they
reach today. Never the hub, web state, devices, `/v2/docs/push` or tree ops: a CI job writes
text through the v1 routes, which the room folds in (section 11).

---

## 8. Server changes

### D1

Two migrations, one per lane (section 13). `0038` went to `leftovers` on 2026-09-30, so the
hub lane, which lands first, takes `0039` and the docs lane `0040`; whichever lands on a
taken number moves to the next free one and says so.

`0040_sync2_tree.sql` (lane `sync-server-docs`):

```sql
create table folders (
  id text primary key,
  space_id text not null references spaces(id) on delete cascade,
  parent_id text,
  name text not null,
  name_key text not null,
  seq integer not null,
  deleted integer not null default 0,
  deleted_at integer,
  updated_at integer not null
);
create unique index folders_live_name on folders(space_id, coalesce(parent_id, ''), name_key)
  where deleted = 0;
create index folders_space_seq on folders(space_id, seq);

alter table notes add column folder_id text;
alter table notes add column name text;
alter table notes add column name_key text;
alter table notes add column kind text not null default 'note';
alter table notes add column epoch integer not null default 0;
alter table notes add column epoch_base text;
alter table notes add column doc_seq integer;
create unique index notes_live_name on notes(space_id, coalesce(folder_id, ''), name_key)
  where deleted = 0 and name_key is not null;

create table tree_ops (
  op_id text primary key,
  space_id text not null,
  result text not null,
  at integer not null
);
create index tree_ops_at on tree_ops(at);

alter table users add column sync_version integer not null default 1;
```

`folder_id`, `name` and `name_key` are filled per space the first time a v2 client asks for
it, in one batch, from `path` (the existing unique path index guarantees the input is a
tree). Two names that differ only by case or normalisation (possible today from a Linux
device) cannot both keep theirs under `name_key`: the later one is numbered in the backfill,
as a rename every device then applies. `path` is kept current by every op that moves
something, in the same batch. The nightly job sweeps `tree_ops` after 30 days.

`0039_sync2_devices_web.sql` (lane `sync-server-hub`):

```sql
create table devices (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  session_id text,
  name text not null,
  platform text not null,
  public_key text,
  created_at integer not null,
  last_seen_at integer,
  revoked_at integer
);
create index devices_user on devices(user_id);

create table web_states (
  user_id text not null references users(id) on delete cascade,
  key text not null,
  fence integer not null,
  version integer not null,
  generation integer not null,
  size integer not null,
  device_id text not null,
  at integer not null,
  primary key (user_id, key)
);

create table web_chunks (
  user_id text not null references users(id) on delete cascade,
  name text not null,
  size integer not null,
  at integer not null,
  primary key (user_id, name)
);

create table web_keys (
  user_id text not null references users(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  wrapped text not null,
  generation integer not null,
  primary key (user_id, device_id)
);

alter table spaces add column web_store text not null default 'global';
```

D1 stays far from its 10 GB: no Yjs bytes and no web bytes live in it.

**Deleting an account** (`services/sync/src/erase.ts`, on main since 024d34fb) has to know
about all of it: every new table goes on `ERASED` (the test in `services/sync/test/erase.test.ts`
fails until it is), the R2 names go into `leftovers` in the same batch (`crdt/<note>` beside
`rooms/<note>`, and every `web/<user>/` object), and the sweep empties the account's
`AccountHub` the way `eraseRooms` empties its rooms.

### Durable Objects

- `NoteRoom` (existing class, no new tag): HTTP `push`, `pull`, `keep` for its note; durable
  log writes for HTTP pushes; `ACK` and `EPOCH` messages; the R2 snapshot at each settle;
  `ingest(text, baseVersion?)` for whole-text writers (v1 PUT, connector, rollback,
  `nib-sync.mjs`), which applies `textops(current, text)` under the room's own client id
  (`hash32(noteId, 'account')`, safe because the room is the only writer of that id and
  persists before it settles); seeding epoch 1 from the current body the first time it
  wakes at an epoch its storage does not hold (section 11, step 3).
  `keptBeside` and `noteBeside` stay for v1 pushes only and are deleted with v1.
- `AccountHub` (new class, migration tag `v2`, `new_sqlite_classes`): devices, leases
  (`key, holder, fence, state, version, waiting`), the auto-response heartbeat, alarms for
  handovers and waiters, pokes, key relay. It writes `web_states` rows in D1 when it accepts
  an upload, so downloads never wake it.

`new_sqlite_classes` and not `new_classes`, as `collaboration.md` records, and proved with
`wrangler deploy --dry-run` before anything else.

### R2

| key | what |
| --- | --- |
| `spaces/<space>/<note>` | the markdown, as today |
| `versions/<hash>` | versions, as today |
| `crdt/<note>` | the room's latest snapshot, written at each settle |
| `blobs/<hash>` | pictures, PDFs, and now every file in a space |
| `web/<user>/<key>` | an encrypted web manifest |
| `web/<user>/chunks/<name>` | an encrypted chunk |

### Quotas, limits and mail

- The 1 GiB account quota (`storage.ts`) counts notes and blobs as today; blobs now include
  every file in a space, which is the one visible change. Document snapshots and versions
  are the service's cost, capped at twice the note (the room's existing ceiling) and not
  counted.
- Web state has a quota of its own, 512 MB per account, and 32 MB per bundle.
- New `limits` rows: tree ops and document pushes per account per minute (600 each), lease
  acquisitions per device per minute (30), web uploads per key per hour (60), key requests
  per account per hour (5).
- Mail: one new message, "a computer was given your web logins", on the existing per-address
  gap and daily ceiling (`mailed`, `mailed_days`). Nothing about sync itself mails anybody.

### Cost, roughly

A device's heartbeat costs nothing (auto-response). A poke is one Durable Object request per
account reached, per write. A settle is one extra R2 put (the snapshot) beside the body and
version puts it already makes. A pull reads R2, not a room. For one active person with three
devices this is a few thousand requests a day, cents a month.

---

## 9. Client changes

### 9.1 Modules

Files that do not exist yet are named from their package: `lib/` is the app's
`src/lib`, `src-tauri/` is the app's crate, `src/` beside "the Worker" is `services/sync/src`.

| where | what | lane |
| --- | --- | --- |
| `@nib/sync` (a new package beside `packages/rooms`) | `merge3`, `diverge`, `textops`, `seed`, `tree`, `outbox`, `wire`, `plane-diverge`; pure, shared by app and Worker | core |
| `src-tauri/src/sync_store.rs` | the sync store (SQLite through `rusqlite`, bundled, now on every target) and its batched commands | store |
| `src-tauri/src/space_watch.rs` | the space folder watcher (`notify`), debounced, with file identities | store |
| `lib/web/sync-store.ts` | the same store over IndexedDB for the browser build | store |
| `lib/sync2/` | the engine: documents (confirmed, pending), the pass (feed, pull, push, ops), projection to files, ingest of foreign edits, held notes, migration from `nib:mirrors`, the v1 fallback | engine |
| `lib/sync2/hub.svelte.ts` | the one hub socket: hello, beats, reconnects, and a typed `on(type)` the engine's pokes and the leases both use | web-lease |
| `lib/sync2/Diverged.svelte` and the mark, toast, Sync pane | the modal and everything a reader sees | ux |
| `lib/web-tab/lease.svelte.ts`, `WebLocked.svelte`, `activity.ts`, `WebApprove.svelte` | leases, the lock surface, activity, approval | web-lease |
| `src-tauri/src/web_state/` | capture and restore per engine, the scripts, the bundle, the crypto and the device key | web-state |

`sync.svelte.ts` chooses the engine at start from `account.user.syncVersion`; the rooms
store (`rooms.svelte.ts`) becomes the engine's socket layer for open documents.

### 9.2 The sync store

One SQLite file per account in the app's data folder (`sync/<account>.db`, WAL), opened on a
background thread after the first paint:

```sql
create table meta (key text primary key, value blob);          -- device id, schema, clean_exit
create table spaces (space_id text primary key, root text not null,
                     cursor integer not null default 0, role text, store text);
create table entries (id text primary key, space_id text not null, kind text not null,
                      parent text, name text not null, local_path text not null,
                      file_key text, written_hash text, mtime integer, size integer,
                      seq integer, deleted integer not null default 0);
create table written (id text primary key, text blob not null); -- what nib last wrote, compressed
create table docs (id text primary key, epoch integer not null, client_id integer not null,
                   confirmed blob not null, confirmed_sv blob not null,
                   pending blob, pending_at integer);
create table outbox (op_id text primary key, space_id text not null, op blob not null,
                     seen integer not null, made_at integer not null);
create table held (id text primary key, remote blob not null, remote_sv blob not null,
                   device text, at integer not null);
create table files (hash text primary key, state text not null);  -- here, wanted, sending
create table web (key text primary key, fence integer, version integer, applied integer);
create table log (at integer not null, space text, pulled integer, pushed integer,
                  failed text);
```

The browser build keeps the same tables as IndexedDB stores, and runs one engine per
browser (a Web Locks leader) rather than one per tab.

### 9.3 The performance budget

| moment | budget | how |
| --- | --- | --- |
| launch to first paint | unchanged, under 1 s | no sync code in the first paint's chunk; the store opens and the hub connects after the paint |
| opening a note | the file's text at once; the document attached within 50 ms for 100 KB | the file is read as today; the document loads from the store in the background and binds without moving the caret |
| a keystroke | under 16 ms, independent of the note's size | one Yjs insert, one socket frame if live, pending held in memory; nothing written per keystroke |
| after the pause | one file write and one store append | in the autosave that already runs |
| a poke to a note on screen | under 1 s end to end | pull of one diff, applied as an edit |
| a pass after a week away, 300 notes changed | under 10 s on a normal connection, nothing on the UI thread | batched pulls of 200, pushes of 50, classification in a worker |
| first sync of 5,000 notes | the file list in a second, the note on screen first | the feed's names at once (as `arriving` does), bulk snapshots in 4 MB pages |
| memory | documents only for open notes, plus a scratch one while classifying | |
| web capture | under 200 ms on the UI thread | the dump runs in the page's process; compression and crypto on a Rust thread |

---

## 10. Security

- **Paths.** Every name the feed carries goes through `insideOnly` and `placeable` before it
  reaches a disk, as today; the local name map (5.9) is the only way a name becomes a path.
- **Roles.** A reader's socket and HTTP pushes are refused before the room applies anything
  (`isEdit` today, and `/v2/docs/push` checks the role); tree ops check `write`; a file shared on
  its own cannot be moved or deleted by its recipient (the v1 rule).
- **Program tokens** reach no v2 write route (section 7).
- **Documents** are bounded: an update above 4 MB is refused, a document past twice the
  note's ceiling is closed with 1009 as today.
- **Web state** is end-to-end encrypted with matching-digit approval (6.6); the hub and D1
  see opaque keys; a revoked device is removed from every future key generation.
- **Leases** cannot be stolen by a device of another account (keyed by account, socket
  authenticated), and a device's own stale writes are fenced.
- **Sign-out** empties the vault as today, deletes the sync store, forgets the device key
  and leaves the local web stores (they are the person's browser, and Emil's earlier rule
  keeps browsing data apart from the account).

---

## 11. Migration, rollout and compatibility

### Zero data loss, in order

1. **Server first, dark.** The migrations, the v2 routes, the hub and the room's additions
   ship with every account at `sync_version = 1`. v1 behaves exactly as today. Rooms still
   settle as today.
2. **A device moving to v2** (its account flipped to 2), on its first v2 pass per space:
   1. asks the account to prepare the space (folders backfilled from paths);
   2. reads `nib:mirrors` for the space. For each tracked note:
      - the file still reads as the tracked hash, and that is `epoch_base`: the document is
        the seed of that text, **built locally, nothing downloaded**;
      - the file still reads as the tracked hash, and the account moved on: the seed of the
        file's text, then a pull, which brings the rest as operations;
      - the file moved since the last pass (edits made under v1 that never went up), and
        the account did not: the account's body is the ancestor, so the seed of it plus
        `textops(ancestor, file)` as this device's pending edits;
      - both moved: the ancestor is the tracked hash's body from `versions/<hash>` when the
        account kept that version (it keeps one every five minutes, so usually), and the
        file goes through the classifier like any other offline edit. With no ancestor, a
        two-way rule: a text that contains the other whole wins silently, otherwise the note
        is held and asks;
   3. untracked files become creates, tracked files that are gone become deletes (with the
      edit-beats-delete rule on the account);
   4. writes `nib:mirrors` back untouched: it is the rollback path.
3. **Rooms at the switch.** Preparing a space marks its notes epoch 1 with their current
   bodies' hashes. A room that still holds a document from before (a v1 room) and wakes,
   is joined, or settles, and finds its note at epoch 1, **seeds epoch 1 from the current
   body** (which is `epoch_base`, because nothing but the room has written the note since)
   and **ingests its own unsettled text as operations**, then closes its v1 sockets with
   4001 so those clients rejoin through their existing join logic. No order between the
   preparing and the rooms is needed, and no words a room held are dropped.

### Feature flags

- `sync_version` per account: 1 (v1), 2 (v2). Flipped for Emil's account first, then
  accounts whose devices all run a v2 app (the hub knows every device's `app` version),
  then everybody. The client reads it at start; a change takes effect at the next launch.
- `web_sync` per account, separately, desktop only, after `sync_version = 2`.
- **Rollback**: setting 1 again makes the client rebuild `nib:mirrors` from the store (each
  note's id, version and the hash of its confirmed text) before the v1 loop starts, so v1
  resumes without a conflict copy.

### Older apps in the wild

A v1 app keeps its whole behaviour against the same account, and the account treats it as
a device that cannot reach a room: its whole-file `PUT` with a `baseVersion` equal to the
current version is ingested into the document as operations; one naming an older version
gets 409 and the v1 app does what it does today (a copy beside the note). Its path renames
become `rename`/`move` ops, its creates become `create` ops with a server id, and its
deletes go into Recently deleted exactly as today, because a v1 delete names no version to
judge an edit against. It joins rooms over y-protocols
exactly as today. It never takes a web lease, so a v1 computer can run a site at the same
time as a v2 one; the updater nudges it. v1 routes stay for at least six months after the
last flip, and `keptBeside` and `noteBeside` are deleted with them.

The glasses plugin stays on v1: it reads, and writes whole notes through the connector
routes.

---

## 12. Tests

### A deterministic multi-device simulator

`test/sim/` in `@nib/sync`: N devices, one account, one network, one clock, all in one
process and all driven by a seeded random generator, so a failure is a seed and a seed is a
replay.

- **The account** is the Worker's own Hono app over Node's SQLite (as `services/sync/test`
  runs it today), with R2 in a map and Durable Objects stood in for by the same harness the
  room tests use, `AccountHub` included.
- **A device** is the v2 engine with its store in memory, its disk a map of files, its
  editor a list of scripted edits, and its socket a pipe through the network.
- **The network** delivers, delays, reorders, duplicates and drops messages and requests,
  partitions any device, and can cut a response after the request landed (the lost reply).
- **Steps**: type, paste, delete a paragraph, rename, move, delete, create, append to the
  day's note, go offline, come back, quit cleanly, crash (drop everything not in the store),
  edit the file with "another program", and answer a modal with each of the three answers.
- **After every run**, once the network is quiet: all devices and the account hold the same
  tree and the same texts; **every word ever typed** (each script inserts unique marker
  words) is in a note, in a version, or in a Keep both copy, unless a modal answer dropped
  it, and then it is in a version; no file exists that no answer created; the modal was
  shown exactly when `diverge` said so.

Scripted scenarios, one per road in section 1, pin each old failure: the closed laptop
(road 2), the two `Untitled.md` (road 4), delete against edit in both orders (road 5), the
offline rename against an edit (road 6), the full storage (road 7), and a day's note made
on two devices. Then random walks: ten thousand seeds per CI run of five minutes, a million
nightly.

### Offline and partition tests

The existing drives keep their shape and change their assertions. `conflict.py` (two
browsers against `wrangler dev`, every way of being away) asserts no `(from another device`
file exists and every line is in the note or the history; a new `offline-days.py` holds one
browser offline across edits on both sides of forty notes and checks the modal appears on
exactly the planted overlaps. `collaborate.py` and `draw-together.py` keep their budgets.

### Fuzzing the merge

`fast-check` properties over a markdown-shaped generator (headings, lists, fences, tables,
front matter, long lines, emoji and CJK for surrogate pairs):

- `merge3(B, L, B)` is L, and `diverge` says `clean`;
- disjoint edits are always `clean` and the result contains both;
- `diverge(B, L, R)` and `diverge(B, R, L)` give the same verdict;
- the CRDT merge converges for every delivery order and every duplication;
- `textops(A, B)` applied to a document reading A reads B, and costs operations in
  proportion to the edit, not to the text;
- two seeds of one text for one note and epoch are byte-identical and merge to one copy;
- the tree rules converge for any order of any set of ops, never produce a cycle, and never
  delete a note edited after the delete's `seen`.

### Leases, crashes and expiry

`hub.test.ts` in the Worker's tests, with a fake clock and fake sockets: acquire free;
acquire held-active is `busy`; `take` hands over, with `flush` before `granted` and the fence
moved on; a holder that never answers the flush is replaced after 10 s; a holder that stops
beating is not alive after 30 s and a waiter is told; an upload with an old fence is
`409 fenced`; the auto-response timestamp is the only liveness input; the device clock is
never read; idle and active transitions; revocation closes the sockets and drops the
wrapped key; the rate limits.

Native: `web-state-probe.py` (in `scripts`) (through `probe_app.py`, off-screen, temp spaces): signs
in to a loopback site that sets a session cookie, a partitioned cookie, localStorage,
sessionStorage and an IndexedDB database with a Blob and a Date; captures a bundle from one
store; restores it into a fresh store as a second "computer"; reads everything back from the
page. Then the two-instance lease probe: two probe apps with two device ids against
`wrangler dev`, one holding, the other shown the lock surface, Use here, the first frozen;
then the first killed, and the second taking the lease 30 s later.

---

## 13. The implementation plan

Eight lanes on disjoint files, in three waves; the briefs are in the manager's scratchpad
under `sync-design/lanes/`. Every lane follows `nib-agent-rules.md`, reads this document
first, lands on main behind the flags, and keeps v1 green.

| lane | owns | depends on | wave |
| --- | --- | --- | --- |
| `sync-core` | `@nib/sync` | nothing | 1 |
| `sync-server-hub` | the Worker's `src/hub/`, `0039`, `wrangler.jsonc`, web state, device and web-store routes | nothing (this document is the protocol) | 1 |
| `sync-client-store` | `sync_store.rs`, `space_watch.rs`, `web/sync-store.ts` | nothing (section 9.2 is the schema) | 1 |
| `web-state` | `src-tauri/src/web_state/`, the scripts, the crypto | nothing for capture, restore and crypto; the hub's routes for upload | 1 |
| `sync-server-docs` | the Worker's `src/sync2/`, `rooms/`, `notes.ts`, `0040` | `sync-core` | 2 |
| `web-lease` | `web-tab/lease*`, `WebLocked`, `WebApprove`, `activity.ts`, `sync2/hub.svelte.ts` | `sync-server-hub`; `web-state`'s commands | 2 |
| `sync-client-engine` | `lib/sync2/` (not the UI, not the hub socket), `sync.svelte.ts`, `rooms.svelte.ts` | `sync-core`, `sync-server-docs`, `sync-client-store`, `web-lease`'s hub socket | 3 |
| `sync-client-ux` | the modal, the mark, the toast, the Sync pane, locales | the engine's `held` interface (section 13.1); can start in wave 2 on a fake | 2 to 3 |

At most eight agents run at once and the waves never need more than five. After wave 3 the
manager flips `sync_version` for Emil's account, runs the simulator nightly and the drives,
then `web_sync`.

### 13.1 The interfaces the lanes meet at

- `@nib/sync` exports exactly: `merge3`, `diverge` (with `Verdict`, `Overlap`,
  `CONTESTED = 80`), `textops`, `seedUpdate(noteId, epoch, text)`, `seedPlane(noteId, epoch,
  canvas)`, `applyOp`/`TreeState` and the rules of 5.9, `coalesce` for the outbox, and the
  wire types and codecs of section 7.
- The engine exposes to the UX lane:
  `held: { readonly notes: readonly Held[]; answer(id, 'mine'|'theirs'|'both'): Promise<void> }`
  where `Held = { id, path, name, mine: Side, theirs: Side }` and
  `Side = { device, at, excerpt: { text, marks: [from, to][] } }`, and a `resurrected`
  event `{ id, name, device }`.
- `web-state` exposes Tauri commands: `web_state_capture(store, site, origins)`,
  `web_state_restore(store, site, bundleRef)`, `web_state_seal`, `web_state_open`,
  `web_key_*` (device key, wrap, unwrap, digits), each tested on its own.
- The hub lane exposes `pokeSpace(env, ctx, spaceId, seq)` in `src/hub/poke.ts` in the Worker
  as its **first** push (a no-op until the object exists), so the docs lane can call it.

---

## 14. Open questions for Emil

Only product decisions; each has a recommendation, and the design above assumes it.

1. **What exactly locks.** A web note, or the login behind it? Recommendation: **the login**
   (the site in its store), because two notes on one site share one session and running it
   on two computers gets it revoked. The message still appears in the tab you opened.
2. **How long before an unused lock lets go.** Recommendation: **5 minutes without a key
   press or pointer move in nib** (and 30 s after a crash, sleep or quit). Shorter hands the
   session over while you read; longer makes you press Use here after switching computers.
3. **The Global / Space / Site choice travels with the space** instead of staying per
   computer. Recommendation: **yes**, or the same space signs in to different stores on your
   two computers and nothing follows you.
4. **A new computer gets your web logins after one Allow on an old one, with six digits to
   compare, and with no old computer left you sign in again.** Recommendation: **yes, no
   recovery code**: a code is a thing to lose, and losing logins is cheap.
5. **When the modal asks.** Recommendation: **only when both devices rewrote more than about a
   sentence (80 characters) of the same text, or one deleted a paragraph the other rewrote.**
   Smaller overlaps: the newer edit wins that span quietly and the other is in the history.
6. **Where the modal appears.** Recommendation: **when the note is on screen** (right away if
   it already is), with a mark on its row until then, never over the note you are typing in.
7. **Keep both's name.** Recommendation: the account's version keeps the name, yours becomes
   **`Plan (Laptop).md`**, opened in a tab beside it.
8. **The conflict setting in Sync (Keep both / Newest / Ask) goes away.** Recommendation:
   **yes**; the modal is the only question.
9. **Every file in a space syncs, pictures, recordings and PDFs included, counted in the 1 GiB,
   with files over 8 MB fetched when opened.** Recommendation: **yes**; a broken embed on the
   second computer is worse than the quota.
10. **A mail when a computer is given your web logins.** Recommendation: **yes**, like a bank's
    new-device mail; it is the one moment an attacker who took the mailbox would need.

---

## Sources

Every source is linked where it is used. The platform limits quoted in sections 2 and 8 are
from Cloudflare's [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
(10 GB per SQLite object, 1,000 requests a second per object),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (10,000
subrequests, 128 MB) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
(10 GB per database, 1,000 queries per invocation), read on 2026-09-30; the DevTools method
lists are from the protocol's own
[JSON](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).

[obsidian]: https://obsidian.md/help/sync/troubleshoot
[ob-robust]: https://forum.obsidian.md/t/robust-sync-conflict-resolution/93544
[ob-dup]: https://forum.obsidian.md/t/issue-using-obsidian-sync-sometimes-duplication-of-content-in-same-note/19829
[ob-daily]: https://forum.obsidian.md/t/bug-duplicating-daily-note-template-for-existing-daily-note/15495
[apple-hn]: https://news.ycombinator.com/item?id=17744375
[apple-notes]: https://github.com/dunhamsteve/notesutils/blob/master/notes.md
[bear]: https://bear.app/faq/how-bear-pro-handles-conflicted-notes/
[notion]: https://www.notion.com/blog/how-we-made-notion-available-offline
[craft]: https://support.craft.do/en/introduction/offline
[craft-proto]: https://www.craft.do/blog/in-house-sync-protocol
[logseq]: https://deepwiki.com/logseq/logseq/4.1-database-worker-and-synchronization
[sn]: https://standardnotes.com/blog/microupdate-server-status-and-conflicts
[joplin]: https://joplinapp.org/help/apps/conflict/
[joplin-all]: https://discourse.joplinapp.org/t/conflicts-all-of-my-notes-are-conflicts-now/22971
[dropbox]: https://help.dropbox.com/organize/conflicted-copy
[syncthing]: https://docs.syncthing.net/users/syncing.html
[linear]: https://github.com/wzhudev/reverse-linear-sync-engine
[replicache]: https://doc.replicache.dev/concepts/how-it-works
[diffsync]: https://neil.fraser.name/writing/sync/
[yjs-internals]: https://github.com/yjs/yjs/blob/main/INTERNALS.md
[am3]: https://automerge.org/blog/automerge-3/
[loro]: https://loro.dev/docs/concepts/shallow_snapshots
[eg]: https://arxiv.org/abs/2409.14252
[yjs-seed]: https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/
[oc-seed]: https://github.com/opencloud-eu/web/issues/3428
[move-op]: https://martin.kleppmann.com/papers/move-op.pdf
[chrome-sync]: https://support.google.com/chrome/thread/283451528/does-chrome-sync-cookies-and-cache-across-devices
[arc]: https://resources.arc.net/hc/en-us/articles/20272860828823-Arc-Sync
[ferdium]: https://medium.com/codex/part-18-self-hosted-messenger-hub-on-a-pi-ferdium-vs-rambox-done-privately-bc7a9c015f28
[gologin]: https://gologin.com/docs/browser-profiles/profile-management/profile-synchronization
[multilogin]: https://multilogin.com/help/issue-profile-is-locked
[whatsapp]: https://github.com/pedroslopez/whatsapp-web.js/issues/625
[rfc9700]: https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2
[dbsc]: https://workspaceupdates.googleblog.com/2026/05/prevent-account-takeovers-with-DBSC-now-generally-available-in-the-Chrome-browser-for-Windows.html
[appbound]: https://thehackernews.com/2024/08/google-chrome-adds-app-bound-encryption.html
[dpapi]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder
[cdp]: https://chromedevtools.github.io/devtools-protocol/tot/IndexedDB/
[interaction]: https://developer.apple.com/documentation/webkit/wkwebview/interactionstate
[gtk-cookies]: https://webkitgtk.org/reference/webkit2gtk/stable/method.CookieManager.replace_cookies.html
[k8s-lease]: https://kubernetes.io/docs/concepts/architecture/leases/
[k8s-defaults]: https://sklar.rocks/kubernetes-leader-election/
[fencing]: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
[do-state]: https://developers.cloudflare.com/durable-objects/api/state/
