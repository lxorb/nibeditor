/** Which side of the window each panel sits on, and which one each side shows.
 *
 *  Three things say all of it: the panel open on the left, the panel open on the
 *  right, and the list of panels that have been moved over to the right. A panel is
 *  on the left unless it is in that list, which is why a build that has never heard
 *  of the right side reads its own session back correctly.
 *
 *  Pure. Every one of these answers what the three would be after a gesture rather
 *  than doing it, which is what makes the rules - a panel moved while it was being
 *  read stays open over there, a side with nothing on it is not drawn - readable as
 *  rules and testable as arithmetic. The store writes the answer down; see
 *  `showPanel` and its neighbours in workspace.svelte.ts. */

import type { Panel, PanelSide } from '../workspace.svelte'

/** The three, together: what is open on each side and what has been moved over. */
export interface Sides {
  panel: Panel | null
  rightPanel: Panel | null
  right: Panel[]
}

/** Which side a panel lives on. Left unless it was moved. */
export function sideOf(right: readonly Panel[], panel: Panel): PanelSide {
  return right.includes(panel) ? 'right' : 'left'
}

/** The panel open on one side, which is what that side's tab strip marks and
 *  what its body draws. */
export function openOn(sides: Sides, side: PanelSide): Panel | null {
  return side === 'right' ? sides.rightPanel : sides.panel
}

/** Which tabs one side holds, in the order the strip shows them: the right
 *  side's in the order they were moved over, the left side's in the app's own
 *  order - which is the order they have always been in. */
export function panelsOn(
  right: readonly Panel[],
  side: PanelSide,
  every: readonly Panel[],
): Panel[] {
  return side === 'right'
    ? right.filter((one) => every.includes(one))
    : every.filter((one) => !right.includes(one))
}

/** Showing a panel, or shutting it where it is already the one showing. On its own
 *  side, so a panel moved to the right opens over there and the side it left is not
 *  disturbed. */
export function showing(sides: Sides, next: Panel): Sides {
  if (sideOf(sides.right, next) === 'right') {
    return { ...sides, rightPanel: sides.rightPanel === next ? null : next }
  }

  return { ...sides, panel: sides.panel === next ? null : next }
}

/** Shutting a side, whichever panel is in it. Its own answer because every caller
 *  had to name the panel it was closing, and `showing` only closes one by
 *  happening to be handed the one already open. */
export function closing(sides: Sides, side: PanelSide): Sides {
  return side === 'right' ? { ...sides, rightPanel: null } : { ...sides, panel: null }
}

/** Moving a panel to the other side, taking its open state with it: a panel
 *  somebody moved while reading it is a panel they want to go on reading, over
 *  there. The side it left keeps whatever else was open on it.
 *
 *  A side with nothing on it is not drawn at all, which is what the last panel
 *  leaving the right side means. */
export function moving(sides: Sides, panel: Panel, side: PanelSide): Sides {
  const was = sideOf(sides.right, panel)
  if (was === side) return sides

  const open = openOn(sides, was) === panel

  if (side === 'right') {
    return {
      right: [...sides.right, panel],
      panel: open ? null : sides.panel,
      rightPanel: open ? panel : sides.rightPanel,
    }
  }

  return {
    right: sides.right.filter((one) => one !== panel),
    panel: open ? panel : sides.panel,
    rightPanel: open ? null : sides.rightPanel,
  }
}

/** Where each panel lives until somebody moves it: the left is the space (the file
 *  list, the search), the right is the note in front and the conversation about the
 *  space - Obsidian's split, with the chat where VS Code keeps its own. */
export const STARTS_RIGHT: readonly Panel[] = [
  'outline',
  'links',
  'properties',
  'footnotes',
  'ask',
  'agents',
]

/** Every panel there is, in the order the left side's strip shows them. */
export const PANELS: readonly Panel[] = [
  'tree',
  'outline',
  'search',
  'tasks',
  'links',
  'footnotes',
  'properties',
  'ask',
  'agents',
]

/** The panels a window could be arranged with before a session said which it knew. */
const ARRANGED_BEFORE: readonly Panel[] = ['tree', 'outline', 'search', 'links', 'footnotes']

/** The right side a window opens with: the homes when nothing was written down, else
 *  what was written plus any homed there that the build which wrote it never knew. */
export function rightFrom(
  saved: readonly Panel[] | undefined,
  known: readonly Panel[] = ARRANGED_BEFORE,
): Panel[] {
  if (!saved) return [...STARTS_RIGHT]

  return [...saved, ...STARTS_RIGHT.filter((one) => !saved.includes(one) && !known.includes(one))]
}

/** How many of a side's tabs the strip draws: all where they fit at their narrowest
 *  (or nothing is laid out yet), else as many as fit beside a More segment, and at
 *  least the one showing. VS Code's activity bar keeps its overflow the same way. */
export function tabsShown(count: number, room: number, tab: number, gap = 2, inset = 6): number {
  if (room <= 0 || tab <= 0) return count

  const width = (n: number) => n * tab + Math.max(0, n - 1) * gap + inset
  if (width(count) <= room) return count

  let fit = count - 1
  while (fit > 1 && width(fit + 1) > room) fit -= 1
  return Math.max(1, fit)
}

/** The tabs drawn and the ones behind More, in the strip's order, except that the
 *  one showing always takes the last place drawn. */
export function splitTabs<T>(items: readonly T[], shown: number, isOn: (item: T) => boolean) {
  const drawn = items.slice(0, shown)
  const on = items.find(isOn)
  if (on !== undefined && !drawn.includes(on)) drawn[drawn.length - 1] = on

  return { drawn, behind: items.filter((item) => !drawn.includes(item)) }
}
