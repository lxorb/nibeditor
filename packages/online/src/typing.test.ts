import { describe, expect, it } from 'vitest'
import type { SpaceRole, Typing } from './types'
import { mayType } from './typing'

const ROLES: (SpaceRole | null)[] = [null, 'read', 'write', 'owner']
const TYPINGS: Typing[] = ['owner', 'writers']

describe('mayType, by the table of 4.6', () => {
  it.each<[string, SpaceRole | null, boolean, Typing, boolean]>([
    ['a reader, typing owner-only', 'read', false, 'owner', false],
    ['a reader, typing for writers', 'read', false, 'writers', false],
    ['a writer, typing owner-only', 'write', false, 'owner', false],
    ['a writer, typing for writers', 'write', false, 'writers', true],
    ['the space’s owner, typing owner-only', 'owner', false, 'owner', false],
    ['the space’s owner, typing for writers', 'owner', false, 'writers', true],
    ['the machine’s owner, typing owner-only', 'write', true, 'owner', true],
    ['the machine’s owner, typing for writers', 'write', true, 'writers', true],
    ['the machine’s owner who also owns the space', 'owner', true, 'owner', true],
    ['the machine’s owner reading a space', 'read', true, 'owner', true],
    ['the machine’s owner of a trashed .term (no role left)', null, true, 'owner', true],
    ['somebody with no role at all', null, false, 'writers', false],
  ])('%s', (_, role, owns, typing, may) => {
    expect(mayType(role, false, owns, typing)).toBe(may)
  })

  it.each(ROLES.flatMap((role) => TYPINGS.map((typing) => [role, typing] as const)))(
    'a link guest with role %s and typing %s only ever watches',
    (role, typing) => {
      expect(mayType(role, true, false, typing)).toBe(false)
    },
  )

  it('a guest never types even where the flags say they own the machine', () => {
    for (const role of ROLES)
      for (const typing of TYPINGS) expect(mayType(role, true, true, typing)).toBe(false)
  })
})
