/** A link to a chat or to one message in it: `nib://chat/<chat>/<message>`
 *  (docs/chats.md 4.13).
 *
 *  What Copy link puts on the clipboard and what a task made from a message points
 *  back with. In a note it is an address like any other, and nib opens the chat at the
 *  message; outside nib nothing opens it, which is honest, because the message lives in
 *  the account and not in a file. */

import { isChatId } from './pointer'

const PREFIX = 'nib://chat/'

/** A message id as a link may carry it: what `ulid` makes, or an id of the same
 *  alphabet a program posted with. */
const MESSAGE = /^[0-9A-Za-z_-]{1,64}$/

/** The link to a chat, or to one message in it. */
export function chatLink(chat: string, message?: string): string {
  return message === undefined ? `${PREFIX}${chat}` : `${PREFIX}${chat}/${message}`
}

/** What a link names, or null for an address that is not a chat's. */
export function chatLinkOf(url: string): { chat: string; message?: string } | null {
  if (!url.startsWith(PREFIX)) return null
  const [chat, message, ...rest] = url.slice(PREFIX.length).split('/')
  if (rest.length > 0 || !isChatId(chat)) return null
  if (message === undefined) return { chat }
  return MESSAGE.test(message) ? { chat, message } : null
}
