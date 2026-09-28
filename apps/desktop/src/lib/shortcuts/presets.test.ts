import { beforeAll, describe, expect, test, vi } from 'vitest'
import { defaultKeyFor } from '@nib/editor'
import { parseCombination, type Platform, sameCombination } from '../keys'

/** The registry reaches the stores, which write to the browser's storage and
 *  ask the browser what kind of machine this is. There is neither under node,
 *  so both are stood in for before anything is imported. */
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

let registry: typeof import('./registry')
let presets: typeof import('./presets')
let names: typeof import('./preset-ids')

/** A budget of its own, because what this hook does is compile the registry's graph -
 *  half the app, cold, on whatever cores are left. Thirty seconds is enough on a quiet
 *  machine and not enough on one that is also building something else, and a timeout
 *  here skips every test in the file rather than failing one. Nothing here asserts on
 *  time; see docs/conventions.md. */
beforeAll(async () => {
  registry = await import('./registry')
  presets = await import('./presets')
  names = await import('./preset-ids')
}, 240_000)

const PLATFORMS: Platform[] = ['mac', 'win', 'linux']

/** The key an entry answers to under a preset: what the preset says, or what
 *  the app says when the preset does not mention it. The same reading the
 *  store does; see keyFor in shortcuts.svelte.ts. */
function keyUnder(keys: Record<string, string | null>, id: string, platform: Platform) {
  const chosen = keys[id]
  if (chosen !== undefined) return chosen

  const entry = registry.BY_ID.get(id)
  return entry ? defaultKeyFor(entry, platform) : null
}

describe('every keyboard there is', () => {
  test('has a name of its own and one entry per name', () => {
    const ids = presets.PRESETS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('default')
    expect(ids).toContain('vim')
  })

  /** The launch reads the names without the maps, so the two lists are one list. */
  test('is every name the launch knows, in the same order', () => {
    expect(presets.PRESETS.map((one) => one.id)).toEqual([...names.PRESET_IDS])
  })

  test('leaves the default map alone, which is what Default means', () => {
    expect(presets.presetById('default')?.keys).toEqual({})
  })

  test('is modal editing only where it says so', () => {
    expect(presets.presetById('vim')?.vim).toBe(true)
    expect(presets.presetById('obsidian')?.vim).toBe(false)
    expect(presets.presetById('notion')?.vim).toBe(false)
    expect(presets.presetById('vscode')?.vim).toBe(false)
  })
})

describe.each(['default', 'notion', 'obsidian', 'vscode', 'vim'])('the %s keyboard', (id) => {
  const keysOf = () => presets.presetById(id)?.keys ?? {}

  /** A preset that names a shortcut this version does not have would be a key
   *  that goes nowhere, and nothing in the settings would show it. */
  test('names only shortcuts the app has', () => {
    const unknown = Object.keys(keysOf()).filter((one) => !registry.BY_ID.has(one))
    expect(unknown).toEqual([])
  })

  test('never touches a key that cannot be changed', () => {
    const fixed = Object.keys(keysOf()).filter((one) => registry.BY_ID.get(one)?.scope === 'fixed')
    expect(fixed).toEqual([])
  })

  /** Every key it writes has to be one the app would take from a reader: the
   *  recorder refuses a bare letter, and a preset may not smuggle one in. */
  test('writes every key the way the app writes them', () => {
    const wrong: string[] = []

    for (const [one, key] of Object.entries(keysOf())) {
      if (key === null) continue

      const combination = parseCombination(key, 'win')
      if (!combination) wrong.push(`${one}: ${key} is not a combination`)
      else if (
        !combination.ctrl &&
        !combination.meta &&
        !combination.alt &&
        combination.key.length === 1
      ) {
        wrong.push(`${one}: ${key} would fire while typing`)
      }
    }

    expect(wrong).toEqual([])
  })

  /** The narrowest form of the guard below, and the one a hand-written map gets wrong
   *  first: the same chord written twice in the preset itself. */
  test.each(PLATFORMS)('writes no chord twice (%s)', (platform) => {
    const written = Object.entries(keysOf()).filter(
      (pair): pair is [string, string] => pair[1] !== null,
    )
    const twice: string[] = []

    written.forEach(([one, key], index) => {
      for (const [other, held] of written.slice(index + 1)) {
        if (sameCombination(key, held, platform)) twice.push(`${one} and ${other} on ${key}`)
      }
    })

    expect(twice).toEqual([])
  })

  /** The guard the whole idea hangs on. Two actions on one key means one of
   *  them never fires, and a preset is a map nobody checked by hand. Walks
   *  every action there is, not only the ones the preset mentions: taking a
   *  key for Notion's inline code is how Nib's reading view loses one. */
  test.each(PLATFORMS)('leaves nothing on a key something else is on (%s)', (platform) => {
    const keys = keysOf()
    const held = new Map<string, string>()
    const clashes: string[] = []

    for (const entry of registry.SHORTCUTS) {
      // The contextual ones look for a table or a picture where the caret is
      // and give way when it is not there, which is how six of them share the
      // arrow keys with the editor's own motion.
      if (entry.contextual || entry.scope === 'fixed') continue

      const key = keyUnder(keys, entry.id, platform)
      if (!key) continue

      for (const [taken, by] of held) {
        if (sameCombination(taken, key, platform)) {
          clashes.push(`${entry.id} and ${by} are both on ${key}`)
        }
      }
      held.set(key, entry.id)
    }

    expect(clashes).toEqual([])
  })

  /** The other half of that guard, for the keys the app reads by hand.
   *
   *  A contextual binding in the editor gives way: CodeMirror tries the next one
   *  when it answers false, which is how Delete belongs to a table and to a
   *  selected picture at once. The file list's and the plane's do not - they are
   *  read where the surface is, off its own element, and the press goes on up to
   *  the window afterwards. So a key that is one of those and an app key as well
   *  fires both: the plane zooms to what is picked and the strip switches note,
   *  from one press. */
  test.each(PLATFORMS)('leaves the plane and the file list their own keys (%s)', (platform) => {
    const keys = keysOf()
    const clashes: string[] = []

    const surfaces = registry.SHORTCUTS.filter((one) => one.contextual && one.scope === 'panel')
    const app = registry.SHORTCUTS.filter((one) => !one.contextual && one.scope === 'app')

    for (const entry of surfaces) {
      const key = keyUnder(keys, entry.id, platform)
      if (!key) continue

      for (const other of app) {
        const held = keyUnder(keys, other.id, platform)
        if (held && sameCombination(held, key, platform)) {
          clashes.push(`${entry.id} and ${other.id} are both on ${key}`)
        }
      }
    }

    expect(clashes).toEqual([])
  })
})

/** One keyboard is not the place to decide where the command palette lives: every
 *  editor that has one puts it on Ctrl+Shift+P, and none of the three keyboards here
 *  binds that chord to anything of its own. So the default reaches all of them, which
 *  is what a preset holding only its differences means - and Paragraph, which held the
 *  chord, is without a key under every one of them. */
describe.each(['default', 'notion', 'obsidian', 'vscode', 'vim'])('the %s keyboard', (id) => {
  test('opens the commands on Ctrl+Shift+P, and leaves Paragraph no key', () => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.commands', platform), platform).toBe('Mod-Shift-p')
      expect(keyUnder(keys, 'paragraph.body', platform), platform).toBeNull()
    }
  })

  /** Ctrl+T asks which kind under every keyboard: none of the three binds the chord to
   *  anything of its own, and a new tab is a new tab wherever a hand learned it. */
  test('asks what kind a new tab is on Ctrl+T', () => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.new-kind', platform), platform).toBe('Mod-t')
    }
  })
})

describe('the Obsidian keyboard', () => {
  test('puts the digits on the notes, the way Obsidian does', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['app.note-1']).toBe('Mod-1')
    expect(keys['app.note-9']).toBe('Mod-9')
    // Which is why the heading levels are left without one; they are still in
    // the Paragraph menu and the palette.
    expect(keys['paragraph.heading-1']).toBeNull()
    expect(keys['paragraph.heading-6']).toBeNull()
  })

  test('gives the split, the graph and following a link their keys', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['pane.split-right']).toBe('Mod-\\')
    expect(keys['pane.split-down']).toBe('Mod-Shift-\\')
    expect(keys['app.graph']).toBe('Mod-g')
    expect(keys['edit.follow-link']).toBe('Alt-Enter')
  })

  test('leaves what Nib and Obsidian already agree on alone', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    // Ctrl+E reading, Ctrl+N new note, Ctrl+W close, Ctrl+Shift+F search, Ctrl+K
    // link: all of them are Nib's own already.
    for (const id of ['app.reading', 'app.new', 'app.close', 'format.link']) {
      expect(keys[id], id).toBeUndefined()
    }
  })

  /** Obsidian's two: the quick switcher on Ctrl+O and the command palette on Ctrl+P,
   *  which are Nib's one palette opened on the notes and on the commands. */
  test('opens the palette on the notes on Ctrl+O and on the commands on Ctrl+P', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['app.palette']).toBe('Mod-o')
    expect(keys['app.commands.alt']).toBe('Mod-p')
    expect(keys['app.open']).toBeNull()
    expect(registry.BY_ID.get('app.commands.alt')?.alias).toBe(true)
  })

  test('goes back and forward on Ctrl+Alt and an arrow, and deletes the line on Ctrl+D', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.back', platform), platform).toBe('Mod-Alt-ArrowLeft')
      expect(keyUnder(keys, 'app.forward', platform), platform).toBe('Mod-Alt-ArrowRight')
      expect(keyUnder(keys, 'edit.delete-line', platform), platform).toBe('Mod-d')
      expect(keyUnder(keys, 'edit.select-word', platform), platform).toBeNull()
    }
  })
})

/** Nib indents on Ctrl+[ and outdents on Ctrl+], which is Typora's order. VS Code,
 *  Obsidian and CodeMirror have it the other way round, and so do their keyboards
 *  here; the default is left as Typora's. */
describe('the brackets', () => {
  test('indent on Ctrl+[ under the default keyboard', () => {
    for (const platform of PLATFORMS) {
      expect(keyUnder({}, 'edit.indent', platform), platform).toBe('Mod-[')
      expect(keyUnder({}, 'edit.outdent', platform), platform).toBe('Mod-]')
    }
  })

  test.each(['vscode', 'obsidian'])('indent on Ctrl+] under %s', (id) => {
    const keys = presets.presetById(id)?.keys ?? {}

    expect(keys['edit.indent']).toBe('Mod-]')
    expect(keys['edit.outdent']).toBe('Mod-[')
  })
})

describe('the VS Code keyboard', () => {
  const keys = () => presets.presetById('vscode')?.keys ?? {}

  test("puts VS Code's keys on the editor's commands", () => {
    for (const platform of PLATFORMS) {
      const on = (id: string) => keyUnder(keys(), id, platform)

      expect(on('edit.goto-line'), platform).toBe('Ctrl-g')
      expect(on('edit.delete-line'), platform).toBe('Mod-Shift-k')
      expect(on('edit.select-all-occurrences'), platform).toBe('Mod-Shift-l')
      expect(on('pane.split-right'), platform).toBe('Mod-\\')
    }
  })

  /** Already Nib's own, so the preset says nothing about them and they reach it. */
  test('grows and shrinks the selection on Shift+Alt and an arrow, as Nib already does', () => {
    expect(keys()['edit.expand-selection']).toBeUndefined()
    expect(keyUnder(keys(), 'edit.expand-selection', 'win')).toBe('Shift-Alt-ArrowRight')
    expect(keyUnder(keys(), 'edit.shrink-selection', 'linux')).toBe('Shift-Alt-ArrowLeft')
  })

  /** Ctrl+B is VS Code's sidebar and every markdown editor's bold, and a note is
   *  markdown: bold keeps it, and the sidebar is left without a key. */
  test('keeps Ctrl+B on bold', () => {
    expect(keys()['format.bold']).toBeUndefined()
    expect(keys()['app.sidebar']).toBeNull()
    expect(keyUnder(keys(), 'app.files', 'win')).toBe('Mod-Shift-e')
  })

  test('leaves find next on F3, and Code block and clear formatting without a key', () => {
    expect(keys()['edit.find-next']).toBeNull()
    expect(keyUnder(keys(), 'edit.find-next.alt', 'win')).toBe('F3')
    expect(keys()['paragraph.code-block']).toBeNull()
    expect(keys()['format.clear']).toBeNull()
  })
})

describe('the Notion keyboard', () => {
  test('puts the block types on the numbers, the way Notion does', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    // Every one of them but Paragraph, which Notion puts on Ctrl+Shift+0: the nought
    // is the shifted character on AZERTY, so that chord is Ctrl+0 there as well, and
    // Ctrl+0 is the text size. Paragraph has no key under any keyboard now - a heading
    // key pressed on the level it already set is what turns the line back into prose.
    expect(keys['paragraph.body']).toBeUndefined()
    expect(keys['paragraph.heading-1']).toBe('Mod-Shift-1')
    expect(keys['paragraph.bullet-list']).toBe('Mod-Shift-5')
    expect(keys['paragraph.ordered-list']).toBe('Mod-Shift-6')
    expect(keys['paragraph.code-block']).toBe('Mod-Shift-8')
  })

  test('gives inline code Ctrl+E and the sidebar Ctrl+backslash', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    expect(keys['format.code']).toBe('Mod-e')
    expect(keys['app.sidebar']).toBe('Mod-\\')
    // Which leaves the two Nib actions that were on those keys without one.
    expect(keys['app.reading']).toBeNull()
    expect(keys['format.clear']).toBeNull()
  })

  test('duplicates the block on Ctrl+D and moves it on Ctrl+Shift and an arrow', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    expect(keys['edit.duplicate-block']).toBe('Mod-d')
    expect(keys['edit.move-block-up']).toBe('Mod-Shift-ArrowUp')
    expect(keys['edit.move-block-down']).toBe('Mod-Shift-ArrowDown')
    expect(keys['edit.select-word']).toBeNull()
  })
})

describe('a name written down or carried by the account', () => {
  test('is taken when it is one this version has', () => {
    expect(names.knownPreset('obsidian')).toBe('obsidian')
    expect(names.knownPreset('vscode')).toBe('vscode')
    expect(names.knownPreset('custom')).toBe('custom')
  })

  test('is no opinion at all when there is none', () => {
    expect(names.knownPreset(undefined)).toBeNull()
    expect(names.knownPreset('')).toBeNull()
    expect(names.knownPreset(7)).toBeNull()
  })

  /** A preset a newer app added is a map this one cannot put a name to, which
   *  is what Custom is for. The keys themselves still arrive. */
  test('reads as Custom when it is one this version has never heard of', () => {
    expect(names.knownPreset('emacs')).toBe('custom')
    // And the Settings sheet, handed one, chooses nothing.
    expect(presets.presetById('emacs')).toBeUndefined()
  })
})
