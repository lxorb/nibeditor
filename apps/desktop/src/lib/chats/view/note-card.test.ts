import { describe, expect, test } from 'vitest'
import { cardLines, cardTarget } from './note-card'

describe('a note’s card in a chat', () => {
  test('shows its first lines as they read', () => {
    const note = [
      '---',
      'tags: [thesis]',
      '---',
      '# Chapter 3',
      '',
      'The **second** experiment ran on [[Lab notes|the lab]] data.',
      '- [ ] Check the [figures](figures.md)',
      'Third line',
    ].join('\n')
    expect(cardLines(note, 'Chapter 3')).toEqual([
      'The second experiment ran on the lab data.',
      'Check the figures',
    ])
  })

  test('keeps a heading that is not the name, and skips code', () => {
    expect(cardLines('# Plan\n```js\nlet a\n```\nGo', 'Notes')).toEqual(['Plan', 'Go'])
    expect(cardLines('', 'Empty')).toEqual([])
  })
})

describe('which note a message is about', () => {
  test('the first link to one, outside code, embeds and quotes', () => {
    expect(cardTarget('see [[Chapter 3#Figures|the figures]] and [[Plan]]')).toBe('Chapter 3')
    expect(cardTarget('`[[not]]` then ![[pic.png]] then [[Plan]]')).toBe('Plan')
    expect(cardTarget('> quoted\n> - [[Source]]\n\nmine')).toBeNull()
    expect(cardTarget('```\n[[code]]\n```')).toBeNull()
    expect(cardTarget('no link')).toBeNull()
  })
})
