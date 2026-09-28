/** Ink as SVG: what a stroke looks like to anything that is not a 2d context.
 *
 *  An exported picture carries no stylesheet and no `var(...)` to look a colour
 *  up in, so everything about a stroke has to be written into the path itself:
 *  the curve, the colour the theme gave that preset, how much of the colour
 *  lands, and whether the ink darkens what it crosses. All four come from the
 *  same places the plane reads them from, so a picture that has left the app is
 *  the picture that was on it.
 *
 *  Its own file rather than a corner of the export, because the export reaches
 *  the workspace, the file system and the printer, and how a stroke is drawn is
 *  none of those. This is pure, and a test of it costs nothing. */

import { escapeAll } from '@nib/markdown/html'
import type { InkStroke } from './format'
import { INK_STYLES, inkOpacity, inkPath, outlineOf } from './ink'
import { inkColour, type Palette } from './paint'

/** Every stroke as one path each, in the order they were drawn.
 *
 *  One path per stroke rather than one per kind of ink, which is the opposite of
 *  what `paint.ts` does and right for the same reason: on screen the cost is the
 *  number of fills, and in a file the cost is somebody opening it later and
 *  finding their drawing welded into forty shapes. */
export function inkSvg(strokes: readonly InkStroke[], palette: Palette): string {
  const out: string[] = []

  for (const stroke of strokes) {
    const d = inkPath(outlineOf(stroke))
    if (!d) continue

    // A canvas may have arrived from a room, a share or a paste, so a colour a file
    // wrote goes into the picture as a colour and can never end its attribute.
    const colour = escapeAll(inkColour(stroke.color, palette))
    const blend = INK_STYLES[stroke.tool].multiply ? ' style="mix-blend-mode:multiply"' : ''

    out.push(`<path d="${d}" fill="${colour}" fill-opacity="${inkOpacity(stroke)}"${blend}/>`)
  }

  return out.join('')
}
