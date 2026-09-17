/** One row of a menu, wherever the menu is.
 *
 *  A row's own menu, the app menu, the palette: three lists of the same thing, and
 *  each had written down what one of its rows is. The three shapes had the same
 *  five fields between them - `danger` in one, `checked` in the other two - and the
 *  app menu already relied on their being the same, because it passes an export row
 *  out of the palette's registry straight through as a row of its own. A shape two
 *  lists share by coincidence is a shape that drifts; this is the one they share on
 *  purpose.
 *
 *  What a row *draws* is still each list's own, and deliberately: a shortcut is a
 *  `kbd` in the palette and a word in the app menu, the app menu keeps a tick slot
 *  in every row so its labels line up and a row's own menu keeps none, and the
 *  three walk their rows with different keys. This is the vocabulary, not the
 *  drawing.
 *
 *  No runes and no imports, so every one of them can read it. */

export interface MenuItem {
  label: string
  /** Undefined where nothing is bound to it. `shortcuts.hint` answers undefined
   *  for an unbound command, so undefined is a real value here. */
  hint?: string | undefined
  /** Whether this row is the one already in force: the theme in use, the accent it
   *  is drawn in. Drawn as a tick by the lists that keep room for one. */
  checked?: boolean
  /** Whether running it takes something away. Drawn in the danger colour by the
   *  lists that have rows which do. */
  danger?: boolean
  disabled?: boolean
  /** Whether the keyboard lands here when the menu opens, rather than on the first
   *  row.
   *
   *  For a list whose rows are one choice made over and over: the new-tab chooser
   *  opens on the kind that was chosen last, so a hand that makes canvases all
   *  afternoon presses the chord and Enter rather than the chord and an arrow. One
   *  row at most - the second is ignored - and none at all is the first row, which is
   *  what every other menu in the app is. See `lands` in trap.ts and last-kind.ts. */
  stands?: boolean
  /** Whether the menu stays open after this row is pressed.
   *
   *  For the handful of rows somebody presses twice in a row and would otherwise have
   *  to reopen the menu for: a browser's zoom is three of them, `-`, the size, and
   *  `+`, and every browser keeps its menu up while they are used. Everything else
   *  closes, which is what a menu does. */
  keep?: boolean
  // A property rather than a method, so a caller may hand the function on - which
  // is how an export row reaches the app menu.
  run: () => void
}

/** A rule between groups of rows. Nothing to land on, and nothing to draw but a
 *  line; every list that has groups steps over it. */
export const DIVIDER = null

/** A row, or the rule between groups. */
export type MenuEntry = MenuItem | typeof DIVIDER

/** A row that opens rows of its own: Export under File, whose list is a dozen
 *  formats and belongs behind one word rather than in front of it. */
export interface MenuSubmenu {
  label: string
  disabled?: boolean
  rows: MenuRow[]
}

/** A row of the app menu: one of its own rows, one that leads to more, or the rule
 *  between groups. */
export type MenuRow = MenuItem | MenuSubmenu | typeof DIVIDER

/** Whether a row leads to more rows. */
export function isSubmenu(row: MenuRow): row is MenuSubmenu {
  return row !== DIVIDER && 'rows' in row
}

/** Which of a list's rows a key may stand on, as places in the list.
 *
 *  A rule between groups is nothing to land on and neither is a row that is greyed
 *  out, so the arrows step over both. The shape of the list rather than anything
 *  about the screen, and here rather than with the rows themselves so that the menu
 *  can walk what it is showing without carrying what builds it; see AppMenu.svelte
 *  and app-menu.ts. */
export function walkableRows(rows: readonly MenuRow[]): number[] {
  const out: number[] = []
  for (const [index, row] of rows.entries()) {
    if (row !== DIVIDER && !row.disabled) out.push(index)
  }

  return out
}

/** One group of the app menu: File, Edit, View, and the rows under each. */
export interface MenuGroup {
  id: string
  label: string
  rows: MenuRow[]
}
