/** One agent's edits of one note, kept so that all of them can be taken back at once
 *  without taking back a word the reader wrote in between.
 *
 *  The bookkeeping is CodeMirror's own history's (`@codemirror/commands`), over the
 *  edits of one agent instead of every edit: each step holds the change that takes it
 *  back, correct for the words as they would be with every later step taken back
 *  first. A change that is not one of these steps - the reader typing, another agent,
 *  another device - is carried into the newest step at once, and into the ones under
 *  it only when the one above them goes, as `mapped`. That is what makes it right
 *  when two of an agent's edits touch the same words: taking back the newest first
 *  and then the one before, each through what happened after it, never leaves a
 *  character of the first behind in the hole the second left.
 *
 *  Yjs's `UndoManager` with the agent as its tracked origin is the same thing, and it
 *  is what these become under sync v2; see docs/agent-native.md 8.10. Pure. */

import { ChangeSet, type Heard, type Text } from '@nib/editor'

type ChangeDesc = ChangeSet['desc']

/** A span of words, in the offsets of one text. */
interface Range {
  from: number
  to: number
}

/** Where a change wrote, in the words after it: what it put in, and a point where it
 *  only took words out. */
function written(change: ChangeSet): Range[] {
  const ranges: Range[] = []
  change.iterChangedRanges((_fromA, _toA, from, to) => ranges.push({ from, to }))
  return ranges
}

/** A span carried through a change after it. */
function mapped(range: Range, change: ChangeSet): Range {
  const from = change.mapPos(range.from, 1)
  return { from, to: Math.max(from, change.mapPos(range.to, -1)) }
}

/** Whether a change rewrites any of the words in `ranges`, in the words before it: it
 *  takes out or replaces some of them, or writes into the middle of them. Writing
 *  right beside them is not rewriting them. */
function touches(change: ChangeSet, ranges: readonly Range[]): boolean {
  let met = false
  change.iterChangedRanges((from, to) => {
    for (const range of ranges) {
      if (from === to ? range.from < from && from < range.to : from < range.to && range.from < to)
        met = true
    }
  })
  return met
}

interface Step {
  /** The marks the edits carried into the reader's history, which say when the
   *  reader's own Ctrl+Z has taken them back. */
  ids: readonly string[]
  /** What takes it back. */
  changes: ChangeSet
  /** What happened after it that the steps under it have not been carried through,
   *  as seen from the words with this step taken back. */
  mapped: ChangeDesc | null
}

/** One step carried through a change made after it. */
function carried(step: Step, mapping: ChangeDesc): Step {
  const before = mapping.mapDesc(step.changes, true)
  return {
    ids: step.ids,
    changes: step.changes.map(mapping),
    mapped: step.mapped ? step.mapped.composeDesc(before) : before,
  }
}

/** A change carried into the newest step, and a step it emptied dropped, the next one
 *  down taking its place: `addMappingToBranch` in CodeMirror's history. */
function carriedInto(steps: readonly Step[], mapping: ChangeDesc): Step[] {
  let length = steps.length
  let through = mapping

  while (length) {
    const top = steps[length - 1]
    if (!top) break

    const step = carried(top, through)
    if (!step.changes.empty) return [...steps.slice(0, length - 1), step]

    // Nothing of it left to take back: whatever it did is gone already.
    through = step.mapped ?? through
    length--
  }

  return []
}

export class Steps {
  private steps: Step[] = []
  /** The steps the reader's own Ctrl+Z took back, which their redo brings back. */
  private readonly undone = new Set<string>()

  /** How many edits there are to take back. */
  get size(): number {
    return this.steps.length
  }

  /** An edit of this agent's, just made: the change it was, and the words before it. */
  push(ids: readonly string[], changes: ChangeSet, before: Text) {
    this.steps.push({ ids, changes: changes.invert(before), mapped: null })
  }

  /** A change made after the steps that is not one of them. */
  carry(change: ChangeDesc) {
    if (change.empty || !this.steps.length) return
    this.steps = carriedInto(this.steps, change)
  }

  /** A change as a document heard it. Answers whether it was one of these steps being
   *  taken back or put back by the reader's history, which is the history's business
   *  and not a change to carry the steps through. */
  heard(heard: Heard): boolean {
    const back = heard.marks.filter((mark) => mark.undone).map((mark) => mark.id)
    const again = heard.marks.filter((mark) => !mark.undone).map((mark) => mark.id)

    const top = this.steps.at(-1)
    if (top && back.length && back.some((id) => top.ids.includes(id))) {
      this.pop()
      for (const id of top.ids) this.undone.add(id)
      return true
    }

    if (again.length && again.every((id) => this.undone.has(id))) {
      for (const id of again) this.undone.delete(id)
      this.steps.push({ ids: again, changes: heard.changes.invert(heard.before), mapped: null })
      return true
    }

    return false
  }

  /** Every step taken back, newest first, as one change, and forgotten. Null when
   *  there is nothing to take back. The ids come with it, so the change can carry
   *  them into the history and a Ctrl+Z of the whole of it puts them all back. */
  takeAll(): { changes: ChangeSet; ids: string[] } | null {
    let total: ChangeSet | null = null
    const ids: string[] = []

    for (let top = this.pop(); top; top = this.pop()) {
      total = total ? total.compose(top.changes) : top.changes
      ids.push(...top.ids)
    }

    for (const id of ids) this.undone.add(id)
    return total ? { changes: total, ids } : null
  }

  /** The ids of every step there is to take back, oldest first. */
  get ids(): string[] {
    return this.steps.flatMap((step) => [...step.ids])
  }

  /** Some of the steps taken back and the rest left standing, as one change against
   *  `words` (what the note says now), and forgotten: the review's Undo of one change,
   *  and a rewind of one thread's edits among another's.
   *
   *  Done the way a history would do it by hand: every step down to the lowest one
   *  asked for is taken back, then each one above it that was not asked for is put
   *  back again, carried through what was taken out underneath it. A step put back
   *  that touches the words a taken one wrote depends on it - it rewrote them - and
   *  is taken too rather than put back on top of nothing; the ids answered say which
   *  went. Where nothing touches, this is each taken step's inverse carried through
   *  everything since, so every later word, the reader's and the agent's, stays. */
  take(wanted: ReadonlySet<string>, words: Text): { changes: ChangeSet; ids: string[] } | null {
    const lowest = this.steps.findIndex((step) => step.ids.some((id) => wanted.has(id)))
    if (lowest === -1) return null

    // Down to the lowest asked for, each with the words it takes back from.
    const popped: { step: Step; at: Text }[] = []
    let doc = words
    let total = ChangeSet.empty(words.length)
    while (this.steps.length > lowest) {
      const top = this.pop()
      if (!top) break
      popped.push({ step: top, at: doc })
      total = total.compose(top.changes)
      doc = top.changes.apply(doc)
    }

    // Back up again, oldest first. `toNow` turns the words as they were with this
    // step in place into what they are now; `hot` is where taken steps wrote, in the
    // same words.
    const taken: string[] = []
    const again: { ids: readonly string[]; changes: ChangeSet; before: Text }[] = []
    let toNow = ChangeSet.empty(doc.length)
    let hot: { from: number; to: number }[] = []
    let now = doc
    for (const { step, at } of popped.reverse()) {
      const forward = step.changes.invert(at)
      const asked = step.ids.some((id) => wanted.has(id))
      if (asked || touches(forward, hot)) {
        taken.push(...step.ids)
        hot = [...hot.map((range) => mapped(range, forward)), ...written(forward)]
        toNow = step.changes.compose(toNow)
        continue
      }

      const carried = forward.map(toNow)
      again.push({ ids: step.ids, changes: carried, before: now })
      total = total.compose(carried)
      now = carried.apply(now)
      toNow = toNow.map(forward, true)
      hot = hot.map((range) => mapped(range, forward))
    }

    for (const one of again) this.push(one.ids, one.changes, one.before)
    for (const id of taken) this.undone.add(id)
    return { changes: total, ids: taken }
  }

  private pop(): Step | null {
    const top = this.steps.at(-1)
    if (!top) return null

    const rest = this.steps.slice(0, -1)
    this.steps = top.mapped ? carriedInto(rest, top.mapped) : rest
    return top
  }
}
