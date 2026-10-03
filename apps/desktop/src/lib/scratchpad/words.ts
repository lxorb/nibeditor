/** What writing into the scratchpad does to its words. Pure; see pad.ts. */

/** Two bodies with one blank line between them, however the first ended: what
 *  appending a second thought to the first looks like. */
export function joined(first: string, second: string): string {
  const head = first.replace(/\s+$/, '')
  const tail = second.trim()
  if (!tail) return first
  if (!head) return `${tail}\n`
  return `${head}\n\n${tail}\n`
}

/** The one range two texts differ in, as an edit: what is the same at either end is
 *  left alone, so a caret in a tab showing the words stays where it was. */
export function difference(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  const most = Math.min(before.length, after.length)
  let head = 0
  while (head < most && before[head] === after[head]) head++
  let tail = 0
  while (tail < most - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++

  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }
}
