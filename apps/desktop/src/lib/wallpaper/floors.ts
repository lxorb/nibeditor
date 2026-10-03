/** How much scrim the chrome needs over one picture, for one side of the theme.
 *
 *  The chrome's words stand on a stack: the picture, the scrim, and then whatever the
 *  row adds - the list's own layer, a row under the pointer. The floor is the least
 *  scrim under which the quietest ink clears AA on each of those stacks over every
 *  colour in the picture, which is the promise wallpaper.css makes: the Dim dial only
 *  ever adds to it. The open note's row is a pill on the scrim's own colour rather than
 *  over the picture, so it answers for itself; see floors.test.ts.
 *
 *  Pure; the colours come in, so the page and the tests answer the same question.
 *  See floors.test.ts. */

import { type Lift, over, type Rgb, rgbOf, scrimFloor, type Span } from '../legibility'

/** One side of the theme, as the colours the floor depends on. */
export interface Palette {
  /** The quietest word the chrome writes: `--muted`. */
  ink: Rgb
  /** `--wallpaper-scrim`. */
  scrim: Rgb
  /** The list's own layer, `--wallpaper-layer`, as a colour and its alpha. */
  layer: Lift
  /** The ink a row under the pointer is a lift of, `--text`. */
  text: Rgb
}

/** A row under the pointer: `--text` at 8% and the scrim at 40%, the `color-mix` in
 *  wallpaper.css, which is a layer at their sum of the two mixed in that proportion. */
const INK = 0.08
const SCRIM = 0.4

/** Every stack a word on the chrome stands on, above the scrim. */
function stacks(palette: Palette): Lift[][] {
  const hover = {
    colour: over(palette.text, INK / (INK + SCRIM), palette.scrim),
    alpha: INK + SCRIM,
  }
  return [[], [hover], [palette.layer], [palette.layer, hover]]
}

/** The block a sheet states one side in: `[data-theme='light']`, or the dark one,
 *  which wallpaper.css states together with `:root`. */
function blockOf(css: string, scheme: 'dark' | 'light'): string {
  const head = new RegExp(String.raw`\[data-theme=['"]?${scheme}['"]?\]\s*\{`).exec(css)
  if (!head) return ''
  const from = head.index + head[0].length
  return css.slice(from, css.indexOf('}', from))
}

function tokenIn(block: string, name: string): string {
  return new RegExp(String.raw`${name}\s*:\s*([^;]+);`).exec(block)?.[1]?.trim() ?? ''
}

/** Which of a sheet's tokens are the scrim and the layer: wallpaper's own, or glass's,
 *  whose chrome colour is the scrim its tint is laid over the material as. */
export interface Names {
  scrim: string
  layer: string
}

const WALLPAPER: Names = { scrim: '--wallpaper-scrim', layer: '--wallpaper-layer' }

/** One side's palette read out of the theme's own sheet, so the sheet is the one
 *  place its colours are written. Null where the sheet does not say one of them. */
export function paletteOf(
  css: string,
  scheme: 'dark' | 'light',
  names: Names = WALLPAPER,
): Palette | null {
  const block = blockOf(css, scheme)
  const ink = rgbOf(tokenIn(block, '--muted'))
  const text = rgbOf(tokenIn(block, '--text'))
  const scrim = rgbOf(tokenIn(block, names.scrim))
  const layerSaid = tokenIn(block, names.layer)
  const layer = rgbOf(layerSaid)
  const alpha = Number(/\/\s*([\d.]+)\s*\)$/.exec(layerSaid)?.[1] ?? 1)
  if (!ink || !text || !scrim || !layer || !Number.isFinite(alpha)) return null

  return { ink, text, scrim, layer: { colour: layer, alpha } }
}

/** The floor for one side over a picture whose colours lie in `span`. */
export function floorFor(palette: Palette, span: Span): number {
  return Math.max(
    ...stacks(palette).map((lifts) => scrimFloor(palette.ink, palette.scrim, span, lifts)),
  )
}
