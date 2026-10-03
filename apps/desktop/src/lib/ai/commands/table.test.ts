// The registry against docs/ai-sidebar.md section 3, read from the document itself: every
// row of 3.1 to 3.6 is registered with exactly its synonyms and arguments, nothing of
// 3.7 is, no name is taken twice, and every row answers for each kind of provider.

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { ProviderKind } from '../providers'
import { availability } from './available'
import { GOAL_CLEAR, ROWS, takenNames } from './table'

const DOC = readFileSync(new URL('../../../../../../docs/ai-sidebar.md', import.meta.url), 'utf8')

/** The lines of a part of the document, from one heading to the next. */
function section(from: string, to: string): string[] {
  const start = DOC.indexOf(from)
  const end = DOC.indexOf(to, start + from.length)
  expect(start, from).toBeGreaterThan(-1)
  return DOC.slice(start, end < 0 ? undefined : end).split('\n')
}

/** A table row's cells, `\|` kept inside its cell. */
const cells = (line: string) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((one) => one.trim().replace(/\\\|/g, '|'))

const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((found) => found[1] ?? '')

interface DocRow {
  name: string
  args: string
  synonyms: string[]
  /** Words that follow the command rather than replace it: `/goal clear`'s others. */
  argSynonyms: string[]
}

const DOC_ROWS: DocRow[] = section('### 3.1', '### 3.7')
  .filter((line) => line.startsWith('| `/'))
  .map((line) => {
    const [command = '', synonyms = ''] = cells(line)
    const [written = ''] = ticked(command)
    const [name = '', ...args] = written.slice(1).split(' ')
    const words = ticked(synonyms)
    return {
      name,
      args: args.join(' '),
      synonyms: words.filter((one) => one.startsWith('/')).map((one) => one.slice(1)),
      argSynonyms: words.filter((one) => !one.startsWith('/')),
    }
  })

const EXCLUDED: string[] = section('### 3.7', '\n---')
  .filter((line) => line.startsWith('| `/'))
  .flatMap((line) => ticked(cells(line)[0] ?? ''))
  .map((one) => one.slice(1))

const KINDS: readonly ProviderKind[] = [
  'anthropic',
  'openai',
  'compatible',
  'chatgpt',
  'claude-code',
  'codex',
]

describe('the command table', () => {
  test('holds the counts the document states', () => {
    expect(DOC).toContain('**60 commands** and **43 synonyms**')
    expect(DOC_ROWS).toHaveLength(60)
    expect(DOC_ROWS.flatMap((one) => one.synonyms)).toHaveLength(43)
    expect(ROWS).toHaveLength(60)
    expect(ROWS.flatMap((one) => one.synonyms)).toHaveLength(43)
  })

  test('registers every row of section 3, in its order, with its synonyms and arguments', () => {
    expect(ROWS.map((one) => one.name)).toEqual(DOC_ROWS.map((one) => one.name))
    for (const row of DOC_ROWS) {
      const ours = ROWS.find((one) => one.name === row.name)
      expect(ours?.synonyms, row.name).toEqual(row.synonyms)
      expect(ours?.args ?? '', row.name).toBe(row.args)
    }
  })

  test("takes /goal clear's other words as the document lists them", () => {
    const goal = DOC_ROWS.find((one) => one.name === 'goal')
    expect(goal?.argSynonyms[0]).toBe('clear')
    expect(GOAL_CLEAR).toEqual(goal?.argSynonyms)
  })

  test('takes no name or synonym twice', () => {
    const every = ROWS.flatMap((one) => [one.name, ...one.synonyms])
    expect(new Set(every).size).toBe(every.length)
    expect(takenNames().size).toBe(every.length)
  })

  test('registers nothing section 3.7 leaves out', () => {
    expect(EXCLUDED.length).toBeGreaterThan(80)
    const taken = takenNames()
    expect(EXCLUDED.filter((one) => taken.has(one))).toEqual([])
  })

  test('gives every row a few words for the menu', () => {
    for (const row of ROWS) expect(row.description.trim(), row.name).not.toBe('')
  })

  test.each(KINDS)('answers every row for %s: runs, or dimmed with a reason', (kind) => {
    for (const row of ROWS) {
      for (const review of [true, false]) {
        const said = availability(row.name, kind, { review })
        if (said !== true) expect(said.trim(), `${row.name} on ${kind}`).not.toBe('')
      }
    }
  })

  test('dims /fast only where the provider has no faster tier', () => {
    const ready = { review: true }
    const runs = KINDS.filter((kind) => availability('fast', kind, ready) === true)
    expect(runs).toEqual(['anthropic', 'openai', 'codex'])
    for (const row of ROWS.filter((one) => one.name !== 'fast'))
      for (const kind of KINDS) expect(availability(row.name, kind, ready), row.name).toBe(true)
  })

  test("waits for the review lane's half of /rewind and /diff", () => {
    expect(availability('rewind', 'anthropic', { review: false })).not.toBe(true)
    expect(availability('diff', 'codex', { review: false })).not.toBe(true)
  })
})
