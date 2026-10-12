import { describe, expect, test } from 'vitest'
import { choices, shownFirst, viaAccount } from './choices'

describe('the ways in Access offers', () => {
  test('a desktop with an account offers both roads and Other', () => {
    expect(choices(true, true)).toEqual(['claude-code', 'codex', 'claude', 'chatgpt', 'other'])
  })

  test('a desktop without an account offers the agents on this computer', () => {
    expect(choices(true, false)).toEqual(['claude-code', 'codex', 'other'])
  })

  test('a browser or a phone with an account offers the connector', () => {
    expect(choices(false, true)).toEqual(['claude', 'chatgpt', 'other'])
  })

  test('neither offers nothing at all', () => {
    expect(choices(false, false)).toEqual([])
  })

  test('the way chosen last comes first while it is offered', () => {
    expect(shownFirst(choices(true, true), 'chatgpt')).toBe('chatgpt')
    expect(shownFirst(choices(true, false), 'chatgpt')).toBe('claude-code')
    expect(shownFirst([], 'claude')).toBeNull()
  })

  test('Claude and ChatGPT are the account’s, the rest this computer’s or both', () => {
    expect(
      ['claude-code', 'codex', 'claude', 'chatgpt', 'other'].map((one) => viaAccount(one as never)),
    ).toEqual([false, false, true, true, false])
  })
})
