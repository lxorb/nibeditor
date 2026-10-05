/** Predictive local echo for an online terminal: the characters typed at a shell prompt
 *  shown the moment they are typed, dim and underlined, until the machine's own echo
 *  draws them for real (docs/online-terminal.md 4.12).
 *
 *  A key in an online terminal travels to the machine and back before it is on the
 *  screen: tens of milliseconds from Zurich, and on a train or a plane's wifi half a
 *  second, which is what makes typing feel like wading. mosh's answer, and VS Code's
 *  "local echo" for remote terminals after it, is to guess: a printable character typed
 *  at a prompt is almost always echoed where the cursor is, so it can be drawn there at
 *  once and checked when the real echo comes. This is that guess, with their rules:
 *
 *  - **Only when it is worth it**: shown once the measured echo is 30 ms or slower and
 *    hidden again under 20 (mosh's thresholds; VS Code's `localEchoLatencyThreshold`
 *    is the same 30), from the median of the last 24 echoes, and only while most
 *    guesses come true.
 *  - **Never a password**: after anything but a printable key - Enter, an arrow, a
 *    control key - and after any wrong guess, the next character is a probe that is
 *    checked but not shown. Only once the machine has echoed one is anything after it
 *    drawn ahead. A prompt that echoes nothing never gets that far.
 *  - **Never on somebody else's screen**: only the printable ASCII a shell's line editor
 *    echoes one cell each, never past the end of the line, and only over a blank cell
 *    or the same character (a suggestion being typed out); typing into the middle of a
 *    line shifts what is after it, which is the shell's to draw. Whether a prompt is in
 *    front at all - not a full-screen program, not a program the machine says runs - is
 *    the caller's to say.
 *  - **Wrong is cheap**: a guess the screen does not bear out, or one not echoed in time,
 *    drops every guess at once, and nothing was ever written into the terminal itself:
 *    the guesses are drawn over it (echo-view.ts), so there is no screen to repair.
 *
 *  Pure: the screen and the clock are the caller's, so the tests drive it with fakes. */

/** The screen as the guesses read it: the cursor, and what a cell holds, by absolute
 *  line (the scrollback's lines counted too, so a scroll moves nothing). */
export interface EchoScreen {
  readonly cols: number
  cursor(): { x: number; y: number }
  /** The character in a cell; empty for a blank one. */
  char(x: number, y: number): string
}

/** One character typed and expected on the screen. */
export interface Guess {
  x: number
  y: number
  char: string
  /** When it was typed. */
  at: number
  /** Over a cell that held something else: the line shifts, so only the cursor passing it
   *  is checked, and it is never shown. */
  blind: boolean
}

/** Echoes at least this slow are guessed ahead of; under the lower one they stop being. */
export const SHOW_FROM = 30
export const HIDE_UNDER = 20
/** How many echoes are kept for the median, and how many it takes to decide. */
const SAMPLES = 24
const DECIDES = 5
/** The share of guesses that must come true for any to be shown. */
const ACCURATE = 0.3
/** How long a guess waits for its echo before every guess is dropped: half again the
 *  slowest echo measured, and never under half a second. */
const PATIENCE = 500

export class Predictor {
  private guesses: Guess[] = []
  /** Whether the machine has echoed a guess since the last thing that made the screen
   *  unpredictable: until it has, guesses are checked but not shown. */
  private trusted = false
  /** A key that was not guessed is on its way - not printable, or at the line's end:
   *  nothing more is guessed until every guess before it is settled, and the first key
   *  after them is a probe again, since where the cursor goes next is the shell's to
   *  say. What was guessed before it stays drawn until then. */
  private sealed = false
  private readonly latencies: number[] = []
  private readonly outcomes: boolean[] = []
  /** Whether the echo is slow enough to be worth guessing ahead of. */
  private worth = false

  constructor(private readonly now: () => number) {}

  /** What the person typed, as xterm.js said it. `may` is whether a shell's prompt is in
   *  front; without one every guess is dropped. */
  typed(data: string, screen: EchoScreen, may: boolean): void {
    if (!may) {
      this.drop()
      return
    }
    for (const char of data) {
      if (this.sealed) continue
      const last = this.guesses.at(-1)
      const { x, y } = last ? { x: last.x + 1, y: last.y } : screen.cursor()
      // Enter, Backspace, an arrow, a control key, a paste's brackets; or the last
      // column, where the shell wraps or a line editor scrolls the line.
      if (!printable(char) || x >= screen.cols - 1) {
        this.seal()
        continue
      }
      const under = screen.char(x, y)
      const blind = under !== '' && under !== ' ' && under !== char
      this.guesses.push({ x, y, char, at: this.now(), blind })
    }
  }

  /** The screen changed: guesses the cursor has passed are checked against it. Answers
   *  whether what is shown changed. */
  check(screen: EchoScreen, may: boolean): boolean {
    if (!may) return this.drop()
    const before = this.guesses.length
    const cursor = screen.cursor()
    while (this.guesses.length) {
      const guess = this.guesses[0]
      if (!guess) break
      if (cursor.y < guess.y) return this.wrong()
      const passed = cursor.y > guess.y || cursor.x > guess.x
      if (!passed) break
      if (!guess.blind && screen.char(guess.x, guess.y) !== guess.char) return this.wrong()
      this.guesses.shift()
      // Typed into a line: what follows is the shell's to place, checked by a probe.
      if (guess.blind) this.trusted = false
      else this.right(this.now() - guess.at)
    }
    if (!this.guesses.length && this.sealed) {
      this.sealed = false
      this.trusted = false
    }
    const oldest = this.guesses[0]
    if (oldest && this.now() - oldest.at > this.patience()) return this.wrong()
    return this.guesses.length !== before
  }

  /** The guesses to draw now, in order: none until the echo is slow and one came true. */
  get shown(): readonly Guess[] {
    if (!this.trusted || !this.worth) return []
    const blind = this.guesses.findIndex((guess) => guess.blind)
    return blind < 0 ? this.guesses : this.guesses.slice(0, blind)
  }

  /** When the oldest guess runs out of time, for the caller's timer; null for none. */
  get deadline(): number | null {
    const oldest = this.guesses[0]
    return oldest ? oldest.at + this.patience() : null
  }

  /** The median echo measured, in milliseconds; null before any. */
  get latency(): number | null {
    if (!this.latencies.length) return null
    const sorted = [...this.latencies].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? null
  }

  /** Everything guessed, forgotten: a new screen, a new size. What was measured stays. */
  reset(): void {
    this.drop()
  }

  private seal(): void {
    if (this.guesses.length) this.sealed = true
    else this.trusted = false
  }

  private patience(): number {
    return Math.max(PATIENCE, Math.max(0, ...this.latencies) * 1.5)
  }

  private right(latency: number): void {
    this.trusted = true
    keep(this.latencies, latency)
    keep(this.outcomes, true)
    this.decide()
  }

  private wrong(): boolean {
    keep(this.outcomes, false)
    this.decide()
    this.drop()
    return true
  }

  /** Answers whether anything was shown, which then is not. */
  private drop(): boolean {
    const shown = this.shown.length > 0
    this.guesses = []
    this.trusted = false
    this.sealed = false
    return shown
  }

  private decide(): void {
    const median = this.latency
    const right = this.outcomes.filter(Boolean).length
    if (
      this.outcomes.length < DECIDES ||
      median === null ||
      right / this.outcomes.length < ACCURATE
    ) {
      this.worth = false
    } else if (median >= SHOW_FROM) {
      this.worth = true
    } else if (median < HIDE_UNDER) {
      this.worth = false
    }
  }
}

/** A key a line editor echoes as itself in one cell: printable ASCII, as VS Code's. */
function printable(char: string): boolean {
  const code = char.charCodeAt(0)
  return char.length === 1 && code >= 0x20 && code <= 0x7e
}

function keep<T>(list: T[], value: T): void {
  list.push(value)
  if (list.length > SAMPLES) list.shift()
}
