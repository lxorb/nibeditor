/** The wallpaper as last written down: the small blurred picture and its two sides,
 *  read and checked. The picture goes into the theme's sheet (sheet.ts), so the sheet
 *  a launch wears early is already the picture; choosing and blurring are
 *  wallpaper.svelte.ts. */

import { isNumber, isRecord, isString, parsed, storedText } from '../stored'

/** The theme's id, which is also the drawer its two dials are kept in. */
export const WALLPAPER_THEME = 'wallpaper'
export const WALLPAPER_KEY = 'nib:wallpaper'

/** One side: the least scrim under which the chrome reads (floors.ts), and the colour
 *  the window comes to under it, for the frame before any script. */
export interface Side {
  floor: number
  ground: string
}

export interface Held {
  /** The blurred picture as a `data:` address. */
  picture: string
  /** The blur it was made at. */
  blur: number
  dark: Side
  light: Side
}

/** Only base64 raster: the address goes into a stylesheet. */
const PICTURE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const COLOUR = /^#[0-9a-f]{6}$/i

function sideOf(said: unknown): Side | null {
  if (!isRecord(said) || !isNumber(said.floor) || !isString(said.ground)) return null
  if (said.floor < 0 || said.floor > 1 || !COLOUR.test(said.ground)) return null
  return { floor: said.floor, ground: said.ground }
}

/** The entry as last read: a theme is applied on every scheme change and every card
 *  pointed at, and the picture is tens of kilobytes to parse. */
let read: { text: string | null; held: Held | null } | null = null

function heldIn(text: string | null): Held | null {
  const said = parsed(text)
  if (!isRecord(said) || !isString(said.picture) || !isNumber(said.blur)) return null
  if (!PICTURE.test(said.picture)) return null

  const dark = sideOf(said.dark)
  const light = sideOf(said.light)
  return dark && light ? { picture: said.picture, blur: said.blur, dark, light } : null
}

/** What was written down, or null for nothing or anything not quite this. */
export function heldWallpaper(): Held | null {
  const text = storedText(WALLPAPER_KEY)
  if (read?.text !== text) read = { text, held: heldIn(text) }
  return read.held
}

/** The picture and its two sides as a rule, said after the theme's own so the
 *  sheet's defaults give way to it; see wallpaper.css. */
export function pictureRule(held: Held): string {
  const lines = [
    `--wallpaper-picture: url("${held.picture}");`,
    ...(['dark', 'light'] as const).flatMap((side) => [
      `--wallpaper-floor-${side}: ${Math.round(held[side].floor * 100)}%;`,
      `--wallpaper-ground-${side}: ${held[side].ground};`,
    ]),
  ]
  return `:root {\n${lines.map((line) => `  ${line}\n`).join('')}}\n`
}
