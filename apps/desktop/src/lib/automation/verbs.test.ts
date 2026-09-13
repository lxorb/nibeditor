import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'

/** The stores read the browser's storage and ask what kind of machine this is, and
 *  there is neither under node; see app-menu.test.ts, which does the same. */
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

/** Loaded once, at module scope: the table reaches half the app through the
 *  workspace and the command registry, and compiling that belongs to no one test.
 *  See docs/conventions.md. */
const { dispatch, isVerb, linkHearsFrom, verbForAction } = await import('./verbs')

/** Every verb the app has, asked of the app. */
async function verbs(): Promise<string[]> {
  const answered = await dispatch('verbs', {})
  expect(answered.ok).toBe(true)

  const value = answered.ok ? answered.value : null
  const said = (value as { verbs?: string[] } | null)?.verbs ?? []
  expect(said.length).toBeGreaterThan(20)

  return said
}

describe('the table', () => {
  test('answers its own list of verbs', async () => {
    expect(await verbs()).toContain('files.read')
  })

  test('says so plainly about a verb that does not exist', async () => {
    expect(await dispatch('nonsense', {})).toEqual({
      ok: false,
      error: 'there is no verb called nonsense',
    })
  })

  test('joins a verb written as two words, which is how a terminal sends one', async () => {
    // The space is what stops it: there is no workspace under node, and reaching
    // that refusal is the proof the two words became `files.list` and ran it.
    expect(await dispatch('files', {}, ['list'])).toEqual({
      ok: false,
      error: 'there is no space open',
    })
  })

  test('leaves a one-word verb alone even when a value follows it', async () => {
    expect(await dispatch('tags', {}, ['list'])).toEqual({
      ok: false,
      error: 'there is no space open',
    })
  })

  test('will not change anything until the caller says yes', async () => {
    for (const verb of ['files.write', 'files.move', 'files.delete', 'properties.set', 'eval']) {
      expect(await dispatch(verb, {}), verb).toEqual({
        ok: false,
        error: `${verb} changes something: say yes to go ahead`,
      })
    }
  })

  test('answers rather than throwing when a verb says no', async () => {
    const answered = await dispatch('files.read', { path: '../outside.md' })
    expect(answered).toEqual({ ok: false, error: 'there is no space open' })
  })
})

describe('what a link may ask for', () => {
  /** The whole security surface of the scheme, pinned. A link can be written by
   *  anybody and sent to anybody, so this list growing is a decision rather than a
   *  side effect of adding a verb. */
  test('is these five actions and nothing else', async () => {
    const actions = [...(await verbs()), 'command', 'nonsense']
    const allowed = actions.filter((one) => verbForAction(one) !== null)

    expect(allowed.sort()).toEqual(['append', 'command', 'new', 'open', 'search'])
  })

  test('reads `command` as the row the palette runs', () => {
    expect(verbForAction('command')).toBe('commands.run')
    // And not by its command-line name, which a link has no business knowing.
    expect(verbForAction('commands.run')).toBeNull()
  })

  test('and hears how it went only from the verbs that changed something', async () => {
    const heard = (await verbs()).filter((verb) => linkHearsFrom(verb))

    // `new` and `append` were told the path by the caller, so saying it back tells the
    // caller nothing it did not write - only whether the note was made or added to.
    // Every other link verb answers a question about the space - `open` answers the
    // path it landed on - and a link's outcome goes to an address the link itself
    // chose; see `byLink` in verbs.ts.
    expect(heard).toEqual(['append', 'new'])
    expect(linkHearsFrom('open')).toBe(false)
    // Not even the verbs no link may ask for, so widening one column cannot quietly
    // widen the other.
    expect(linkHearsFrom('files.read')).toBe(false)
  })

  test('tells a verb it declines apart from a name it does not know', () => {
    expect(isVerb('files.delete')).toBe(true)
    expect(isVerb('command')).toBe(true)
    expect(isVerb('nonsense')).toBe(false)
  })
})

describe('the command line', () => {
  /** The one thing `nib.mjs` says about the verbs is its usage text, so this is
   *  what keeps it from going stale: a verb added to the table and not to the help
   *  is a verb nobody can find. */
  test('names every verb in its help, in the spelling a terminal takes', async () => {
    const usage = readFileSync(
      fileURLToPath(new URL('../../../../cli/nib.mjs', import.meta.url)),
      'utf8',
    )

    const missing = (await verbs()).filter((verb) => !usage.includes(`  ${verb.replace('.', ' ')}`))
    expect(missing).toEqual([])
  })
})
