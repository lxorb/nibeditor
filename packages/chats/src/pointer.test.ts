import { describe, expect, it } from 'vitest'
import { chatOf, chatText, isChatId } from './pointer'

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

  it('knows a chat id by its shape alone', () => {
    expect(isChatId(ID)).toBe(true)
    expect(isChatId(ID.slice(2))).toBe(false)
    expect(isChatId(null)).toBe(false)
  })
})
