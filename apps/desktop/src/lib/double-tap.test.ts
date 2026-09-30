import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { DoubleTap, type Modifier, type Stroke, tapOf, WITHIN, writeTap } from './double-tap'

/** Plays a script of keys at the times given and answers every tap that came of it.
 *  `+Shift` is a press, `-Shift` a release, a bare number a wait in milliseconds;
 *  `!` is the pointer pressed. A press of Shift says Shift is held, as the browser
 *  does, so `+a` while it is held is a capital. */
function play(...script: (string | number)[]): Modifier[] {
  const taps = new DoubleTap()
  const heard: Modifier[] = []
  const held = new Set<string>()
  let now = 1000

  const stroke = (key: string, extra: Partial<Stroke> = {}): Stroke => ({
    key,
    shiftKey: held.has('Shift'),
    ctrlKey: held.has('Control'),
    altKey: held.has('Alt'),
    metaKey: held.has('Meta'),
    ...extra,
  })

  for (const step of script) {
    if (typeof step === 'number') {
      now += step
      continue
    }
    if (step === '!') {
      taps.broken()
      continue
    }

    const [sign, name] = [step.charAt(0), step.slice(1)]
    const repeat = name.endsWith('*')
    const key = repeat ? name.slice(0, -1) : name
    if (sign === '+') {
      held.add(key)
      taps.pressed(stroke(key, { repeat }), now)
    } else {
      held.delete(key)
      const tapped = taps.released(stroke(key), now)
      if (tapped) heard.push(tapped)
    }
    now += 20
  }

  return heard
}

describe('Shift pressed twice on its own', () => {
  test('is heard on the second release', () => {
    expect(play('+Shift', '-Shift', 100, '+Shift', '-Shift')).toEqual(['Shift'])
  })

  test('from either Shift key, one after the other', () => {
    // The browser names both `Shift`; which side is `code`, and does not matter here.
    expect(play('+Shift', '-Shift', '+Shift', '-Shift')).toEqual(['Shift'])
  })

  test('is not heard when the second press waits too long, or a press is held', () => {
    expect(play('+Shift', '-Shift', WITHIN + 50, '+Shift', '-Shift')).toEqual([])
    expect(play('+Shift', WITHIN + 50, '-Shift', 50, '+Shift', '-Shift')).toEqual([])
    expect(play('+Shift', '-Shift', 50, '+Shift', WITHIN + 50, '-Shift')).toEqual([])
  })

  test('is heard at the edge of the window, and not past it', () => {
    // Each step itself takes 20 ms, so the second press lands at WITHIN - 20 + 20.
    expect(play('+Shift', '-Shift', WITHIN - 20, '+Shift', '-Shift')).toEqual(['Shift'])
    expect(play('+Shift', '-Shift', WITHIN - 19, '+Shift', '-Shift')).toEqual([])
  })
})

describe('Shift doing its usual job', () => {
  test('a capital typed between two taps is typing', () => {
    expect(play('+Shift', '-Shift', '+Shift', '+a', '-a', '-Shift')).toEqual([])
    expect(play('+Shift', '+H', '-H', '-Shift', '+Shift', '+I', '-I', '-Shift')).toEqual([])
  })

  test('a selection with the arrows is not a tap', () => {
    expect(play('+Shift', '+ArrowLeft', '-ArrowLeft', '-Shift', '+Shift', '-Shift')).toEqual([])
  })

  test('a Shift+click or a drag with Shift held is not a tap', () => {
    expect(play('+Shift', '!', '-Shift', '+Shift', '-Shift')).toEqual([])
    expect(play('+Shift', '-Shift', '+Shift', '!', '-Shift')).toEqual([])
  })

  test('any key between the two ends it', () => {
    expect(play('+Shift', '-Shift', '+x', '-x', '+Shift', '-Shift')).toEqual([])
  })

  test('a key held through the tap makes it not alone', () => {
    expect(play('+a', '+Shift', '-a', '-Shift', '+Shift', '-Shift')).toEqual([])
  })

  test('both Shifts at once are not two taps', () => {
    expect(play('+Shift', '+Shift', '-Shift', '-Shift')).toEqual([])
  })

  test('another modifier held with it is a chord on its way', () => {
    expect(play('+Control', '+Shift', '-Shift', '+Shift', '-Shift', '-Control')).toEqual([])
    expect(play('+Shift', '+Control', '-Control', '-Shift', '+Shift', '-Shift')).toEqual([])
  })

  test('a key held down and repeating neither counts nor breaks', () => {
    expect(play('+Shift', '+Shift*', '-Shift', '+Shift', '-Shift')).toEqual(['Shift'])
  })

  test('an input method in the middle of a word is left to it', () => {
    const taps = new DoubleTap()
    taps.pressed({ key: 'Shift' }, 0)
    taps.released({ key: 'Shift' }, 50)
    taps.pressed({ key: 'Shift', isComposing: true }, 100)
    expect(taps.released({ key: 'Shift' }, 150)).toBeNull()

    taps.pressed({ key: 'Shift' }, 1000)
    taps.released({ key: 'Shift' }, 1050)
    taps.pressed({ key: 'Process' }, 1100)
    taps.pressed({ key: 'Shift' }, 1150)
    expect(taps.released({ key: 'Shift' }, 1200)).toBeNull()
  })
})

describe('five presses, which Windows reads as Sticky Keys', () => {
  test('are heard once, and a pause starts the count again', () => {
    const five = [
      '+Shift',
      '-Shift',
      '+Shift',
      '-Shift',
      '+Shift',
      '-Shift',
      '+Shift',
      '-Shift',
      '+Shift',
      '-Shift',
    ]
    expect(play(...five)).toEqual(['Shift'])
    expect(play(...five, WITHIN + 50, '+Shift', '-Shift', '+Shift', '-Shift')).toEqual([
      'Shift',
      'Shift',
    ])
  })
})

describe('the other modifiers', () => {
  test('are taps of their own, and one does not finish another', () => {
    expect(play('+Control', '-Control', '+Control', '-Control')).toEqual(['Control'])
    expect(play('+Alt', '-Alt', '+Alt', '-Alt')).toEqual(['Alt'])
    expect(play('+Shift', '-Shift', '+Control', '-Control')).toEqual([])
  })
})

describe('a web page', () => {
  /** The page's own copy of these rules waits as long as this one does: a double
   *  Shift is the same gesture over a page as over a note. */
  test('waits as long for the second tap', () => {
    const script = readFileSync(
      new URL('../../src-tauri/src/web_opens.rs', import.meta.url),
      'utf8',
    )
    expect(script).toContain(`var within = ${WITHIN}`)
  })
})

describe('a double tap as a key', () => {
  test('is written as the modifier twice, and read back as the modifier', () => {
    expect(writeTap('Shift', 'win')).toBe('Shift Shift')
    expect(tapOf('Shift Shift', 'win')).toBe('Shift')
    expect(tapOf('alt  alt', 'linux')).toBe('Alt')
  })

  test('is Mod where it is the platform key, so a double Ctrl is a double Cmd on a Mac', () => {
    expect(writeTap('Control', 'win')).toBe('Mod Mod')
    expect(writeTap('Meta', 'mac')).toBe('Mod Mod')
    expect(writeTap('Control', 'mac')).toBe('Ctrl Ctrl')
    expect(tapOf('Mod Mod', 'mac')).toBe('Meta')
    expect(tapOf('Mod Mod', 'linux')).toBe('Control')
  })

  test('is nothing but two of the same modifier', () => {
    expect(tapOf('Mod-p', 'win')).toBeNull()
    expect(tapOf('Shift Alt', 'win')).toBeNull()
    expect(tapOf('Shift Shift Shift', 'win')).toBeNull()
    expect(tapOf('a a', 'win')).toBeNull()
  })
})
