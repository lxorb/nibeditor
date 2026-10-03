/** What `@` and a few letters mean. */

import { describe, expect, test } from 'vitest'
import { type Mention, mentionAt, ranked, sameMention } from './mentions'

const hovering: Mention = { kind: 'note', id: '/s/Hovering.md', label: 'Hovering' }
const herons: Mention = { kind: 'note', id: '/s/Herons.md', label: 'Herons' }
const candidates: Mention[] = [
  { kind: 'selection', id: 'selection', label: 'Selection', word: 'selection' },
  { kind: 'web', id: 'web', label: 'Web search', word: 'web' },
  hovering,
  herons,
  { kind: 'tag', id: 'birds', label: '#birds' },
]

describe('the `@` being typed', () => {
  test('is found at the caret after a space or at the start, and not inside a word', () => {
    expect(mentionAt('Compare @Hov', 12)).toEqual({ from: 8, query: 'Hov' })
    expect(mentionAt('@', 1)).toEqual({ from: 0, query: '' })
    expect(mentionAt('me@example', 10)).toBeNull()
    expect(mentionAt('@Hov and more', 13)).toBeNull()
  })
})

describe('the candidates', () => {
  test('keep their order when nothing is typed', () => {
    expect(ranked(candidates, '', 2).map((one) => one.id)).toEqual(['selection', 'web'])
  })

  test('put a name that starts with the letters first', () => {
    expect(ranked(candidates, 'he')[0]?.label).toBe('Herons')
    expect(ranked(candidates, 'hov').map((one) => one.label)).toEqual(['Hovering'])
  })

  test('answer to the word a kind is typed as', () => {
    expect(ranked(candidates, 'web')[0]?.kind).toBe('web')
  })

  test('name the same thing once', () => {
    expect(sameMention(hovering, { ...hovering, label: 'x' })).toBe(true)
    expect(sameMention(hovering, herons)).toBe(false)
  })
})
