/** What the bar remembers: the three pens, the eraser, the lasso, and where the
 *  bar itself sits.
 *
 *  A pen on a tablet is a thing you own rather than a setting you pick. Somebody
 *  who writes in a fine green biro, marks up in a fat yellow highlighter and
 *  sketches in a soft pencil wants those three in reach, set the way they set
 *  them, every time they open a plane. So a favourite is the whole pen - the kind
 *  of nib, how wide, how much of the colour lands and which colour - and turning
 *  a dial while it is out changes that pen rather than some width the whole app
 *  shares.
 *
 *  Of the device, like `hand.svelte.ts` and for the same reason: a tablet with a
 *  stylus and a phone with a thumb want different pens against different edges,
 *  and none of it is a preference anybody would go looking for in Settings. One
 *  key, read once when the module loads and written whenever something moves. */

import { keep, storedText } from '../stored'
import { clampOpacity, type InkTool, isInkTool } from './format'
import { INK_STYLES } from './ink'
import { DEFAULT_INK } from './palette'

/** One pen, set the way its owner set it. */
export interface Nib {
  tool: InkTool
  /** The nib's width in plane units. */
  size: number
  /** How much of the colour lands, 0 to 1. */
  opacity: number
  /** A preset name, a hex string, or `ink` for whatever the theme writes in. */
  colour: string
}

/** Which edge the bar is against. All four, because a wrist rests somewhere
 *  different on every device and in every grip: the two long edges are where a bar
 *  belongs on a phone, and the two short ones are what a tablet in landscape wants
 *  when the writing hand owns the bottom of the page. */
export const DOCKS = ['top', 'bottom', 'left', 'right'] as const
export type Dock = (typeof DOCKS)[number]

/** Whether the bar stands on its end, which is what the two sides mean. */
export function upright(dock: Dock): boolean {
  return dock === 'left' || dock === 'right'
}

/** Which edge a bar let go of at this point springs to: the nearest one, measured
 *  from the middle of the bar to each edge of the pane.
 *
 *  Nearest and not "whichever half of the screen", because a bar dragged into the
 *  middle of a tall pane is nearer the left edge than the top one and that is where
 *  a hand meant to put it. Pure, so where it lands is a test. */
export function nearestDock(at: { x: number; y: number }, width: number, height: number): Dock {
  const away: [Dock, number][] = [
    ['left', at.x],
    ['right', Math.max(0, width - at.x)],
    ['top', at.y],
    ['bottom', Math.max(0, height - at.y)],
  ]

  let best: Dock = 'bottom'
  let least = Infinity
  for (const [dock, gap] of away) {
    if (gap >= least) continue

    least = gap
    best = dock
  }

  return best
}

/** How many pens the bar holds. Three, always three: something to write with,
 *  something to sketch with, something to mark with.
 *
 *  A row that grows is a row that overflows, and then it needs adding, putting
 *  away, dragging into order and a gesture to scroll it, none of which is what
 *  anybody opened a canvas to do. Three slots that are always there and always
 *  full is the whole of it: each one is a pen you set the way you like it, and
 *  there is nothing to manage. */
export const PEN_SLOTS = 3

/** How many colours the row remembers. Six, so the recent ones are the same
 *  count as the presets above them and the two rows read as a pair. */
export const MOST_RECENT = 6

/** The widths a slider allows, in plane units: fine enough to write with, and fat
 *  enough to fill a heading with one stroke. Thirty rather than more, because it
 *  is also the widest line the pen popover can show whole; see nibs.test.ts. */
export const LEAST_WIDTH = 0.5
export const MOST_WIDTH = 30

/** How wide the eraser can be, in pixels on screen, since that is where a finger
 *  judges it. */
export const LEAST_RUB = 4
export const MOST_RUB = 64
/** And how wide it is when nobody has said. */
export const RUB = 10

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(MOST_WIDTH, Math.max(LEAST_WIDTH, Math.round(value * 10) / 10))
}

export function clampRub(value: number): number {
  if (!Number.isFinite(value)) return RUB
  return Math.min(MOST_RUB, Math.max(LEAST_RUB, Math.round(value)))
}

/** A pen of this kind, as it comes out of the box. */
export function nibFor(tool: InkTool, colour = DEFAULT_INK): Nib {
  const style = INK_STYLES[tool]
  return { tool, size: style.size, opacity: style.opacity, colour }
}

/** The three, as they come. */
function fresh(): Nib[] {
  return [nibFor('pen'), nibFor('pencil'), nibFor('highlighter')]
}

/** The row, however many pens the store held: the first three of them, filled
 *  out of the box where a device has fewer. A tablet that kept eight from before
 *  keeps the three it reaches for. */
function three(held: Nib[]): Nib[] {
  const row = fresh()
  return row.map((one, index) => held[index] ?? one)
}

interface Kept {
  pens: Nib[]
  at: number
  recent: string[]
  dock: Dock
  shut: boolean
  whole: boolean
  rub: number
  /** Whether a stroke held still is tidied into what it was aiming at. */
  straighten: boolean
  /** Whether the lasso is a box pulled out rather than a loop drawn by hand, and
   *  whether a stroke it only half caught counts as caught. */
  box: boolean
  partly: boolean
}

const KEY = 'nib:pens'

function blank(): Kept {
  return {
    pens: fresh(),
    at: 0,
    recent: [],
    dock: 'bottom',
    shut: false,
    whole: false,
    rub: RUB,
    straighten: true,
    box: false,
    partly: false,
  }
}

/** Anything with fields, which is as much as `JSON.parse` promises. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One entry of the stored list as a pen, or nothing at all. Flat-mapped, so a
 *  broken entry drops out of the row rather than taking the row with it. */
function oneNib(held: unknown): Nib[] {
  if (!isRecord(held) || !isInkTool(held.tool)) return []

  const style = INK_STYLES[held.tool]
  return [
    {
      tool: held.tool,
      size: typeof held.size === 'number' ? clampSize(held.size) : style.size,
      opacity: typeof held.opacity === 'number' ? clampOpacity(held.opacity) : style.opacity,
      colour: typeof held.colour === 'string' && held.colour ? held.colour : DEFAULT_INK,
    },
  ]
}

/** What the store holds, checked into a shape the rest of the file can trust.
 *  Anything the check does not recognise is replaced rather than repaired: a pen
 *  is three numbers and a name, and there is nothing to salvage in half of one. */
export function readPens(raw: string | null): Kept {
  if (raw === null) return blank()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Something else wrote this key, or an older Nib wrote a shape this one does
    // not know. Start again rather than guess.
    return blank()
  }

  if (!isRecord(parsed)) return blank()

  const held = parsed
  const pens = three(Array.isArray(held.pens) ? held.pens.flatMap(oneNib) : [])

  return {
    pens,
    at:
      typeof held.at === 'number' ? Math.min(Math.max(0, Math.trunc(held.at)), pens.length - 1) : 0,
    recent: Array.isArray(held.recent)
      ? held.recent.filter((one): one is string => typeof one === 'string').slice(0, MOST_RECENT)
      : [],
    dock: DOCKS.find((one) => one === held.dock) ?? 'bottom',
    shut: held.shut === true,
    whole: held.whole === true,
    rub: typeof held.rub === 'number' ? clampRub(held.rub) : RUB,
    straighten: held.straighten !== false,
    box: held.box === true,
    partly: held.partly === true,
  }
}

class Pens {
  /** The three, in the order the bar shows them. Always three; see PEN_SLOTS. */
  list = $state<Nib[]>([])
  /** Which of them is out. */
  at = $state(0)
  /** Colours used lately, newest first, whichever pen used them. */
  recent = $state<string[]>([])
  /** Which edge the bar is against. */
  dock = $state<Dock>('bottom')
  /** Whether the bar is folded away to its handle. */
  shut = $state(false)
  /** Whether the eraser takes a whole stroke rather than the part under it. */
  whole = $state(false)
  /** How wide the eraser is, in pixels on screen. */
  rub = $state(RUB)
  /** Whether a stroke held still is tidied into the line, ring or box it was
   *  aiming at. */
  straighten = $state(true)
  /** Whether the lasso is a box pulled out rather than a loop drawn by hand. */
  box = $state(false)
  /** Whether a stroke the lasso only half caught counts as caught. */
  partly = $state(false)

  constructor() {
    // A browser with site data turned off reads nothing, and the pens start
    // blank: they still work, they are only forgotten between sittings.
    this.restore(readPens(storedText(KEY)))
  }

  /** The pen that is out. Never nothing: the row is never empty. */
  get current(): Nib {
    return this.list[this.at] ?? nibFor('pen')
  }

  /** The eraser as the pointer machine wants it. */
  get eraser(): { whole: boolean; size: number } {
    return { whole: this.whole, size: this.rub }
  }

  /** A pen picked out of the row. */
  pick(index: number) {
    if (index < 0 || index >= this.list.length || index === this.at) return

    this.at = index
    this.keep()
  }

  /** The pen that is out, set some other way: a width, an alpha, a colour or a
   *  different nib altogether. The pen in the row is the pen in your hand, so a
   *  dial turned changes both. */
  set(changed: Partial<Nib>) {
    const one = this.list[this.at]
    if (!one) return

    const next: Nib = { ...one, ...changed }
    if (
      next.tool === one.tool &&
      next.size === one.size &&
      next.opacity === one.opacity &&
      next.colour === one.colour
    ) {
      return
    }

    this.list = this.list.map((pen, index) => (index === this.at ? next : pen))
    if (changed.colour !== undefined) this.remember(changed.colour)
    this.keep()
  }

  /** A colour used, kept for the row of recent ones. The presets are always on
   *  screen, so remembering those would only be the same six twice. */
  remember(colour: string) {
    if (!colour.startsWith('#')) return

    this.recent = [colour, ...this.recent.filter((one) => one !== colour)].slice(0, MOST_RECENT)
  }

  /** The bar folded to its handle, or unfolded. */
  fold(shut: boolean) {
    if (this.shut === shut) return

    this.shut = shut
    this.keep()
  }

  /** The bar moved to an edge. */
  dockTo(dock: Dock) {
    if (this.dock === dock) return

    this.dock = dock
    this.keep()
  }

  /** The eraser set: whole strokes or a hole, and how wide. */
  rubbing(changed: { whole?: boolean; rub?: number }) {
    if (changed.whole !== undefined) this.whole = changed.whole
    if (changed.rub !== undefined) this.rub = clampRub(changed.rub)
    this.keep()
  }

  /** The lasso set: a loop or a box, and whether a half caught stroke counts. */
  catching(changed: { box?: boolean; partly?: boolean }) {
    if (changed.box !== undefined) this.box = changed.box
    if (changed.partly !== undefined) this.partly = changed.partly
    this.keep()
  }

  /** Whether what is drawn is straightened, flicked. */
  straightening(on: boolean) {
    if (this.straighten === on) return

    this.straighten = on
    this.keep()
  }

  /** Everything back as it was, which is what the store said when the module
   *  loaded and what a test hands in instead. */
  restore(held: Kept) {
    this.list = held.pens
    this.at = held.at
    this.recent = held.recent
    this.dock = held.dock
    this.shut = held.shut
    this.whole = held.whole
    this.rub = held.rub
    this.straighten = held.straighten
    this.box = held.box
    this.partly = held.partly
  }

  private keep() {
    const held: Kept = {
      pens: this.list,
      at: this.at,
      recent: this.recent,
      dock: this.dock,
      shut: this.shut,
      whole: this.whole,
      rub: this.rub,
      straighten: this.straighten,
      box: this.box,
      partly: this.partly,
    }

    keep(KEY, JSON.stringify(held))
  }
}

export const pens = new Pens()
