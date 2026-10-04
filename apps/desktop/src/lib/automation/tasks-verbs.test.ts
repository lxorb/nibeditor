import { describe, expect, test, vi } from 'vitest'

/** The stores read the browser's storage and ask what kind of machine this is, and
 *  there is neither under node; see verbs.test.ts, which does the same. */
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

/** What the agent's verbs were asked, and as whom. */
const asked: { name: string; args: unknown; agent: unknown }[] = []

vi.mock('../agents/workspace', () => ({
  runAgentVerb: (name: string, args: unknown, caller: { agent: unknown }) => {
    asked.push({ name, args, agent: caller.agent })
    return Promise.resolve(
      name === 'update_task' && (args as { at?: string }).at === 'gone'
        ? { ok: false, status: 'error', code: 'not_found', message: 'that task is not there' }
        : { ok: true, status: 'ok', result: { at: 'Inbox.md#0:abc' } },
    )
  },
}))

const { dispatch, verbForAction } = await import('./verbs')

describe('the to-dos from a terminal and a link', () => {
  test('the command line asks the agent verbs as the reader, with every argument', async () => {
    asked.length = 0
    expect(await dispatch('tasks', { note: 'Shop' }, ['add', 'Milk'])).toEqual({
      ok: true,
      value: { at: 'Inbox.md#0:abc' },
    })
    await dispatch('tasks', {}, ['list', 'today & p1'])
    await dispatch('tasks', {}, ['done', 'Inbox.md#0:abc'])
    await dispatch('base', { view: 'Shelf' }, ['query', 'Books.base'])
    expect(asked).toEqual([
      { name: 'add_task', args: { note: 'Shop', text: 'Milk' }, agent: null },
      { name: 'list_tasks', args: { filter: 'today & p1' }, agent: null },
      { name: 'update_task', args: { at: 'Inbox.md#0:abc', done: true }, agent: null },
      { name: 'query_base', args: { view: 'Shelf', path: 'Books.base' }, agent: null },
    ])
  })

  test('says why in a sentence where the verb refused', async () => {
    expect(await dispatch('tasks', {}, ['done', 'gone'])).toEqual({
      ok: false,
      error: 'that task is not there',
    })
  })

  test('nib://add-task adds to an inbox and nowhere else', async () => {
    asked.length = 0
    expect(verbForAction('add-task')).toBe('tasks.add')
    expect(verbForAction('tasks.add')).toBeNull()
    await dispatch(
      'tasks.add',
      { text: 'Call mum', note: 'Diary', under: 'Secrets', space: 'Home' },
      [],
      'link',
    )
    expect(asked).toEqual([
      { name: 'add_task', args: { text: 'Call mum', space: 'Home' }, agent: null },
    ])
  })
})
