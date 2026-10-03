/** Two sets of edits to one text, laid side by side against the text they were both
 *  made on.
 *
 *  This is the half of `diff3` nib needs: not a merge to trust - the CRDT merges,
 *  character by character, with nothing fuzzy about it - but the map of where two
 *  sides wrote, so the classifier can say whether a merge is silent, quietly settled,
 *  or a question (docs/sync-v2.md section 5.4). Each side is diffed against the
 *  ancestor with the semantic cleanup, so a rewritten sentence reads as one edit
 *  rather than as twenty letters that happen to survive, and every edit is in the
 *  ancestor's coordinates, where the two sides can be compared.
 *
 *  Three things can happen where the two meet:
 *
 *  - **the same edit on both sides** (both fixed the typo) counts once;
 *  - **insertions at one point** (both appended to the list) are both kept, which is
 *    not a conflict at all - unless they share more than a line of words, which is one
 *    passage put back or written twice, and meets like an overlap;
 *  - **edits that overlap** - spans that intersect, or an insertion strictly inside a
 *    span the other side replaced - form a meeting, joined transitively, whose size is
 *    what both sides wrote there plus the ancestor text they cover.
 *
 *  The text this assembles is the pure merge: everything that meets nothing applied,
 *  identical edits once, and each meeting as the caller decides. The classifier uses
 *  it where it has no CRDT text to hand, and as the reference the simulator checks
 *  the CRDT against. */

import { edits, wordEdits } from './diff'

/** A stretch of a text, as UTF-16 offsets, `to` exclusive. */
export interface Span {
  from: number
  to: number
}

/** One side's change to the ancestor, in the ancestor's coordinates: `from` to `to`
 *  of the ancestor reads `insert` on that side. A pure insertion has `from === to`. */
export interface Edit extends Span {
  insert: string
}

/** Which of the two sides: this device's (L) or the account's (R). */
export type Whose = 'local' | 'remote'

/** Edits of the two sides that meet: spans that intersect, or an insertion strictly
 *  inside a span the other side replaced, closed over transitively. */
export interface Meeting {
  /** The ancestor passage the edits cover, together. */
  base: Span
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Characters of both sides' replacements plus the ancestor text they cover. */
  size: number
}

/** How a meeting is written into the merge: as one side wrote it, or as a CRDT would
 *  leave it, with both sides' deletions made and both sides' insertions kept. */
export type Settle = Whose | 'both'

/** Where two sides wrote, before anything is decided about it. */
export interface Analysis {
  /** The ancestor to the local text, and to the remote one, each in order. */
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Edits both sides made the same way. */
  identical: readonly Edit[]
  meetings: readonly Meeting[]
  /** The edits of each side that meet nothing and are not identical to the other's. */
  alone: { local: readonly Edit[]; remote: readonly Edit[] }
}

export interface Merged extends Analysis {
  /** The three-way merge: every edit that meets nothing applied, identical ones
   *  once, insertions at one point local first, and each meeting as `settle` said. */
  text: string
}

function isInsertion(edit: Edit): boolean {
  return edit.from === edit.to
}

function sameEdit(one: Edit, other: Edit): boolean {
  return one.from === other.from && one.to === other.to && one.insert === other.insert
}

/** How many characters of whole words two insertions have in common. Asked with the
 *  two in one order whichever side each came from, because a diff may line up
 *  repeated words differently read the other way round, and which side is local must
 *  never change a verdict. */
function shared(one: string, other: string): number {
  const [first, second] = one < other ? [one, other] : [other, one]
  return wordEdits(first, second).reduce((left, edit) => left - (edit.to - edit.from), first.length)
}

/** More words than this in common, and two insertions at one point are one passage
 *  written twice rather than two things added side by side. The block rule's number:
 *  about a line. */
const ONE_PASSAGE = 16

/** The fewest characters one side's words may be for them to count as a passage the
 *  other side wrote too, when the other side's words hold them whole: two short words. */
const HELD_WHOLE = 8

/** Whether two sides' words at one point are one passage written twice: more than a
 *  line of words in common, or the one wholly inside the other - two devices that each
 *  put back the same few words over a deletion, one of them with more after it. */
function samePassage(one: string, other: string): boolean {
  if (shared(one, other) > ONE_PASSAGE) return true
  const [shorter, longer] = one.trim().length <= other.trim().length ? [one, other] : [other, one]
  const words = shorter.trim()
  return words.length >= HELD_WHOLE && longer.includes(words)
}

/** Whether an edit of one side and an edit of the other overlap. Two insertions at
 *  one point do not, and both are kept (both appended to the list) - unless they are
 *  one passage written twice (`samePassage`), the same passage put back or written
 *  twice, and keeping both would say it twice. An insertion at the very edge of a span
 *  the other side replaced does not overlap either: it is beside the replacement, not
 *  in it - unless, again, it is the replacement's own words written twice. */
function meets(one: Edit, other: Edit): boolean {
  if (isInsertion(one) && isInsertion(other)) {
    return one.from === other.from && samePassage(one.insert, other.insert)
  }
  const [insertion, span] = isInsertion(one) ? [one, other] : [other, one]
  if (isInsertion(insertion)) {
    if (span.from < insertion.from && insertion.from < span.to) return true
    const edge = insertion.from === span.from || insertion.from === span.to
    return edge && samePassage(insertion.insert, span.insert)
  }
  return one.from < other.to && other.from < one.to
}

/** The edits both sides made alike, and what is left of each side without them.
 *  Both lists are in order and no two edits of one side touch, so one walk finds
 *  every pair. */
function paired(mine: readonly Edit[], theirs: readonly Edit[]) {
  const identical: Edit[] = []
  const local: Edit[] = []
  const remote: Edit[] = []
  let one = 0
  let other = 0

  while (one < mine.length || other < theirs.length) {
    const left = mine[one]
    const right = theirs[other]

    if (left && right && sameEdit(left, right)) {
      identical.push(left)
      one++
      other++
    } else if (
      left &&
      (!right || left.from < right.from || (left.from === right.from && left.to <= right.to))
    ) {
      local.push(left)
      one++
    } else if (right) {
      remote.push(right)
      other++
    }
  }

  return { identical, local, remote }
}

/** The edits that meet, grouped: a union of every local edit with every remote edit
 *  it overlaps. Both lists are in order, so the remote edits a local one could meet
 *  are a window that only ever moves forward. */
function grouped(local: readonly Edit[], remote: readonly Edit[]): Meeting[] {
  const parent = new Map<number, number>()
  // Local edits are 0..n-1, remote ones n..n+m-1, in one forest.
  const root = (at: number): number => {
    let node = at
    while (parent.get(node) !== undefined && parent.get(node) !== node) {
      node = parent.get(node) ?? node
    }
    return node
  }
  const join = (one: number, other: number) => {
    const a = root(one)
    const b = root(other)
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b))
  }

  const touched = new Set<number>()
  let window = 0
  for (const [index, edit] of local.entries()) {
    while (window < remote.length && (remote[window]?.to ?? 0) < edit.from) window++

    for (let at = window; at < remote.length; at++) {
      const other = remote[at]
      if (!other || other.from > edit.to) break
      if (!meets(edit, other)) continue

      touched.add(index)
      touched.add(local.length + at)
      join(index, local.length + at)
    }
  }

  const groups = new Map<number, { local: Edit[]; remote: Edit[] }>()
  for (const node of [...touched].sort((a, b) => a - b)) {
    const key = root(node)
    const group = groups.get(key) ?? { local: [], remote: [] }
    groups.set(key, group)

    const isLocal = node < local.length
    const edit = isLocal ? local[node] : remote[node - local.length]
    if (edit) (isLocal ? group.local : group.remote).push(edit)
  }

  const meetings: Meeting[] = []
  for (const group of groups.values()) {
    const all = [...group.local, ...group.remote]
    const from = Math.min(...all.map((edit) => edit.from))
    const to = Math.max(...all.map((edit) => edit.to))
    const written = all.reduce((sum, edit) => sum + edit.insert.length, 0)

    meetings.push({ base: { from, to }, ...group, size: written + (to - from) })
  }

  return meetings.sort((a, b) => a.base.from - b.base.from)
}

/** Where two sides wrote: each side's edits, the ones they share, the meetings, and
 *  what meets nothing. */
export function analyse(base: string, local: string, remote: string): Analysis {
  const mine = edits(base, local, 'semantic')
  const theirs = edits(base, remote, 'semantic')
  const { identical, local: onlyMine, remote: onlyTheirs } = paired(mine, theirs)
  const meetings = grouped(onlyMine, onlyTheirs)

  const met = new Set<Edit>(meetings.flatMap((meeting) => [...meeting.local, ...meeting.remote]))
  return {
    local: mine,
    remote: theirs,
    identical,
    meetings,
    alone: {
      local: onlyMine.filter((edit) => !met.has(edit)),
      remote: onlyTheirs.filter((edit) => !met.has(edit)),
    },
  }
}

/** One replacement to write into the ancestor, and where it goes among others that
 *  land on the same point: insertions before replacements, and between insertions,
 *  whichever side goes first. */
interface Piece extends Edit {
  rank: number
}

/** A meeting as a CRDT leaves it: every character either side deleted gone, every
 *  insertion kept where it was made, and insertions at one point in `first`'s order. */
function both(base: string, meeting: Meeting, first: Whose): string {
  const { from, to } = meeting.base
  const gone = new Uint8Array(to - from)
  const inserts = new Map<number, string[]>()

  const sides: [Whose, readonly Edit[]][] = [
    ['local', meeting.local],
    ['remote', meeting.remote],
  ]
  if (first === 'remote') sides.reverse()

  for (const [, list] of sides) {
    for (const edit of list) {
      gone.fill(1, edit.from - from, edit.to - from)
      if (!edit.insert) continue
      const here = inserts.get(edit.from) ?? []
      here.push(edit.insert)
      inserts.set(edit.from, here)
    }
  }

  let out = ''
  for (let at = from; at < to; at++) {
    out += (inserts.get(at) ?? []).join('')
    if (!gone[at - from]) out += base.charAt(at)
  }
  return out
}

/** How the merge is written: each meeting settled by `settle`, identical edits once,
 *  and where both sides put words at one point, `first` says whose go ahead (local,
 *  unless it says otherwise for that point). */
export interface Writing {
  settle: (meeting: Meeting) => Settle
  first?: (at: number) => Whose
}

/** The points where both sides' words land at one place, so their order is a choice:
 *  what `first` in `Writing` is asked about. */
export function sharedPoints(analysis: Analysis): number[] {
  const side = (whose: Whose) => [
    ...analysis.alone[whose],
    ...analysis.meetings.flatMap((meeting) => meeting[whose]),
  ]
  const mine = new Set(side('local').map((edit) => edit.from))
  const points = new Set<number>()
  for (const edit of side('remote')) if (mine.has(edit.from)) points.add(edit.from)
  return [...points].sort((a, b) => a - b)
}

/** The ancestor with the edits written in, as `writing` says. */
export function written(base: string, analysis: Analysis, writing: Writing): string {
  const first = writing.first ?? (() => 'local')
  const rankOf = (whose: Whose, at: number) => (whose === first(at) ? 0 : 1)
  const pieces: Piece[] = []

  for (const edit of analysis.alone.local)
    pieces.push({ ...edit, rank: rankOf('local', edit.from) })
  for (const edit of analysis.alone.remote)
    pieces.push({ ...edit, rank: rankOf('remote', edit.from) })
  for (const edit of analysis.identical) pieces.push({ ...edit, rank: 0 })

  for (const meeting of analysis.meetings) {
    const settled = writing.settle(meeting)
    if (settled === 'both') {
      const insert = both(base, meeting, first(meeting.base.from))
      pieces.push({ ...meeting.base, insert, rank: 0 })
      continue
    }
    for (const edit of meeting[settled]) pieces.push({ ...edit, rank: rankOf(settled, edit.from) })
  }

  // In order along the ancestor; at one point, whoever goes first. A replacement's
  // words and an insertion at its start land at the same place, so they are ordered
  // like two insertions, and the replaced text is skipped whichever comes first.
  pieces.sort((a, b) => a.from - b.from || a.rank - b.rank || a.to - b.to)

  let out = ''
  let at = 0
  for (const piece of pieces) {
    out += base.slice(at, piece.from) + piece.insert
    at = Math.max(at, piece.to)
  }

  return out + base.slice(at)
}

/** The three-way merge of `local` and `remote` against `base`, with the map of where
 *  they wrote. Each meeting is settled by `settle`: by default as a CRDT would leave
 *  it, which loses nothing either side wrote. */
export function merge3(
  base: string,
  local: string,
  remote: string,
  settle: (meeting: Meeting) => Settle = () => 'both',
): Merged {
  const analysis = analyse(base, local, remote)
  return {
    ...analysis,
    text: written(base, analysis, { settle }),
  }
}
