import { describe, expect, it } from 'vitest'
import { chatLink, chatLinkOf } from './links'

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'
const MESSAGE = '01K6Z8Q3V8A0000000000000AB'

describe('a chat link', () => {
  it('names a chat, or a message in it', () => {
    expect(chatLink(CHAT)).toBe(`nib://chat/${CHAT}`)
    expect(chatLink(CHAT, MESSAGE)).toBe(`nib://chat/${CHAT}/${MESSAGE}`)
  })

  it('reads back what it wrote', () => {
    expect(chatLinkOf(chatLink(CHAT))).toEqual({ chat: CHAT })
    expect(chatLinkOf(chatLink(CHAT, MESSAGE))).toEqual({ chat: CHAT, message: MESSAGE })
  })

  it.each([
    'https://nibeditor.com',
    'nib://chat/',
    'nib://chat/c_123',
    `nib://chat/${CHAT}/`,
    `nib://chat/${CHAT}/${MESSAGE}/0`,
    `nib://chat/${CHAT}/a b`,
    `nib://note/${CHAT}`,
  ])('is not a chat link: %s', (url) => {
    expect(chatLinkOf(url)).toBeNull()
  })
})
