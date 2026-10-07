/** What the reader said, drawn over what the account placed (docs/chats.md 4.5, "Seen at
 *  once").
 *
 *  A message is drawn the moment Enter is pressed, and a reaction or an edit the same way:
 *  the outbox's events are folded over the window's messages by the same fold the store
 *  uses (fold.ts), after everything placed, in the order they were said. Posts the account
 *  has not placed are drawn under the placed ones. Each message any of it is about wears
 *  `sending` until it is placed, or the account's refusal. Pure, so the drawing of an
 *  outbox is tested without a store. */

import type { Logged, Message, Who } from '@nib/chats'
import type { Refusal } from '@nib/chats/wire'
import type { Shown } from './api'
import type { OutboxRow } from './cache'
import { fold, type Kept } from './fold'

/** Which messages a list draws: a chat's own, or one message's replies. */
export type Filter = (message: Message) => boolean

/** The ids of the messages an event is about. */
function aboutOf(row: OutboxRow): string[] {
  const event = row.event
  if (event.kind === 'post') return [event.message]
  if (event.kind === 'schedule' || event.kind === 'meta') return []
  return [event.target]
}

/** The placed window and the outbox, as a list draws them. */
export async function overlay(
  placed: readonly Kept[],
  outbox: readonly OutboxRow[],
  me: Who,
  filter: Filter,
): Promise<{ messages: Shown[]; pending: Shown[] }> {
  const known = new Map(placed.map((one) => [one.message.id, one]))
  const posted: string[] = []
  const sending = new Set<string>()
  const refusals = new Map<string, Refusal>()

  // After everything placed, in order: places no log will ever reach.
  let seq = Number.MAX_SAFE_INTEGER - outbox.length - 1
  for (const row of outbox) {
    seq += 1
    for (const id of aboutOf(row)) {
      if (row.refused) {
        if (!refusals.has(id)) refusals.set(id, row.refused)
      } else sending.add(id)
    }
    // A refused event is drawn as the message it was about, marked, but not as done:
    // a refused edit leaves the words as the account has them.
    if (row.refused && row.event.kind !== 'post') continue
    const event = { ...row.event, seq, at: row.madeAt, author: me } as Logged
    const lookup = {
      get: (id: string) => Promise.resolve(known.get(id)),
      newestReply: () => Promise.resolve(undefined),
    }
    for (const one of await fold(event, lookup)) {
      if (event.kind === 'post' && one.message.id === event.message) {
        posted.push(one.message.id)
        // Drawn at its own place, not one past every place there will ever be.
        one.message = { ...one.message, seq: Number.MAX_SAFE_INTEGER, at: row.madeAt }
      }
      known.set(one.message.id, one)
    }
  }

  const shown = (message: Message): Shown => ({
    ...message,
    sending: sending.has(message.id),
    refused: refusals.get(message.id) ?? null,
  })
  const pendingIds = new Set(posted)
  const messages = placed
    .map((one) => known.get(one.message.id)?.message ?? one.message)
    .filter((message) => !pendingIds.has(message.id) && filter(message))
    .map(shown)
  const pending = posted
    .map((id) => known.get(id)?.message)
    .filter((message): message is Message => message !== undefined && filter(message))
    .filter((message) => !message.deleted)
    .map(shown)
  return { messages, pending }
}
