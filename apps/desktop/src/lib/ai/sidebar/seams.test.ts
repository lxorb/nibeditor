/** The `/` menu's matching, and a command typed whole. */

import { describe, expect, test } from 'vitest'
import type { PanelCommand } from '../commands/types'
import { commandIn, matching, rowNamed } from './seams'

function row(name: string, synonyms: string[] = [], description = ''): PanelCommand {
  return { name, synonyms, description, available: () => true, run: () => undefined }
}

const rows = [
  row('new', ['clear', 'reset'], 'a new thread'),
  row('resume', ['continue'], 'the thread list'),
  row('add-space', ['add-dir'], 'widen to another space'),
  row('permissions', ['approve'], 'what the agent may do'),
  row('rename', [], 'name the thread'),
]

describe('the `/` menu', () => {
  test('finds a name by its start, hyphens aside, then synonyms, then description words', () => {
    expect(matching(rows, 'ne').map((one) => one.name)).toEqual(['new'])
    expect(matching(rows, 'adddir').map((one) => one.name)).toEqual(['add-space'])
    expect(matching(rows, 'reset').map((one) => one.name)).toEqual(['new'])
    expect(matching(rows, 're').map((one) => one.name)).toEqual(['resume', 'rename', 'new'])
    expect(matching(rows, 'thread').map((one) => one.name)).toEqual(['new', 'resume', 'rename'])
  })

  test('lists every row before anything is typed', () => {
    expect(matching(rows, '')).toHaveLength(rows.length)
  })
})

describe('a command typed whole', () => {
  test('is its name and what follows it', () => {
    expect(commandIn('/model  fake-large ')).toEqual({ name: 'model', args: 'fake-large' })
    expect(commandIn('/new')).toEqual({ name: 'new', args: '' })
    expect(commandIn('not /a command')).toBeNull()
  })

  test('runs its row, and says the synonym it was typed by', () => {
    expect(rowNamed(rows, 'new')).toEqual({ row: rows[0] })
    expect(rowNamed(rows, 'approve')).toEqual({ row: rows[3], typed: 'approve' })
    expect(rowNamed(rows, 'nothing')).toBeNull()
  })
})
