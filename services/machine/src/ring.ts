/** What a session printed, numbered by byte offset, with the last megabyte kept.
 *
 *  Every frame of output is named by `seq`, the offset of its first byte in everything
 *  the session ever printed, so a device that drew up to some offset says it, and is
 *  sent exactly the bytes after it - no frame counted twice, none missed, whatever was
 *  coalesced how. The ring keeps whole frames, dropping the oldest only while what is
 *  left still covers the limit, so a reconnect within the last megabyte is always
 *  answered from it and anything older is answered with a screen (docs/online-terminal.md
 *  4.6, _Joining late_). */

export const KEPT = 1024 * 1024

interface Chunk {
  seq: number
  bytes: Uint8Array
}

export class Ring {
  private chunks: Chunk[] = []
  private held = 0
  private readonly limit: number
  /** The offset after the last byte appended. */
  end: number

  constructor(start = 0, limit = KEPT) {
    this.end = start
    this.limit = limit
  }

  /** The oldest offset the ring can still answer from. */
  get start(): number {
    return this.chunks[0]?.seq ?? this.end
  }

  /** One frame of output; answers its `seq`. */
  append(bytes: Uint8Array): number {
    const seq = this.end
    if (bytes.length === 0) return seq
    this.chunks.push({ seq, bytes })
    this.held += bytes.length
    this.end += bytes.length
    while (this.chunks.length > 1 && this.held - (this.chunks[0]?.bytes.length ?? 0) >= this.limit) {
      this.held -= this.chunks.shift()?.bytes.length ?? 0
    }
    return seq
  }

  /** Everything after `since`, as one run of bytes; or null when part of it is gone, or
   *  `since` is not an offset this session has reached. */
  since(since: number): Uint8Array | null {
    if (!Number.isSafeInteger(since) || since < this.start || since > this.end) return null
    const out = new Uint8Array(this.end - since)
    let at = 0
    for (const chunk of this.chunks) {
      const from = Math.max(0, since - chunk.seq)
      if (from >= chunk.bytes.length) continue
      out.set(chunk.bytes.subarray(from), at)
      at += chunk.bytes.length - from
    }
    return out
  }
}
