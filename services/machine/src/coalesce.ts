/** Output handed on at most once a frame, and at once after a quiet one.
 *
 *  The local engine's sender (docs/terminal.md, _The engine_): a keystroke's echo is
 *  never held back, because the first read after a quiet frame goes out the moment it
 *  arrives, and a flood is sixty frames a second rather than one per read, because
 *  everything read inside a frame waits for the frame's end and goes as one. */

export const FRAME_MS = 16

export class Coalescer {
  private pending: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private last = -Infinity
  private readonly send: (bytes: Uint8Array) => void
  private readonly now: () => number

  constructor(send: (bytes: Uint8Array) => void, now: () => number = () => performance.now()) {
    this.send = send
    this.now = now
  }

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    this.pending.push(bytes)
    if (this.timer) return
    const wait = this.last + FRAME_MS - this.now()
    if (wait <= 0) this.flush()
    else this.timer = setTimeout(() => this.flush(), wait)
  }

  /** Everything waiting, now: before a screen is taken or the session is saved. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return
    const bytes = joined(this.pending)
    this.pending = []
    this.last = this.now()
    this.send(bytes)
  }
}

export function joined(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
