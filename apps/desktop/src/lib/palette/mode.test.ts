import { describe, expect, test } from 'vitest'
import { lineAsked, modeOf } from './mode'

describe('the mark in front of the field', () => {
  test('says which list it is', () => {
    expect(modeOf('plan')).toEqual({ mode: 'everything', term: 'plan' })
    expect(modeOf('> fold ')).toEqual({ mode: 'commands', term: 'fold' })
    expect(modeOf('#intro')).toEqual({ mode: 'headings', term: 'intro' })
    expect(modeOf(':42')).toEqual({ mode: 'line', term: '42' })
  })

  test('only counts at the very start', () => {
    expect(modeOf(' #intro')).toEqual({ mode: 'everything', term: '#intro' })
  })
})

describe('the line a number asks for', () => {
  test('counts from one on screen and from zero underneath', () => {
    expect(lineAsked('1', 10)).toBe(0)
    expect(lineAsked('42', 100)).toBe(41)
  })

  test('stops at either end', () => {
    expect(lineAsked('900', 300)).toBe(299)
    expect(lineAsked('0', 300)).toBe(0)
  })

  test('is nothing for words, or for a note with no lines', () => {
    expect(lineAsked('', 10)).toBeNull()
    expect(lineAsked('4a', 10)).toBeNull()
    expect(lineAsked('-3', 10)).toBeNull()
    expect(lineAsked('3', 0)).toBeNull()
  })
})
