# Design

What the shell is held to: an honest look at where it stands against the apps
people already know, and the system it is being brought onto. The editor is not
the subject here - it is the part that already works. The subject is everything
around it: the rail, the list panel, the tabs, the bars, and the layers that
open over a note.

The before pictures this reads from were taken with
`apps/desktop/test/e2e/shell.py`, which serves the built web app and drives it in
the machine's own Chrome as a desktop in both schemes, as a tablet either way up
and as a phone. They are under `apps/desktop/test/e2e/shots/shell-before/`, which
is ignored; the names appear in the text.

## What the others do better

### Notion

**It names the place first.** The sidebar opens with the workspace icon, the
workspace name in semibold, and the account under it - so the panel has a
subject before it has a list. Everything below is understood as being about
that place.

**It labels its sections.** `WORKSPACE`, `SHARED`, `PRIVATE`, in 11px uppercase
with letters spaced out and the colour dropped to muted. A long list stops being
a wall: the eye lands on the label and reads the group under it.

**It fills the row you are on.** The selected page is a light grey rounded
rectangle across the full width of the panel. You never look for where you are.

**Its marks are the size of its words.** 18px icons against 15px names. The mark
reads as the first column of the row rather than as dust in front of it.

**Its verbs are in the panel.** Quick Find, All Updates, Settings sit as rows at
the top, with the same icon size and the same row height as the pages below
them. What you can do is in the same grammar as what you can open.

### Obsidian

**Every panel is the same panel.** One header height, one icon size, one hover
surface, one row height, whether it is the file list, the tag pane, the outline
or the backlinks. Density is not the trick - consistent density is.

**Two levels of text, and no more.** Normal and muted. The accent is spent on
links and the one active node in the graph, and nowhere else, so when it appears
it means something.

**Its rows have three columns.** A mark, a name that gives way, and a count or a
control pushed to the right. The tag pane's counts sit in that third column, so
the names still read as a column of their own.

### Discord, on a phone

**The rail is identity.** Round 48px avatars, and the one you are in marked by a
small white pill against the left edge - a marker beside the shape rather than a
recolouring of it.

**The panel has a real head.** The server name in bold 20px with a chevron that
says it can be acted on, a muted line under it, and then a full-width rounded
search pill. Identity, then the one action available everywhere, then the list.

**Three row states, clearly apart.** Read is muted, unread is bright and bold
with a dot at the left edge, selected is a filled rounded rectangle. You can
tell them apart at a glance and without reading a word.

**Categories in capitals.** `CHAT`, `PLANNING`, `VOICE CHANNEL` - the same trick
Notion uses, on a screen where it matters more.

## What nib gets right

The editor. `desktop-light-files.png`: the measure, the heading scale, the
padding, the syntax characters bleeding in as they are typed. Nothing in this
pass touches it.

The two systems that already exist and are already enforced. Motion is one
vocabulary of durations and easings in `tokens.css`, and every surface reads it.
The touch scale is one set of numbers, and `touch-scale.test.ts` refuses a
component that writes a finger-sized number of its own. That instinct - state it
once, then guard it - is the right one, and this pass extends it rather than
inventing a second way.

The structure. One document at a time on a handheld, the sidebar as a drawer
over the note, and a panel that is a place with a name at the top of it. That is
Discord's structure, and it is the correct one for what nib is - all of it
except the rail, which is where a place with a hundred servers keeps its
identity and nib has three spaces. See "The rail is gone".

## What nib gets wrong

**The list panel has no subject.** `desktop-light-files.png` and
`phone-files.png`: four unlabelled icon tabs float in the top-left corner, and
under them the tree begins. Nothing on the panel says which space you are in.
The bookmark row above the divider reads as a title and is not one. Notion's and
Discord's first move - name the place - is simply missing.

**Nothing can be searched from where you are.** Search is one of four icons that
look like the other three. Discord gives it a pill under the header because it
is the one thing you can always do; nib buries it in a tab strip with no labels.

**The marks are too small, and Emil is right about it.** 13px marks at 0.75
opacity beside 12.5px names. Notion is 18 against 15, Obsidian 16 against 13.
nib is the only one of the three where the mark is smaller than the word it
belongs to and faded on top of that. In `phone-files.png` the rows are 56px tall
and the mark inside them is 15px, which is a thumb-sized row with a pointer-sized
mark in it.

**No row is ever filled.** The open note is bold text and an accent-coloured
mark. In `desktop-dark-files.png` that is nearly invisible. All three references
fill the row; nib is the only one that does not, on the surface people look at
most.

**Six lists, six rows.** `Tree.svelte`, `Bookmarks.svelte`, the outline in
`Sidebar.svelte`, `TagTree.svelte`, `SearchPanel.svelte` and `Links.svelte` each
declare their own `padding: 4px 8px; border-radius: var(--radius-sm); font-size:
var(--text-sm)`, and between them use three different hover colours and four
different heights. Each was reasonable on its own. Together they are why the app
does not feel like one object - and the same six then repeat themselves under
`[data-touch]`, so there are twelve copies of one row.

**Two pluses, one drawing, two meanings.** `desktop-light-files.png` has a `+`
in the rail (new space) and a `+` in the tab strip (new note), forty pixels
apart, drawn identically.

**The rail's foot is a pile.** An account glyph, a moon, and a filled GitHub
silhouette among line drawings, at the bottom of a column that is otherwise
about spaces. The source link is already in the Help menu.

**The two columns across the top do not line up.** The title bar is 38px; the
panel's tab row is a 24px button in 12px of padding. Two rows across the top of
one app, at two heights, with no rule under either.

**The tables are the heaviest thing on the page.** `desktop-dark-table.png`: a
full grid at `--line-strong` in a document whose rules, blockquote bars and code
borders are all hairlines.

**Section labels exist in one place only.** `Links.svelte` has them.
`Bookmarks.svelte`, the tree and the search results do not.

**Half the drawer is empty.** `phone-files.png`: seven rows and then four
hundred pixels of nothing, under a rail whose bottom third is three unrelated
icons. Discord fills the same space with a header, a search pill and categories.

## The system

One vocabulary, stated in `packages/themes/src/tokens.css`, read by every
surface. Every name that was there before is still there; what is new is
additive and defined in terms of what already existed, so a registry theme that
overrides `--surface-2` or `--item-hover-bg-color` moves the new tokens with it.

### Spacing

`--space-1` … `--space-7` = 4, 8, 12, 16, 24, 32, 48. Nothing in the shell uses
a padding that is not one of these or a token built from them.

### Type

Four sizes in the chrome, and the document's own on top of them.

| Token | Size | What it sets |
| --- | --- | --- |
| `--text-xs` | 11px | section labels, counts, keys, second lines |
| `--text-sm` | 12.5px | meta beside a name |
| `--text-row` | 13.5px | **new** - the name in any row: tree, menu, palette, tab |
| `--text-base` | 15px | a sheet's title, a field over a list |
| `--text-head` | 15px | **new** - what a bar across the top of a column is titled with: the space's name over the list, the note's name over the page. 19px under a thumb, so a header is a step above the rows under it on either kind of screen |
| `--text-content` | 16.5px × zoom | the note |

Two emphasis levels and no more: `--weight-row` (450) for a row at rest,
`--weight-strong` (600) for a header or the row you are on. Colour carries the
same two levels: `--muted-strong` at rest, `--text-strong` when it is the thing.
The accent is spent on links, on the mark of the open note, and on the active
space. Nowhere else.

On a touch screen `--text-row` becomes `--touch-text` (17px). That is one
declaration in the tokens, not one per component.

### Icons

One size per context, so a glyph's size says what kind of thing it is.

| Token | Size | Where |
| --- | --- | --- |
| `--icon-sm` | 13px | a mark inside a row that is not the row's own: a tab's kind, a bookmark's kind |
| `--icon-md` | 16px | **the mark in front of a name** - tree, bookmarks, tags, menus, and the drawing inside a space's badge, which is a mark in front of a name too |
| `--icon-lg` | 18px | a glyph that is a button: panel tabs, title bar, the panel's foot |

On a touch screen `--icon-md` becomes `--touch-mark`, raised from 15px to 20px,
and `--icon-lg` becomes `--touch-icon` (24px). The mark is then within three
pixels of the 17px words beside it, which is the proportion Notion and Obsidian
both hold.

A space's badge and the face in the panel's foot are `--row-height-sm` square
with a corner a third of their side, so they are the same shape at 24px under a
pointer and at 48 under a thumb, and neither needs a size of its own.

### A glyph that is a button

`.nib-glyph` in `base.css`: a `--row-height` square, `--radius-row`, the row's
own hover and press surfaces, and a mark of exactly `--icon-lg` that is never
allowed to give way. 28px under a pointer, 56 under a thumb, which clears
`--touch-target` without a number of its own.

Seven components drew their own, and between them they had five sizes (24, 28,
28 hard-coded, 30, 38), three corners (`--radius-row`, `--radius-sm`, and none
at all - so the button that opens the file list lit a sharp-edged block where
the three bars beside it lit a rounded one) and two hover colours, for one job.

`padding: 0` in that class is load-bearing rather than tidy. A browser gives
every `button` `1px 6px` of its own, and a component that never mentions padding
inherits it: the panel's foot asked for an 18px glyph in a 28px square and got a
content box 16 wide, so both marks at the bottom of the sidebar were drawn 16
across and 18 down while every other glyph in the app was round. `flex: none` on
the mark is the other half of the same bug.

A component says where the button sits and what its own states mean - the find
bar's hairline when a step is pressed in, the sidebar button's edge sliding, the
accent on `is-on`. Nothing else.

Where a mark has to stay small and still be aimed at - the `i` after a setting's
name - what is drawn and what can be hit are two sizes: the glyph grows to
`--touch-icon` and an invisible `::after` grows the target to `--touch-target`.
A 48px circle in the middle of a label would be the label's size.

### Rows

| Token | Desktop | Touch |
| --- | --- | --- |
| `--row-height` | 28px | `--touch-row` (56px) |
| `--row-height-sm` | 24px | `--touch-target` (48px) |
| `--row-pad` | 8px | `--touch-pad` (14px) |
| `--row-gap` | 8px | `--touch-gap` (12px) |
| `--row-indent` | 14px | `--touch-indent` (18px) |
| `--radius-row` | 6px | 10px |

`--row-height-sm` is for a list that is read more than it is tapped: the
outline, and a line of a search result. Everything else is `--row-height`.

The row itself is drawn once, as `.nib-row` in `base.css`, with three parts: a
`.nib-row-mark` of exactly `--icon-md`, a `.nib-row-label` that is the only part
allowed to give way, and an optional `.nib-row-meta` pushed to the far end. No
component draws that row again; a component may say how far a row is indented and
how wide it is in the space it sits in, and nothing else.

`is-quiet` is the row that is a name with nothing written under it yet: muted ink
for the mark and the words together. The file list is the one place it appears -
a folder out of somebody's vault, which nib draws as the note nobody has written.
That the list has one kind of row at all, and what a click, a twist and a drag on
it each mean, is `docs/tree.md`.

### Header rows

`--header-height` is `--titlebar-height` (38px), and it is what the title bar,
the panel's header, and the tab strip are all as tall as, so the two columns
across the top of the app read as one row. On a touch screen it is
`--touch-row`.

Being that tall is not the same as sitting in it. The bar stretches what is in
it, so anything with a height of its own has to say `align-self: center` or it
lands at the top of the row: the three bars of the app menu are a 30px pill and
sat four pixels above the centre line the sidebar button, the space's name and
the first tab all share. `apps/desktop/test/e2e/shell-polish.py` measures the
four of them against the bar's own centre and fails on more than a pixel.

A button in the bar is one glyph, and its state is said by movement rather than
by a second drawing. The sidebar button is a panel with an edge in it; the edge
slides out of the frame as the list arrives and back into it as the list goes,
and it is drawn the whole time. It used to fade away instead, which made the
button a plain window shut and a split panel open: two drawings with nothing for
the eye to follow between them.

### Swapping

Changing what a surface is showing is a move, not a cut. Four tabs across the
top of the list panel that switch between two frames read as a flicker: nothing
says the new list came from anywhere, and nothing says the old one went. So
every swap in the app is one mechanism, `apps/desktop/src/lib/slide.ts`, beside
the durations in `motion.ts`:

- **`arrive` and `leave`**, a pair of transitions. What is going slips 6px up as
  it fades; what is coming comes up from 6px below. One helper with the distance
  as its argument, so a list dropping out of a header comes *down* out of it by
  passing a negative one.
- **`segmented`**, an action on the groove of a segmented control. It draws one
  raised surface, measures whichever button wears `on`, and slides the surface
  there - one element translating, rather than a background switching off under
  one half and on under another. It watches the class rather than being told a
  value, so it follows a choice made from a menu, a key or the palette as
  faithfully as one made by pressing the control, and no control passes it
  anything.

Two rules hold for both, and for anything added beside them:

**Transform and opacity only.** Never a width, a height, a top or a margin. Both
of these are laid out once and moved by the compositor after that, so a swap
costs no layout on any frame. Where two things have to cross, they are stacked -
the panel's body is `position: absolute` inside a positioned `.stack` - rather
than allowed to sit one above the other and shove the page around.

**Never in front of the interaction.** What was pressed is chosen on the frame it
was pressed; the movement catches up afterwards. Nothing waits for a transition
to end before doing what it was asked.

Reduced motion needs no second answer: the transitions take their duration from
`dur()`, and the sliding surface takes `--dur-fast`, which the tokens zero along
with every other duration. For a reader who has asked for as little movement as
possible, everything here is simply already where it is going.

What this reaches: the four panel tabs and the panel under them, on a desktop
and in the drawer alike; the settings sheet's segmented controls, and its panes,
which come up from below where they used to appear (and, on a phone, where they
used to do nothing at all); the publishing sheet's address; the LLM pane's client
picker; and the space switcher, which drops out of the header it belongs to and
goes back into it. The sharing sheet's link had one too, and now has a switch:
what a link hands out is not two choices side by side, it is one thing that is on
or off with what it hands out under it.

Two things were looked at and left alone. The search results and the header menu
already move, in this vocabulary and at these durations. And the strip of tabs
over the note keeps its sliding underline but does not crossfade its content:
the editor holds a state per tab, so switching is not the document moving but
the document *being* another one, and `apps/desktop/test/e2e/swap-cost.py`
measures the swap at under a frame either way - so latency is not the argument.
The argument is that a pane you are about to type into should be solid the
instant the caret is in it.

### Radius, and the elevation model

Three corners, and a rule that says which:

- `--radius-row` for anything **inside** a panel: rows, pills, small buttons.
- `--radius-md` (9px) for anything that **floats over** the app: menus, the
  format bar, cards.
- `--radius-lg` (14px) for a surface that **replaces** part of the screen: the
  palette, a sheet.

Elevation follows the same three:

| Level | Shadow | Border | What |
| --- | --- | --- | --- |
| 0 | none | none | in a panel - surfaces only |
| 1 | `--shadow-sm` | none | raised out of a control it sits in: the chosen half of a segmented control, the tab you are on |
| 2 | `--shadow-md` | `--line-strong` | a small bar over the text: the format bar, a PDF's two actions |
| 3 | `--shadow-lg` | `--line-strong` | a layer over the app: a menu, the palette, a sheet, a space lifted to be moved |

A shadow above zero always comes with a hairline border, and nothing at zero has
both a border and a background.

Levels 2 and 3 are drawn once each, in `base.css`, because five components had a
copy of one of them and the copies had already drifted:

- **`.nib-bar`** is the small bar over the text: the format bar above a
  selection, the two actions a PDF offers, the canvas toolbar.
- **`.nib-layer`** is a layer that **floats over** the app at `--radius-md`: the
  context menu, the app menu, the list of spaces, the suggestions under a `[[`,
  a dropdown, the canvas and graph flyouts. The app menu and the dropdown used
  to light their surface a step brighter than the menus beside them, and the
  dropdown and the suggestions spent `--shadow-md` where the menus spent
  `--shadow-lg` - so two things doing one job sat at two heights and two shades.
- **`.nib-screen`** is a surface that **replaces** part of the screen at
  `--radius-lg`: the palette, the sheet a space is shared from, the one small
  modal the app asks its questions in, the sign-in panel, the word a link owes
  whoever followed it. Five components declared the same eight lines; one opened
  six vh above the others and each picked its own width. How wide is the
  caller's, as `--screen-width`; how far down is too, because a list of commands
  wants the room under it that a question does not.

Where it sits is the caller's. What it is, is the class.

### The surfaces a row wears

Four states, four tokens, one meaning each, and each defined from a token a
theme already overrides.

| Token | From | What it says |
| --- | --- | --- |
| `--surface-hover` | `--item-hover-bg-color` | the pointer is here |
| `--surface-press` | `--press` | the click landed |
| `--surface-selected` | `--active-file-bg-color` | this is the note you have open |
| `--surface-picked` | `--surface-3` | you picked this with Ctrl or Shift |

`--active-file-bg-color` moves from `--accent-soft` to a 16% mix of the accent,
which is what makes the filled row actually read. A theme that restates either
token keeps its own answer.

The open note is the filled one. In an app that shows one document at a time on
half its devices, which note you are in is the single most important fact the
list carries, and the three references all spend a filled row on it.

### Contrast is a theme

Who answers how much contrast the page has? The theme does, and only the theme.
There is one palette per look, and asking for more contrast is asking for a
different look, so it is the `contrast` theme in the store and not a switch beside
the mode. A switch was the old answer, and it had to restate the whole palette
over whichever theme was in force: two answers to every colour question, with a
theme author having no say in the second one.

Which means a theme has to be able to reach everything a reader might need to
see, including the four colours inside a code fence that no other token names.
`tokens.css` declares them per scheme like any other colour:
`--syntax-number`, `--syntax-function`, `--syntax-type` and `--syntax-property`.
Not `--code-*`: every name with that prefix is the furniture around a block
rather than the code in it, and `--code-number` sitting beside the gutter's own
`--code-number-color` is a trap for whoever writes the next theme. The four are
read while Highlighting follows the theme, which is what it does unless somebody
changes it: a reader who pinned GitHub or Dracula pinned that palette's colours
with it.

A system that asks for more contrast is shown that theme once, on a fresh install,
on the card it would be installed from. Nothing installs itself, and nothing asks
twice.

### The floor under the default palette

Asking for *more* contrast is asking for a different look. Being able to read the
words at all is not, and the palette both looks started from did not clear it.

Every colour words are written in carries **four and a half to one against every
surface in its own palette** - `--bg`, `--surface`, `--surface-2` and
`--surface-3` - because that is what WCAG asks of text and what the eye asks of
an 11px capital. Measured over the built app, the two levels of secondary ink
failed that on every surface they sat on:

| Token | Was | On a panel | Inside a menu | Now |
| --- | --- | --- | --- | --- |
| `--muted` (dark) | `#767e8c` | 4.39 | 3.63 | `#878f9d`, 4.55 at worst |
| `--muted` (light) | `#8a93a2` | 2.84 | 2.44 | `#5c6574`, 4.50 at worst |
| `--muted-strong` (light) | `#646d7c` | 4.78 | 4.12 | `#464f5e`, 6.52 at worst |
| `--danger` (dark) | `#f2555a` | 4.39 | - | `#f5585d` |
| `--danger` (light) | `#d92b34` | 4.70 | 3.81 | `#c91b24` |
| `--success` (light) | `#16a06a` | 3.26 | - | `#007640` |

`--muted` is what most of the chrome's second line is written in - a section
label, a count, a key beside a command, the placeholder in the search pill, the
name of a tab you are not in - so one colour was a hundred readings in a single
pass of the app, and the light side was the worse of the two by a long way.

Raising it would have darkened something that is meant to be barely there, so
the signature was named instead: `--faint` is the shade the `#` and the `**`
bleed in at, and `--md-char-color` and `--heading-char-color` read it. Markup
says the same thing the heading already says; prose does not.

Two colours are still short of the floor, and both are one decision rather than a
number - see "What needs deciding" at the end of this file.

### Alignment

One starting edge per panel, at `--row-pad` from its side. The header's words, the
search pill, the section labels and every row's mark all start there, and every
name starts at `--row-pad + --icon-md + --row-gap`. A level of a tree adds
`--row-indent` and nothing else - no second indent for the mark, because the
mark's box is a fixed width whether it holds a folder's twist, a file's kind or
nothing.

### Which way the words run

Arabic, Persian, Pashto and Urdu read right to left, and the interface reads the
way its language does. One attribute says so - `dir` on the root element, written
beside `lang` when a language is chosen - and everything else follows from it, so
there is one design rather than a second layout to keep in step.

What follows from it:

- **Every side that is about reading is logical.** `padding-inline-start` rather
  than `padding-left`, `inset-inline-end` rather than `right`, `text-align: start`
  rather than `left`. The browser turns the whole shell round for free: the list
  panel, the strip of notes, the title bar's buttons, the status bar, the drawers
  on a phone.
- **What is about the screen stays physical**, and there are only a handful:
  `--inset-top/right/bottom/left` are where the notch is, a canvas is a plane
  whose nodes sit where somebody put them, the segmented control's surface is
  moved by a measured `offsetLeft`, and a picture's four resize corners are
  compass points the drag arithmetic already has a sign for. Each of those says so
  where it stands.
- **What a logical property cannot say reads `--dir`**, which is `1` one way and
  `-1` the other: a switch's knob sliding to its end, a row nudging under the
  pointer, the shimmer crossing a progress bar, a drawer following a thumb.
  `--dir-start` and `--dir-end` are the same two sides as words, for
  `transform-origin`, which has no logical spelling. `--inset-start` and
  `--inset-end` are the notch, named by reading.
- **A mark that points along a line is turned over rather than drawn twice**:
  `.nib-mirror` in `base.css` on back, forward, a step into a list and a link that
  leaves the app. A tick, a cross, a chevron pointing down and a magnifying glass
  are not marked, because they mean the same thing either way.
- **A name is placed as one piece.** A row's label and a tab's name are
  `unicode-bidi: isolate`, and a name put into a translated sentence is wrapped in
  a first-strong isolate where it reads the other way, so `khutta.md` keeps its own
  extension at its own end. See `isolated` in `direction.ts`.
- **A note is not the interface.** Every block in `#write` takes the direction of
  its own first strong character, so an Arabic note in an English app and an
  English note in an Arabic app both read right, and a note with both in it reads
  right block by block. Code and a markdown table are the exceptions: those are
  laid out rather than read.

Urdu is the one language that asks for another face. Nastaliq hangs each word
down and back rather than standing its letters on a line, so `:root[lang|='ur']`
names it where a platform has one and raises the leading and the row height that
have to grow with it. Nothing is fetched: a platform with no Nastaliq keeps the
naskh face the other three use.

`scripts/locale-e2e.py` drives all of it at both sizes: which side the list is on,
which way each mark points, that nothing is clipped that English does not clip,
and that the note never followed the interface.

### Badges

The rounded square in front of a name that belongs to somebody or somewhere
rather than to a file: a space's mark in the switcher, the face in the panel's
foot, a person in the Share sheet. `.nib-badge` in `base.css`, at
`--row-height-sm` with a corner a third of its side and a mark of `--icon-md`
inside it, so it is the same object at 24px under a pointer and at 48 under a
thumb. What fills it is the caller's: `--badge-fill` and `--badge-ink` per badge,
`is-on` for the accent, `is-quiet` for a badge that is only a place for a mark.

A person's colour is derived from their address rather than picked, in
`accents.ts`: the same person is the same colour on every device and after every
reload, which is the opposite of how a device chooses the colour of its caret -
two of one person's machines have to differ, two people looking at one list have
to agree.

A mark inside a badge is `display: block`, and that is load-bearing rather than
tidy. An `svg` is an inline element: it sits on the text baseline of whatever
wraps it, and the line box around that baseline is taller than the box the badge
gave it, so the descender under the baseline pushes the mark down. One pixel,
which is exactly what a mark sitting low in a badge looks like. `Icon.svelte`
says it once for all three kinds of icon, and nothing else should have to.

Where a space is named, it is named with its badge: the switcher's rows, the
header over the file list, and the title bar while the list is shut. One pairing,
so a space is one object whether the panel is out or away.

### Dots, and what is not a dot

A dot is one fact: something is not written down yet. That is the tab's saving
dot, and the two lights that are about work in progress rather than about a file
(a request waiting to be let in, the foot's sync light) borrow the shape because
they are the same kind of statement.

That somebody else is in this at all is a mark, never a dot. `SharedMark.svelte`
draws it once - Lucide's `users`, at `--icon-sm` in `--muted`, in the row's
trailing slot - and it says it in five places: a shared space's row in the
switcher, the header over the file list, the shared-with-you row at the foot of
the switcher, a note in the file list somebody else is in, and the tab of a
document shared on its own, which has no row in the list to carry it. A dot in
the accent used to say the first of those, which meant the one shape the app had
for a fact about a file was saying two unrelated things at once.

How many of them there are is the one thing the mark cannot say, and that is
what the stack of accent dots on a tab is for: one per other device in the note,
three at most, beside the mark rather than instead of it.

The note's half is asked of the rooms rather than of the account, and that is the
whole of why it is not noise: a note in a shared space that nobody else has open
is not a note being worked in with somebody, and one mark repeated down every row
of a shared space says nothing about any row in it. `othersIn` in
`sharing.svelte.ts`, beside `isShared`, because they are the same question asked
of a note and of a space.

### Which colour, and the six tones

Six colours, once, named by number: `--canvas-1` to `--canvas-6` in
`tokens.css`, restated per scheme like any other colour. They are Obsidian's own
canvas palette, so a board coloured in either app reads the same in the other, and
a chart in a note is drawn out of the same six (`chart.ts` in `@nib/markdown`,
which carries a hex beside each token for the one surface that has no stylesheet -
a picture pulled out of a document and looked at on its own).

A coloured highlight is a wash of one of them rather than a seventh palette:
`--mark-1`, `--mark-2`, `--mark-4`, `--mark-5` and `--mark-6`, each the tone
at 22%, which is the strength `--accent-soft` is - a highlight has to be read
through. Said once and not per scheme, because each is written in terms of a
canvas tone and a custom property is substituted where it is used. There is no
`--mark-3`: Obsidian writes no yellow emoji, because a plain highlight is already
its yellow, and a colour nib could write but Obsidian could not read is not a
colour.

And it is asked the same way wherever it is asked: a row of dots, the chosen one
ringed in the accent, each with a hairline of the page's own ink at 28% so a pale
dot on a pale surface still has an edge in both themes. `CanvasColours.svelte`
draws it for a pen and for a card; the formatting bar draws the same shape for a
highlight, at the size a bar's button is.

### Switches

One thing that is on or off, `.nib-switch` in `base.css`: a 38x22 track and a
16px knob, 50x30 and 24 under a thumb, in one `[data-touch]` block rather than
one per surface. A setting, an assistant's write access and a space's link had
three copies of it between them. The row is the switch wherever a row can be -
the whole row takes the press, and the switch is `aria-hidden` because the row
already says `role="switch"`.

### Sheets

A sheet is a head, a body that scrolls, and cards in it. The head is the space's
badge, what the sheet is about, and the cross; it stays while the body scrolls,
because on a phone the sheet is most of the screen and the name of the thing is
what says what all of this is about. A card is a filled `--surface-2` at
`--radius-md` with rows in it - which is what Proton Drive does and what the
settings sheet on a phone already did - so two groups on one sheet read as two
groups without a line or a word. Nothing on either sheet is confirmed: every
change is asked of the server as it is made, so there is no button that says
Done, and the cross, Escape, back and the scrim all close it.

Where the keyboard lands is the sheet's to say: `[data-lands]` on the control
somebody opened it to use - the address field on the Share sheet, the warning's
tick on the Publish sheet - rather than the cross, which is simply the first
thing in the head. Never under a thumb, where there is no Tab to hold on to and a
field taking the keyboard puts the system's own over half the sheet.

### Section labels

`.nib-section` in `base.css`: `--text-xs`, uppercase, `0.06em` of tracking,
`--muted`, starting on the same left edge as the rows under it. Sized by what it
says rather than by the row scale - margin and padding and no height - so under
a thumb it stays a caption instead of becoming a 48px row with nothing in it to
tap. Every list that has more than one group wears it - bookmarks and files
in the tree panel, the two lists of links, a note's name over its search hits.

## What the shell becomes

### The list panel

Three rows of chrome, in the order identity, action, view - which is Discord's
order and Notion's:

1. **The header**, `--header-height`: the space's name at `--text-head` and
   `--weight-strong`, with a chevron beside the word rather than at the far end
   of the bar - the two are one control. Pressing it drops the list of spaces out
   of the header, inside the panel: the panel is the anchor, so the list is the
   width of the list of notes and there is nothing to measure, nothing to flip at
   an edge and no second sheet written for a phone. Where the panel is a drawer,
   the sidebar button stands in front of the name, because a drawer covers the
   bar that button otherwise sits in.
2. **The search entry.** One field, one mechanism. Outside the Search panel it
   is a pill that opens it; inside, it is the panel's own field, in the same
   place, at the same height, with the same radius and the same magnifier, drawn
   from the same `.nib-field` class. It is one control that becomes editable, not
   two controls that look alike.
3. **The panel tabs**, full width, one quarter each - the segmented control the
   settings sheet already uses, so the tab you are on is raised out of its groove
   exactly the way every other "this one" in the app is, and the raised surface
   slides between them rather than blinking; see "Swapping".

The tabs sit between the name and the search entry rather than under both: the
entry has to be in one place whether it is the pill or the field, and the field
belongs to the Search panel, which begins under the tabs. So the order on the
screen is name, tabs, entry, list - and the entry never moves.

### Either side of the note

Any panel tab can live on the other side of the window - its own menu says
`Move to the right`, and `Move to the left` again - and the right side is empty
for everybody until somebody moves one over. Empty, not narrow: nothing is drawn
at all, so the left column, the row under it and the strip of notes are pixel for
pixel where they always were, which `test/e2e/right-side.py` measures before and
after rather than promising.

One component draws both sides; the side is a prop. What differs is what belongs
to the window rather than to a panel: the identity row - the space's name and its
switcher - and the foot row of the account, the theme and the settings stay on the
left, because two of either would be two switchers for one space and two gears for
one app. The search pill is drawn on whichever side the Search panel itself lives
on: a door on one side that opens a panel on the other moves the reader's eye
across the window for nothing. The resize handle is mirrored, and each side
remembers its own width - a wide file list is not a wish for a wide outline.

It sits under the window's own bar rather than beside it, which is where the left
sidebar sits. The bar carries the window's buttons at its right end, and a column
to the right of the bar would push them out of the corner every window on every
platform keeps them in.

Wherever the panels are drawers - a phone, a tablet upright - the right side is a
drawer from the right over the note, the way a members panel is, dismissed by the
same scrim, by Escape and by back. It leaves a strip of the note showing even at
the narrowest width, because that strip is what there is to press to get out of
it. It does not follow the thumb: the drag belongs to the left drawer, which is
the one gesture a phone's edge has.

Which side each panel is on, and which of them is open over there, is part of what
the window remembers - beside which notes are open, and per window rather than per
account, the way the sidebar's width already is.

### The rail is gone

There were two ways to choose a space, and the header's is the better one,
because it says the name. A column of wordless squares is only legible to
somebody who already knows the squares; the header says where you are before it
offers to take you elsewhere, which is the order Notion and Discord both put
identity in. So the column goes, on every device, and everything it carried has
a home:

| What the rail did | Where it is now |
| --- | --- |
| Which space you are in | The panel's header, and the title bar while the panel is shut |
| Switching to another one | Rows in that header's switcher, each with the space's own mark and a dot where somebody else is in it |
| Making one | A row at the foot of the same list, where a workspace switcher keeps it - and in the palette and the File menu, as before |
| A space's own menu | The same entries, on the space's own row: a button at the end of it, a right click, or a held finger |
| Reordering by dragging | `Move up` and `Move down` in that menu, on every device |
| The account | The left of the panel's foot row, as a face and a name |
| The theme, and settings with its sync light | The right of that same row |
| The three bars | The left end of the title bar, which is the corner of the screen they were already in |
| The sidebar button, where the panel is a drawer | The drawer's own head, which is the corner of the screen it was already in |

Two things are better for it rather than merely relocated. The switcher's rows
are rows - a mark, a name, a dot - so a space is read the way a note is, and a
space's name is never a tooltip that has to be hovered for. And the app now has
exactly one thing at the top left of the window on every device: the bars on a
desktop, the file list on a handheld, where the bar under a drawer would be
unreachable anyway.

What is lost is the marker against the edge, which said which space you were in
without a word. The filled row in the switcher says it instead, in the same
grammar as the note you have open - and the name is on the screen the whole
time, which the marker never was.

### The panel's foot

`--header-height` tall, so the list sits between two bars of one height, with a
hairline over it and the safe-area inset under it. Three things, and the same
three on every device, because it is one component: the account at the left as a
face and a name, opening the account pane - signing in, the name a shared space
shows, storage and signing out are all there, so who you are is one place rather
than a sheet here and a pane there; then the theme and the settings at the right,
where a switch goes. The theme is off while the theme in force has only the one
scheme. The settings button carries the sync light, as it did in the rail. The
GitHub mark does not come back: it is a row in Help.

### One plus

The plus always makes a note, and there is never more than one on screen. On a
desktop it is at the end of the tab strip, where a browser puts it. On a handheld
there is no tab strip, so it is at the end of the panel's header, where Discord
puts it.

### Tabs and bars

The tab strip and the title bar are `--header-height`. A tab's name is
`--text-row`, and the active tab keeps its sliding underline. The status bar is
unchanged: it is already the right idea - nothing until it is looked at.

Every tab wears one mark, in front of its name, in the box a row in the file list
draws one in - `--icon-md`, whatever the tab holds, so every name in the strip
starts at the same place. It is the kind's own mark and never the icon the file
chose for its row: a row is the file and a tab is a window onto one kind of thing,
and a strip of six of somebody's emoji is a strip nothing can be found in. A
website is the exception every browser makes - it wears the site's own favicon,
and the generic web mark only where there is none to be had - and while its page
is loading the mark turns, which is the one moment the box says what the tab is
doing rather than what it holds. The open book that says a note is being read is
`--icon-sm` and sits after the mark, because it is a state rather than a mark. See
`lib/TabMark.svelte`.

### Tables

Hairlines: `--table-border-color` drops from `--line-strong` to `--line`, and
the one rule left worth reading is the one under the header, which keeps
`--line-strong`. The grid recedes to what it is for - keeping the columns apart -
and the words in the table become the darkest thing in it. The same three lines
dress the table in the editor, on paper and on a published page; see
`editor.css`.

### On a phone

Modelled on Discord, because the structure is already the same - minus the rail,
which Discord earns and nib does not:

- The drawer is the list panel, the whole width of the screen, with the same
  four rows the desktop has at the touch scale: the head, the tabs, the search
  pill, the list, and the foot under them.
- The head carries the sidebar button, then the space's name and its chevron,
  then the one plus. The button is the same component the title bar has, in the
  same corner of the screen, so the top left means one thing whether the drawer
  is open or shut.
- **No bottom bar.** Discord earns one because it has three unrelated app-level
  places: servers, notifications, and you. nib has one place - your notes - and
  the other two candidates are already where they belong: search is the pill at
  the top of the list, and "you" is the first thing in the panel's own foot. A
  bar of three tabs where one is always selected would spend 56px of a phone
  screen and a permanent line of chrome to move two rarely-pressed things one tap
  closer, and it would put a second navigation model beside the drawer that
  already navigates. For a notes app it is bloat. It is not built.
- The document does not peek from the right. One document at a time, the drawer
  over it, the sidebar button at the top left and the three dots at the top
  right, all unchanged.

## What is guarded

`apps/desktop/test/touch-scale.test.ts` already refuses a component that writes
a finger-sized number of its own. It gains two things: the raised
`--touch-mark`, and a check that the row scale is restated from the touch scale
in one `[data-touch]` block in the tokens rather than per component.

`apps/desktop/test/one-of-each.test.ts` already refuses a second copy of a shared
control. It gains the row: `.nib-row` is drawn in `base.css` and nowhere else,
and no list paints a hover or a press of its own. It gains the badge and the
switch on the same terms, and `SpaceMark.svelte`, which is the one answer to what
goes inside a space's badge.

Three things are **not** guarded yet, and each of them is how the drift being
undone here got in:

- **A duration written into CSS.** `motion.test.ts` refuses a bare number handed
  to a Svelte transition, which is why every one of those goes through `dur()`.
  It says nothing about `transition: opacity 190ms ease` in a `<style>` block,
  and one of those was on screen: a name beside somebody else's caret faded for
  190ms however loudly the reader had asked for no movement, because `--dur-*`
  goes to zero under `prefers-reduced-motion` and a number does not.
- **A focus ring drawn as a `box-shadow`.** The guard reads `outline` only, so
  five components hand-copied `.nib-field:focus`'s two lines instead of wearing
  the class, and one of them drew a 1px ring where the rest draw 3.
- **A third weight.** The chrome has two - `--weight-row` and `--weight-strong`
  - and `550` had appeared twenty-five times, `500` twice and `650` once,
  including inside `base.css` itself.

## What needs deciding

Two colours are still under the floor, and neither is a number to nudge:

**The accent cannot be both the ink and the fill.** On the dark palette
`--accent` carries 4.52 against a panel, 4.20 against a card and 3.73 inside a
menu - so the accent as *text* fails wherever the surface is lighter than the
page - and white on an accent fill carries 3.98, which is every primary button's
words. Making the accent darker fixes the fill and makes the text worse; making
it lighter does the opposite. The answer is two tokens - the accent to write in,
and the accent to fill with - and picking them is picking the brand.

**The tab strip's inactive labels.** They are `--muted` by design, which now
clears the floor; what is left is whether the tab you are *not* in should be
readable at all or deliberately recede. Notion lets it recede. Obsidian does
not.
