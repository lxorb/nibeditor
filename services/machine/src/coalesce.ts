/** Output handed on at most once a frame, and at once after a quiet one or a key.
 *
 *  The local engine's sender (docs/terminal.md, _The engine_): a keystroke's echo is
 *  never held back, because the first read after a quiet frame goes out the moment it
 *  arrives, and a flood is sixty frames a second rather than one per read, because
 *  everything read inside a frame waits for the frame's end and goes as one.
 *
 *  A frame is not always quiet when a key is typed: a program redrawing a spinner, a
 *  build printing, or the echo of the key before it can each have sent something a few
 *  milliseconds ago, and the echo would wait out the rest of that frame - up to 16 ms on
 *  top of the round trip, on every key. So a key buys its echo the right to go at once:
 *  the next couple of reads within a short while of it are sent as they come, and only
 *  after those does output wait for frames again, so a flood that a key started (Enter
 *  on `cat`) is coalesced from its third read on. */

export const FRAME_MS = 16

/** How long after a key its echo still goes at once, and in how many sends: the echo,
 *  and a line editor's redraw of the rest of the line after it. */
export const ECHO_MS = 50
export const ECHO_SENDS = 2

export class Coalescer {
  private pending: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private last = -Infinity
  /** Until when, and for how many more sends, output goes at once for a key. */
  private echoUntil = -Infinity
  private echoes = 0
  private readonly send: (bytes: Uint8Array) => void
  private readonly now: () => number

  constructor(send: (bytes: Uint8Array) => void, now: () => number = () => performance.now()) {
    this.send = send
    this.now = now
  }

  /** A key went to the pty: what it prints next is its echo. */
  typed(): void {
    this.echoUntil = this.now() + ECHO_MS
    this.echoes = ECHO_SENDS
  }

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    this.pending.push(bytes)
    if (this.echoes > 0 && this.now() <= this.echoUntil) {
      this.echoes -= 1
      this.flush()
      return
    }
    if (this.timer) return
    const wait = this.last + FRAME_MS - this.now()
    if (wait <= 0) this.flush()
    else this.timer = setTimeout(() => this.flush(), wait)
  }

  /** What is waiting, now, or its first `count` bytes and the rest at the next frame:
   *  before a screen is taken or the session is saved. */
  flush(count = Infinity): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return
    const all = joined(this.pending)
    const bytes = count < all.length ? all.subarray(0, count) : all
    this.pending = bytes === all ? [] : [all.subarray(bytes.length)]
    if (this.pending.length > 0) this.timer = setTimeout(() => this.flush(), FRAME_MS)
    if (bytes.length === 0) return
    this.last = this.now()
    this.send(bytes)
  }
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
