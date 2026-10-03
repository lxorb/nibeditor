/** Each side's colours as the wallpaper's sums need them: the chrome's palette out of
 *  wallpaper.css, the paper's out of the page, and the accent field's span.
 *
 *  The paper is the app's own `--bg`, which wallpaper.css does not restate, so it is read
 *  off the page in each scheme (scheme-tokens.ts). The accent is the reader's, in each
 *  side's shade. */

import { wallpaperCss } from '@nib/themes/wallpaper'
import { accentColour } from '../accents'
import { linkOf, type PaperInks } from '../content-ground'
import { over, type Rgb, rgbOf, type Span } from '../legibility'
import { PAPER, schemeTokens } from '../scheme-tokens'
import { paletteOf, sheetColour } from './floors'
import type { Scheme } from './held'
import type { Colours } from './look'

/** The floors wallpaper.css states for the accent field, which floors.test.ts holds to
 *  every accent; a picture's own are worked out. */
export function fieldFloors(): Record<Scheme, number> {
  const said = (scheme: Scheme) =>
    Number(
      new RegExp(String.raw`--wallpaper-floor-${scheme},\s*(\d+)%`).exec(wallpaperCss)?.[1] ?? 60,
    ) / 100
  return { dark: said('dark'), light: said('light') }
}

/** The colours the accent field is made of, as a span: its two grounds, and the accent
 *  and the canvas's blue at the strengths it lays them. */
function fieldOf(base: [Rgb, Rgb], accent: Rgb, blue: Rgb): Span {
  const all = base.flatMap((one) => [one, over(accent, 0.4, one), over(blue, 0.25, one)])
  const pick = (choose: (...values: number[]) => number) =>
    [0, 1, 2].map((at) => choose(...all.map((one) => one[at] ?? 0))) as unknown as Rgb
  return { least: pick(Math.min), most: pick(Math.max) }
}

/** Both sides' colours, for the reader's accent. */
export function coloursOf(accent: string): Record<Scheme, Colours> {
  const sides = {} as Record<Scheme, Colours>
  for (const scheme of ['dark', 'light'] as const) {
    const palette = paletteOf(wallpaperCss, scheme)
    if (!palette) throw new Error('wallpaper.css does not state its palette')

    const read = schemeTokens(scheme, ['--bg', '--text-strong', '--canvas-5'])
    const bg = read['--bg'] ?? PAPER[scheme]
    const strong =
      sheetColour(wallpaperCss, scheme, '--text-strong') ?? read['--text-strong'] ?? palette.text
    const tone = rgbOf(accentColour(accent, scheme)) ?? palette.text
    const inks: PaperInks = {
      bg,
      text: palette.text,
      muted: palette.ink,
      link: linkOf(tone, strong),
    }
    const base: [Rgb, Rgb] = [
      sheetColour(wallpaperCss, scheme, '--wallpaper-base-1') ?? bg,
      sheetColour(wallpaperCss, scheme, '--wallpaper-base-2') ?? bg,
    ]

    sides[scheme] = { palette, inks, field: fieldOf(base, tone, read['--canvas-5'] ?? tone) }
  }
  return sides
}
