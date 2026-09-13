# Writing in one note from several devices

A note open on a laptop and a phone at the same time is one note. Both people see
the other's caret, both see the words appear as they are typed, and a device that
was on a train catches up when it comes back without anybody being asked which
copy to keep. This is how that works, and why it is built the way it is.

A canvas open on two devices is one canvas in the same way, in a shape of its own,
and everything here is about both until the Canvas section says otherwise.

## What everyone else does

**Google Docs** serialises everything through a server, using operational
transformation in the shape of the [Jupiter model][jupiter] (Nichols, Curtis,
Dixon and Lamping, UIST '95). Each client keeps a queue of edits it has sent and
not had acknowledged; an edit arriving from the server is transformed against
everything still in that queue, and the queue is transformed in turn, so the two
sides reconverge. The server holds one revision log per document and one such
state space per client. The [Apache Wave whitepaper][wave], written by the same
lineage of engineers, is the closest thing to a published description: the client
"must wait for acknowledgement from the server before sending more operations",
and the server transforms each operation against its history, applies it and
broadcasts it. Undo in OT is a new inverse operation transformed against
everything concurrent, which is what makes it per user rather than a stack pop.
Offline is where the model strains: the merge cost grows with how far the two
sides diverged, and the [Eg-walker paper][eg] measures OT taking about an hour on
a trace that a modern algorithm merges in 24 ms. Correctness is the other cost:
"formal proofs are very complicated and error-prone, even for OT algorithms that
only treat two characterwise primitives", and several published algorithms were
later shown wrong.

**Figma** deliberately used neither. Their [engineering post][figma] says OT was
"unnecessarily complex for our problem space" and that CRDTs carry "unavoidable
performance and memory overhead" for a system that has a central server anyway.
What they built is a two-level map, `Map<ObjectID, Map<Property, Value>>`, with
last writer wins per property, a parent pointer stored as a property so identity
survives reparenting, and fractional indices for sibling order. They are blunt
about the limit: "simultaneous editing of the same text value doesn't work in
Figma. If the text value is B and someone changes it to AB at the same time as
someone else changes it to BC, the end result will be either AB or BC but never
ABC." A design tool can live with that; an editor cannot. When they later needed
real text merging, for [Code Layers][figma-code], they chose Eg-walker.

**Obsidian Sync** is file sync rather than shared editing. Its
[documentation][obsidian] says markdown conflicts are merged with Google's
diff-match-patch, which "preserves all edits" but can duplicate text, and that
everything else, canvases included, is last modified wins. Since 1.9.7 a device
can choose a conflict file instead, named `note (Conflicted copy device
YYYYMMDDHHMM).md`. Real-time editing in Obsidian exists only through the
third-party [Relay][relay] plugin, which uses Yjs.

**Notion** is block based. Their [own posts][notion] describe a record per block
with a `content` array of children and a `parent` pointer, clients applying
operations optimistically and queueing transactions to a `/saveTransactions`
endpoint, and a WebSocket that tells them which records changed. When they
shipped offline in August 2025 they said outright that "pages that are marked as
available offline are dynamically migrated to our new CRDT data model for
conflict-resolution" - the block model alone was not enough once edits could be
made while disconnected. Apple Notes and Dropbox Paper have published nothing
worth citing.

**The open source world settled on CRDTs**, and mostly on one. [Yjs][yjs]
implements YATA: every inserted run is an item with an id of `(client, clock)`
and a record of which items it sat between when it was written, and consecutive
typing is merged into a single item, which is why a note typed straight through
costs about what the note costs. It ships the pieces this needs as separate
libraries: `y-protocols` for the sync and awareness messages, `y-websocket` for a
provider, `y-codemirror.next` for a CodeMirror 6 binding. On the published
benchmark for a real editing trace of 260,000 operations, Yjs takes about 5.7
seconds and 3.2 MB where Automerge 2 took 14.3 seconds and far more; Automerge 3
has since closed most of that gap by holding its columnar format in memory.
[Loro][loro] is the most actively released of the three and uses Fugue over an
event graph. [Diamond Types][dt] is dormant as a crate but its ideas became
[Eg-walker][eg], which keeps an event graph and builds CRDT state only for the
duration of a merge - one to two orders of magnitude less steady-state memory.
[ShareDB][sharedb] is the maintained OT option, with `json0` as its one built-in
type. The debate is genuinely two-sided: [Sun et al.][sun] argue that OT remains
what almost every working co-editor is built on, and Kleppmann's ["CRDTs: The
Hard Parts"][hard] is candid that "simple implementations often have terrible
performance". The known CRDT anomaly is [interleaving][interleave]: concurrently
written runs can be shuffled character by character. YATA has the weaker form of
it rather than the full one, and Fugue is the accepted answer; neither shows up in
the case a note actually meets, which is two people writing in different places.

## What Nib does, and why

**A CRDT, and Yjs.** Devices go offline and come back, and that is the case OT is
worst at and a CRDT is best at: a device that wrote for an hour on a train merges
in the time it takes to apply its updates, with no server-held transformation path
to replay. Yjs specifically because it is the mature one, because its run-merging
makes a note cost about what the note costs, and because `y-protocols` is a
reference implementation of the wire so neither end of this is hand-rolled. Loro
and Eg-walker are both better on paper for very long histories; neither is worth
the risk for a note, and the format the words are stored in here is markdown
rather than a CRDT, so nothing is locked in - a room can be thrown away and reseeded
from the note at any time.

**Not `y-codemirror.next`.** Its `yCollab` binds one CodeMirror view to a `Y.Text`
and owns that view's document. Nib already has a document that several views share
- one note in two panes is one note, with one undo history, and each pane keeps
its own caret; see `packages/editor/src/shared.ts`. Two bindings over one text
would each apply the other's changes. So the binding here is between the room and
that shared document, in `apps/desktop/src/lib/rooms/bind.ts`, and it is a
translation between two descriptions of the same edit: CodeMirror's change set and
Yjs's delta. The remote carets are drawn by
`packages/editor/src/carets.ts`, which the design would have wanted anyway.

**Not `y-partyserver`, and not `y-durableobjects`.** Both were read.
[`y-partyserver`][yps] is the maintained one - Cloudflare's own org, hibernation
handled correctly since 2.1.0, 30,000 downloads a week - but it ships **no
persistence at all**: `onLoad` and `onSave` are yours to write, which is the part
that would have been reused. What it does bring is `partyserver`, a framework that
owns the routing and the Durable Object base class, where this Worker's routing is
Hono with a session guard and a hostname catch-all; and it pins
`@cloudflare/workers-types@^4` where this repo is on `^5`.
[`y-durableobjects`][ydo] is Hono-native and does persist, with an update log and
compaction at 10 KB or 500 updates, but it is 800 downloads a week from a single
maintainer, it keeps its sessions in an in-memory `Map` that hibernation resets,
and it has no hook for writing settled markdown into a note store or for seeding a
room from a stored note. What was left to write either way was socket
bookkeeping, persistence and the settle. So `services/sync/src/rooms/` is written
here, over `y-protocols` - the protocol itself is not hand-rolled - and it takes
two lessons from `y-partyserver`: the open sockets are asked of the runtime rather
than held in a field, and the awareness protocol's own timer is turned off,
because an object with a timer running never sleeps.

## The shape of it

```
the editor            SharedDoc            Room                 NoteRoom
(one per pane)   ->   (one per note)  ->   (one per note)  ->   (one per note,
                                                                 in the world)
 a keystroke          the words and        the Yjs document      the Yjs document,
 drawn at once        the undo history     and the socket        the sockets, the
                                                                 storage, the settle
                                                                        |
                                                                        v
                                                                 the note store
                                                                 (D1 and R2)
```

**The room.** One Durable Object per file, named by that file's id, so there is one
instance of it in the world and that is what makes it the place the sockets meet.
It holds the note as a `Y.Text`, or a canvas as a map of the objects on it, passes
every update on to the other sockets, and keeps awareness so a caret arriving is a
caret everybody sees. Its sockets
hibernate: the runtime may take the object out of memory between messages, so
nothing that matters is held in a field. The open sockets come from
`ctx.getWebSockets()`, what each socket announced is kept on the socket itself
with `serializeAttachment`, and the settle is an alarm rather than a timer.

**Getting in.** `GET /rooms/:noteId`, upgraded to a WebSocket. The token rides in
the socket's subprotocol - a browser will not put a header on a WebSocket, and a
token in the address ends up in logs - and the server names it back so the
handshake completes, which is also why the route sits outside the session guard.
One query answers both halves of the question: is the session live, and is the
note in a space this account holds. That single query is the whole of who may
come in, and it is the one function the sharing batch changes.

**Persistence.** The room's own storage holds a snapshot of the document plus a
log of what has arrived since, and folds the log in when it grows past 200 entries
or 64 KB. The snapshot is chunked at 96 KB so it never runs into a value limit,
and is written in Yjs's second encoding, which is the smaller one. Updates are
**not** written as they arrive: a keystroke that reached a storage write would
cost the room a row and the reader a wait, and a room is written into a keystroke
at a time. They wait in memory and go down together at the settle. Nothing is at
risk while they wait, because every device in the room holds the same keystrokes:
a room that woke without its last few asks for them, by sending sync step 1 to the
sockets that were already there.

Both keys are numbered six digits wide and are put back in the order of the number
rather than of the text, so the tenth piece cannot land before the ninth. And the
document has a ceiling: twice `MAX_NOTE_BYTES`, measured off the encoding a snapshot
was making anyway, checked before an update is applied because an update applied is
in the document for good. Past it the room closes that socket with
1009 - the web socket's own "message too big" - and the sentence as the reason: the
app knows the code, stops rather than reconnecting, says the sentence once in its own
words and lets the room go, and the note carries on as a file, where a save too large
is refused in as many words. Dropping the update and leaving the socket open was the
first answer, from before the client could read a reason; it left somebody typing into
a room that was throwing the keystrokes away without a word. Nothing else was a ceiling: the
settle refuses a file over `MAX_NOTE_BYTES` and the quota counts what the note store
holds, so a document past either was storage nobody was charged for and nobody could
read. See `full` in `rooms/state.ts`.

**The settle.** A moment after the typing stops, the room writes the markdown into
the note store the way any other save writes it: the bytes into R2, the row's
version and the space's cursor moved on. Every device that is not in the room
reads that as an ordinary edit made somewhere else, which is exactly what it is,
so publishing, the connector, the glasses, exports and search carry on knowing
nothing about any of this. The last device out settles as it leaves.

**Joining, which is the part worth reading twice.** A device arrives holding a
file and the room holds words of its own. The document starts empty and is filled
by the room first, with the note left alone, so the two can be compared rather
than one silently landing on the other. Then one question decides it: is the file
still byte for byte what the account last handed this device? The file sync
already records that hash. If it is, everything that differs was written elsewhere
and the room's words go into the note as the edit they are, so every pane keeps
its caret. If it is not, this device wrote while it was away, and what it wrote
goes into the room as one replacement covering the piece that differs. Neither
case loses a word and neither leaves a second file to find. See
`apps/desktop/src/lib/rooms/join.ts`, which is the rule on its own.

That last case is the one place this is coarser than character-by-character
merging. A device that was *connected* when it went offline keeps its own copy of
the shared document, and everything it wrote merges per character on reconnect. A
device that was *closed* has only the file, and the file has no shared history to
merge against, so what it wrote folds in as a diff. Two devices that both rewrote
the same paragraph while closed will keep the later one's version of that
paragraph rather than interleaving them. The alternative - keeping the Yjs state
in IndexedDB with `y-indexeddb` - would close that gap at the cost of a
dependency, a second store per note that can go stale, and no help at all for the
other case it is really there for: a note edited by some other program, which is
the ordinary state of a folder of markdown files.

**The file sync.** A note in a room is the room's; `mirror.ts` neither sends it up
- the room already carried every keystroke - nor treats a version it has not seen
as a disagreement, so conflict copies for notes are gone. What comes down is
written and that is all. A note that is *not* in a room behaves exactly as it did
before, and so does a room that has been opened but has not yet settled with its
file: until that moment the file is still the best answer anybody has.

**And canvases, in a shape of their own.** A `.canvas` is JSON, and merging two
drawings as if they were prose would make neither; a text CRDT would interleave one
person's line through another's. But a canvas is exactly the thing a map-shaped CRDT
is for, because everything on it already has an id. See the Canvas section below.

## Carets and presence

A thin bar in the other device's colour where its caret is, a wash over what it
has selected, and its name above the bar for a second and a half after it moves.
No chat, no comments, no avatars, no toolbar.

Positions travel as Yjs relative positions rather than offsets, so a caret that
says "after this character" is still in the right place once somebody has written
a paragraph above it. Each end resolves them against the text it holds. Between
those messages CodeMirror maps the decorations through every local change for
nothing, so the app only speaks when somebody actually moves - and then only after
40 ms, because a held arrow key moves a caret more often than anyone can watch.

The colour travels as the name of an accent rather than as a colour: the shade a
colour needs to be readable on white is not the shade it needs on black, so which
shade is the reader's business. A device picks one accent, once, and keeps it, so
the phone is the same colour every morning.

The label is either the *device* - "Windows", "Android", "iPhone" - or the
*person*, and which one is not the sender's to decide. Two of one person's own
machines want to be told apart by machine: "Emil" on both carets answers nothing,
and the question those two carets raise is which of my machines that is. Two
people in a shared space want the opposite. Nobody knows which case a room is
until everybody has arrived, so both names travel and the choice belongs to
whoever is looking: a caret carries the person's name as soon as more than one
person is in the note, and the device's name otherwise. See `rooms/peers.ts`,
which is where the count is, and `rooms/who.ts`, which is where the two names
come from. A person's name is the one on their account, or the part of their
address in front of the at sign; never the whole address, which is not a name
and which the other people in a space were not necessarily given.

In the tab, one small dot per other device, in the accent, overlapping into a
stack, and nothing at all when nobody else is there. Three dots is as many as it
draws: past that the stack would be wider than the name it sits beside, and the
answer a reader wants from it is whether anybody else is in here rather than how
many.

**Undo stays yours.** A change that arrives from the room is applied to the shared
document with `addToHistory` off, so pressing undo takes back what you wrote and
never what somebody else did. CodeMirror maps what the history holds through every
arriving change, so the position it comes back to is still right.

## Drawing on one canvas

A plane open on a laptop and a tablet is one plane. Both people see the other's
line appear as it is drawn, both see a small named pointer where the other's hand
is, and neither drawing is ever woven through the other. It is the same room a note
has, about a different kind of file.

**The same Durable Object class, keyed by the file.** A room is named by the file's
id, so there is already one instance in the world per file whichever kind of file it
is; a second class would have been this whole object again for the sake of one seed
and one serialiser, and a second `[[migrations]]` tag with it. What actually differs
between a note's room and a canvas's is one module, `services/sync/src/rooms/kind.ts`:
what fills an empty document, and what the settle writes. The door reads the kind off
the file's name in the query it was already making and says it in a header; a room
keeps it in storage beside the note id, so one woken by an alarm knows what it holds.
Nothing else in the object knows there are two kinds. **No migration was added for
canvases**, which is the point of doing it this way.

**A map of objects by id.** The shared value is two `Y.Map`s at the root of the
document: `canvas`, holding everything on the plane keyed by id, and `gone`, holding
the tombstones. Each value in `canvas` is itself a map of that object's own fields,
the very fields a file would carry for it, plus three the room needs: which of the
file's three lists it belongs to, when it was last touched, and where it sits in the
stack, since a map has no order and a file's order does matter. See
`packages/rooms/src/plane.ts`.

That shape is the whole design. Two devices moving different cards never meet,
because they are different keys of the root map. Two devices editing one card both
win, because moving it writes `x` and `y` while colouring it writes `color`, and
those are different keys of the object's own map. Two strokes drawn at the same
moment are two entries that never touch, and each is whole.

**A stroke is one item.** Its points go in flat and packed, exactly as a file writes
them, rather than as a list of their own. A page of handwriting is tens of thousands
of points and not one of them is ever edited: the pen lifts and the stroke is
finished. So a stroke of three hundred points is one entry in the document, and the
plane costs about what the drawing costs.

**The line as it is being drawn** travels over awareness rather than in the document,
beside the pointer, in the same message and at the same one-a-frame rate a caret
moves at. An unfinished stroke is not on the plane: it is not in the file, it is
nobody's to undo or to erase, and it goes when the device that was drawing it does.
That is exactly what awareness is for. The finished stroke goes into the document on
the pen lift, once, as one whole object. See `rooms/hands.ts`.

**The settle writes the file `format.ts` would have written**, byte for byte: the
room reads its own map back into a `Canvas` and calls `writeCanvas`. So a plane that
was drawn on together opens in Obsidian, exports as a picture, and merges with an
offline device's copy exactly as one drawn on alone does. Nothing downstream of a
settle knows a room was involved.

**Joining does not have to ask which side is ahead.** A note asks whether the file is
still what the account last handed this device and folds one way or the other; a
canvas does not need the question, because everything on it has an id and a time. The
room's plane and this device's file are put through the same symmetric merge two
files get, in `canvas-merge.ts`, and both drawings are kept whichever device was
away. Nothing is watched until that has happened, so a plane somebody has been
drawing on is never replaced by the room's before the two have been compared. See
`apps/desktop/src/lib/rooms/plane-bind.ts`.

**Undo stays yours**, by a `Y.UndoManager` that tracks only this device's own
transactions. Pressing undo takes back the last thing you drew and never the last
thing that happened, and it reaches past whatever arrived in between without
disturbing it. Joining is marked as neither device's, so the merge that filled the
plane is not a step to take back. The surface's own snapshot history stands aside
while a plane is in a room: two histories over one plane would each undo the other's
work.

**Every direction asks whose file it is first.** A document outlives the file in it -
the one preview tab takes another note on rather than being swapped for another
document - and the pairing of documents to rooms is worked out in an effect, which
cannot be synchronous with the click that moved it. So for that beat a room is joined
to a file these words are no longer, and a change either way would write one file over
another. Both rooms ask the same question in the same way, `holds`, answered by how
many files the document has held; a plane refuses a push, an arrival, an undo and the
merge itself when the answer is no. Nothing hands a canvas tab another canvas today,
so a plane room is only ever asked and only ever answers yes - the guard is there
because the question is the room's rather than the note's, and a room that refuses
what is not its file is not a thing to remember to add on the day a canvas tab learns
to preview. See `rooms.svelte.ts`, `rooms/plane.ts` and `rooms/bind.ts`.

**What the file sync does** is what it already did for notes, unchanged: a canvas in
a room is neither pushed nor treated as a disagreement, because the room carried
every stroke and writes the file itself. A canvas that is *not* in a room still
merges the two copies rather than leaving a conflict file, exactly as before.

**A reader sees every stroke and can add none.** The door is the same door, and it
tells the room whether this socket may write exactly as it does for a note; the room
drops the messages that would change the plane. The surface refuses first, so nobody
is shown a gesture that would be refused: every gesture on a canvas ends in exactly
one `edit`, and a plane in a space shared to read takes none.

**Presence** is the note's presence said in the place a plane has: a small dot in the
other device's accent where its pointer is, its name beside it for a second and a
half after it moves, and the same stack of dots on the tab. The names follow the same
rule, so two of one person's machines are told apart by machine and two people by
person; the reader decides, not the sender. The layer is one SVG inside the plane's
own transform, drawn with the same outline the export draws with, so a pan costs
nothing and a stroke never looks one way live and another once it lands.

### What it costs

Measured the same way and on the same machine as the note figures above: an ARM64
Windows laptop running the Worker under `wrangler dev` on the emulated x64 runtime,
with three browser contexts beside it. Reported by
`apps/desktop/test/e2e/draw-together.py`, which draws with real pen events and reads
the pixels back off the other device's ink.

| | budget | measured |
| --- | --- | --- |
| A stroke of 300 points reaching a second device | under 150 ms | **36 ms**, best 32 ms, over five crossings |
| A plane of 500 strokes joining a room, cold | under 500 ms | **453 ms**, from opening the file to the room and the plane being one |
| A plane of 5,000 strokes joining a room, cold | under 500 ms | 1,099 ms; see below |
| A plane of 500 strokes on a device | - | about 4.3 MB of heap, for a 602 KB file |
| A plane of 5,000 strokes on a device | - | about 33 MB of heap, for a 2.8 MB file |
| A room in storage | - | smaller than the file: 216 KB against 602 KB for 500 strokes, 1.5 MB against 3.9 MB for 5,000 |

The crossing is the number that matters and it is structural rather than lucky. What
goes on the wire when a pen lifts is one map entry, worked out by comparing object
identities: every operation on a canvas hands back the very same objects for what it
did not touch, so telling what changed never walks the plane. Coming back the other
way is the same in reverse - what the room says changed names the ids, and every
object the reader already held comes back as the very same object, so the traced
outlines of the five thousand strokes that were already there are still cached and
the layer is not repainted.

Two things did not meet their budget, and both are honest.

A plane of five thousand strokes joins in about a second rather than half of one. It
is not the room: the file alone is 2.8 MB and reading, parsing and painting it is
most of that second, which is what opening such a canvas costs whether or not anybody
else is in it. The room's own share is the 1.5 MB update and the twenty-five
milliseconds it takes to read five thousand entries back into a canvas. A plane of
five hundred strokes, which is a full page of handwriting, joins inside the budget.

And a canvas file is far larger than it needs to be. The format writes JSON with
tabs, which puts every one of a stroke's numbers on a line of its own: five thousand
strokes of twenty points is a 6 MB file, past the four megabytes a note may be, so
such a plane cannot be stored on an account at all. The room holds the same drawing in
2.2 MB. This was left alone deliberately - the settle has to write the file
`format.ts` writes today, or a canvas stops being byte for byte what Obsidian handed
back - but it is the next thing worth changing about the format.

The numbers above are from a quiet machine, and what they are sensitive to is the
machine rather than the design, exactly as with the note figures. The same run with a
build still finishing beside it gave 52 ms for a crossing and 788 ms for the five
hundred strokes; both are the emulated runtime and three browser contexts contending
for one laptop, and neither is what a deployed Worker and two real devices look like.

## Sharing

A room holds whoever may reach the note, and until a space could be shared that
was one person's devices. This is what changed to make it people.

**A role, per space, per person.** Three of them, ordered: `read` pulls the notes
and joins rooms without writing in them, `write` edits everything inside the
space, `owner` is the space itself - its name, its icon, publishing it, deleting
it, and who else is in it. The line is worth saying plainly, because it is the
one thing anybody has to learn: **a writer writes in a space; the owner decides
what the space is.**

**A membership is an address, not an account.** `space_members` is keyed by
`(space_id, email)` and points at no user row at all. Accounts are keyed by the
same address and there is exactly one address per account, so the two meet on
their own: a row written for somebody who has never used Nib is already theirs
the first time they prove that address. Nothing has to be migrated when they sign
up, and nothing has to be reconciled if they never do. The owner is not a row
here - a space already says who owns it, and a second copy of that fact is a
second thing to keep true.

Most of the model is `services/sync/migrations/0015_space_sharing.sql`, and it is
four tables: `space_members` above, carrying the invitation that was sent to each
row and when it stops being a shortcut; `space_links`, one per space, with its
role and its mode; `space_requests`, whoever followed a link that asks first and
what that link promised them, kept so that changing the link afterwards does not
change what somebody was already offered; and `mailed`, which is only when an
address was last written to.

`0016_guests.sql` adds three more for the person who has no address to be keyed
by: `guests`, `guest_sessions` and `guest_members`. See **Getting in without an
account** below, which is where the rest of that lives.

Two later ones belong to sharing as well. `0018_limits.sql` is `limits`, one row per
ceiling and per thing counted, and `mailed_days`, which is which addresses have
heard from Nib today; `0020_room_sockets.sql` is who has a file open, which is what
lets a revocation reach the sockets it has to close - all of them, in rounds of
fifty rooms, because the fan-out of one request is what wants a ceiling and how
much of somebody's access ends does not: fifty rows in one query left the
fifty-first room open, and a room nobody told goes on writing.

**One query answers everything.** `reachedSpace` in `spaces/space.ts` joins the
space to the membership and returns the role, or nothing at all; `atLeast(role)`
is the middleware in front of every route that names a space. A space nobody may
reach is a 404, exactly as an id from another account has always been, and one
they may reach but not at that role is a 403 - a different thing to say, because
the space is theirs to see and this button is not theirs to press.

It takes a *person* rather than an account, which is one of two things: the
account whose session the request carries, joined on the address, or the guest a
link handed one to, joined on the guest. `Whoever` in `types.ts` is that union and
`who` on the request is where it sits; `user` and `guest` are the two halves of
it, and each is set only on a request that is the one kind. A route reads
whichever it needs, and the routes that read `user` are exactly the ones a guest
cannot reach.

| | read | write | owner |
| --- | --- | --- | --- |
| the change feed, reading a note | yes | yes | yes |
| making, writing, deleting a note | | yes | yes |
| bookmarks, the files beside the notes | | yes | yes |
| the connector's `write_note` | | yes | yes |
| the room's socket | read-only | yes | yes |
| renaming the space, its icon | | | yes |
| publishing, and the domain | | | yes |
| deleting the space | | | yes |
| Recently deleted | | | yes |
| inviting, roles, the link, requests | | | yes |
| the settings, the storage, the connector | nothing here is per space |

A guest is not a fourth column. It is either of the first two, held by somebody
with no account, and no route may tell the difference: how a person arrived is not
what they may do. `services/sync/test/share.test.ts` runs the whole table above
against five holders for that reason, two of them guests. What a guest cannot do
is anything in the last row - which is nobody's role, being account-wide rather
than per space, and is where the whole of the difference lives.

Recently deleted is the one that could have gone either way. Deleting a note is
a write, so putting it back looks like one too. But what Recently deleted really
gives back is storage, and the storage a shared space uses is its owner's: a
writer emptying their own would reach into somebody else's account and take away
notes for good. So it holds the account's own spaces and nothing else. A writer
who deleted something still has it in their own machine's trash, and the owner
still sees it in theirs.

Two things are nobody's role. Images and PDFs are stored per account and served
by hash, so a writer's paste is their own blob and costs their own quota. And the
settings are per account rather than per space, so there is nothing there to
check; the two things a space itself keeps - its bookmarks and its file list -
are in the table above. The file list has a rule of its own worth saying: an
entry is kept when the account sending the list holds its bytes **or when the
space is already serving them**, so a writer's list, which names PDFs they are
keeping no bytes for, adds their own without dropping anybody else's.

Quotas moved with all this: a note written in a shared space counts against the
**owner** of the space, because that is whose storage the bytes land in. Before
this it was counted against whoever was writing, which for one person was the
same number and for two would have been a way to fill somebody else's account.

**Getting in without an account.** If somebody shares something with you, you
should not have to sign in to see it. The first version of all this ended at the
emailed six-digit code, which is the right check for an address and the wrong one
for a link: a link anybody may follow names nobody, so there is no address to
prove, and asking for one anyway is a sign-up wearing a different hat. So a link
is now its own proof, and which proof it is depends on which link. All three end
at `POST /v1/join/:token`, which is also what somebody waiting asks again; the
whole of it is `services/sync/src/spaces/join.ts`, and the app's side is
`joining.svelte.ts` with `JoinSheet.svelte` for the two moments that need a word.

**A mailed invitation is proof of its address.** The row is written at once, so
the owner sees the person in the sheet immediately, and a mail goes out with a
link to `nibeditor.com/join/<token>`. Following it establishes the session for
that address, the way a magic link does, and lands in the space: no code, no
sign-up, nothing on screen at all. Holding the mail is holding the address, which
is the same thing the code was ever checking. The token is random, hashed at
rest, bound to the space and the role, expiring, and **single use** - it is spent
the moment it works, because what it hands out is a session nobody typed a code
for. A used or expired link says one line, and the code is still there behind it.
The membership was never the link's to take away, so the address still opens the
space; only the shortcut has run out. A link written to one address still opens
nothing for an account signed in as another. Nothing at all happens on the `GET`,
which is what a mail client follows.

**An open link asks nothing.** Following one creates a **guest**: a session with
no account behind it, in that one space, at that role, at once. For reading that
is the whole story. For writing the guest is given a name from the device it
arrived on - "Emil's iPad" is not knowable from a browser, so it is the platform
and a short word, "Windows wren", exactly the answer the carets already give a
device - and one tap renames it, from the person button at the foot of the rail or
from the Account pane. That name is what the other people in the note read over
the caret, because a guest is a person in a space like any other. The model is
`services/sync/migrations/0016_guests.sql`: `guests`, `guest_sessions` hashed and
expiring like an account's, and `guest_members`, which is a role per space and one
`joined_at` that says whether they are in.

**A link that asks first asks one field.** A name or an address, unverified,
because the owner has to have something to accept or decline. The guest is made
straight away with a `guest_members` row whose `joined_at` is null, which is the
request; the owner is mailed, and the guest waits on a page that is one line and
a slow pulse. Accepting sets `joined_at` and the page turns into the space;
declining stamps `declined_at` and the page says so, rather than only stopping.
Asking again is the same request as walking through, so the wait is one endpoint
polled every three seconds and no second protocol. The link is remembered under
`nib:waiting`, so closing the tab while the owner thinks about it goes back to
waiting rather than to nothing.

**A guest persists, and can be claimed.** The guest token lives in the same
store as an account's - `nib:session`, and the plugin's vault with it - so a guest
who closes the tab comes back as the same guest with the same name. Two things
turn one into an account, and both are the same person turning up: the **device**
signing in, which the app says by handing its guest token to `POST
/v1/auth/verify`, and an **address** being proved that a guest had said it was at.
Either way the `guest_members` rows become `space_members` rows keyed by the
address, and the guest is deleted, sessions and all. Only what they were actually
in moves: a request the owner has not answered stays with the guest, because
`space_members` has no way to say "still waiting" and writing one would turn an
unanswered request into a way in. A role the owner had already given that address
wins over the link's, because a link is how somebody arrived and not what they
are. The mirrors on the machine follow: a guest writes its folder list with no
account stamped beside it, and an unstamped list belongs to whoever signs in
next, which is the rule that was already there.

**What a guest may reach, and nothing else.** `guestMayReach` in
`services/sync/src/guests.ts` is the whole of it, written as what is allowed
rather than what is refused, so a route added tomorrow is closed until somebody
says otherwise. It is: who they are and the one thing they can change about it
(`/v1/me`), the spaces their links granted and what is inside them (the listing,
the change feed, the notes, the bookmarks and the file list), and letting
themselves out. The room's socket is not on that list and does not need to be:
`/rooms` sits outside the `/v1` guard, and the door admits a guest on the same
union of sessions it uses for everybody, which is where a guest's role in a
space is already known. Everything else under `/v1` answers 403 "sign in to
do that": no settings, no storage of their own, no Recently deleted, no
connector, no publishing, no sharing - which is a space being given away, and
nobody's to do with a link they were handed. Two more follow from having no
account: a guest's file list adds nothing, because a guest holds no bytes
anywhere, and a pasted picture stays beside the note instead of going up. Images
already answer to anybody who asks by hash, so a guest reading a note sees its
pictures without being able to add one. The client mirrors all of that - the
Publish and LLM panes are not in the list, the Share sheet is not offered, and
`account.accountToken` is what everything account-wide asks for rather than a
session - but the client is politeness and `guestMayReach` is the enforcement.

Revocation works as it does for a member: the owner takes them out, the space
stops being listed, and the next pass takes the folder with it. A guest with
nothing left to reach is nobody, so the row goes and the session with it, and the
device is back to the app it had before the link.

Redemption is rate limited on the door rather than on whoever knocks, because a
link anybody may follow is a door with no lock: at most twenty guests through one
space's link in a minute, two hundred in the space at once, and two hundred people
waiting on it. Only the guests who are actually in count towards the second, or a
link two hundred people had knocked on once would have stopped working for ever
with nothing the owner could do about it; a row nobody answered, or that was
answered with no, runs out after a month and the nightly job takes it away.

A read-only visitor, whether a member or a guest, sees the space in the rail like
any other, opens its notes, and finds an editor that will not take a keystroke and
a strip that says so; their menu on that space offers an icon and a way out of it
and nothing else. Nothing they do reaches anybody, and the file sync never offers
their folder to the account: a space shared to read only comes down. The desktop
app registers no URL scheme, so a link opened there opens the web app; it is the
same session either way.

**The link.** One per space, with a role and a mode. `open` hands out a guest to
anybody who follows it; `approval` turns the same link into a request the owner
accepts or declines, and the owner is told by mail that somebody is waiting.
Changing what the link hands out changes it for the copy already in somebody's
message, which is what an owner means by changing it; a link that should stop
working is revoked, and the next one is a new token. It is the one secret here
stored as it is rather than hashed, because the owner has to be able to copy it
again tomorrow and a hash cannot be read back. Revoking it does not take back
what it has already handed out, exactly as it does not for a member: those people
are in the space now, and the sheet is where they are taken out of it.

Mail is rate limited per address, at the same thirty second gap the sign-in code
keeps and for the same reason: it is the person receiving it who is protected,
whoever asked for the send. Two ceilings sit above that gap, in
`services/sync/src/limits.ts`, and they are about the service rather than about one
person: how many messages one machine may cause in an hour, and how many people
Nib writes to in a day. The gap is silent - saying it would tell an owner whether
somebody else had just written to that address - and a ceiling answers 429 and says
which. An owner is also told at most once an hour that somebody is waiting on any
one space, because what they need to know is that somebody is at the door rather
than how many times it was knocked on. The membership is written whether or not the
mail went, because a mail that could not go out is not a reason for the sharing not
to have happened.

**The door, and a reader in a room.** The query at the top of
`services/sync/src/rooms/index.ts` now answers three things in one round trip -
whether the session is live, whether the note is in a space the person behind it
can reach, and what they may do there - and passes the room two: `x-nib-write`,
which is the bit, and `x-nib-who`, which is an id and nothing else. The room keeps
both on the socket, beside the carets that socket announced, so an object that
slept still knows. A message that would change the text is then dropped before it
reaches the protocol; `isEdit` in `@nib/rooms` is what tells one apart, and a
reader may still ask what the room holds and say where their caret is. The room
learns nothing else about anybody: the id is a string it cannot look anything up
with, and the one thing it is for is below.

The `me` half of that query is a union of the two session tables, so a guest's
token opens a socket the same way an account's does and the room cannot tell them
apart either. A guest whose request the owner has not answered has no `joined_at`
and gets the same 404 a stranger does: waiting is not being in.

The bit is read at the door, and again where it can change. A socket is not a
request, so nothing about it is decided per keystroke; instead the routes that end
or narrow somebody's access tell the rooms that person has open, inside the same
request. Which rooms those are is what `room_sockets` is for: a room writes a row
as a socket joins and takes it away as one closes, so an owner taking somebody out
reads a handful of rows rather than waking every note of the space. The socket is
closed, or its bit set to reading, before the answer goes back to the owner. A room
that cannot be reached at that moment leaves a socket open on something that is no
longer true and the next handshake corrects it; that is the whole of the gap, and
it is a gap in a room rather than in the API, which is decided per request as it
always was.

On the client
the editor is read-only for the same reason and by the same rule, per pane,
because the pane beside it may be showing a note of this account's own - the
machinery was already there, in `packages/editor/src/modes.ts`, and it already
lets changes from outside the editor through, which is what keeps a reader's view
live while the others type.

**On this machine.** A shared space is mirrored into a folder like any other, and
two things about it are not like any other. It never takes a folder of the same
name that is already here: pairing by name is a guess that this folder is that
space, and the guess is only safe about a space this account made itself, so
somebody else's Work is adopted beside your Work rather than into it. And when it
stops being listed it goes, rather than being uploaded again - a space somebody
shared is theirs to say exists, and "missing" there means the sharing was taken
back. Both rules are in `space-plan.ts`, which is a pure function and is tested
as one. Deleting such a space from the rail leaves it instead: it is not this
account's to delete, and the same gesture ends the membership and takes the notes
off this machine only.

Two things guard that second rule, because it is the one that reaches into a
disk. The folder goes to this device's trash rather than for good: a space
somebody stopped sharing is in nobody's Recently deleted, so the copy here is the
last one of what was read here. And the mirrors are stamped with the account they
belong to, so signing into a different one on the same machine starts from
nothing rather than reading one account's folders as the other account's
absences. A stored list from before that stamp is taken as the account signing
in now, which is who it was about: that machine had no other.

The rail's order is the last small thing. `position` is a column on the space, so
a member reordering their rail would move the owner's; the order endpoint touches
only spaces the account owns, and a shared space sits after them. Bookmarks stay
here too for a space shared to read: the account would refuse the list, and
asking on every pass is a refusal on every pass.

**What is deliberately still open.** An image or a PDF belongs to the account
that pasted it, and giving it back takes the object away once nobody else keeps
it - so a writer who leaves and clears their storage takes their pictures out of
a note that still links them. Reference counting a blob across the spaces it is
seen in is a piece of work of its own, and this is the same thing that has always
happened to an image in a published blog. It is the only edge here that ends with
somebody looking at a broken picture rather than at a refusal.

## What it looks like

One sheet, from the space's own menu and from the palette, and two cards in it.

**People.** The address field first, because putting somebody in is what the
sheet is opened for: one field with the role inside it at the right end, Enter or
the arrow beside it to send, several addresses at once separated by commas,
semicolons or spaces, and a quiet line under it for something that is not an
address - which is said here rather than after a round trip. Then `Who has
access`: the owner with `(you)` and a fixed `Owner`, then everybody else, each a
rounded square with their initial in their own colour, their name, their address
under it, and one menu at the far end holding what they may do, the invitation
again if they have not opened it, and `Remove` in red. Whoever is waiting on a
link that asks first sits at the top of that card, in the accent, with Accept and
Decline.

**Link.** `Link`, a dot that says whether it is live, and one switch. Under it,
greyed until the switch is on so that turning it on fills the card in rather than
growing it: a globe and `Anyone with the link` with what it hands out as a menu,
`Ask first` as a switch under that sentence, the link itself beside `Copy link`,
and `Reset link`, which revokes and mints another under one press so the sheet
never shows the moment in between.

A space somebody else is in carries a quiet mark on its row in the switcher,
`SharedMark.svelte`, which is the same mark the file list draws on a shared
note. It used to be a dot in the accent, and a dot on a tab means a note not
written down yet: one shape was saying two unrelated things, so the dot is the
saving dot now and anything about other people is a mark.

A guest the link let in is a row in the same two lists, named by the name their
device gave them, with `Guest` under it where a member has their address - and
with what they typed about themselves before it, when they typed something,
because that is what they said rather than what was proved. One list and not two,
because what the owner is being asked is the same question either way.

Whoever followed a link and was owed a word gets `JoinSheet.svelte`, which is the
sign-in's panel again: the sentence about who shared what, and then either the one
field a link that asks first asks for, or a line and a slow pulse while the owner
thinks, or a line saying the owner said no, or a line saying the link opens
nothing with the sign-in behind it. Every other link draws nothing at all, which
is the point.

## Cloudflare

Durable Objects, SQLite-backed. Confirmed against this account with `wrangler`:
SQLite-backed objects are already in use here, and the account is on Workers Paid.
SQLite-backed objects have been generally available since 7 April 2025 and are
what the free plan has always had; a new class **must** be declared as one.

```jsonc
"durable_objects": {
  "bindings": [{ "name": "ROOMS", "class_name": "NoteRoom" }],
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["NoteRoom"] }],
```

`new_classes` there instead of `new_sqlite_classes` fails to deploy on accounts
with no existing key-value namespace, and since 9 July 2026 no new ones can be
made at all. The configuration was proved with `wrangler deploy --dry-run` before
anything else was written, because the deploy job on main runs `wrangler deploy`
and a Worker that will not deploy takes the website with it.

Canvases added no tag and no binding. `NoteRoom` holds a plane as readily as it
holds a note, and a migration is the one part of a Worker's configuration that
cannot be taken back, so not needing one is worth the small awkwardness of a class
called `NoteRoom` that also holds canvases. Renaming it would itself want a
`renamed_classes` migration, which is a real risk for a better name.

## What it costs

Measured on one machine running all of it at once: an ARM64 Windows laptop with
the Worker under `wrangler dev`, whose runtime is the x64 build under emulation,
and the browsers beside it. A pessimistic setting - the round trip goes through a
local proxy a deployed Worker does not have - but an honest one, because nothing
here is a simulation.

| | budget | measured |
| --- | --- | --- |
| A keystroke, in a 100 KB note | under 16 ms | costs the keystroke, not the note: a hundredfold note stays under 8x, asserted in `bind.test.ts` |
| A letter crossing to another device | under 150 ms | **30 ms**, best 23 ms, over ten crossings |
| A 100 KB note joining a room, cold | under 300 ms | **225 ms**, from opening the note to the room and the file being one text |
| A room in memory | - | about 90 KB for a 100 KB note: the note's own characters and little else, because consecutive typing is one item |
| A room in storage | - | 100 KB for a 100 KB note, snapshot plus log |

The keystroke number is the one that matters most and it is structural rather than
lucky: a change set is the size of the change, and the shared text takes one
insert at one position, so nothing on that path walks the note.

Two things were measured and then fixed, and both were worth several times the
budget. Writing every update to the object's storage as it arrived cost a
keystroke a durable write, which showed as a letter taking over a second to cross
when a few were typed in a row; updates now wait in memory and go down at the
settle. And the door to a room asked the database three questions - the session,
the note, the space - where one does; that took a cold upgrade from 754 ms to
under 200 ms.

What the numbers are sensitive to is the machine rather than the design: the same
run on the same laptop with a few stray runtimes left over from earlier runs gave
146 ms for a crossing and 627 ms for a join. Both are the emulated runtime and the
browsers contending for one laptop, and neither is what a deployed Worker and two
real devices look like. The numbers above are from a quiet machine.

## Tests

- `packages/rooms` - the wire, both ends of it, which of its messages would write
  into a room, and the fold that puts a note written while away back into one.
- `packages/rooms/src/plane.test.ts` - a canvas as a document: a file seeded in and
  read back out byte for byte, a stroke of three hundred points as one entry,
  concurrent edits to different objects and to the same one, two strokes drawn at
  once, a delete travelling, a card put back losing its tombstone, an object the
  room did not touch coming back as the very same object, and the room settling to
  what merging the two files would have given.
- `services/sync/test/rooms.test.ts` - the room itself, driven with storage in a
  Map and sockets that record what they were sent: the greeting, two devices
  converging, a device that was away, the settle writing the note, the log folding
  into a snapshot, waking up, asking the devices that were here for what it slept
  through, the door turning away a stranger, the door telling the room what each
  person may do, and a reader who sees every keystroke, keeps a caret, and cannot
  add a letter by any of the three ways there are to try. Then the same room about
  a canvas: opening on the file the store holds, a stroke of three hundred points
  crossing whole, two devices drawing at once, one card moved here and coloured
  there, the settle writing the file `format.ts` would have written, a reader who
  sees every stroke and can add none, five thousand strokes folding into one
  snapshot, waking up still knowing it is a plane, a delete staying deleted, and
  the door reading the kind off the name of the file. Then the same door for a
  guest a link handed a session to: in at the link's role, told the kind for a
  canvas exactly as for a note, and given the stranger's 404 while the owner has
  not answered.
- `services/sync/test/share.test.ts` - every route that names a space, asked by
  everybody there is to ask: the owner, a writer, a reader, a guest who may write
  and a guest who may read, plus a stranger. A hundred and forty-odd cases from
  one table, so a route added without a role check is a failing test rather than a
  hole, and a route that can tell a guest from a member is one too. Then
  invitations and links end to end over the API, somebody who had no account when
  they were invited, the mail's rate limit, roles changing under somebody
  mid-session, whose quota a shared note costs, and what the connector will and
  will not do in a space it was lent.
- `services/sync/test/guests.test.ts` - getting in without signing in, which is
  every way there is: the mailed link opening its account with nothing typed, and
  once only; the open link handing out a named guest who reads, writes, or is
  refused the keystroke; the link that asks first taking one field, waiting, and
  turning into the space or saying no. Then what a guest may not reach, one case
  per account-wide route, a space no link gave them, a session that ran out, being
  taken out by the owner, and the two ways a guest becomes an account - the device
  signing in and the address being proved - including what does not move with
  them.
- `apps/desktop/src/lib/sharing.test.ts` - what the app believes it may do in a
  folder, and what each control on the Share sheet actually asks for, for a member
  and for a guest.
- `apps/desktop/src/lib/joining.test.ts` - which of the join page's states each
  kind of link ends in, and what it asks for on the way: nothing at all for a
  mailed link or an open one, one field for a link that asks first, and one line
  for a link that opens nothing. Also that the wait is picked back up on the next
  launch, and that a guest is never asked what should become of the notes already
  on the machine.
- `apps/desktop/src/lib/account.test.ts` - the session store, including the guest
  one: what `me` answers, what everything account-wide asks for instead of a
  session, and the guest token being handed to the sign-in so what a link lent the
  device follows it in.
- `apps/desktop/src/lib/space-plan.test.ts` - a shared space never taking a
  folder that is already here, and going when the sharing is taken back.
- `apps/desktop/src/lib/sync.test.ts` - a shared space arriving as a folder, one
  shared to read never being written back to, leaving one rather than deleting
  it, the folder of one that stopped being shared going to this device's trash
  rather than for good, the mirrors belonging to one account, and the first pass
  of a session: scheduled for now rather than for an interval, counted against
  what the account says it holds, and quiet on every machine that has synced
  before.
- `apps/desktop/src/lib/arriving.test.ts` - the surface that first pass holds,
  on its own: waiting before it knows a number, counting, lifting, and the way
  out that keeps a connection which never comes back from being a trap.
- `apps/desktop/src/lib/move-targets.test.ts` and `longpress.test.ts` - where a
  row may be moved to when a finger cannot drag it, and the rule that decides
  whether a press was a press.
- `apps/desktop/src/lib/rooms/bind.test.ts` - the binding: convergence, both
  orders of arrival, offline edits, undo staying yours, and the keystroke cost.
- `apps/desktop/src/lib/rooms/plane-bind.test.ts` - the same for a plane: two
  devices drawing at once and in either order, a card moved here and coloured
  there, a device that drew while it was away, undo taking back what this device
  drew and refusing to touch what somebody else drew, joining not being a step to
  take back, and what a stroke costs a plane forty times the size.
- `apps/desktop/src/lib/rooms/switching.test.ts` and `rooms/plane.test.ts` - a tab
  that has moved on to another file with its room still joined, for a note and for a
  canvas: what is typed or drawn in the new file never reaches the old file's room,
  what another device writes in the old file never reaches the new one, a room
  answering inside that beat neither folds nor binds, a room that has been left
  carries nothing, and undo cannot reach across the switch.
- `apps/desktop/src/lib/canvas/store.test.ts` - the surface's own end: a plane
  shared to read taking no edit and writing nothing, an edit in a room going to the
  room rather than into a local history, and what arrives being on screen at once
  and in the file a moment later.
- `apps/desktop/src/lib/rooms/hands.test.ts` - what a hand carries, the stroke
  under the pen arriving whole, a pen lifted leaving the pointer, a live stroke
  belonging to nobody, and the same name rule the carets follow.
- `apps/desktop/src/lib/rooms/peers.test.ts` - where a caret is, and whether it
  is labelled with the machine or with the person.
- `apps/desktop/src/lib/sync/mirror.test.ts` - the file sync leaving a note in a
  room alone, and still writing a conflict copy for one that is not; and the same
  for a canvas, which is merged rather than copied when it is in no room.
- `packages/editor/src/carets.test.ts` - what the carets draw and where they move.
- `apps/desktop/test/e2e/collaborate.py` - two browsers, real keystrokes, the
  Worker under `wrangler dev` on workerd, a real Durable Object. Asserts that both
  converge and that the account ends up holding what they hold, photographs the
  remote caret and the tab's dots, and reports the timings above. It builds the
  app, starts everything and stops everything again.
- `apps/desktop/test/e2e/draw-together.py` - two browsers on one plane, with real
  pen events carrying pressure and tilt. Times five strokes of three hundred points
  crossing by reading the pixels back off the other device's ink, photographs the
  line being drawn with the other hand's pointer and name on it, has both browsers
  draw at once and asserts that they and the account end up holding one file byte
  for byte, and times a plane of five hundred and one of five thousand strokes
  joining cold.
- `apps/desktop/test/e2e/share.py` - five browsers that know nothing about each
  other, and not one of them types anything to get in. The owner opens the Share
  sheet from the rail and invites an address; that address has no Nib account,
  follows the link out of the real message the runtime's mail binding was handed,
  and is in the space with no form on screen - which the run asserts by looking for
  the sign-in's field and its digit boxes and finding neither. They write in the
  same note as the owner with each caret carrying the other's name, and the same
  link a second time says it opens nothing. Then the link the space holds, three
  times over: a guest who arrives named after their device, renames themselves in
  one tap and is that name on the owner's screen; a second guest, once the link
  hands out reading, who sees the note, cannot type into it, and is offered nothing
  to change; and a third, once it asks first, who gives a name, waits on a page
  that says so, and is in the moment the owner presses Accept.

The Worker's own suite runs against Node's SQLite rather than on workerd, which is
how it was already written; the room is tested the same way, with the runtime
stood in for, and gets its workerd coverage from the end-to-end run. Adding
`@cloudflare/vitest-pool-workers` for one file would mean a second Vitest project,
`isolatedStorage: false` because WebSockets and Durable Objects are not supported
with it on, and a dependency whose isolated storage was removed and reinstated
across the Vitest 4 migration. It was not worth putting the deploy job's tests
behind that.

[jupiter]: https://dl.acm.org/doi/10.1145/215585.215706
[wave]: https://svn.apache.org/repos/asf/incubator/wave/whitepapers/operational-transform/operational-transform.html
[eg]: https://arxiv.org/abs/2409.14252
[figma]: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
[figma-code]: https://www.figma.com/blog/building-figmas-code-layers/
[obsidian]: https://obsidian.md/help/sync/troubleshoot
[relay]: https://github.com/No-Instructions/Relay
[notion]: https://www.notion.com/blog/how-we-made-notion-available-offline
[yjs]: https://github.com/yjs/yjs/blob/main/INTERNALS.md
[loro]: https://github.com/loro-dev/loro
[dt]: https://josephg.com/blog/crdts-go-brrr/
[sharedb]: https://github.com/share/sharedb
[sun]: https://arxiv.org/abs/1905.01517
[hard]: https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html
[interleave]: https://martin.kleppmann.com/2019/03/25/papoc-interleaving-anomalies.html
[yps]: https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md
[ydo]: https://github.com/napolab/y-durableobjects
