// The menu's rows against a fake panel: every row of the table is there and runs, the
// panel's own controls are what the plain ones press, a note's command is sent with its
// overrides, and a note never takes a built-in's name.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { newThread } from '../chat/threads'
import type { Thread } from '../chat/types'
import type { NoteCommand } from './notes'
import type { Ended, Panel, PanelCommand } from './types'

const notes: NoteCommand[] = []
vi.mock('./found', () => ({
  foundNow: () => notes,
  found: () => Promise.resolve(notes),
  foundNamed: (kind: string, name: string) =>
    Promise.resolve(notes.find((one) => one.kind === kind && one.name === name) ?? null),
}))

const { commands, effortIn } = await import('./index')
const { ROWS } = await import('./table')
const { tasks } = await import('./tasks.svelte')

const ended: Ended = { stop: 'end', turn: null, usage: null }

function fakePanel(thread: Thread) {
  const calls: string[] = []
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((one) => JSON.stringify(one)).join(',')})`)
    }
  const panel = {
    text: '',
    provider: null,
    send: log('send'),
    newThread: log('newThread'),
    showThreads: log('showThreads'),
    rename: (...args: unknown[]) => {
      log('rename')(...args)
      return Promise.resolve()
    },
    branch: log('branch'),
    exportThread: () => Promise.resolve(),
    archive: log('archive'),
    remove: () => Promise.resolve(),
    stop: log('stop'),
    setMode: log('setMode'),
    openModels: log('openModels'),
    modelNamed: (name: string) => {
      log('modelNamed')(name)
      return name === 'opus'
    },
    setEffort: log('setEffort'),
    setFast: log('setFast'),
    compact: log('compact'),
    openContext: log('openContext'),
    toggleFolded: log('toggleFolded'),
    ensure: () => thread,
    turn: (on: Thread, text: string, once?: object) => {
      calls.push(
        `turn(${on.id === thread.id ? 'open' : 'other'},${JSON.stringify(text)},${JSON.stringify(once ?? {})})`,
      )
      return Promise.resolve(ended)
    },
    touched: log('touched'),
    adopt: log('adopt'),
  } satisfies Panel
  return { panel, calls }
}

let thread: Thread

beforeEach(() => {
  notes.length = 0
  thread = newThread('space', 'p', 'm')
})

async function run(rows: readonly PanelCommand[], name: string, args = '', panel?: Panel) {
  const row = rows.find((one) => one.name === name)
  if (!row || !panel) throw new Error(name)
  await row.run({ args, thread, panel })
}

describe('the menu', () => {
  test('lists every row of the table first, each with its words', () => {
    const { panel } = fakePanel(thread)
    const rows = commands(panel)
    expect(rows.slice(0, ROWS.length).map((one) => one.name)).toEqual(ROWS.map((one) => one.name))
    for (const row of rows) expect(row.description, row.name).toBeTruthy()
  })

  test("runs the panel's own control for the plain rows", async () => {
    const { panel, calls } = fakePanel(thread)
    const rows = commands(panel)
    await run(rows, 'new', '', panel)
    await run(rows, 'resume', 'herons', panel)
    await run(rows, 'branch', 'try', panel)
    await run(rows, 'compact', 'keep the plan', panel)
    await run(rows, 'model', 'opus', panel)
    await run(rows, 'model', 'nothing like it', panel)
    await run(rows, 'effort', 'extra', panel)
    await run(rows, 'fast', 'off', panel)
    await run(rows, 'plan', 'tidy Inbox', panel)
    await run(rows, 'focus', '', panel)
    await run(rows, 'context', '', panel)
    expect(calls).toEqual([
      'newThread()',
      'showThreads("herons")',
      'branch("try")',
      'compact("keep the plan")',
      'modelNamed("opus")',
      'modelNamed("nothing like it")',
      'openModels()',
      'setEffort("xhigh")',
      'setFast(false)',
      'setMode("plan")',
      'send("tidy Inbox")',
      'toggleFolded()',
      'openContext()',
    ])
  })

  test('puts words in the field for /help and /mention', async () => {
    const { panel } = fakePanel(thread)
    const rows = commands(panel)
    await run(rows, 'help', '', panel)
    expect(panel.text).toBe('/')
    await run(rows, 'mention', '@Reading/', panel)
    expect(panel.text).toBe('@Reading/')
  })

  test('reads every spelling of an effort', () => {
    expect(effortIn('extra')).toBe('xhigh')
    expect(effortIn('none')).toBe('off')
    expect(effortIn('MAX')).toBe('max')
    expect(effortIn('')).toBe('next')
  })

  test('sets a goal, starts its first turn on the condition, and stops it with /stop', async () => {
    const { panel, calls } = fakePanel(thread)
    const rows = commands(panel)
    await run(rows, 'goal', 'Inbox is empty', panel)
    expect(thread.goal).toMatchObject({ condition: 'Inbox is empty', state: 'pursuing' })
    expect(calls).toContain('turn(open,"Inbox is empty",{"signal":{}})')
    expect(tasks.of(thread.id).map((one) => one.kind)).toEqual(['goal'])
    await run(rows, 'stop', '', panel)
    expect(tasks.of(thread.id)).toEqual([])
    expect(thread.goal?.state).toBe('paused')
  })

  test("sends a note's command with its arguments and overrides, and never under a built-in's name", async () => {
    const base = { path: 'c.md', arguments: ['who'], tools: [] }
    notes.push(
      {
        ...base,
        kind: 'command',
        name: 'greet',
        body: 'Say hello to $who.',
        mode: 'agent',
        effort: 'low',
      },
      { ...base, kind: 'command', name: 'plain', body: 'Plain.', arguments: [] },
      { ...base, kind: 'command', name: 'clear', body: 'Mine.' },
      { ...base, kind: 'agent', name: 'researcher', body: 'Cite.' },
    )
    const { panel, calls } = fakePanel(thread)
    const rows = commands(panel)
    const own = rows.slice(ROWS.length)
    expect(own.map((one) => one.name)).toEqual(['greet', 'plain'])
    expect(own[0]?.args).toBe('<who>')
    await run(rows, 'greet', 'Ada', panel)
    await run(rows, 'plain', '', panel)
    expect(calls).toEqual([
      'turn(open,"Say hello to Ada.",{"effort":"low","mode":"agent"})',
      'send("Plain.")',
    ])
  })

  test('chooses an agent profile and an output style for the thread', async () => {
    notes.push({
      kind: 'agent',
      name: 'researcher',
      path: 'r.md',
      body: 'Cite.',
      mode: 'plan',
      arguments: [],
      tools: [],
    })
    const { panel, calls } = fakePanel(thread)
    const rows = commands(panel)
    await run(rows, 'agents', 'Researcher', panel)
    expect(thread).toMatchObject({ agent: 'researcher' })
    expect(calls).toContain('setMode("plan")')
    await run(rows, 'output-style', 'concise', panel)
    expect(thread).toMatchObject({ style: 'concise' })
    await run(rows, 'output-style', 'default', panel)
    expect(thread).not.toHaveProperty('style')
  })

  test('says /goal and /tasks as lines in the thread', async () => {
    const { panel } = fakePanel(thread)
    const rows = commands(panel)
    await run(rows, 'goal', '', panel)
    await run(rows, 'tasks', '', panel)
    const lines = thread.turns.flatMap((turn) =>
      turn.parts.map((part) => (part.kind === 'notice' ? part.code : '')),
    )
    expect(lines).toEqual(['command', 'command'])
  })
})
