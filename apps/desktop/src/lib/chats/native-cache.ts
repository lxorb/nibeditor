/** The chats' store on a desktop and a phone: the crate's file beside the sync store,
 *  reached through three commands (src-tauri/src/sync_store/chats.rs). Every row it
 *  answers is checked on the way in: a message with `messageOf`, an event with
 *  `eventOf`, so a row a newer nib wrote that this one cannot read is left out rather
 *  than trusted. */

import { chatRowOf, eventOf, messageOf, REFUSALS } from '@nib/chats/wire'
import { isRecord } from '../stored'
import { invoke } from '../tauri'
import {
  type CacheChange,
  type CachedChat,
  type ChatCache,
  type DraftRow,
  hasColumn,
  isMain,
  type OutboxRow,
  type SearchAsk,
  type WindowAsk,
} from './cache'
import type { Kept, Marks } from './fold'

type Row = Record<string, unknown>

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function parsed(text: unknown): unknown {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function marksOf(value: unknown): Marks {
  if (!isRecord(value) || !Array.isArray(value.r) || !Array.isArray(value.v))
    return { r: [], v: [] }
  return value as unknown as Marks
}

function keptOf(row: Row): Kept | null {
  const message = messageOf(parsed(row.json))
  if (!message) return null
  return { message, upto: num(row.upto), marks: marksOf(parsed(row.marks)) }
}

function chatOf(row: Row): CachedChat {
  const older = row.oldest
  return {
    id: str(row.id),
    space: str(row.space),
    seq: num(row.seq),
    readSeq: num(row.read_seq),
    older: typeof older === 'number' ? older : null,
    complete: row.complete === 1,
    row: chatRowOf(parsed(row.row)),
  }
}

function outboxOf(row: Row): OutboxRow | null {
  const event = eventOf(parsed(row.event))
  if (!event) return null
  const refused = REFUSALS.find((one) => one === row.refused) ?? null
  return {
    id: str(row.id),
    chat: str(row.chat),
    event,
    madeAt: num(row.made_at),
    tries: num(row.tries),
    refused,
  }
}

/** A change as the crate takes it. */
function wired(change: CacheChange): Row {
  switch (change.t) {
    case 'chat': {
      const chat = change.chat
      return {
        t: 'chat',
        id: chat.id,
        space: chat.space,
        seq: chat.seq,
        readSeq: chat.readSeq,
        oldest: chat.older,
        complete: chat.complete,
        row: chat.row ? JSON.stringify(chat.row) : null,
      }
    }
    case 'message': {
      const { message, upto, marks } = change.kept
      return {
        t: 'message',
        chat: change.chat,
        id: message.id,
        seq: message.seq,
        at: message.at,
        author: message.author,
        parent: message.parent ?? null,
        main: isMain(message),
        deleted: message.deleted,
        body: message.body,
        has: hasColumn(message),
        upto,
        json: JSON.stringify(message),
        marks: JSON.stringify(marks),
      }
    }
    case 'queue': {
      const row = change.row
      return {
        t: 'queue',
        id: row.id,
        chat: row.chat,
        event: JSON.stringify(row.event),
        madeAt: row.madeAt,
        tries: row.tries,
        refused: row.refused,
      }
    }
    case 'draft':
      return { t: 'draft', ...change.draft }
    case 'unmessage':
    case 'unqueue':
    case 'undraft':
    case 'forget':
      return change
  }
}

/** The crate's store of the account's chats. */
export function nativeCache(account: string): ChatCache {
  const read = async (ask: Row): Promise<unknown> => {
    const answers = await invoke<unknown[]>('chat_store_read', { account, asks: [ask] })
    return answers[0]
  }
  const rows = async (ask: Row): Promise<Row[]> => {
    const answer = await read(ask)
    return Array.isArray(answer) ? answer.filter(isRecord) : []
  }
  const kept = (list: Row[]) => list.flatMap((row) => keptOf(row) ?? [])

  return {
    chats: async () => (await rows({ t: 'chats' })).map(chatOf),
    window: async (ask: WindowAsk) => kept(await rows({ t: 'window', ...ask })),
    messages: async (chat, ids) => kept(await rows({ t: 'messages', chat, ids })),
    search: async (ask: SearchAsk) =>
      (await rows({ t: 'search', ...ask })).flatMap((row) => {
        const one = keptOf(row)
        return one ? [{ chat: str(row.chat), kept: one }] : []
      }),
    unread: async (chat, after, me) => num(await read({ t: 'unread', chat, after, me })),
    outbox: async () => (await rows({ t: 'outbox' })).flatMap((row) => outboxOf(row) ?? []),
    drafts: async () =>
      (await rows({ t: 'drafts' })).map((row): DraftRow => ({
        chat: str(row.chat),
        text: str(row.text),
        at: num(row.at),
      })),
    write: async (changes) => {
      if (changes.length) await invoke('chat_store_write', { account, changes: changes.map(wired) })
    },
    forget: () => invoke('chat_store_forget', { account }),
  }
}
