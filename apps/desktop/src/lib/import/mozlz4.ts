/** The file format Firefox, and every browser built on it, keeps its session in.
 *
 *  `mozLz40\0`, the length of what is inside as four little-endian bytes, and then
 *  one LZ4 block: not the LZ4 frame format the command-line tool writes, which is
 *  why no ordinary decompressor opens a `.jsonlz4`. Zen's `zen-sessions.jsonlz4`
 *  and Firefox's `recovery.jsonlz4` are both this.
 *
 *  Decoded here rather than in the crate, so the crate only hands over the bytes of
 *  a file it has judged and the reading is a pure function a test can hold. The
 *  block format is small enough to say in a page: a token whose two halves are how
 *  many bytes to copy as they are and how long a match is, the literals, then two
 *  bytes saying how far back the match starts. A match may overlap what it is
 *  writing, which is how LZ4 says a run. */

/** The eight bytes every such file opens with. */
const MAGIC = [0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00]

/** More than any session anybody's browser keeps. A header that says more is a
 *  file that is not one, and a webview asked to hold it takes the window down. */
const MOST_BYTES = 256 * 1024 * 1024

/** The shortest match LZ4 writes; a token's match half counts from here. */
const SHORTEST_MATCH = 4

/** What a `.jsonlz4` holds. Throws for anything that is not one, or that is cut
 *  short: a session half written is not a session to import from. */
export function unmozLz4(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || MAGIC.some((byte, at) => bytes[at] !== byte)) {
    throw new Error('not a mozLz4 file')
  }

  const size = new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, true)
  if (size > MOST_BYTES) throw new Error('a mozLz4 file larger than any session')

  return lz4Block(bytes.subarray(12), size)
}

/** One LZ4 block, decoded into exactly `size` bytes. */
export function lz4Block(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let from = 0
  let to = 0

  /** A length that ran past its half of the token: bytes added until one is not 255. */
  const longer = (length: number): number => {
    let more = 255
    while (more === 255) {
      if (from >= input.length) throw new Error('a mozLz4 block cut short')
      more = input[from++] ?? 0
      length += more
    }
    return length
  }

  while (from < input.length) {
    const token = input[from++] ?? 0

    let literals = token >> 4
    if (literals === 15) literals = longer(literals)
    if (from + literals > input.length || to + literals > size) {
      throw new Error('a mozLz4 block cut short')
    }
    out.set(input.subarray(from, from + literals), to)
    from += literals
    to += literals

    // The last sequence is literals alone.
    if (from >= input.length) break

    if (from + 2 > input.length) throw new Error('a mozLz4 block cut short')
    const back = (input[from] ?? 0) | ((input[from + 1] ?? 0) << 8)
    from += 2
    if (back === 0 || back > to) throw new Error('a mozLz4 block pointing before itself')

    let length = token & 15
    if (length === 15) length = longer(length)
    length += SHORTEST_MATCH
    if (to + length > size) throw new Error('a mozLz4 block longer than it says')

    // Byte by byte, because a match may start inside what it is copying.
    for (let at = 0; at < length; at++, to++) out[to] = out[to - back] ?? 0
  }

  if (to !== size) throw new Error('a mozLz4 block shorter than it says')
  return out
}
