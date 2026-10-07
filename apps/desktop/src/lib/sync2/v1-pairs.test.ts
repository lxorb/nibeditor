import { describe, expect, test } from 'vitest'
import { pairsFromV1 } from './v1-pairs'

/** v1's mirrors, as `nib:mirrors` holds them for one account. */
const saved = {
  account: 'u1',
  seen: true,
  mirrors: {
    '/Notes': { spaceId: 'mine', cursor: 3, notes: {} },
    '/Shared-R': { spaceId: 'theirs', cursor: 5, notes: {}, shared: true },
    '/Gone': { spaceId: 'gone', cursor: 1, notes: {} },
  },
}

const remote = [
  { id: 'mine', role: 'owner' },
  { id: 'theirs', role: 'read' },
]

describe('the folders v1 paired, for a store that paired none', () => {
  test('are taken as they are, a shared space with its own folder and role', () => {
    expect(pairsFromV1(saved, 'u1', ['/Notes', '/Shared-R'], remote, [])).toEqual([
      { root: '/Notes', spaceId: 'mine', role: 'owner' },
      { root: '/Shared-R', spaceId: 'theirs', role: 'read' },
    ])
  })

  test('leave out a space the account no longer has and a folder no longer here', () => {
    expect(pairsFromV1(saved, 'u1', ['/Notes', '/Gone'], remote, [])).toEqual([
      { root: '/Notes', spaceId: 'mine', role: 'owner' },
    ])
  })

  test('never pair a folder or a space the store already paired', () => {
    expect(
      pairsFromV1(saved, 'u1', ['/Notes', '/Shared-R'], remote, [
        { root: '/Notes', spaceId: 'other' },
        { root: '/Elsewhere', spaceId: 'theirs' },
      ]),
    ).toEqual([])
  })

  test('are nothing for another account, or for no mirrors at all', () => {
    expect(pairsFromV1(saved, 'u2', ['/Notes'], remote, [])).toEqual([])
    expect(pairsFromV1(null, 'u1', ['/Notes'], remote, [])).toEqual([])
  })
})
