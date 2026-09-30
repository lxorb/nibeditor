/** Which words a note holds, as a short name that changes whenever they do.
 *
 *  What an agent reads with a note and hands back with an edit as `if_rev`, so the
 *  edit is refused if anything changed in between. A hash of the words rather than a
 *  counter, because the same note is read open and edited closed, or the other way
 *  round, and a counter belongs to one document while the words belong to the note:
 *  the name is the same whether the words came off the screen or the disk, and a
 *  note put back to exactly what it said is exactly the words the agent read.
 *
 *  Fifty-three bits of cyrb53, which is plenty for telling one version of one note
 *  from the next and costs one pass over the words. */

export function revOf(words: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57

  for (let at = 0; at < words.length; at++) {
    const code = words.charCodeAt(at)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
