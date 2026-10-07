/** Who may do what in a chat (docs/chats.md 4.6, the table).
 *
 *  The space's three roles answer it, with one setting per chat: who may post. The
 *  object refuses by this and the app hides what it says no to, so a button is never
 *  drawn for an event the account would refuse. A guest is a person at their role. */

import type { Event, Posting, Role } from './types'

/** One row of the table. `post` is posting, replying, reacting and voting alike: a
 *  reaction is a write, so a space shared to read is a chat to read. */
export type Action =
  | 'read'
  | 'post'
  | 'edit-own'
  | 'delete-own'
  | 'delete-any'
  | 'pin'
  | 'topic'
  | 'posting'
  | 'slowmode'

/** Whether somebody at `role` (null for nobody) may do `action` in a chat that lets
 *  `posting` post. */
export function may(role: Role | null, action: Action, posting: Posting): boolean {
  if (role === null) return false
  switch (action) {
    case 'read':
      return true
    case 'post':
      return role === 'owner' || (role === 'write' && posting === 'writers')
    case 'edit-own':
    case 'delete-own':
    case 'pin':
    case 'topic':
      return role !== 'read'
    case 'delete-any':
    case 'posting':
    case 'slowmode':
      return role === 'owner'
  }
}

/** What an event asks to do. `mine` is whether the message it is about is the asker's
 *  own, which an edit has to be and a delete decides by. A `meta` asks for the
 *  strictest of the keys it sets. */
export function actionsOf(event: Event, mine: boolean): Action[] {
  switch (event.kind) {
    case 'post':
    case 'schedule':
    case 'react':
    case 'vote':
      return ['post']
    case 'edit':
      return mine ? ['edit-own'] : []
    case 'delete':
      return [mine ? 'delete-own' : 'delete-any']
    case 'pin':
      return ['pin']
    case 'meta': {
      const actions: Action[] = []
      if (event.topic !== undefined) actions.push('topic')
      if (event.posting !== undefined) actions.push('posting')
      if (event.slowmode !== undefined) actions.push('slowmode')
      return actions
    }
  }
}

/** Whether somebody at `role` may send `event`: every action it asks for is theirs.
 *  An edit of somebody else's message asks for nothing anybody holds, and a `meta`
 *  that sets nothing is no event. */
export function mayEvent(
  role: Role | null,
  event: Event,
  mine: boolean,
  posting: Posting,
): boolean {
  const actions = actionsOf(event, mine)
  return actions.length > 0 && actions.every((action) => may(role, action, posting))
}
