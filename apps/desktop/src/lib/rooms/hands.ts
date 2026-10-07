/** Whose hand is on the plane, where, and what it is drawing.
 *
 *  The canvas's answer to a caret. A note's carets say where in the words somebody
 *  is; a plane has no words, so what travels is where on the plane the pointer is
 *  and, while a pen is down, the stroke it is in the middle of. So the line appears
 *  as it is being drawn rather than at the moment the pen lifts, which is the whole
 *  difference between watching somebody write and being handed what they wrote.
 *
 *  Over awareness rather than in the document, deliberately. An unfinished stroke
 *  is not on the plane yet: it is not in the file, it is nobody's to undo, and it
 *  vanishes if the pen is lifted somewhere else. Awareness is what a room already
 *  has for facts that belong to a device rather than to the file, and it is thrown
 *  away when that device goes. The finished stroke goes into the document on the
 *  pen lift, once, as one whole object.
 *
 *  Sent packed, exactly as a file packs points: a hundred samples a second becomes
 *  six numbers a sample rather than an object each. */

import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { packed, strokeOf } from '@nib/markdown/canvas'
import { accentColour } from '../accents'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { Hand } from '../canvas/shared'
import { isRecord } from '../stored'
import { type Seen, whoElse } from './peers'

/** The field a device's hand travels in. */
export const HAND = 'hand'

/** What this device says about its hand: where it is, and the stroke it is in the
 *  middle of. Built here rather than at the call site so the shape it travels in
 *  is written down once. */
export function saidHand(at: Point, drawing: InkStroke | null): Record<string, unknown> {
  return {
    x: Math.round(at.x * 10) / 10,
    y: Math.round(at.y * 10) / 10,
    ...(drawing
      ? {
          ink: {
            tool: drawing.tool,
            color: drawing.color,
            size: drawing.size,
            // Only when the dial was turned, so a stroke drawn with the pen as it
            // comes carries nothing to say about it, exactly as in a file.
            ...(drawing.opacity === undefined ? {} : { opacity: drawing.opacity }),
            points: packed(drawing.points),
          },
        }
      : {}),
  }
}

/** The stroke a hand is drawing, out of what it said. Null for anything that does
 *  not read as one: a hand with the pen up, or a field written by a newer build.
 *
 *  Read by the format's own reader, so a stroke off the wire is held to exactly
 *  what a stroke in a file is held to - a known tool, a size the paint can use, an
 *  opacity that leaves it visible - rather than to a second list of rules that
 *  could drift from it. What arrives here was written by another machine, which is
 *  the same amount of trust a file on a disk deserves.
 *
 *  The id is the one thing not taken off the wire. A live stroke is nobody's
 *  object yet, and giving it the sender's own id would let it be picked or erased
 *  here. */
function inkIn(value: unknown, id: number): InkStroke | null {
  if (!isRecord(value)) return null

  return strokeOf({ ...value, id: `hand:${id}` })
}

/** Everybody on the plane but us: how many, and the hands there are to draw.
 *
 *  A device that has joined without moving its pointer is somebody on the plane
 *  rather than a hand on it, so it counts towards the dots on the tab and draws
 *  nothing, which is exactly how a note treats somebody with no caret yet. */
export function handsIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; hands: Hand[]; seen: Seen } {
  const { here, nameOf, seen } = whoElse(awareness, doc, scheme)
  const hands: Hand[] = []

  for (const { id, who, said } of here) {
    const hand = said[HAND]
    if (!isRecord(hand) || typeof hand.x !== 'number' || typeof hand.y !== 'number') continue

    hands.push({
      id,
      name: nameOf(who),
      colour: accentColour(who.accent, scheme),
      at: { x: hand.x, y: hand.y },
      stroke: inkIn(hand.ink, id),
    })
  }

  return { present: here.length, hands, seen }
}
