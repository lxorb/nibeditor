/** Where a long list's window is, read off the box the list scrolls in.
 *
 *  row-window.ts is the arithmetic - which rows to mount for a given scroll, as
 *  plain numbers that can be read as a table. This is the half that needs a
 *  browser: finding the box, measuring how far down it has got and how much of the
 *  list it can show, and asking again when any of that moves.
 *
 *  One copy, because there are two such lists and they want the same three numbers.
 *  The file list has had this since a space of three thousand notes was three
 *  thousand buttons; the Links panel had none, so a note a thousand others point at
 *  was a thousand rows built and laid out for the eighteen a panel can show - two
 *  hundred and fifteen milliseconds of a button press. The difference between the
 *  two is a row's height and nothing else, so that is what comes in.
 *
 *  Deliberately not a Svelte action: an action cannot hand its caller reactive
 *  state, and the three numbers are exactly what the caller has to compute its
 *  window from. Held from an `$effect` instead, which is also where its teardown
 *  belongs. */

import { scrollerOf } from './row-window'

/** How tall a row is where the browser answers nothing at all: the two scales the
 *  themes package states, as a floor rather than a second statement of them. */
const LEAST_ROW = 28
const LEAST_TOUCH = 56

/** The floor on its own, for the frame before a list has a box to measure against.
 *  It keeps the arithmetic off nought, where every row would be at the same place
 *  and the window would hold all of them. */
export function tokenFloor(touch: boolean): number {
  return touch ? LEAST_TOUCH : LEAST_ROW
}

/** How tall one row is, off the `--row-height` token.
 *
 *  What the file list uses, and what most lists are: `--row-height` is 28 under a
 *  pointer and 56 under a thumb, stated once in the themes package, and a label is
 *  one line that gives way with an ellipsis - so every row is exactly this tall and
 *  none of them is ever measured.
 *
 *  Which kind of screen this is comes in rather than being read here, so whoever
 *  asks asks again when a finger replaces a pointer - which changes the row scale
 *  without resizing anything an observer is watching. */
export function tokenRow(touch: boolean): number {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--row-height')
  const px = Number.parseFloat(said)

  return Number.isFinite(px) && px > 0 ? px : touch ? LEAST_TOUCH : LEAST_ROW
}

/** How tall one row is, off a row.
 *
 *  For a list whose rows are not the one-line kind the token describes: a hit in
 *  the Links panel is a note's name over the line the link is written on, two lines
 *  and the padding round them, and there is no token that says so. Measured rather
 *  than stated because what it comes to depends on the type size and the line
 *  height a reader has chosen, and both of those are settings.
 *
 *  One row, once, and again when the box is resized - not one per row. Every row in
 *  such a list is the same height as every other, which is the property the whole
 *  window arithmetic rests on; a list whose rows differ needs a different mechanism
 *  than this one, not a taller number.
 *
 *  `least` is what to answer before there is a row to measure, which is the first
 *  frame of every such list. */
export function measuredRow(list: HTMLElement, least: number): number {
  const first = list.firstElementChild
  if (!(first instanceof HTMLElement)) return least

  const tall = first.getBoundingClientRect().height
  return tall > 0 ? tall : least
}

/** The three numbers a window is worked out from, kept up to date. */
export class ListView {
  /** How far down the list the scroller has reached, in pixels. Negative while
   *  something above the list is still on screen. */
  top = $state(0)
  /** How much of the list the scroller can show. */
  room = $state(0)
  /** How tall one row is. */
  row = $state(0)
  /** The box the list scrolls in, for a caller with listeners of its own to add.
   *
   *  Not state, and that is load-bearing: nothing is derived from which box this is,
   *  and the caller reads it in the same effect that `follow` writes it in. As state
   *  that is an effect which invalidates itself, which Svelte stops as
   *  `effect_update_depth_exceeded` - the whole panel then draws nothing at all. */
  box: HTMLElement | null = null

  /** What `follow` was given, so `refresh` can ask again. */
  #list: HTMLElement | null = null
  #rowOf: ((list: HTMLElement) => number) | null = null

  /** Reads the two edges again, and the row height with them.
   *
   *  `row` is for the one thing no observer on the box can see: the row scale
   *  following the device class, which changes when a mouse is plugged into a tablet
   *  and resizes nothing at all. Given, it is used; left out, the height is read the
   *  way `follow` reads it. */
  refresh(row?: number): void {
    const list = this.#list
    const rowOf = this.#rowOf
    const box = this.box
    if (!list || !rowOf || !box) return

    this.row = row ?? rowOf(list)
    this.top = box.getBoundingClientRect().top - list.getBoundingClientRect().top
    this.room = box.clientHeight
  }

  /** Follows the box `list` scrolls in.
   *
   *  Called from an `$effect` and its answer returned from it, which is where the
   *  listeners come off again. `rowOf` says how tall a row is - the token for a list
   *  of the ordinary kind, a measurement for one whose rows are taller - and is
   *  asked again whenever the box changes size, since that is when the type size or
   *  the row scale can have moved under it. `onScroll` is for a caller that
   *  remembers where its list was left. */
  follow(
    list: HTMLElement,
    rowOf: (list: HTMLElement) => number,
    onScroll?: (box: HTMLElement) => void,
  ): (() => void) | undefined {
    const box = scrollerOf(list)
    this.box = box
    this.#list = list
    this.#rowOf = rowOf
    if (!box) return undefined

    // Two boxes read rather than a scroll offset, so whatever stands above the list
    // - the bookmarks, a section heading, another list - is accounted for without
    // this having to know it is there.
    const measure = () => {
      this.top = box.getBoundingClientRect().top - list.getBoundingClientRect().top
      this.room = box.clientHeight
    }

    this.row = rowOf(list)
    measure()

    const scrolled = () => {
      measure()
      onScroll?.(box)
    }

    // One observer, on the scroller: a window resized, a drawer opened, the
    // keyboard taking half a phone's screen, or a finger changing the row scale all
    // arrive here.
    const watch = new ResizeObserver(() => {
      this.row = rowOf(list)
      measure()
    })
    watch.observe(box)
    box.addEventListener('scroll', scrolled, { passive: true })

    return () => {
      watch.disconnect()
      box.removeEventListener('scroll', scrolled)
      this.#list = null
      this.#rowOf = null
      this.box = null
    }
  }
}
