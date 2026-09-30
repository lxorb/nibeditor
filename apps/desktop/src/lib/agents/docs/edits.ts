/** An agent's edits, turned into characters against one text.
 *
 *  Each edit names a place and does one of four things there: replaces it, puts words
 *  before it or after it, or takes it away. All of them are resolved against the same
 *  words and come out as one list of replacements in the order they sit, which is
 *  what one transaction is made of; see edit.ts. Two edits that would touch the same
 *  characters are refused rather than guessed at.
 *
 *  What goes in beside a task is a line of its own, and beside a section or a block a
 *  paragraph of its own, the way somebody adding one more to a list presses Enter
 *  first: words asked for after a heading's section are a new paragraph, not words
 *  glued to the front of the next heading. Pure. */

import { type Anchor, oneEnding, type Place, readAnchor, resolve, type Selected } from './anchors'
import { DocError } from './problem'

/** One span of characters replaced, in the offsets of the words before it. */
export interface Replacement {
  from: number
  to: number
  insert: string
}

/** What one edit does at its place. */
type Doing =
  | { kind: 'replace'; words: string }
  | { kind: 'before'; words: string }
  | { kind: 'after'; words: string }
  | { kind: 'delete' }

/** One edit, read off the wire: a place, and what to do there. */
export interface AgentEdit {
  at: Anchor
  doing: Doing
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What one edit does: exactly one of `replace`, `insert_before`, `insert_after` and
 *  `delete`, or refused. */
function doingOf(edit: Record<string, unknown>): Doing {
  const said: Doing[] = []
  if (typeof edit.replace === 'string')
    said.push({ kind: 'replace', words: oneEnding(edit.replace) })
  if (typeof edit.insert_before === 'string') {
    said.push({ kind: 'before', words: oneEnding(edit.insert_before) })
  }
  if (typeof edit.insert_after === 'string') {
    said.push({ kind: 'after', words: oneEnding(edit.insert_after) })
  }
  if (edit.delete === true) said.push({ kind: 'delete' })

  const [only] = said
  if (!only || said.length > 1) {
    throw new DocError(
      'bad_edit',
      edit,
      'each edit does exactly one of replace, insert_before, insert_after and delete',
    )
  }
  return only
}

/** The edits as the agent sent them, read and checked, or refused whole. */
export function readEdits(value: unknown): AgentEdit[] {
  if (!Array.isArray(value) || !value.length) {
    throw new DocError('bad_edit', value, 'edits is a list of at least one edit')
  }

  return value.map((edit: unknown) => {
    if (!isRecord(edit)) throw new DocError('bad_edit', edit, 'an edit is an object')
    return { at: readAnchor(edit.at), doing: doingOf(edit) }
  })
}

/** How many line breaks these words end with, and start with. */
function trailingBreaks(words: string): number {
  let count = 0
  while (words[words.length - 1 - count] === '\n') count++
  return count
}

function leadingBreaks(words: string): number {
  let count = 0
  while (words[count] === '\n') count++
  return count
}

/** Words kept apart from what is before them by `gap` line breaks, counting the ones
 *  already there. Nothing is added at the very start. */
function apartFromBefore(words: string, gap: number, text: string, at: number): string {
  if (at === 0) return words
  const have = trailingBreaks(text.slice(0, at)) + leadingBreaks(words)
  return '\n'.repeat(Math.max(0, gap - have)) + words
}

/** And from what is after them. Nothing is added at the very end. */
function apartFromAfter(words: string, gap: number, text: string, at: number): string {
  if (at === text.length) return words
  const have = trailingBreaks(words) + leadingBreaks(text.slice(at))
  return words + '\n'.repeat(Math.max(0, gap - have))
}

/** The line breaks that keep a thing of this shape apart from its neighbours. */
function gapOf(place: Place): number {
  if (place.shape === 'words') return 0
  return place.shape === 'line' ? 1 : 2
}

/** One edit at its place, as the characters it replaces. */
function placed(text: string, place: Place, doing: Doing): Replacement {
  const gap = gapOf(place)

  switch (doing.kind) {
    case 'replace': {
      // A block keeps its name unless the new words say it again.
      const keep = place.keep && !doing.words.includes(place.keep.trim()) ? place.keep : ''
      const words = keep ? doing.words.replace(/\n+$/, '') + keep : doing.words
      return { from: place.from, to: place.to, insert: words }
    }

    case 'before':
    case 'after': {
      const at = doing.kind === 'before' ? place.from : place.to
      // Before a thing, the thing is what follows; after it, what precedes. The start
      // of the words has only what follows it (the front matter is not words), and
      // the end only what precedes it, whichever way round the agent put it.
      const edge = place.shape === 'edge'
      const atEnd = edge ? at === text.length : doing.kind === 'after'
      const words = atEnd
        ? apartFromBefore(doing.words, gap, text, at)
        : apartFromAfter(doing.words, gap, text, at)
      // A note that ended with a line break still does.
      const ending = at === text.length && text.endsWith('\n') && !words.endsWith('\n')
      return { from: at, to: at, insert: ending ? `${words}\n` : words }
    }

    case 'delete': {
      if (place.shape === 'edge') {
        throw new DocError('bad_edit', place, 'the start and the end are places, not words')
      }
      if (!gap) return { from: place.from, to: place.to, insert: '' }

      // The line breaks that kept it apart go with it, so what is left has no hole
      // where it was. At the very end it is the ones before it that go.
      let to = place.to
      while (to < text.length && text[to] === '\n' && to - place.to < gap) to++
      let from = place.from
      if (to === text.length) {
        while (from > 0 && text[from - 1] === '\n') from--
        // A note that ended with a line break still does.
        if (from > 0 && text.endsWith('\n')) to = Math.max(from, to - 1)
      }
      return { from, to, insert: '' }
    }
  }
}

/** Every edit resolved and in characters, in the order they sit, and where each
 *  landed in the order they were asked. */
export interface Planned {
  edits: Replacement[]
  places: Place[]
}

/** Every edit resolved against one text and turned into characters. Throws when an
 *  anchor does not name one place, and when two edits would change the same
 *  characters. Insertions at one place stay in the order they were asked. */
export function plan(
  asked: readonly AgentEdit[],
  text: string,
  selected: Selected | null = null,
): Planned {
  const places = asked.map((edit) => resolve(edit.at, text, selected))
  const edits = asked
    .map((edit, index) => {
      const place = places[index] ?? { from: 0, to: 0, shape: 'words' as const }
      return { index, change: placed(text, place, edit.doing) }
    })
    .sort(
      (one, other) =>
        one.change.from - other.change.from ||
        one.change.to - other.change.to ||
        one.index - other.index,
    )

  for (let at = 1; at < edits.length; at++) {
    const before = edits[at - 1]
    const after = edits[at]
    if (!before || !after || after.change.from >= before.change.to) continue

    throw new DocError(
      'overlapping',
      [asked[before.index]?.at, asked[after.index]?.at],
      'two of the edits change the same words',
    )
  }

  return { edits: edits.map((one) => one.change), places }
}
