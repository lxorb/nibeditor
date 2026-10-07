/** How tall a row will be before it is drawn (docs/chats.md 4.17): from what the
 *  message already says, the lines of its words at the column's width and the stated
 *  size of its pictures, so the window's guess is close and a scroll through history
 *  barely moves once the rows are measured. Pure; the numbers are the tab's own
 *  stylesheet's, in pixels. */

import type { Message } from '@nib/chats'
import { fitted, gallery, sortFiles } from './media'
import type { Item } from './rows'

/** A line of words, and the room the avatar column and the gutters take. */
const LINE = 21
const GUTTER = 64
/** An average character's width at the chat's size. */
const CHARACTER = 7.2

export function estimate(item: Item, width: number): number {
  if (item.kind === 'day') return 36
  if (item.kind === 'new') return 22
  return messageHeight(item.message, item.head, width) + (item.seen.length ? 20 : 0)
}

function messageHeight(message: Message, head: boolean, width: number): number {
  const column = Math.max(120, width - GUTTER)
  let height = head ? 30 : 6
  if (message.deleted) return height + LINE
  if (message.quote !== undefined) height += 24
  height += linesOf(message.body, column) * LINE
  const { seen, heard, other } = sortFiles(message.files)
  if (seen.length === 1 && seen[0]) height += fitted(seen[0], column).height + 6
  else if (seen.length > 1) {
    const { across, shown } = gallery(seen)
    const side = Math.min(column, 480) / across
    height += Math.ceil(shown.length / across) * side + 6
  }
  height += heard.length * 48 + other.length * 52
  if (message.preview) height += message.preview.picture ? 96 : 64
  if (message.poll) height += 48 + message.poll.answers.length * 38
  if (Object.keys(message.reactions).length) height += 30
  if (message.replies) height += 28
  return height
}

/** Lines the words take: each written line, wrapped at the column. */
function linesOf(body: string, column: number): number {
  if (!body) return 0
  const across = Math.max(10, Math.floor(column / CHARACTER))
  let lines = 0
  for (const line of body.split('\n')) lines += Math.max(1, Math.ceil(line.length / across))
  return lines
}
