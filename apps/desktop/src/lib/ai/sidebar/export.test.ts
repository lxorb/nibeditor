/** A thread as a note. */

import { describe, expect, test } from 'vitest'
import { newThread } from '../chat/threads'
import { passageAttachments } from './citations'
import { threadMarkdown } from './export'

describe('a thread as a note', () => {
  test('is its title, each message quoted and each answer with its citations made links', () => {
    const thread = newThread('space', 'p', 'm')
    thread.title = 'Kestrels'
    thread.turns.push(
      {
        id: 'a',
        role: 'you',
        at: 0,
        parts: [],
        draft: {
          text: 'Which way?\nAnd why?',
          attachments: passageAttachments([
            { path: 'Birds/Hovering.md', name: 'Hovering', line: 3, text: 'into the wind' },
          ]),
        },
      },
      {
        id: 'b',
        role: 'model',
        at: 0,
        parts: [
          { kind: 'thinking', text: 'hmm', ms: 10 },
          { kind: 'text', text: 'Into the wind [1].' },
          { kind: 'notice', code: 'stopped', text: '' },
        ],
      },
    )
    expect(threadMarkdown(thread, 'Untitled')).toBe(
      '# Kestrels\n\n> Which way?\n> And why?\n\nInto the wind [[Birds/Hovering|Hovering]].\n',
    )
  })

  test('is called what the reader’s language calls a thread with no title', () => {
    expect(threadMarkdown(newThread('s', 'p', 'm'), 'Untitled')).toBe('# Untitled\n')
  })
})
