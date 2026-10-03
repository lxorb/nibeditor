/** Whether words can be read on a colour, and what to do when they cannot.
 *
 *  WCAG's sums, once: how light a colour is, how far apart two are, and what a layer
 *  of one over another comes to. Then the two questions a surface that stands on
 *  something the app did not choose has to answer - a picture somebody picked, a page
 *  somebody opened. Which ink reads on it, the way `--accent-ink` is the ink that reads
 *  on every accent; and how much of a scrim has to go between it and the words so that
 *  the quietest of them still reads, whatever is underneath.
 *
 *  Pure, and in sRGB the way a browser composites a layer that is not opaque: a
 *  `color-mix(in srgb, …, transparent)` over a picture is these sums, which is what
 *  lets a number worked out here be trusted on the screen. See legibility.test.ts. */

/** A colour as three channels from 0 to 255. */
export type Rgb = readonly [number, number, number]

/** WCAG's floor for body text: what every word on the app's own palettes clears. */
export const AA = 4.5

/** What a word aims for over something sharp - a photograph unblurred, the desk through
 *  a window with no blur: it has the picture's edges to read past as well as its
 *  colours, which a ratio between two flat colours does not count. */
export const SHARP = 6

/** `#rgb`, `#rrggbb`, `rgb()` or `rgba()` with the alpha ignored, which is every
 *  shape a stylesheet or `getComputedStyle` hands this. Null for anything else. */
export function rgbOf(said: string): Rgb | null {
  const text = said.trim().toLowerCase()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1]
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
    return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as unknown as Rgb
  }

  const parts = /^rgba?\(([^)]*)\)$/
    .exec(text)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)
  if (!parts || parts.length < 3) return null

  const channels = parts.slice(0, 3).map(Number)
  if (channels.some((one) => !Number.isFinite(one))) return null
  return channels.map((one) => Math.min(255, Math.max(0, one))) as unknown as Rgb
}

/** The same colour as `#rrggbb`, which is what a custom property is written in. */
export function hexOf(colour: Rgb): string {
  return `#${colour.map((one) => Math.round(one).toString(16).padStart(2, '0')).join('')}`
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG's relative luminance, from black at 0 to white at 1. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** How far apart two colours are, from 1 (the same) to 21 (black on white). */
export function ratio(one: Rgb, two: Rgb): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** `top` laid over `under` at `alpha`, channel by channel, as a browser lays it. */
export function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const [r, g, b] = top
  const [r0, g0, b0] = under
  return [r * alpha + r0 * (1 - alpha), g * alpha + g0 * (1 - alpha), b * alpha + b0 * (1 - alpha)]
}

/** Whichever of the inks reads best on a ground: the first that clears AA, else the
 *  one that comes closest. What `--accent-ink` is for an accent, worked out for a
 *  ground nobody chose in advance. */
export function inkFor(ground: Rgb, inks: readonly Rgb[]): Rgb {
  const scored = inks.map((ink) => ({ ink, score: ratio(ink, ground) }))
  const enough = scored.find((one) => one.score >= AA)
  if (enough) return enough.ink

  return scored.reduce((best, one) => (one.score > best.score ? one : best)).ink
}

/** The colours a layer of anything may be, as two corners of a box: the least and
 *  the most of each channel. Every colour inside the box, laid under the same scrim,
 *  comes out inside the box the corners come out as - a layer is a sum, channel by
 *  channel - and luminance only grows with each channel. So a word that reads over
 *  both corners, from the same side, reads over every colour of the picture, which is
 *  what lets a single pass over its pixels promise something about all of them. */
export interface Span {
  least: Rgb
  most: Rgb
}

/** What a word stands on, from the top: each layer between the scrim and the ink -
 *  a row under the pointer is a lift of the ink itself - as a colour and how much of
 *  it there is. */
export interface Lift {
  colour: Rgb
  alpha: number
}

/** The least scrim, from 0 to 1 and in hundredths, under which `ink` clears `floor`
 *  over every colour in `span`, with `lifts` laid on top as a hovered row lays them.
 *  1 where even a whole scrim would not do, which is a scrim that does not read with
 *  that ink and a theme that is wrong rather than a picture that is.
 *
 *  Searched rather than solved: luminance is a curve, and the answer only has to be
 *  good to the hundredth that a stylesheet writes it in. Rounded up, so the hundredth
 *  written is never the one below the floor. */
export function scrimFloor(
  ink: Rgb,
  scrim: Rgb,
  span: Span,
  lifts: readonly Lift[] = [],
  floor = AA,
): number {
  const own = luminance(ink)
  const reads = (alpha: number) => {
    const grounds = [span.least, span.most].map((under) =>
      lifts.reduce(
        (below, lift) => over(lift.colour, lift.alpha, below),
        over(scrim, alpha, under),
      ),
    )
    // Both corners on one side of the ink as well: two that clear it from either
    // side have, somewhere between them, a colour exactly as light as the words.
    const sides = new Set(grounds.map((ground) => luminance(ground) > own))
    return sides.size === 1 && grounds.every((ground) => ratio(ink, ground) >= floor)
  }

  if (!reads(1)) return 1
  if (reads(0)) return 0

  let low = 0
  let high = 100
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (reads(middle / 100)) high = middle
    else low = middle
  }

  return high / 100
}
