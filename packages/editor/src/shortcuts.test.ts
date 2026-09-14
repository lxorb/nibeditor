import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { nibBindings, standardBindings, unclaimedKeymap } from './keymap'
import { bindings, boundKeymap, defaultKeyFor, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { imageBindings } from './live-preview/image'

const ALL = [...nibBindings, ...standardBindings, ...tableBindings, ...imageBindings]

/** Every key CodeMirror would answer to in a state built from these. */
function keysIn(state: EditorState): string[] {
  return state
    .facet(keymap)
    .flat()
    .flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux])
    .filter((key): key is string => !!key)
}

describe('building the keymap', () => {
  test('uses the default where nothing was chosen', () => {
    const bold = bindings(nibBindings, {}).find((one) => one.key === 'Mod-b')
    expect(bold).toBeDefined()
  })

  test('uses the chosen key where there is one', () => {
    const built = bindings(nibBindings, { 'format.bold': 'Mod-Alt-b' })

    expect(built.some((one) => one.key === 'Mod-Alt-b')).toBe(true)
    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
  })

  /** A KeyBinding with no key at all is what CodeMirror reads as "any key",
   *  so an unbound command has to be left out rather than bound to nothing. */
  test('leaves out what was unbound rather than binding it to everything', () => {
    const built = bindings(nibBindings, { 'format.bold': null })

    expect(built.some((one) => one.key === 'Mod-b')).toBe(false)
    expect(built.every((one) => one.key ?? one.mac ?? one.win ?? one.linux)).toBe(true)
  })

  test('carries the fields CodeMirror needs beside the key', () => {
    const find = bindings(standardBindings, {}).find((one) => one.key === 'Mod-f')
    expect(typeof find?.run).toBe('function')

    // CodeMirror carries Find previous on Find next as a Shift handler, which
    // would be a second command on a key nobody could see or rebind. It is taken
    // off, and Find previous is a named entry of its own; see keymap.ts.
    const next = bindings(standardBindings, {}).find((one) => one.key === 'Mod-g')
    expect(next?.shift).toBeUndefined()

    const previous = bindings(nibBindings, {}).find((one) => one.key === 'Mod-Shift-g')
    expect(typeof previous?.run).toBe('function')
  })

  /** The library scoped its Find keys to `editor search-panel` so they kept
   *  working while the keyboard was inside its own panel. The panel is nib's bar
   *  now - a row of the pane, not a CodeMirror panel - and the bar answers Enter
   *  and Shift+Enter itself, so a scope naming a panel that does not exist is a
   *  scope that means nothing. See find.ts. */
  test('and no longer scopes a key to a panel the editor does not have', () => {
    const scoped = [...bindings(standardBindings, {}), ...bindings(nibBindings, {})].filter((one) =>
      (one.scope ?? '').includes('search-panel'),
    )

    expect(scoped).toEqual([])
  })

  test('drops a platform default the entry does not have', () => {
    // Redo's second key is Ctrl+Shift+Z on Windows and Linux, which is what every
    // other editor answers; the Mac's own Cmd+Shift+Z is on `edit.redo` itself, so
    // this entry names no key there at all.
    const alt = standardBindings.find((one) => one.id === 'edit.redo.alt')!

    expect(defaultKeyFor(alt, 'linux')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'win')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'mac')).toBeNull()
    expect(bindings([alt], {}).length).toBe(1)
    // Bound per platform rather than on a key of its own, so a Mac never sees it.
    expect(bindings([alt], {})[0]?.key).toBeUndefined()

    const redo = standardBindings.find((one) => one.id === 'edit.redo')!
    expect(defaultKeyFor(redo, 'mac')).toBe('Mod-Shift-z')
  })
})

describe('a state built with them', () => {
  test('answers to the defaults', () => {
    const state = EditorState.create({ extensions: [shortcutExtensions(), boundKeymap(ALL)] })
    expect(keysIn(state)).toContain('Mod-b')
  })

  test('answers to a chosen key instead, without being rebuilt', () => {
    const state = EditorState.create({
      extensions: [shortcutExtensions({ 'format.bold': 'Mod-Alt-b' }), boundKeymap(ALL)],
    })

    expect(keysIn(state)).toContain('Mod-Alt-b')
    expect(keysIn(state)).not.toContain('Mod-b')
  })

  test('keeps the keys nothing has taken over', () => {
    const state = EditorState.create({ extensions: keymap.of(unclaimedKeymap) })
    // The raw editing keys: still there, and still the library's own.
    expect(keysIn(state)).toContain('ArrowLeft')
    expect(keysIn(state)).toContain('Home')
  })

  test('and hands the taken-over ones to the named bindings alone', () => {
    // Undo is named now, so the library's own Mod-z is out of the keymap
    // underneath - otherwise a rebound Undo would leave the old key working.
    const keys = keysIn(EditorState.create({ extensions: keymap.of(unclaimedKeymap) }))

    expect(keys).not.toContain('Mod-z')
    expect(keys).not.toContain('Mod-f')
    expect(keys).not.toContain('Alt-ArrowUp')
  })

  /** And each of the search keys is installed once, which is the other half of the
   *  same promise.
   *
   *  A key bound in two places fires two commands, and the second is one nobody can
   *  find in the settings or take off - the failure every `claim` in keymap.ts exists
   *  to prevent, and the one Ctrl+F used to be: nib's own binding on top of the
   *  library's own entry underneath.
   *
   *  These six by name rather than every chord, because layering is deliberate
   *  elsewhere: an arrow key is bound by the table keymap, the picture keymap and the
   *  library in turn, and each answers false to let the next one have it. What is not
   *  deliberate is two commands on a chord that means one thing.
   *
   *  It is these six because the search keymap is no longer read at all - the engine
   *  behind it is fetched at the launch's last turn rather than carried into the first
   *  paint, so the four keys it carried are declared by hand in keymap.ts and the two
   *  it duplicated are nib's own. Declaring a key by hand is how one comes to be bound
   *  twice, so each is counted. */
  test('and installs each of the search keys once', () => {
    const installed = EditorState.create({
      extensions: [shortcutExtensions(), boundKeymap(ALL), keymap.of(unclaimedKeymap)],
    })

    const counted = new Map<string, number>()
    for (const chord of keysIn(installed)) counted.set(chord, (counted.get(chord) ?? 0) + 1)

    // Find, the two steps, goto-line, and the one the library bound underneath nib's
    // own Ctrl+D.
    for (const chord of ['Mod-f', 'Mod-g', 'F3', 'Mod-Alt-g', 'Mod-d']) {
      expect(counted.get(chord), chord).toBe(1)
    }

    // And the sixth is bound by nothing at all, which is the same promise from the
    // other side: Ctrl+Shift+L is the sidebar's key in the app, `edit.select-all-
    // occurrences` is offered with no key of its own, and the library's own entry on
    // that chord went with its keymap. A reader who binds the row gets one command.
    expect(counted.get('Mod-Shift-l')).toBeUndefined()
  })

  /** The bug: Ctrl+/ is source mode, read off the window, and the library binds
   *  its own comment toggle to the same chord underneath. Both fired, so turning
   *  source mode on wrapped whatever line the caret was on in `<!--` and `-->`. */
  test('leaves the library nothing on the key source mode uses', () => {
    const keys = keysIn(EditorState.create({ extensions: keymap.of(unclaimedKeymap) }))

    expect(keys).not.toContain('Mod-/')
  })
})
