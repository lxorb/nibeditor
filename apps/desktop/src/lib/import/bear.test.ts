import { describe, expect, test } from 'vitest'

import { bearTags, readBear } from './bear'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

describe("Bear's closed tags", () => {
  test('become tags nib can hold', () => {
    expect(bearTags('#two words# and #work#')).toBe('#two-words and #work')
    expect(bearTags('a line\n#home/kitchen#')).toBe('a line\n#home/kitchen')
  })

  test('are left alone where they are not tags', () => {
    // A hash in the middle of a word, and a pair around nothing nameable.
    expect(bearTags('a#b#c')).toBe('a#b#c')
    expect(bearTags('#  #')).toBe('#  #')
  })

  test('are left alone inside a fence, where a hash is code', () => {
    const code = ['before #a tag#', '```c', '#include <stdio.h>', '#define X 1', '```', '#after#']

    expect(bearTags(code.join('\n')).split('\n')).toEqual([
      'before #a-tag',
      '```c',
      '#include <stdio.h>',
      '#define X 1',
      '```',
      '#after',
    ])
  })

  test('an open tag is already a tag and is not touched', () => {
    expect(bearTags('#work and nothing else')).toBe('#work and nothing else')
  })
})

describe('a Bear export', () => {
  test('is a folder of notes with its tags rewritten', async () => {
    const plan = await readBear([
      file('Trip.md', '# Trip\n\n#travel notes# and [[Kit]]\n'),
      file('Kit.md', '# Kit\n'),
    ])

    expect(plan.format).toBe('bear')
    const note = plan.files.find((one) => one.path === 'Trip.md')
    expect(note?.kind === 'note' && note.text).toContain('#travel-notes')
    expect(note?.kind === 'note' && note.text).toContain('[[Kit]]')
  })

  test('leaves hidden files behind, as a folder of notes does', async () => {
    const plan = await readBear([
      file('Trip.md', '# Trip\n\n#travel notes#\n'),
      file('.git/config', '[core]\n'),
      file('.gitignore', '.obsidian/\n'),
      file('.trash/Old draft.md', '# Thrown away\n'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Trip.md'])
  })
})
