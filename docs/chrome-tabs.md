# Chrome's tab strip

What the desktop Chrome strip does, read off the Chromium source (`main`, September
2026), and what nib takes from it. Numbers are Chrome's DIPs; the last column is
nib's. Source paths are under `chrome/browser/ui/`.

## Shape

| Rule | Chrome | Source | nib |
| --- | --- | --- | --- |
| Strip height | 41 = tab 34 + toolbar overlap 1 + top padding 6 | `layout_constants.cc` | the bar's 38 |
| Gap above a tab | 6 (`kTabStripPadding`) | `layout_constants.cc` | 5 |
| Top corner radius | 10, shrunk so a third of the top stays flat on a narrow tab | `tab_style.cc`, `horizontal_tab_style_views.cc` `GetTopCornerRadiusForWidth` | `--radius-md` (9), same shrink |
| Concave foot where the active tab meets the toolbar | radius 12 (`GetBottomCornerRadius`), outside the tab body | `horizontal_tab_style_views.cc` `GetPath` | `--radius-md` |
| Active tab fill | the toolbar's colour; the path runs 1 DIP into the toolbar, so no line under it | `tab_style.cc`, `kTabstripToolbarOverlap` | the colour of what is under the strip; the bar's hairline stops under it |
| Underline on the active tab | none | | none (was a 2 px accent line) |
| Hover fill | a detached rounded rectangle: top 6 down, 6 + 1 short of the bottom, every corner rounded, in the header's hover tone (`kColorSysStateHeaderHover`, a tone past the frame) | `GetPath(kHighlight)`, `material_tab_strip_color_mixer.cc` | the same box, 5 from the top and from the bar, in `--tab-hover`: the ink lifted 8% off the frame, which the plus and the steps light in too |
| Contents | centred in the hover's box: the strip's padding above and below (`GetContentsInsets`), not the active body's middle | `tab_style.cc` | `.pick` padded `--tab-top` above and below, so the middle of the strip, level with the bar's own buttons |
| Hover in / out | 200 ms, ease-out in, ease-in out | `glow_hover_controller.cc` | `--dur-fast` |
| Separator | 2 x 16, 2 margin either side, trailing edge of a tab | `tab_style.cc` | 1 x 16 |
| Separator hides | next to a tab with a fill: active, selected, hovered; faded with the hover | `GetSeparatorOpacity` | active, hovered, picked, dragged |
| Tab overlap | 18 = 2 x 12 foot - (2 separator + 4 margins) | `GetTabOverlap` | none: tabs sit edge to edge, the feet are drawn outside the box |

## Widths

A Chrome width includes the 18 of overlap; nib's is the pitch, Chrome's minus 18.

| | Chrome | nib pitch |
| --- | --- | --- |
| Standard (preferred) | 232 + 2 x 12 = 256 | 238 |
| Minimum, active | favicon/close 16 + insets 2 x (12 + 8) = 56 | 38 |
| Minimum, inactive | interior 16 - 2 + 18 = 32 | 14 |
| Pinned | 24 content + insets = 64, fixed | 46 |
| Content inset from the tab edge | 12 foot + 8 padding | 3 half-gap + 8 |

Distribution (`tab_strip_layout.cc`):

1. Sum the three totals: preferred P (all standard), crossover C (all at min-active),
   minimum M (active at min-active, the rest at min-inactive). Pinned tabs are the
   pinned width in all three.
2. Room W >= C: every unpinned tab is `lerp(min-active, standard, f)`,
   `f = clamp((W - C) / (P - C))`. Active and inactive are the same width.
3. W < C: the active tab stays at min-active, the others are
   `lerp(min-inactive, min-active, f)`, `f = clamp((W - M) / (C - M))`.
4. Widths are floored, then the pixels left over go one each to the first tabs
   that can still grow, left to right.
5. W at or past P: every tab is standard and the strip ends early.

Contents (`tab.cc` `UpdateIconVisibility`, `tab.h`):

- Active: the close button always, then the favicon if 16 more fit.
- Inactive: the favicon if it fits; the close button only when the contents are
  at least 68 wide (100 on touch).
- Nothing fits: the favicon alone, centred and clipped.
- Pinned: the favicon, centred; never a close button.
- Width below min-inactive: nothing at all.
- Title: fills what is left and fades out over its last ~3 characters
  (`FADE_TAIL`, `render_text.cc`: `min(3 chars, width / 3)`); never an ellipsis.

## Closing

| Rule | Chrome | Source |
| --- | --- | --- |
| Close button | 16 visible (14 with rounded icons), 28 hit box, a circle on hover | `tab_close_button.cc` |
| Middle click | closes, on release, only if released over the tab | `Tab::OnMouseReleased` |
| After a close by mouse | the rest keep their widths: the available width is overridden to the old one minus the closed tab, so the next close button slides under the pointer | `horizontal_tab_closing_helper.cc` |
| Closing the active tab | the width taken off is the next inactive tab's | same |
| Leaving that mode | the pointer leaves the strip plus 40 below and 60 past its end; a tab opened or moved; touch: 2 s after the close; widths back at preferred | same |
| Only when needed | not entered while tabs are already at their preferred width | same |

### A tab with no file

**A new note, plane or page note is a tab with no file, and a dot after its name says
so** - `.nib-unsaved` in the themes package, drawn by `UnsavedDot.svelte` in the strip,
the bar over a phone's note and the palette's row, and on the mark's shoulder for a tab
that is only its mark. The press on the dot is Save, as Ctrl+S is: a small layer under
the tab, Chrome's bookmark bubble, with the name its first line offers and the places the
Move sheet offers, starting on the root of the space it was opened in. A tab dropped on a
row of the file list is saved there. A web tab nobody has kept wears no dot - a browser
tab has nothing unwritten in it - and is saved the same way. See `workspace/drafts.ts`.

**Closing one asks nothing**, as a browser asks nothing: an empty one just goes, and one
with words keeps them twice over, on the closed stack for Ctrl+Shift+T and in Recently
deleted for fourteen days, from where it is restored as the note it would have been
(`trash_words` in `trash.rs`, `workspace/placing.ts`). VS Code and Notepad ask "Save
changes?" here; nib has no such question anywhere.

**A session brings every tab back, whatever its kind.** A tab is written down as a
`Draft` (`workspace/session.ts`): its kind, its file or none, its words where the disk
has not got them - which for a tab with no file is always - the space a tab with no file
was opened in (`space`), and the view state its kind keeps. `draftOf` writes one and
`tabsFrom` reads it back, for the session, a named layout and the closed stack alike; a
kind that restores is a kind whose words are enough to rebuild it (a terminal's are its
shell and folder, see `terminal/spec.ts`), so a new kind adds fields to `Draft` and reads
them there rather than keeping a second record.

### A space's own tabs

**A space shares the window's tabs or keeps its own: Tabs, Global or Space, in the space's
menu under Web data**, the same row built the same way with the same two words. Emil,
2026-10-01: *"there should be an option whether the tabs are global or only for the space.
Only for the space means the whole open configuration is saved for that space, and it
changes automatically when you switch to another space."* Every space is Global until
asked, which is what every space was before, so nothing moves because the row exists.

- **What a set is**: the tabs - notes, tabs with no file, web tabs, terminals, pinned
  and previewed ones - their order, the panes and splits, which tab is in front in each
  and which pane has the keyboard, the pane filling the window, both sides' panels, the
  tab the panels are held on, and whether the keyboard was in a page. The places inside
  each tab - caret, scroll, a page's own history and zoom - are the tab's and come along.
  The sidebars' widths are not: a width is the screen's (sidebar-width.svelte.ts).
- **A switch** puts the set on screen aside and brings the space's own in, in the step
  that changes the space, so the first frame after it is the new set. The strip arrives
  in place, fading in and rising its last four pixels in 150 ms, and the set that left
  goes at once; between two Global spaces nothing is swapped at all.
- **Out of sight nothing closes.** Every tab of every set is in the window's one strip,
  with a pane nobody is showing, so one document per file and one tab per web note hold
  across sets, and a terminal and a page go on as long as their tab is open; Hidden tabs
  in docs/web-tabs.md says what a page out of sight may do.
- **Something already open goes to where it is**: a tab of another set chosen in the
  palette, a web note opened again, a note a link or an agent opens that is open in
  another space's set - the space switches, as Arc's command bar goes to a tab's space,
  VS Code goes to the window a folder is open in and Chrome to an open saved group.
  Anything not open opens in the set on screen.
- **Global to Space**: the space keeps the tabs that are its own (its files, and the
  tabs with no file opened in it); the rest stay shared and leave the strip with the
  close motion. **Space to Global**: its tabs join the shared set at the end of the strip
  in front. Nothing is closed either way.
- **A restart** brings each set back: the one on screen is the session's arrangement,
  the others are written beside it as the same `Layout` and built back through the same
  restore at the launch's last turn. A web tab of one comes back without a page until it
  is shown, a terminal starts when it is first shown.
- **Windows**: the choice is the space's, on this device; each window keeps its own sets
  as it keeps its own tabs, and the session is the window that wrote last, as it always
  was.

See `workspace/sets.ts` for the rules and `workspace/sets.svelte.ts` for the store.

### Move to space

**Any tab moves to another space: Move to space in its menu (a pick of tabs too), in the
palette, or the tab carried onto the space switcher**, which opens under it after 450 ms,
as a folder opens under a held file, and lights the space it would land in. Emil,
2026-10-03: *"It should be possible to move a tab to another space (e.g. relevant for
terminal tabs that you can't just close and reopen without losing progress)."*

- **The same tab.** Nothing closes and opens again: a terminal is the same shell, its
  process and its screen; a page keeps its place; an unsaved note keeps its words and its
  undo. It joins the end of the strip in front in the other space's own set, or of the
  shared set where that space is Global, in front of its pane; between two Global spaces
  nothing moves on screen.
- **The window stays.** Edge opens the workspace a tab is moved to and loads all of it,
  and that is the complaint its users have; the tab is waiting when the space is next
  shown. The set it left falls back to the tab used before, as after a close.
- **What makes the tab that space's goes with it.** A file in a space - a note, a web
  note, a plane, a deck of pages, a PDF - moves to the other space's root, with its links
  and its Undo, and every view of it follows. Arc's Move to space carries a pinned tab -
  the space's saved thing - out of one sidebar into the other, and Edge's takes the tab
  out of the workspace it was in; the saved thing here is the file, and a tab whose file
  stayed behind would be sent back the next time its space's tabs went Global. A tab with
  no file is given the other space as its home: saved there, searched there, a terminal's
  last lines kept under it (docs/terminal.md). A file in no space and a note shared on its
  own move as the tab alone. A file of that name already there stays, and so does its tab.
- **A page's web data is its new space's**, as a web note's is the space holding it.
  Where the two spaces share a store the page goes on as it was - Chrome moving a tab
  between two windows of a profile; where they do not, it is built again in the new one
  on the address it was on, and the line under the bar says so for four seconds of being
  seen, as a web tab saved into such a space does (`web-tab/rehome.ts`). Arc asks first;
  nib says it after, as everywhere else.
- **Never** into a space that may not be written in, nor a file out of one.

See `workspace/space-move.ts` for the rules and `workspace/moving-space.ts` for the move.

### The scratchpad

**One note in no space, for pasting and jotting before deciding where it goes.** A
switch, never a tab (Emil, 2026-10-05): the pad glyph at the bar's top right, beside the
right sidebar's, is pressed while its card is up. Raycast's notes and Apple's Quick Note
are one key both ways; VS Code's layout buttons sit in the same corner:

- **A card docked at the window's edge.** The note's own live-preview editor in a card
  under the bar, the panes narrowed beside it - docked rather than floating, because a
  web tab's page is a native view that would draw over a floating card. Over the note
  where the panels are drawers. It scales in from the glyph's corner.
- **Never a tab.** Not in a strip, Ctrl+Tab, the closed tabs or the session's tabs;
  opening its file from anywhere (a search hit, an agent) shows the card. A Scratchpad
  tab an older session left is dropped on the way in, its unwritten words written first.
- **The switch, the key, Escape.** The glyph shows and hides it and leaves the keyboard
  where it is. Ctrl+Shift+X and the palette's **Scratchpad** do the same, but with the
  card up and the keyboard elsewhere they put the keyboard in it, as VS Code's terminal
  key does. Escape inside puts it away. Shown by a person it takes the keyboard, and
  hidden it hands it back where it was.
- **Written as it changes**, a pause after the typing stops and at once as the card or
  the window goes; no dot. Whether it is up and how wide (its edge drags) are kept per
  window and are the same in every space, since it is the one note in no space.
- **The app's own, not a space's.** `Scratchpad.md` beside `custom.css` in the app's
  settings folder (`scratchpad_path` in themes.rs; `openable` admits it), the same note
  from every space; the browser build keeps it in a dot folder no space lists. Its name
  is its file's, the same in every language.
- **Found from every space**: the Search panel reads it with each search
  (`search/scratchpad.ts`), and no replacement across a space touches it.
- **Move to space makes it a note.** The glyph's right click offers Move to space: it is
  written into that space's root, named by its first line, opened, and the scratchpad
  emptied and put away; the space on screen is offered too.
- A quick question's **Add to note** with no note in front lands on its end; see
  docs/ai.md.
- **An agent's too.** The note verbs reach it as `tab: "scratchpad"`: read and edited
  through the card while it is up, the reader's caret carried, and in its file either
  way, without a tab or the card being opened to do it (`agents/docs/desk.ts`).

See `scratchpad/is.svelte.ts` for which file it is and whether the card is up,
`scratchpad/pad.ts` for what it does and `scratchpad/ScratchpadCard.svelte` for the card.

## Motion

| Rule | Chrome | Source | nib |
| --- | --- | --- | --- |
| Every bounds change | 200 ms, `EASE_OUT` = `1 - (1 - t)^2` | `bounds_animator.h`, `tween.cc`, `tab_container_impl.cc` `AnimateViewTo` | `--dur-base` (210), `--ease-out` |
| New tab | starts overlap-wide (zero visible) at the previous tab's end, grows to full width while the ones after it slide along | `StartInsertTabAnimation` | grows from 0 |
| Closed tab | shrinks to overlap-wide (zero visible), then goes; drawn as no longer active from the first frame, the next tab active at once | `StartRemoveTabAnimation` | shrinks to 0, inactive and out of the pointer's way |
| Reduced motion | `RichAnimationDuration` drops to 0 | `animation.cc` | the `--dur-*` tokens are 0 |

nib moves a tab with `transform` and changes its width on an absolutely placed box,
so a width change lays out that one tab and nothing beside it.

## Dragging

| Rule | Chrome | Source |
| --- | --- | --- |
| Press | selects the tab at once, before any movement | `Tab::OnMousePressed` |
| Threshold | 10 in any direction (Euclidean) | `TabDragController::CanStartDrag` |
| Following | the tab keeps the offset it was grabbed at and follows the pointer 1:1; not animated | `DraggingTabsSession::GetAttachedDragPoint` |
| Constrained | x clamped to `[0, drag area - tab width]`; the drag area is the whole room for tabs, empty stretch included | same, `GetTabDragAreaWidth` |
| On top | dragged tabs paint above the rest; no shadow, no scale | `tab_container_impl.cc` z-order |
| Where it lands | the slot whose ideal x is nearest the dragged tab's x, i.e. past a neighbour's midpoint | `CalculateInsertionIndex` |
| Hysteresis | reorder only after the pointer moved more than `16 x target tab width / standard width` since the last reorder | `kHorizontalMoveThreshold` |
| The others | slide to their new slots with the 200 ms bounds animation | `AnimateToIdealBounds` |
| Pinned | a pinned tab stays among the pinned, an unpinned one after them | `TabStripModel` |
| Drop | the tab animates from where it is to its slot, 200 ms | `ResetDraggingStateDelegate` |
| Detach | the pointer more than 15 above or below the strip (50 on touch), or past its ends: the tab tears off into a new window that follows the pointer | `kVerticalDetachMagnetism`, `DoesTabStripContain` |
| Attach | over another window's strip (same magnetism), the tab joins it at the nearest slot and its tabs make room | `GetDragTargetForPoint` |
| Escape | reverts: every tab back to where it was, a torn-off window closed | `EventTracker`, `RevertDrag` |
| Touch | a tap selects; a scroll gesture drags; a long press ends the drag (and is the menu) | `Tab::OnGestureEvent` |

## Other gestures

| Gesture | Chrome (Windows) |
| --- | --- |
| Double click on empty strip | maximise / restore the window (it is caption) |
| Right click on empty strip | New tab, Reopen closed tab, and rows about the window |
| Double click on a tab | nothing |
| `+` | right after the last tab; at the strip's end once full |
| Full strip | tabs shrink to their minimum and the rest is cut off; tab scrolling was removed in Chrome 144 |
| Mouse wheel on the strip | nothing (Linux may switch tabs) |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgDn, Ctrl+PgUp | next, previous, wrapping |
| Ctrl+1 to Ctrl+8, Ctrl+9 | that tab, the last tab |
| Ctrl+Shift+PgUp, Ctrl+Shift+PgDn | move the tab one slot, stopping at the ends |
| Ctrl+W, Ctrl+Shift+T | close, reopen |

## What nib does differently, and why

- **No tear-off into a window.** nib is one window. Dragging out of the strip is
  its pane drop instead: against a side makes a pane, onto another pane's strip
  joins it and that strip makes room, as Chrome's attach does.
- **The floating tab has a shadow.** Chrome moves a whole window; nib carries the
  tab itself over the panes, so it is lifted to read as out of the strip.
- **The strip scrolls when even the minimum widths do not fit**, rather than
  cutting tabs off: a tab that cannot be seen cannot be pressed. The mouse wheel
  goes along it then, as VS Code's does; a strip that fits leaves the wheel alone,
  as Chrome's does. See `tab-strip/wheel.ts`.
- **A link dropped on the strip opens where it was let go**, as Chrome's does, and
  the strip makes room for it the way it does for a tab; it never replaces the tab
  under it. See `tab-strip/dropped.ts`.
- **The tab menu is Chrome's, VS Code's and Obsidian's rows** that nib has
  something behind: Reload and Copy link on a web tab, Rename, Duplicate, Pin,
  Close, Close others, Close tabs to the right (to the left in a language that
  reads the other way), Close all, Reopen, Split, Move to other pane. A pinned tab
  is never one the closes around a tab take. See `tab-strip/menu.ts`.
- **Ctrl+W on a pinned tab asks first**, which Chrome does not: a key closes
  whatever is in front, and the tab's own Close row and the middle button, which
  are aimed at it, still close it outright. See `workspace/closing-pinned.ts`.
- **The empty strip's menu is New tab, Reopen closed tab and Close all tabs**, each
  about that strip's pane. Chrome's other rows there - bookmark all tabs, name the
  window, the task manager - have nothing behind them in nib. A held finger asks for
  it too. See `tab-strip/strip-menu.ts`.
- **Ctrl+D puts the tab down** rather than bookmarking the page: no tab in the strip is
  the active one, so none has the fill or the feet and every hairline shows, the pane
  shows the cards a pane with nothing open shows, and every tab stays open. Chrome always
  has a tab in front; nib already had the empty pane. The focused pane only; a press on
  a tab, the digits or Ctrl+Tab bring one back. A page is offered the key first, as
  Chrome offers it its bookmark key. See docs/keyboard.md.
- **Double click on a tab keeps a preview** (VS Code's rule; nib opens previews).
- **Ctrl+1..9 are Alt+1..9 and Ctrl+Alt+1..9**, because Ctrl and a digit is a heading
  level. Alt+9 is the ninth tab and Alt+0 the last (Emil's rule); Ctrl+Alt+9 stays
  Chrome's last. A place past the end does nothing, as in Chrome.
- **Colours are nib's tokens**; the strip's ground is `--surface-2` so the active
  tab has something to be cut out of.
- **The cross turns the danger colour on hover**, over Chrome's grey circle: nib's
  own close.
- **A web tab's active fill is the bar's `--surface`, a note's is the page's
  `--bg`**: the active tab is filled with whatever is under the strip, which in
  nib is not always a toolbar. Under the glass theme the strip stands on the
  window's material and every pane paints its own paper, so the merge is exact
  there too; and a web tab's fill is its page's own colour, the bar's, so the tab,
  the bar and the page are one surface (docs/design.md, Glass).
- **Hover cards are Chrome's**, read off `tab_hover_card_controller.cc`: the first waits 300 ms
  at a pinned tab's width and 800 at the standard one on a logarithmic scale, measured on the
  widest tab of the strip, and half a second more once every name is whole; the next tab's
  comes at once and the card slides across, 200 ms; back on the strip within 300 ms of leaving
  it, at once; a tab the keyboard arrives at, at once. The name in two lines, where the file
  lives (its space and folders) or the site's host - with, for a page of another space than
  the one on screen, that space's mark and name, Arc's way of marking a tab only where it
  turns up outside its space - and for a web tab that is not the one in front the still of
  its page. Any press, key, wheel or the window losing the pointer puts it
  away, and the pressed tab says nothing more until the pointer leaves it; never over a menu,
  during a drag or under a finger. Over a native page it takes a place on the overlay stack,
  so the pages stand behind their stills while it is up. The tab carries no native tooltip.
  See `tab-strip/card.ts` and `tab-strip/hover-card.svelte.ts`.
- **Several tabs at once are Chrome's pick**: Ctrl (Cmd on a Mac) and a click adds or takes
  out, Shift a run from the last one clicked, both to add a run; the tab in front is always
  one of them, and anything else bringing a tab to the front puts the pick down. Picked tabs
  wear the fill every list wears for a picked row (`--surface-picked`), and a Ctrl or Shift
  press that leaves its tab picked goes on to drag the pick, as Chrome's does. A tab's menu
  on a picked tab acts on all of them (Reload, Duplicate, Pin, Bookmark, Close, Close others,
  to the right, all, Move to other pane) and says how many; Ctrl+W closes the pick. Dragging
  one carries the others of its pinned state as one block, along the strip or into another
  pane. A pick closed, and the tabs closed around one, come back with one Reopen closed tab,
  as Firefox brings them back; Chrome hands them back one at a time. Shift and an arrow does
  not extend a pick here: a tab brought to the front takes the keyboard into its note. See
  `tab-strip/picking.svelte.ts`.
- **No groups.** Tab search is the palette.
- **A web note is open in one tab**, across panes, splits and windows: opening it again
  goes to where it is, as Chrome's "Switch to tab" and VS Code's `revealIfOpen` do, and
  never pulls it into the pane in front. Duplicate, a split and a copy-drag of one make
  an unsaved web tab at the same page instead of a second tab of the file. Notes,
  planes and page notes may still be shown twice. See docs/web-tabs.md.
