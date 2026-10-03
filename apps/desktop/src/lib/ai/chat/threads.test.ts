/** Threads kept: written and read back whole, checked on the way in, branched, and
 *  written one write at a time. The crate's half is ai_threads.rs's tests. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the crate holds, by space and id, and every write it was asked for. */
const disk = new Map<string, { head: unknown; body: string }>()
const writes: string[] = []
let slowly: Promise<void> = Promise.resolve()

vi.mock('../../tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: async (command: string, args: Record<string, unknown>) => {
    const key = `${String(args.space)}/${String(args.id)}`
    switch (command) {
      case 'ai_thread_write':
        await slowly
        writes.push(String(args.body))
        disk.set(key, { head: args.head, body: String(args.body) })
        return null
      case 'ai_thread_read':
        return disk.get(key)?.body ?? null
      case 'ai_threads_list':
        return [...disk.entries()]
          .filter(([at]) => at.startsWith(`${String(args.space)}/`))
          .map(([, one]) => one.head)
      case 'ai_thread_delete':
        disk.delete(key)
        return null
      default:
        throw new Error(command)
    }
  },
}))

const {
  branchThread,
  deleteThread,
  headOf,
  keepThread,
  listThreads,
  newThread,
  readThread,
  threadIn,
  writeThread,
} = await import('./threads')
const choices = await import('./choices')

import type { Thread } from './types'

function had(): Thread {
  const thread = newThread('space-1', 'anthropic', 'claude-opus-5-5', 'high', 'agent')
  thread.title = 'Herons'
  thread.turns = [
    {
      id: 'y1',
      role: 'you',
      at: 1,
      draft: { text: 'What is in Birds.md?', attachments: [] },
      parts: [],
      effort: 'high',
    },
    {
      id: 'm1',
      role: 'model',
      at: 2,
      model: 'claude-opus-5-5',
      parts: [
        { kind: 'thinking', text: 'hm', ms: 40 },
        {
          kind: 'tool',
          id: 't1',
          verb: 'read_note',
          args: { path: 'Birds.md' },
          state: 'ok',
          result: { text: 'A', images: [], error: false },
        },
        { kind: 'text', text: 'Herons stand still.' },
      ],
      replay: {
        api: 'anthropic',
        model: 'claude-opus-5-5',
        messages: [{ role: 'assistant', content: [{ type: 'thinking', signature: 's' }] }],
      },
    },
    { id: 'y2', role: 'you', at: 3, draft: { text: 'And then?', attachments: [] }, parts: [] },
  ]
  thread.compaction = {
    upTo: 'm1',
    kind: 'anthropic',
    model: 'claude-opus-5-5',
    summary: 'so far',
    block: { type: 'compaction' },
  }
  thread.usage = { input: 3_000, cached: 1_000, output: 20, reasoning: 0, window: 1_000_000 }
  return thread
}

beforeEach(() => {
  disk.clear()
  writes.length = 0
  slowly = Promise.resolve()
})

describe('a thread kept', () => {
  test('reads back as it was written, the provider’s own record and all', async () => {
    const thread = had()
    await writeThread(thread)
    expect(await readThread('space-1', thread.id)).toEqual(thread)
    expect(await readThread('space-1', 'nobody')).toBeNull()
  })

  test('is listed newest first by its head, which carries its words for the search', async () => {
    const older = { ...had(), updated: 1 }
    const newer = { ...had(), id: 'newer', title: 'Egrets', updated: 2 }
    await writeThread(older)
    await writeThread(newer)
    const heads = await listThreads('space-1')
    expect(heads.map((one) => one.title)).toEqual(['Egrets', 'Herons'])
    expect(heads[0]?.words).toBe('What is in Birds.md? Herons stand still. And then?')
    expect(await listThreads('space-2')).toEqual([])
  })

  test('is gone once deleted', async () => {
    const thread = had()
    await writeThread(thread)
    await deleteThread('space-1', thread.id)
    expect(await readThread('space-1', thread.id)).toBeNull()
  })

  test('is kept on this device, which is the fourth question’s default', () => {
    expect(choices.THREADS_SYNCED).toBe(false)
    expect(choices.ASK_IS_A_MODE).toBe(true)
    expect(choices.EDITS).toBe('apply-and-review')
    expect(choices.READER_TABS).toBe(true)
  })
})

describe('a file read back', () => {
  test('that is not a thread is no thread', () => {
    expect(threadIn(null)).toBeNull()
    expect(threadIn({ id: 'x' })).toBeNull()
    expect(threadIn('a thread')).toBeNull()
  })

  test('keeps what it can read and leaves out what it cannot', () => {
    const read = threadIn({
      id: 't',
      space: 's',
      provider: 'openai',
      model: 'gpt-5.5',
      effort: 'ludicrous',
      mode: 'yolo',
      turns: [
        {
          id: 'a',
          role: 'model',
          parts: [
            { kind: 'text', text: 'ok' },
            { kind: 'hologram' },
            { kind: 'tool', id: 'c', verb: 'read_note', state: 'running' },
          ],
        },
        { id: 'b', role: 'narrator', parts: [] },
        'nonsense',
      ],
    })
    expect(read).toMatchObject({ effort: 'auto', mode: 'ask', title: '' })
    expect(read?.turns).toHaveLength(1)
    // A call still running when the thread was written never answered.
    expect(read?.turns[0]?.parts).toEqual([
      { kind: 'text', text: 'ok' },
      { kind: 'tool', id: 'c', verb: 'read_note', args: {}, state: 'error' },
    ])
  })
})

describe('a branch', () => {
  test('is a copy up to a turn under a new id, with the compaction only if it is in it', () => {
    const thread = had()
    const whole = branchThread(thread, 'y2', 'Herons again')
    expect(whole.id).not.toBe(thread.id)
    expect(whole.turns.map((one) => one.id)).toEqual(['y1', 'm1', 'y2'])
    expect(whole.compaction?.upTo).toBe('m1')
    expect(whole.title).toBe('Herons again')

    const early = branchThread(thread, 'y1')
    expect(early.turns.map((one) => one.id)).toEqual(['y1'])
    expect(early).not.toHaveProperty('compaction')
    early.turns.push({ id: 'z', role: 'you', at: 0, parts: [] })
    expect(thread.turns).toHaveLength(3)
  })

  test('its head is what the list draws', () => {
    expect(headOf(had())).toMatchObject({
      title: 'Herons',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    })
  })
})

describe('writing while a write is on its way', () => {
  test('is one more write, with the thread as it is by then', async () => {
    let release: () => void = () => undefined
    slowly = new Promise((go) => {
      release = go
    })
    const thread = had()
    const first = keepThread(thread)
    thread.title = 'one'
    void keepThread(thread)
    thread.title = 'two'
    const last = keepThread(thread)
    release()
    await Promise.all([first, last])
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1] ?? '{}')).toMatchObject({ title: 'two' })
  })
})
