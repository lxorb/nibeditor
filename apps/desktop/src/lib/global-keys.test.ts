import { describe, expect, test } from 'vitest'
import { type GlobalKeys, noteFor } from './global-keys.svelte'

const keys = (over: Partial<GlobalKeys>): GlobalKeys => ({
  reach: 'portal',
  change: true,
  held: {},
  refused: [],
  run: 'nib',
  ...over,
})

describe('what a shortcut row says about other apps', () => {
  test('nothing where the system takes the key the list says', () => {
    expect(noteFor(keys({ reach: 'system' }), 'app.quick-add', 'Ctrl+Alt+Space')).toBeNull()
    expect(noteFor(null, 'app.quick-add', 'Ctrl+Alt+Space')).toBeNull()
  })

  test('nothing for a shortcut that never reaches past the window', () => {
    expect(noteFor(keys({ reach: 'none' }), 'app.sidebar', 'Ctrl+Shift+L')).toBeNull()
  })

  test('the command to bind where no key reaches the app', () => {
    const said = noteFor(keys({ reach: 'none', run: 'orden' }), 'app.quick-add', 'Ctrl+Alt+Space')
    expect(said?.text).toContain('orden --quick-add')
    expect(said?.change).toBe(false)
    expect(noteFor(keys({ reach: 'none' }), 'agents.stop', null)?.text).toContain(
      'nib --stop-agents',
    )
  })

  test('the key the system gave, where it is another', () => {
    const given = keys({ held: { 'app.quick-add': 'Meta+Q' } })
    expect(noteFor(given, 'app.quick-add', 'Ctrl+Alt+Space')).toEqual({
      text: 'From other apps: Meta+Q',
      change: true,
    })
  })

  test('nothing where the system gave the same key, however it spells it', () => {
    const given = keys({ held: { 'app.quick-add': 'CTRL+ALT+space' } })
    expect(noteFor(given, 'app.quick-add', 'Ctrl+Alt+Space')).toBeNull()
    const control = keys({ held: { 'app.quick-add': 'Control + Alt + Space' } })
    expect(noteFor(control, 'app.quick-add', 'Ctrl+Alt+Space')).toBeNull()
  })

  test('the system settings, where it holds the key with none yet or turned it down', () => {
    const none = keys({ held: { 'app.quick-add': '' }, change: false })
    expect(noteFor(none, 'app.quick-add', 'Ctrl+Alt+Space')).toEqual({
      text: 'From other apps: set in your system settings',
      change: false,
    })
    const refused = keys({ refused: ['agents.stop'] })
    expect(noteFor(refused, 'agents.stop', 'Ctrl+Alt+Shift+K')?.change).toBe(true)
  })

  test('nothing while the portal has not answered yet', () => {
    expect(noteFor(keys({}), 'app.quick-add', 'Ctrl+Alt+Space')).toBeNull()
  })
})
