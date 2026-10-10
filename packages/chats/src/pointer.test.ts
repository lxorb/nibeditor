import { describe, expect, it } from 'vitest'
import { chatOf, chatText, isChatId, withIcon } from './pointer'

const ID = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'

describe('a .chat file', () => {
  const pointer = { v: 1, chat: ID } as const

  it('reads back what it wrote', () => {
    expect(chatOf(chatText(pointer))).toEqual(pointer)
  })

  it('is one line of JSON with the fields in order', () => {
    expect(chatText(pointer)).toBe(`{"v":1,"chat":"${ID}"}\n`)
  })

  it('reads the documented spelling, spaces and all', () => {
    expect(chatOf(`{ "v": 1, "chat": "${ID}" }`)).toEqual(pointer)
  })

  it('drops fields it does not know, so a later version may add one', () => {
    expect(chatOf(`{"v":1,"chat":"${ID}","topic":"x"}`)).toEqual(pointer)
  })

  it.each([
    '',
    'Chat',
    'null',
    '[1]',
    `{"chat":"${ID}"}`,
    `{"v":2,"chat":"${ID}"}`,
    `{"v":"1","chat":"${ID}"}`,
    '{"v":1,"chat":""}',
    '{"v":1,"chat":"c_123"}',
    `{"v":1,"chat":"${ID.toUpperCase()}"}`,
    `{"v":1,"chat":"${ID} "}`,
    '{"v":1,"chat":7}',
  ])('is not a chat when it reads %s', (text) => {
    expect(chatOf(text)).toBeNull()
  })

  it('keeps the icon and its colour after the id, and reads them back', () => {
    const worn = { v: 1, chat: ID, icon: 'rocket', iconColor: 'violet' } as const

    expect(chatText(worn)).toBe(`{"v":1,"chat":"${ID}","icon":"rocket","iconColor":"violet"}\n`)
    expect(chatOf(chatText(worn))).toEqual(worn)
    expect(chatOf(chatText({ v: 1, chat: ID, icon: '🚀' }))).toEqual({ v: 1, chat: ID, icon: '🚀' })
  })

  it('is the same chat to a reader that knows nothing of icons', () => {
    const text = chatText({ v: 1, chat: ID, icon: 'rocket' })
    const { v, chat } = JSON.parse(text) as { v: unknown; chat: unknown }

    expect({ v, chat }).toEqual(pointer)
  })

  it.each([
    ['a colour with no icon', '"iconColor":"violet"', pointer],
    ['an icon that is not a string', '"icon":7', pointer],
    ['an empty icon', '"icon":" "', pointer],
    ['an icon too long to be one', `"icon":"${'a'.repeat(101)}"`, pointer],
    [
      'a colour that is not a string',
      '"icon":"rocket","iconColor":[1]',
      { ...pointer, icon: 'rocket' },
    ],
  ])('drops %s', (_said, fields, read) => {
    expect(chatOf(`{"v":1,"chat":"${ID}",${fields}}`)).toEqual(read)
  })

  it('puts an icon on and takes it off', () => {
    const worn = withIcon(pointer, 'anchor', 'teal')

    expect(worn).toEqual({ ...pointer, icon: 'anchor', iconColor: 'teal' })
    expect(withIcon(worn, 'anchor', null)).toEqual({ ...pointer, icon: 'anchor' })
    expect(withIcon(worn, null, 'teal')).toEqual(pointer)
    expect(chatText(withIcon(worn, null, null))).toBe(chatText(pointer))
  })

  it('knows a chat id by its shape alone', () => {
    expect(isChatId(ID)).toBe(true)
    expect(isChatId(ID.slice(2))).toBe(false)
    expect(isChatId(null)).toBe(false)
  })
})
