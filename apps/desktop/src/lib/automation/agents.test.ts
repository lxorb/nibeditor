/** An agent at the dispatcher: which rows reach it, the scope each row names checked
 *  before anything of the verb runs, and the reader's own secret meaning everything.
 *  See docs/agent-native.md 9.1 and 13.1. */

import { describe, expect, test, vi } from 'vitest'
import { AGENT_WINDOW_VERBS } from '../agents/verbs'
import { callerOf, READER } from './caller'

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

/** Every verb that reached the agents' module, and what it was told. */
const reached: { name: string; agent: string | null }[] = []

vi.mock('../agents/workspace', () => ({
  runAgentVerb: (name: string, _args: unknown, caller: { agent: { id: string } | null }) => {
    reached.push({ name, agent: caller.agent?.id ?? null })
    return Promise.resolve({ ok: true, status: 'ok', result: { ran: name } })
  },
  answerTheCrate: (name: string) => Promise.resolve({ asked: name }),
}))

const { dispatch } = await import('./verbs')

function agentHolding(...scopes: string[]) {
  return callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes,
    spaces: 'all',
    mode: 'unsupervised',
  })
}

describe('an agent at the dispatcher', () => {
  test('reaches every agent row with the scope the crate names for it, and no other', async () => {
    for (const [verb, scope] of Object.entries(AGENT_WINDOW_VERBS)) {
      reached.length = 0
      const others = [
        'context',
        'notes.read',
        'notes.write',
        'tree',
        'workspace',
        'settings',
        'terminal',
      ]
      const without = others.filter((one) => one !== scope)

      const refused = await dispatch(verb, {}, [], 'here', agentHolding(...without))
      if (scope === null) {
        expect(refused, verb).toMatchObject({ ok: true, status: 'ok' })
      } else {
        expect(refused, verb).toMatchObject({ ok: false, status: 'error', code: 'not_granted' })
        expect(refused, verb).toMatchObject({ message: expect.stringContaining(scope) })
        // Refused before anything of the verb was fetched, let alone run.
        expect(reached, verb).toEqual([])
      }

      const allowed = await dispatch(verb, {}, [], 'here', agentHolding(...(scope ? [scope] : [])))
      expect(allowed, verb).toEqual({ ok: true, status: 'ok', result: { ran: verb } })
      expect(reached.at(-1), verb).toEqual({ name: verb, agent: 'claude-code' })
    }
  })

  test('never reaches the command line own verbs, eval among them', async () => {
    const every = agentHolding(...Object.values(AGENT_WINDOW_VERBS).filter((one) => one !== null))
    for (const verb of [
      'files.write',
      'files.delete',
      'eval',
      'commands.run',
      'open',
      'agent.markdown',
    ]) {
      expect(await dispatch(verb, { yes: true }, [], 'here', every), verb).toMatchObject({
        ok: false,
        code: 'not_granted',
      })
    }
  })

  test('a grant that cannot be read is an agent holding nothing, never the reader', async () => {
    reached.length = 0
    const garbled = callerOf('not a grant')
    expect(garbled.agent?.scopes).toEqual([])
    expect(await dispatch('read_note', { path: 'a.md' }, [], 'here', garbled)).toMatchObject({
      code: 'not_granted',
    })
    expect(callerOf({ id: 'x', scopes: ['notes.read'], mode: 'whatever' }).agent?.mode).toBe(
      'confirm',
    )
    expect(reached).toEqual([])
  })

  test('the reader holds every scope, and is answered in the command line shapes', async () => {
    expect(await dispatch('run_terminal', { command: 'x' }, [], 'here', READER)).toEqual({
      ok: true,
      value: { ran: 'run_terminal' },
    })
    expect(reached.at(-1)).toEqual({ name: 'run_terminal', agent: null })
  })

  test('the command line keeps its own bookmarks verb, and an agent gets the agent one', async () => {
    reached.length = 0
    const theirs = await dispatch(
      'bookmarks',
      { op: 'list' },
      [],
      'here',
      agentHolding('workspace'),
    )
    expect(theirs).toMatchObject({ status: 'ok', result: { ran: 'bookmarks' } })
    expect(reached).toEqual([{ name: 'bookmarks', agent: 'claude-code' }])

    reached.length = 0
    // The reader's, with no space open under node, fails in the command line's words.
    expect(await dispatch('bookmarks', {})).toEqual({ ok: false, error: 'there is no space open' })
    expect(reached).toEqual([])
  })

  test('the crate asks its three as the installation', async () => {
    expect(await dispatch('agent.reader_tabs', {})).toEqual({
      ok: true,
      value: { asked: 'agent.reader_tabs' },
    })
  })
})
