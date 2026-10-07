/** A chat's desktop notifications (docs/chats.md 4.11): a message that arrives while
 *  the chat is not in front of the reader is decided by `decide` in @nib/chats/notify,
 *  the one function the Worker will ask too the day phones are pushed to, and shown
 *  through the system's own notifications (../notify.ts).
 *
 *  **What arrives.** The chats' store hands over every new message by others once the
 *  device holds it (`chats.heard`): caught up after the hub's poke for a chat no tab
 *  has open, or placed on the socket of one that is. Each is decided once.
 *
 *  **One per chat.** Its notification is tagged with the chat's id, so the newest message
 *  that pings replaces the one before rather than stacking, and it is taken back once
 *  the chat is read (`read`), here or on another device.
 *
 *  **What a press does.** It opens the chat at the message; Reply sends the words into
 *  the same place the message was in (its replies, for a reply) through the store's one
 *  write path, and marks the chat read up to it, as WhatsApp does.
 *
 *  Everything outside is the world's, so the rules are tested here without a socket, a
 *  window or a clock; the app's world is ./notices.ts. */

import type { Message, Notify, Who } from '@nib/chats'
import { decide, type Hush } from '@nib/chats/notify'
import type { Notice } from '../notify'

/** One chat, as much as a notification reads of it. */
export interface Told {
  /** Where it is, the quieter line under a notification's words: `#thesis`, or the
   *  space's name while the pointer is not on this device yet. */
  place: string | null
  members: number
  notify: Notify | null
  mutedUntil: number | null
  /** Where the reader has read to, on every device of theirs. */
  readSeq: number
}

/** What the reader chose for every chat at once, and Do not disturb, as of now. */
export interface Chosen extends Hush {
  previews: boolean
  sound: boolean
}

/** The words a notification needs, in the reader's language. */
export interface Words {
  /** The title when previews are off: that something came, and nothing of it. */
  hidden: string
  reply: string
  send: string
}

export interface NoticeWorld {
  me(): Who | null
  chat(chat: string): Promise<Told | null>
  /** Who wrote a message: the author a reply answers. */
  authorOf(chat: string, message: string): Promise<Who | null>
  /** What the chat calls somebody. */
  nameOf(chat: string, who: Who): Promise<string>
  chosen(): Chosen
  /** Somebody is at this device: what `@here` reaches. */
  active(): boolean
  /** The chat is on screen in a window in front. */
  seen(chat: string): boolean
  now(): number
  show(notice: Notice): void
  unshow(tag: string): void
  open(chat: string, message: string): void
  /** Words into the chat, as a reply to `parent` where there is one. */
  reply(chat: string, body: string, parent?: string): Promise<void>
  /** The read place moved up to `seq`. */
  read(chat: string, seq: number): void
}

/** The longest line a notification shows of a message. */
const LONGEST_LINE = 200

/** A message as one line of plain words: its first line with the marks a reader would
 *  not type taken off, else its poll's question, else its first file's name. */
export function lineOf(message: Message): string {
  const first = message.body
    .split('\n')
    .map((line) =>
      line
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/(\*\*|__|~~|\|\||`)/g, '')
        .trim(),
    )
    .find(Boolean)
  const line = first ?? message.poll?.question ?? message.files[0]?.name ?? ''
  return line.length > LONGEST_LINE ? `${line.slice(0, LONGEST_LINE - 1)}…` : line
}

export class ChatNotices {
  /** The newest `seq` already decided, per chat: nothing at or below it is told again. */
  private readonly told = new Map<string, number>()
  /** The `seq` each chat's notification is showing. */
  private readonly showing = new Map<string, number>()
  /** One decision at a time per chat, in the order they arrived. */
  private readonly turns = new Map<string, Promise<void>>()

  constructor(
    private readonly world: NoticeWorld,
    private readonly words: () => Words,
  ) {}

  /** New messages by others, once this device holds them (the chats' store, `heard`):
   *  caught up after the hub's poke for a chat no tab has open, or placed on the socket of
   *  one that is. */
  arrived(chat: string, messages: readonly Message[]): void {
    this.turn(chat, async () => {
      const told = await this.world.chat(chat)
      if (told) await this.tell(chat, told, messages)
    })
  }

  /** The reader read the chat up to `seq`, here or elsewhere: what they have read is
   *  never told, and a notification of it goes. */
  read(chat: string, seq: number): void {
    this.keep(chat, seq)
    const shown = this.showing.get(chat)
    if (shown !== undefined && shown <= seq) {
      this.showing.delete(chat)
      this.world.unshow(chat)
    }
  }

  private keep(chat: string, seq: number): void {
    this.told.set(chat, Math.max(this.told.get(chat) ?? 0, seq))
  }

  private turn(chat: string, work: () => Promise<void>): void {
    const next = (this.turns.get(chat) ?? Promise.resolve()).then(work).catch(() => {
      // A message whose people could not be asked about is not told: the chat's count
      // still moves, and the next message is decided as ever.
    })
    this.turns.set(chat, next)
    void next.then(() => {
      if (this.turns.get(chat) === next) this.turns.delete(chat)
    })
  }

  /** Decides the newest messages first and shows the first one that pings. */
  private async tell(id: string, chat: Told, messages: readonly Message[]): Promise<void> {
    const decided = this.told.get(id) ?? 0
    const fresh = messages
      .filter((one) => one.seq > Math.max(decided, chat.readSeq) && !one.deleted)
      .sort((a, b) => b.seq - a.seq)
    const newest = fresh[0]
    if (!newest) return
    this.keep(id, newest.seq)

    const me = this.world.me()
    if (!me) return
    const chosen = this.world.chosen()
    const now = this.world.now()
    const local = new Date(now)
    const moment = { now, day: local.getDay(), minute: local.getHours() * 60 + local.getMinutes() }
    const seen = this.world.seen(id)
    const active = this.world.active()

    for (const message of fresh) {
      const repliesTo = message.parent ? await this.world.authorOf(id, message.parent) : null
      const ping = decide({
        me,
        message: {
          author: message.author,
          body: message.body,
          mentions: message.mentions,
          repliesTo,
        },
        chat,
        hush: chosen,
        moment,
        active,
        seen,
      })
      if (ping === 'show') {
        await this.show(id, chat, message, chosen)
        return
      }
      // Seen or held back by a setting of the chat's: the older ones would be too.
      if (ping !== 'level') return
    }
  }

  private async show(id: string, chat: Told, message: Message, chosen: Chosen): Promise<void> {
    const words = this.words()
    const name = chosen.previews ? await this.world.nameOf(id, message.author) : ''
    this.showing.set(id, message.seq)
    this.world.show({
      title: chosen.previews ? name : words.hidden,
      body: chosen.previews ? lineOf(message) : '',
      tag: id,
      from: chosen.previews ? (chat.place ?? '') : '',
      silent: !chosen.sound,
      opened: () => this.world.open(id, message.id),
      reply: {
        placeholder: words.reply,
        send: words.send,
        replied: (text) => void this.answer(id, message, text),
      },
    })
  }

  private async answer(id: string, message: Message, text: string): Promise<void> {
    await this.world.reply(id, text.trim(), message.parent)
    this.world.read(id, message.seq)
    this.read(id, message.seq)
  }
}
