import { describe, expect, test } from 'vitest'
import { firstChoice, letterAt, stepAt } from './new-kind-choice'

/** Where the new-tab dialog stands, and the steps round it.
 *
 *  Emil, 2026-09-27: *"Ctrl + T should always open a webpage by default. And that
 *  should always be the selected option in the modal when holding the Ctrl."* Which
 *  is three small sums; the hand on the keyboard is new-kind-chord.effect.test.ts. */

const DESKTOP = ['note', 'canvas', 'web', 'pages'] as const
const PHONE = ['note', 'canvas', 'pages'] as const

describe('where the dialog opens', () => {
  test('is the website, which is what Ctrl+T makes in every browser', () => {
    expect(firstChoice(DESKTOP)).toBe(2)
  })

  test('wherever the website is in the list', () => {
    expect(firstChoice(['web', 'note'])).toBe(0)
    expect(firstChoice(['note', 'pages', 'canvas', 'web'])).toBe(3)
  })

  /** A website is a bookmark on a phone and is not offered there. */
  test('is a note where there is no website to make', () => {
    expect(firstChoice(PHONE)).toBe(0)
    expect(firstChoice(['canvas', 'note'])).toBe(1)
  })

  test('and the first of them where there is neither', () => {
    expect(firstChoice(['canvas', 'pages'])).toBe(0)
    expect(firstChoice([])).toBe(0)
  })
})

describe('one kind along', () => {
  test('is the next of them', () => {
    expect(stepAt(0, 4)).toBe(1)
    expect(stepAt(2, 4)).toBe(3)
  })

  test('wraps at the end, which is what a switcher under a held key does', () => {
    expect(stepAt(3, 4)).toBe(0)
  })

  test('goes back under Shift, and wraps the other way', () => {
    expect(stepAt(2, 4, -1)).toBe(1)
    expect(stepAt(0, 4, -1)).toBe(3)
  })

  test('takes several at once, forwards and back', () => {
    expect(stepAt(0, 4, 3)).toBe(3)
    expect(stepAt(0, 4, 5)).toBe(1)
    expect(stepAt(1, 4, -3)).toBe(2)
  })

  test('and a list with nothing in it steps nowhere', () => {
    expect(stepAt(0, 0)).toBe(0)
  })
})

describe('a letter', () => {
  const letters = ['n', 'c', 'w', 'p']

  test('picks the kind it names', () => {
    expect(letterAt(letters, 'w')).toBe(2)
    expect(letterAt(letters, 'n')).toBe(0)
  })

  test('whether or not Shift was down', () => {
    expect(letterAt(letters, 'P')).toBe(3)
  })

  test('and picks nothing for a letter no kind has, or for a key that is not a letter', () => {
    expect(letterAt(letters, 't')).toBe(-1)
    expect(letterAt(letters, 'Enter')).toBe(-1)
    expect(letterAt(letters, '')).toBe(-1)
  })
})
