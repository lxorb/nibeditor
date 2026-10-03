/** Ask's passages, carried as attachments and found again by the answer. */

import { describe, expect, test } from 'vitest'
import type { Attachment, Turn } from '../chat/types'
import { cites, passageAttachments, sourcesFor, sourcesIn } from './citations'

const passages = [
  { path: 'Herons.md', name: 'Herons', line: 0, text: 'A heron stands still.' },
  { path: 'Hovering.md', name: 'Hovering', line: 14, text: 'A kestrel hovers.' },
]

function you(
  id: string,
  attachments: Attachment[] = passageAttachments(passages),
  steered = false,
): Turn {
  return {
    id,
    role: 'you',
    at: 0,
    parts: [],
    draft: { text: 'q', attachments },
    ...(steered ? { steered } : {}),
  }
}

function model(id: string): Turn {
  return { id, role: 'model', at: 0, parts: [{ kind: 'text', text: 'It faces the wind [2].' }] }
}

describe('Ask’s passages', () => {
  test('are numbered in the order the answer counts them, with the line from one', () => {
    const made = passageAttachments(passages)
    expect(made.map((one) => one.label)).toEqual(['[1] Herons, line 1', '[2] Hovering, line 15'])
    expect(made[1]?.cite).toEqual({ path: 'Hovering.md', name: 'Hovering', line: 14 })
  })

  test('come back from a message as its sources, and nothing else it carried does', () => {
    const draft = {
      text: 'q',
      attachments: [...passageAttachments(passages), { label: 'Other.md', text: 'words' }],
    }
    expect(sourcesIn(draft).map((one) => one.name)).toEqual(['Herons', 'Hovering'])
  })

  test('are the sources of the answer to their message, past words steered in after it', () => {
    const turns = [you('a'), model('b'), you('c', [{ label: 'x', text: 'y' }], true), model('d')]
    expect(sourcesFor(turns, 1).map((one) => one.path)).toEqual(['Herons.md', 'Hovering.md'])
    expect(sourcesFor(turns, 3).map((one) => one.path)).toEqual(['Herons.md', 'Hovering.md'])
  })

  test('bring the rule for citing them only when the last message carried some', () => {
    expect(cites([you('a'), model('b')])).toBe(true)
    expect(cites([you('a', [])])).toBe(false)
  })
})
