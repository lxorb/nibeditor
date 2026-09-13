import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@nib/editor'
import { glassesBreak, KEEP_MONTH, KEEP_YEAR, rollbackSteps } from './modes.svelte'

/** The store writes to the browser's storage the moment anything is toggled,
 *  and sets the zoom on the document element. Under node there is neither, so
 *  both are stood in for before the store is imported. */
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
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined } } })

/** What the two modes under test were last told. The editor's own side of
 *  them is tested in packages/editor; what matters here is that the store
 *  says the same thing to a view as it says in the menu. */
const told = vi.hoisted(() => ({ calls: [] as { mode: string; on: boolean }[] }))

vi.mock('@nib/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nib/editor')>()),
  setReadOnlyMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'read-only', on }),
  setSourceMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'source', on }),
  setVim: (_view: unknown, on: boolean) => told.calls.push({ mode: 'vim', on }),
  // A view built later takes every mode at once rather than one at a time, so
  // this is where the store says what it holds to a fresh editor.
  modeEffects: (settings: { readOnly: boolean; source: boolean; vim: boolean }) => {
    told.calls.push({ mode: 'read-only', on: settings.readOnly })
    told.calls.push({ mode: 'source', on: settings.source })
    told.calls.push({ mode: 'vim', on: settings.vim })
    return []
  },
}))

/** The account, standing still. One object across module resets, so a test can
 *  swap a call out and the store made afterwards still sees it. */
const api = vi.hoisted(() => {
  const empty: Held = {}

  return {
    settings: async () => ({ settings: empty }),
    saveSettings: async (_token: string, _patch: Held) => ({ settings: empty }),
  }
})

/** As much of the account's settings as these tests are about. */
interface Held {
  ligatures?: boolean | string
  attachments?: string
  vim?: boolean
  glassesSeen?: boolean
}

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api,
}))

/** Everything the other mode setters reach for on a view, and nothing else. */
function surface() {
  const view = {
    state: { readOnly: false },
    dispatch: () => undefined,
    focus: () => undefined,
    requestMeasure: () => undefined,
    contentDOM: { setAttribute: () => undefined },
    dom: {
      isConnected: false,
      style: { setProperty: () => undefined },
      classList: {
        toggle: () => undefined,
        remove: () => undefined,
        add: () => undefined,
      },
    },
  }

  return view as unknown as EditorView
}

let modes: typeof import('./modes.svelte').modes

/** The store's graph, loaded here rather than by the first `restarted()`, which
 *  is a hook with a budget: whichever test ran first spent thirty seconds of it
 *  compiling. See docs/conventions.md. */
await import('./modes.svelte')

/** The store as a fresh start of the app would find it. */
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}

beforeEach(async () => {
  localStorage.clear()
  told.calls = []
  modes = await restarted()
})

describe('read-only mode', () => {
  test('starts off', () => {
    expect(modes.readOnly).toBe(false)
  })

  test('is remembered across a restart', async () => {
    modes.toggleReadOnly()
    expect(modes.readOnly).toBe(true)

    expect((await restarted()).readOnly).toBe(true)
  })

  test('reaches the view it is toggled against', () => {
    modes.toggleReadOnly(surface())
    expect(told.calls).toContainEqual({ mode: 'read-only', on: true })
  })

  test('is put back on a view built later', () => {
    modes.toggleReadOnly()
    told.calls = []

    modes.apply(surface())

    expect(told.calls).toContainEqual({ mode: 'read-only', on: true })
  })

  test('and stays off on one when it is off', () => {
    modes.apply(surface())
    expect(told.calls).toContainEqual({ mode: 'read-only', on: false })
  })
})

/** The Glasses section, which only the Even Hub plugin shows.
 *
 *  Written against the live store and the validator rather than through a module
 *  restart: the restart harness in this file is already at its timeout, and what
 *  is worth pinning here is the rule, not the reload. */
describe('the glasses settings', () => {
  const saved = () =>
    JSON.parse(localStorage.getItem('nib:modes') ?? '{}') as Record<string, unknown>

  test('start a page at H2 and above, with the note’s own line numbers', () => {
    expect(modes.glassesBreak).toBe(2)
    expect(modes.glassesLineNumbers).toBe(true)
  })

  /** Two settings the glasses section used to have and has not got: the page
   *  number, and who scrolls. Both are one behaviour now - the app cuts the note
   *  into panels and turns them, and the number always means a page - so neither
   *  is a field, and a value left in storage by a version that had them is dropped
   *  rather than read. See even/settings.ts. */
  test('carry no scroll mode, and drop one an older version wrote down', async () => {
    localStorage.setItem(
      'nib:modes',
      JSON.stringify({ glassesScroll: 'native', glassesLineNumbers: false }),
    )

    const back = await restarted()
    expect(back.glassesLineNumbers).toBe(false)
    expect(saved()).not.toHaveProperty('glassesScroll')
    expect(Object.keys(back as unknown as Record<string, unknown>)).not.toContain('glassesScroll')
  })

  test('start with the microphone off, which is the only defensible default', () => {
    expect(modes.glassesVoice).toBe(false)
  })

  test('start with no model, because there is nothing to guess', () => {
    expect(modes.glassesModel).toBe('')
    expect(modes.glassesEffort).toBe('low')
  })

  test('take a heading level and write it down', () => {
    modes.setGlassesBreak('3')
    expect(modes.glassesBreak).toBe(3)
    expect(saved().glassesBreak).toBe(3)

    modes.setGlassesBreak('0')
    expect(modes.glassesBreak).toBe(0)
  })

  test('ignore a heading level there is no such thing as', () => {
    modes.setGlassesBreak('2')
    modes.setGlassesBreak('9')
    modes.setGlassesBreak('nowhere')
    expect(modes.glassesBreak).toBe(2)
  })

  test('read a level whether it arrives as a number or as a word', () => {
    expect(glassesBreak(2)).toBe(2)
    expect(glassesBreak('2')).toBe(2)
    expect(glassesBreak(0)).toBe(0)
    expect(glassesBreak(7)).toBeNull()
    expect(glassesBreak(true)).toBeNull()
    expect(glassesBreak(undefined)).toBeNull()
  })

  test('take the two switches and write them down', () => {
    modes.setGlassesLineNumbers(false)
    modes.setGlassesVoice(true)

    expect(saved().glassesLineNumbers).toBe(false)
    expect(saved().glassesVoice).toBe(true)
  })

  test('take a model and an effort the API knows', () => {
    modes.setGlassesModel('gpt-6-astra')
    modes.setGlassesEffort('high')

    expect(saved().glassesModel).toBe('gpt-6-astra')
    expect(saved().glassesEffort).toBe('high')
  })

  test('ignore an effort the API does not take', () => {
    modes.setGlassesEffort('medium')
    modes.setGlassesEffort('banana')
    expect(modes.glassesEffort).toBe('medium')
  })
})

/** Smart punctuation, which used to be on because Typora has it on.
 *
 *  It changes the file rather than the way the file is drawn, and the dashes did
 *  it worst: a deck Emil wrote held an em dash where every slide break should
 *  have been. So it is off, and a reader who never chose keeps it off. */
describe('smart punctuation', () => {
  test('starts off', () => {
    expect(modes.punctuation).toBe(false)
  })

  test('stays off for a reader who never chose', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ focus: true }))
    expect((await restarted()).punctuation).toBe(false)
  })

  test('and stays on for one who turned it on', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ punctuation: true }))
    expect((await restarted()).punctuation).toBe(true)
  })

  test('is remembered across a restart', async () => {
    modes.togglePunctuation()
    expect(modes.punctuation).toBe(true)
    expect((await restarted()).punctuation).toBe(true)
  })
})

describe('the ligature scope', () => {
  test('starts off', () => {
    expect(modes.ligatures).toBe('off')
  })

  test('is remembered across a restart', async () => {
    modes.setLigatures('code')
    expect((await restarted()).ligatures).toBe('code')
  })

  /** A switch is what an entry written before the scope existed says, and a
   *  scope this build has never heard of is what one written after it might. */
  test('reads a switch written by an older build', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: true }))
    expect((await restarted()).ligatures).toBe('all')

    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: false }))
    expect((await restarted()).ligatures).toBe('off')
  })

  test('falls back to off for a scope it does not know', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: 'sometimes' }))
    expect((await restarted()).ligatures).toBe('off')
  })

  test('ignores a scope it does not know when one is chosen', () => {
    modes.setLigatures('code')
    modes.setLigatures('sometimes')
    expect(modes.ligatures).toBe('code')
  })
})

describe('modal editing', () => {
  test('starts off', () => {
    expect(modes.vim).toBe(false)
  })

  test('is remembered across a restart', async () => {
    modes.toggleVim()
    expect(modes.vim).toBe(true)

    expect((await restarted()).vim).toBe(true)
  })

  test('reaches every editor on the page, not only the one it was toggled at', () => {
    modes.apply(surface())
    told.calls = []

    modes.toggleVim(surface())

    expect(told.calls.filter((one) => one.mode === 'vim')).toEqual([
      { mode: 'vim', on: true },
      { mode: 'vim', on: true },
    ])
  })

  test('is put back on a view built later', () => {
    modes.toggleVim()
    told.calls = []

    modes.apply(surface())

    expect(told.calls).toContainEqual({ mode: 'vim', on: true })
  })

  /** A preset says which it wants rather than that it wants the other one, so
   *  choosing the same preset twice does not turn modal editing off again. */
  test('is said outright rather than flipped', () => {
    modes.setVimKeys(true)
    modes.setVimKeys(true)
    expect(modes.vim).toBe(true)

    told.calls = []
    modes.setVimKeys(true)
    expect(told.calls).toEqual([])
  })

  test('has no mode to show while it is off', () => {
    expect(modes.vimModeOf(surface())).toBeNull()
    expect(modes.vimModeOf(undefined)).toBeNull()
  })

  /** The one setting in the app that changes what every key on the keyboard
   *  does. A reader who did not ask for it and does not know the word is left
   *  with an editor that swallows what they type, so nothing may turn it on but
   *  a hand: not a default, not an absent value, not a restart, not a fresh
   *  view, and not an account that has never said anything about it. */
  describe('only ever turns on by hand', () => {
    test('on a machine with nothing written down', () => {
      expect(modes.vim).toBe(false)
    })

    test('on a machine whose entry was written before there was such a setting', async () => {
      localStorage.setItem('nib:modes', JSON.stringify({ zoom: 1.1, focus: true }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('on a machine that wrote it down as off', async () => {
      localStorage.setItem('nib:modes', JSON.stringify({ vim: false }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('with an entry that says null, which is not a choice either', async () => {
      localStorage.setItem('nib:modes', JSON.stringify({ vim: null }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('through a restart after every other mode was turned on', async () => {
      modes.toggleFocus()
      modes.toggleTypewriter()
      modes.toggleSource()
      modes.setLigatures('all')

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('when a pane builds a fresh editor', () => {
      modes.apply(surface())

      expect(modes.vim).toBe(false)
      expect(told.calls).toContainEqual({ mode: 'vim', on: false })
      expect(told.calls).not.toContainEqual({ mode: 'vim', on: true })
    })
  })

  /** The words the status bar shows, which the editor package reports the
   *  modes for; every one of them is translated in all four dictionaries. */
  test('has a word for every mode it has', async () => {
    const { VIM_WORDS } = await import('./modes.svelte')
    expect(Object.values(VIM_WORDS)).toEqual(['NORMAL', 'INSERT', 'VISUAL', 'REPLACE'])
  })
})

describe('read-only mode and source mode', () => {
  test('are never both on', () => {
    modes.toggleSource()
    modes.toggleReadOnly()

    expect(modes.readOnly).toBe(true)
    expect(modes.source).toBe(false)

    modes.toggleSource()

    expect(modes.source).toBe(true)
    expect(modes.readOnly).toBe(false)
  })

  test('cannot both come back from a hand-edited entry', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ source: true, readOnly: true }))

    const restored = await restarted()
    expect(restored.source).toBe(true)
    expect(restored.readOnly).toBe(false)
  })

  test('the one that was on is the one that comes back', async () => {
    modes.toggleReadOnly()

    const restored = await restarted()
    expect(restored.readOnly).toBe(true)
    expect(restored.source).toBe(false)
  })
})

describe('taking over what the account holds', () => {
  /** Answers the account's settings, but only once released - so a choice can
   *  be made on this machine while the answer is still in the air. */
  function heldAnswer(settings: Held) {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const settingsCall = async () => {
      await held
      return { settings }
    }

    return { release, settingsCall }
  }

  test('brings a setting this machine has never chosen', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'code' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('code')
  })

  /** The ligature setting was a switch before it was a scope, and an account
   *  written by that build still says so. */
  test('reads a switch from an older build as a scope', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('all')
  })

  test('and reads false as off', async () => {
    modes.setLigatures('all')
    const { release, settingsCall } = heldAnswer({ ligatures: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('ignores a scope it has never heard of', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'sometimes' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('leaves alone a choice made while the answer was in the air', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'all' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    // The reader picks a scope and goes back to off before the account answers.
    // The answer is older than that, and `setLigatures` has already sent this
    // machine's choice up.
    modes.setLigatures('code')
    modes.setLigatures('off')

    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  /** An account is read by every version of the app at once, and a build that
   *  had no such setting says nothing about it. Nothing is not `false`, and it is
   *  certainly not `true`: only an account that says so outright may turn modal
   *  editing on. */
  test('says nothing about modal editing unless the account does', async () => {
    for (const settings of [{}, { ligatures: 'all' }, { attachments: 'note' }] as Held[]) {
      const store = await restarted()
      const { release, settingsCall } = heldAnswer(settings)
      api.settings = settingsCall

      const adopted = store.adopt('token')
      release()
      await adopted

      expect(store.vim, JSON.stringify(settings)).toBe(false)
    }
  })

  test('leaves modal editing off for an account that wrote it down as off', async () => {
    const { release, settingsCall } = heldAnswer({ vim: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.vim).toBe(false)
    expect(told.calls).not.toContainEqual({ mode: 'vim', on: true })
  })

  test('brings modal editing another machine turned on', async () => {
    const { release, settingsCall } = heldAnswer({ vim: true })
    api.settings = settingsCall
    modes.apply(surface())
    told.calls = []

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.vim).toBe(true)
    expect(told.calls).toContainEqual({ mode: 'vim', on: true })
  })

  test('brings the attachment folder another machine chose', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'named' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.attachments).toBe('named')
  })

  test('leaves a folder chosen while the answer was in the air', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'named' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    modes.setAttachments('note')

    release()
    await adopted

    expect(modes.attachments).toBe('note')
  })

  test('ignores a folder no version of the app knows', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'vault' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.attachments).toBe('space')
  })

  /** Emil, on his desktop: *"I don't see the glasses setting on desktop, even though I
   *  already had the Even plugin open."* His account said nothing about `glassesSeen`
   *  and plenty about the glasses settings he changed later in the same sitting, which
   *  is the whole story: the plugin sees a pair within a moment of starting, the
   *  session on a phone takes seconds to come back from the host app, and a patch with
   *  nowhere to go was dropped for good. */
  test('carries up what was decided before the session came back', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({})
    api.settings = settingsCall

    // A plugin at the moment it starts: a pair of glasses has answered and there is
    // no session to tell yet.
    modes.sawGlasses()
    expect(modes.glassesSeen).toBe(true)
    expect(patches).toEqual([])

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(patches).toEqual([{ glassesSeen: true }])
  })

  test('and keeps owing it where the account could not be reached', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      throw new Error('offline')
    }
    api.settings = async () => {
      throw new Error('offline')
    }

    modes.sawGlasses()
    expect(await modes.adopt('token')).toBeNull()
    expect(patches).toEqual([{ glassesSeen: true }])

    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({})
    api.settings = settingsCall
    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(patches).toEqual([{ glassesSeen: true }, { glassesSeen: true }])
  })

  /** The desktop half of the round trip: the flag comes down, the pane appears, and
   *  nothing on this machine says it again. See services/sync/test/settings.test.ts
   *  for the round trip through the Worker itself. */
  test('takes it from the account, and then has nothing left to say', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({ glassesSeen: true })
    api.settings = settingsCall

    expect(modes.glassesSeen).toBe(false)
    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.glassesSeen).toBe(true)
    modes.sawGlasses()
    expect(patches).toEqual([])
  })
})

describe('where a pasted picture goes', () => {
  test("starts in the space's assets folder, which is where it always went", () => {
    expect(modes.attachments).toBe('space')
  })

  test('is remembered across a restart', async () => {
    modes.setAttachments('named')
    expect((await restarted()).attachments).toBe('named')
  })

  test('takes only one of the three names', async () => {
    modes.setAttachments('sideways')
    expect(modes.attachments).toBe('space')

    localStorage.setItem('nib:modes', JSON.stringify({ attachments: 'sideways' }))
    expect((await restarted()).attachments).toBe('space')
  })
})

/** The row reaches as far as the account keeps and no further: a step asking for a
 *  moment before the first version there is would answer "nothing has changed since
 *  then", which is a wrong answer rather than a refusal. */
describe('how far back a bulk restore offers to go', () => {
  test('is three steps while the account keeps a month', () => {
    expect(rollbackSteps(KEEP_MONTH)).toEqual([1, 7, 30])
  })

  test('and reaches the year when the account keeps one', () => {
    expect(rollbackSteps(KEEP_YEAR)).toEqual([1, 7, 30, 90, 180, 365])
    expect(rollbackSteps(KEEP_YEAR).at(-1)).toBe(KEEP_YEAR)
  })

  test('and never past the horizon, whatever the horizon is', () => {
    for (const keep of [1, 7, 29, 30, 100, 365, 4000]) {
      for (const step of rollbackSteps(keep)) expect(step).toBeLessThanOrEqual(keep)
    }

    expect(rollbackSteps(0)).toEqual([])
  })

  test('and follows the setting, which is what puts the year in the row', () => {
    modes.setKeepVersions(KEEP_YEAR)
    expect(rollbackSteps(modes.keepVersions)).toContain(365)

    modes.setKeepVersions(KEEP_MONTH)
    expect(rollbackSteps(modes.keepVersions)).not.toContain(365)
  })
})
