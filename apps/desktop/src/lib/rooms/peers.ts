/** Who else is in a note, and where.
 *
 *  What travels is a name, an accent, a person's face where they have one, and two
 *  positions. The positions are Yjs's own relative ones rather than offsets: a caret
 *  that says "after this character" is still in the right place once somebody has
 *  written a paragraph above it, where a number would have slid. Each end turns them
 *  back into offsets against the text it holds, which is why nobody has to agree
 *  about anything but the characters themselves.
 *
 *  The accent travels as its name, not as a colour. The shade a colour needs to
 *  be readable on white is not the shade it needs on black, so which shade is
 *  the reader's business and not the writer's; see accents.ts. */

import type { Peer } from '@nib/editor'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { accentColour, accentFor } from '../accents'
import { BASE } from '../api'
import { isNumber, isRecord, isString } from '../stored'

/** What one device says about itself. Everything in it is JSON, because that is
 *  what the awareness protocol carries.
 *
 *  Both names travel, and which one is drawn is decided here rather than by the
 *  device that sent them: a caret answers a different question depending on who
 *  else is in the note. Two of one person's own machines want to be told apart
 *  by machine - "Emil" on both of them says nothing - while two people want to
 *  be told apart by person. Nobody knows which case it is until everybody has
 *  arrived, so the choice belongs to whoever is looking. */
interface Named {
  /** The device: "Windows", "iPhone", "Firefox". */
  name: string
  accent: string
  /** Whoever is at it, when there is an account to say. */
  person?: string
  /** That account, its small picture's hash and its own accent: the face a tab and a
   *  caret draw for a person; see who.ts. */
  id?: string
  face?: string
  tint?: string
}

/** Another person in a room, as the tab draws them: a face, or an initial on their
 *  colour. */
interface Someone {
  key: string
  name: string
  face: string | null
  fill: string
}

/** Who else is in a room, for the tab: the other people, and how many of this
 *  account's own other devices, which stay dots. */
export interface Seen {
  people: Someone[]
  mine: number
}

/** One other device in a room: who it says it is, and everything else it said.
 *  What it said beyond its name is the room's own business - a caret in a note, a
 *  hand on a plane - so it comes through as it arrived. */
export interface Here {
  id: number
  who: Named
  said: Record<string, unknown>
}

/** Where a caret is, as something that survives the text changing under it. */
export function relative(text: Y.Text, at: number): unknown {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, at))
}

/** A clock or a client id: what Yjs numbers the pieces of a document with. */
function isCount(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0
}

function isPlace(value: unknown): boolean {
  return isRecord(value) && isCount(value.client) && isCount(value.clock)
}

/** Whether what arrived is one of Yjs's own relative positions, in the shapes it
 *  reads them in.
 *
 *  Checked rather than trusted, because this is JSON from another machine and
 *  Yjs reads it without an opinion: an `item` that is a number rather than a
 *  place is then a lookup for a client nobody has heard of, and that throws from
 *  inside the awareness update which carried it. One peer saying something odd
 *  would take out every caret in the note, and the note is not the caret's to
 *  break. Absent and null are both fine on every field: a position at the very
 *  start of a text names no item, and one against a named type names no id. */
function isPosition(value: unknown): boolean {
  if (!isRecord(value)) return false

  const { type, item, tname, assoc } = value
  if (type !== undefined && type !== null && !isPlace(type)) return false
  if (item !== undefined && item !== null && !isPlace(item)) return false
  if (tname !== undefined && tname !== null && !isString(tname)) return false

  return assoc === undefined || assoc === null || isNumber(assoc)
}

/** And back again, against the text this device holds. Null when the position
 *  cannot be placed - a caret in a paragraph that has since gone, or one that
 *  never read as a position at all. */
function absolute(doc: Y.Doc, held: unknown): number | null {
  if (!isPosition(held)) return null

  const found = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(held),
    doc,
  )

  return found ? found.index : null
}

/** As much of a name as goes over a caret. Far more than "Windows" or a person's
 *  name, and short enough that a name off the wire is a label rather than a
 *  paragraph: what arrives is whatever another machine chose to send, and it is
 *  drawn in the note. */
const LONGEST_NAME = 64
const HASH = /^[a-f0-9]{64}$/
const WORD = /^[\w-]{1,64}$/

function namedIn(value: unknown): Named | null {
  if (!isRecord(value) || !isRecord(value.who)) return null
  if (!isString(value.who.name) || !isString(value.who.accent)) return null

  const { person, id, face, tint } = value.who
  return {
    name: value.who.name.slice(0, LONGEST_NAME),
    accent: value.who.accent,
    ...(isString(person) ? { person: person.slice(0, LONGEST_NAME) } : {}),
    // A face is only ever a hash, so what another machine sent can only ever be a
    // picture this service holds.
    ...(isString(id) && WORD.test(id) ? { id } : {}),
    ...(isString(face) && HASH.test(face) ? { face } : {}),
    ...(isString(tint) && WORD.test(tint) ? { tint } : {}),
  }
}

/** Where a face's small picture is; see people/face.ts. */
const faceUrl = (hash: string | undefined) => (hash ? `${BASE}/i/${hash}.webp` : undefined)

/** The people among `here` who are not this account, one each however many devices they
 *  have, and how many of this account's own devices are left over. */
function seenIn(here: readonly Here[], mine: Named | null, scheme: 'dark' | 'light'): Seen {
  const self = mine?.id ?? mine?.person
  const people = new Map<string, Someone>()
  let own = 0
  for (const { who } of here) {
    const key = who.id ?? who.person
    if (!key || key === self) {
      own++
      continue
    }
    people.set(key, {
      key,
      name: who.person ?? who.name,
      face: faceUrl(who.face) ?? null,
      fill: who.tint ? accentColour(who.tint, scheme) : accentFor(key, scheme),
    })
  }
  return { people: [...people.values()], mine: own }
}

/** Everybody in the room but us, and which of the two names to draw them by.
 *
 *  Shared by both kinds of room, because who is here and what they are called is
 *  the same question in a note and on a plane. What each of them then draws - a
 *  caret in the words, a pointer on the plane - is its own. */
export function whoElse(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { here: Here[]; nameOf: (who: Named) => string; seen: Seen } {
  const here: Here[] = []

  for (const [id, state] of awareness.getStates()) {
    if (id === doc.clientID) continue

    const who = namedIn(state)
    if (who && isRecord(state)) here.push({ id, who, said: state })
  }

  // Our own counts: a file this account has open on two machines and somebody
  // else has open on one is a room with two people in it.
  const mine = namedIn(awareness.getLocalState())
  const people = new Set(
    [mine, ...here.map((one) => one.who)]
      .map((one) => one?.person)
      .filter((one): one is string => !!one),
  )
  const byPerson = people.size > 1

  return {
    here,
    nameOf: (who) => (byPerson ? who.person : who.name) ?? who.name,
    seen: seenIn(here, mine, scheme),
  }
}

/** Everybody in the note but us, as the editor draws them. A device that has
 *  announced itself without having put its caret anywhere yet is somebody in the
 *  note rather than somebody with a caret in it, so it counts towards the dots on
 *  the tab and draws nothing in the text. */
export function peersIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; carets: Peer[]; seen: Seen } {
  const { here, nameOf, seen } = whoElse(awareness, doc, scheme)
  const carets: Peer[] = []

  for (const { id, who, said } of here) {
    if (!isRecord(said.caret)) continue

    const head = absolute(doc, said.caret.head)
    const anchor = absolute(doc, said.caret.anchor)
    if (head === null) continue

    // A person's label wears their face; a device's stays a word.
    const name = nameOf(who)
    carets.push({
      id,
      name,
      colour: accentColour(who.accent, scheme),
      face: name === who.person ? faceUrl(who.face) : undefined,
      head,
      anchor: anchor ?? head,
    })
  }

  return { present: here.length, carets, seen }
}
