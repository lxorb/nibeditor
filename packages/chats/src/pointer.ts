/** A `.chat` file's text: the chat the account made, by its id (docs/chats.md 4.2).
 *
 *  Written once by the app when the account answers `POST /v2/chats`, and never by
 *  hand, so it is read strictly, as a `.term` is: anything but a known version and an
 *  id of the account's shape is not a chat, and the tab says the file is damaged rather
 *  than opening a chat nobody made. Extra fields are dropped, so a later version may add
 *  one an older nib ignores; a version it does not know is refused.
 *
 *  The one exception to "written once" is what the chat wears: choosing an icon writes
 *  the pointer again with `icon` and `iconColor` after the id (docs/icons.md). A nib
 *  from before them drops both and reads the same chat. */

import type { Pointer } from './types'

/** The extension a chat's pointer has. */
export const CHAT_EXTENSION = '.chat'

/** A chat's id as the account makes it: `c_` and 32 lower-case hex digits. */
const CHAT_ID = /^c_[0-9a-f]{32}$/

/** Whether a value is a chat's id. */
export function isChatId(value: unknown): value is string {
  return typeof value === 'string' && CHAT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A `.chat` file's text as its fields, or null for text that is not one. */
export function chatOf(text: string): Pointer | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Not JSON: a damaged or hand-made file, not a chat.
    return null
  }
  if (!isRecord(value)) return null

  const { v, chat } = value
  if (v !== 1 || !isChatId(chat)) return null
  return withIcon({ v, chat }, worn(value.icon), worn(value.iconColor))
}

/** The longest icon or colour a pointer keeps: a set's name and an icon's is well
 *  under it, and anything longer was not written by the app. */
const MOST_WORN = 100

/** A value of what the chat wears as the file says it, or null for one that is not a
 *  short, non-empty string. What it means is the app's to read (icons.ts). */
function worn(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MOST_WORN
    ? value
    : null
}

/** The same chat wearing this icon in this colour, or nothing for null. A colour with
 *  no icon to colour is no colour, as in a note's front matter. */
export function withIcon(pointer: Pointer, icon: string | null, iconColor: string | null): Pointer {
  const bare: Pointer = { v: pointer.v, chat: pointer.chat }
  if (icon === null) return bare
  return iconColor === null ? { ...bare, icon } : { ...bare, icon, iconColor }
}

/** The text a `.chat` file is written with: one line of JSON, the fields in the
 *  documented order, and a newline, as a text file ends. */
export function chatText(pointer: Pointer): string {
  const { v, chat, icon, iconColor } = withIcon(
    pointer,
    pointer.icon ?? null,
    pointer.iconColor ?? null,
  )
  return `${JSON.stringify({ v, chat, icon, iconColor })}\n`
}
