/** What the chats' surfaces read and call: the store's shapes, apart from how it keeps
 *  them (docs/chats.md 4.5, 4.17 and 6.1).
 *
 *  The Chats panel, a chat's tab, its replies pane, the notifications and the agent all
 *  read one store, `chats` in ./store.svelte.ts, through these shapes and nothing else.
 *  Every change a person makes goes through `send` (or a helper that builds the event and
 *  hands it to `send`), which puts it in the outbox first, draws it at once, and lets the
 *  outbox place it; nothing a surface does writes the device's store or the account
 *  directly. Every list here is replaced, never changed in place, so a surface reading
 *  it in an `$derived` or a keyed `#each` sees exactly the rows that changed. */

import type {
  Event,
  FileRef,
  Message,
  Meta,
  Notify,
  Poll,
  Post,
  Preview,
  Role,
  SearchQuery,
  Who,
} from '@nib/chats'
import type { Refusal } from '@nib/chats/wire'

/** A message as a surface draws it: as it stands, with what this device has said about
 *  it that the account has not placed yet drawn over it. `sending` while any of that is
 *  in the outbox (the faint clock); `refused` once the account would not take some of
 *  it, which the row's menu answers with Retry and Delete (`Chats.retry`,
 *  `Chats.discard`). */
export interface Shown extends Message {
  sending: boolean
  refused: Refusal | null
}

/** One chat as the Chats panel lists it: the account's row (`GET /v2/chats`), kept
 *  current by the hub's pokes, joined with its pointer on this device. */
export interface ChatEntry {
  id: string
  /** The account's id of the chat's space. */
  space: string
  /** The space's folder on this device, once it is here. */
  root: string | null
  /** The pointer's path on this device, and the chat's name (the file's, without
   *  `.chat`); null until the pointer has synced here. */
  path: string | null
  name: string | null
  /** The reader's role in the chat's space: what `may` in `@nib/chats` decides by. */
  role: Role
  members: number
  /** The log's head, when it moved and by whom. */
  lastSeq: number
  lastAt: number | null
  lastBy: Who | null
  /** Where the reader has read to, on every device of theirs. */
  readSeq: number
  /** Messages by others after the read place: exact once the device holds them, at
   *  least one while it does not yet. */
  unread: number
  /** Messages after the read place that call the reader. */
  mentions: number
  /** What pings for this chat; null is the default for its size (4.11). */
  notify: Notify | null
  mutedUntil: number | null
  meta: Meta
}

/** A person of a chat, as `GET /v2/chats/:id/members` names them. */
export interface ChatMember {
  who: Who
  /** Null for a deleted account, drawn as "Deleted account". */
  name: string | null
  role: Role
}

/** Where a chat's people are in it, live while it is open: who has it open, who is
 *  typing (and in which replies), and, in a chat of up to ten people with receipts on,
 *  where each has read to. */
export interface Presence {
  here: readonly Who[]
  typing: readonly { who: Who; parent?: string }[]
  /** Empty where receipts are not shown: a bigger chat, or the reader's switch off. */
  reads: ReadonlyMap<Who, number>
}

/** A new message as the composer has it, before it is an event: the store makes its
 *  ids and who it calls. */
export interface Draft {
  body: string
  parent?: string
  quote?: string
  files?: FileRef[]
  poll?: Poll
  preview?: Preview
  alsoToChat?: boolean
  via?: { agent: string }
}

/** A post waiting for its time, held by the account (4.4, scheduled send). */
export interface Scheduled {
  id: string
  sendAt: number
  post: Post
}

/** One message a search found, and the chat it is in. */
export interface Hit {
  chat: string
  message: Message
}

/** A list of messages a surface draws, kept current: the chat itself, or one message's
 *  replies. */
export interface MessageList {
  /** Placed messages, oldest first: a window of the chat, never the whole of it. */
  readonly messages: readonly Shown[]
  /** The reader's own posts the account has not placed yet, oldest first: drawn under
   *  the placed ones, each `sending` or `refused`. */
  readonly pending: readonly Shown[]
  /** Whether the window reaches the chat's first message, and its newest. */
  readonly atStart: boolean
  readonly atEnd: boolean
  /** Whether a page is on its way. */
  readonly loading: boolean
  /** Hears every change of the lists above; answers how to stop. */
  watch(listener: () => void): () => void
}

/** One message's replies, for the replies pane. */
export interface RepliesView extends MessageList {
  readonly parent: Shown | null
  close(): void
}

/** An open chat: a window of its messages from the device's store, a socket to its
 *  log while it is open, and the people in it. */
export interface ChatView extends MessageList {
  readonly chat: string
  readonly entry: ChatEntry | null
  readonly meta: Meta
  readonly role: Role | null
  readonly members: readonly ChatMember[]
  readonly presence: Presence
  /** The read place when the chat was opened: where the new-messages line stands until
   *  the chat is left (4.10). Moves back only with `markUnread`. */
  readonly lineAt: number
  /** Pages older or newer messages into the window, 200 at a time (4.17). */
  older(): Promise<void>
  newer(): Promise<void>
  /** The window around one message, from the store, or from the account when the store
   *  does not have it yet. False for a message that is not there. */
  jump(message: string): Promise<boolean>
  /** The window at the newest message. */
  latest(): Promise<void>
  /** One message's replies. */
  replies(parent: string): RepliesView
  /** The newest `seq` that has been on screen with the window in front. */
  read(seq: number): void
  /** Mark unread: the read place moves back to just before `seq`, and the line with it. */
  markUnread(seq: number): void
  /** The composer's words changed: a typing frame at most every three seconds. */
  typed(parent?: string): void
  close(): void
}

/** The chats' store. */
export interface Chats {
  /** Every chat the account reaches, newest first. */
  readonly list: readonly ChatEntry[]
  /** Whether the account has answered the list once since launch. */
  readonly ready: boolean
  /** The reader, as chats name people. */
  readonly me: Who | null
  /** Hears every change of `list`; answers how to stop. */
  watch(listener: () => void): () => void
  /** Hears new messages by others once the device holds them, in order: what a
   *  notification reads. Answers how to stop. */
  heard(listener: (chat: string, messages: readonly Message[]) => void): () => void
  entry(chat: string): ChatEntry | null
  /** The reader's switch for read receipts, reciprocal (4.10). */
  receipts: boolean

  /** Opens a chat: the same view for the same chat while any surface holds it. */
  open(chat: string): ChatView

  /** The one write path: an event into the outbox, drawn at once, placed when the
   *  account can be reached. */
  send(chat: string, event: Event): Promise<void>
  /** A new message, or a reply; answers its id. */
  post(chat: string, draft: Draft): Promise<string>
  /** A post to place at `sendAt`; answers its message's id. */
  schedule(chat: string, draft: Draft, sendAt: number): Promise<string>
  scheduled(chat: string): Promise<Scheduled[]>
  edit(chat: string, message: string, body: string, files?: FileRef[]): Promise<void>
  /** Delete for everyone; a post not placed yet is taken out of the outbox. */
  remove(chat: string, message: string): Promise<void>
  react(chat: string, message: string, emoji: string, on: boolean): Promise<void>
  pin(chat: string, message: string, on: boolean): Promise<void>
  vote(chat: string, message: string, answers: number[]): Promise<void>
  setMeta(chat: string, meta: Partial<Meta>): Promise<void>
  /** Unsend: the reader's last message, within fifteen seconds, taken back; answers its
   *  words for the composer, or null where there is nothing to take back. */
  unsend(chat: string): Promise<string | null>
  /** A refused message's menu: send what was refused again, or let it go. */
  retry(chat: string, message: string): Promise<void>
  discard(chat: string, message: string): Promise<void>

  /** What pings the reader for a chat, kept by the account (4.11). */
  notifyFor(chat: string, notify: Notify | null, mutedUntil: number | null): Promise<void>
  members(chat: string): Promise<ChatMember[]>

  /** Messages that answer a query (4.12), newest first: across every chat, or in one. */
  search(query: string, chat?: string): Promise<Hit[]>
  /** The query as the store reads it, for a surface that shows what was understood. */
  parse(query: string): SearchQuery
  /** Messages that link a note by one of its names, `[[name]]`: the note's backlinks
   *  from chats (4.13). */
  linking(names: readonly string[]): Promise<Hit[]>

  /** The composer's words for a chat, kept on the device after the quiet pause. */
  draft(chat: string): string
  keepDraft(chat: string, text: string): void

  /** A file's bytes up to the account under their hash, for a message to name; null
   *  where it could not go. */
  upload(bytes: Uint8Array): Promise<string | null>
  /** A file a message in this chat names, as a URL the window can draw. */
  fileUrl(chat: string, hash: string): Promise<string | null>
  /** A link's preview, made on this device (4.8); null for none. */
  preview(url: string): Promise<Preview | null>

  /** A new chat in a folder of a space: made on the account, its pointer `name.chat`
   *  written there. Answers the pointer's path, or null where none was made (the space
   *  is not on the account, or the account would not). */
  make(folder: string, name: string): Promise<string | null>
  /** The chat a `.chat` file names, or null for a file that is not a pointer. */
  chatAt(path: string): Promise<string | null>
}
