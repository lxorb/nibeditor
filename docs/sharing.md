# Sharing

Sharing used to be about a space. A space is the drawer: notes belong to one,
publishing is a property of one, and everything keyed by a space id meant
"everything in here". But a space is not what people hand each other. What
people hand each other is a note.

Asking somebody to make a space so they can share one plan with one person is
asking them to reorganise their writing to fit the wire. So a share now targets
either the whole space, as before, or one item: one note, or one canvas.

This is the reasoning. The how is `services/sync/src/spaces/share.ts`,
`join.ts`, `rooms/index.ts`, and on the app side `sharing.svelte.ts`,
`ShareSheet.svelte`, `SpaceSwitcher.svelte`.

## One column, not three tables

The obvious way to build item sharing is three new tables: `item_members`,
`item_links`, `item_requests`. That is also the wrong way. Everything sharing
already knows how to do would have to be written a second time: who is in it,
who is waiting, how a link hands out a guest, what an invitation is, how many
people fit, what happens when somebody signs in. Two copies of that is two
places for the rules to drift apart, and the drift always lands on the security
side.

So the four tables sharing already has grow one column, `item`:

- `space_members` - who else may reach it, by email address
- `space_links` - the one link, and what it hands out
- `space_requests` - who is waiting on the owner
- `guest_members` - whoever a link let in, with no account behind them

Empty means the space, which is what every row written before today meant. A
note id means that one file and nothing around it. Everything else is untouched:
the roles are still `owner` / `write` / `read`, an invitation is still an
address, a link is still a link, a guest is still a guest, approval links still
ask first, and the quotas still count against whoever owns the space.

Empty and not null, which is what "no item" reads like in prose. A key has to be
able to say when two rows are the same row, and SQLite does not treat one null as
equal to another: `(space, email, null)` twice is two rows, so an invitation sent
twice would be two memberships and the upsert behind it would never fire. The
empty string is a value, and one no note id can be. Migration `0026` rebuilds
the four tables with `item` in each primary key, because SQLite cannot be asked
to change one in place.

Item ids are note ids, not paths. A note keeps its id when it is renamed or
moved, so a share survives both. A share keyed by path would break the first
time somebody tidied a folder, and would quietly follow whatever file landed at
that path next, which is worse.

## What an item share reaches

An item share reaches the file, and the pictures and attachments inside it, and
nothing else.

The pictures need no code at all, which is the nice part. Images and PDFs are
already capabilities: they go up as blobs addressed by the hash of their
contents, and `/i/{hash}` serves one to anybody who asks, with no session - a
published page has no reader to authenticate. So a shared note's pictures arrive
because they always did, and they are read-only because a blob is read-only: you
cannot change bytes that are named after themselves. Nothing about the space's
file list is reachable, so a shared note cannot be used to enumerate what else
is in the drawer.

The line is drawn in exactly three places:

**The room's door** (`rooms/index.ts`) is where an item share means something. It
already asked one question in one round trip - is this note's space one the
person behind this socket can reach, and as what. It now asks it with four
joins instead of two: the space membership and this file's membership, for an
account and for a guest. Each matches at most one row, because the item is part
of the key, so it is still one row and one round trip. Where somebody holds both
- a reader of the space who was given this note to write in - the room is told
the stronger of the two: what they may do to this file is the most any of it
allows.

**The space routes** (`reachedSpace` in `spaces/space.ts`) deliberately do *not*
see an item membership: they join on `item = ''`. So the listing, the change
feed, the bookmarks, the folder icons, the graph and the space's own Share sheet
all answer 404 to somebody holding one of its notes. Not 403 - 404, because that
is what every other unreachable space answers, and a different status here would
be a way to ask whether a space exists.

**The note routes** (`reachedNote` in `notes.ts`) ask the space first and fall
back to the one file. Somebody who holds the space costs one query and never
takes the second path. The narrower reach is narrower than a role: the words are
theirs to write, and the file itself is not. Renaming it, moving it and deleting
it are all refused with 403, because all three reorganise somebody else's space
from inside a tab that cannot even see it. What they can do instead is hand it
back: `DELETE /v1/shared/{id}`.

Quotas stay against the space's owner, unchanged, because the bytes land in the
owner's storage whoever typed them. That was already true of a space writer.

## One set of routes, one sheet

Every route under `/share` takes `?item={note id}` and answers about that file;
without it they answer about the space exactly as they always have. The one
exception is `DELETE /:id/share/me`, which is a device letting itself out of a
space and is only ever about the space; letting yourself out of one file is
`DELETE /v1/shared/:id`. One
middleware reads it, checks that it names a live note of this space, and puts it
on the request - so no route can forget it, and a bad id is refused in one
place.

That is what lets the Share sheet be the same sheet. It is the same question -
who else may have this, and at what - and a second sheet for a smaller thing
would be two designs for one idea. What differs:

- the head wears the file's own mark (its chosen icon and all) and its name,
  where a space's sheet wears the space badge
- one hint line, only where the space itself is already shared with somebody:
  "Everyone in the space already has it." So the two levels never look like they
  are contradicting each other.

The People card, the address field, the roles, the link, Ask first, Reset link
and the Waiting list are all untouched.

It opens from the note's row in the tree, from the tab's own menu, and from the
palette when a shareable document is in front of you. All three end at one
function, `shareThisFile` in `sharing.svelte.ts`, so every list that shows a
file can offer it without knowing anything about sharing. The row and the tab
reach it through `shareEntry` in `menu.svelte.ts`, which is the menu row itself;
the palette has no menu to build and asks for the document in front of the
reader instead.

## The recipient: no pseudo-space

A note somebody shared with you is not a space, and nib does not invent one for
it. No folder, no row in the tree, no file on the disk. A folder holding one
borrowed note would be a copy of it, and a copy is exactly what sharing exists
in order not to make.

Instead there is a **Shared with you** section at the foot of the space
switcher. The switcher is already the list of everything you can open, so this
is where things you can open that are not spaces belong. Rows are grouped under
whoever shared them, with the owner's name as a quiet heading over their files
rather than repeated on every row - "who gave me this" is one fact about the
group, and saying it five times is five times too many.

Opening a row opens a tab. The tab's document has **no path**: it is one note out
of somebody else's space. Its words come down once to fill the tab and travel
through the file's room from then on, which is also what writes them into the
owner's space - the same room two people in a shared note already use. So there
is nothing new in the sync: the room is the mechanism, and it already worked.

A file shared to be read is read-only, exactly as a space shared to be read is.
That question used to be asked of the path - what may be done where a file sits -
and a shared file has no path, so it is asked of the document instead:
`canWriteIn(note)`, which the pane, the find bar and the canvas surface all use.

Like every note, such a document has nothing to save and no question on the way
out. The one extra rule is that nothing tries to write it to disk, because there
is no file here for a write to go to: its room keeps it.

A guest sees the same thing through the join page, because a guest is a person in
a file exactly as they are a person in a space.

## Marks

One mark, `SharedMark.svelte`, in the three places it can be said:

- the **owner's** tree row for a file shared on its own. The tree already drew
  this mark when somebody else was in the note right now; a file shared on its
  own draws the same mark when nobody is. It is the same fact about other people,
  one step less urgent, and a second drawing of it is how one design becomes two.
- the **recipient's** row in the switcher.
- the **recipient's** tab, which is the only place it could be said: a shared
  file has no row in the tree to carry it.

The space's own mark and a file's mark are about two different things and neither
implies the other. `sharedAmong` filters `item = ''`, so handing one note to one
person does not light up the whole drawer; `itemsSharedIn` answers which files
are shared, in one query for the whole listing, and rides down on the space
listing as `sharedItems`.

## Revoking

Taking out the last member and revoking the link makes a file private again at
once. There is no state in between and nothing to confirm.

For the recipient: the row disappears on their next read of the list, and every
tab open on that file closes with it. The list rides down with the spaces on
every `loadSpaces`, and while it holds anything it also asks on its own every
fifteen seconds - a file somebody handed over is the one thing in the app that
can be taken away by somebody else while you are looking at it, and nobody who
holds none pays for the asking. A file newly shared with somebody arrives with the
spaces, on the pass that reconciles them, which is the same wait a space shared
with them has always had. That is the calm answer a revoked space
membership already gives, said about one file - the words were never on that
machine, and a tab sitting on a room that will not have it back is not a
document. If a socket is open at the moment of revocation, the room is told
inside the same request (`roomsRevoked`), scoped to that one note: the rest of
what that person holds has not changed, and closing their other rooms because one
note was taken back would be an app flickering for reasons nobody can see.

A note purged from Recently deleted takes its share rows with it. Nothing could
reach a share of a note whose words have gone - every read joins the live note -
but a row nothing can ever use is a row nothing would ever take away, and it is
what a listing and a ceiling still count.

## Ceilings

- 200 people per thing shared, the same number a space holds, for the same
  reason: a sheet that cannot list everybody is a sheet whose owner cannot take
  anybody out.
- 200 files of one space shared on their own, so the owner can always find the
  one they want to end.
- Guests per link per minute, and people waiting, are the same numbers as before,
  scoped to the thing shared rather than to the space.
- Only the owner shares. A writer in a space cannot hand one of its notes on -
  sharing is giving something away, and that is not a writer's to do.

## What is not done yet

- **Pictures dropped into a shared canvas, by a guest.** A shared document has
  no path, and the canvas drop path writes an image beside the file it belongs
  to. An account holder gets past that: `storeImage` in `assets.ts` puts the
  bytes in their own blob store and the plane carries the absolute URL back. A
  guest has no account token, so for them there is nowhere to put it and the
  drop is refused.
- **Folders.** A share targets a note or a canvas. Sharing a folder would be a
  third size of thing, and the space is already the answer for "a group of
  notes".
- **The item does not appear in search or the graph** on the recipient's side.
  Both are drawn from a space's own listing, and a shared file belongs to no
  space the recipient can reach. The tab is the whole of it, deliberately.
