import { describe, expect, test } from 'vitest'
import { noteNameOf, quoted, taskWords } from './keep-words'

describe('a message kept outside its chat', () => {
  test('as a task: its first line, and a +Name for each person it called', () => {
    expect(taskWords('- Send the figures to @Lucile Martin\nby Friday', ['Lucile Martin'])).toBe(
      'Send the figures to +Lucile',
    )
    expect(taskWords('', [])).toBe('')
  })

  test('as a note: named from its first words, as a file may be named', () => {
    expect(noteNameOf('Plan: a/b #draft [x] and more words than eight here', 'thesis')).toBe(
      'Plan a b draft x and more words',
    )
    expect(noteNameOf('   ', 'thesis')).toBe('thesis')
  })

  test('each message a quote under its writer and time, its files embedded', () => {
    expect(quoted('Lucile', '7 Oct, 16:52', 'one\n\ntwo', ['figure.png'])).toBe(
      '> **Lucile** · 7 Oct, 16:52\n> one\n>\n> two\n> ![[figure.png]]',
    )
  })
})
