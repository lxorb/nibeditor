/** What colour the glass frame is, and which ink is written on it, for what is open.
 *
 *  Two strengths, from the two kinds of browser that do this well:
 *
 *  - **A page's ground** is Safari's. The frame is the page's own colour over the
 *    window's material, and the web bar and the open tab are that colour solid, so the
 *    tab runs down through the bar into the page as one surface.
 *  - **A mark** - a note's icon colour or cover, a site's favicon while its page has said
 *    nothing, and otherwise the accent - is Chrome's and Arc's: a tone of the colour
 *    mixed into the scheme's own chrome, so a note's frame is calm whatever it wears.
 *
 *  And the ink is chosen the way `--accent-ink` is: the scheme whose words read on the
 *  ground, so a black page under the light scheme gets a dark frame with light words.
 *  Nothing is left to luck. A page's colour is moved toward the ink's opposite by the
 *  least scrim that makes the quietest word on it clear AA (most pages need none; a pure
 *  red needs some), and the frame's wash over the material is never under the floor that
 *  keeps every word on it at AA over every colour the material can be - the same sums
 *  wallpaper's scrim is held to; see legibility.ts.
 *
 *  Pure; see tint.test.ts. */

import { type PaperInks, paperFloor } from '../content-ground'
import {
  AA,
  hexOf,
  type Lift,
  over,
  type Rgb,
  rgbOf,
  scrimFloor,
  SHARP,
  type Span,
} from '../legibility'
import type { Palette } from '../wallpaper/floors'

export type Scheme = 'dark' | 'light'

/** What the platform put behind the window, as `data-translucent` says it - `clear` is
 *  the desk itself with no blur - and null for a window with nothing behind it, which
 *  stands on its own paper. */
export type Material = 'mica' | 'acrylic' | 'clear' | null

/** Glass's two sides: `--muted` as the ink, `--text`, `--glass-chrome` as the scrim and
 *  `--glass-layer`, read out of glass.css. */
export type Sides = Record<Scheme, Palette>

/** What is open, as a colour and how strongly the frame takes it. */
export interface Source {
  colour: Rgb
  page: boolean
}

/** What the frame wears: whose palette, its colour and how much of it lies over the
 *  material; and the floors under it - the least wash the words allow, which is where
 *  the Opacity dial's track turns grey, and the least paper a note and a terminal may be
 *  read on over it (content-ground.ts). */
export interface Frame {
  scheme: Scheme
  tint: string
  wash: number
  floor: number
  paper: number
  terminal: number
}

/** Glass's own dials, as fractions: how much of the frame's colour lies over the
 *  material, and how much of what is open is in that colour. */
export interface Dials {
  opacity: number
  strength: number
}

/** Where a reader starts: half the frame's colour over the material, and all of what is
 *  open in it. */
export const DIALS: Dials = { opacity: 0.5, strength: 1 }

/** What a page's bar and open tab stand on, and whose palette is written on it. */
export interface Bar {
  colour: string
  scheme: Scheme
}

/** How much of a page's colour lies over the paper of a window with no material: most
 *  of it, so the frame reads as the page's. Over a material the Opacity dial says. */
export const PAGE_WASH = 0.8

/** How much of a mark is mixed into the scheme's own chrome: a tone of it, not it -
 *  and less of it for a mark loud enough that the reader's words would not read on the
 *  tone, down to none, which is glass's own chrome. */
export const MARK_TONE = 0.22
const TONES = [MARK_TONE, 0.16, 0.11, 0.06, 0]

/** Every colour the material can be, per channel: Mica's flat colours (#202020 and
 *  #0a0a0a dark, #f3f3f3 and #dadada light) and twenty-six levels either way for the
 *  colour a wallpaper lends it, as test/e2e/glass.py measures it; Acrylic is the desk
 *  itself and so anything at all. */
export function spanUnder(material: Material, scheme: Scheme, paper: Rgb): Span {
  if (material === 'acrylic' || material === 'clear') {
    return { least: [0, 0, 0], most: [255, 255, 255] }
  }
  if (material === 'mica') {
    return scheme === 'dark'
      ? { least: [0, 0, 0], most: [58, 58, 58] }
      : { least: [192, 192, 192], most: [255, 255, 255] }
  }
  return { least: paper, most: paper }
}

/** A row under the pointer and a tab under it are lifts of the ink: 8% and 10%, the
 *  stronger of which is what has to read. */
const HOVER = 0.1

/** Every stack a word on the frame stands on, above the tint. */
function stacks(side: Palette): Lift[][] {
  const hover = { colour: side.text, alpha: HOVER }
  return [[], [hover], [side.layer], [side.layer, hover]]
}

function other(scheme: Scheme): Scheme {
  return scheme === 'dark' ? 'light' : 'dark'
}

/** What the sums aim for: AA and a hair, so the colour written as `#rrggbb` and the
 *  wash as a whole percent - and the screen's own eight bits a channel when it lays one
 *  over the other - never round a word that clears AA here to one just under it. */
const AIM = AA + 0.1

/** The least scrim under which one side's words read over a span, on every stack. */
function floorOf(side: Palette, scrim: Rgb, span: Span, aim = AIM): number {
  return Math.max(...stacks(side).map((lifts) => scrimFloor(side.ink, scrim, span, lifts, aim)))
}

/** What a page's bar stands on: its own colour where the words of one side read on it,
 *  else moved the least way toward one side's chrome until they do. The side that needs
 *  the least is chosen, the reader's own scheme where both need as little. */
export function barFor(page: Rgb, app: Scheme, sides: Sides): Bar {
  const one = { least: page, most: page }
  const options = [app, other(app)].map((scheme) => {
    const side = sides[scheme]
    const alpha = floorOf(side, side.scrim, one)
    return { scheme, colour: hexOf(over(side.scrim, alpha, page)), alpha }
  })
  const [mine, theirs] = options as [(typeof options)[0], (typeof options)[0]]
  const chosen = theirs.alpha < mine.alpha ? theirs : mine
  return { colour: chosen.colour, scheme: chosen.scheme }
}

/** Whether one side's words read on a colour laid solid. */
function carries(side: Palette, colour: Rgb): boolean {
  return floorOf(side, colour, { least: colour, most: colour }) === 0
}

/** What the frame wears for what is open, over the window's material or its paper.
 *
 *  `strength` is how much of what is open is in the frame's colour - a page's colour
 *  mixed toward the chrome of the scheme its words are in, a mark's tone made fainter -
 *  and `opacity` how much of that colour lies over the material, never under the floor
 *  that keeps the words reading. Over the desk unblurred the words aim higher. `inks` is
 *  the paper's, in the reader's own scheme, for the floors a note is read on. */
export function frameFor(
  source: Source,
  app: Scheme,
  material: Material,
  sides: Sides,
  paper: Rgb,
  dials: Dials = DIALS,
  inks: PaperInks | null = null,
): Frame {
  const span = spanUnder(material, app, paper)
  // Over the desk itself unblurred the words aim higher; see `SHARP`.
  const aim = material === 'clear' ? SHARP + (AIM - AA) : AIM
  const strength = Math.min(1, Math.max(0, dials.strength))

  let scheme: Scheme
  let tint: Rgb
  let stated: number
  if (source.page) {
    const bar = barFor(source.colour, app, sides)
    scheme = bar.scheme
    const solid = rgbOf(bar.colour) ?? source.colour
    tint = rgbOf(hexOf(over(solid, strength, sides[scheme].scrim))) ?? solid
    stated = material ? dials.opacity : PAGE_WASH
  } else {
    // A tone of the mark in the reader's own chrome, and always their own words on it: a
    // note's frame never turns the other scheme for the colour of an icon.
    scheme = app
    const own = sides[app]
    const tone = TONES.map((amount) =>
      rgbOf(hexOf(over(source.colour, amount * strength, own.scrim))),
    )
    tint = tone.find((one): one is Rgb => one !== null && carries(own, one)) ?? own.scrim
    stated = material ? dials.opacity : 1
  }

  // A colour the words read on at AA, solid, may still be short of a higher aim: it is
  // taken toward the side's own chrome the least way that reaches it.
  const side = sides[scheme]
  const lift = floorOf(side, side.scrim, { least: tint, most: tint }, aim)
  if (lift > 0) tint = rgbOf(hexOf(over(side.scrim, lift, tint))) ?? tint

  const floor = floorOf(side, tint, span, aim)
  const wash = Math.max(Math.min(1, stated), floor)
  const under: Span = { least: over(tint, wash, span.least), most: over(tint, wash, span.most) }
  return {
    scheme,
    tint: hexOf(tint),
    wash,
    floor,
    paper: inks ? paperFloor(inks, under) : 1,
    terminal: inks ? paperFloor(inks, under, true) : 1,
  }
}
