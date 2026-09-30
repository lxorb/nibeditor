/** A contested passage as the question draws it: stretches of plain words and
 *  stretches in the highlight ink, in order.
 *
 *  The marks come from the classifier (`excerpt` in @nib/sync-core/diverge) and are
 *  offsets into the passage, but they crossed a boundary to get here - the engine, a
 *  store, a test's fake - so they are read as they are rather than as they should
 *  be: out of order, overlapping, past the end or empty, each is put right here,
 *  once, and the sheet draws whatever this answers. */

import type { Excerpt } from '@nib/sync-core/diverge'

interface Run {
  text: string
  marked: boolean
}

export function runsOf(excerpt: Excerpt): Run[] {
  const { text } = excerpt
  const spans = excerpt.marks
    .map(([from, to]) => [Math.max(0, from), Math.min(text.length, to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])

  const runs: Run[] = []
  let at = 0
  for (const [from, to] of spans) {
    // A span that starts inside the last one only adds what reaches past it.
    const start = Math.max(from, at)
    if (to <= start) continue
    if (start > at) runs.push({ text: text.slice(at, start), marked: false })

    const last = runs.at(-1)
    if (last?.marked && start === at) last.text += text.slice(start, to)
    else runs.push({ text: text.slice(start, to), marked: true })
    at = to
  }
  if (at < text.length) runs.push({ text: text.slice(at), marked: false })

  return runs
}
