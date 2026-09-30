/** The theme picker: what it keeps, what it is pointing at, and the one door in.
 *
 *  Pointing is trying. A theme, a scheme or an accent under the pointer or the
 *  arrows is put on the whole app at once, and nothing is written down while it is
 *  - so leaving without choosing, whichever way, is showing again what was kept,
 *  and a window closed halfway through opens on what was kept as well. A click is
 *  the one thing that keeps, through the same calls Settings makes, so the choice
 *  is written down and applied exactly as it would have been there.
 *
 *  The three parts are pointed at apart, because they are chosen apart: a card
 *  is the theme, the three marks at the top are the scheme, the dots at the foot
 *  are the accent. Moving off one part gives back that part and leaves the others.
 *
 *  Nothing here is in front of the first paint: the switch in the panel's foot and
 *  the palette's row both fetch this module when they are pressed, and it mounts
 *  the picker the first time it is asked for. See SidebarFoot.svelte. */

import { mount } from 'svelte'
import { type SchemeChoice, theme } from '../theme.svelte'
import ThemePicker from './ThemePicker.svelte'

/** A whole look, as the three choices it is made of. */
interface Look {
  id: string
  scheme: SchemeChoice
  accent: string
}

type Part = keyof Look

/** Each part as pointed at. Null is the part as it was kept. */
type Pointed = { [P in Part]: Look[P] | null }

/** Where it was asked for: the control a right click landed on, or the point a
 *  held finger did, which is a box with no size. */
interface Anchor {
  x: number
  top: number
  bottom: number
}

const NOTHING: Pointed = { id: null, scheme: null, accent: null }

class Picking {
  open = $state(false)
  /** Null for where the palette stands, which is where it opens from a command. */
  at = $state<Anchor | null>(null)
  /** What the field under the top of it holds. */
  query = $state('')
  /** The look the app had when it opened, and whatever a click has kept since. */
  kept = $state<Look>({ id: '', scheme: 'system', accent: '' })
  /** What is being pointed at, part by part. */
  pointed = $state<Pointed>({ ...NOTHING })

  show(at: Anchor | null) {
    if (this.open) return

    this.kept = { id: theme.id, scheme: theme.scheme, accent: theme.accent }
    this.pointed = { ...NOTHING }
    this.query = ''
    this.at = at
    this.open = true
  }

  /** Puts one part of a look on the app without keeping it, or gives that part
   *  back with null. Nothing is painted when nothing changes, which is most
   *  pointer movements across the cards. */
  point<P extends Part>(part: P, value: Look[P] | null) {
    if (!this.open || this.pointed[part] === value) return

    this.pointed[part] = value
    this.paint()
  }

  /** Keeps a theme, as choosing it in Settings does. */
  keepTheme(id: string) {
    this.kept.id = id
    this.pointed.id = null
    this.paint()
    theme.select(id)
  }

  keepScheme(choice: SchemeChoice) {
    if (!theme.offers(choice)) return

    this.kept.scheme = choice
    this.pointed.scheme = null
    this.paint()
    theme.setScheme(choice)
  }

  keepAccent(id: string) {
    this.kept.accent = id
    this.pointed.accent = null
    this.paint()
    theme.setAccent(id)
  }

  /** Closed, with the kept look back on the app: Escape, a press outside, Back,
   *  or a click that kept something and so has nothing left to give back. */
  close() {
    if (!this.open) return

    const pointing = Object.values(this.pointed).some((one) => one !== null)
    this.pointed = { ...NOTHING }
    if (pointing) this.paint()
    this.open = false
  }

  /** What the app wears: each part as pointed at, or as kept. */
  private paint() {
    const { id, scheme, accent } = this.pointed
    theme.preview(id ?? this.kept.id, scheme ?? this.kept.scheme, accent ?? this.kept.accent)
  }
}

export const picking = new Picking()

let mounted = false

/** Where a press asks for the picker to stand: beside the control it landed on, so
 *  the picker does not cover the switch it came from, or at the point a finger held
 *  still on. Null for a press with no point, which is a menu key's: the corner of the
 *  window is what it says. */
function anchorOf(press: MouseEvent): Anchor | null {
  const on = press.target instanceof Element ? press.target.closest('button') : null
  if (on) {
    const box = on.getBoundingClientRect()
    return { x: press.clientX || box.left + box.width / 2, top: box.top, bottom: box.bottom }
  }

  if (!press.clientX && !press.clientY) return null
  return { x: press.clientX, top: press.clientY, bottom: press.clientY }
}

/** Opens the picker: beside what was pressed, or where the palette stands when
 *  nothing was - a command. Mounted into the page the first time, and kept, so its
 *  way out can play. */
export function pickTheme(from?: MouseEvent): void {
  if (!mounted) {
    mount(ThemePicker, { target: document.body })
    mounted = true
  }

  picking.show(from ? anchorOf(from) : null)
}
