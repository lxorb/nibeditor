import { describe, expect, test } from 'vitest'
import {
  type Accounts,
  accountsIn,
  accountsText,
  activated,
  actives,
  activeOf,
  added,
  CLAUDE,
  defaulted,
  isActive,
  merged,
  migrated,
  NONE,
  OPENAI,
  removed,
  resolve,
  updated,
  used,
  vendorOf,
  vendors,
} from './accounts'
import type { ProviderKind } from './providers'

/** Accounts of these kinds, added in this order. */
function made(...kinds: ProviderKind[]): Accounts {
  return kinds.reduce((state, kind) => added(state, kind).state, NONE)
}

describe('who serves an account', () => {
  test('Claude Code and a key are Claude, the three OpenAI roads are OpenAI', () => {
    expect(vendorOf({ id: 'claude-code', kind: 'claude-code' })).toBe(CLAUDE)
    expect(vendorOf({ id: 'anthropic-2', kind: 'anthropic' })).toBe(CLAUDE)
    for (const kind of ['codex', 'chatgpt', 'openai'] as const) {
      expect(vendorOf({ id: kind, kind })).toBe(OPENAI)
    }
  })

  test('each compatible server is a provider of its own', () => {
    expect(vendorOf({ id: 'compatible-2', kind: 'compatible' })).toBe('compatible-2')
  })
})

describe('adding accounts', () => {
  test('the first of a kind keeps the id it always had, the next are counted', () => {
    const state = made('claude-code', 'anthropic', 'openai', 'anthropic', 'compatible', 'openai')
    expect(state.accounts.map((one) => one.id)).toEqual([
      'claude-code',
      'anthropic',
      'openai',
      'anthropic-2',
      'compatible-1',
      'openai-2',
    ])
  })

  test('a provider with none takes the first as its active one and the default', () => {
    const state = made('anthropic')
    expect(state.active).toEqual({ [CLAUDE]: 'anthropic' })
    expect(state.defaultVendor).toBe(CLAUDE)
  })

  test('a later account does not take over from the one that works', () => {
    const state = made('claude-code', 'anthropic')
    expect(activeOf(state, CLAUDE)?.id).toBe('claude-code')
  })

  test('a sign-in to a program or to ChatGPT is one per installation', () => {
    for (const kind of ['chatgpt', 'claude-code', 'codex'] as const) {
      const once = added(NONE, kind)
      const twice = added(once.state, kind)
      expect(twice.state.accounts).toHaveLength(1)
      expect(twice.account.id).toBe(kind)
    }
  })
})

describe('one active account per provider', () => {
  const state = activated(made('claude-code', 'anthropic', 'codex', 'openai'), 'openai')

  test('Claude and OpenAI are active side by side', () => {
    expect(actives(state).map((one) => one.id)).toEqual(['claude-code', 'openai'])
  })

  test('making one active leaves the other provider alone', () => {
    const next = activated(state, 'anthropic')
    expect(next.active).toEqual({ [CLAUDE]: 'anthropic', [OPENAI]: 'openai' })
    expect(isActive(next, 'anthropic')).toBe(true)
    expect(isActive(next, 'claude-code')).toBe(false)
  })

  test('any id of a provider answers with its active account', () => {
    expect(resolve(state, 'codex')?.id).toBe('openai')
    expect(resolve(state, OPENAI)?.id).toBe('openai')
    expect(resolve(state, 'anthropic')?.id).toBe('claude-code')
    expect(resolve(state, 'gone')).toBeNull()
  })

  test('taking the active one away hands its provider to the next', () => {
    const next = removed(state, 'claude-code')
    expect(activeOf(next, CLAUDE)?.id).toBe('anthropic')
    expect(next.active[CLAUDE]).toBe('anthropic')
  })

  test('taking the last one away forgets the provider everywhere', () => {
    const local = added(state, 'compatible').state
    const chosen = used(defaulted(local, 'compatible-1'), 'rewrite', 'compatible-1')
    const next = removed(chosen, 'compatible-1')
    expect(vendors(next)).toEqual([CLAUDE, OPENAI])
    expect(next.uses).toEqual({})
    expect(next.defaultVendor).toBe(CLAUDE)
  })
})

describe('the default and the features', () => {
  const state = made('claude-code', 'anthropic', 'codex')

  test('an account made the default is its provider’s active one too', () => {
    const next = defaulted(state, 'anthropic')
    expect(next.defaultVendor).toBe(CLAUDE)
    expect(next.active[CLAUDE]).toBe('anthropic')
  })

  test('a feature asks a provider, by any of its ids', () => {
    expect(used(state, 'rewrite', 'codex').uses).toEqual({ rewrite: OPENAI })
    expect(used(used(state, 'rewrite', 'codex'), 'rewrite', '').uses).toEqual({})
  })
})

describe('kept and read back', () => {
  test('what is written reads back the same', () => {
    const state = used(
      activated(made('anthropic', 'anthropic', 'openai'), 'anthropic-2'),
      'quick',
      'openai',
    )
    const changed = updated(state, 'anthropic-2', { name: 'Work', model: 'opus' })
    expect(accountsIn(JSON.parse(accountsText(changed)))).toEqual(changed)
  })

  test('nothing that is not an account is let in', () => {
    const read = accountsIn({
      accounts: [
        { id: 'anthropic', kind: 'anthropic', name: '', model: 'x' },
        { id: 'anthropic', kind: 'anthropic', name: 'twice', model: '' },
        { id: '../etc', kind: 'openai', name: '' },
        { id: 'x', kind: 'gemini', name: '' },
        { id: 'openai', kind: 'openai', name: '', own: true },
        'nonsense',
      ],
      active: { claude: 'nobody', openai: 7 },
      defaultVendor: 'nobody',
    })
    expect(read.accounts.map((one) => one.id)).toEqual(['anthropic', 'openai'])
    // A home of nib's is only ever a program's.
    expect(read.accounts[1]?.own).toBeUndefined()
    expect(read.active).toEqual({ [CLAUDE]: 'anthropic', [OPENAI]: 'openai' })
    expect(read.defaultVendor).toBe(CLAUDE)
  })

  test('nothing at all is no accounts', () => {
    expect(accountsIn(null)).toEqual(NONE)
    expect(accountsIn('[]')).toEqual(NONE)
  })
})

describe('from what the window kept before', () => {
  const old = {
    providers: [
      { id: 'claude-code', kind: 'claude-code', name: '', model: '' },
      { id: 'anthropic', kind: 'anthropic', name: '', model: 'claude-opus-5-5' },
      { id: 'codex', kind: 'codex', name: '', model: '' },
      {
        id: 'compatible-1',
        kind: 'compatible',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434',
        model: 'llama',
      },
    ],
    defaultId: 'anthropic',
    uses: { ask: 'claude-code', rewrite: 'compatible-1', quick: 'codex' },
  }

  test('every row keeps its id, so its key and its threads are found', () => {
    expect(migrated(old).accounts.map((one) => one.id)).toEqual([
      'claude-code',
      'anthropic',
      'codex',
      'compatible-1',
    ])
  })

  test('the default row is its provider’s active one, and the others’ first', () => {
    const state = migrated(old)
    expect(state.active).toEqual({
      [CLAUDE]: 'anthropic',
      [OPENAI]: 'codex',
      'compatible-1': 'compatible-1',
    })
    expect(state.defaultVendor).toBe(CLAUDE)
  })

  test('each feature asks the provider its row was', () => {
    expect(migrated(old).uses).toEqual({ ask: CLAUDE, rewrite: 'compatible-1', quick: OPENAI })
  })

  test('nobody’s rows are no accounts', () => {
    expect(migrated(undefined)).toEqual(NONE)
  })

  test('the other profile brings only the rows that are not there yet', () => {
    const kept = migrated(old)
    const other = migrated({
      providers: [
        { id: 'anthropic', kind: 'anthropic', name: 'changed', model: '' },
        { id: 'openai', kind: 'openai', name: '', model: 'gpt-6-astra' },
      ],
      defaultId: 'openai',
    })
    const both = merged(kept, other)
    expect(both.accounts.map((one) => one.id)).toEqual([
      ...kept.accounts.map((one) => one.id),
      'openai',
    ])
    expect(both.accounts[1]?.name).toBe('')
    expect(both.active).toEqual(kept.active)
    expect(merged(kept, NONE)).toBe(kept)
  })
})
