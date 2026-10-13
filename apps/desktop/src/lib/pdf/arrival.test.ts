/** Where a PDF opened with nib goes: in place inside a space, else into the space that
 *  is open. See arrival.ts. */

import { expect, test } from 'vitest'
import { arrivalOf } from './arrival'

const work = { id: 'work', root: 'C:\\Users\\me\\Documents\\Nib\\Work' }
const home = { id: 'home', root: 'C:\\Users\\me\\Documents\\Nib\\Home' }
const spaces = [work, home]

test('a PDF in a space opens where it is, in that space', () => {
  expect(arrivalOf('C:\\Users\\me\\Documents\\Nib\\Home\\Papers\\a.pdf', spaces, 'work')).toEqual({
    kind: 'open',
    spaceId: 'home',
    path: 'C:\\Users\\me\\Documents\\Nib\\Home\\Papers\\a.pdf',
  })
})

test('one from anywhere else is brought into the space that is open', () => {
  expect(arrivalOf('C:\\Users\\me\\Downloads\\a.pdf', spaces, 'home')).toEqual({
    kind: 'bring',
    spaceId: 'home',
    root: home.root,
  })
})

test('a folder beside a space whose name begins the same is not in it', () => {
  expect(arrivalOf('C:\\Users\\me\\Documents\\Nib\\Workshop\\a.pdf', spaces, 'home')).toEqual({
    kind: 'bring',
    spaceId: 'home',
    root: home.root,
  })
})

test('a path that climbs out of a space is not in it', () => {
  expect(
    arrivalOf('C:\\Users\\me\\Documents\\Nib\\Work\\..\\..\\a.pdf', spaces, 'work')?.kind,
  ).toBe('bring')
})

test('with no space open the first takes it, and with none at all nothing does', () => {
  expect(arrivalOf('/tmp/a.pdf', spaces, null)).toEqual({
    kind: 'bring',
    spaceId: 'work',
    root: work.root,
  })
  expect(arrivalOf('/tmp/a.pdf', [], null)).toBeNull()
})
