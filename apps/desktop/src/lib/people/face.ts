/** What a person looks like wherever one is drawn, and nothing more: the shapes the
 *  service answers with, and where a picture of a face is fetched from. Small and with
 *  nothing behind it, because the panel's foot, a tab and a caret draw a face in the
 *  first paint; everything else about people waits behind the store (people.svelte.ts).
 *  See docs/chats.md 4.9. */

import { BASE } from '../api'

/** The two pictures a device made of one face, by blob hash: `s` is 96 px, for every
 *  row a person is in, and `l` 512 px, for their card. */
export interface Avatar {
  s: string
  l: string
}

/** An emoji and a line, and when they go; `quiet` is Do not disturb. */
export interface Status {
  emoji: string
  text: string
  until: number | null
  quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

/** Enough of a person to draw their face: the name an initial comes off, the picture
 *  if they chose one, and the accent the initial sits on. `key` is what an accent is
 *  derived from when they chose none, so one person is one colour everywhere. */
export interface Face {
  name: string
  avatar?: Avatar | null
  accent?: string | null
  key?: string
}

const HASH = /^[a-f0-9]{64}$/

/** Where one picture of a face is fetched from: by its hash, with no session, the way a
 *  note's pictures are, and cached for good because the bytes never change. Null for
 *  anything that is not a hash, which is what arrived from somebody else's device. */
export function faceUrl(hash: string | null | undefined): string | null {
  return hash && HASH.test(hash) ? `${BASE}/i/${hash}.webp` : null
}
