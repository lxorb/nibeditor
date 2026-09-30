/** A plane's file as it was last written, and which characters of it the next
 *  write changes.
 *
 *  The file is the document's words, and the words live in a rope the editor
 *  package keeps with a history (see NoteDoc). Handing the rope seven megabytes of
 *  JSON and asking it what changed was a string of the whole rope, a walk of both
 *  from each end, and the middle built into lines: a hundred and fifty milliseconds
 *  for every stroke drawn on a plane of ten thousand. The writer already knows what
 *  it changed, because `canvasRuns` hands the file over in runs of pieces and a
 *  piece is the same string for as long as it is the same stroke, card or line of
 *  times. So each run is compared with the same run of the last write from both
 *  ends, piece by piece, and what is left between is one replacement: a stroke
 *  drawn is the stroke and the line saying when, and nothing else goes into the
 *  rope. */

export interface Replacement {
  from: number
  to: number
  insert: string
}

/** A write: its runs, how long each came to, and the file they join to. */
export interface Written {
  runs: readonly (readonly string[])[]
  sizes: readonly number[]
  text: string
}

export function written(runs: readonly (readonly string[])[]): Written {
  const texts = runs.map((run) => run.join(''))
  return { runs, sizes: texts.map((text) => text.length), text: texts.join('') }
}

/** What turns the file `before` was into the one `after` joins to, as one
 *  replacement per run that differs, in the offsets of the old file. Null where the
 *  two are not runs of the same layout, which is the caller's cue to compare the
 *  words. Costs a walk of references, and nothing measured past what changed. */
export function changesBetween(
  before: Written,
  after: readonly (readonly string[])[],
): Replacement[] | null {
  if (before.runs.length !== after.length) return null

  const out: Replacement[] = []
  let base = 0

  before.runs.forEach((was, run) => {
    const now = after[run] ?? []
    const size = before.sizes[run] ?? 0
    const shortest = Math.min(was.length, now.length)

    let front = 0
    let from = base
    while (front < shortest && was[front] === now[front]) from += was[front++]?.length ?? 0

    let back = 0
    let to = base + size
    while (back < shortest - front && was[was.length - 1 - back] === now[now.length - 1 - back]) {
      to -= was[was.length - 1 - back]?.length ?? 0
      back++
    }

    if (front + back < was.length || front + back < now.length) {
      out.push({ from, to, insert: now.slice(front, now.length - back).join('') })
    }
    base += size
  })

  return out
}
