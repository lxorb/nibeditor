import { taskAt } from '@nib/markdown/tasks'
import type { Hit, Range } from './match'

/** The task a hit's line is, or null for a line that is not one: whether it is
 *  done, and the words after the marker with what matched moved along with them.
 *  What the Search panel and a query fence both draw a live box in front of.
 *
 *  Apart from match.ts because a query fence in the note on screen draws its rows
 *  with it, and the matcher is behind the Search panel's door; see query-block.ts. */
export function taskOf(hit: Hit): { done: boolean; text: string; ranges: Range[] } | null {
  const task = taskAt(hit.text)
  if (!task) return null

  return {
    done: task.done,
    text: hit.text.slice(task.marker),
    ranges: hit.ranges
      .map((range) => ({ from: range.from - task.marker, to: range.to - task.marker }))
      .filter((range) => range.to > 0)
      .map((range) => ({ from: Math.max(range.from, 0), to: range.to })),
  }
}
