/** Who somebody in a chat is, as a row draws them: the name they are called in the
 *  chat's space and their face (docs/chats.md 4.9).
 *
 *  A person with an account is the people store's (`people.called`, `people.of`), which
 *  asks the account once for everybody on screen. A guest and a program token have no
 *  profile, so they are what the chat's members list calls them, with their initial for
 *  a face. */

import type { Member, Who } from '@nib/chats'
import type { Face } from '../../people/face'
import { people } from '../../people/people.svelte'

/** The account's id behind a person, or null for a guest or a program. */
export function accountOf(who: Who): string | null {
  return who.startsWith('user:') ? who.slice(5) : null
}

/** What a chat calls somebody. */
export function nameOf(who: Who, members: readonly Member[], space: string | null): string {
  const id = accountOf(who)
  const listed = members.find((one) => one.who === who)
  const called = id === null ? undefined : people.called(id, space)
  return called ?? listed?.nick ?? listed?.name ?? '?'
}

/** Their face: their picture where they chose one, else their initial on their accent. */
export function faceOf(who: Who, members: readonly Member[], space: string | null): Face {
  const id = accountOf(who)
  const person = id === null ? undefined : people.of(id)
  return {
    name: nameOf(who, members, space),
    avatar: person?.avatar ?? null,
    accent: person?.accent ?? null,
    key: id ?? who,
  }
}
