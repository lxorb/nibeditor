import { BODY_INNER, BODY_ROWS } from '@nib/glasses'
import { beforeEach, describe, expect, test } from 'vitest'
import { Session } from './session'
import { type Option, type SettingRow, type Settings, Shell, type Words, type World } from './shell'

/** The settings, on the glasses.
 *
 *  Every glasses setting is reachable without the phone, and adding one is adding
 *  an entry to the schema both surfaces are drawn from. Nothing in the shell knows
 *  which settings there are, which is what these tests stand on: the fake below is
 *  the whole of what the screen is told. */

const WORDS: Words = {
  spaces: 'Spaces',
  notes: 'Notes',
  switchSpace: 'Switch space',
  changeNote: 'Change note',
  voiceOn: 'Voice on',
  voiceOff: 'Voice off',
  thinking: 'Thinking',
  nothingHere: 'Nothing here',
  noAnswer: 'No answer',
  settings: 'Settings',
  reset: 'Reset glasses settings',
  done: 'Done',
}

const paging = { breakAt: 2, gutter: 0, inner: BODY_INNER, rows: BODY_ROWS }

/** A world with nothing in it: none of these tests is about the lists. */
const WORLD: World = {
  space: () => 'Work',
  contents: () => [],
  spaces: () => [],
  tree: () => [],
  open: () => undefined,
  fold: () => undefined,
  enter: () => undefined,
  listen: () => undefined,
  listening: () => false,
  atSpace: () => '',
  atNote: () => '',
}

class FakeSettings implements Settings {
  numbers = true
  breakAt = '2'
  resets = 0

  rows = (): SettingRow[] => [
    { id: 'lineNumbers', label: 'Line numbers', value: this.numbers ? 'On' : 'Off' },
    { id: 'break', label: 'New page at', value: this.breakAt === '2' ? 'H2 and above' : 'Never' },
  ]

  tap = (id: string): readonly Option[] | null => {
    if (id === 'lineNumbers') {
      this.numbers = !this.numbers
      return null
    }

    return [
      { value: '2', label: 'H2 and above' },
      { value: '0', label: 'Never' },
    ]
  }

  pick = (id: string, value: string) => {
    if (id === 'break') this.breakAt = value
  }

  reset = () => {
    this.numbers = true
    this.breakAt = '2'
    this.resets++
  }
}

let settings: FakeSettings
let shell: Shell

beforeEach(() => {
  settings = new FakeSettings()
  const session = new Session()
  session.follow({ key: 'a', name: 'A note', text: '# A note\n\nWords.\n' }, paging)
  shell = new Shell(WORLD, () => WORDS, session, settings)
})

/** A hold, then the fourth choice. */
function openSettings() {
  shell.handle('hold')
  for (let at = 0; at < 3; at++) shell.handle('down')
  shell.handle('tap')
}

describe('the settings screen', () => {
  test('is the fourth thing a hold offers', () => {
    openSettings()
    expect(shell.screen.kind).toBe('settings')
  })

  test('lists every setting with what it says now', () => {
    openSettings()
    const body = shell.view().body

    expect(body).toContain('Line numbers')
    expect(body).toContain('On')
    expect(body).toContain('New page at')
    expect(body).toContain('H2 and above')
  })

  test('and the reset at the foot of them, where an action belongs', () => {
    openSettings()
    expect(shell.view().body).toContain('Reset glasses settings')
  })

  test('a tap on a toggle flips it where it stands', () => {
    openSettings()
    expect(shell.handle('tap')).toBe('draw')

    expect(settings.numbers).toBe(false)
    // And the row says so at once, without a second gesture.
    expect(shell.view().body).toContain('Off')
    expect(shell.screen.kind).toBe('settings')
  })

  test('a tap on a choice opens it as a list, on the value it has', () => {
    openSettings()
    shell.handle('down')
    shell.handle('tap')

    expect(shell.screen).toMatchObject({ kind: 'choice', id: 'break', at: 0 })
    const view = shell.view()
    expect(view.head).toContain('New page at')
    expect(view.body).toContain('H2 and above')
    expect(view.body).toContain('Never')
  })

  test('and choosing one takes it and goes back to the settings', () => {
    openSettings()
    shell.handle('down')
    shell.handle('tap')
    shell.handle('down')
    expect(shell.handle('tap')).toBe('draw')

    expect(settings.breakAt).toBe('0')
    expect(shell.screen.kind).toBe('settings')
    expect(shell.view().body).toContain('Never')
  })

  test('a double tap leaves a choice without choosing anything', () => {
    openSettings()
    shell.handle('down')
    shell.handle('tap')
    shell.handle('down')
    expect(shell.handle('double')).toBe('draw')

    expect(settings.breakAt).toBe('2')
    expect(shell.screen.kind).toBe('settings')
  })

  test('the cursor walks the settings a row at a time', () => {
    openSettings()
    expect(shell.screen).toMatchObject({ at: 0 })
    shell.handle('down')
    expect(shell.screen).toMatchObject({ at: 1 })
    shell.handle('down')
    // The reset, and then the end of the list.
    expect(shell.screen).toMatchObject({ at: 2 })
    shell.handle('down')
    expect(shell.screen).toMatchObject({ at: 2 })
  })

  test('the reset puts every setting back and says it did', () => {
    openSettings()
    shell.handle('tap')
    expect(settings.numbers).toBe(false)

    shell.handle('down')
    shell.handle('down')
    expect(shell.handle('tap')).toBe('draw')

    expect(settings.resets).toBe(1)
    expect(settings.numbers).toBe(true)
    expect(shell.view().body).toContain('On')
  })

  test('a double tap leaves the settings, one level at a time', () => {
    openSettings()
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('modal')
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
  })
})
