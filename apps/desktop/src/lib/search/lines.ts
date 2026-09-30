/** A note's lines as offsets, which the matcher, a replacement and the text a note
 *  is kept as all count in. Apart from match.ts because only the last of those is in
 *  front of the first paint: the store that keeps what each note says asks where its
 *  lines start, and the matcher itself is behind the Search panel's door. */

/** Where every line of a note starts. Built once per note that has a hit. */
export function lineStarts(body: string): number[] {
  const starts = [0]
  for (let at = body.indexOf('\n'); at !== -1; at = body.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }

  return starts
}

/** Which line an offset is on. A search rather than a walk, because a replace
 *  asks it once per match and a note can be long. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }

  return low
}
