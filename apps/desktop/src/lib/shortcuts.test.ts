import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  type BindingSpec,
  defaultKeyFor,
  imageBindings,
  nibBindings,
  nibKeymap,
  standardBindings,
  tableBindings,
} from '@nib/editor'
import { sameCombination } from './keys'

/** The store writes to the browser's storage and asks the browser what kind
 *  of machine this is, and there is neither under node. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

let registry: typeof import('./shortcuts.svelte')

/** The registry's graph, and the menus and palette that read it, loaded here
 *  rather than by the first `restarted()` or by the one test that asks for them:
 *  thirteen seconds of the first test was compiling, and the palette's own
 *  imports had only a test's five seconds to compile in. See
 *  docs/conventions.md. */
await Promise.all([
  import('./shortcuts.svelte'),
  import('./modes.svelte'),
  import('./commands'),
  import('./app-menu'),
])

/** The store as a fresh start of the app would find it. */
async function restarted() {
  vi.resetModules()
  const module = await import('./shortcuts.svelte')
  module.shortcuts.restore()
  return module
}

beforeEach(async () => {
  localStorage.clear()
  registry = await restarted()
})

/** The modes store, which the Vim preset also has something to say to. Its own
 *  module, and reset with everything else by `restarted`. */
async function currentModes() {
  return (await import('./modes.svelte')).modes
}

/** A keystroke, as the window would hand one over. */
function press(
  key: string,
  held: {
    code?: string
    ctrl?: boolean
    alt?: boolean
    shift?: boolean
    /** Whether a surface has already taken it, which the window's handler reads. */
    answered?: boolean
  } = {},
) {
  return {
    key,
    code: held.code,
    ctrlKey: !!held.ctrl,
    metaKey: false,
    altKey: !!held.alt,
    shiftKey: !!held.shift,
    defaultPrevented: !!held.answered,
    preventDefault: () => undefined,
  } as unknown as KeyboardEvent
}

const PLATFORMS = ['mac', 'win', 'linux'] as const

describe('every shortcut there is', () => {
  test('has an id nothing else has', () => {
    const ids = registry.SHORTCUTS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /** This is the guard the whole thing hangs on: a binding added to the
   *  editor package without a name and a place in the settings would be a
   *  shortcut nobody can find or change, which is the one thing this is meant
   *  to make impossible. */
  test.each([
    ['the markdown bindings', nibBindings],
    ['the ones taken over from CodeMirror', standardBindings],
    ['the table bindings', tableBindings],
    ['the picture bindings', imageBindings],
  ])('covers %s', (_name, specs: BindingSpec[]) => {
    const missing = specs.filter((spec) => !registry.SHORTCUTS.some((one) => one.id === spec.id))
    expect(missing.map((spec) => spec.id)).toEqual([])
  })

  test('gives every one of them a name of its own rather than its id', () => {
    const unnamed = registry.SHORTCUTS.filter((one) => one.label() === one.id)
    expect(unnamed.map((one) => one.id)).toEqual([])
  })

  /** An app binding is read off the window and run from the entry itself, so one
   *  with nothing to run is a row in the settings a key can be put on and a key
   *  that then does nothing. The other scopes are run where their surface is:
   *  the editor's by CodeMirror, the file list's and the plane's by hand. */
  test('gives every app-level one something to run', () => {
    const idle = registry.SHORTCUTS.filter((one) => one.scope === 'app' && !one.run)
    expect(idle.map((one) => one.id)).toEqual([])
  })

  /** Every entry sits in one of the groups the settings list draws, or it is in
   *  the list and in none of its sections, which is a row nobody can find. */
  test('puts every one of them in a group the settings show', () => {
    const groups = new Set(registry.CATEGORIES.map((one) => one.id))
    const homeless = registry.SHORTCUTS.filter((one) => !groups.has(one.category))
    expect(homeless.map((one) => `${one.id}: ${one.category}`)).toEqual([])
  })

  /** The fixed ones are in the list to be seen rather than changed, so each says
   *  why in words, and none of them can be rebound into a real conflict. */
  test('says why each fixed key cannot be changed', () => {
    const fixed = registry.SHORTCUTS.filter((one) => one.scope === 'fixed')
    expect(fixed.length).toBeGreaterThan(0)

    for (const one of fixed) expect(one.why?.(), one.id).toBeTruthy()
  })

  test('starts each on the key the editor installs it with', () => {
    for (const spec of [...nibBindings, ...standardBindings, ...tableBindings, ...imageBindings]) {
      const entry = registry.SHORTCUTS.find((one) => one.id === spec.id)!
      for (const platform of PLATFORMS) {
        expect(defaultKeyFor(entry, platform), spec.id).toBe(defaultKeyFor(spec, platform))
      }
    }
  })

  test('holds a key for everything nibKeymap binds', () => {
    const listed = registry.SHORTCUTS.map((one) => one.key)
    for (const binding of nibKeymap) expect(listed, binding.key).toContain(binding.key)
  })

  /** The second key for Redo, which is the one every other editor answers:
   *  Obsidian, VS Code and Word all take Ctrl+Shift+Z, and somebody who undid one
   *  step too far presses what those taught them rather than Ctrl+Y. Listed here as
   *  well as in the editor's own specs because this is the list the Shortcuts pane
   *  draws, the palette hints from, and the canvas and a page note read - all three
   *  ask about `edit.redo.alt` by id. */
  test('answers Redo on Ctrl+Shift+Z on Windows and Linux, and on Cmd+Shift+Z on a Mac', () => {
    const found = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)!
    const alt = found('edit.redo.alt')
    expect(defaultKeyFor(alt, 'win')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'linux')).toBe('Ctrl-Shift-z')
    // Nothing on a Mac, where the same chord is Redo's own key rather than a second one.
    expect(defaultKeyFor(alt, 'mac')).toBeNull()
    expect(defaultKeyFor(found('edit.redo'), 'mac')).toBe('Mod-Shift-z')

    // A second key, so the list marks it as one rather than showing Redo twice.
    expect(alt.alias).toBe(true)
    expect(alt.label()).toBe(found('edit.redo').label())
  })

  /** Two entries on one key means one of them never fires. The contextual
   *  ones are the exception by design: they look for a table or a picture and
   *  give way when there is none, which is how six of them sit on the arrow
   *  keys without taking them. */
  test.each(PLATFORMS)('starts nothing on a key something else starts on (%s)', (platform) => {
    const held = new Map<string, string>()
    const clashes: string[] = []

    for (const entry of registry.SHORTCUTS) {
      if (entry.contextual) continue

      const key = defaultKeyFor(entry, platform)
      if (!key) continue

      for (const [taken, by] of held) {
        if (sameCombination(taken, key, platform))
          clashes.push(`${entry.id} and ${by} both start on ${key}`)
      }
      held.set(key, entry.id)
    }

    expect(clashes).toEqual([])
  })
})

describe('choosing a key', () => {
  test('wins over the default', () => {
    const { shortcuts } = registry
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')

    shortcuts.set('format.bold', 'Mod-Alt-b')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })

  test('can be no key at all', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', null)
    expect(shortcuts.keyFor('format.bold')).toBeNull()
    expect(shortcuts.hint('format.bold')).toBeUndefined()
  })

  test('is put back by resetting it', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.reset('format.bold')

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.changed('format.bold')).toBe(false)
  })

  test('and by resetting all of them', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.set('app.save', null)
    shortcuts.resetAll()

    expect(shortcuts.overrides).toEqual({})
    expect(shortcuts.keyFor('app.save')).toBe('Mod-s')
  })

  test('is refused where it would fire while typing', () => {
    const { shortcuts } = registry
    expect(shortcuts.refuse('k')).not.toBeNull()
    expect(shortcuts.refuse('Shift-k')).not.toBeNull()
    // A key with no character of its own is fine on its own.
    expect(shortcuts.refuse('F7')).toBeNull()
    expect(shortcuts.refuse('Mod-k')).toBeNull()
  })

  test('is warned about when the machine underneath usually keeps it', () => {
    const { shortcuts } = registry
    expect(shortcuts.warning('Alt-F4')).not.toBeNull()
    expect(shortcuts.warning('Mod-Alt-b')).toBeNull()
    expect(shortcuts.warning(null)).toBeNull()
  })
})

describe('what is written down', () => {
  test('is only what differs from the defaults', async () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')

    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'format.bold': 'Mod-Alt-b',
    })
  })

  /** The reason only the differences are kept: a full dump would freeze
   *  today's defaults into the file, and the day a default changes nobody
   *  would ever see the new one. */
  test('lets a default that changed later reach the reader', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 'Mod-Alt-b' }))
    const { shortcuts } = await restarted()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    // Everything else follows whatever the app says today.
    const italic = nibBindings.find((one) => one.id === 'format.italic')
    if (!italic) throw new Error('the editor no longer binds format.italic')
    expect(shortcuts.keyFor('format.italic')).toBe(defaultKeyFor(italic, 'win'))
  })

  test('keeps an id this version has never heard of', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'from.the.future': 'Mod-9' }))
    const { shortcuts } = await restarted()

    shortcuts.set('format.bold', 'Mod-Alt-b')
    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'from.the.future': 'Mod-9',
      'format.bold': 'Mod-Alt-b',
    })
  })

  test('survives a file that is nonsense', async () => {
    localStorage.setItem('nib:shortcuts', '{{{')
    expect((await restarted()).shortcuts.keyFor('format.bold')).toBe('Mod-b')

    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 42, 'app.save': null }))
    const { shortcuts } = await restarted()
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.save')).toBeNull()
  })

  test('comes back from the account', () => {
    const { shortcuts } = registry
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'format.bold': 'Mod-Alt-b',
    })
  })

  test('is left alone by an account that carries none', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.receive({ ligatures: true })

    // Signing in with a choice already made keeps it, and the account is
    // told: nothing chosen before signing in is lost at the door.
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })
})

describe('choosing a keyboard', () => {
  test('starts on the default one', () => {
    expect(registry.shortcuts.preset).toBe('default')
    expect(registry.shortcuts.overrides).toEqual({})
  })

  test('rewrites the whole map rather than adding to it', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.choose('obsidian')

    expect(shortcuts.preset).toBe('obsidian')
    // The hand-made key is gone: a preset is a keyboard, not a patch.
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.note-1')).toBe('Mod-1')
    expect(shortcuts.keyFor('paragraph.heading-1')).toBeNull()
  })

  test('and Notion puts inline code where the reading view was', () => {
    const { shortcuts } = registry
    shortcuts.choose('notion')

    expect(shortcuts.keyFor('format.code')).toBe('Mod-e')
    expect(shortcuts.keyFor('app.reading')).toBeNull()
    expect(shortcuts.keyFor('paragraph.heading-1')).toBe('Mod-Shift-1')
  })

  test('goes back to the defaults by choosing the default one', () => {
    const { shortcuts } = registry
    shortcuts.choose('obsidian')
    shortcuts.choose('default')

    expect(shortcuts.overrides).toEqual({})
    expect(shortcuts.keyFor('paragraph.heading-1')).toBe('Mod-1')
  })

  test('is what resetting every key does', () => {
    const { shortcuts } = registry
    shortcuts.choose('notion')
    shortcuts.resetAll()

    expect(shortcuts.preset).toBe('default')
    expect(shortcuts.overrides).toEqual({})
  })

  test('turns modal editing on for Vim and off for the others', async () => {
    const { shortcuts } = registry
    const modes = await currentModes()

    shortcuts.choose('vim')
    expect(modes.vim).toBe(true)

    shortcuts.choose('obsidian')
    expect(modes.vim).toBe(false)
  })

  /** Why the switch sits beside the preset in the Shortcuts pane rather than in
   *  the editor's: modal editing is the same choice the keyboard makes, and it
   *  can be made on its own over any of the maps without becoming a map of one's
   *  own. */
  test('can be turned on over another keyboard without replacing it', async () => {
    const { shortcuts } = registry
    const modes = await currentModes()

    shortcuts.choose('notion')
    modes.setVimKeys(true)

    expect(modes.vim).toBe(true)
    expect(shortcuts.preset).toBe('notion')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
  })

  test('leaves a name this version has never heard of alone', () => {
    const { shortcuts } = registry
    shortcuts.choose('emacs')

    expect(shortcuts.preset).toBe('default')
  })

  /** Modal editing changes what every key on the keyboard does, so nothing but a
   *  hand may turn it on: not choosing another keyboard, not a name written down
   *  by an earlier run, and not one the account carries. Whether it is on is the
   *  modes store's own answer and travels on its own; see modes.svelte.ts. */
  describe('and modal editing', () => {
    test('stays off for every keyboard but Vim', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      for (const id of ['default', 'notion', 'obsidian']) {
        shortcuts.choose(id)
        expect(modes.vim, id).toBe(false)
      }
    })

    test('stays off when a name written down before is read back', async () => {
      for (const id of ['default', 'notion', 'obsidian', 'vim', 'custom']) {
        localStorage.clear()
        localStorage.setItem('nib:preset', id)

        const fresh = await restarted()
        const modes = await currentModes()

        expect(fresh.shortcuts.preset, id).toBe(id)
        expect(modes.vim, id).toBe(false)
      }
    })

    test('stays off when the account names a keyboard, Vim included', async () => {
      for (const preset of ['notion', 'vim']) {
        const fresh = await restarted()
        const modes = await currentModes()

        fresh.shortcuts.receive({ shortcuts: {}, preset })

        expect(fresh.shortcuts.preset, preset).toBe(preset)
        expect(modes.vim, preset).toBe(false)
      }
    })

    test('goes off again when every key is put back', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      shortcuts.choose('vim')
      expect(modes.vim).toBe(true)

      shortcuts.resetAll()
      expect(modes.vim).toBe(false)
    })

    test('survives rebinding a key by hand, which makes the map custom', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      shortcuts.set('format.bold', 'Alt-b')

      expect(shortcuts.preset).toBe('custom')
      expect(modes.vim).toBe(false)
    })
  })

  test('is remembered across a restart', async () => {
    registry.shortcuts.choose('obsidian')
    const { shortcuts } = await restarted()

    expect(shortcuts.preset).toBe('obsidian')
    expect(shortcuts.keyFor('app.note-1')).toBe('Mod-1')
  })
})

describe('a map made by hand', () => {
  test('is Custom as soon as one key is rebound', () => {
    const { shortcuts } = registry
    shortcuts.choose('obsidian')
    shortcuts.set('format.bold', 'Mod-Alt-b')

    expect(shortcuts.preset).toBe('custom')
  })

  test('is Custom when one key is put back on its own, too', () => {
    const { shortcuts } = registry
    shortcuts.choose('obsidian')
    shortcuts.reset('app.note-1')

    expect(shortcuts.preset).toBe('custom')
  })

  /** An entry written before there were presets has a map and no name for it,
   *  and a map with something in it is exactly what Custom means. */
  test('is what a map written by an older build reads as', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 'Mod-Alt-b' }))
    expect((await restarted()).shortcuts.preset).toBe('custom')

    localStorage.setItem('nib:shortcuts', '{}')
    expect((await restarted()).shortcuts.preset).toBe('default')
  })
})

describe('the keyboard the account carries', () => {
  test('brings the name along with the map', () => {
    const { shortcuts } = registry
    shortcuts.receive({ preset: 'notion', shortcuts: { 'format.code': 'Mod-e' } })

    expect(shortcuts.preset).toBe('notion')
    expect(shortcuts.keyFor('format.code')).toBe('Mod-e')
    expect(localStorage.getItem('nib:preset')).toBe('notion')
  })

  test('reads a name this version has never heard of as Custom', () => {
    const { shortcuts } = registry
    shortcuts.receive({ preset: 'emacs', shortcuts: { 'format.bold': 'Mod-Alt-b' } })

    expect(shortcuts.preset).toBe('custom')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })

  test('keeps the one this machine has when the account carries none', () => {
    const { shortcuts } = registry
    shortcuts.choose('obsidian')
    shortcuts.receive({ ligatures: true })

    expect(shortcuts.preset).toBe('obsidian')
  })
})

describe('two shortcuts on one key', () => {
  test('is a conflict, and says whose key it is', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.save', 'Mod-o').map((one) => one.id)).toEqual(['app.open'])
  })

  test('counts across the app and the editor, which cannot share one', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.save', 'Mod-b').map((one) => one.id)).toEqual(['format.bold'])
  })

  test('is not a conflict when nothing else is on the key', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.save', 'Mod-Alt-j')).toEqual([])
  })

  test('follows the keys as they are now, not as they started', () => {
    const { shortcuts } = registry
    shortcuts.set('app.open', 'Mod-Alt-j')

    expect(shortcuts.conflicts('app.save', 'Mod-o')).toEqual([])
    expect(shortcuts.conflicts('app.save', 'Mod-Alt-j').map((one) => one.id)).toEqual(['app.open'])
  })

  test('leaves the contextual ones out, which is how they share the arrows', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('table.below', 'ArrowUp')).toEqual([])
    expect(shortcuts.conflicts('app.save', 'ArrowDown')).toEqual([])
  })

  test('is resolved by taking the key, which leaves the other with none', () => {
    const { shortcuts } = registry
    shortcuts.set('app.open', null)
    shortcuts.set('app.save', 'Mod-o')

    expect(shortcuts.keyFor('app.open')).toBeNull()
    expect(shortcuts.keyFor('app.save')).toBe('Mod-o')
    expect(shortcuts.conflicts('app.save', 'Mod-o')).toEqual([])
  })

  test('names the fixed key a combination would land on', () => {
    const { shortcuts } = registry
    expect(shortcuts.fixedHolder('Mod-x')?.id).toBe('fixed.cut')
    expect(shortcuts.fixedHolder('Mod-Alt-9')).toBeUndefined()
  })
})

describe('the keyboard', () => {
  test('runs what the key is bound to', () => {
    const { shortcuts } = registry
    let opened = 0

    const ran = shortcuts.handle(press('p', { ctrl: true, code: 'KeyP' }), {
      palette: () => opened++,
      fullscreen: () => undefined,
    })

    expect(ran).toBe(true)
    expect(opened).toBe(1)
  })

  /** A press a surface has already answered is spent.
   *
   *  The plane takes Ctrl+Alt+0 to fit itself and the app takes Ctrl+0 for the size, so
   *  those two no longer meet - but the plane, the page column and the editor all hold
   *  keys the app holds too, and every one of them says it took the press the same way.
   *  The window's handler is the last one to run, so it stands down. */
  test('a key a surface has answered is not the app’s as well', () => {
    const { shortcuts } = registry
    let opened = 0
    const context = { palette: () => opened++, fullscreen: () => undefined }

    const answered = press('p', { ctrl: true, code: 'KeyP', answered: true })

    expect(shortcuts.handle(answered, context)).toBe(false)
    expect(opened).toBe(0)
    // And one nothing answered still is.
    expect(shortcuts.handle(press('p', { ctrl: true, code: 'KeyP' }), context)).toBe(true)
    expect(opened).toBe(1)
  })

  test('follows a rebind straight away', () => {
    const { shortcuts } = registry
    let opened = 0
    const context = { palette: () => opened++, fullscreen: () => undefined }

    shortcuts.set('app.palette', 'Mod-Alt-9')

    expect(shortcuts.handle(press('p', { ctrl: true, code: 'KeyP' }), context)).toBe(false)
    expect(shortcuts.handle(press('9', { ctrl: true, alt: true, code: 'Digit9' }), context)).toBe(
      true,
    )
    expect(opened).toBe(1)
  })

  test('leaves a key nothing is bound to alone', () => {
    const { shortcuts } = registry
    shortcuts.set('app.palette', null)

    const ran = shortcuts.handle(press('p', { ctrl: true, code: 'KeyP' }), {
      palette: () => undefined,
      fullscreen: () => undefined,
    })

    expect(ran).toBe(false)
  })
})

describe('the file list', () => {
  test('reads its own keys from the registry', () => {
    const { shortcuts } = registry
    expect(shortcuts.pressed('tree.select-all', press('a', { ctrl: true, code: 'KeyA' }))).toBe(
      true,
    )
    expect(shortcuts.pressed('tree.deselect', press('Escape'))).toBe(true)
    expect(shortcuts.pressed('tree.delete', press('Delete'))).toBe(true)
    expect(shortcuts.pressed('tree.delete.alt', press('Backspace'))).toBe(true)
  })

  test('follows a rebind like everything else', () => {
    const { shortcuts } = registry
    shortcuts.set('tree.select-all', 'Mod-Alt-a')

    expect(shortcuts.pressed('tree.select-all', press('a', { ctrl: true, code: 'KeyA' }))).toBe(
      false,
    )
    expect(
      shortcuts.pressed('tree.select-all', press('a', { ctrl: true, alt: true, code: 'KeyA' })),
    ).toBe(true)
  })

  /** They fire where the list is, not on the window, so they are none of the
   *  window's business even at the keys the window also uses. */
  test('is not read off the window', () => {
    const { shortcuts } = registry
    let opened = 0
    shortcuts.set('app.palette', 'Mod-a')

    const ran = shortcuts.handle(press('a', { ctrl: true, code: 'KeyA' }), {
      palette: () => opened++,
      fullscreen: () => undefined,
    })

    // The palette's own binding answered; the list's did not come into it.
    expect(ran).toBe(true)
    expect(opened).toBe(1)
  })
})

describe('what a reader is shown', () => {
  test('is the key written the way this machine writes it', () => {
    expect(registry.shortcuts.hint('app.save')).toBe('Ctrl+S')
    expect(registry.shortcuts.hint('paragraph.heading-1')).toBe('Ctrl+1')
  })

  test('and follows a rebind', () => {
    const { shortcuts } = registry
    shortcuts.set('app.save', 'Mod-Alt-s')
    expect(shortcuts.hint('app.save')).toBe('Ctrl+Alt+S')
  })

  test('reaches the menus and the palette', async () => {
    const { shortcuts } = registry
    shortcuts.set('app.save', 'Mod-Alt-s')

    const { appCommands } = await import('./commands')
    const { appMenu } = await import('./app-menu')
    const { isSubmenu } = await import('./menu-item')

    const command = appCommands().find((one) => one.id === 'save')
    expect(command?.hint).toBe('Ctrl+Alt+S')

    const file = appMenu({ onpalette: () => undefined, onhistory: () => undefined }).find(
      (group) => group.id === 'file',
    )
    const row = file?.rows.find(
      (one) => one !== null && !isSubmenu(one) && one.label === command?.label,
    )
    expect(row !== null && row !== undefined && !isSubmenu(row) ? row.hint : null).toBe(
      'Ctrl+Alt+S',
    )
  })
})

/** Getting around with nothing but a keyboard; see docs/keyboard.md. */
describe('the keys that move the keyboard about', () => {
  test('walk the regions of the window, both ways', () => {
    expect(registry.shortcuts.keyFor('app.region-next')).toBe('F6')
    expect(registry.shortcuts.keyFor('app.region-previous')).toBe('Shift-F6')
  })

  test('reach every panel, and toggle the sidebar', () => {
    for (const id of ['app.files', 'app.outline', 'app.search', 'app.links', 'app.sidebar']) {
      expect(registry.shortcuts.keyFor(id), id).toBeTruthy()
    }
  })

  test('reach the spaces and the switcher', () => {
    expect(registry.shortcuts.keyFor('space.next')).toBeTruthy()
    expect(registry.shortcuts.keyFor('space.previous')).toBeTruthy()
    expect(registry.shortcuts.keyFor('space.switcher')).toBeTruthy()
  })

  test('and the list of every key there is', () => {
    expect(registry.shortcuts.keyFor('app.keys')).toBeTruthy()
  })

  /** The rule that cost a day, in both directions.
   *
   *  A digit held with a modifier is read twice. CodeMirror reads a character key as
   *  it arrived and again without the shift, because on a great many layouts the shift
   *  is how that character is typed at all; and the app reads a chord that wants a
   *  digit and no shift by the key underneath, for the same reason and on purpose -
   *  that is what makes Ctrl+0 reach the text size on AZERTY. See `matchesCombination`
   *  in keys.ts.
   *
   *  Either way round it comes to the same thing: `Mod-Shift-<digit>` and
   *  `Mod-<digit>` are one press on a keyboard where the digit is the shifted
   *  character, so nothing may hold one while anything holds the other. Both halves
   *  are checked, because the pair that bit first was an app key shadowing an editor
   *  one and the pair that would bite next is the other way about. */
  test.each(PLATFORMS)('never put two things on one digit through the shift (%s)', (platform) => {
    const digitsOn = (pattern: RegExp) =>
      new Map(
        registry.SHORTCUTS.map((one) => ({ id: one.id, key: defaultKeyFor(one, platform) }))
          .flatMap((one) => {
            const digit = one.key === null ? null : (pattern.exec(one.key)?.[1] ?? null)
            return digit ? [[digit, `${one.id} on ${one.key ?? ''}`] as const] : []
          })
          .map(([digit, said]) => [digit, said]),
      )

    const plain = digitsOn(/^Mod-([0-9])$/)
    const shifted = digitsOn(/^Mod-Shift-([0-9])$/)

    const guilty = [...shifted]
      .filter(([digit]) => plain.has(digit))
      .map(([digit, said]) => `${said} fires ${plain.get(digit) ?? ''} as well`)

    expect(guilty, guilty.join(', ')).toEqual([])
  })

  /** The three keys Emil asked for by name, and what they used to be.
   *
   *  Every browser, Obsidian and Typora change the size of the words with these, so a
   *  reader tries them before they try a shortcut list. Pinned here because moving
   *  them back would be a decision and not a slip. */
  test('change the size of the words, the way every browser does', () => {
    expect(registry.shortcuts.keyFor('app.zoom-in')).toBe('Mod-=')
    expect(registry.shortcuts.keyFor('app.zoom-out')).toBe('Mod--')
    expect(registry.shortcuts.keyFor('app.zoom-reset')).toBe('Mod-0')
  })

  test('and the three that were on them are one modifier over', () => {
    expect(registry.shortcuts.keyFor('paragraph.heading-up')).toBe('Mod-Shift-=')
    expect(registry.shortcuts.keyFor('paragraph.heading-down')).toBe('Mod-Shift--')
    // A letter rather than Ctrl+Shift+0, which on AZERTY is Ctrl+0 all over again.
    expect(registry.shortcuts.keyFor('paragraph.body')).toBe('Mod-Shift-p')
  })
})

/** The paper's own zoom.
 *
 *  A page note is a surface with a zoom of its own, like the plane and the graph,
 *  and it cannot have the three keys every browser zooms with: those are the app's
 *  text size, they fire on the window after the surface has had the press, and one
 *  key doing both would resize the words and the paper at once. So they are one
 *  modifier over, which is the trade `canvas.fit` already made. */
describe('a page note’s zoom', () => {
  test('is on the keys the plane’s Fit is on, one modifier over', () => {
    expect(registry.shortcuts.keyFor('pages.zoom.in')).toBe('Mod-Alt-=')
    expect(registry.shortcuts.keyFor('pages.zoom.out')).toBe('Mod-Alt--')
    expect(registry.shortcuts.keyFor('pages.fit')).toBe('Mod-Alt-0')
  })

  test('and never on the three that change the size of the words', () => {
    const size = ['app.zoom-in', 'app.zoom-out', 'app.zoom-reset'].map((id) =>
      registry.shortcuts.keyFor(id),
    )

    for (const id of ['pages.zoom.in', 'pages.zoom.out', 'pages.fit']) {
      expect(size, id).not.toContain(registry.shortcuts.keyFor(id))
    }
  })

  /** Read off the paper, like the plane's own keys, so the two surfaces share
   *  Ctrl+Alt+0 rather than being reported as a clash: only one of them is ever in
   *  front of a reader. */
  test('is read where the paper is, and shares its keys with the plane', () => {
    for (const id of ['pages.zoom.in', 'pages.zoom.out', 'pages.fit', 'pages.add']) {
      const entry = registry.SHORTCUTS.find((one) => one.id === id)
      expect(entry?.scope, id).toBe('panel')
      expect(entry?.contextual, id).toBe(true)
      expect(entry?.category, id).toBe('pages')
    }

    expect(registry.shortcuts.keyFor('canvas.fit')).toBe('Mod-Alt-0')
    expect(registry.shortcuts.conflicts('pages.fit', 'Mod-Alt-0')).toEqual([])
  })

  test('answers the press the surface reads, and no other', () => {
    const { shortcuts } = registry
    const press = (spelling: Partial<KeyboardEvent>) => spelling as KeyboardEvent

    expect(
      shortcuts.pressed(
        'pages.fit',
        press({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
    expect(shortcuts.pressed('pages.fit', press({ key: '0', code: 'Digit0', ctrlKey: true }))).toBe(
      false,
    )
    expect(
      shortcuts.pressed(
        'pages.zoom.in',
        press({ key: '=', code: 'Equal', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
    expect(
      shortcuts.pressed(
        'pages.zoom.out',
        press({ key: '-', code: 'Minus', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
  })

  /** The gesture is the way in - carry on scrolling past the last page - and the
   *  silhouette at the end of the column is the button. The row is here so a reader
   *  who wants a key can give it one, and a default would be a key taken away from
   *  whatever else they might have wanted it for. */
  test('while adding a page and fitting one start on no key at all', () => {
    expect(registry.shortcuts.keyFor('pages.add')).toBeNull()
    expect(registry.shortcuts.keyFor('pages.fit.page')).toBeNull()
    expect(registry.shortcuts.defaultFor('pages.add')).toBeNull()
  })
})

describe('on a Mac', () => {
  test('the keys are written as a Mac writes them', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    const { shortcuts } = await restarted()

    expect(shortcuts.platform).toBe('mac')
    expect(shortcuts.hint('app.save')).toBe('⌘S')
    expect(shortcuts.hint('paragraph.code-block')).toBe('⇧⌘K')
    // Cmd+Tab never reaches a window there, so the note switcher is Ctrl+Tab.
    expect(shortcuts.keyFor('app.next-note')).toBe('Ctrl-Tab')

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })
})
