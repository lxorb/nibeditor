/** The `/` menu's matching, and a command typed whole. */

import { describe, expect, test } from 'vitest'
import { commandIn, matching, type PanelActions } from './seams'
import { panelCommands } from './verbs-of-panel'

const ran: string[] = []
const panel = new Proxy({} as PanelActions, {
  get:
    (_target, name: string) =>
    (...args: unknown[]) => {
      ran.push(`${name}(${args.map((one) => JSON.stringify(one)).join(',')})`)
      return name === 'modelNamed' ? false : undefined
    },
})
const rows = panelCommands(panel)

describe('the `/` menu', () => {
  test('finds a name by its start, hyphens aside, names before synonyms', () => {
    expect(matching(rows, 'ne').map((one) => one.name)).toEqual(['new'])
    expect(matching(rows, 'reset').map((one) => one.name)).toEqual(['new'])
    expect(matching(rows, 're').map((one) => one.name)).toEqual([
      'resume',
      'rename',
      'new',
      'effort',
    ])
  })

  test('takes no name twice', () => {
    const words = rows.flatMap((one) => [one.name, ...one.synonyms])
    expect(new Set(words).size).toBe(words.length)
  })
})

describe('a command typed whole', () => {
  test('is its name and what follows it', () => {
    expect(commandIn('/model  fake-large ')).toEqual({ name: 'model', args: 'fake-large' })
    expect(commandIn('/new')).toEqual({ name: 'new', args: '' })
    expect(commandIn('not /a command')).toBeNull()
  })

  test('runs what the panel’s own control runs', async () => {
    ran.length = 0
    const named = (name: string) => rows.find((one) => one.name === name)
    await named('model')?.run({ args: 'unknown', thread: null, panel })
    await named('effort')?.run({ args: 'extra', thread: null, panel })
    await named('plan')?.run({ args: 'tidy the inbox', thread: null, panel })
    expect(ran).toEqual([
      'modelNamed("unknown")',
      'openModels()',
      'setEffort("xhigh")',
      'setMode("plan")',
      'send("tidy the inbox")',
    ])
  })
})
