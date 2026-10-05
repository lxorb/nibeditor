# Design

What the shell is held to: an honest look at where it stands against the apps
people already know, and the system it is being brought onto. The editor is not
the subject here - it is the part that already works. The subject is everything
around it: the rail, the list panel, the tabs, the bars, and the layers that
open over a note.

The before pictures this reads from were taken with
`apps/desktop/test/e2e/shell.py`, which serves the built web app and drives it in
Chromium as a desktop in both schemes, as a tablet either way up
and as a phone. They are under `apps/desktop/test/e2e/shots/shell/before/`, which
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

The pointer over a button is the arrow, as a desktop app draws it; the hand is for a
link. Settings > Appearance > Pointing hand on buttons puts the web's hand over
everything that can be pressed, the way the Claude app offers it: `data-pointer` on
the root, and one rule in `base.css` that outweighs a component's `cursor: default`.

Where a mark has to stay small and still be aimed at - the `i` after a setting's
name - what is drawn and what can be hit are two sizes: the glyph grows to
`--touch-icon` and an invisible `::after` grows the target to `--touch-target`.
A 48px circle in the middle of a label would be the label's size.

The cross that shuts something or takes it away is one drawing, `Cross.svelte`,
in two sizes of box: a 16 box with arms across half of it for a button, which at
`--icon-lg` is Lucide's own `x`, and an 8 box with arms across three quarters of it
for a cross inside something small - a tab, a chip - where half of 8px would be a
dot. Seven components drew their own in five boxes (16, 14, 13, 10, 8), so the cross
on a sheet was heavier than the theme store's beside it and the find bar's smaller
than both, and two more spelled it as a `×` in the text. How big it is and how heavy
its line is are the button's. The window's own close button is not this cross: it
is the platform's caption glyph, in the platform's box beside the other two.

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

### The window's own edges

Who draws the frame is the reader's, in Settings ▸ Appearance ▸ Window, and this
machine's rather than the account's: which titlebar somebody wants is a question about
the desk the window is on.

**Frame.** Nib's own, or the system's. Nib's own is the default and stays the default -
`--titlebar-height` is the measurement the whole shell is taken from, and the bar it
names holds the menu, the sidebar toggle, the tabs and the window's three buttons. Under
the system's frame that bar stays exactly where it is and loses only the three buttons,
because the titlebar above it already has them; two sets of window buttons is one set
lying about which window it belongs to. `set_decorations` at runtime, so nothing
restarts.

**Glass.** What the platform composites behind a window is a theme, not a switch. There
was a Translucency row, and under any theme it took the window's ground away and nothing
else, so every surface painted over it and what showed of the desk was the width of a
hairline - Obsidian's "Translucent window" has the same forum thread about it. Windows 11
apps and a Mac's Finder and Notes have no such switch either: the material is part of
the app's look, and the system's own Transparency effects or Reduce transparency turns
it off everywhere. So the glass theme is the translucent one; a reader who had the row on
under the built-in theme is given glass once.

It wears Mica Alt on Windows 11 - the Mica Microsoft asks of an app whose tabs are in
its title bar - plain Mica on the first Windows 11 and Acrylic on 10, tinted by the
scheme the page is in. The chrome (the bar with the tabs, the list, the foot row) stands
on it under a wash of the theme's own colour, and every pane paints a paper of its own,
as see-through as the Content row allows (below), so the open tab still runs down into
the note. Mica keeps its own brightness whatever
the wallpaper is, so over it the wash is thin and the material shows; Acrylic is the
desk itself, so over it the wash is most of the colour, and at that weight every word on
the chrome still clears 4.5:1 over a white desk and a black one. `data-translucent` on
the root says which material the crate put there, and the order of the two halves is
fixed so the words never stand on nothing: on, the material first and the attribute
when the crate has answered; off, the attribute first. See `material.ts`,
`packages/themes/src/glass.css` and `apps/desktop/test/e2e/glass.py`.

**Glass follows what is open** (Emil, 2026-10-01: *"it should be based on what's currently
open, e.g. the website"*). The frame takes its colour from the tab in front, two ways. A web
page's own colour is Safari's: its `theme-color` (its `media` honoured), else what it paints
along its top edge, read off the page's document at three points (`web_tint.rs`; in a
browser, `readFrame` on a frame of the app's own origin), else - where the top is a picture
or the points disagree - the top rows of the still the window already took as the page
landed. The frame is that colour over the material, and the web bar and the open tab are it
solid, so tab, bar and page are one surface: the active web tab does take the page's colour,
as Safari's compact tab does, because in nib the bar between the tab and the page takes it
too, and a neutral tab over a coloured bar would cut the one surface in two. A mark is Chrome's
and Arc's: a note's cover, its icon's colour, a site's favicon while its page has said
nothing, else the accent, as a tone mixed into the scheme's own chrome, so a note's frame
stays calm. Nib's spaces have no colour of their own, so there is no space step.

Words always read. The frame wears whichever scheme's words read on the colour - `data-theme`
on the title bar, the strips, the side panels, the foot row and the web bar, so every token
there is a measured palette and the accent stays the reader's (`--accent: inherit`). A page's
colour is moved toward that side's chrome by the least scrim that makes `--muted` clear AA
with a row's lift on it (`barFor`: white, black and yellow pages need none; a loud red turns
a darker red), and the frame's wash is never under the floor that holds AA over every colour
the material can be (`frameFor`, `scrimFloor`). `glass/tint.test.ts` holds both to a set of
sites and marks, and `test/e2e/glass-pages.py` measures the screenshots. Colour work happens
when a page lands or moves, a quarter of a second after the last news, and on a tab switch -
never on a frame; `main`, the bar and the tab ease to the new colour over `--dur-slow`. The
working out is behind a door glass alone opens (`glass/follow.svelte.ts`); the first frame
of a launch wears the colour it was left on (`glass/chrome.svelte.ts`). Grounds are kept per
page and origin like favicons, so a tab opened again is its colour before it loads.

**Glass's dials** (Emil, 2026-10-03: *"the blur can't be entirely turned off; the blur
option is too limited"*). Windows Terminal is the model for what is offered and Arc's theme
for how little is said: Material (Mica Alt, Mica, Acrylic, No blur - the desk itself,
unblurred, Terminal's opacity with acrylic off), Opacity from nothing of the frame's
colour to all of it, Follow the page or one colour of the reader's, Tint (how much of
what is open is in that colour), Coloured tab (whether the open tab and the web bar take
the page's colour) and Content. DWM fixes Acrylic's blur, so a blur strength is the
choice between the materials rather than a dial (window-vibrancy has no radius; its
`apply_blur` lags on 22621). The material is a desktop's: where nothing is behind the
window those rows are not drawn. Nothing on the frame ever reads under its floor: the
Opacity dial's track is grey below the least wash that keeps the quiet grey at AA over
every colour the material can be - six to one over the unblurred desk, whose edges are
there to read past too - and the knob stops at its edge (`least` in themes/settings.ts,
`frameFor` in glass/tint.ts). Over Mica that floor is low and the material shows; over
Acrylic and No blur, whose desk may hold white and black at once, it is most of the wash,
which is the honest answer to a desk nobody can see in advance. The crate is asked for
the material by name and keeps it (`material.txt`), so a launch puts the chosen one
back before the page has started.

**Content** (Emil, 2026-10-03: *"the glass theme should also apply to the background of
the terminal or of nib notes"*). Opaque, Tinted, See-through, under glass and the
wallpaper alike: how far what is behind the frame reaches the surfaces somebody reads
on. The paper is the page's own `--bg` laid at an alpha (`--content-ground`), so the
words keep the palette they were measured on; See-through is the least paper under which
body text clears seven to one and the quiet grey and a link AA over every colour that
can be under it, Tinted halfway to opaque (content-ground.ts). The pane lays it once and
what it holds stands on it (`--content-inner`): a note, a canvas, the surround of a PDF
and of a page note, the graph. A code block, a table and a callout keep fills of their
own, mixed into `--bg` rather than laid over nothing. The terminal lays the rest of the
way to a floor of its own on top, with xterm.js pulling a program's colours to 5.5 from
the paper while it is see-through, so every one of the sixteen reads at AA on the ground
under it. A web page, a PDF's pages and a page note's sheets paint their own: a page is
printed paper. The settings and every other sheet stay opaque: they float over content,
and what would show through is a second layer of words (Windows' own dialogs are solid
for the same reason). The list and the AI panel are the frame already. Nothing is
filtered: a see-through paper is one more layer to composite, and
`apps/desktop/test/e2e/theme-options.py` counts the frames of a long note scrolled and
typed into on the built-in theme, glass and the wallpaper, all at a median of one frame.

Glass is offered on every platform: Windows puts Mica Alt, Mica or Acrylic under the colour;
macOS (whose webview is opaque without the private API), Linux, the browser and a phone stand
it on the paper. Nothing scrolls under nib's frame, so no `backdrop-filter` is spent anywhere.

Two tokens carry it. `--window-ground` is `--bg` in every window there has ever been,
and `transparent` over the material; `html` and `body` are painted with it.
`--shell-ground` is what `main` stands on, the same colour unless a theme lays a wash
over the material, said once there rather than on each of the three layers.

The material needs something to be seen through, so the window is created transparent -
`transparent: true` in `tauri.conf.json`. Every other theme paints an opaque ground over
every pixel, which is exactly what it painted before. A launch whose window last stood on
the material puts it back before the page has started (`see_through` in `ground.rs`), so
the first frame is the material and not the desk through an empty window. On macOS
transparency is behind Tauri's `macos-private-api`, which is not turned on, so the page
is drawn on an opaque webview and glass there is its colour on the paper; that is a
decision about the App Store rather than about this feature.

`apps/desktop/src-tauri/src/appearance.rs` is both commands, `window-vibrancy` is what
they ask, and `scripts/appearance-e2e.py` and `scripts/glass-probe.py` drive them: they
read the frame back off the window rect against the client rect, and the material back
off DWM, rather than off the app's own opinion of what it did.

**Wallpaper.** A picture of the reader's own behind the frame, the second theme about
the window rather than the palette, and drawn by the page, so it is offered on every
platform: Windows, macOS, Linux, the browser and a phone show the same thing, and none of
them needs a material. Named for what the reader brings rather than for the effect, and
because a theme called Blur would have a Blur dial under it. The chrome (the bar with
the tabs, the list, the foot row, and a pane with nothing open, the way a browser's new
tab shows its background) stands on the picture; a note, a canvas and a terminal stand on
a paper of their own, as see-through as the Content row allows, and a web page always
paints its own.

The picture is a copy, never a link: chosen through the system's file chooser in
Settings ▸ Appearance ▸ Picture, or with Use as wallpaper on a picture's row in the file
list, it is drawn into a canvas at most 960 pixels across and kept in the app's own
IndexedDB, so the original can move or go (Windows Terminal's `backgroundImage` is a path
and breaks when the file moves). From that copy the app makes the picture the window
wears once, when it is chosen and when the Blur dial moves: blurred in three box passes
and kept as a PNG one pixel per half-blur of the screen, a few kilobytes. Nothing filters
anything as the app is used, so the picture costs a frame nothing (Vivaldi's blurred
toolbars are a live `backdrop-filter`); the window only stretches a still picture.

**The wallpaper's dials.** Blur from 0, a picture as sharp as it was taken, to 60;
Dim; Saturation; Tint toward the accent or another swatch; Grain; Fit (Fill, Fit, Tile,
Centre) about a focal point dragged on the thumbnail; Empty panes; Content (above). The
light and the dark side each have a thumbnail, and the dark side wears the light side's
picture until it is given one of its own, as a Mac's dynamic desktop does. Blur,
saturation and tint are baked into the picture when the dial moves - at most once a frame
while it is dragged, kept when it is let go of (`try` and `set` in theme.svelte.ts) -
and grain is a tile of noise drawn once. Under a light blur the kept picture is too small
to hold what is left to see, so once the launch has painted the app lays a copy at the
screen's own size over it (`sharpBelow` in pixels.ts), made from a copy of the original
kept up to 3200 pixels across. The dials are said in code behind the theme's door
(`own` in theme.svelte.ts) rather than declared in its sheet, which a file may do six
times and which cannot say a floor.

Words never depend on the picture. Two scrims lie over it: a floor, worked out from the
picture's own least and most of each channel, with its grain, so that `--muted` clears
4.5:1 over every colour in it - rising to 6:1 as the blur goes to none, since a sharp
picture has its edges to read past as well - on the list's layer and on a row under the
pointer (`look.ts`, `floors.ts`, `legibility.ts`), and the Dim dial over that. Two layers at f and d are one at
f + (1 - f) d, so no position of the dial is unreadable. The open note's row is a pill
of the accent on the scrim's colour rather than a tint of the picture. Each scheme has
its own scrim and floor, so switching is instant. Until a picture is chosen the theme
wears a soft field of the accent, with floors `floors.test.ts` holds to every accent.

The picture rides in the theme's own sheet (`wallpaper/sheet.ts`), so the sheet a launch
wears before any chunk has arrived (`SHEET_KEY` in `theme.svelte.ts`) is the picture as
well, and nothing of the theme is in front of the first paint; `test/weight.test.ts`
holds every wallpaper module out of that graph. `--window-ground` is the picture's mean
under its floor, so even the frame before any script is its colour. A system asking for
less transparency gets a floor of 85%, and forced colours take the picture away.
`apps/desktop/test/e2e/wallpaper.py` measures the result off the screenshots.

The scrim and ink maths in `legibility.ts` is written for the Glass redo as well: the
ink that reads on a ground (`inkFor`, what `--accent-ink` is for an accent) and the least
scrim that keeps an ink at AA over a span of colours (`scrimFloor`).

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

What this reaches: the panel tabs and the panel under them, on a desktop
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
  six vh above the others and each picked its own width. How big it is, is one
  rule for all of them; see below.

Where it sits is the caller's. What it is, is the class.

#### How big a layer in the middle of the window is

The settings were 56rem across and 76vh down: a width that follows the reader's
text size and a height that follows the window. On a 2560 by 1440 window that is
840 by 1094, a portrait slab with Appearance's few rows at the top of it, while
the Frame control broke "nibeditor's own" over two lines. Every layer that stands
in the middle of the window now takes its size from one scale in `tokens.css`,
the way Obsidian's `--modal-*`, Notion's settings and Windows' own Settings hold
both sides to a number:

| Token | Width | What |
| --- | --- | --- |
| `--screen-ask` | 24rem | a question: the prompt, signing in, joining, the theme picker |
| `--screen-sheet` | 28rem | a sheet of rows: sharing, publishing, importing, rewriting, the icon picker, choosing a space |
| `--screen-list` | 36rem | a list to search: the palette |
| `--screen-pair` | 46rem | two things side by side: the sync question, version history |
| `--screen-panes` | 60rem | a list of panes beside a pane: the settings, and the theme store a gutter inside them |

- Both sides are rem, and each is held inside the window by `--screen-gutter` on
  every side. Nothing is a share of the window one way and a fixed size the other.
- No layer is taller than `--screen-tall` (44rem), which is what a 720-pixel
  window has room for: every pane of the settings is in view at once there.
- A layer that grows as somebody types hangs from `--screen-top`, so its top edge
  stays put while the list under it changes. One whose size does not change while
  it is up stands in the middle (`.is-centred`), and one with several things to
  show in one place - panes, versions, themes - is one height whichever is showing
  (`.is-steady`), so moving between them never resizes it.
- A phone's layers are sheets from the bottom and pages the size of the screen,
  each sized by its own rule; the height rules name the desktop.
- A control's words never wrap where the window has the room: a segmented
  control's halves are a grid of equal columns, each as wide as the widest word.
  `test/e2e/modal-size.py` opens all of them at four windows and three scales.

A thing that is a rounded square rather than a control - a space's badge, a face,
the round button a thumb makes a note with - has a corner of `--radius-third` of its
side, so it is one shape at any size. The round button wrote its own 18px, which is
that share of 56.

### The stack

What is in front of what is one ladder of names in `tokens.css`, and a layer takes
the rung that says what it is. Sixty-five numbers said it before, each picked against
the numbers its author could see: 4 and 5 for two lists, 20 and 21 for the palette,
57 and 58 for the theme picker, 90 for a row being carried and 1000 for a tab, so
nothing said which of them had to be over which. Obsidian's `--layer-*` is the model.

| Rung | What stands on it |
| --- | --- |
| `--z-under`, `--z-base`, `--z-raised`, `--z-lifted` | a part over or under its siblings, inside something already positioned |
| `--z-drawn` | drawn over a surface's content: ink on the plane, the frame the glasses read through |
| `--z-grip` | what a pointer takes hold of: a port, a handle, the lasso, a scrollbar |
| `--z-tools` | the tools over a surface: a pane's head, the plane's bar, the graph's corner |
| `--z-bars` | a bar over those: finding on the plane, what is picked, a page's zoom |
| `--z-popover` | out of a control: a dropdown's list, the list of spaces, the `[[` suggestions, the sentence behind an `i` |
| `--z-float` | floating over the note: the new-note button, the way out of full screen, the loading line, a site's bubbles |
| `--z-bar` | the format bar |
| `--z-drawer` | a list panel that is a drawer |
| `--z-screen` | what replaces part of the screen: the palette, signing in, joining, choosing a space |
| `--z-notice` | a notice over all of that |
| `--z-cover` | the first sync, covering the window |
| `--z-settings`, `--z-store` | the settings, and the theme store opened from them |
| `--z-sheet` | a sheet over any of those |
| `--z-menu` | a menu over everything open, the theme picker, a dropdown's sheet |
| `--z-lightbox`, `--z-stage`, `--z-carried` | a picture on its own, a deck presented, what the pointer carries |

A scrim names the rung of the layer it is put up under, `--scrim-z: var(--z-menu)`,
and stands one step below it, so a layer and its scrim can never be the wrong way
round and no component writes a pair of numbers again. `test/stack.test.ts` refuses a
number in any stylesheet or script, a rung that is not on the ladder, and a ladder
that does not climb.

### The page a note is on

Typora calls it `#write`, and every sheet here, every theme in the registry and every
reader's custom.css is written against that. An id is one element, and a document is
one page: an export and a published note have exactly one and keep it. The app has
several at once - panes side by side, a column of stacked notes, the card over a link,
this slide and the next in the presenter's window - and each of them carried the id.

So every page wears `.nib-write`, and only the page in the focused pane wears
`#write` as well: the one a reader is in, which is what a drive, a shortcut and a
theme mean by it. The rules reach every page because the app reads each of them as
`:is(#write, .nib-write)` where it puts them on the page - its own sheets in the
build, a theme, custom.css and the code palette as they are injected - and `:is()`
weighs what its heaviest argument weighs whichever one matched, so no rule wins or
loses by it. See `write.ts` in @nib/themes; `test/write.test.ts` holds it.

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

### Ink on a fill

The accent cannot be both the ink and the fill: a colour bright enough to be read
on the dark page is too bright to carry white, which came to 3.98 to one on every
primary button and to 2.67 on the High contrast theme. So what is written on a fill
of the accent is a token of its own, `--accent-ink`, answered per scheme the way
Material's `onPrimary` is: the page's darkest ink on the dark side, white on the
light one. Every filled accent surface reads it - a button's words, the plus that
makes a note, the letter in the badge of the space you are in, the knob of a switch
that is on, a bar's button under the pointer, the match find is on, a caret's name.

| Palette | at rest | hovered | pressed |
| --- | --- | --- | --- |
| dark | 4.89 | 5.99 | 7.28 |
| light | 5.95 | 7.04 | 8.60 |
| High contrast, dark | 7.29 | 9.23 | 5.91 |
| High contrast, light | 9.18 | 11.09 | 13.36 |

On the dark side `--accent-press` moved away from the page, which is lighter, rather
than towards it: under a dark ink a press that darkened the fill dimmed the words as
it landed. The accents a reader can pick write their own press the same way, and
three of their light shades - teal, green and yellow - are a step darker, because
they were short of white at 3.44, 4.10 and 4.48. `test/ink.test.ts` measures every
palette and every accent at rest, hovered and pressed, and refuses a white written
straight onto anything.

A theme whose accent wants the other ink says so with `--accent-ink`, like any other
colour.

The accent written as text on a surface lighter than the page, and the tab strip's
inactive labels, are the two questions left; see "What needs deciding" at the end of
this file.

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

The rounded square in front of a name that belongs to somewhere rather than to a
file: a space's mark in the switcher and the header over the file list. A person
is round; see *Faces* below. `.nib-badge` in `base.css`, at
`--row-height-sm` with a corner a third of its side and a mark of `--icon-md`
inside it, so it is the same object at 24px under a pointer and at 48 under a
thumb. What fills it is the caller's: `--badge-fill` and `--badge-ink` per badge,
`is-on` for the accent, `is-quiet` for a badge that is only a place for a mark.

### Faces

A person is round, where a place is a rounded square, so the two are told apart by
shape before anything is read (Discord's rule): `people/Avatar.svelte`, the one
face, at 16 beside a caret's name, 20 in a tab, 24 in a row, 32 in a list of people
and 80 on a card. Their picture, faded in over their initial so a slow one is the
initial and then the face, never a blank; or their initial alone, in
`--accent-ink` on their accent. A dot in the corner, ringed in the ground it sits
on, says whether they are here: `--success` filled while active, a ring while
away, a moon in `--callout-warning` for Do not disturb, nothing while offline. A
face that is a button presses in like every button and opens the person's card.

A person's colour is the accent they chose, or one derived from their account
rather than picked, in `accents.ts`: the same person is the same colour on every
device and after every reload, which is the opposite of how a device chooses the
colour of its caret - two of one person's machines have to differ, two people
looking at one list have to agree.

Several people together overlap, each ringed in the ground (`people/Faces.svelte`):
the switcher's row of a shared space draws up to three of the others in it, owner
first, beside the shared mark.

The avatar sheet is the picture under a round window, dimmed outside it, the zoom
slider and the turn button under it, and Keep: nothing else (docs/chats.md 4.15).

A mark inside a badge is `display: block`, and that is load-bearing rather than
tidy. An `svg` is an inline element: it sits on the text baseline of whatever
wraps it, and the line box around that baseline is taller than the box the badge
gave it, so the descender under the baseline pushes the mark down. One pixel,
which is exactly what a mark sitting low in a badge looks like. `Icon.svelte`
says it once for all three kinds of icon, and nothing else should have to.

Where a space is named, it is named with its badge: the switcher's rows, the
header over the file list, and the title bar while the list is shut. One pairing,
so a space is one object whether the panel is out or away. The header and the rows
are one badge written once - `SpaceBadge.svelte`, which both render - so the space
you are in cannot come to wear on the header something its own row does not. The rows
are one row written once too, `SpaceRow.svelte`, which the dropped list and the
switcher Ctrl+Space stands in the middle of the window both draw: the badge, wearing
the space's number at its corner only once a digit is typed or while Alt is held
(`.nib-keytip`, the tab's Alt number's own look, so it moves nothing as it comes), the
name with what was typed in bold, and the shared mark -
an eye instead where the space is somebody else's and yours only to read. The title bar is that same switcher, bare: the badge and no
name, because the badge already says which space it is and the tabs want the room,
and a press on it drops the same list from the bar's bottom edge at the panel's
width. The name is in its tooltip and in what a screen reader hears. Changing space crosses the header's mark into the next one
rather than swapping the drawing between two frames: `arrive` and `leave` with
nothing to slip, in the box the two share so the name beside them does not move.

### Dots, and what is not a dot

A dot is one fact: something is still under way. The light that is about work in
progress rather than about a file - a request waiting to be let in - wears it, and so
does a tab with no file yet: a new note, plane or
page note has not been given a place, which is the one thing about it still to do
(`.nib-unsaved`, see `UnsavedDot.svelte`). A tab with a file wears none - every note
writes itself a moment after it changes - and nor does a web tab nobody has kept,
which is a browser tab with nothing unwritten in it.

That somebody else is in this at all is a mark, never a dot. `SharedMark.svelte`
draws it once - Lucide's `users`, at `--icon-sm` in `--muted`, in the row's
trailing slot - and it says it in five places: a shared space's row in the
switcher, the header over the file list, the shared-with-you row at the foot of
the switcher, a note in the file list somebody else is in, and the tab of a
document shared on its own, which has no row in the list to carry it. A dot in
the accent used to say the first of those, which meant the one shape the app had
for a fact about a file was saying two unrelated things at once.

Who they are is the one thing the mark cannot say, and that is what the stack on
a tab is for: a face per other person in the note and an accent dot per other
device of the reader's own, three of each at most, beside the mark rather than
instead of it.

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

### Hints

nib explains nothing in its own text, so a feature somebody has not found gets a card
beside the control it lives behind, the way Google Docs and Notion point at theirs:
one line saying what it does, pressed to do it, and a cross to put it away. At most
one a session, not before the window has been open twenty seconds, never again once
put away (`nib:hints`, per device), and none at all in Silent mode (Settings > General,
off out of the box, an account setting). There are three, in order: signing in, the
graph, and the palette's keys. The store is `hints.svelte.ts`, the card
`HintCard.svelte`, and both are fetched through a door, since no launch draws one.

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
3. **The panel tabs** - the segmented control the settings sheet already uses, so
   the tab you are on is raised out of its groove exactly the way every other "this
   one" in the app is, and the raised surface slides between them rather than
   blinking; see "Swapping". The pill is as wide as its tabs, each a mark with
   `--space-2` either side as in the view's layout switch, at the start of the row;
   a share of the row each drew six marks 130 pixels apart in a wide panel. The
   panel's own tools (hold, graph, order, stop, New chat and Chats) are one group at
   the row's far end. Where the row is too narrow, a tab gives down to its mark and
   `--space-1` either side, and past that the last tabs go behind a More segment at
   the pill's end that lists them with their keys; the tab showing always keeps a
   place. VS Code's activity bar does the same. See `tabsShown` in `workspace/panels.ts`, and
   `test/e2e/panel-tabs.py`, which measures it at three widths in both schemes.

The tabs sit between the name and the search entry rather than under both: the
entry has to be in one place whether it is the pill or the field, and the field
belongs to the Search panel, which begins under the tabs. So the order on the
screen is name, tabs, entry, list - and the entry never moves.

### Either side of the note

Two sides, and the panels are divided between them by what they are about. The left
is the space: the file list and the search. The right is the note in front - its
outline, its links, its properties, its footnotes - and the conversation about the
space, which is the Ask panel; see `STARTS_RIGHT` in `workspace/panels.ts` and
docs/ai.md. That is Obsidian's division, and VS Code keeps its chat on that side too:
the eye goes to one side for "where am I" and to the other for "what is this".

Having a home on the right is not being open. The right side is shut until somebody
asks for it - its button at the end of the bar, **Ctrl+Alt+B**, or the key of any
panel over there - so a window still opens on a note and nothing else, and the first
paint is what it was. The button opens whatever the side showed last, and its first
panel before that, which is the Outline: a first press lands on something that works
with no setup at all. The button is there whether or not the side is showing, because
a button that appears only once you have arranged the window is a button for people
who already knew. It goes only when every panel has been moved off that side.

Any panel can still live on either side - its own menu says `Move to the right`, and
`Move to the left` again - and a window somebody arranged keeps its own arrangement.
The session writes down which panels the build that wrote it knew, so a panel added
later takes its own home rather than quietly appearing on the left of somebody who
had moved their outline over before it existed; see `rightFrom`.

Three of the right side's panels are fetched rather than carried: Ask and Properties
when one of them is first shown - the conversation carries everything the app knows
about talking to a model, and a window that opens on a note has not been asked for
it - and the Links panel with its rows at the launch's last turn, as the Search panel
is, so its tab is never a wait. `test/weight.test.ts` holds all three out of the first
paint.

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
it. A thumb pulls it out from the right edge the way the left one comes from the
left, as Obsidian's phone app does: one engine serves both edges; see
`drawer.svelte.ts`.

Which side each panel is on, which of them is open over there, and which it showed
last is part of what the window remembers - beside which notes are open, and per
window rather than per account, the way the sidebar's width already is.

### Properties beside the note

Front matter starts hidden in the note, because the metadata at the top of a file is
what the app reads rather than what a reader reads on the way in. Hidden is not gone,
so the Properties panel on the right is Obsidian's File properties view: the note's
keys as rows, each with the control its value asks for - a field, a number, a date, a
checkbox, chips for a list, a menu where the app has fixed answers - and a row to add
one. A key is renamed by a double click on it or from its menu, and removed from its
menu. Every change is one edit of exactly the characters that change, through
`property-edits.ts` in @nib/markdown, into the note's own document: the note's own
undo takes it back, and every pane showing the note has it at once. A block nib cannot
read without guessing - a comment, a nested shape - is shown as the YAML it is and not
turned into rows. A tag in a `tags` list asks the space about itself, as a tag does
everywhere else.

The value controls are one component, `lib/properties/PropertyValue.svelte`, which a
table's cell draws too (docs/tasks.md 5.12): a date is picked the same way in the panel
and in a view.

### The Tasks panel and the views

The Tasks panel is the third tab of the list panel, a box with a tick in it, and it is
navigation, never the work (docs/tasks.md 5.5). Its rows are `.nib-row`s with a mark,
the name and the count as the row's meta: the add row, Inbox, Today, Upcoming and the
Logbook, then under section labels the space's `.base` files, the projects (every note
with open tasks, the last written first, seven and then More) and the labels.
Bookmarked ones come first. Today's count turns to `--danger` while something is
overdue, and that is the only colour in the panel. A row opens its view in a tab; a
project's menu opens it as a board or a calendar. Moved to the right, the panel is
Today's list itself, worked through beside the note.

A view tab (`lib/views/ViewTab.svelte`) is a head and a body. The head is the view's
name, which is the menu of the base's views and what can be done to them; the layout
switch, a `.nib-segmented` of seven marks drawn on the panel marks' 13 unit grid (list,
table, cards, board, calendar, timeline, chart); the filter, the sort and the group as
glyphs that light in the accent while set, each opening a `.nib-layer` under it; the
view's own search field; and the plus. The body swaps with the app's swap motion
(`arrive` in slide.ts).

- **A task row** is Todoist's: a round box ringed in the priority's tone (p1
  `--canvas-1`, p2 `--canvas-2`, p3 `--canvas-5`), half filled while doing, filled and
  ticked when done; the words with their inline marks drawn; the chips after them in
  `--muted` at the small size, a date past in `--danger`; and where the task lives,
  note › heading, in the row's meta. A done row fades to 55%. A sub-task sits a
  `--row-indent` in under its parent, which wears the twist.
- **A group head** is the section label's shape with a twist and its count.
- **A card** (board, cards) is `--surface` on the column's `--surface-2`, `--radius-md`,
  a hairline, and a 3px start edge in the priority's tone. Every card on a board is one
  height, so a column is a window of what is on screen.
- **A calendar event** is a wash of its tone at 14% over the surface with a 3px start
  edge; a repeat's future occurrence is the same at 45% with a dashed edge. Today's
  date is a pill in the accent; in the week the hour column of today carries a 4%
  accent wash and a 2px accent line at the time.
- **Carried**, a row leaves a 35% ghost behind and a card of its words follows the
  pointer with `--shadow-md`, tilted 1.5 degrees; whatever would take it lights with
  `--surface-selected` and a 1px accent ring, `.is-taking` as a row of the file list
  does.
- **On a phone** the table is rows with their first three properties under the name,
  the calendar is an agenda, and the timeline is not offered.

A base in a note, a ` ```base ` fence or `![[Bugs.base#Board]]`, is the same frame with
the head at the row's size and a hairline round it.

### The Chats panel and a chat

The Chats panel (`lib/chats/view/ChatsPanel.svelte`) is the list panel's tab after Tasks,
a speech bubble, shown while somebody is signed in. Like the Tasks panel it is
navigation: a field that narrows the list, Activity (the reader's mentions, newest first)
and Saved, then a section label, Chats, with its plus, and a `.nib-row` per chat with
`#` for its mark. Discord's three states, and no other colour: read is `--muted`,
unread is `--text-strong` at the strong weight with its count as the row's meta, a
mention is a badge in the accent. A muted chat fades to 55%.

A chat tab (`lib/chats/view/ChatTab.svelte`) is a head, the rows and the composer, with
one message's replies beside them (on a phone, in their place).

- **The head** is `#`, the name, the topic as a quiet line written in place, the first
  three faces overlapping (ringed in the ground, as the switcher's are) with the count,
  and the pin. Each opens a `.nib-layer` under it (`Float.svelte`).
- **A row** is Discord's: a 32 px face and the name on the first row of a group (one
  person within five minutes), then only the words, with the time in the gutter on
  hover. The words are the notes' renderer at the row's size (`.nib-rendered`), a
  mention a wash of the accent and the reader's own a fill of it. Under them: pictures
  at the size the sender stated, a voice message as a pill with 64 bars and the accent
  filling them, a file as a card, a preview with a 3px accent edge, a poll as answers
  with bars of `--accent-soft`, reactions as round chips (the reader's own ringed in the
  accent, a new one popping from 80%), and the count of replies in the accent. A day is
  a centred label between hairlines; the New line is the accent's hairline with "New".
- **The hover bar** is one `.nib-layer` riding the row under the pointer: three
  reactions, the picker, Reply, Quote, ⋯.
- **The composer** is a `--radius-lg` box with the ground inside it, ringed in
  `--accent-soft` while it has the keyboard and in the accent while it edits; ⊕, the
  words, ☺, and the microphone, which turns into ➤ and its chevron once there is
  something to send.
- **Pills** are `.nib-pill`s at the top (the New line above, in the accent) and the foot
  (messages below).
- **Motion**: an arrival rises 6 px over `dur(160)`, a reaction pops, the replies slide
  in 24 px, a jumped-to row's accent wash fades over a second; reduced motion makes each
  a cut.

### The rail is gone

There were two ways to choose a space, and the header's is the better one,
because it says the name. A column of wordless squares is only legible to
somebody who already knows the squares; the header says where you are before it
offers to take you elsewhere, which is the order Notion and Discord both put
identity in. So the column goes, on every device, and everything it carried has
a home:

| What the rail did | Where it is now |
| --- | --- |
| Which space you are in | The panel's header, and the space's badge in the title bar while the panel is shut, which opens the same switcher |
| Switching to another one | Rows in that header's switcher, each with the space's own mark and a dot where somebody else is in it |
| Making one | A row at the foot of the same list, where a workspace switcher keeps it - and in the palette, as before |
| A space's own menu | The same entries, on the space's own row: a button at the end of it, a right click, or a held finger |
| Reordering by dragging | `Move up` and `Move down` in that menu, on every device |
| The account | The left of the panel's foot row, as a face and a name |
| The theme, and settings | The right of that same row |
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
face and a name - their picture, round, once they chose one - opening the account
pane - signing in, the name a shared space
shows, storage and signing out are all there, so who you are is one place rather
than a sheet here and a pane there; then the theme and the settings at the right,
where a switch goes. The theme is off while the theme in force has only the one
scheme. The settings button carries no sync light any more: Emil, 2026-10-06 (#206),
_"indicator dot next to settings should be removed (it blinks sometimes)"_. What a
pass did is the Sync pane's to say. The GitHub mark does not come back: it is a row
in Help.

### The theme picker

A right click on the light and dark switch, a finger held on it, or Switch theme in
the palette: every theme as a card of nib in its own colours, a theme with both
schemes cut on the diagonal the way a Mac draws Auto, the three schemes as marks at
the top and the accents as dots at the foot. Pointing - the pointer or the arrows -
puts that theme, scheme or accent on the whole app at once and writes nothing down;
moving off, Escape, a press outside and Back all put the kept look back exactly, and
a click keeps it the way Settings does. VS Code's colour theme list is the model,
with the cards it lacks and the pointer trying as well as the keys.

Over the app without dimming it, since the app is what is being judged, and never in
the launch: the switch fetches the picker as it is pressed. A card is painted inline
from colours worked out of the sheets' text rather than by the page, which answers
for the window's own theme on everything that carries the scheme attribute. See
`apps/desktop/src/lib/theme-picker/`.

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
goes inside a space's badge. And the cross: an X is drawn in `Cross.svelte` and
nowhere else, and no button spells one as a letter.

Three more stand beside it. `stack.test.ts` refuses a z-index that is not a rung of
the ladder. `ink.test.ts` measures the ink on an accent fill on every palette the app
ships and every accent a reader can pick, and refuses a white written straight onto
anything. `write.test.ts` holds the page a note is on to one id and every page to the
class.

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

**The accent as text on a surface lighter than the page.** On the dark palette
`--accent` carries 4.52 against a panel, 4.20 against a card and 3.73 inside a
menu. The fill has its ink now (see "Ink on a fill"); the accent written *as* text
- a link in a menu, a chip's word under the pointer - is still the brand colour,
and lifting it is picking the brand.

**The tab strip's inactive labels.** They are `--muted` by design, which now
clears the floor; what is left is whether the tab you are *not* in should be
readable at all or deliberately recede. Notion lets it recede. Obsidian does
not.
