/** Messages the reader saved for later (docs/chats.md 3, #17), the Saved list in the
 *  Chats panel. Each kept with what the list draws - who, the first line, when - so the
 *  list is there before any chat is opened, and a press opens the chat at the message.
 *  Kept on this device; see `stored.ts`. */

import type { Message } from '@nib/chats'
import { isNumber, isRecord, isString, keep, stored } from '../../stored'

const KEY = 'nib:chats-saved'

interface SavedMessage {
  chat: string
  message: string
  author: Message['author']
  line: string
  at: number
}

function read(): SavedMessage[] {
  const said = stored(KEY)
  if (!Array.isArray(said)) return []
  return said.flatMap((one: unknown) =>
    isRecord(one) &&
    isString(one.chat) &&
    isString(one.message) &&
    isString(one.author) &&
    isString(one.line) &&
    isNumber(one.at)
      ? [
          {
            chat: one.chat,
            message: one.message,
            author: one.author as Message['author'],
            line: one.line,
            at: one.at,
          },
        ]
      : [],
  )
}

class Saved {
  list = $state<SavedMessage[]>(read())

  has(chat: string, message: string): boolean {
    return this.list.some((one) => one.chat === chat && one.message === message)
  }

  /** Saves a message, or lets it go when it is saved already. */
  toggle(chat: string, message: Message): void {
    const rest = this.list.filter((one) => !(one.chat === chat && one.message === message.id))
    this.list =
      rest.length === this.list.length
        ? [
            {
              chat,
              message: message.id,
              author: message.author,
              line: message.body.split('\n')[0] ?? '',
              at: message.at,
            },
            ...rest,
          ]
        : rest
    keep(KEY, JSON.stringify(this.list))
  }
}

export const saved = new Saved()
