import type { Member } from '@nib/chats'
import { describe, expect, test } from 'vitest'
import { enterDoes, mentionAt, mentionChoices, mentionText, trimmed } from './compose'

const plain = { shift: false, mod: false }

describe('Enter', () => {
  test('sends, as in every chat', () => {
    expect(enterDoes('hello', plain)).toBe('send')
    expect(enterDoes('> a quote', plain)).toBe('send')
  })

  test('goes on writing a fence or a list', () => {
    expect(enterDoes('```js\nconst a = 1', plain)).toBe('editor')
    expect(enterDoes('```js\nconst a = 1\n```\n', plain)).toBe('send')
    expect(enterDoes('- milk', plain)).toBe('editor')
    expect(enterDoes('1. first', plain)).toBe('editor')
    expect(enterDoes('- [ ] task', plain)).toBe('editor')
  })

  test('Shift is a new line, and Ctrl sends from anywhere', () => {
    expect(enterDoes('hello', { shift: true, mod: false })).toBe('line')
    expect(enterDoes('```\ncode', { shift: false, mod: true })).toBe('send')
  })
})

describe('mentions', () => {
  const members: Member[] = [
    { who: 'user:emil', name: 'Emil Vinu' },
    { who: 'user:lucile', name: 'Lucile Martin', nick: 'Lu' },
    { who: 'user:mia', name: 'Mia Lucas' },
    { who: 'user:eve', name: 'Ève' },
  ]

  test('the one being typed, and only one', () => {
    expect(mentionAt('hi @Lu', 6)).toEqual({ from: 3, query: 'Lu' })
    expect(mentionAt('@', 1)).toEqual({ from: 0, query: '' })
    expect(mentionAt('mail ana@example', 16)).toBeNull()
    expect(mentionAt('hi @Lu there', 12)).toBeNull()
    expect(mentionAt('@Lu\nnext', 8)).toBeNull()
  })

  test('who it could be: names first, then a word of a name, then here and everyone', () => {
    const who = (query: string) =>
      mentionChoices(query, members, 'user:emil').map((one) =>
        typeof one === 'string' ? one : one.who,
      )
    expect(who('lu')).toEqual(['user:lucile', 'user:mia'])
    expect(who('e')).toEqual(['user:eve', 'everyone'])
    expect(who('h')).toEqual(['here'])
    expect(who('')).toEqual(['user:lucile', 'user:mia', 'user:eve', 'here', 'everyone'])
  })

  test('writes the name the chat shows', () => {
    expect(mentionText(members[1]!)).toBe('@Lu ')
    expect(mentionText(members[2]!)).toBe('@Mia Lucas ')
    expect(mentionText('here')).toBe('@here ')
  })

  test('a message is sent without blank lines either side', () => {
    expect(trimmed('\n\nhey @Lu\n\nand @everyone  \n\n')).toBe('hey @Lu\n\nand @everyone')
  })
})
