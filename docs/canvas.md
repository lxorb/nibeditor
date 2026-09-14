# The canvas

An endless plane with cards, frames, connectors, shapes and ink on it, in a tab
like a note. The file is [JSON Canvas](https://jsoncanvas.org), the same one
Obsidian writes, with the ink and the shapes under a `nib` key that any other
reader ignores. Several devices can be on one plane at once; see
[collaboration.md](collaboration.md).

This is the interface, and why it is the one it is. Two apps were read closely
first, because between them they are what everybody arrives already knowing: a
tablet with a pen behaves like Samsung Notes, and a board with cards on it
behaves like Miro.

## Samsung Notes

**What it does nicely.** It is pen first and it never asks a question a hand
cannot answer while it is writing. Everything is in one bar across the top: the
five instruments, three colours, the width of the line drawn as that width, undo
and redo. Nothing is nested that a hand reaches for mid sentence.

The gesture that carries the whole app is pressing the tool you are already
holding: it opens that tool's own options and nothing else. Nobody has to be
told, because a pen out of a pot and a pen out of a pot pressed again are
obviously two different presses.

The options themselves are the right ones. A thickness dial with a number beside
it and a minus and a plus, so a thumb can nudge it and an eye can read it. A
stroke eraser and an area eraser as two named things rather than as degrees of
one, because they are two different jobs: a whole letter gone, or a hole in a
drawing. Lasso or rectangle. Opacity on the highlighter. Straighten lines. A
real colour picker with swatches, a spectrum, hex, an eyedropper and the colours
you used lately, which on a drawing matter more than the presets do, because a
drawing is three colours used over and over.

**What is bloat.** Eighteen icons in one row, and five of them are a puzzle:
tape, ruler, lock, AI, convert to text. Tape is a picture of stationery for
something no other app has. Convert to text and AI are a different product
wearing the same bar.

**What is unintuitive.** Every popover is laid out its own way, so nothing you
learn in the pen's transfers to the eraser's. The eraser hides two switches that
break it silently: leave "erase highlighter only" on and the eraser stops working
on your handwriting with nothing on screen to say why. The nibs are drawn as five
illustrated pens, which is five pictures of one object and reads as decoration
next to the flat marks in the rest of the bar. And the bar owns the top edge in
landscape, which is where a right hand rests its wrist.

## Miro

**What it does nicely.** One visual language: a single outlined icon set, one
weight, on floating white cards over the board. The tool in hand is tinted, not
outlined, not raised, so which one is live is never a guess. Flyouts open beside
the tool they belong to rather than in the middle of the screen. Every tooltip
carries the tool's name and its key, which is how a person moves from clicking
to typing without reading anything. Undo and redo are their own small card, and
so is zoom, with fit, minus, the percentage and plus, so the number is both the
readout and the button. Smart drawing turns a wobbly circle into a circle. The
pen flyout keeps three colour circles, which is the same insight as Samsung's
three slots: a colour should not cost a trip through a picker.

**What is bloat, for us.** Templates, tables, kanban, stickers, GIFs, emoji,
comments, talktrack, AI, and a catalogue of 4,700 shapes. That is a whiteboard as
a workplace. A canvas in a note taking app is a place to think next to your
notes, and every one of those would be a second product to keep working.

**What is unintuitive.** The rail is down the left edge, which on a tablet is
exactly where the drawer is dragged from and out of reach of both thumbs. Frames
and groups are two features with one name each and no visible difference. The
shape flyout is a list of words, so choosing a rectangle means reading. Zoom
lives in the far corner from the tools, and undo is in a third place again.

## What we took and what we left

| From Samsung | |
| --- | --- |
| Press the tool you are holding to open its options | kept, for every tool that has options |
| The width and the colour visible without opening anything | kept |
| Stroke eraser and area eraser as two named things | kept |
| Lasso or box, and whether a half caught stroke counts | kept |
| Opacity, and a straighten switch | kept |
| Recent colours beside the presets | kept |
| Favourite pens set the way you set them | kept, as exactly three |
| Illustrated nibs, tape, ruler, lock, AI, convert to text | left |
| A switch that spares one kind of ink | left, it breaks the eraser silently |

| From Miro | |
| --- | --- |
| One outlined icon set at one weight | kept, Lucide, the app's own set |
| The live tool tinted rather than raised | kept |
| Flyouts anchored to the tool that opened them | kept |
| Name and key in every tooltip | kept |
| Undo, redo and zoom as their own groups | kept, in the one bar |
| Shape recognition | kept, as a switch on the pen |
| Everything drawn while it is being dragged out | kept, for every one of them |
| A rail fixed to the left edge | left; the bar goes to whichever edge it is dragged to |
| Templates, kanban, stickers, comments, AI, 4,700 shapes | left, and seven kept |

## One bar

There was a bar for a mouse and a second one for a finger. Two bars is two
designs, two lots of drift and two places to fix anything, and the difference
between them was never really the pointer: it was size. So there is one bar now.
It holds the same buttons in the same order everywhere, and a touch screen reads
the `--touch-*` scale for them, the way every other surface in the app does.

Left to right, in the order a hand uses them:

```
[arrow] [hand] | [pen] [pen] [pen] [eraser] [lasso] | [put down] | [ink] | [undo] [redo] | [-] [92%] [+]
```

Arranging is on the left, drawing is in the middle, and what a press puts on the
plane is one button with a grid behind it: a card, a note, a picture, a link and a
frame, then the seven shapes. Twelve things one press deep rather than twelve
buttons, because a hand that is drawing never wants them and a hand that is
arranging wants one of them at a time. Each of them has a key, and the tooltip says
which. A line across the grid divides what a note taker puts down from what a
diagram is drawn out of; they are two questions and they read as two.

**A note and a picture are two entries.** They were one, called "note or picture",
which meant somebody who wanted a photograph on the plane was asked which note to
embed and the picture was unreachable. They come from different places - one from
the space, one from the device - so they are two things to want. A picture opens the
system's own picker, which on Android is the gallery, the camera and the files app
in one sheet; the bytes go where every other pasted picture goes, and the plane gets
a `file` node pointing at them, so Obsidian reads it. A picture dropped on the plane
or pasted into it takes the same road.

**Three pens, always three.** A pen is a thing you own rather than a setting you
pick, so a favourite is the whole pen: which nib, how wide, how much of the
colour lands, and which colour. Three slots, never more and never fewer, so there
is no adding, no putting away, no dragging them into order and no row that
outgrows the bar. Press one to take it, press it again to open it up.

**Where the bar sits.** Bottom centre, to begin with: in reach of both thumbs on a
phone and clear of the pane's own corners.

It is dragged by its grip and it comes with the finger - the whole bar, under the
hand moving it, rather than jumping between two places as it crosses the middle -
and when it is let go it springs to whichever of the four edges it was let go
nearest. On a side it stands on its end: the same buttons in the same order, down
instead of across, and its flyouts open beside it rather than over it. One bar, one
order, one design; only the axis turns.

All four edges, because where a bar is in the way is a different place on every
device and in every grip: a right hand writing on the lower half of a page wants it
gone from the bottom, and a hand holding a tablet by its long edge wants it there.
The device remembers, and it still folds away to a handle. That is a question only a
tablet has, so only a tablet is asked it.

## One popover

Every tool's options open in the same shell, anchored over the button that opened
them, and each is built from the same three rows: a preview at the top, dials
with a number and a minus and a plus, and switches under them. A tool takes the
rows it has something to put in them: the lasso has neither a width nor a line
to show, so its panel is the shape choice and one switch and nothing else. The pen's preview
is the line it will write, drawn by the same outliner that paints the plane, so
what the panel shows is what the nib does. The eraser's is its nib at its real
width on the paper.

There is one row of colours in the app: the six the theme names, the ones used
lately, no colour at all, and every other colour behind the wheel. The pen's
popover shows it for the pen; what is picked shows it for what is picked.

**The dot that means "no colour" is drawn in what it means.** A card with no colour
of its own wears the surface, so a hollow ring is the truth for one. A pen with no
colour of its own writes in the ink the page is set in - nearly black in a light
theme and nearly white in a dark one - and a hollow ring there was a hole with the
panel showing through it: it read as a white dot in one theme and a dark one in the
other, for the same pen. So the pen's own dot is drawn in the ink it writes, and
every dot in the row wears a hairline of the page's own ink at a whisper, which is
what makes a white one visible on white paper and a black one on black.

**Every popover shuts on a press anywhere outside it**, on Escape, and when a tool
is taken. The press is caught on the way down at the window rather than waited for
on the way up: everything else in the app closes a panel with the click that follows
a press, and the plane cannot use that, because it reads a press as the start of a
gesture. A panel that stayed open through a whole stroke is a panel over the very
drawing it is about.

## What a press puts down

Everything a press puts on the plane is **pulled out**, and drawn the whole way: a
card, a frame, a picture, a diamond and an arrow alike. Pressed once it lands at its
own size; dragged, it lands at the size it was dragged to, and what is on screen
while the pointer is down is exactly what lands when it comes up. It used to be that
a card appeared at a fixed size on a press and a shape appeared only once it was let
go, so dragging an arrow out was a gesture with nothing on screen in it.

The corner being dragged snaps like a card being dragged does - to the grid, and to
the edges and middles of whatever is already on the plane - with the same lines
saying why.

**A line dragged between two cards is a connector**, not a line lying across them:
that is what a hand drawing an arrow from one card to another means. While it is
being dragged the anchor it will attach to is filled in on the card it is aiming at,
and the near end moves to the anchor it will leave by, so the dashed line on screen
is the connector it is about to become. Dragged anywhere else it stays a line. An
arrow carries a head, a line does not, and an elbow turns a corner.

**The seven shapes** are four bodies and three lines: a box, a ring, a diamond and a
triangle; a line, an arrow and an elbow. Not four thousand, and not four: those four
were what a hand draws beside a card, and a diagram wants a diamond for a question
and a triangle for a warning as much as it wants a box.

**A shape holds words.** A shape in a diagram is a shape with a name in it far more
often than it is a shape, so it takes them the way a card does - a double press or
Enter to type, the same renderer, in the middle of the shape - and they are written
under `nib` beside the shape itself.

## What is picked

A small bar over the selection: its colour, duplicate, group, delete, and the rest.
They are the things a hand does to a card it has just put down, and the bar is where
the hand already is rather than at the bottom of the pane. The group button is there
only when there is something to do with it: several things picked can be made one
frame, and a frame picked can be taken apart. Everything else that can be done to a
selection stays in the menu behind the last button - lining up, spreading out, the
z order, the arrows on a connector - which is the menu a right click and a long
press already open, so there is one list and not two.

**What is picked wears handles**: eight to resize by, and the whole of it to move
by. Shift holds the shape of the box while it is resized, and a picture under a
thumb holds it without being asked, because there is no Shift on a tablet and a
photograph stretched one way is not the photograph. A connector wears a round handle
at each end instead, and dragging one onto another card moves that end there.

**Alt on a drag leaves a copy behind.** The originals are what the pointer carries
away, so nothing is renamed halfway through a gesture, and the copy and the move are
one thing to take back.

The colour a shape or a card is given is remembered as the colour the next one
gets, which is the only thing on the plane that carries over from one object to
the next.

## What the pointer says

A mouse hand should never have to look at the bar to know what a press will do, so
the pointer itself says it. An arrow arranges. An open hand moves the page and
closes while it is moving it. A corner handle wears the arrow that says which way it
pulls, and a connector's anchor wears the finger that says it can be grabbed.

Two of them are drawn rather than named, because no cursor keyword can say "this
wide, in this colour": the pen is a dot at the width the nib will really draw, in
the ink it will really draw in, and the eraser is a ring exactly as wide on screen
as the hole it will rub. Turning the width dial redraws them while the slider is
still moving.

A touch screen has no cursor and is given none. There the eraser draws its ring on
the page instead, under the finger or the nib, while it is rubbing.

## The pattern behind it

One lattice of dots, on the plane rather than on the screen: the grid a node lands
on, and its spacing in plane units never changes. What changes is how many of them
are drawn. Zoomed out they would close into a wash, so every second dot along each
axis stops being drawn and what is left is the same lattice at twice the spacing.
Every level is exactly twice the last, so the dots that stay are always ones that
were already there. The pattern only ever thins.

A level thins once its dots have closed to 12px, and comes back only once there is
15px again. The gap between the two is the hysteresis: a zoom resting on a threshold
cannot flap between two patterns.

Crossing a threshold starts a fade of 210ms and that is all the zoom has to say about
it. What moves is one number, a position between levels rather than an opacity, so a
fling across four thresholds passes through the levels in turn instead of popping;
zooming back mid-fade turns that fade round rather than queueing another. Somebody
who has asked for as little movement as possible is given the new level at once.

So the dots on screen are never closer than 12px and never further apart than 30,
there is one repeating tile at rest and two while a level is leaving, and a plane
zoomed out far enough reads as a grid rather than as the blank grey field it once was.

## Zoom

Minus, the percentage, plus. The number is the button that fits the whole plane
in the pane, which is the only other thing anybody asks of a zoom. Pinch, the
wheel and the keys do the rest and always did.

One notch is `NOTCH` in `apps/desktop/src/lib/camera.ts`, and the buttons and the
wheel really do agree on it now: the comment here said they did while the buttons
stepped by a fifth and the wheel by two fifths, which is two zooms for one hand.
`wheelZoom` is the one function both the plane and a page note ask.

On paper the number opens rows instead - a sheet has a width to read at and a page
to see whole, so there is more than one answer to "fit"; see [pages.md](pages.md).

## Keys

Every tool has one, every one of them is in the shortcut registry, and the
tooltip shows it. So the bar teaches the keyboard: a mouse hand reads `R` under
the rectangle once and stops using the button. On a touch screen the tooltip
drops the key, because a key means nothing to a thumb.

## The first canvas

An empty plane says one line in the middle, and it fades the moment anything is
on the plane. It is read off the plane rather than remembered, so emptying one
brings the line back: a plane with nothing on it is a plane that has nothing to
say about itself either way. That is the whole of the teaching. A tool bar that
has to be explained is a bar that is wrong.

## Two hands and a pen

The rules a tablet is held to, all of them in `canvas/pointer.ts` and all of them
tested there rather than tried by hand:

- **A pen writes and a hand moves the page.** The first time a pen touches this
  glass the finger stops being a nib, whichever pen the bar is holding, because a
  palm resting on a page while the other hand writes must not leave a mark. A
  phone has no pen, so there the finger draws.
- **Two fingers are the page, in every tool.** Wherever a second finger lands it
  takes over as a pan and a pinch, whatever the first one had started: a card
  being dragged, a band, a shape, or a stroke. A stroke a moment old is given up
  for it, which is what every drawing app does. A stroke older than that keeps the
  glass and the second finger is read as a palm, so a long line is never lost to
  a hand settling on the page.
- **A tap in a drawing tool is a dot.** Always. Nothing on the plane is ever
  created by a tap with a pen in hand: a card comes from the tool that puts one
  down, or from a double press with the arrow, and from nowhere else.
- **A press held still means something once.** Under a finger it is the menu.
  Under a pen that is drawing it is the stroke asking to be straightened, and only
  when the pen's own switch says so. Never a menu under a pen: a nib resting on the
  page is a hand thinking.
- **A pen with its button held rubs out**, whatever the bar says, set the way the
  eraser is set. A button pressed halfway through a line rubs out too, from where it
  was pressed, and the ink that line had laid down goes with it: a hand that presses
  the button while it is writing is a hand that wants to rub out, and a stub of a
  stroke it never meant to leave is worse than nothing. Nothing is on the plane until
  the pen lifts, so there is nothing to take back either. This is the one rule taken
  back from Samsung Notes, which settles what a stroke is when the nib lands: on the
  tablet that read as the pen going dead, because the line stopped and nothing was
  rubbed out.

**The button, in three shapes.** All of them are one S Pen on one tablet, and the
question is only which of them the browser will say this time:

| | |
| --- | --- |
| a pen with the eraser bit set | Chromium on a desktop |
| a pen with the right button bit set | Chrome on Android, where the barrel button is the right mouse button |
| a **mouse** with the right button, on glass that has had a pen on it | some builds, because a stylus with a button held looks like a mouse underneath |

The third is believed only on a touch screen that has had a pen on it: a desktop
right click is a desktop right click, and turning it into an eraser because somebody
once drew with a stylus would take the menu away for good. A pen never opens the
context menu, and on a tablet that has seen one nothing opens it that way at all -
there the menu is what a finger held still opens.

The browser also takes the contact away when it starts its own context-menu gesture
for that button: a `pointercancel` arrives while the nib is still on the glass and
still reporting. So a cancelled pen contact is doubted rather than ended - another
event with the same id inside a moment means it never left, and only silence ends
the gesture.

Samsung's S Pen reports the first event of a contact as a finger on some
devices. A pointer that says pen a moment later is a pen from its first sample:
the gesture the finger started is thrown away and the stroke begins where the nib
landed. Without that, the first press after picking the tablet up draws nothing
and pans instead.

A stylus is the one thing about this app that cannot be held from where it is
written, so the surface keeps two things in a hidden `[data-pointer]` element: what it
decided this device's pen is, and the last few pointer events it was handed - what the
browser called each one, its button and its buttons. A drive reads it, and a person on
the tablet can be asked what it says.

One thing outside the app's reach: in a browser tab, Samsung's Air actions can
take the S Pen's button for themselves while the pen hovers over the glass. If the
button rubs out in the installed app and does nothing in the browser, that is what
it is, and turning Air actions off for the browser is the fix.

## Every pen out there

The ink was built with an S Pen on a Samsung tablet, because that is the pen there
was to hold. Every other pen was built from what its platform documents about it,
and each of them is a value in `canvas/contacts.test.ts` rather than a device
anybody here has: the whole point of a pure contact model is that a pen nobody can
hold is still a test.

| platform | says | pressure | how it leans | barrel | eraser end | hovers | coalesced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Apple Pencil, iPad Safari and the PWA | `pen` | reported, through WebKit's own curve | `altitudeAngle` and `azimuthAngle`, and `tiltX`/`tiltY` on some builds | none | none | yes, M2 iPads and later | no, and no prediction either |
| Windows pens - Surface, Lenovo, HP, a Wacom on Windows - in WebView2, Chrome and Edge | `pen` | reported | `tiltX`/`tiltY`, and `twist` on a pen that turns | `button` 2, `buttons & 2` | `button` 5, `buttons & 32` | yes | yes |
| Desktop graphics tablets - Wacom, Huion, XP-Pen - in Chromium anywhere | `pen` | reported, at a very high rate | `tiltX`/`tiltY` | `button` 2, or the middle button if the driver was told to | `buttons & 32` | yes, and from anywhere on the tablet | yes |
| Samsung's S Pen, Chrome on Android and the installed app | `pen`, sometimes `touch` for the first event, sometimes `mouse` while the button is held | reported | `tiltX`/`tiltY` | `buttons & 2`, in all three shapes above | - | yes | yes |
| USI pens on Chromebooks, and the pens of the cheaper Android tablets | `pen` | often flat: exactly one half, or a fixed sliver, for ever | often none at all | usually none | none | some | yes |

Five rows, one code path. What each of them needed:

**The Pencil has no button, so the eraser has to be reachable without one.** It is:
the eraser is a button on the bar like every other tool, and it always was. Nothing
about the pen's own button is load-bearing anywhere - it is a shortcut for a hand
that has one.

**The Pencil says which way it is leaning in the other language.** Chromium reports
two angles off the vertical along the screen's own axes; WebKit reports an altitude
up from the glass and an azimuth round it, in radians. `tiltOf` in `canvas/ink.ts`
turns the second into the first with the conversion out of the Pointer Events spec,
so everything past the event reads one representation and the file format keeps one.
A pen lying flat on the glass is the spec's five special cases; holding the altitude
a millionth off nought instead agrees with all five to the degree, in one line.

**Safari has no `getCoalescedEvents` and no `getPredictedEvents`.** Both were already
feature-detected, and now neither is needed: a stroke there is whatever fitted into a
frame, and the ink draws the curve through those samples rather than the straight
lines between them. `smoothed` in `canvas/ink.ts` puts points on any step longer than
the nib is wide, along a centripetal Catmull-Rom spline, and leaves a dense stroke
exactly as it came - the fast path is one comparison a point. Centripetal rather than
uniform because a uniform spline loops back on itself at a sharp turn, and a loop in
the middle of a letter is worse than the corner it was drawn to hide. The samples
themselves are never moved: the ink still passes through every point the pen
reported.

**One width curve, with one number per platform.** Pressure is not a measurement: a
digitiser reports a fraction of its own full scale, and the browser puts its own
curve on top. The gain in `GAINS` is the exponent the reported pressure goes through
and the whole of what a platform changes about the ink - every platform whose pen has
been held here is 1, and the Pencil's is 0.8, because Safari reports a lower fraction
for the same weight of hand. That number is a judgement rather than a measurement,
and the table is the one place to change it.

**A pressure that never changes is not a pressure.** Some USI pens report exactly one
half for every sample of every stroke, and some report a fixed sliver near nought -
which, handed to a nib that thins with pressure, draws everything anybody ever draws
as a hairline. So `Stylus` watches the first fifth of a second of writing, and a pen
that has held one number across it stops being believed: the ink draws at the width
the nib is set to. Any variation at all settles it the other way for good.

**Tilt is recorded and never painted.** No tool reads it - the flat nib is held at a
fixed angle - so a pen that reports no tilt draws exactly what a pen that reports it
draws, and a tool that one day does read it degrades to the fixed angle rather than
to nothing.

**A hovering pen must not draw.** Every pen here hovers, and a hovering pen that is
allowed to lay ink down draws a line from wherever it was last seen to wherever it
turns up next - which on a graphics tablet, where the pen is somewhere on the tablet
whether it is touching or not, is a line right across the drawing. Nothing pressed is
nothing touching: `hovering` is `buttons === 0`, and a move that is hovering, or whose
contact the surface never heard land, contributes no samples, repairs no pen and keeps
no cancelled stroke alive. That last one was a real hole: a `pointercancel` is doubted
for a moment in case the nib never left, and a hover inside that moment used to count
as the nib still writing.

**One nib must not arrive twice.** Windows hands pen input to anything that does not
ask for it as mouse input, and a graphics tablet's driver will do the same on any
desktop if it is set up to. A mouse contact while a nib is on the glass is that nib
again, not a second hand, and it is dropped.

**Windows reads a nib held still as a right click.** It waits half a second, draws its
own ring, and then sends a context menu - and the wait is a delay before the page
hears anything at all. `touch-action: none` on the plane is what turns that off, and
there is no other way; the menu that arrives anyway is refused, for a pen that is
merely hovering as much as for one that is writing, because Windows sends it for a
barrel button held over the glass too.

**Safari selects, magnifies and highlights.** Three things that happen on an iPad and
nowhere else, and three prefixed lines on the plane that turn them off:
`-webkit-user-select`, `-webkit-touch-callout` and `-webkit-tap-highlight-color`.

**Scribble must not take the pen.** iPadOS turns a Pencil over a text field into a
handwriting recogniser and swallows the pen. The canvas host is a `div` with
`role="application"` and not a field of any kind, and a card's editor exists only
while that card is being written in - so there is nothing over the plane for Scribble
to aim at while anybody is drawing, and writing into a card with the Pencil still
works, which is what Scribble is for. Android is the same problem with a different
name and is turned off outright, in `MainActivity.kt`.

**A palm is a palm on every platform.** iPadOS rejects most of them before the page
sees anything, and the rest is the rule the plane already had: a touch that lands
while a pen contact is active is ignored, and a finger on glass that has seen a pen
moves the page rather than drawing on it.

### WebView2, and what it does not need

Whether the installed app needs a WebView2 setting so pen input reaches the page as
pen input: it does not, and the setting it might have wanted is one to stay away from.

WebView2 is Chromium, and Chromium routes stylus input through Windows' Direct
Manipulation so a pen can pan and fling a page the way a finger does. `touch-action:
none` is what tells it not to, per element, and the plane sets it. The blunt
instrument is the `DirectManipulationStylus` feature flag, which Tauri can turn off
through `additionalBrowserArgs` on the window - and turning it off would take pen
panning away from every scrollable thing in the app, so a note could no longer be
scrolled with the S Pen. That is a worse app for a problem the plane does not have.
So `tauri.conf.json` says nothing about pens, and if a pen ever does arrive on the
plane as a finger, the flag is where to look first:

```json
"additionalBrowserArgs": "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,DirectManipulationStylus"
```

The three that are already there are Tauri's own default, and passing the field at
all replaces them, so they have to be written out again.

### Borrowing a device

What to check, in order, on a device nobody here has. The hidden `[data-pointer]`
element is the answer to most of it: it holds what the app decided about the pen and
the last few events it was handed, as one line - `windows g1 tilt reported coalesced
predicted // down/pen b0 B1 | move/pen b2 B3` - and it can be read out of the page
without any tools at all.

**An iPad with an Apple Pencil.** The profile should say `apple g0.8`, and `spherical`
or `tilt` once the Pencil has leant. Write a word: the line should thin and swell with
the hand, and look like the same pen it is on the tablet. Write a fast one: it should
be a curve and not a run of straight lines. Hover the Pencil over the plane without
touching: nothing may appear. Rest a palm on the glass while writing: nothing may
appear, and the page may not move. Take the eraser from the bar and rub something out.
Pan with one finger and pinch with two while a pen tool is in hand. Double-tap a card
with the Pencil and write into it - Scribble is welcome there.

**A Surface, or any Windows machine with a pen.** The profile should say `windows g1
coalesced predicted`. Hold the barrel button and draw: it must rub out, and no menu may
open. Turn the pen over and draw with the eraser end: the same. Hold the nib still on
the plane for a second: Windows' own ring may appear, but no menu may open and the
stroke must carry on. Hover with the barrel held: nothing may happen. Draw, then click
with the mouse: one contact, one gesture.

**A Wacom, a Huion or an XP-Pen on a desktop.** The profile should say `desktop g1`.
Lift the pen, move it right across the tablet and put it down: the stroke must begin
where the nib landed, with no line from where the pen was last seen. Right-click with
the pen: it rubs out. Press whatever the driver has on the middle button: the plane
pans. Draw fast: no gaps, whatever the tablet's report rate is.

**A Chromebook with a USI pen, or a Lenovo or Xiaomi tablet.** The profile should say
`chromeos` or `android`, and after a stroke or two either `reported` or `flat`. If it
says `flat`, the ink is deliberately ignoring the pen's pressure - which is right if
the line looks even and wrong if the pen really does have pressure, and either way it
is one word to report.

## The line under the nib

A browser will guess where the pen is going next, and the guess is worth having: the
compositor is a frame or two behind the digitiser, and drawing a little ahead is what
puts the ink under the nib rather than trailing it. What it is not worth is what it
does on a turn. `getPredictedEvents` hands over a fan of points twenty or thirty
milliseconds ahead, and on every change of direction that fan is still pointing the
old way: the tail of the stroke flicks forward past the nib and snaps back on the
next event, which is what "the current stroke flashes a bit further, just for a sec"
was.

So the guess is kept and held to one point, no further ahead than the hand itself is
moving and no more than forty-five degrees off the way it is already going. Anything
further is dropped, and anything that turns a corner is dropped with it. It is drawn
and never kept: the stroke that lands is the samples the pen really reported.

## Somebody else's hand

Presence arrives in packets - twenty a second on a good line, fewer on a bad one -
and drawing each one where it lands makes another hand hop across the page. So the
drawn point eases towards the reported one instead, critically damped and frame-rate
independent, closing about two thirds of the gap every seventy milliseconds. It
never overshoots: a pointer that sails past where somebody is pointing and comes back
is worse than one that hops. A reader who has asked for as little movement as
possible gets the packets as they come.

The stroke under their pen is drawn where it was reported and never eased. Ink is a
shape somebody made, and a shape that catches up with itself is the wrong shape.

## Where the code is

| | |
| --- | --- |
| `canvas/pointer.ts` | every gesture, as a reducer over events, with no DOM in it |
| `canvas/contacts.ts` | what each pointer claimed when it landed, what it changed its mind about, what kind of pointer it really is, and which of the pens out there this device has |
| `canvas/trace.ts` | the last few pointer events, for a stylus nobody here can hold |
| `canvas/tools.svelte.ts` | which tool is in hand |
| `canvas/pens.svelte.ts` | the three pens, the eraser, the lasso, and which edge the bar is against |
| `canvas/hand.svelte.ts` | whether this glass has seen a pen |
| `canvas/glyphs.ts` | the Lucide icon, the words and the key for everything on the bar |
| `canvas/cursor.ts` | what the pointer looks like over the plane |
| `canvas/geometry.ts` | the plane's arithmetic: boxes, shapes, edges |
| `canvas/lattice.ts` | the pattern behind the plane: which level a zoom asks for, and the fade to it |
| `canvas/ink.ts` | outlines, erasing, lassoing, what a wobbly shape was aiming at, how far ahead of the nib the ink may reach, and what one pen event means whichever browser sent it |
| `canvas/ease.ts` | coming up to a number rather than jumping to it |
| `canvas/upload.ts` | asking the device for a picture |
| `Canvas.svelte` | the surface: hit testing, the events, and the effects carried out |
| `CanvasBar.svelte` | the one bar, and the popovers over it |
| `CanvasPicked.svelte` | the bar over what is picked |

## The other surface that uses all of this

A page note - sheets of paper in a column, written on with the pen; see
[pages.md](pages.md) - is this engine wearing paper, and that is worth stating here
because it is what stops there being two of anything.

It reuses, unchanged: `CanvasBar.svelte`, `CanvasInk.svelte`, `CanvasNode.svelte`,
`CanvasHands.svelte`, `canvas/ink.ts`, `canvas/paint.ts`, `canvas/svg.ts`,
`canvas/edits.ts`, `canvas/contacts.ts`, `canvas/camera`, and the two module
singletons that matter most - `pens.svelte.ts` and `tools.svelte.ts` - so the green
highlighter somebody picked on a plane is still in their hand on paper. Its store
extends `CanvasStore`, which gained one `parse`/`serialise` pair for it and nothing
else: the one edit per gesture, the one undo step, the one debounced write, the room
binding and the merge when words arrive from elsewhere are all inherited.

Two things were extracted so both surfaces could be held to one rule rather than two
copies of it:

- **`inks(pointer, glass)`** in `canvas/pointer.ts` - whether a contact of this kind
  may lay ink down at all. It is `toolFor`'s own condition with the tool left out, so
  a palm on paper and a palm on a plane are turned away by the same line and the same
  test. See "Two hands and a pen" above.
- **`parse`/`serialise`** in `canvas/store.svelte.ts` - the only overridable pair on
  the store. Both are the canvas format either way round, so a page note and a canvas
  write the same bytes and a file renamed across the two extensions loses nothing.

The file format is the same format: JSON Canvas, this reader and this writer, with a
page written as a spec node plus one record under `nib.pages`. `canvas.ts` grew a
fifth node kind for it - `page` - the way it already had `shape`: a node like any
other in memory, written under `nib` rather than invented into `nodes`.

What a page note does **not** reuse is `pointer.ts`'s machine, and deliberately: that
machine is about ports, connectors, resize handles and an endless plane, and a page
note has none of those. Its own handler is forty lines that call the same ink
functions. That is reuse of the engine, not a second engine - but it is the honest
line between the two.

The whole of it is driven for real by `test/e2e/canvas-arrange.py`: the built web app
in the machine's own Chrome, with mouse, touch and pen events through the DevTools
protocol, photographing the cursor every tool sets, the pattern at four zooms, the bar
at each of the four edges, every put-down tool while it is being dragged out, and the
barrel button in each shape a browser can be made to report it in.

And every pen out there by `test/e2e/pen-shapes.py`, one browser context per platform
so each carries that platform's own user agent and the app's own profile detection is
what decides: a Pencil with no coalescing and a lean in radians, a Surface Pen's barrel
and eraser end, a Wacom lifted and put down across the tablet, a USI pen whose pressure
never changes, and a finger on glass that has seen a pen. Two of the shapes cannot come
down the DevTools protocol at all - it carries the five buttons a mouse has, so the
eraser end is unsendable, and it has no field for the spherical angles - and those two
are dispatched as `PointerEvent`s from inside the page, through the same handlers, the
same reducer and the same ink.

## What we deliberately do not have

- **A ruler, tape and a lock.** Three pictures of stationery for three things
  nobody asked for.
- **An eyedropper.** The web has one on exactly one platform, and a colour picked
  off the drawing is a nicety next to the six presets and the last six colours.
- **A switch that spares one kind of ink.** It breaks the eraser with nothing on
  screen to say why.
- **Templates, kanban, stickers and comments.** A canvas is next to your notes,
  not instead of them.
- **A second row of the same buttons for touch.** One bar, one order, one design.
