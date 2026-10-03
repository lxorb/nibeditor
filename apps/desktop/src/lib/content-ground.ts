/** How much of the paper a translucent theme leaves under what somebody reads.
 *
 *  Glass and wallpaper put something behind the frame - the platform's material, a
 *  picture - and the Content setting says how far it reaches the surfaces a note, a
 *  terminal or a canvas is read on: Opaque, the paper as it always was; Clear, the least
 *  paper under which every word still reads; Tinted, halfway between the two. The paper
 *  is the page's own `--bg`, laid over whatever is under it at an alpha, so the words
 *  keep the palette they were measured on and only the ground goes thin.
 *
 *  The floor is stricter than the frame's: body text is read for hours, so `--text` is
 *  held to seven to one (WCAG's AAA) rather than four and a half, and the quiet grey and
 *  a link to AA. A terminal adds one more ink, the darkest (or, on the light side, the
 *  lightest) colour xterm.js may write once it has pulled a program's colours to
 *  `TERMINAL_CONTRAST` against the paper: every colour it writes reads at AA on the
 *  ground under it, whichever of the sixteen a program asked for.
 *
 *  Pure; the colours come in. See content-ground.test.ts. */

import { AA, luminance, over, type Rgb, scrimFloor, type Span } from './legibility'

export const CONTENT_LEVELS = ['opaque', 'tinted', 'clear'] as const
export type ContentLevel = (typeof CONTENT_LEVELS)[number]

/** Where a reader starts: the material and the picture reach the note, a little. */
export const CONTENT_INITIAL: ContentLevel = 'tinted'

/** What words on the paper are written in, for one side of a theme. */
export interface PaperInks {
  /** `--bg`, the paper itself. */
  bg: Rgb
  text: Rgb
  muted: Rgb
  /** A link, `--content-link`: the accent with a third of the strongest ink in it, so
   *  a link is not what keeps the paper opaque. */
  link: Rgb
}

/** Body text's aim: AAA, for prose read at length. */
export const BODY = 7

/** What the terminal asks xterm.js for while its ground is see-through: a step past AA
 *  against the paper itself, which leaves the room the ground's own drift may take. */
export const TERMINAL_CONTRAST = 5.5

/** A hair over each aim, so a colour written as a whole hundredth never rounds a word
 *  that clears it here to one just under it on the screen. */
const HAIR = 0.1

/** The link colour, as `--content-link` mixes it in the sheets. */
export function linkOf(accent: Rgb, strong: Rgb): Rgb {
  return over(accent, 0.7, strong)
}

/** A grey exactly as light as `luminance`. */
function greyAt(target: number): Rgb {
  let low = 0
  let high = 255
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2
    if (luminance([middle, middle, middle]) < target) low = middle
    else high = middle
  }
  const level = (low + high) / 2
  return [level, level, level]
}

/** The colour xterm.js comes closest to the paper with at `TERMINAL_CONTRAST`: on a
 *  dark paper the darkest ink it may write, on a light one the lightest. */
function terminalInk(bg: Rgb): Rgb {
  const paper = luminance(bg)
  const dark = paper < 0.5
  const target = dark
    ? (paper + 0.05) * TERMINAL_CONTRAST - 0.05
    : (paper + 0.05) / TERMINAL_CONTRAST - 0.05
  return greyAt(Math.min(1, Math.max(0, target)))
}

/** The least paper, from 0 to 1, under which every word on it reads over every colour
 *  in `span`. */
export function paperFloor(inks: PaperInks, span: Span, terminal = false): number {
  const aims: [Rgb, number][] = [
    [inks.text, BODY],
    [inks.muted, AA],
    [inks.link, AA],
    ...(terminal ? [[terminalInk(inks.bg), AA] as [Rgb, number]] : []),
  ]
  return Math.max(...aims.map(([ink, aim]) => scrimFloor(ink, inks.bg, span, [], aim + HAIR)))
}

/** How much paper a level lays down over a floor: all of it, the floor, or halfway. */
export function alphaFor(level: ContentLevel, floor: number): number {
  if (level === 'opaque') return 1
  if (level === 'clear') return floor
  return Math.ceil(((1 + floor) / 2) * 100) / 100
}

/** What a layer laid over the paper has to be for the two together to come to `total`:
 *  the terminal stands on the pane's paper, and is the rest of the way to its own floor
 *  rather than a second paper as thick as the first. */
export function layered(total: number, under: number): number {
  if (under >= 1) return 1
  return Math.ceil((Math.max(0, total - under) / (1 - under)) * 100) / 100
}

/** As a stylesheet writes it. */
export function percent(alpha: number): string {
  return `${Math.round(alpha * 100)}%`
}
