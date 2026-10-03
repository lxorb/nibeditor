import { describe, expect, test, vi } from 'vitest'
import { rowsOfText } from '@nib/bases/rows'
import type { Thread } from '../chat/types'
import type { Host } from './host'

const NOTE =
  '# Week\n- [ ] Pay rent ⏫ 📅 2020-01-01\n- [ ] Call mum #family\n- [ ] Someday 📅 2999-01-01\n'
const written: unknown[] = []

vi.mock('../../rows/rows.svelte', () => {
  const all = rowsOfText('Home', 'Week.md', NOTE)
  return {
    rows: {
      of: () => all,
      inboxes: () => [{ space: 'Home', path: 'Inbox.md' }],
      write: (row: unknown, change: unknown) => {
        written.push({ row, change })
        return Promise.resolve(true)
      },
    },
  }
})

const { planDay, showTasks, tickTask } = await import('./todos')

function host(said = '') {
  const ask = vi.fn(() => Promise.resolve(said))
  const lines: { text: string; code?: string }[] = []
  const sent: { text: string; once: unknown }[] = []
  const fake = {
    panel: { send: (text: string) => sent.push({ text, once: undefined }) },
    line: (_thread: Thread, text: string, code?: string) =>
      lines.push({ text, ...(code ? { code } : {}) }),
    ask,
    turn: (_thread: Thread, text: string, once: unknown) => {
      sent.push({ text, once })
      return Promise.resolve({ stop: 'end', turn: null, usage: null })
    },
  }
  fake.panel = Object.assign(fake.panel, {
    turn: fake.turn,
    setMode: () => undefined,
  })
  return { fake: fake as unknown as Host, lines, sent, ask }
}

const thread = { id: 't' } as Thread
const shown = (lines: { text: string }[]) =>
  JSON.parse(lines[0]?.text ?? '{}') as { tasks: { text: string }[]; filter?: string }

describe('/tasks', () => {
  test('Today with nothing after it, as rows the thread draws', async () => {
    const { fake, lines } = host()
    await showTasks(fake, thread, '')
    expect(lines[0]?.code).toBe('tasks')
    expect(shown(lines).tasks.map((one) => one.text)).toEqual(['Pay rent'])
  })

  test("Todoist's filter, as written", async () => {
    const { fake, lines } = host()
    await showTasks(fake, thread, '#family')
    expect(shown(lines)).toMatchObject({ filter: '#family', tasks: [{ text: 'Call mum' }] })
  })

  test('words the model turns into a filter, shown above the rows', async () => {
    const { fake, lines, ask } = host('`p2`')
    await showTasks(fake, thread, 'what is urgent')
    expect(ask).toHaveBeenCalledOnce()
    expect(shown(lines)).toMatchObject({ filter: 'p2', tasks: [{ text: 'Pay rent' }] })
  })

  test('a box ticked through the one write path', async () => {
    const { fake, lines } = host()
    await showTasks(fake, thread, '')
    const at =
      (JSON.parse(lines[0]?.text ?? '{}') as { tasks: { at: string }[] }).tasks[0]?.at ?? ''
    expect(await tickTask(at, 'Home', true)).toBe(true)
    expect(written[0]).toMatchObject({ change: { task: { done: true } } })
    expect(await tickTask('Week.md#1:nothing', 'Home', true)).toBe(false)
  })
})

describe('/today', () => {
  test('asks the model to plan in Agent mode, with what the reader added', () => {
    const { fake, sent } = host()
    planDay(fake, thread, 'gym at six')
    expect(sent[0]?.text).toMatch(/^Plan my day\./)
    expect(sent[0]?.text).toMatch(/gym at six$/)
    expect(sent[0]?.once).toEqual({ mode: 'agent' })
  })
})
