// Commands, agents and styles as notes: found by their front matter, argued in Claude
// Code's syntax, and their overrides read.

import { describe, expect, test } from 'vitest'
import { commandName, expand, rolesOf, splitArgs } from './notes'

const WEEKLY = `---
command: Weekly
description: The week in one note
model: claude-opus-5-5
effort: extra
mode: agent
arguments: [project, week]
---
Summarize $project for week $week.
`

describe('a note as a command', () => {
  test('is found by its front matter, with its overrides', () => {
    const [one, ...rest] = rolesOf('Commands/weekly.md', WEEKLY)
    expect(rest).toEqual([])
    expect(one).toEqual({
      kind: 'command',
      name: 'weekly',
      path: 'Commands/weekly.md',
      body: 'Summarize $project for week $week.',
      description: 'The week in one note',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      mode: 'agent',
      arguments: ['project', 'week'],
      tools: [],
    })
  })

  test('is an agent and a style by their keys, and nothing without one', () => {
    const profile = rolesOf(
      'a.md',
      '---\nagent: Researcher\ntools:\n  - search_notes\n  - read_note\nmode: plan\n---\nCite everything.',
    )
    expect(profile).toEqual([
      expect.objectContaining({
        kind: 'agent',
        name: 'researcher',
        mode: 'plan',
        tools: ['search_notes', 'read_note'],
      }),
    ])
    expect(rolesOf('s.md', '---\noutput-style: terse\n---\nShort.')[0]).toMatchObject({
      kind: 'output-style',
      body: 'Short.',
    })
    expect(rolesOf('n.md', '# Just a note\n\ncommand: no')).toEqual([])
    expect(
      rolesOf('m.md', '---\nmode: sideways\neffort: huge\ncommand: x\n---\n')[0],
    ).not.toHaveProperty('mode')
  })

  test('takes its arguments in every way Claude Code writes them', () => {
    const body = (text: string) => ({ body: text, arguments: ['project', 'week'] })
    expect(expand(body('Summarize $project for week $week.'), 'nib 40')).toBe(
      'Summarize nib for week 40.',
    )
    expect(expand(body('All: $ARGUMENTS'), ' a "b c" ')).toBe('All: a "b c"')
    expect(expand(body('$ARGUMENTS[0] then $ARGUMENTS[1]'), 'a "b c"')).toBe('a then b c')
    expect(expand(body('$1 and $2'), 'x y')).toBe('x and y')
    expect(expand(body('No placeholder.'), 'tail words')).toBe('No placeholder.\n\ntail words')
    expect(expand(body('No placeholder.'), '')).toBe('No placeholder.')
    expect(expand(body('$projects stays'), 'nib')).toBe('$projects stays\n\nnib')
  })

  test('splits its words as a shell does, and names as a command can be typed', () => {
    expect(splitArgs(`one "two three" 'four'`)).toEqual(['one', 'two three', 'four'])
    expect(commandName(' /Stand Up! ')).toBe('stand-up')
  })
})
