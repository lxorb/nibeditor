/** Where in a stream of terminal output a screen may be taken.
 *
 *  A pty is read in whatever pieces the kernel hands over, and a piece may end inside an
 *  escape sequence or a UTF-8 character. A screen serialised there would lose the half
 *  that was parsed - the parser's state is not part of any screen - and the joiner would
 *  draw the other half as text. So the stream is followed by this small parser, which
 *  knows only where sequences begin and end (ECMA-48's shapes, as xterm.js reads them),
 *  and a screen is taken only at a point where it stands in the ground state between
 *  two whole characters. */

const GROUND = 0
const ESCAPE = 1
const CSI = 2
/** OSC, DCS, SOS, PM and APC: a string ended by BEL or ST. */
const TEXT = 3
/** An ESC inside a string: the start of ST, or of a new sequence. */
const TEXT_ESCAPE = 4
type State = typeof GROUND | typeof ESCAPE | typeof CSI | typeof TEXT | typeof TEXT_ESCAPE

const ESC = 0x1b
const BEL = 0x07
const CAN = 0x18
const SUB = 0x1a

export class Scanner {
  private state: State = GROUND
  /** UTF-8 continuation bytes still to come. */
  private more = 0
  /** The offset after the last byte at which a screen could be taken. */
  safe = 0
  /** Offsets fed so far. */
  private at = 0

  feed(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.step(byte)
      this.at += 1
      if (this.state === GROUND && this.more === 0) this.safe = this.at
    }
  }

  private step(byte: number): void {
    if (byte === CAN || byte === SUB) {
      this.state = GROUND
      this.more = 0
      return
    }
    switch (this.state) {
      case GROUND:
        if (this.more > 0 && (byte & 0xc0) === 0x80) {
          this.more -= 1
          return
        }
        this.more = 0
        if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0xf0 && byte <= 0xf7) this.more = 3
        else if (byte >= 0xe0) this.more = byte <= 0xef ? 2 : 0
        else if (byte >= 0xc2) this.more = byte <= 0xdf ? 1 : 0
        return
      case ESCAPE:
        if (byte === 0x5b) this.state = CSI
        else if (
          byte === 0x5d ||
          byte === 0x50 ||
          byte === 0x58 ||
          byte === 0x5e ||
          byte === 0x5f
        ) {
          this.state = TEXT
        } else if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0x30 && byte <= 0x7e) this.state = GROUND
        // Intermediates and C0 controls keep the sequence open.
        return
      case CSI:
        if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0x40 && byte <= 0x7e) this.state = GROUND
        return
      case TEXT:
        if (byte === BEL) this.state = GROUND
        else if (byte === ESC) this.state = TEXT_ESCAPE
        return
      case TEXT_ESCAPE:
        if (byte === 0x5c) this.state = GROUND
        else {
          this.state = ESCAPE
          this.step(byte)
        }
        return
    }
  }
}
