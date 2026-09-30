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
| Hover fill | a detached rounded rectangle: top 6 down, 6 + 1 short of the bottom, every corner rounded | `GetPath(kHighlight)` | the same box, `--surface-hover` |
| Hover in / out | 200 ms, ease-out in, ease-in out | `glow_hover_controller.cc` | `--dur-fast` |
| Separator | 2 x 16, 2 margin either side, trailing edge of a tab | `tab_style.cc` | 1 x 16 |
| Separator hides | next to a tab with a fill: active, selected, hovered; faded with the hover | `GetSeparatorOpacity` | active, hovered, dragged |
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

## Motion

| Rule | Chrome | Source | nib |
| --- | --- | --- | --- |
| Every bounds change | 200 ms, `EASE_OUT` = `1 - (1 - t)^2` | `bounds_animator.h`, `tween.cc`, `tab_container_impl.cc` `AnimateViewTo` | `--dur-base` (210), `--ease-out` |
| New tab | starts overlap-wide (zero visible) at the previous tab's end, grows to full width while the ones after it slide along | `StartInsertTabAnimation` | grows from 0 |
| Closed tab | shrinks to overlap-wide (zero visible), then goes | `StartRemoveTabAnimation` | shrinks to 0 |
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
  nib is not always a toolbar. With window translucency on, the page is the
  wallpaper and the fill is still `--bg`, so the merge is only exact without it.
- **No hover cards, groups, multi-select or tab search.** nib has none of them.
