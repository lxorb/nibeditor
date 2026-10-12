/** The accounts as every window shares them: moved out of a window's own storage into the
 *  crate's file once, brought in once more from a second profile, and changed by two
 *  windows at once without either losing the other's change.
 *
 *  The crate's file is stood in for by a text and a stamp in memory, refusing a write
 *  over a stamp that is not the newest as `ai_accounts_write` does; each import of the
 *  store is one window, with a storage of its own. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The crate's file. */
const file = { text: null as string | null, stamp: 0 }
let heard: (() => void)[] = []

vi.mock('./accounts-file', () => ({
  COPY: 'nib:ai-accounts',
  STALE: 'stale',
  readKept: () => Promise.resolve({ text: file.text, stamp: String(file.stamp) }),
  writeKept: (text: string, stamp: string) => {
    if (stamp !== String(file.stamp)) return Promise.reject(new Error('stale'))
    file.text = text
    file.stamp += 1
    for (const one of heard) one()
    return Promise.resolve(String(file.stamp))
  },
  hearChanges: (on: () => void) => {
    heard.push(on)
    return Promise.resolve()
  },
}))

/** One browsing profile's own storage. */
function storage(entries: Record<string, string> = {}): Storage {
  const held = new Map(Object.entries(entries))
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (index) => [...held.keys()][index] ?? null,
    removeItem: (key) => held.delete(key),
    setItem: (key, value) => held.set(key, value),
  }
}

/** A window of the app on a profile, its accounts read from the file. */
async function windowOn(profile: Storage) {
  vi.stubGlobal('localStorage', profile)
  vi.resetModules()
  const { ai } = await import('./store.svelte')
  await vi.waitFor(() => {
    expect(heard.length).toBeGreaterThan(0)
  })
  return ai
}

/** Waits for every write in flight to land. */
async function settled() {
  for (let round = 0; round < 10; round++) await Promise.resolve()
  await new Promise((done) => setTimeout(done, 0))
}

const EARLIER = JSON.stringify({
  providers: [
    { id: 'claude-code', kind: 'claude-code', name: '', model: '' },
    { id: 'anthropic', kind: 'anthropic', name: '', model: 'claude-opus-5-5' },
  ],
  defaultId: 'anthropic',
  uses: { rewrite: 'claude-code' },
})

beforeEach(() => {
  file.text = null
  file.stamp = 0
  heard = []
})

describe('moving the accounts out of one window', () => {
  test('a first window writes what it kept before, with the same ids', async () => {
    const profile = storage({ 'nib:ai': EARLIER })
    const ai = await windowOn(profile)
    await settled()

    const kept = JSON.parse(file.text ?? '{}') as { accounts: { id: string }[]; active: object }
    expect(kept.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
    expect(kept.active).toEqual({ claude: 'anthropic' })
    expect(ai.providerFor('block')?.id).toBe('anthropic')
    // Said once, so a removed account does not come back from the old rows.
    expect(profile.getItem('nib:ai-moved')).toBe('1')
    // The earlier rows are left as they were, for a build from before this one.
    expect(profile.getItem('nib:ai')).toBe(EARLIER)
  })

  test('a window on another engine’s profile starts with the same accounts', async () => {
    await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()

    const other = await windowOn(storage())
    await settled()
    expect(other.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
    expect(other.provider('claude')?.id).toBe('anthropic')
  })

  test('a second profile with rows of its own brings the missing ones, once', async () => {
    await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()

    const theirs = storage({
      'nib:ai': JSON.stringify({
        providers: [
          { id: 'anthropic', kind: 'anthropic', name: 'theirs', model: '' },
          { id: 'openai', kind: 'openai', name: '', model: 'gpt-6-astra' },
        ],
        defaultId: 'openai',
      }),
    })
    const other = await windowOn(theirs)
    await settled()
    expect(other.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic', 'openai'])
    expect(other.accounts[1]?.name).toBe('')

    // Removed in that window, it stays removed the next time the profile starts.
    other.remove('openai')
    await settled()
    const again = await windowOn(theirs)
    await settled()
    expect(again.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
  })
})

describe('two windows at once', () => {
  test('a switch in one is heard by the other', async () => {
    const first = await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()
    const second = await windowOn(storage())
    await settled()

    second.activate('claude-code')
    await settled()
    expect(first.provider('claude')?.id).toBe('claude-code')
  })

  test('changes made over the same text both stay', async () => {
    const first = await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()
    const second = await windowOn(storage())
    await settled()

    // Neither has heard the other's write yet when it writes its own.
    heard = []
    first.update('anthropic', { name: 'Work' })
    second.add('openai')
    await settled()

    const kept = JSON.parse(file.text ?? '{}') as { accounts: { id: string; name: string }[] }
    expect(kept.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic', 'openai'])
    expect(kept.accounts[1]?.name).toBe('Work')
  })
})
