/** The wallpaper as last written down: each side's small blurred picture and what it
 *  holds, read and checked. The pictures go into the theme's sheet (sheet.ts), so the
 *  sheet a launch wears early is already the pictures; choosing and blurring are
 *  wallpaper.svelte.ts.
 *
 *  One picture serves both sides until the dark side is given one of its own, the way
 *  a Mac's dynamic desktop has a light and a dark picture: `WALLPAPER_KEY` is the
 *  picture, and `DARK_KEY` the dark side's own where there is one. */

import type { Rgb, Span } from '../legibility'
import { isNumber, isRecord, isString, parsed, storedText } from '../stored'

/** The theme's id, which is also the drawer its dials are kept in. */
export const WALLPAPER_THEME = 'wallpaper'
export const WALLPAPER_KEY = 'nib:wallpaper'
export const DARK_KEY = 'nib:wallpaper-dark'

export type Scheme = 'dark' | 'light'

/** One side, as an older build wrote it: the scrim the chrome needed over the picture
 *  and the colour the window came to under it. Read for a picture made before the
 *  picture's own colours were kept, until it is made again. */
interface Side {
  floor: number
  ground: string
}

export interface Held {
  /** The blurred picture as a `data:` address. */
  picture: string
  /** The blur it was made at, and the tone - saturation and tint - baked into it. */
  blur: number
  tone?: string
  /** The colours in what the window shows (pixels.ts), so a floor can be worked out
   *  again for a grain or a side without touching a pixel. Absent in an older record. */
  span?: Span
  /** The picture's average colour, what a fitted picture is framed in. */
  mean?: string
  /** The picture's own size in CSS pixels, for Tile and Centre. */
  size?: [number, number]
  /** Its focal point, as two fractions: what Fill keeps in view as the window's shape
   *  changes, and where Centre and Fit put it. */
  focus: [number, number]
  /** Each side as an older build wrote it; a picture made now keeps its span instead. */
  dark?: Side
  light?: Side
}

/** Only base64 raster: the address goes into a stylesheet. */
const PICTURE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const COLOUR = /^#[0-9a-f]{6}$/i

function sideOf(said: unknown): Side | null {
  if (!isRecord(said) || !isNumber(said.floor) || !isString(said.ground)) return null
  if (said.floor < 0 || said.floor > 1 || !COLOUR.test(said.ground)) return null
  return { floor: said.floor, ground: said.ground }
}

function rgb(said: unknown): Rgb | null {
  if (!Array.isArray(said) || said.length !== 3) return null
  return said.every((one) => isNumber(one) && one >= 0 && one <= 255)
    ? (said as unknown as Rgb)
    : null
}

function spanOf(said: unknown): Span | undefined {
  if (!isRecord(said)) return undefined
  const least = rgb(said.least)
  const most = rgb(said.most)
  return least && most ? { least, most } : undefined
}

function pairOf(said: unknown, low: number, high: number): [number, number] | null {
  if (!Array.isArray(said) || said.length !== 2) return null
  const [x, y] = said as unknown[]
  if (!isNumber(x) || !isNumber(y)) return null
  return [Math.min(high, Math.max(low, x)), Math.min(high, Math.max(low, y))]
}

/** Each entry as last read: a theme is applied on every scheme change and every card
 *  pointed at, and a picture is tens of kilobytes to parse. */
const read = new Map<string, { text: string | null; held: Held | null }>()

function heldIn(text: string | null): Held | null {
  const said = parsed(text)
  if (!isRecord(said) || !isString(said.picture) || !isNumber(said.blur)) return null
  if (!PICTURE.test(said.picture)) return null

  const dark = sideOf(said.dark)
  const light = sideOf(said.light)
  const span = spanOf(said.span)
  if (!span && (!dark || !light)) return null

  const size = pairOf(said.size, 1, 1 << 15)
  return {
    picture: said.picture,
    blur: said.blur,
    ...(isString(said.tone) ? { tone: said.tone } : {}),
    ...(span ? { span } : {}),
    ...(isString(said.mean) && COLOUR.test(said.mean) ? { mean: said.mean } : {}),
    ...(size ? { size } : {}),
    focus: pairOf(said.focus, 0, 1) ?? [0.5, 0.5],
    ...(dark && light ? { dark, light } : {}),
  }
}

function heldAt(key: string): Held | null {
  const text = storedText(key)
  const last = read.get(key)
  if (last?.text === text) return last.held
  const held = heldIn(text)
  read.set(key, { text, held })
  return held
}

/** The picture, or null for nothing or anything not quite this. */
export function heldWallpaper(): Held | null {
  return heldAt(WALLPAPER_KEY)
}

/** The dark side's own picture, or null where it wears the other. */
export function heldDark(): Held | null {
  return heldAt(DARK_KEY)
}

/** What a side wears: its own picture, else the one picture. */
export function heldFor(scheme: Scheme): Held | null {
  return (scheme === 'dark' ? heldDark() : null) ?? heldWallpaper()
}
