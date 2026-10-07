/** The account's own profile, changed: each write goes to the service and what it
 *  answers becomes the account, so the panel's foot, the Share sheet and every caret
 *  this device draws show it at once. See calls.ts and people.svelte.ts. */

import { account } from '../account.svelte'
import { sha256 } from '../bytes'
import { withOrWithout } from '../records'
import {
  dropAvatar,
  type OwnProfile,
  type ProfileChanges,
  saveAvatar,
  saveNick,
  saveProfile,
} from './calls'
import type { Crop } from './crop'
import { faceFrom } from './encode'

function held(): string {
  const token = account.accountToken
  if (!token) throw new Error('sign in first')
  return token
}

function worn(profile: OwnProfile): void {
  if (account.user) account.user = { ...account.user, ...profile }
}

export async function changeProfile(changes: ProfileChanges): Promise<void> {
  worn(await saveProfile(held(), changes))
}

/** The window's square of the picture, as the account's face. */
export async function wearFace(picture: HTMLCanvasElement, crop: Crop, view: number) {
  const token = held()
  const { s, l } = await faceFrom(picture, crop, view)
  const [small, large] = await Promise.all([sha256(s.bytes), sha256(l.bytes)])
  worn(
    await saveAvatar(token, {
      s: { ...s, hash: small },
      l: { ...l, hash: large },
    }),
  )
}

export async function removeFace(): Promise<void> {
  worn(await dropAvatar(held()))
}

/** What the account is called in one space; empty is its own name again. */
export async function nameIn(space: string, nick: string): Promise<void> {
  const kept = await saveNick(held(), space, nick)
  const user = account.user
  if (user) account.user = { ...user, nicks: withOrWithout(user.nicks ?? {}, space, kept) }
}

/** The zone this device is in, kept on the account where it is not already, so the
 *  card can tell the time where the person is. */
export async function keepZone(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!account.user || !zone || account.user.zone === zone) return
  await changeProfile({ zone })
}
