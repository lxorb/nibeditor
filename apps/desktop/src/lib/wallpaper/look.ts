/** What the wallpaper's dials make of its pictures, as the rule its sheet says.
 *
 *  Pure: the pictures, the dials and each side's colours come in, and the rule goes out,
 *  so the sheet a launch wears early and the one a dial previews are worked out by the
 *  one function, and the tests ask it the same questions.
 *
 *  Three floors for each side, each the least that keeps its words at its aim over every
 *  colour the picture can put under them (legibility.ts):
 *
 *  - **the chrome's**, the scrim under the frame's words, over the picture with its grain;
 *    aimed higher the sharper the picture, because words over a sharp photograph have
 *    its edges to read past as well as its colours;
 *  - **the paper's**, under a note, over what the chrome's scrim leaves (content-ground.ts);
 *  - **the terminal's**, the paper's with xterm.js's colours in it as well.
 *
 *  The Dim dial is a layer of the scrim's own colour on top, which only ever makes the
 *  chrome and the paper read better, so no floor depends on it. */

import {
  alphaFor,
  type ContentLevel,
  layered,
  type PaperInks,
  paperFloor,
  percent,
} from '../content-ground'
import { AA, hexOf, over, type Rgb, rgbOf, SHARP, type Span } from '../legibility'
import { floorFor, type Palette } from './floors'
import type { Held, Scheme } from './held'

export const FITS = ['fill', 'fit', 'tile', 'centre'] as const
export type Fit = (typeof FITS)[number]

/** The dials the rule depends on. */
export interface Dials {
  blur: number
  /** Per cent, as the dial says it. */
  dim: number
  grain: number
  fit: Fit
  empty: boolean
  content: ContentLevel
}

/** What one side is written in: the chrome's palette, the paper's inks, and the colours
 *  of the accent field it wears with no picture. */
export interface Colours {
  palette: Palette
  inks: PaperInks
  field: Span
}

/** How strong the grain is at the top of its dial: a sixth of a layer of noise, which
 *  is texture rather than a second picture. */
const GRAIN_MOST = 0.16

/** The blur at and above which a picture counts as soft: past it the chrome's aim is
 *  AA, and below it the aim rises to `SHARP` (legibility.ts) at none at all. */
const SOFT = 16

/** The chrome's aim for a picture blurred by `blur` pixels. */
export function aimFor(blur: number): number {
  return AA + (SHARP - AA) * Math.max(0, 1 - blur / SOFT)
}

/** The colours under the grain: noise from black to white laid over the picture at the
 *  grain's alpha, so each corner of the span moves as far as the noise can take it. */
export function grained(span: Span, grain: number): Span {
  const alpha = (Math.min(100, Math.max(0, grain)) / 100) * GRAIN_MOST
  if (alpha <= 0) return span
  return {
    least: over([0, 0, 0], alpha, span.least),
    most: over([255, 255, 255], alpha, span.most),
  }
}

/** Every colour, which is what a picture an older build made has to be taken to hold. */
const ANY: Span = { least: [0, 0, 0], most: [255, 255, 255] }

/** One side's floors, over a picture or over the accent field. */
export interface Floors {
  chrome: number
  paper: number
  terminal: number
  /** What the window comes to under the chrome's scrim, for the frame before any
   *  script. */
  ground: string
}

export function floorsOf(
  held: Held | null,
  scheme: Scheme,
  dials: Pick<Dials, 'blur' | 'grain'>,
  colours: Colours,
  fieldFloor: number,
): Floors {
  const { palette, inks } = colours
  const known = held?.span
  const span = grained(known ?? (held ? ANY : colours.field), dials.grain)
  const aim = held ? aimFor(dials.blur) : AA
  // A record from before the picture's colours were kept keeps the floor it was made
  // with, which held AA, until the store makes it again once the launch has painted;
  // its paper is worked out over every colour there is meanwhile.
  const chrome = held
    ? known
      ? floorFor(palette, span, aim)
      : (held[scheme]?.floor ?? floorFor(palette, span, aim))
    : Math.max(fieldFloor, floorFor(palette, span, aim))

  const under: Span = {
    least: over(palette.scrim, chrome, span.least),
    most: over(palette.scrim, chrome, span.most),
  }
  const mean = rgbOf(held?.mean ?? '') ?? middle(span)

  return {
    chrome,
    paper: paperFloor(inks, under),
    terminal: paperFloor(inks, under, true),
    ground: hexOf(over(palette.scrim, chrome, mean)),
  }
}

function middle(span: Span): Rgb {
  return [0, 1, 2].map((at) => ((span.least[at] ?? 0) + (span.most[at] ?? 0)) / 2) as unknown as Rgb
}

/** Where and how large the picture is laid, for a fit and a focal point. */
export function placement(
  held: Held | null,
  fit: Fit,
): { size: string; position: string; repeat: string } {
  const [x, y] = held?.focus ?? [0.5, 0.5]
  const at = `${percentOf(x)} ${percentOf(y)}`
  const size = held?.size

  if (fit === 'fit') return { size: 'contain', position: at, repeat: 'no-repeat' }
  if (fit === 'tile' && size) {
    return { size: `${size[0]}px ${size[1]}px`, position: '0 0', repeat: 'repeat' }
  }
  if (fit === 'centre' && size) {
    // The focal point in the middle of the window, at the picture's own size.
    const [width, height] = size
    return {
      size: `${width}px ${height}px`,
      position: `calc(50% - ${Math.round(x * width)}px) calc(50% - ${Math.round(y * height)}px)`,
      repeat: 'no-repeat',
    }
  }
  return { size: 'cover', position: at, repeat: 'no-repeat' }
}

function percentOf(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

/** Noise, as a picture the browser draws once per tile: grey from black to white at a
 *  fixed alpha, so the sums in `grained` are what lands on the screen. */
export function grainOf(grain: number): string {
  const alpha = (Math.min(100, Math.max(0, grain)) / 100) * GRAIN_MOST
  if (alpha <= 0) return 'none'
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='192' height='192'>" +
    "<filter id='n' color-interpolation-filters='sRGB'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix type='saturate' values='0'/>" +
    '<feComponentTransfer>' +
    "<feFuncR type='linear' slope='2.2' intercept='-.6'/>" +
    "<feFuncG type='linear' slope='2.2' intercept='-.6'/>" +
    "<feFuncB type='linear' slope='2.2' intercept='-.6'/>" +
    `<feFuncA type='linear' slope='0' intercept='${alpha.toFixed(3)}'/>` +
    '</feComponentTransfer></filter>' +
    "<rect width='100%' height='100%' filter='url(%23n)'/></svg>"
  return `url("data:image/svg+xml,${svg.replaceAll('<', '%3C').replaceAll('>', '%3E')}")`
}

/** The lines one side's picture says. */
function pictureLines(held: Held | null, fit: Fit): string[] {
  const place = placement(held, fit)
  return [
    ...(held ? [`--wallpaper-picture: url("${held.picture}");`] : []),
    ...(held?.mean ? [`--wallpaper-mean: ${held.mean};`] : []),
    `--wallpaper-size: ${place.size};`,
    `--wallpaper-position: ${place.position};`,
    `--wallpaper-repeat: ${place.repeat};`,
  ]
}

/** The pictures alone, with the floors an older build wrote beside them: what is said
 *  where the colours to work floors out from cannot be read at all - a sheet without
 *  its palette - rather than no picture. */
export function picturesRule(pictures: { light: Held | null; dark: Held | null }): string {
  const floors = (['dark', 'light'] as const).flatMap((scheme) => {
    const held = scheme === 'dark' ? (pictures.dark ?? pictures.light) : pictures.light
    const side = held?.[scheme]
    return side
      ? [
          `--wallpaper-floor-${scheme}: ${percent(side.floor)};`,
          `--wallpaper-ground-${scheme}: ${side.ground};`,
        ]
      : []
  })
  return block(':root', [...pictureLines(pictures.light, 'fill'), ...floors])
}

/** Lines of custom properties as one rule. */
function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((line) => `  ${line}\n`).join('')}}\n`
}

/** The pictures and their floors as a rule, said after the theme's own so the sheet's
 *  defaults give way to it; see wallpaper.css. */
export function wallpaperRule(
  pictures: { light: Held | null; dark: Held | null },
  dials: Dials,
  colours: Record<Scheme, Colours>,
  fieldFloors: Record<Scheme, number>,
): string {
  const root: string[] = [
    ...pictureLines(pictures.light, dials.fit),
    `--wallpaper-grain: ${grainOf(dials.grain)};`,
    `--nib-dim: ${dials.dim}%;`,
    `--empty-ground: ${dials.empty ? 'transparent' : 'var(--content-ground)'};`,
    // What stands on the pane's paper paints none of its own while that is see-through.
    ...(dials.content === 'opaque' ? [] : ['--content-inner: transparent;']),
  ]

  for (const scheme of ['dark', 'light'] as const) {
    const held = scheme === 'dark' ? (pictures.dark ?? pictures.light) : pictures.light
    const floors = floorsOf(held, scheme, dials, colours[scheme], fieldFloors[scheme])
    const paper = alphaFor(dials.content, floors.paper)
    const terminal = layered(alphaFor(dials.content, floors.terminal), paper)
    root.push(
      `--wallpaper-floor-${scheme}: ${percent(floors.chrome)};`,
      `--wallpaper-ground-${scheme}: ${floors.ground};`,
      `--wallpaper-paper-${scheme}: ${percent(paper)};`,
      `--wallpaper-terminal-${scheme}: ${percent(terminal)};`,
    )
  }

  const dark = pictures.dark
    ? block(":root[data-theme='dark']", pictureLines(pictures.dark, dials.fit))
    : ''
  return `${block(':root', root)}${dark}`
}
