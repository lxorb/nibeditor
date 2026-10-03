/** Where threads are kept: per space, on this device, never synced (4.11).
 *
 *  A thread is the words of every note it read and every page it was shown, so it stays
 *  on the machine it was had on: in the app's own data folder on a desktop and a phone,
 *  one file a thread and a list per space beside them, written by the crate
 *  (src-tauri/src/ai_threads.rs); in the browser's IndexedDB in a tab. `localStorage`
 *  holds the Ask panel's forty turns and is too small for a history.
 *
 *  Reading is careful and writing is not: a thread comes back from a file some version
 *  of nib wrote, possibly one cut short, so it is checked on the way in and what is not a
 *  thread is left out rather than trusted. See `threadIn`. */

import { isNumber, isRecord, isString } from '../../stored'
import { isNative, invoke } from '../../tauri'
import { isEffort } from './effort'
import type {
  Compaction,
  Effort,
  Mode,
  NoticeCode,
  Part,
  Thread,
  ThreadHead,
  ToolOutput,
  ToolState,
  Turn,
  Usage,
} from './types'
import { noUsage } from './usage'

/** How many characters of a thread its head keeps for the list's search. */
const WORDS = 2_000

/** A new, empty thread. */
export function newThread(
  space: string,
  provider: string,
  model: string,
  effort: Effort = 'auto',
  mode: Mode = 'ask',
): Thread {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    space,
    title: '',
    provider,
    model,
    effort,
    mode,
    turns: [],
    usage: noUsage(null),
    created: now,
    updated: now,
  }
}

/** What the list shows of a thread: its title, its model, its age, and its words for
 *  searching. */
export function headOf(thread: Thread): ThreadHead {
  const words = thread.turns
    .flatMap((turn) => [
      turn.draft?.text ?? '',
      ...turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])),
    ])
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, WORDS)
  return {
    id: thread.id,
    title: thread.title,
    provider: thread.provider,
    model: thread.model,
    updated: thread.updated,
    ...(thread.archived ? { archived: true } : {}),
    words,
  }
}

/** A deep copy that also takes a thread the panel holds as reactive state, which
 *  `structuredClone` refuses. */
function copied<T>(value: T): T {
  // The same shape back: JSON is what a thread is written as anyway.
  return JSON.parse(JSON.stringify(value)) as T
}

/** A copy of a thread up to and including one of its turns, under a new id: `/branch`,
 *  `/fork`, and editing an old message (4.5). A compaction made after that turn does not
 *  come along, and nor does a goal, which is the old thread's. */
export function branchThread(thread: Thread, upTo: string, title?: string): Thread {
  const copy = copied(thread)
  const at = copy.turns.findIndex((one) => one.id === upTo)
  if (at >= 0) copy.turns = copy.turns.slice(0, at + 1)
  if (copy.compaction && !copy.turns.some((one) => one.id === copy.compaction?.upTo)) {
    delete copy.compaction
  }
  delete copy.goal
  const now = Date.now()
  return {
    ...copy,
    id: crypto.randomUUID(),
    title: title ?? thread.title,
    created: now,
    updated: now,
  }
}

const MODES: readonly Mode[] = ['ask', 'plan', 'agent']

function usageIn(value: unknown): Usage {
  if (!isRecord(value)) return noUsage(null)
  const number = (one: unknown) => (isNumber(one) ? one : 0)
  return {
    input: number(value.input),
    cached: number(value.cached),
    output: number(value.output),
    reasoning: number(value.reasoning),
    window: isNumber(value.window) ? value.window : null,
    ...(isNumber(value.cost) ? { cost: value.cost } : {}),
  }
}

const NOTICES: readonly NoticeCode[] = [
  'compacted',
  'model',
  'steps',
  'max_tokens',
  'refusal',
  'error',
  'stopped',
  'no_tools',
  'command',
  'tasks',
]
const STATES: readonly ToolState[] = ['running', 'ok', 'error', 'asking']

function outputIn(value: unknown): ToolOutput | undefined {
  if (!isRecord(value)) return undefined
  const images = Array.isArray(value.images)
    ? value.images.flatMap((one) =>
        isRecord(one) && isString(one.mime) && isString(one.data)
          ? [{ mime: one.mime, data: one.data }]
          : [],
      )
    : []
  return {
    text: isString(value.text) ? value.text : '',
    images,
    error: value.error === true,
    ...(isString(value.approval) ? { approval: value.approval } : {}),
  }
}

/** A part, or null for one this version does not draw. */
function partIn(value: unknown): Part | null {
  if (!isRecord(value)) return null
  const { kind, text } = value
  if (kind === 'text') return isString(text) ? { kind, text } : null
  if (kind === 'thinking')
    return isString(text) ? { kind, text, ms: isNumber(value.ms) ? value.ms : 0 } : null
  if (kind === 'notice') {
    const code = NOTICES.find((one) => one === value.code)
    return code ? { kind, code, text: isString(text) ? text : '' } : null
  }
  if (kind !== 'tool' || !isString(value.id) || !isString(value.verb)) return null
  // A call that was still running when the thread was written never answered.
  const state = STATES.find((one) => one === value.state && one !== 'running') ?? 'error'
  const result = outputIn(value.result)
  const change = isRecord(value.change) && isString(value.change.path) ? value.change : null
  return {
    kind,
    id: value.id,
    verb: value.verb,
    args: value.args ?? {},
    state,
    ...(result ? { result } : {}),
    ...(change
      ? {
          change: {
            path: isString(change.path) ? change.path : '',
            added: isNumber(change.added) ? change.added : 0,
            removed: isNumber(change.removed) ? change.removed : 0,
          },
        }
      : {}),
  }
}

/** A turn, with every part this version cannot read left out. */
function turnIn(value: unknown): Turn | null {
  if (!isRecord(value) || !isString(value.id) || (value.role !== 'you' && value.role !== 'model')) {
    return null
  }
  const parts = Array.isArray(value.parts)
    ? value.parts.map(partIn).filter((one) => one !== null)
    : []
  // The parts are checked one by one above; the rest of a turn (its draft, the provider's
  // own record of it) is handed back as it was written, which is what it is kept for.
  const turn = { ...(value as unknown as Turn), parts, at: isNumber(value.at) ? value.at : 0 }
  if (!isString(turn.context)) delete turn.context
  return turn
}

/** A thread read from a file, or null for one that is not a thread. */
export function threadIn(value: unknown): Thread | null {
  if (!isRecord(value)) return null
  const { id, space, title, provider, model, effort, mode } = value
  if (!isString(id) || !isString(space) || !isString(provider) || !isString(model)) return null
  const turns = Array.isArray(value.turns)
    ? value.turns.map(turnIn).filter((one): one is Turn => one !== null)
    : []
  // A compaction's block is the provider's and goes back as it came, so only where it
  // starts is checked.
  const compaction =
    isRecord(value.compaction) && isString(value.compaction.upTo)
      ? (value.compaction as unknown as Compaction)
      : undefined
  // Every field the engine reads is checked below; the rest (a goal, what was spent) is
  // kept as written.
  return {
    ...(value as unknown as Thread),
    id,
    space,
    title: isString(title) ? title : '',
    provider,
    model,
    effort: isEffort(effort) ? effort : 'auto',
    mode: MODES.find((one) => one === mode) ?? 'ask',
    turns,
    usage: usageIn(value.usage),
    created: isNumber(value.created) ? value.created : 0,
    updated: isNumber(value.updated) ? value.updated : 0,
    ...(compaction ? { compaction } : {}),
  }
}

function headIn(value: unknown): ThreadHead | null {
  if (!isRecord(value) || !isString(value.id)) return null
  return {
    id: value.id,
    title: isString(value.title) ? value.title : '',
    provider: isString(value.provider) ? value.provider : '',
    model: isString(value.model) ? value.model : '',
    updated: isNumber(value.updated) ? value.updated : 0,
    ...(value.archived === true ? { archived: true } : {}),
    words: isString(value.words) ? value.words : '',
  }
}

/** The browser's store: IndexedDB's `meta`, under a key per thread and one per space's
 *  list. Fetched only in a browser. */
async function web() {
  const { meta } = await import('../../web/store')
  const listKey = (space: string) => `ai-threads:${space}`
  const threadKey = (space: string, id: string) => `ai-thread:${space}:${id}`
  const heads = async (space: string): Promise<unknown[]> => {
    const raw = await meta.get(listKey(space))
    try {
      const read: unknown = raw ? JSON.parse(raw) : []
      const list: unknown[] = Array.isArray(read) ? read : []
      return list
    } catch {
      // A list cut short is a list to start again: the threads themselves are intact.
      return []
    }
  }
  return { meta, listKey, threadKey, heads }
}

/** The space's threads, newest first. */
export async function listThreads(space: string): Promise<ThreadHead[]> {
  const read = isNative
    ? await invoke<unknown>('ai_threads_list', { space })
    : await (await web()).heads(space)
  const heads = Array.isArray(read) ? read.map(headIn).filter((one) => one !== null) : []
  return heads.sort((a, b) => b.updated - a.updated)
}

/** One thread, whole, or null where there is none to read. */
export async function readThread(space: string, id: string): Promise<Thread | null> {
  let text: string | null
  if (isNative) {
    text = await invoke<string | null>('ai_thread_read', { space, id })
  } else {
    const store = await web()
    text = (await store.meta.get(store.threadKey(space, id))) ?? null
  }
  if (!text) return null
  try {
    return threadIn(JSON.parse(text))
  } catch {
    // A file cut short by a crash mid-write cannot be a thread; the list still names it,
    // and deleting it is the way out.
    return null
  }
}

/** Writes a thread down, and its line in the space's list. */
export async function writeThread(thread: Thread): Promise<void> {
  const head = headOf(thread)
  const body = JSON.stringify(thread)
  if (isNative) {
    await invoke<null>('ai_thread_write', { space: thread.space, id: thread.id, head, body })
    return
  }
  const store = await web()
  await store.meta.put(store.threadKey(thread.space, thread.id), body)
  const others = (await store.heads(thread.space)).filter((one) => headIn(one)?.id !== thread.id)
  await store.meta.put(store.listKey(thread.space), JSON.stringify([...others, head]))
}

/** Deletes a thread for good (`/delete`). */
export async function deleteThread(space: string, id: string): Promise<void> {
  if (isNative) {
    await invoke<null>('ai_thread_delete', { space, id })
    return
  }
  const store = await web()
  await store.meta.remove(store.threadKey(space, id))
  const left = (await store.heads(space)).filter((one) => headIn(one)?.id !== id)
  await store.meta.put(store.listKey(space), JSON.stringify(left))
}

/** Deletes every thread of a space, with the space. */
export async function forgetSpace(space: string): Promise<void> {
  if (isNative) {
    await invoke<null>('ai_threads_forget', { space })
    return
  }
  const store = await web()
  for (const head of await store.heads(space)) {
    const id = headIn(head)?.id
    if (id) await store.meta.remove(store.threadKey(space, id))
  }
  await store.meta.remove(store.listKey(space))
}

/** Writes a thread, one write at a time per thread: a write asked for while one is on
 *  its way is made once that one is done, with the thread as it is then, and any more
 *  asked for meanwhile are that same write. */
const writing = new Map<string, { next: boolean; done: Promise<void> }>()

/** Whether another write was asked for while one was on its way. Read through a call,
 *  because the write in between is what sets it. */
function again(entry: { next: boolean }): boolean {
  return entry.next
}

export function keepThread(thread: Thread): Promise<void> {
  const held = writing.get(thread.id)
  if (held) {
    held.next = true
    return held.done
  }
  const entry = { next: false, done: Promise.resolve() }
  entry.done = (async () => {
    try {
      do {
        entry.next = false
        await writeThread(thread)
      } while (again(entry))
    } finally {
      writing.delete(thread.id)
    }
  })()
  writing.set(thread.id, entry)
  return entry.done
}
