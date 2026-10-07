/** One chat open in a tab: the store's view of it, what the tab draws of that, and
 *  every gesture made in it turned into the store's one write (docs/chats.md 4.15,
 *  4.16).
 *
 *  The store holds the window of messages, pages it and keeps it current (../view.svelte.ts);
 *  this is what a tab adds over it: the rows with their day lines, groups, New line and
 *  receipts (`rowsOf`), the replies pane, a quote or an edit in the composer, the row a
 *  jump landed on. The tab's components read this and call it; none of them builds an
 *  event. */

import type { FileRef, Member, Message, Poll, Preview, Who } from '@nib/chats'
import { chatLink } from '@nib/chats/links'
import { copyText } from '../../clipboard'
import { t } from '../../i18n.svelte'
import type { ChatEntry, ChatView, Shown } from '../api'
import { trimmed } from './compose'
import { type Item, rowsOf } from './rows'
import { saved } from './saved.svelte'
import { store } from './source.svelte'
import { dayOf } from './when'

/** What the composer is doing besides writing a new message. */
export type Aside = { kind: 'quote'; message: Message } | { kind: 'edit'; message: Message } | null

export class ChatPage {
  readonly id: string
  readonly view: ChatView
  /** The message whose replies are open beside the chat. */
  replying = $state<string | null>(null)
  aside = $state<Aside>(null)
  /** The row a jump landed on, tinted for a moment. */
  flashed = $state<string | null>(null)

  constructor(id: string) {
    this.id = id
    this.view = store().open(id)
  }

  get me(): Who | null {
    return store().me
  }

  get entry(): ChatEntry | null {
    return this.view.entry
  }

  get messages(): readonly Shown[] {
    return this.view.messages
  }

  /** More messages before the first held, and after the last. */
  get before(): boolean {
    return !this.view.atStart
  }

  get after(): boolean {
    return !this.view.atEnd
  }

  /** The chat's people as mentions and names read them. A deleted account is called
   *  what it is. */
  readonly members: Member[] = $derived.by(() =>
    this.view.members.map((one) => ({ who: one.who, name: one.name ?? t('Deleted account') })),
  )

  /** Whether the first page is in. */
  get ready(): boolean {
    return !this.view.loading || this.view.messages.length > 0
  }

  /** The rows, as the tab draws them. */
  readonly items: Item<Shown>[] = $derived.by(() =>
    rowsOf({
      messages: this.view.messages,
      outbox: this.view.pending,
      me: this.me,
      readAtOpen: this.view.lineAt,
      dayOf,
      reads: this.view.presence.reads,
    }),
  )

  older(): Promise<void> {
    return this.view.atStart ? Promise.resolve() : this.view.older()
  }

  newer(): Promise<void> {
    return this.view.atEnd ? Promise.resolve() : this.view.newer()
  }

  /** To a message, loading the window around it where it is not held, and tinting it. */
  async jump(message: string): Promise<void> {
    if (!this.view.messages.some((one) => one.id === message)) {
      if (!(await this.view.jump(message))) return
    }
    this.flashed = message
  }

  /** To the newest, loading it where it is not held. */
  bottom(): Promise<void> {
    return this.view.atEnd ? Promise.resolve() : this.view.latest()
  }

  /** The newest message the reader has seen; the store keeps it on every device. */
  seen(seq: number): void {
    const entry = this.entry
    if (!entry || seq > entry.readSeq) this.view.read(seq)
  }

  markUnread(message: Message): void {
    this.view.markUnread(message.seq)
  }

  /** A new message, or a reply where `parent` says. */
  post(
    text: string,
    more: {
      parent?: string
      alsoToChat?: boolean
      files?: FileRef[]
      poll?: Poll
      preview?: Preview
    } = {},
  ): void {
    const body = trimmed(text)
    if (!body && !more.files?.length && !more.poll) return
    const quote = this.aside?.kind === 'quote' && !more.parent ? this.aside.message.id : undefined
    void store().post(this.id, {
      body,
      ...(quote ? { quote } : {}),
      ...(more.parent ? { parent: more.parent } : {}),
      ...(more.alsoToChat ? { alsoToChat: true } : {}),
      ...(more.files?.length ? { files: more.files } : {}),
      ...(more.poll ? { poll: more.poll } : {}),
      ...(more.preview ? { preview: more.preview } : {}),
    })
    if (!more.parent) this.aside = null
  }

  /** The same, held by the account until `sendAt`. */
  schedule(text: string, sendAt: number): void {
    const body = trimmed(text)
    if (body) void store().schedule(this.id, { body }, sendAt)
  }

  /** Unsend: the reader's last message back for the composer, within its window. */
  unsend(): Promise<string | null> {
    return store().unsend(this.id)
  }

  edit(message: Message, text: string): void {
    const body = trimmed(text)
    if (body === message.body) return
    if (!body) this.remove(message.id)
    else void store().edit(this.id, message.id, body)
  }

  remove(message: string): void {
    void store().remove(this.id, message)
  }

  /** A reaction put on, or taken back where the reader already wears it. */
  react(message: Message, emoji: string): void {
    const me = this.me
    const on = !(me && message.reactions[emoji]?.includes(me))
    void store().react(this.id, message.id, emoji, on)
  }

  pin(message: Message): void {
    void store().pin(this.id, message.id, !message.pinned)
  }

  vote(message: Message, answers: number[]): void {
    void store().vote(this.id, message.id, answers)
  }

  topic(topic: string): void {
    void store().setMeta(this.id, { topic })
  }

  retry(message: string): void {
    void store().retry(this.id, message)
  }

  discard(message: string): void {
    void store().discard(this.id, message)
  }

  save(message: Message): void {
    saved.toggle(this.id, message)
  }

  isSaved(message: Message): boolean {
    return saved.has(this.id, message.id)
  }

  copyLink(message: Message): Promise<void> {
    return copyText(chatLink(this.id, message.id))
  }

  /** The pinned messages: every message held or in the store that is pinned. */
  async pinned(): Promise<Message[]> {
    const found = await store().search('has:pin', this.id)
    return found.map((one) => one.message)
  }

  /** The reader's newest message in the chat, for ↑ in an empty composer. */
  lastOwn(): Message | null {
    const me = this.me
    for (let at = this.messages.length - 1; at >= 0; at--) {
      const one = this.messages[at]
      if (one?.author === me && !one.deleted && !one.poll) return one
    }
    return null
  }

  close(): void {
    this.view.close()
  }
}
