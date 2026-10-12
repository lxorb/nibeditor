/** The helpers' rules against roads of the test's own: which model, how deep, how many,
 *  how long, and what stopping a thread stops. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ModelInfo, Thread } from '../chat/types'
import type { Ended } from '../commands/types'
import type { Provider } from '../providers'

const { helpers, DEPTH, MINUTES, PER_ROOT } = await import('./helpers.svelte')
type Roads = Parameters<typeof helpers.start>[1]

const model = (id: string): ModelInfo => ({
  id,
  name: id,
  window: null,
  efforts: ['auto'],
  images: false,
  fast: false,
})
const CLAUDE: Provider = { id: 'claude-code', kind: 'claude-code', name: '', model: '' }
const CODEX: Provider = { id: 'codex', kind: 'codex', name: '', model: '' }

/** The answer a turn ends with. */
const answered = (text: string, stop: Ended['stop'] = 'end'): Ended => ({
  stop,
  usage: null,
  turn: { id: 't', role: 'model', at: 0, parts: [{ kind: 'text', text }] },
})

/** Roads whose turns end when the test says, each heard with its signal. */
function roads() {
  const runs: { thread: Thread; text: string; signal: AbortSignal; end: (ended: Ended) => void }[] =
    []
  const made: Roads = {
    offered: () =>
      Promise.resolve([
        { provider: CLAUDE, models: [model('opus'), model('sonnet')] },
        { provider: CODEX, models: [model('gpt-6-astra')] },
      ]),
    run: (thread, text, signal) =>
      new Promise<Ended>((resolve) => {
        const end = (ended: Ended) => resolve(ended)
        signal.addEventListener('abort', () => resolve(answered('', 'stopped')), { once: true })
        runs.push({ thread, text, signal, end })
      }),
  }
  return { made, runs }
}

const parent = (id: string, provider = CLAUDE.id): Thread => ({
  id,
  space: 'Notes',
  title: '',
  provider,
  model: 'opus',
  effort: 'auto',
  mode: 'agent',
  turns: [],
  usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
  created: 0,
  updated: 0,
})

const asked = (from: Thread | null, model: string, prompt = 'Find the herons.') => ({
  parent: from,
  space: 'Notes',
  prompt,
  description: 'herons',
  model,
  mode: from?.mode ?? 'approve',
})

beforeEach(() => {
  for (const one of helpers.all) helpers.stop(one.id)
  helpers.all = []
})

describe('a helper', () => {
  test('Opus starts an Astra helper, a thread of its own whose answer comes back', async () => {
    const { made, runs } = roads()
    const started = await helpers.start(asked(parent('p1'), 'astra'), made)
    if ('refused' in started) throw new Error(started.refused)

    expect(started).toMatchObject({ provider: 'codex', model: 'gpt-6-astra', depth: 1 })
    expect(runs[0]?.thread).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-astra',
      mode: 'agent',
      title: '↳ herons',
    })
    expect(runs[0]?.text).toBe('Find the herons.')

    runs[0]?.end(answered('Two herons, by the pond.'))
    expect(await helpers.wait(started.id, 1000)).toMatchObject({
      state: 'done',
      answer: 'Two herons, by the pond.',
    })
  })

  test('works in its parent’s mode, and a profile’s instructions come first', async () => {
    const { made, runs } = roads()
    const plan = { ...parent('p2'), mode: 'plan' as const }
    await helpers.start({ ...asked(plan, 'sonnet'), instructions: 'You review.' }, made)
    expect(runs[0]?.thread.mode).toBe('plan')
    expect(runs[0]?.text).toBe('You review.\n\nFind the herons.')
  })

  test('a model nobody offers is refused with the ones there are, and nothing runs', async () => {
    const { made, runs } = roads()
    const said = await helpers.start(asked(parent('p3'), 'gemini'), made)
    expect(said).toEqual({
      refused: 'no model called "gemini" is offered. Models: opus, sonnet, gpt-6-astra',
    })
    expect(runs).toHaveLength(0)
  })

  test('still running after the wait is said as running', async () => {
    const { made } = roads()
    const started = await helpers.start(asked(parent('p4'), 'opus'), made)
    if ('refused' in started) throw new Error(started.refused)
    expect((await helpers.wait(started.id, 5))?.state).toBe('running')
  })

  test('a failed turn is a failed helper, with its words', async () => {
    const { made, runs } = roads()
    const started = await helpers.start(asked(parent('p5'), 'opus'), made)
    if ('refused' in started) throw new Error(started.refused)
    runs[0]?.end({ stop: 'error', error: 'signed out', usage: null, turn: null })
    expect(await helpers.wait(started.id, 1000)).toMatchObject({
      state: 'failed',
      error: 'signed out',
    })
  })
})

describe('the limits', () => {
  test(`helpers go ${DEPTH} deep and no deeper`, async () => {
    const { made, runs } = roads()
    const first = await helpers.start(asked(parent('root'), 'opus'), made)
    if ('refused' in first) throw new Error(first.refused)
    const second = await helpers.start(asked(runs[0]?.thread ?? null, 'astra'), made)
    if ('refused' in second) throw new Error(second.refused)
    expect(second).toMatchObject({ depth: 2, root: 'root', parent: first.id })

    const third = await helpers.start(asked(runs[1]?.thread ?? null, 'opus'), made)
    expect(third).toEqual({
      refused: `a helper ${DEPTH} deep may not start another; do the work yourself`,
    })
  })

  test(`at most ${PER_ROOT} run under one thread at once`, async () => {
    const { made, runs } = roads()
    const root = parent('busy')
    for (let one = 0; one < PER_ROOT; one++) {
      expect('refused' in (await helpers.start(asked(root, 'opus'), made))).toBe(false)
    }
    expect(await helpers.start(asked(root, 'opus'), made)).toEqual({
      refused: `${PER_ROOT} helpers are already running; wait for one with agent_result`,
    })
    // Another thread the reader started has its own.
    expect('refused' in (await helpers.start(asked(parent('other'), 'opus'), made))).toBe(false)
    // One ends, and there is room again.
    runs[0]?.end(answered('done'))
    await helpers.wait(runs[0]?.thread.id ?? '', 1000)
    expect('refused' in (await helpers.start(asked(root, 'opus'), made))).toBe(false)
  })

  test(`one runs ${MINUTES} minutes at most`, async () => {
    vi.useFakeTimers()
    try {
      const { made, runs } = roads()
      const started = await helpers.start(asked(parent('slow'), 'opus'), made)
      if ('refused' in started) throw new Error(started.refused)
      await vi.advanceTimersByTimeAsync(MINUTES * 60_000)
      expect(runs[0]?.signal.aborted).toBe(true)
      expect(helpers.get(started.id)?.state).toBe('stopped')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('stopping', () => {
  test('stopping a thread stops its helpers and theirs, and no other', async () => {
    const { made, runs } = roads()
    const top = parent('top')
    const first = await helpers.start(asked(top, 'opus'), made)
    if ('refused' in first) throw new Error(first.refused)
    await helpers.start(asked(runs[0]?.thread ?? null, 'astra'), made)
    await helpers.start(asked(parent('elsewhere'), 'opus'), made)

    helpers.stopUnder('top')
    expect(runs.map((one) => one.signal.aborted)).toEqual([true, true, false])
    await helpers.wait(first.id, 1000)
    expect(helpers.get(first.id)?.state).toBe('stopped')
  })

  test('a helper that ends takes its own helpers with it', async () => {
    const { made, runs } = roads()
    const first = await helpers.start(asked(parent('ends'), 'opus'), made)
    if ('refused' in first) throw new Error(first.refused)
    await helpers.start(asked(runs[0]?.thread ?? null, 'astra'), made)
    runs[0]?.end(answered('done early'))
    await helpers.wait(first.id, 1000)
    expect(runs[1]?.signal.aborted).toBe(true)
  })
})
