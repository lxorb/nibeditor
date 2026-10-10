/** The shapes the chats' lanes meet at (docs/chats.md, 6.1).
 *
 *  The app, the Worker's `ChatLog` and the account connector are three programs by
 *  several lanes, and each reads what the others write. So every shape they share is
 *  spelled once, here, and the rules over them - the reducer, the roles table, the
 *  search language - are pure functions beside it, so the Worker decides and the app
 *  shows by the same code.
 *
 *  A chat is a channel in a space, never a direct message (decision 7.1), and its log
 *  lives in the account and in every device's store, never in a file (decision 7.2).
 *  What the space holds is a pointer naming it (`Pointer`, 4.2). */

/** Who wrote something: a person with an account, a link guest, or a program token
 *  (a CI job posting "via" its name). Ids are the account's, never names. */
export type Who = `user:${string}` | `guest:${string}` | `program:${string}`

/** Who a message calls for: a person, everybody with a device active (`here`), or
 *  everybody in the chat (`everyone`). */
export type Mention = Who | 'here' | 'everyone'

/** A person's role in the chat's space, as the rooms' one query answers it. */
export type Role = 'read' | 'write' | 'owner'

/** Who may post in a chat: every writer (the default), or the space's owner only,
 *  which is the announcement channel (4.6). */
export type Posting = 'writers' | 'owner'

/** What pings a person for a chat (4.11). */
export type Notify = 'all' | 'mentions' | 'nothing'

/** A `.chat` file's text: the chat the account made, by its id (4.2). The file is the
 *  chat's name and place in the space; access is the chat's space, never the file.
 *
 *  And what the chat wears in every list that shows it, as a canvas keeps it under
 *  `nib`: the icon in the app's written form (`rocket`, an emoji, `set:name`) and the
 *  accent a stroked one is drawn in. Both the file's, so they go wherever the pointer
 *  goes, by either sync, and a nib that knows neither key still reads the chat. */
export interface Pointer {
  v: 1
  chat: string
  icon?: string
  iconColor?: string
}

/** A file a message carries, sent first as a blob by its hash (4.8). A picture or a
 *  video states its size and a preview so its row never jumps; a voice message its
 *  length and 64 bars of loudness so the waveform is drawn before the sound loads. */
export interface FileRef {
  /** sha256 of the bytes, lower-case hex: the blob's name. */
  hash: string
  name: string
  size: number
  /** The media type, `image/webp`. */
  type: string
  width?: number
  height?: number
  /** The hash of a 480 px WebP the sender made: a picture's, or a video's first frame. */
  preview?: string
  seconds?: number
  /** 64 bars of loudness, each 0 to 255. */
  wave?: number[]
}

/** A link preview, made by the sender's device and frozen in the message (4.8). */
export interface Preview {
  url: string
  title: string
  site?: string
  text?: string
  /** The hash of the page's picture, sent as a blob. */
  picture?: string
}

/** A poll: a question, two to ten answers, one or several chosen, and an end. */
export interface Poll {
  question: string
  answers: string[]
  several: boolean
  /** When voting ends, on the account's clock; none for a poll that never ends. */
  ends?: number
}

/** A new message. `id` is the event's own id, so a resend is the same event; `message`
 *  is the message's, which edits, reactions and replies name. Both are ULIDs the
 *  device makes. */
export interface Post {
  kind: 'post'
  id: string
  message: string
  body: string
  /** The message this is a reply to: it sits in that message's replies. */
  parent?: string
  /** The message this quotes: its line above the words, a press jumps to it. */
  quote?: string
  files?: FileRef[]
  poll?: Poll
  preview?: Preview
  /** The agent that wrote it for its author (4.14). */
  via?: { agent: string }
  /** A reply also shown in the chat itself, Slack's "also send to the channel". */
  alsoToChat?: boolean
  mentions?: Mention[]
}

/** One thing that happened in a chat. The log is a list of these, each given its place
 *  by `ChatLog` (`Placed`), and the state of every message is what `apply` makes of
 *  them (4.3, 4.5). */
export type Event =
  | Post
  /** New words for one's own message; `files` replaces the files when given. */
  | { kind: 'edit'; id: string; target: string; body: string; files?: FileRef[] }
  /** Delete for everyone: the author's own, or anybody's by the space's owner. */
  | { kind: 'delete'; id: string; target: string }
  /** One person's reaction with one emoji, put on or taken back. */
  | { kind: 'react'; id: string; target: string; emoji: string; on: boolean }
  | { kind: 'pin'; id: string; target: string; on: boolean }
  /** One person's answers to a poll, by index; none takes the vote back. */
  | { kind: 'vote'; id: string; target: string; answers: number[] }
  /** The chat's settings, each key last writer by order. */
  | { kind: 'meta'; id: string; topic?: string; posting?: Posting; slowmode?: number }
  /** A post to place at `sendAt`, held by the object's alarm and editable until then. */
  | { kind: 'schedule'; id: string; sendAt: number; post: Post }

/** What `ChatLog` adds as it appends an event: its place, when it arrived (the time
 *  everybody is shown), who sent it from which device, and when it was written if that
 *  was more than a minute earlier (an outbox that waited). */
export interface Placed {
  seq: number
  at: number
  author: Who
  device?: string
  madeAt?: number
}

/** An event with its place in the log. */
export type Logged = Event & Placed

/** One earlier wording of an edited message. */
export interface Wording {
  body: string
  at: number
}

/** A message as it stands after every event about it (4.3). A deleted one keeps its
 *  place, its author and its replies' count, so the replies keep their place, and
 *  loses everything it said. */
export interface Message {
  id: string
  seq: number
  at: number
  author: Who
  body: string
  parent?: string
  quote?: string
  alsoToChat: boolean
  files: FileRef[]
  poll?: Poll & { votes: Record<Who, number[]> }
  preview?: Preview
  via?: { agent: string }
  mentions: Mention[]
  /** Who reacted with each emoji, in the order they did. */
  reactions: Record<string, Who[]>
  pinned: boolean
  /** When the words now shown were written, for an edited message. */
  editedAt?: number
  /** The earlier wordings, oldest first, shown to members on the "edited" mark. */
  history: Wording[]
  deleted: boolean
  /** Replies that stand, and when the latest of them arrived. */
  replies: number
  lastReplyAt?: number
}

/** A chat's settings (4.6). */
export interface Meta {
  topic: string
  posting: Posting
  /** The least seconds between two posts of one person; 0 for none. */
  slowmode: number
}

/** A person a chat's mention completion and parsing know: their account's name and
 *  their nickname in the chat's space, if any (4.9). */
export interface Member {
  who: Who
  name: string
  nick?: string
}
