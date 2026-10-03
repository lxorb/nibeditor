/** What `@` can attach (docs/ai-sidebar.md 4.2), and which of it a few typed letters
 *  mean. The candidates are built by the panel from the space; this file only ranks
 *  them, the way quick open ranks a note's name, so it is pure and tested alone. */

import { fit } from '../../search/fuzzy'

/** The kinds of thing a chip can be. `note` and `selection` are also the two the
 *  panel offers on its own, dim, for the note in front. */
export type MentionKind =
  | 'note'
  | 'folder'
  | 'tag'
  | 'tab'
  | 'selection'
  | 'scratchpad'
  | 'thread'
  | 'web'
  | 'picture'
  /** Words fixed as they were: a selection quoted with Alt+K, a text file dropped. */
  | 'words'

export interface Mention {
  kind: MentionKind
  /** A note's or a folder's path, a tag, a tab's or a thread's id; the kind for the
   *  ones there is only one of. */
  id: string
  /** What the row and the chip call it. */
  label: string
  /** The word the reader may type for it besides its label: `selection`, `web`. */
  word?: string
  /** A picture's bytes, base64, and its type. */
  image?: { mime: string; data: string }
  /** The words of a `words` chip. */
  text?: string
}

/** One row of the list over the field, a mention's or a command's. */
export interface Row {
  key: string
  label: string
  /** A second word, quieter: a command's synonyms or arguments, a note's folder. */
  hint?: string
  mark?: MentionKind
  /** Why it cannot be taken, where it cannot. */
  dim?: string
}

/** How many rows the menu shows: enough to pick from, few enough to read at a glance. */
const MOST = 8

function scoreOf(mention: Mention, query: string): number | null {
  const scores = [mention.label, mention.word ?? '']
    .filter(Boolean)
    .map((text) => {
      const found = fit(query, text)
      if (!found) return null
      // A name that starts with what was typed is what was meant, ahead of a looser
      // fit anywhere in a longer name.
      const starts = text.toLowerCase().startsWith(query.toLowerCase()) ? 1_000 : 0
      return found.score + starts
    })
    .filter((one): one is number => one !== null)
  return scores.length ? Math.max(...scores) : null
}

/** The candidates for what follows `@`, best first. Nothing typed keeps the order they
 *  were handed in, which puts the ones there is one of and the open tabs first. */
export function ranked(candidates: readonly Mention[], query: string, most = MOST): Mention[] {
  const typed = query.trim()
  if (!typed) return candidates.slice(0, most)
  return candidates
    .map((one, at) => ({ one, at, score: scoreOf(one, typed) }))
    .filter((row): row is { one: Mention; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, most)
    .map((row) => row.one)
}

/** The `@` being typed at the caret, and where it starts, or null where the caret is
 *  not in one: an `@` at the start or after a space, and no space since. */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret)
  const found = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (!found) return null
  const query = found[1] ?? ''
  return { from: caret - query.length - 1, query }
}

/** The same chip twice is one chip. */
export function sameMention(one: Mention, other: Mention): boolean {
  return one.kind === other.kind && one.id === other.id
}
