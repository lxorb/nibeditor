/** A face, as it is kept: the two pictures a device made of it, 96 px for every row a
 *  person is in and 512 px for their card, each a blob hash served by `/i/:hash`. Read
 *  out of `users.avatar` the way every stored column is, without trusting it; see
 *  body.ts. Its own file because the Share sheet's listing and the profile both read
 *  it, and neither should import the other. */

import { objectIn } from '../body'

export interface Avatar {
  s: string
  l: string
}

const HASH = /^[a-f0-9]{64}$/

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

export function avatarIn(raw: string | null): Avatar | null {
  const held = objectIn(raw)
  return held && isHash(held.s) && isHash(held.l) ? { s: held.s, l: held.l } : null
}
