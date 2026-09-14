# Page notes

Sheets of paper in a column, written on with the pen. What Samsung Notes and
Apple Notes are for: a lecture, a meeting, a paper somebody is marking up. A page
note is a tab like a note and like a canvas, and it is the same surface as the
canvas wearing paper - the same bar, the same ink, the same objects, the same
room. See [canvas.md](canvas.md) for the bar and the pen, which this does not
restate.

The one thing this document is really about is the file format, because that is
the decision everything else follows from.

## The file

**A page note is a JSON Canvas file.** Same reader, same writer, same bytes, in
`packages/markdown/src/canvas.ts`. The extension is `.pages`, and that is the
only thing that differs from a `.canvas` file.

```
Lecture 4.pages
{
	"nodes": [
		{ "id": "9a3c…", "type": "group", "x": -397, "y": 0, "width": 794, "height": 1123, "label": "Page 1" },
		{ "id": "b1f2…", "type": "group", "x": -397, "y": 1163, "width": 794, "height": 1123, "label": "Page 2" }
	],
	"edges": [],
	"nib": {
		"version": 1,
		"pages": [
			{ "id": "9a3c…", "paper": "a4", "pattern": "lines" },
			{ "id": "b1f2…", "paper": "a4", "pattern": "lines" }
		],
		"ink": [ { "id": "c7…", "tool": "fountain", "color": "1", "size": 2.4, "points": [ … ] } ],
		"at": { … },
		"gone": { … }
	}
}
```

**A page is a node.** That is the whole design. Everything on a page note already
lives on a plane - the ink, the cards, the pictures, the shapes - and making a
page one more object on that plane means one drag, one merge, one tombstone and
one room for all of it. Nothing in the app or in a room has to know a page from a
card. Only `canvas.ts` does, and only at the moment it writes one down.

**On disk a page is a node the spec names**, so the file is JSON Canvas and
nothing in it is an invention of ours:

- a page with a PDF behind it is a `file` node with `subpath: "#page=3"` - which
  is the spelling Obsidian's own PDF embed reads, and the same one
  `[[paper.pdf#page=3]]` uses;
- a page with nothing behind it is a `group` node with a label.

What the spec has no word for - the size preset and the ruling - goes in one
record per page under `nib.pages`, beside the id it belongs to. A hand-edited file
that lost that record loses the ruling and keeps the page as the frame it looks
like, which is the right way for this to fail.

### Why not a format of its own

A `.pages` file is JSON Canvas because one format cannot drift from itself. The
alternative was a shape of our own beside the PDF, and it would have cost three
readers (the surface, the sync client's merge, the Worker's settle), a second
merge, a second set of tombstones, and a second thing to get wrong. Instead:

- **Obsidian.** Rename `Lecture 4.pages` to `Lecture 4.canvas` and Obsidian opens
  it: the page frames are labelled groups, a PDF-backed page shows that page of
  the PDF, and the cards are cards. The ink is invisible there, which is already
  true of a canvas and is the accepted trade. Rename it back and nothing is lost.
- **The merge.** `mergeCanvasFiles` in `canvas-merge.ts` merges a page note,
  unchanged, because it is the same objects with the same ids and the same times.
  Two devices that each added a page end up with both pages.
- **The room.** `roomKind` returns `plane` for `.pages`, so the shared document is
  `plane.ts`'s map of objects by id and the settle writes `writeCanvas`. No new
  room shape, no new serialiser.

### Why the extension and not a flag in the JSON

Because the only thing both ends of a file can see is its name. A tab, a room and
a Durable Object all ask the name what a file is; a flag inside the JSON is a
question none of them can ask without reading the file first, and the two ends
coming to different conclusions about one file is how a canvas came to be written
over with nothing. See `rooms/kind.ts`, which states that rule once for both ends.

### Why the room kind stayed at two

`RoomKind` is still `'words' | 'plane'`. A third name was considered and rejected:
a page note's shared document has exactly the shape a canvas's does and its settle
writes exactly the same bytes, so a third kind would be a third name for one
thing, and the first thing it would buy is a way for the two ends to disagree
about which of two identical things a file is.

What that buys instead is stronger than a guard: **a file renamed between
`.canvas` and `.pages` is not a crossing at all.** The room keeps its plane, the
settle keeps writing it, and nothing is lost in either direction - where a rename
across `.md` and `.canvas` costs a full changeover (`crossed` in `room.ts`).

The guard that does matter is still there and still fires: `leavesAPlane` refuses
any settle that would read a plane as words, so a page note can never be written
through the note serialiser and come out as the empty string.

## The pages

**Three sizes.** A4 (794x1123), Letter (816x1056), and `long` - as wide as A4 and
as tall as somebody keeps writing. In CSS pixels at 96 to the inch, because
everything else on the plane is in pixels and a page that measured itself in
another unit would be one conversion away from every sum in the app.

`long` is the infinite-height mode. It grows downwards in whole screenfuls when
writing reaches within a screenful of the bottom, after an edit and never during
one, so the paper does not move under the nib. A4 never grows: writing past the
bottom of a sheet of A4 is writing off the sheet, and the page that grows instead
of ending is the one somebody chose for exactly that.

**Four rulings**, the canvas's own: blank, lines (8mm), grid (5mm), dots. Four CSS
gradients and no drawing at all, in the canvas's own `--canvas-dot`, which is the
token that already answers "a faint rule, in whichever theme is on" - so dark and
light are honest without `PagesPage.svelte` knowing which it is in.

**The column is the truth.** A page's `x` and `y` are worked out from the list
rather than remembered: two devices that add a page at the same moment would
otherwise both put it at the same `y` and one page would be under the other. So
`laidOut` derives the boxes from the order, on the way in and on the way out, and
reordering a page is moving one entry.

**A page keeps what is on it.** Reordering a page carries its ink and its cards
with it; deleting a page deletes them. A page is not a frame somebody drew round
their notes - it is the sheet they are on. Which page a stroke is on is where the
pen went down, answered once by `onPage` for the surface, the export and the merge
alike, so a stroke that runs off the bottom of a page never comes out on two pages
or on none.

## Ink and text

One engine, one code path. `Pages.svelte` composes the canvas's own parts:

| What | Where it comes from |
| --- | --- |
| The pen bar | `CanvasBar.svelte`, unchanged |
| The ink layers | `CanvasInk.svelte`, unchanged |
| A card or a picture | `CanvasNode.svelte`, unchanged |
| Somebody else's hand | `CanvasHands.svelte`, unchanged |
| The pen in your hand | `pens.svelte.ts`, `tools.svelte.ts`, module singletons - so the green highlighter you picked on a canvas is still in your hand on paper |
| Building a stroke | `penFelt`, `leadPoint`, `tidied`, `erased`, `strokesInLasso` in `canvas/ink.ts` |
| Palm rejection | `Contacts` and `inks` in `canvas/contacts.ts` and `canvas/pointer.ts` |
| The store | `PagesStore extends CanvasStore` |

`PagesStore` is two hundred lines, half of them the camera arithmetic that holds the
view to the column, and it overrides three methods. The canvas store
grew one `parse`/`serialise` pair for it - additively, tests unchanged - so the
one edit per gesture, the one undo step, the one debounced write, the room binding
and the merge-on-arrival are all inherited rather than copied. Undo is the app's
own undo model: out of a room it is the snapshot stack, in a room it is the room's
own history, so undo takes back what you drew and never what somebody else did.

What is **not** shared is the gesture routing. A canvas's `pointer.ts` machine is
about ports, connectors, handles and an endless plane; a page note has none of
those, and its own handler is forty lines that call the same ink functions. That is
reuse of the engine, not a second engine - but it is worth saying plainly rather
than claiming more than is true.

## The view

A page note is read by scrolling, not panned. The camera is the canvas's camera
with the pan held to the column: the zoom starts at whatever fits the widest page
across the pane, and you cannot lose your pages off the side of a note of pages,
which is the one thing an endless plane lets you do. Zooming in frees the
horizontal pan, because then there is something to the side to see.

### Zooming

**Every way a hand zooms paper, and one rate for all of them.**

| | |
| --- | --- |
| two fingers | a pinch on the paper, about the middle of the two of them, with the pan the middle moves as well. Two fingers mean the paper in every tool: whatever the first was doing, the second takes it over - except ink that has been going for longer than a quarter of a second, which is a hand settling on the glass rather than a pinch |
| Ctrl and the wheel | in and out about the pointer, which stays over what it was over. A trackpad pinch arrives as exactly this on every platform |
| a double tap | the two fits in turn: the width of the paper, and then the whole of the page |
| Ctrl+Alt+= and Ctrl+Alt+- | a notch in and out, about the middle of the view |
| Ctrl+Alt+0 | back to the width, and the paper stays fitted from then on |
| the bar | the two buttons step by a notch; the percentage opens Fit width, Fit page and 100% |

One notch is `NOTCH` in `apps/desktop/src/lib/camera.ts` and nothing has its own:
the bar's own comment said the buttons and the wheel agreed, and they did not -
the buttons stepped by a fifth, the plane's wheel by two fifths and a page note's
by a quarter, which is three surfaces for a reader who uses two of them.
`wheelZoom` is what both the plane and the paper ask now.

**The keys are one modifier over** from the three every browser zooms with,
because those three are the app's own text size and are read off the window after
the surface has had the press: one key would resize the words and the paper at
once. The same trade the plane's Fit made; see [keyboard.md](keyboard.md), which
states the digit rule once.

**How far it is zoomed is said on the paper**, as a badge at the top of the pane,
while the zoom is happening and for six tenths of a second after. The bar carries
the percentage too, but the bar is at the bottom of the pane and a hand pinching
the middle of a page is not looking there. It is the same pill the text size uses
after a pinch - `.nib-pill` in the themes package - because it is the same thing
said about something else.

**The zoom is the reader's, and it is kept.** Until somebody has zoomed, the paper
stays fitted across the pane: the sidebar opening, a pane splitting, a phone
turning. Once they have, nothing takes it off them - including the app being
started again, which used to. The camera came back from `nib:canvas-views` and the
fact that the zoom was chosen did not, so the first measurement fitted the paper
again and threw it away. A `chose` key beside the camera is the whole fix; see
`KeptView` in `apps/desktop/src/lib/canvas/place.ts`.

**What is on the paper is drawn at the zoom; what is not, is not.** The ruling is
the paper's own and scales with it, the way a printed page does. The edge round
each sheet, its shadow, the number in its corner and the sentence a sheet says
when its PDF cannot be read are the app talking, and they are sized in screen
pixels off `unit`, the same unit the canvas draws a handle in. The number used to
be forty-four pixels high on a page zoomed in and four tenths of one on a note
seen whole.

## A page by scrolling

**Carry on scrolling past the last sheet and the next one comes up out from under
it.** That is how a page is added, because it is the one movement somebody makes
at the end of a page note that means nothing else - and it is the same gesture
with a thumb, a trackpad and a wheel.

What happens, in order:

1. **At rest**, the end of the column is the silhouette of the sheet that is not
   there yet: a dashed outline the width of the paper with a plus in it, quiet.
   The view reaches 88 screen pixels past the last page so that band is in reach,
   which is also what makes the gesture discoverable - and it can simply be
   pressed.
2. **Pulling** brings it up on a rubber band: the first pixels are one for one and
   each one after buys less, approaching three times the threshold and never
   passing it. The plus grows, the outline fills in, and it says *Pull to add a
   page*.
3. **Past the threshold** - a third of the page as it is on screen, never less
   than 96 pixels and never more than 160, so it is reachable at any zoom - the
   outline goes solid, the silhouette fills with the colour of paper, and it says
   *Release to add a page*. Letting go there makes the page.
4. **The page lands in exactly the box the silhouette was drawn in**, so nothing on
   screen moves: the overscroll the view was held at is now somewhere it may really
   be, because the column is a page longer, and it is handed over as that in the
   same breath. Then the view slides down onto the new page over four tenths of a
   second.
5. **Short of the threshold**, everything springs back.

**A wheel has no lift**, so its notches are added up and the threshold itself
makes the page; the notches that arrive in the next three tenths of a second make
nothing, which is what turns one long scroll into one page rather than four. When
the wheel stops short, the pull falls back to nothing over a quarter of a second.

**A scroll that did not begin at the end cannot reach it.** A hard flick from the
top of a sixty page note passes the end of the column with hundreds of pixels of
wheel left over, and without this it would make a page out of momentum. So the
gesture may only make one when it *began* with the bottom of the view already in
the lower half of the last page - which is where somebody who means to add a page
is.

**Reduced motion**: no rubber band - the silhouette follows the hand exactly,
which is the reader's own movement rather than the app's - the page is made at the
threshold rather than at the lift, and the view is put on it rather than sliding
to it.

Undo takes the page back, like every other gesture on this surface: one edit, one
step. The arithmetic is `apps/desktop/src/lib/pages/pull.ts`, pure and tested in
`pull.test.ts`; the silhouette is `PagesSlot.svelte`; `addPage` in the store is
the one place a page is put in, which the navigator's own row asks for too.

There is also a named command, **Add a page**, on no key out of the box: the
gesture is the way in and the silhouette is the button, and this is here so a
reader who wants a key can give it one.

## Navigating

Thumbnails in the outline panel's slot - `PagesNavigator.svelte`. In the outline's
place rather than in a panel of its own, because it is the same thing: the shape of
what is open, and a row that goes to a part of it. A note has headings, a page note
has pages.

A thumbnail is the page drawn small through the same `paintInk` the surface paints
with, so what the panel shows is what the page says. Drawn once the changes stop
rather than per stroke: a page of five thousand strokes is a sixth of a second to
rasterise, and the panel is not what the hand is looking at.

Reordering is a drag, the way moving a section in the outline is. The menu on a
thumbnail adds a page after it, deletes it, or changes its ruling. **Page up** and
**Page down** turn a page; the status bar says which page of how many, unasked.

The row at the bottom of the panel and the silhouette at the end of the column are
the same command: `addPage` on the store, which puts the page in and says which
page it now is. Two copies of "put a page in and go to it" would be two things to
keep in step.

## A PDF in

**Import ▸ drop a PDF.** The Import door's detector recognises a picked file that
is nothing but PDFs and offers "A PDF, as pages to write on" - one row on the
existing sheet, not a second door.

Two files out of one:

- **the paper**, byte for byte as it arrived, so Obsidian and every other reader
  open it;
- **`Lecture 4.pages` beside it**, whose pages are that paper's pages, each one a
  `file` node naming the PDF and the page.

Nothing is baked in. No PNGs are written; the picture behind a page is rendered
from the paper itself, by pdf.js at 2x with a 16 Mi-pixel ceiling, when that page
comes near the view - and let go of when it does not, with at most 24 kept. So a
note made from a four hundred page scan is kilobytes of ink beside one PDF, and
costs what a note made from four pages costs. See `pages/paper.ts`.

The page sizes come out of the PDF's own dictionaries and nothing is drawn to get
them, which is what lets the sheet say what it is about to make before it makes it.
A landscape plate in a portrait book gets a landscape page, and a page is called what
it is: a page out of a Letter paper says `letter`, so changing its ruling does not
snap it to A4's size.

**The `file` a page names is relative, and to two things.** Obsidian writes one
relative to the vault; this import writes the paper's bare name beside the note it
made, which is the same path only when the note sits at the top of the space. So both
are tried - the note's own folder first, then the space's root - and the one that opens
is the one the page draws. `placesOf` in `apps/desktop/src/lib/space-paths.ts` is the
whole of it. A page whose paper is nowhere says so on the sheet: a blank sheet and a
sheet whose PDF could not be read look identical, which is how a whole note of blank
pages went unnoticed.

## The paper, and what is ruled on it

Three papers: A4, Letter, and the long page that grows instead of ending. They are rows
in the menu on a page's own thumbnail, above the four rulings, because the paper is the
larger decision - how big the sheet is and whether it ends, then what is printed on it.
The row for the paper a page already wears is disabled rather than ticked, which is what
this menu does everywhere else.

A page note *starts* on whichever of the three the reader chose, in
Settings ▸ Editor ▸ Page notes. A4 outside North America and Letter inside it are both
right and neither is something an app can guess, so it is a choice, and it is this
machine's own: which paper somebody writes on is a decision about the printer in the
room. A page added to a note takes the size of the one it follows, and a page already
written on is changed from its menu - so the setting is only ever about the first sheet.

`PAPERS` in `packages/markdown/src/canvas.ts` holds the three sizes and is the one place
a fourth would be added; `paperSized` there is what names the paper a PDF page arrived
at, and `reshaped` in `pages.ts` is what changes one. A long page that becomes A4 goes
back to A4's height; one that was A4 keeps the height it had, because it is about to grow
from there.

**Highlights carry over.** A PDF's highlights live in `paper.pdf.highlights.json`
(see the sidecar in `pdf/highlights.ts`), and that file is untouched by any of
this: the paper keeps its sidecar, so the same PDF opened in the PDF viewer still
shows every mark, and the page note is a second thing written beside it rather
than a replacement for it.

## Out

| Format | What it is |
| --- | --- |
| **PDF** | The original paper with the ink drawn onto its pages as vector paths. The text stays text, selectable and searchable. A note with no paper behind it gets fresh pages at its own sizes. |
| **PNG** | One file per page, at 2x, in a zip. |
| **SVG** | One file per page, in a zip. |

The PDF is not a picture of the pages, which is the point: open a lecture PDF,
write on it, export, and what comes out is still the lecture PDF with your
handwriting on it. `pdf-lib` copies the pages and `drawSvgPath` puts each stroke's
outline down as a filled path - the very same ring `outlineOf` gives the screen and
the SVG, so the three pictures of one stroke cannot drift. A highlighter is drawn
with the `Multiply` blend mode, which is what a marker over printed text is.

**The ink goes into the page content, not into an `/Ink` annotation.** pdf-lib has
no annotation writer, and writing both would be every stroke twice; of the two,
content is the one every reader and every printer draws. What that costs is that
the strokes cannot be rubbed out again in another app - which is what the `.pages`
file beside the paper is for, and why the paper is never written over. If a real
`/Ink` annotation is wanted instead, the dictionary can be hand-built through
pdf-lib's low-level API; that is a decision, not an oversight.

### The other apps' formats

Asked honestly, after looking: **not one of the five hands over its handwriting**,
and none of them for the same reason twice.

| App | Format | Documented? | Verdict |
| --- | --- | --- | --- |
| Samsung Notes | `.snb`, `.sdoc`/`.sdocx` | No published specification. `.snb` is Samsung's own container; the newer `.sdoc` family replaced it and is undocumented too. Samsung Notes itself exports PDF, Word, PowerPoint, images. | **Cannot.** Nothing to write against but a reverse-engineering effort we would have to do and then maintain against an app that has already changed format once. Import a PDF instead - which is what Samsung Notes exports. |
| Apple Notes | `NoteStore.sqlite` + protobuf in the app's group container | No specification; what everybody does instead is read the database, which is what nib's own Apple Notes import does on macOS (see `import/apple.ts`). The *words* therefore already come over. A **drawing** in a note is a separate proprietary blob in that database and is not read by it. | **The prose, yes, already. The handwriting, no.** Nothing documents the drawing blob, so a scribble in Apple Notes arrives as a note without its scribble. The road for that one is Apple's own PDF-per-note, imported as pages. |
| OneNote | `.one` (MS-ONE / MS-ONESTORE) | *Genuinely published* by Microsoft as an Open Specification - the one on this list that is. But it is a large binary revision-store format, and the ink in it is `PictureContainer`/ink-stroke structures that would need their own reader and writer. | **Not attempted.** Possible in principle; a batch of its own, not a row in this one. The HTML export path already exists (`import/read.ts` detects OneNote HTML). |
| GoodNotes | `.goodnotes` / `.note` | No published specification. | **Cannot.** GoodNotes exports PDF. |
| Notability | `.note` | No published specification. | **Cannot.** Notability exports PDF. |

Which is the honest shape of this problem: **PDF is the interchange format for
handwriting**, because it is the one every one of these apps exports and the only
one any of them documents. So that is the road in and the road out, and it is a
good one - the ink arrives as pages to write on, and leaves as vector paths on the
original paper.

Emil to decide: whether OneNote `.one` is worth a batch. It is the only one that
could be done properly.

## Collaboration

Exactly like a canvas, because it *is* a canvas. One room per file, keyed by the
file's name; per-object ids, so two people writing on one page keep both hands'
strokes whole; presence and remote pointers through `CanvasHands`; undo per device.
`rooms.svelte.ts` routes a `.pages` tab to `PlaneRoom` on the same line a
`.canvas` tab goes through. See [collaboration.md](collaboration.md).

## Mobile

The same bar, drawn bigger where a thumb has to land on it - there is no second UI,
because `CanvasBar` already answered that question for the canvas. Palm rejection
is the canvas's rule in the canvas's own code: once a pen has touched this glass
the finger stops being a nib and goes back to moving the paper, and a finger that
lands while a nib is down does nothing at all rather than dragging the page out
from under the pen. A phone that has never seen a pen draws with a finger, because
nothing else can. See `inks` in `canvas/pointer.ts` and `hand.svelte.ts`.

The status bar is hidden on touch, so the page number on the sheet itself is what
a phone reader sees; the navigator is in the drawer where the outline is.

## Where the code is

| | |
| --- | --- |
| The format | `packages/markdown/src/canvas.ts` - the page node, read and written |
| The page model | `packages/markdown/src/pages.ts` - the column, add, delete, reorder, grow |
| The surface | `apps/desktop/src/lib/Pages.svelte` |
| One sheet | `apps/desktop/src/lib/PagesPage.svelte` |
| The sheet that is not there yet | `apps/desktop/src/lib/PagesSlot.svelte` |
| How far it is zoomed, said | `apps/desktop/src/lib/PagesZoom.svelte` |
| The navigator | `apps/desktop/src/lib/PagesNavigator.svelte` |
| The store | `apps/desktop/src/lib/pages/store.svelte.ts` |
| The pull, as arithmetic | `apps/desktop/src/lib/pages/pull.ts` |
| One notch of a zoom | `apps/desktop/src/lib/camera.ts` |
| Where a view was left, and whether its zoom was chosen | `apps/desktop/src/lib/canvas/place.ts` |
| The paper behind a page | `apps/desktop/src/lib/pages/paper.ts` |
| Out | `apps/desktop/src/lib/pages/out.ts` |
| What is in front | `apps/desktop/src/lib/pages/showing.svelte.ts` |
| A PDF in | `apps/desktop/src/lib/import/pdf-pages.ts` |
| Which room | `apps/desktop/src/lib/rooms/kind.ts`, `services/sync/src/rooms/kind.ts` |

## What we deliberately do not have

**No page templates.** A ruling and a size is what a page is; a gallery of
planners is a different product.

**No text layer of its own.** Typed text on a page is a card, the same card a
canvas has, clipped to the page. Two kinds of text box would be two renderers.

**No handwriting recognition.** It is the row on Samsung's bar that is a different
product wearing the same bar; see [canvas.md](canvas.md).

**No `/Ink` annotations on export**, for the reason given above - one decision,
stated, rather than both and twice the ink.
