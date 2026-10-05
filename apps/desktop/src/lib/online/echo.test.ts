import { describe, expect, test } from 'vitest'
import { type EchoScreen, HIDE_UNDER, Predictor, SHOW_FROM } from './echo'

/** A screen that prints what the machine would: characters at the cursor, a newline
 *  down to the next line's start. */
class Screen implements EchoScreen {
  cols = 40
  private readonly lines: string[][] = [[]]
  x = 0
  y = 0

  cursor() {
    return { x: this.x, y: this.y }
  }

  char(x: number, y: number) {
    return this.lines[y]?.[x] ?? ''
  }

  print(text: string) {
    for (const char of text) {
      if (char === '\n') {
        this.y += 1
        this.x = 0
        this.lines[this.y] ??= []
        continue
      }
      ;(this.lines[this.y] ??= [])[this.x] = char
      this.x += 1
    }
  }

  /** Something on the screen after the cursor that is not typed: a suggestion. */
  ahead(text: string) {
    const line = (this.lines[this.y] ??= [])
    for (let at = 0; at < text.length; at++) line[this.x + at] = text.charAt(at)
  }
}

function world() {
  let now = 0
  const screen = new Screen()
  const predictor = new Predictor(() => now)
  const pass = (ms: number) => (now += ms)
  const shown = () => predictor.shown.map((guess) => guess.char).join('')
  /** Keys typed one by one, each echoed after `latency`. */
  const typeEchoed = (text: string, latency: number) => {
    for (const char of text) {
      predictor.typed(char, screen, true)
      pass(latency)
      screen.print(char)
      predictor.check(screen, true)
    }
  }
  return { screen, predictor, pass, shown, typeEchoed }
}

/** A link measured slow: enough echoes at `latency` that guessing ahead is worth it,
 *  then Enter and a fresh prompt. */
function slow(latency = 120) {
  const it = world()
  it.screen.print('$ ')
  it.typeEchoed('echo hi', latency)
  it.predictor.typed('\r', it.screen, true)
  it.pass(latency)
  it.screen.print('\nhi\n$ ')
  it.predictor.check(it.screen, true)
  return it
}

describe('predictive echo', () => {
  test('a fast link is never guessed ahead of', () => {
    const { predictor, screen, shown, typeEchoed } = world()
    typeEchoed('echo hi there', 5)
    predictor.typed('abc', screen, true)
    expect(shown()).toBe('')
  })

  test('on a slow link the first key after Enter is a hidden probe, then keys show at once', () => {
    const { predictor, screen, pass, shown } = slow()
    expect(predictor.latency).toBe(120)

    predictor.typed('l', screen, true)
    expect(shown()).toBe('')
    predictor.typed('s', screen, true)
    expect(shown()).toBe('')

    // The probe's echo: the machine echoes, so what follows it is drawn ahead.
    pass(120)
    screen.print('l')
    predictor.check(screen, true)
    expect(shown()).toBe('s')
    predictor.typed(' -la', screen, true)
    expect(shown()).toBe('s -la')
    expect(predictor.shown.map((guess) => guess.x)).toEqual([3, 4, 5, 6, 7])

    // Each echo takes its guess away as it is drawn for real.
    screen.print('s -')
    predictor.check(screen, true)
    expect(shown()).toBe('la')
    screen.print('la')
    predictor.check(screen, true)
    expect(shown()).toBe('')
  })

  test('a prompt that echoes nothing, a password, never shows a key', () => {
    const { predictor, screen, pass, shown } = slow()
    screen.print('Password: ')
    for (const char of 'hunter2') {
      predictor.typed(char, screen, true)
      expect(shown()).toBe('')
      pass(50)
    }
    // Nothing echoed in time: every guess goes.
    pass(1000)
    predictor.check(screen, true)
    expect(predictor.deadline).toBeNull()
    predictor.typed('x', screen, true)
    expect(shown()).toBe('')
  })

  test('a wrong guess drops every guess, and the next key is a probe again', () => {
    const { predictor, screen, pass, shown, typeEchoed } = slow()
    typeEchoed('g', 120)
    predictor.typed('it', screen, true)
    expect(shown()).toBe('it')

    // Somebody else typed, or the shell drew something else there.
    pass(120)
    screen.print('X')
    predictor.check(screen, true)
    expect(shown()).toBe('')
    expect(predictor.deadline).toBeNull()

    predictor.typed('y', screen, true)
    expect(shown()).toBe('')
  })

  test('nothing is guessed ahead of Enter until what came before it settles', () => {
    const { predictor, screen, pass, shown, typeEchoed } = slow()
    typeEchoed('l', 120)
    predictor.typed('s\rcd', screen, true)
    // `s` was typed at the prompt and stays drawn; `cd` goes wherever Enter leaves the
    // cursor, which is the shell's to say.
    expect(shown()).toBe('s')
    pass(120)
    screen.print('s\n')
    predictor.check(screen, true)
    expect(predictor.deadline).toBeNull()
    // And the next key is a probe again.
    predictor.typed('x', screen, true)
    expect(shown()).toBe('')
  })

  test('nothing is guessed where no prompt is in front, and what was is dropped', () => {
    const { predictor, screen, shown, typeEchoed } = slow()
    typeEchoed('v', 120)
    predictor.typed('im', screen, true)
    expect(shown()).toBe('im')
    expect(predictor.check(screen, false)).toBe(true)
    expect(shown()).toBe('')
    predictor.typed('jj', screen, false)
    expect(predictor.deadline).toBeNull()
  })

  test('the last column is the line editor’s, never guessed', () => {
    const { predictor, screen, shown, typeEchoed } = slow()
    screen.print('x'.repeat(screen.cols - screen.x - 3))
    typeEchoed('a', 120)
    predictor.typed('bcd', screen, true)
    expect(shown()).toBe('b')
  })

  test('typing out a suggestion guesses over it; typing into a line does not', () => {
    const { predictor, screen, shown, typeEchoed } = slow()
    typeEchoed('g', 120)
    screen.ahead('it status')
    predictor.typed('it', screen, true)
    expect(shown()).toBe('it')

    const other = slow()
    other.typeEchoed('g', 120)
    other.screen.ahead('rep')
    other.predictor.typed('it', other.screen, true)
    expect(other.shown()).toBe('')
  })

  test('the link getting fast again stops the guessing, slow again starts it', () => {
    const { predictor, screen, shown, typeEchoed } = slow()
    const line = (latency: number) => {
      typeEchoed('a'.repeat(30), latency)
      predictor.typed('\r', screen, true)
      screen.print('\n$ ')
      predictor.check(screen, true)
      typeEchoed('a', latency)
    }
    line(HIDE_UNDER - 15)
    predictor.typed('b', screen, true)
    expect(shown()).toBe('')

    line(SHOW_FROM + 10)
    predictor.typed('b', screen, true)
    expect(shown()).toBe('b')
  })

  test('a reset forgets the guesses, not what was measured', () => {
    const { predictor, screen, shown, typeEchoed } = slow()
    typeEchoed('a', 120)
    predictor.typed('b', screen, true)
    predictor.reset()
    expect(shown()).toBe('')
    expect(predictor.latency).toBe(120)
  })
})
