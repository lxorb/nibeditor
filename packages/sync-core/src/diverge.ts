/** Whether a merge is silent, quietly decided, or a question.
 *
 *  Asked only by the device whose edits arrive second, with three texts in hand: B,
 *  what the account last confirmed; L, that plus this device's pending edits; R, that
 *  plus what the account sent back. The CRDT will merge L and R whatever happens, and
 *  never loses a character doing it; what it cannot do is notice that two people
 *  wrote the same sentence two ways, which it answers by keeping both, woven together.
 *  So the device looks first (docs/sync-v2.md section 5.4):
 *
 *  - `clean`: nothing overlaps. The merge is the note. Identical edits are counted
 *    once, because the CRDT would keep both copies (`thethe`).
 *  - `minor`: overlaps, each of at most `CONTESTED` characters in all, and no block
 *    deleted on one side and rewritten on the other. Each overlap reads as its newer
 *    side wrote it; the older is a version, not a question.
 *  - `diverged`: an overlap past `CONTESTED`, a block deleted on one side and edited by
 *    more than `REWRITTEN` characters on the other, or a merge that breaks a
 *    structure both sides kept (front matter that stops parsing, a fence left open).
 *    The note is held and the person is asked, once, with three answers.
 *
 *  Eighty characters is about a sentence: a word or two changed on both sides merges
 *  quietly, a sentence written two ways asks.
 *
 *  Pure and in B's coordinates throughout; the only text it writes is `resolution`,
 *  what the note should read, which the engine turns into operations with textops. */

import { readProperties } from '@nib/markdown/properties'
import { closesFence, fenceMark } from '@nib/markdown/fences'
import { type Block, blocksOf, contentOf } from './blocks'
import { edits, wordEdits } from './diff'
import {
  analyse,
  type Analysis,
  type Edit,
  type Meeting,
  type Settle,
  sharedPoints,
  type Span,
  type Whose,
  written,
} from './merge3'

/** Past this many characters in one overlap - both sides' replacements plus the
 *  ancestor text they cover - a merge asks. About a sentence. */
export const CONTESTED = 80

/** A block deleted on one side and edited by more than this many characters on the
 *  other asks, however small the overlap. */
export const REWRITTEN = 16

export type Verdict = 'clean' | 'minor' | 'diverged'

/** A structure both sides kept that the merge would break. */
export type Broken = 'front-matter' | 'fence'

/** When each side's edits were made: the newest pending update on this device, and
 *  the account's `updated_at`. On a tie the account's stands, because it is already
 *  everywhere else. */
export interface Times {
  local: number
  remote: number
}

/** Edits of the two sides that meet, as the modal and the minor merge see them. */
export interface Overlap {
  /** The passage in the ancestor, in the local text, and in the remote text. */
  base: Span
  local: Span
  remote: Span
  /** Characters of both replacements plus the ancestor text they cover. */
  size: number
  /** The side whose text stands when the verdict is `minor`. */
  newer: Whose
  /** Why this overlap alone asks, or null when the newer side may settle it. */
  asks: 'size' | 'block' | null
}

export interface Divergence {
  verdict: Verdict
  overlaps: readonly Overlap[]
  /** What the note reads once merged, for `clean` and `minor`: the CRDT's `merged`
   *  text, when it was given, with identical edits once and each overlap as its newer
   *  side wrote it; the pure merge otherwise. Null when the verdict is `diverged`. */
  resolution: string | null
  broken: Broken | null
  /** Whether every overlap was settled as its newer side wrote it, or - where that
   *  would say a passage twice - with both sides' edits made, every deletion and every
   *  insertion; then both sides' words are kept as versions. */
  settled: 'newer' | 'both'
}

/** One side's passage for the modal, with the differing stretches marked. */
export interface Excerpt {
  text: string
  marks: [number, number][]
}

/** Where ancestor offset `at` begins in a side's text: after every edit that ends at
 *  or before it, before an insertion made exactly there. An edit that straddles it
 *  pulls the start back to where that edit's words begin. */
function startIn(at: number, sideEdits: readonly Edit[]): number {
  let shift = 0
  for (const edit of sideEdits) {
    if (edit.from >= at) break
    if (edit.to > at) return edit.from + shift
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return at + shift
}

/** Where ancestor offset `at` ends in a side's text: after every edit that starts
 *  before it, including all of one that straddles it. */
function endIn(at: number, sideEdits: readonly Edit[]): number {
  let shift = 0
  for (const edit of sideEdits) {
    if (edit.from >= at) break
    if (edit.to > at) return edit.from + shift + edit.insert.length
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return at + shift
}

function spanIn(base: Span, sideEdits: readonly Edit[]): Span {
  return { from: startIn(base.from, sideEdits), to: endIn(base.to, sideEdits) }
}

function intersects(edit: Edit, span: Span): boolean {
  if (edit.from === edit.to) return span.from <= edit.from && edit.from <= span.to
  return edit.from < span.to && edit.to > span.from
}

/** How much a side wrote in a block: what it inserted there and what of the block it
 *  took away. */
function writtenIn(block: Block, sideEdits: readonly Edit[]): number {
  let sum = 0
  for (const edit of sideEdits) {
    if (!intersects(edit, block)) continue
    sum += edit.insert.length
    sum += Math.max(0, Math.min(edit.to, block.to) - Math.max(edit.from, block.from))
  }
  return sum
}

/** The edit of a side that took every word of a block out and put nothing in their
 *  place, or null. Edits of one side never touch, so words that are gone are inside
 *  one edit. */
function deletedBy(words: Block, sideEdits: readonly Edit[]): Edit | null {
  return (
    sideEdits.find(
      (edit) => edit.from <= words.from && edit.to >= words.to && !edit.insert.trim(),
    ) ?? null
  )
}

/** The blocks one side deleted while the other wrote more than `REWRITTEN`
 *  characters in them, each as the ancestor span the two sides' edits cover. */
function rewrittenBlocks(base: string, analysis: Analysis): Span[] {
  const out: Span[] = []
  // What both sides did alike is neither side writing against the other.
  const shared = (edit: Edit) =>
    analysis.identical.some(
      (one) => one.from === edit.from && one.to === edit.to && one.insert === edit.insert,
    )
  const mine = analysis.local.filter((edit) => !shared(edit))
  const theirs = analysis.remote.filter((edit) => !shared(edit))

  for (const block of blocksOf(base)) {
    for (const [gone, kept] of [
      [analysis.local, theirs],
      [analysis.remote, mine],
    ] as const) {
      const deletion = deletedBy(contentOf(base, block), gone)
      if (!deletion) continue

      const writing = kept.filter((edit) => intersects(edit, block))
      if (writtenIn(block, writing) <= REWRITTEN) continue

      const all = [deletion, ...writing]
      out.push({
        from: Math.min(block.from, ...all.map((edit) => edit.from)),
        to: Math.max(block.to, ...all.map((edit) => edit.to)),
      })
    }
  }

  return out
}

/** What a merge costs, in characters, over an ancestor span: everything both sides
 *  wrote there plus the ancestor it covers. */
function sizeOver(span: Span, analysis: Analysis): number {
  const inside = (edit: Edit) => intersects(edit, span)
  const written = [...analysis.local, ...analysis.remote]
    .filter(inside)
    .reduce((sum, edit) => sum + edit.insert.length, 0)
  return written + (span.to - span.from)
}

/** Whether a note's front matter reads as rows: a block that closes and says nothing
 *  the properties reader cannot draw. */
function frontMatterParses(text: string): boolean {
  return readProperties(text) !== null
}

/** Whether a fence is still open where the note ends. */
function fenceOpen(text: string): boolean {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const clean = line.replace(/\r$/, '')
    if (open) {
      if (closesFence(clean, open)) open = null
    } else {
      open = fenceMark(clean)
    }
  }
  return open !== null
}

/** Which structure a merge broke that both sides kept, if any. */
function brokenBy(local: string, remote: string, merges: readonly string[]): Broken | null {
  if (frontMatterParses(local) && frontMatterParses(remote)) {
    if (merges.some((merge) => !frontMatterParses(merge))) return 'front-matter'
  }
  if (!fenceOpen(local) && !fenceOpen(remote)) {
    if (merges.some(fenceOpen)) return 'fence'
  }
  return null
}

/** How far apart two texts are: every character one would have to delete or type to
 *  turn one into the other. */
function distance(one: string, other: string): number {
  return edits(one, other, 'operations').reduce(
    (sum, edit) => sum + (edit.to - edit.from) + edit.insert.length,
    0,
  )
}

/** The note as it should read, in the CRDT's own order.
 *
 *  What it says is exact from the pure merge: every edit that meets nothing, identical
 *  edits once, each overlap as its newer side wrote it. What the pure merge cannot know
 *  is the order the CRDT gave two sides' words that landed at one point, which follows
 *  client ids; a resolution that disagreed would move one of them, deleting it and
 *  typing it again, which loses whatever a third device was typing into it at that
 *  moment. So at every such point the order is chosen to match `merged`, the CRDT's
 *  text, one point at a time. (An earlier version laid the corrections onto the CRDT
 *  text as a three-way merge of their own, and lost words wherever the CRDT's order
 *  and a correction crossed; content from the pure merge cannot.)
 *
 *  Even with nothing to correct the CRDT's text is not simply the note. Operations
 *  that change nothing a diff can see - a stretch deleted and typed again - still
 *  land somewhere in the other side's words, and found once in a simulated run a
 *  word of the other side cut in two by a line typed back into its middle. The pure
 *  merge has none of that, and textops takes the CRDT's text to it. */
function resolved(
  base: string,
  analysis: Analysis,
  settle: (meeting: Meeting) => Settle,
  merged: string,
): string {
  const order = new Map<number, Whose>()
  const write = () => written(base, analysis, { settle, first: (at) => order.get(at) ?? 'local' })
  let best = write()
  let cost = distance(merged, best)
  for (const point of sharedPoints(analysis)) {
    if (cost === 0) break
    order.set(point, 'remote')
    const text = write()
    const far = distance(merged, text)
    if (far < cost) {
      best = text
      cost = far
    } else {
      order.delete(point)
    }
  }
  return best
}

/** How many characters the check below compares at a time, white space left out: a
 *  short word. */
const RUN = 4

/** How often each run of `RUN` characters is in a text, white space left out, so two
 *  words a merge set side by side read the way they did apart. */
function runsOf(text: string): Map<string, number> {
  const bare = text.replace(/\s+/g, '')
  const counts = new Map<string, number>()
  for (let at = 0; at + RUN <= bare.length; at += 1) {
    const run = bare.slice(at, at + RUN)
    counts.set(run, (counts.get(run) ?? 0) + 1)
  }
  return counts
}

/** Whether a merge says something twice that none of `references` says that often. */
function repeats(references: readonly string[], merge: string): boolean {
  const known = references.map(runsOf)
  for (const [run, count] of runsOf(merge)) {
    if (count < 2) continue
    if (known.every((one) => count > (one.get(run) ?? 0))) return true
  }
  return false
}

/** Classifies what merging `local` and `remote` against `base` would do, and says
 *  what the note should read when nobody has to be asked. `merged` is the CRDT's
 *  merge of the two, when the caller has it. */
export function diverge(
  base: string,
  local: string,
  remote: string,
  times: Times,
  merged?: string,
): Divergence {
  const newer: Whose = times.local > times.remote ? 'local' : 'remote'
  const analysis = analyse(base, local, remote)

  const overlaps: Overlap[] = analysis.meetings.map((meeting: Meeting) => {
    const full = fuller(meeting)
    return {
      base: meeting.base,
      local: spanIn(meeting.base, analysis.local),
      remote: spanIn(meeting.base, analysis.remote),
      size: meeting.size,
      newer: full ?? newer,
      asks: full === null && meeting.size > CONTESTED ? 'size' : null,
    }
  })

  for (const span of rewrittenBlocks(base, analysis)) {
    const meeting = overlaps.find(
      (overlap) => overlap.base.from < span.to && span.from < overlap.base.to,
    )
    if (meeting) {
      meeting.asks ??= 'block'
      continue
    }
    overlaps.push({
      base: span,
      local: spanIn(span, analysis.local),
      remote: spanIn(span, analysis.remote),
      size: sizeOver(span, analysis),
      newer,
      asks: 'block',
    })
  }
  overlaps.sort((a, b) => a.base.from - b.base.from)

  // Two sides' words at one point may land either way round in the CRDT; without its
  // text to read, the structure is checked both ways, so which side is called local
  // never changes the verdict.
  const write = (settle: (meeting: Meeting) => Settle) =>
    merged === undefined
      ? [
          written(base, analysis, { settle }),
          written(base, analysis, { settle, first: () => 'remote' }),
        ]
      : [resolved(base, analysis, settle, merged)]
  let checked = write((meeting) => fuller(meeting) ?? newer)
  // A passage one side moved is, to a diff, a deletion and a retyping, and a side's
  // version of an overlap can still hold what the other side moved out of it: the
  // newer side standing would then say that passage twice, and so can a text merge
  // that keeps both. The CRDT's own merge never does - a moved passage is one deletion
  // and one insertion there, and the deletion lands on the one copy there is - so it
  // is the note. Without it in hand, both sides' edits are kept.
  let settled: Divergence['settled'] = 'newer'
  if (overlaps.length) {
    const kept = merged === undefined ? write(() => 'both') : [merged]
    if (checked.some((text) => repeats([local, remote, ...kept], text))) {
      checked = kept
      settled = 'both'
    }
  }
  const resolution = checked[0] ?? ''
  const broken = brokenBy(local, remote, checked)

  const asks = broken !== null || overlaps.some((overlap) => overlap.asks !== null)
  const verdict: Verdict = asks ? 'diverged' : overlaps.length ? 'minor' : 'clean'

  return {
    verdict,
    overlaps,
    resolution: verdict === 'diverged' ? null : resolution,
    broken,
    settled,
  }
}

/** The side whose words hold the other's whole, where two insertions at one point are
 *  one passage written twice and one of them has more: a line one device wrote that
 *  the other wrote too and went on from, or the same words put back over a deletion
 *  with more after them. That side is the note whichever is newer, and nothing is
 *  asked, since nothing the other side wrote is missing from it. */
function fuller(meeting: Meeting): Whose | null {
  const [mine] = meeting.local
  const [theirs] = meeting.remote
  if (meeting.local.length !== 1 || meeting.remote.length !== 1 || !mine || !theirs) return null
  if (mine.from !== mine.to || theirs.from !== theirs.to) return null
  const here = mine.insert.trim()
  const there = theirs.insert.trim()
  if (!here || !there) return null
  if (there.includes(here)) return 'remote'
  if (here.includes(there)) return 'local'
  return null
}

/** The longest passage an excerpt shows, in code units, before its context is cut. */
const MOST_EXCERPT = 480

/** How much context an excerpt keeps on either side of what differs, when the whole
 *  lines around it are longer than `MOST_EXCERPT`. */
const CONTEXT = 80

/** The passage of a side's text around `span`: its whole lines where they are short
 *  enough, else the span with some context either side, cut between words. */
function passage(text: string, span: Span): Span {
  const lineFrom = span.from === 0 ? 0 : text.lastIndexOf('\n', span.from - 1) + 1
  const newline = text.indexOf('\n', span.to)
  const lineTo = newline === -1 ? text.length : newline
  if (lineTo - lineFrom <= MOST_EXCERPT) return { from: lineFrom, to: lineTo }

  let from = Math.max(lineFrom, span.from - CONTEXT)
  let to = Math.min(lineTo, Math.max(span.to, span.from) + CONTEXT, from + MOST_EXCERPT)
  const space = text.indexOf(' ', from)
  if (from > lineFrom && space !== -1 && space < span.from) from = space + 1
  const back = text.lastIndexOf(' ', to)
  if (to < lineTo && back > span.to) to = back

  return { from: Math.min(from, span.from), to: Math.max(to, Math.min(span.to, lineTo)) }
}

function mark(marks: [number, number][], from: number, to: number) {
  if (to > from) marks.push([from, to])
}

/** The first contested passage of each side, for the modal: the passage as it reads
 *  there, with the stretches that differ from the other side's marked.
 *
 *  With no overlap at all (a structure broken by the merge alone) the first place
 *  either side wrote stands in for one. */
export function excerpt(
  base: string,
  local: string,
  remote: string,
  overlaps: readonly Overlap[],
): { local: Excerpt; remote: Excerpt } {
  let first: Overlap | undefined = overlaps.find((one) => one.asks !== null) ?? overlaps[0]

  if (!first) {
    const mine = edits(base, local, 'semantic')
    const theirs = edits(base, remote, 'semantic')
    const edit = [...mine, ...theirs].sort((a, b) => a.from - b.from)[0]
    if (!edit) return { local: { text: '', marks: [] }, remote: { text: '', marks: [] } }
    first = {
      base: edit,
      local: spanIn(edit, mine),
      remote: spanIn(edit, theirs),
      size: 0,
      newer: 'remote',
      asks: null,
    }
  }

  const here = passage(local, first.local)
  const there = passage(remote, first.remote)
  const mineText = local.slice(here.from, here.to)
  const theirText = remote.slice(there.from, there.to)

  const localMarks: [number, number][] = []
  const remoteMarks: [number, number][] = []
  let shift = 0
  for (const edit of wordEdits(mineText, theirText)) {
    mark(localMarks, edit.from, edit.to)
    mark(remoteMarks, edit.from + shift, edit.from + shift + edit.insert.length)
    shift += edit.insert.length - (edit.to - edit.from)
  }

  return {
    local: { text: mineText, marks: localMarks },
    remote: { text: theirText, marks: remoteMarks },
  }
}
