// What /batch fans out over, what /export and /copy take, and /autocompact's words.

import { describe, expect, test } from 'vitest'
import type { Turn } from '../chat/types'
import { autocompactIn, markdownOf, nthAnswer } from './conversation'
import { batchTargets, researchPrompt } from './helpers'
import { languageIn } from './words'

const you = (text: string): Turn => ({
  id: text,
  role: 'you',
  at: 0,
  parts: [],
  draft: { text, attachments: [] },
})
const model = (text: string): Turn => ({
  id: text,
  role: 'model',
  at: 0,
  parts: [{ kind: 'text', text }],
})

describe('the commands on a thread', () => {
  test('/batch finds the folders and tags an instruction names', () => {
    expect(
      batchTargets('tag every note in @Inbox/ and Reading/Birds/ with #todo, then #later.'),
    ).toEqual({
      folders: ['Inbox/', 'Reading/Birds/'],
      tags: ['todo', 'later'],
    })
    expect(batchTargets('fix everything')).toEqual({ folders: [], tags: [] })
  })

  test('/copy takes the nth latest answer', () => {
    const thread = { turns: [you('a'), model('first'), you('b'), model('second'), model('')] }
    expect(nthAnswer(thread, 1)).toBe('second')
    expect(nthAnswer(thread, 2)).toBe('first')
    expect(nthAnswer(thread, 3)).toBe('')
  })

  test('/export writes the thread as markdown, the reader quoted', () => {
    expect(markdownOf({ title: 'Herons', turns: [you('where?\nnow'), model('In Reading.')] })).toBe(
      '# Herons\n\n> where?\n> now\n\nIn Reading.\n',
    )
  })

  test('/autocompact reads auto, off and a count', () => {
    expect(autocompactIn('auto')).toBe('auto')
    expect(autocompactIn('OFF')).toBe('off')
    expect(autocompactIn('500k')).toBe(500_000)
    expect(autocompactIn('1.5m')).toBe(1_500_000)
    expect(autocompactIn('')).toBeNull()
  })

  test('/translate takes a language by its id, its own name or its English one', () => {
    expect(languageIn('de')).toBe('de')
    expect(languageIn('Deutsch')).toBe('de')
    expect(languageIn('german', (id) => (id === 'de' ? 'German' : id))).toBe('de')
    expect(languageIn('Klingon', () => 'x')).toBeNull()
  })

  test('/deep-research asks for a cited note', () => {
    expect(researchPrompt('Why do herons stand still?')).toContain('create_note')
  })
})
