import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Ask } from './complete'

/** The conversation the Ask panel holds: what goes back to the model with the next
 *  question, what a question is sent with, where an answer lands, and what is written
 *  down. The provider, the request and the search are stood in for: what is under test
 *  is the conversation, and a fake that records what it was handed is the fact. */

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => kept.set(key, value),
  removeItem: (key: string) => kept.delete(key),
})

const asked: Ask[] = []
const STILL = (ask: Ask) => {
  ask.stream?.('It is still ')
  ask.stream?.('[1].')
  return Promise.resolve('It is still [1].')
}
let reply: (ask: Ask) => Promise<string> = STILL

vi.mock('./complete', () => ({
  complete: (ask: Ask) => {
    asked.push(ask)
    return reply(ask)
  },
  wasStopped: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
}))

vi.mock('./store.svelte', () => {
  const chosen = { id: 'fake', kind: 'compatible', name: 'Fake', baseUrl: 'x', model: 'm' }
  return { ai: { ready: true, chosen, providerFor: () => chosen } }
})

vi.mock('../search/space', () => ({
  searchSpace: (
    root: string,
    _query: unknown,
    _terms: unknown,
    _limit: number,
    onFound: (found: { hits: unknown[]; loose: unknown[] }) => void,
  ) => {
    onFound({
      hits: [
        {
          path: `${root}/Herons.md`,
          name: 'Herons.md',
          line: 2,
          text: 'a heron stands',
          ranges: [{ from: 2, to: 7 }],
        },
      ],
      loose: [],
    })
    return Promise.resolve()
  },
}))

const { workspace } = await import('../workspace.svelte')
const { asking, history } = await import('./asking.svelte')

beforeEach(() => {
  asked.length = 0
  reply = STILL
  kept.clear()
  workspace.spaces = [
    { id: 'one', name: 'One', root: '/one' },
    { id: 'two', name: 'Two', root: '/two' },
  ]
  workspace.activeSpaceId = 'one'
  workspace.noteText = (path: string) =>
    Promise.resolve(path.endsWith('Herons.md') ? '# Herons\n\nWords.\na heron stands\nMore.' : null)
  asking.restore()
  asking.clear()
})

describe('what goes back with the next question', () => {
  test('is the exchanges so far, oldest first, with their citations taken out', () => {
    const said = history([
      { role: 'you', text: 'first?' },
      { role: 'model', text: 'one [1].' },
      { role: 'you', text: 'second?' },
      { role: 'model', text: 'two [2].' },
    ])

    expect(said).toEqual([
      { role: 'user', content: 'first?' },
      { role: 'assistant', content: 'one.' },
      { role: 'user', content: 'second?' },
      { role: 'assistant', content: 'two.' },
    ])
  })

  test('leaves out a question that was never answered, so the roles alternate', () => {
    const said = history([
      { role: 'you', text: 'refused?' },
      { role: 'you', text: 'again?' },
      { role: 'model', text: 'yes' },
    ])

    expect(said.map((one) => one.role)).toEqual(['user', 'assistant'])
    expect(said[0]?.content).toBe('again?')
  })

  test('drops the oldest first once its budget is spent', () => {
    const long = 'x'.repeat(400)
    const turns = Array.from({ length: 20 }, (_, at) => ({
      role: at % 2 ? ('model' as const) : ('you' as const),
      text: `${at} ${long}`,
    }))

    const said = history(turns, 500)
    expect(said.length).toBeLessThan(turns.length)
    expect(said.at(-1)?.content.startsWith('19 ')).toBe(true)
  })
})

describe('a question asked', () => {
  test('is on screen, then its answer with the passages it cited', async () => {
    asking.question = 'Where does the heron stand?'
    await asking.ask()

    expect(asking.question).toBe('')
    expect(asking.turns.map((one) => one.role)).toEqual(['you', 'model'])
    expect(asking.turns[1]?.text).toBe('It is still [1].')
    expect(asking.turns[1]?.sources).toEqual([{ path: 'Herons.md', name: 'Herons', line: 2 }])
  })

  test('is sent with the rules first, the passages, and the question last', async () => {
    await asking.ask('Where does the heron stand?')

    const messages = asked[0]?.messages ?? []
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.content).toContain('<passage n="1" note="Herons" line="3">')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Where does the heron stand?' })
  })

  test('carries the conversation so far with the next one', async () => {
    await asking.ask('Where does the heron stand?')
    await asking.ask('And then?')

    const messages = asked[1]?.messages ?? []
    expect(messages.slice(-3)).toEqual([
      { role: 'user', content: 'Where does the heron stand?' },
      { role: 'assistant', content: 'It is still.' },
      { role: 'user', content: 'And then?' },
    ])
  })

  test('answers into the space it was asked in, whatever is open when it arrives', async () => {
    reply = (ask) => {
      workspace.activeSpaceId = 'two'
      ask.stream?.('late')
      return Promise.resolve('late')
    }

    await asking.ask('heron?')
    expect(asking.turns).toEqual([])

    workspace.activeSpaceId = 'one'
    expect(asking.turns.map((one) => one.text)).toEqual(['heron?', 'late'])
  })

  test('says what went wrong in the provider’s own words, and writes no answer', async () => {
    reply = () => Promise.reject(new Error('this key cannot use that model'))

    await asking.ask('heron?')
    expect(asking.trouble).toBe('this key cannot use that model')
    expect(asking.turns.map((one) => one.role)).toEqual(['you'])
    expect(asking.running).toBe(false)
  })

  test('asked again, replaces the answer it had', async () => {
    reply = (ask) => {
      ask.stream?.('first')
      return Promise.resolve('first')
    }
    await asking.ask('heron?')

    reply = (ask) => {
      ask.stream?.('second')
      return Promise.resolve('second')
    }
    asking.again()
    await vi.waitFor(() => expect(asking.running).toBe(false))

    expect(asking.turns.map((one) => one.text)).toEqual(['heron?', 'second'])
  })
})

describe('what is kept', () => {
  test('is the words and where each citation points, never the passages themselves', async () => {
    reply = (ask) => {
      ask.stream?.('Still [1].')
      return Promise.resolve('Still [1].')
    }
    await asking.ask('heron?')

    const written = kept.get('nib:ask') ?? ''
    expect(written).toContain('Still [1].')
    expect(written).toContain('"path":"Herons.md"')
    expect(written).not.toContain('a heron stands')

    asking.restore()
    expect(asking.turns[1]?.sources).toEqual([{ path: 'Herons.md', name: 'Herons', line: 2 }])
  })

  test('starting again empties this space’s conversation and nobody else’s', async () => {
    await asking.ask('one?')
    workspace.activeSpaceId = 'two'
    await asking.ask('two?')

    asking.clear()
    expect(asking.turns).toEqual([])
    workspace.activeSpaceId = 'one'
    expect(asking.turns.map((one) => one.text)[0]).toBe('one?')
  })

  test('and a row written by hand that is not a turn is dropped on the way in', () => {
    kept.set(
      'nib:ask',
      JSON.stringify({
        spaces: { one: [{ role: 'you', text: 'kept' }, { role: 'x', text: 'no' }, 3] },
      }),
    )
    asking.restore()
    expect(asking.turns).toEqual([{ role: 'you', text: 'kept' }])
  })
})
