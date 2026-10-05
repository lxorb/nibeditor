/** The guesses of echo.ts drawn over an online terminal's screen: each typed character
 *  dim and underlined in its cell, and the caret after the last, while the terminal's
 *  own cursor waits where the machine last put it.
 *
 *  Drawn over xterm.js, never into it. VS Code writes its guesses into the terminal and
 *  undoes them with escape sequences when the real echo disagrees, and most of what has
 *  gone wrong with its local echo is that undoing. A layer of its own has nothing to
 *  undo: a guess that came true is taken away in the same frame the terminal draws the
 *  real character (`onRender`), and one that did not simply goes. */

import type { IDisposable, Terminal } from '@xterm/xterm'
import { type EchoScreen, Predictor } from './echo'

/** What marks the screen while guesses are drawn over it: the terminal's own cursor is
 *  hidden under it (TerminalTab.svelte), since the caret is drawn after the guesses. */
const ECHOING = 'nib-echoing'

export class LocalEcho {
  private readonly predictor = new Predictor(() => performance.now())
  private readonly layer = document.createElement('div')
  /** What it listens to, from the first key on: a terminal nobody types in costs
   *  nothing. */
  private listening: IDisposable[] | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  /** `may` is whether a shell's prompt can be in front: the session live, this window
   *  allowed to type, and no program the machine says runs. */
  constructor(
    private readonly term: Terminal,
    private readonly may: () => boolean,
  ) {
    this.layer.setAttribute('aria-hidden', 'true')
    Object.assign(this.layer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2',
    })
  }

  /** What was typed, the moment before it goes to the socket. */
  typed(data: string): void {
    this.listening ??= [
      this.term.onRender(() => {
        this.settle()
      }),
      this.term.onResize(() => {
        this.reset()
      }),
      this.term.buffer.onBufferChange(() => {
        this.reset()
      }),
    ]
    this.predictor.typed(data, this.screen(), this.allowed())
    this.draw()
    this.arm()
  }

  /** A new screen, put in place of the old: nothing guessed stands on it. */
  reset(): void {
    this.predictor.reset()
    this.draw()
  }

  dispose(): void {
    clearTimeout(this.timer)
    for (const one of this.listening ?? []) one.dispose()
    this.layer.remove()
  }

  /** The terminal drew: what it drew is checked against the guesses. */
  private settle(): void {
    this.predictor.check(this.screen(), this.allowed())
    this.draw()
    this.arm()
  }

  /** A guess not echoed in time is checked again then, and dropped. */
  private arm(): void {
    clearTimeout(this.timer)
    const deadline = this.predictor.deadline
    if (deadline === null) return
    this.timer = setTimeout(
      () => {
        this.settle()
      },
      Math.max(0, deadline - performance.now()) + 1,
    )
  }

  /** A prompt's screen at its foot: never the second screen of a full-screen program,
   *  and never while the reader has scrolled back, where the cursor is not in view. */
  private allowed(): boolean {
    const buffer = this.term.buffer.active
    return buffer.type === 'normal' && buffer.viewportY === buffer.baseY && this.may()
  }

  private screen(): EchoScreen {
    const buffer = this.term.buffer.active
    return {
      cols: this.term.cols,
      cursor: () => ({ x: buffer.cursorX, y: buffer.baseY + buffer.cursorY }),
      char: (x, y) => buffer.getLine(y)?.getCell(x)?.getChars() ?? '',
    }
  }

  private draw(): void {
    const shown = this.predictor.shown
    const element = this.term.element
    const screen = element?.querySelector<HTMLElement>('.xterm-screen')
    if (!shown.length || !element || !screen) {
      if (this.layer.isConnected) {
        this.layer.replaceChildren()
        this.layer.remove()
        element?.classList.remove(ECHOING)
      }
      return
    }

    const width = screen.clientWidth / this.term.cols
    const height = screen.clientHeight / this.term.rows
    const top = this.term.buffer.active.viewportY
    const { fontFamily, fontSize, theme, cursorWidth } = this.term.options
    const ink = theme?.foreground ?? 'currentColor'
    const cell = (x: number, y: number) => ({
      position: 'absolute',
      left: `${String(x * width)}px`,
      top: `${String((y - top) * height)}px`,
      width: `${String(width)}px`,
      height: `${String(height)}px`,
    })

    const drawn: HTMLElement[] = shown.map((guess) => {
      const one = document.createElement('span')
      one.textContent = guess.char
      Object.assign(one.style, cell(guess.x, guess.y), {
        lineHeight: `${String(height)}px`,
        fontFamily: fontFamily ?? 'monospace',
        fontSize: `${String(fontSize ?? 13)}px`,
        color: ink,
        opacity: '0.6',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        whiteSpace: 'pre',
      })
      return one
    })
    const last = shown.at(-1)
    if (last) {
      const caret = document.createElement('span')
      Object.assign(caret.style, cell(last.x + 1, last.y), {
        width: `${String(cursorWidth ?? 2)}px`,
        background: theme?.cursor ?? ink,
      })
      drawn.push(caret)
    }
    this.layer.replaceChildren(...drawn)
    if (this.layer.parentElement !== screen) screen.append(this.layer)
    element.classList.add(ECHOING)
  }
}
