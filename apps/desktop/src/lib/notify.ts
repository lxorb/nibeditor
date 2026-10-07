/** One notification from the page, the system's own: the crate's on a desktop
 *  (notices.rs), the browser's where the page was allowed to show them, and nothing on a
 *  phone, whose notifications are the activity's. Said by a reminder the page rang
 *  itself, a terminal asking to be looked at, and a chat message (docs/chats.md 4.11).
 *
 *  `tag` folds a second notification of the same thing into the first, and `opened` is
 *  what a press on it does: the crate brings nib forward and says which one was pressed,
 *  and the page answers it here. Where the system has a field to answer in (a Windows
 *  toast, a Mac's banner), `reply` offers one, and what was typed comes back to it. */

import { invoke, isDesktop } from './tauri'

/** What a desktop's press says: which notice, and what was done with it. */
const PRESSED = 'nib://notice'

/** Notices still answered, at most this many: the oldest is let go first, as the
 *  system lets its own go. */
const KEPT = 64

export interface Notice {
  title: string
  body: string
  /** A second notice with the same tag replaces the first. */
  tag?: string
  /** A quieter line under the words: what it is from. */
  from?: string
  /** Shown without the system's sound. */
  silent?: boolean
  /** What a press on it does. */
  opened?: () => void
  /** A field to answer in, where the system has one, and what is done with the words. */
  reply?: { placeholder: string; send: string; replied: (text: string) => void }
}

/** The ones a press may still answer, by id, and the id each tag is showing. */
const answering = new Map<string, Notice>()
const showing = new Map<string, string>()
/** A browser's notification still up, by tag, so it can be taken back. */
const up = new Map<string, Notification>()
let listening: Promise<unknown> | null = null

/** The short form every older caller uses. */
export function notify(title: string, body: string, tag?: string, opened?: () => void): void {
  show({ title, body, ...(tag ? { tag } : {}), ...(opened ? { opened } : {}) })
}

/** Shows one notice. */
export function show(one: Notice): void {
  if (isDesktop) {
    shownByTheCrate(one)
    return
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const shown = new Notification(one.title, {
    body: one.from ? `${one.body}\n${one.from}` : one.body,
    ...(one.tag ? { tag: one.tag } : {}),
    ...(one.silent ? { silent: true } : {}),
  })
  shown.onclick = () => {
    window.focus()
    one.opened?.()
    shown.close()
  }
  if (one.tag) up.set(one.tag, shown)
}

/** Asks the browser, once, whether the page may show a notification at all. */
export function askToShow(): void {
  if (isDesktop || typeof Notification === 'undefined') return
  if (Notification.permission === 'default') void Notification.requestPermission()
}

/** Takes back whatever is showing under a tag: the chat it was about has been read. */
export function unshow(tag: string): void {
  up.get(tag)?.close()
  up.delete(tag)
  const id = showing.get(tag)
  if (id === undefined) return
  showing.delete(tag)
  answering.delete(id)
  if (isDesktop) void invoke('notice_clear', { tag }).catch(() => undefined)
}

function shownByTheCrate(one: Notice): void {
  listening ??= import('@tauri-apps/api/event').then(({ listen }) =>
    listen<unknown>(PRESSED, (event) => pressed(event.payload)),
  )

  const id = fresh()
  if (one.tag) {
    const before = showing.get(one.tag)
    if (before !== undefined) answering.delete(before)
    showing.set(one.tag, id)
  }
  answering.set(id, one)
  for (const old of answering.keys()) {
    if (answering.size <= KEPT) break
    answering.delete(old)
  }

  void invoke('notice_show', {
    notice: {
      id,
      tag: one.tag ?? id,
      title: one.title,
      body: one.body,
      from: one.from ?? '',
      silent: one.silent === true,
      reply: one.reply ? { placeholder: one.reply.placeholder, send: one.reply.send } : null,
    },
  }).catch(() => undefined)
}

/** A press the crate heard, answered by the notice it was on. */
function pressed(said: unknown): void {
  if (typeof said !== 'object' || said === null) return
  const { id, act, text } = said as Record<string, unknown>
  const one = typeof id === 'string' ? answering.get(id) : undefined
  if (!one) return
  if (act === 'reply' && typeof text === 'string' && text.trim()) one.reply?.replied(text)
  else if (act === 'open') one.opened?.()
}

/** Sixteen hex digits: an id nothing else will ever have said. */
function fresh(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
