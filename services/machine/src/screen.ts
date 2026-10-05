/** A session's screen kept as a headless xterm.js, and written out whole.
 *
 *  The same `@xterm/headless` and serialise addon the app's xterm.js reads, at the same
 *  Unicode version and scrollback, so a screen sent is a screen drawn byte for byte: a
 *  late joiner is sent this instead of a ring of raw output, whose half-escapes a
 *  full-screen program would draw as garbage (Replit's lesson, 4.6).
 *
 *  Writes are parsed in order, and a write's callback runs once everything before it
 *  is parsed and nothing after it is, so a screen taken in a callback is exactly the
 *  screen at that write's end. `at` is how a screen is matched to its `seq`. */

import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import headless from '@xterm/headless'
import { SCROLLBACK } from '@nib/online/wire'

const { Terminal } = headless

export class Screen {
  readonly term: InstanceType<typeof Terminal>
  private readonly serializer = new SerializeAddon()
  /** The title the program in front set, if any. */
  title: string | null = null

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(this.serializer)
    this.term.onTitleChange((title) => {
      this.title = title || null
    })
  }

  get cols(): number {
    return this.term.cols
  }

  get rows(): number {
    return this.term.rows
  }

  write(data: Uint8Array | string): void {
    this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  /** The whole screen once everything written so far is parsed: the scrollback, the
   *  colours, the cursor, the second screen and every mode a program switched on. */
  serialized(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        resolve(evenColours(this.serializer.serialize({ scrollback: SCROLLBACK })))
      })
    })
  }

  /** The normal screen alone, for a save: a program on the second screen does not
   *  survive the sleep, so its screen is not drawn back either. */
  saved(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        resolve(
          this.serializer.serialize({
            scrollback: SCROLLBACK,
            excludeModes: true,
            excludeAltBuffer: true,
          }),
        )
      })
    })
  }

  dispose(): void {
    this.term.dispose()
  }
}

/** Where the serialise addon goes from the first screen to the second. */
const TO_SECOND = '\x1b[?1049h\x1b[H'

/** The addon ends the first screen with the colours the cursor has now and only then
 *  switches to the second, so a program that had set a colour when the screen was
 *  taken has the whole of its second screen redrawn in that colour, and the first
 *  screen's saved cursor wears it too. The colours are reset at the switch; the
 *  addon sets the cursor's own again at the very end. */
export function evenColours(serialized: string): string {
  const at = serialized.indexOf(TO_SECOND)
  return at < 0 ? serialized : `${serialized.slice(0, at)}\x1b[0m${serialized.slice(at)}`
}
