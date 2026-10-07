/** The one reducer: a chat's log made into its messages (docs/chats.md 4.3, 4.5).
 *
 *  `ChatLog` applies every event with it in the transaction that appends it, and every
 *  device applies the same events with it to its store, so what a device shows and what
 *  the account keeps are the same rules. Those rules are small because a message has
 *  one author:
 *
 *  - **An edit is the author's**, and the latest by `seq` stands; an edit by anybody
 *    else is no edit. Every earlier wording is kept as the message's history.
 *  - **A delete stands over an edit in either order**, and over everything else said
 *    about the message: its words, files, reactions, pin and poll go, its place and its
 *    replies' count stay, so the replies keep their place.
 *  - **A reaction is a set per person and emoji**, the later `on` or off standing; a
 *    vote is a set per person, the later standing; a pin, the later.
 *  - **The chat's settings are last writer per key.**
 *
 *  And one rule over all of them: **the same placed events give the same state in any
 *  order.** A device catching up applies pages as they come, a socket can deliver an
 *  event before the page that precedes it, and a resend is the same event twice. So
 *  nothing here depends on what came first: every message is built afresh from what is
 *  known about it (`Marks`), and what is known only grows - the lowest `seq` for a post,
 *  the highest for each register, the union of edits, deletes and replies. An edit, a
 *  reaction or a reply that arrives before its message waits in the marks for it, and a
 *  lower `seq` arriving late never undoes a higher one. The property test holds it.
 *
 *  A `schedule` is not a message until the object places its post, as a post of its
 *  own, at its time, so it changes nothing here. */

import type { FileRef, Logged, Message, Meta, Placed, Post, Who, Wording } from './types'

type LoggedPost = Post & Placed

/** One value of a register and the place of the event that set it. */
interface Register<T> {
  seq: number
  value: T
}

/** One wording of a message: its post's or an edit's. */
interface Version {
  seq: number
  at: number
  author: Who
  body: string
  files?: FileRef[]
}

/** Everything known about one message id, whether or not its post has arrived. */
interface Marks {
  /** The post with the lowest `seq` for this id: a resend placed twice is placed once. */
  post?: LoggedPost
  /** Every edit of it, by anybody: whose counts is decided once the post is known. */
  edits: Map<number, Version>
  deleted: boolean
  pin?: Register<boolean>
  /** A reaction per person and emoji, keyed `emoji` NUL `who`. */
  reactions: Map<string, Register<boolean> & { emoji: string; who: Who }>
  /** A vote per person, with when it arrived, which an ended poll is judged by. */
  votes: Map<Who, Register<number[]> & { at: number }>
  /** The ids of every post that named this one as its parent. */
  children: Set<string>
}

/** A chat as its events have made it: every message as it stands, the settings, and the
 *  highest `seq` applied. `marks` and `metaSeqs` are the reducer's own. */
export interface ChatState {
  readonly messages: Map<string, Message>
  meta: Meta
  seq: number
  readonly marks: Map<string, Marks>
  readonly metaSeqs: Record<keyof Meta, number>
}

/** A chat before any event: no messages, a topic of nothing, every writer posting. */
export function chatState(): ChatState {
  return {
    messages: new Map(),
    meta: { topic: '', posting: 'writers', slowmode: 0 },
    seq: 0,
    marks: new Map(),
    metaSeqs: { topic: 0, posting: 0, slowmode: 0 },
  }
}

/** Applies one placed event, and answers every message it changed as it now stands: a
 *  reply changes its parent's count too. A settings change, a schedule, or an event
 *  about a message that has not arrived yet answers none. */
export function apply(state: ChatState, event: Logged): Message[] {
  state.seq = Math.max(state.seq, event.seq)
  switch (event.kind) {
    case 'post':
      return posted(state, event)
    case 'edit': {
      const version: Version = {
        seq: event.seq,
        at: event.at,
        author: event.author,
        body: event.body,
      }
      if (event.files) version.files = event.files
      marksOf(state, event.target).edits.set(event.seq, version)
      return rebuilt(state, [event.target])
    }
    case 'delete': {
      const marks = marksOf(state, event.target)
      marks.deleted = true
      return rebuilt(state, [event.target, marks.post?.parent])
    }
    case 'react': {
      const { reactions } = marksOf(state, event.target)
      const key = `${event.emoji}\u0000${event.author}`
      if (newer(reactions.get(key), event.seq)) {
        reactions.set(key, {
          seq: event.seq,
          value: event.on,
          emoji: event.emoji,
          who: event.author,
        })
      }
      return rebuilt(state, [event.target])
    }
    case 'pin': {
      const marks = marksOf(state, event.target)
      if (newer(marks.pin, event.seq)) marks.pin = { seq: event.seq, value: event.on }
      return rebuilt(state, [event.target])
    }
    case 'vote': {
      const { votes } = marksOf(state, event.target)
      if (newer(votes.get(event.author), event.seq)) {
        votes.set(event.author, { seq: event.seq, value: event.answers, at: event.at })
      }
      return rebuilt(state, [event.target])
    }
    case 'meta':
      metaSet(state, event.seq, 'topic', event.topic)
      metaSet(state, event.seq, 'posting', event.posting)
      metaSet(state, event.seq, 'slowmode', event.slowmode)
      return []
    case 'schedule':
      return []
  }
}

/** A post: kept if it is the first placing of its message, and its parent told. */
function posted(state: ChatState, event: LoggedPost): Message[] {
  const marks = marksOf(state, event.message)
  const before = marks.post
  if (before && before.seq <= event.seq) return []
  marks.post = event
  if (event.parent !== undefined) marksOf(state, event.parent).children.add(event.message)
  return rebuilt(state, [event.message, event.parent, before?.parent])
}

function metaSet<K extends keyof Meta>(
  state: ChatState,
  seq: number,
  key: K,
  value: Meta[K] | undefined,
) {
  if (value === undefined || state.metaSeqs[key] >= seq) return
  state.metaSeqs[key] = seq
  state.meta[key] = value
}

function newer(register: Register<unknown> | undefined, seq: number): boolean {
  return register === undefined || register.seq < seq
}

function marksOf(state: ChatState, id: string): Marks {
  let marks = state.marks.get(id)
  if (!marks) {
    marks = {
      edits: new Map(),
      deleted: false,
      reactions: new Map(),
      votes: new Map(),
      children: new Set(),
    }
    state.marks.set(id, marks)
  }
  return marks
}

/** Builds each named message afresh and puts it in the state; answers those that exist. */
function rebuilt(state: ChatState, ids: readonly (string | undefined)[]): Message[] {
  const out: Message[] = []
  for (const id of new Set(ids)) {
    if (id === undefined) continue
    const message = built(state, id)
    if (!message) continue
    state.messages.set(id, message)
    out.push(message)
  }
  return out
}

/** One message as everything known about it makes it, or null before its post. */
function built(state: ChatState, id: string): Message | null {
  const marks = state.marks.get(id)
  const post = marks?.post
  if (!marks || !post) return null

  const message: Message = {
    id,
    seq: post.seq,
    at: post.at,
    author: post.author,
    body: '',
    alsoToChat: post.alsoToChat === true,
    files: [],
    mentions: [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: marks.deleted,
    replies: 0,
  }
  if (post.parent !== undefined) message.parent = post.parent
  repliesOf(state, id, message)
  if (marks.deleted) return message

  const versions = wordings(post, marks)
  const current = versions.at(-1) ?? post
  message.body = current.body
  message.files = filesOf(versions, post)
  message.mentions = post.mentions ?? []
  message.reactions = reactionsOf(marks)
  message.pinned = marks.pin?.value === true
  message.history = historyOf(post, versions)
  if (versions.length > 0) message.editedAt = current.at
  if (post.quote !== undefined) message.quote = post.quote
  if (post.preview) message.preview = post.preview
  if (post.via) message.via = post.via
  if (post.poll) message.poll = { ...post.poll, votes: votesOf(post, marks) }
  return message
}

/** The author's own edits after the post, in order. */
function wordings(post: LoggedPost, marks: Marks): Version[] {
  return [...marks.edits.values()]
    .filter((edit) => edit.author === post.author && edit.seq > post.seq)
    .sort((a, b) => a.seq - b.seq)
}

/** The files after every edit that named files: an edit without them keeps them. */
function filesOf(versions: readonly Version[], post: LoggedPost): FileRef[] {
  let files = post.files ?? []
  for (const version of versions) if (version.files) files = version.files
  return files
}

/** Every wording but the one shown, oldest first. */
function historyOf(post: LoggedPost, versions: readonly Version[]): Wording[] {
  if (versions.length === 0) return []
  const earlier = [{ body: post.body, at: post.at }, ...versions.slice(0, -1)]
  return earlier.map((one) => ({ body: one.body, at: one.at }))
}

/** Who reacted with what, each emoji in the order it was first put on, each person in
 *  the order they put it on. */
function reactionsOf(marks: Marks): Record<string, Who[]> {
  const reactions: Record<string, Who[]> = {}
  const on = [...marks.reactions.values()].filter((one) => one.value).sort((a, b) => a.seq - b.seq)
  for (const one of on) (reactions[one.emoji] ??= []).push(one.who)
  return reactions
}

/** Each person's standing vote, in the order they last voted, where it is a vote this
 *  poll takes: answers it has, one unless it takes several, cast before it ended. */
function votesOf(post: LoggedPost, marks: Marks): Record<Who, number[]> {
  const poll = post.poll
  const votes: Record<Who, number[]> = {}
  if (!poll) return votes
  const standing = [...marks.votes.entries()].sort(([, a], [, b]) => a.seq - b.seq)
  for (const [who, vote] of standing) {
    const answers = [...new Set(vote.value)].sort((a, b) => a - b)
    if (answers.length === 0 || answers.length !== vote.value.length) continue
    if (!poll.several && answers.length > 1) continue
    if (
      answers.some(
        (answer) => !Number.isInteger(answer) || answer < 0 || answer >= poll.answers.length,
      )
    )
      continue
    if (poll.ends !== undefined && vote.at > poll.ends) continue
    votes[who] = answers
  }
  return votes
}

/** The replies that stand under a message, and when the latest arrived. */
function repliesOf(state: ChatState, id: string, message: Message) {
  const marks = state.marks.get(id)
  if (!marks) return
  for (const child of marks.children) {
    const reply = state.marks.get(child)
    const post = reply?.post
    if (!reply || !post || reply.deleted || post.parent !== id) continue
    message.replies += 1
    message.lastReplyAt = Math.max(message.lastReplyAt ?? post.at, post.at)
  }
}
