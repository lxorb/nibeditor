/** A task's words as the hash its anchor carries, in a file of its own so a page that
 *  only reads task lines does not carry the YAML parser beside it. */

/** A short hash of a task's words, FNV-1a in base 36: what an anchor carries to
 *  find its line again when lines above it moved. Words, not the line, so ticking
 *  the box or moving a date keeps the anchor. */
export function taskHash(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
