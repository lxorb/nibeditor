/** Which colour something open stands on, out of what it says and what it shows.
 *
 *  Three sources, in the order Safari reads a page: the colour the page names for its
 *  browser, the colour along its top edge, and - where the top is a picture - the still
 *  of the page the window already took as it landed. And for a page that has said
 *  nothing yet, or a note, the colour of its mark: the dominant colour of a favicon or a
 *  cover, the way Vivaldi takes its accent from a site.
 *
 *  Pure: colours and pixels come in, so the page reader, the drive and the tests ask the
 *  same question. See colours.test.ts. */

import { type Rgb, rgbOf } from '../legibility'

/** What a page says about itself, as web_tint.rs reads it (and reading.ts in a browser). */
export interface PageSaid {
  /** `<meta name="theme-color">`, the one whose `media` matches, or empty. */
  theme: string
  /** The colour at three points along the top edge; empty where it is a picture. */
  top: string[]
  /** Whether a picture is what the top edge shows somewhere. */
  pictured: boolean
}

/** How opaque a colour must be to be a ground. A page that names a see-through colour
 *  for its bar is asking for a bar that shows what is behind it, which the frame cannot
 *  be over a page that is drawn by another process; it is read as saying nothing. */
const SOLID = 0.9

/** How far apart two readings may be, per channel, and still be one colour: an
 *  antialiased border or a shade of difference a reader cannot see. */
const SAME = 12

/** The colour a stylesheet or a canvas wrote, if it is solid enough to stand on. */
export function solid(said: string): Rgb | null {
  const text = said.trim().toLowerCase()
  const colour = rgbOf(text)
  if (!colour) return null

  const alpha = /^rgba?\([^)]*[,/]\s*([\d.]+%?)\s*\)$/.exec(text)?.[1]
  if (alpha === undefined) return colour
  const value = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
  return Number.isFinite(value) && value >= SOLID ? colour : null
}

function near(one: Rgb, two: Rgb): boolean {
  return one.every((channel, at) => Math.abs(channel - (two[at] ?? 0)) <= SAME)
}

/** The colour most of the readings agree on - two of three is enough, the middle one
 *  first - or null where they disagree. */
export function agreed(readings: readonly (Rgb | null)[]): Rgb | null {
  const found = readings.filter((one): one is Rgb => one !== null)
  const middle = readings[Math.floor(readings.length / 2)] ?? null
  const ordered = middle ? [middle, ...found] : found
  for (const one of ordered) {
    if (found.filter((other) => near(one, other)).length * 2 > readings.length) return one
  }
  return null
}

/** What a page's own words say it stands on, or null where only its picture can say.
 *  The theme colour first; the top edge where every point is a colour and most agree. */
export function groundSaid(said: PageSaid): Rgb | null {
  const named = solid(said.theme)
  if (named) return named
  if (said.pictured) return null
  return agreed(said.top.map(solid))
}

/** Pixels as a canvas hands them over: four bytes a pixel, red first. */
export type Pixels = ArrayLike<number>

/** Each channel's top four bits: sixteen levels, so a gradient's neighbours and a
 *  JPEG's noise fall in one bucket. */
function bucketOf(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
}

interface Tally {
  weight: number
  r: number
  g: number
  b: number
  count: number
}

/** Counts pixels into buckets, each weighed by `weigh`, and answers the heaviest
 *  bucket's average colour with its share of every pixel counted. */
function heaviest(
  pixels: Pixels,
  weigh: (r: number, g: number, b: number) => number,
): { colour: Rgb; share: number } | null {
  const tallies = new Map<number, Tally>()
  let counted = 0

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    // A pixel mostly see-through is the shape's edge or the space round it.
    if ((pixels[at + 3] ?? 0) < 128) continue
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    const weight = weigh(r, g, b)
    counted++
    if (weight <= 0) continue

    const key = bucketOf(r, g, b)
    const tally = tallies.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, count: 0 }
    tally.weight += weight
    tally.r += r
    tally.g += g
    tally.b += b
    tally.count++
    tallies.set(key, tally)
  }

  let best: Tally | null = null
  for (const tally of tallies.values()) if (!best || tally.weight > best.weight) best = tally
  if (!best || counted === 0) return null

  return {
    colour: [best.r / best.count, best.g / best.count, best.b / best.count].map(Math.round) as [
      number,
      number,
      number,
    ],
    share: best.count / counted,
  }
}

/** How colourful a pixel is: the spread of its channels, 0 for a grey. */
function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/** The colour a mark is - a favicon, a cover - as a person would name it: the most
 *  common colourful one, weighed by how colourful, so a red logo on white is red and
 *  not white. A mark with no colour in it at all is its most common grey. */
export function dominant(pixels: Pixels): Rgb | null {
  const coloured = heaviest(pixels, (r, g, b) => {
    const spread = chroma(r, g, b)
    return spread < 32 ? 0 : spread
  })
  return coloured?.colour ?? heaviest(pixels, () => 1)?.colour ?? null
}

/** How much of a strip one colour has to be for the strip to be that colour. */
const MOSTLY = 0.6

/** The colour a strip of a page's picture is, read off its top rows: one colour across
 *  most of it, or null for a picture busy enough that no colour is its ground. */
export function stripGround(pixels: Pixels): Rgb | null {
  const most = heaviest(pixels, () => 1)
  return most && most.share >= MOSTLY ? most.colour : null
}
