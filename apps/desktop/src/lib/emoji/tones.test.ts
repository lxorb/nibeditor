import { expect, test } from 'vitest'
import { inTone } from './tones'

const toned = new Set(['👍', '✌️', '🧑‍💻'])

test('a tone goes straight after the person, in place of the colour selector', () => {
  expect(inTone('👍', 3, toned)).toBe('👍🏽')
  expect(inTone('✌️', 1, toned)).toBe('✌🏻')
  expect(inTone('🧑‍💻', 5, toned)).toBe('🧑🏿‍💻')
})

test('an emoji that takes no tone, or no tone at all, is left as it is', () => {
  expect(inTone('🚀', 3, toned)).toBe('🚀')
  expect(inTone('👍', 0, toned)).toBe('👍')
})
