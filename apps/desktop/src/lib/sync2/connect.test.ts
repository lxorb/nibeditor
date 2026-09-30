/** Whether web logins travel: the account's switch, and until the account has spoken on
 *  a launch, what it said the last time - but never without a session, and never on an
 *  account nobody flipped. With it off nothing of web-lease starts, so a web tab is what
 *  it always was. */

import { expect, test } from 'vitest'
import { travels } from './connect.svelte'

test('off for an account nobody flipped, whatever this device remembers', () => {
  expect(travels({ webSync: false }, 'token', 'on')).toBe(false)
  expect(travels({}, 'token', 'on')).toBe(false)
})

test('on for an account that was flipped', () => {
  expect(travels({ webSync: true }, 'token', null)).toBe(true)
})

test('before the account answers, what it said last time, and only with a session', () => {
  expect(travels(null, 'token', 'on')).toBe(true)
  expect(travels(null, 'token', 'off')).toBe(false)
  expect(travels(null, 'token', null)).toBe(false)
  expect(travels(null, null, 'on')).toBe(false)
})
