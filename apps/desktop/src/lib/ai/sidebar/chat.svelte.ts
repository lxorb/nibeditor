/** The AI panel's state: the space's threads, the one open, the ones running, what is
 *  queued behind them, and everything the controls under the field change
 *  (docs/ai-sidebar.md 4).
 *
 *  The engine writes into a thread in place and says so through its events
 *  (chat/engine.ts); this store keeps the threads as the plain objects the engine
 *  writes into and hands the panel a copy of the open one, made at most once a frame
 *  (snapshot.ts). A thread keeps running when another is opened or the space changes,
 *  and lands in the space it was asked in.
 *
 *  Fetched with the panel, never in the first paint; see surfaces.svelte.ts. */

import { message, t } from '../../i18n.svelte'
import { prompt } from '../../prompt.svelte'
import { without } from '../../records'
import { forget, keep, stored } from '../../stored'
import { invoke } from '../../tauri'
import { onceAFrame } from '../../timing'
import { workspace } from '../../workspace.svelte'
import { unlisted } from '../chat/catalogue'
import { nextEffort, within } from '../chat/effort'
import {
  branchThread,
  deleteThread,
  keepThread,
  listThreads,
  newThread,
  readThread,
} from '../chat/threads'
import type {
  Draft,
  Effort,
  EngineEvent,
  Mode,
  ModelInfo,
  Thread,
  ThreadHead,
  Turn,
  Usage,
} from '../chat/types'
import { noUsage } from '../chat/usage'
import type { Provider } from '../providers'
import { ai } from '../store.svelte'
import { threadMarkdown } from './export'
import { draftOf, type Front } from './gather'
import type { Mention } from './mentions'
import { OLD_KEY, oldSpaces, threadFromAsk } from './migrate'
import { effortFor, lastMode, openIn, rememberEffort, rememberMode, rememberOpen } from './prefs'
import type { PanelActions } from './seams'
import { engineOf } from './setup'
import { snapshot } from './snapshot'

/** A message waiting behind a running turn. */
export interface Queued {
  id: string
  text: string
  chips: Mention[]
}

/** What the controls under the field show of the open thread. */
export interface Head {
  id: string
  title: string
  provider: string
  model: string
  effort: Effort
  mode: Mode
  fast: boolean
  usage: Usage
  archived: boolean
  /** Whether it has been sent anything, and so is kept. */
  kept: boolean
}

const MODES: readonly Mode[] = ['ask', 'plan', 'agent']

/** What the panel needs from around it at the moment of sending: the note in front and
 *  its selection, where their chips are on. */
interface Around {
  front: Front | null
  selection: string
}

function headOf(thread: Thread): Head {
  return {
    id: thread.id,
    title: thread.title,
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort,
    mode: thread.mode,
    fast: !!thread.fast,
    usage: { ...thread.usage },
    archived: !!thread.archived,
    kept: thread.turns.length > 0,
  }
}

class Chat implements PanelActions {
  /** The space's threads, newest first. */
  heads = $state.raw<ThreadHead[]>([])
  /** The open thread, as the controls show it. */
  head = $state.raw<Head | null>(null)
  /** Its turns, as the conversation draws them. */
  turns = $state.raw<Turn[]>([])
  /** Threads with a turn on its way, by id. */
  running = $state.raw<readonly string[]>([])
  /** A message pressed and not yet a turn of its thread, drawn at once. */
  pending = $state.raw<Record<string, string>>({})
  queued = $state.raw<Record<string, Queued[]>>({})
  /** Words sent into a running turn, until it takes them. */
  steering = $state.raw<Record<string, string[]>>({})
  /** What went wrong before any turn could say it: no provider, no engine. */
  trouble = $state<string | null>(null)

  /** The field, and the chips added to it by hand. */
  text = $state('')
  chips = $state.raw<Mention[]>([])
  /** Chips the panel offers on its own that were taken off for this thread. */
  dropped = $state.raw<readonly string[]>([])

  /** The thread list instead of the conversation. */
  listing = $state(false)
  /** Which popover is up. */
  popover = $state<'model' | 'context' | null>(null)
  /** Every thinking and tool row open (Ctrl+O). */
  unfolded = $state(false)
  /** Each provider's models, once asked. */
  models = $state.raw<Record<string, ModelInfo[]>>({})
  /** Asks the field to take the keyboard; the panel answers it. */
  focusAsked = $state(0)

  /** The space the panel shows. Plain, so the effect that sets it never reads what it
   *  writes. */
  private space = ''
  /** Every thread this run has had in hand, by id, as the engine writes into them. */
  private live = new Map<string, Thread>()
  private open: Thread | null = null
  private stoppers = new Map<string, AbortController>()
  /** Which turns changed since the last frame drew the open thread. */
  private changed = new Set<string>()
  private everything = false
  private readonly draw = onceAFrame(() => this.redraw())
  private asking = new Map<string, Promise<ModelInfo[]>>()

  /** The thread open, raw: what an action changes. */
  get thread(): Thread | null {
    return this.open
  }

  /** The provider a new thread asks: Settings > AI > Used for > Ask's. */
  private providerForNew(): Provider | null {
    return ai.providerFor('ask')
  }

  /** The provider of the open thread, or the one a new thread would ask. */
  get provider(): Provider | null {
    const id = this.head?.provider
    return ai.providers.find((one) => one.id === id) ?? this.providerForNew()
  }

  /** The open thread's model as its provider lists it. */
  get model(): ModelInfo | null {
    const head = this.head
    const provider = this.provider
    if (!head || !provider) return null
    return (
      this.models[provider.id]?.find((one) => one.id === head.model) ??
      unlisted(provider, head.model)
    )
  }

  // ── Spaces and threads ────────────────────────────────

  /** Shows a space's threads: the one it had open, else its newest, else a new one.
   *  Called from an effect, so it decides from what it is handed and from plain
   *  fields only. */
  enter(space: string): void {
    if (space === this.space) return
    this.space = space
    this.listing = false
    this.popover = null
    this.heads = []
    this.show(this.fresh())
    void this.arrive(space)
  }

  private async arrive(space: string): Promise<void> {
    await this.adoptOldAsk(space)
    const heads = await listThreads(space).catch(() => [])
    if (this.space !== space) return
    this.heads = heads
    const wanted = openIn(space)
    const id = heads.find((one) => one.id === wanted)?.id ?? heads.find((one) => !one.archived)?.id
    if (id && !this.open?.turns.length) await this.openThread(id, false)
  }

  /** The Ask panel's conversation for this space, made a thread once. */
  private async adoptOldAsk(space: string): Promise<void> {
    const spaces = oldSpaces(stored(OLD_KEY))
    const old = spaces[space]
    const provider = this.providerForNew()
    if (old === undefined || !provider) return
    const thread = threadFromAsk(old, space, provider.id, provider.model)
    if (thread) await keepThread(thread).catch(() => undefined)
    const rest = Object.fromEntries(Object.entries(spaces).filter(([id]) => id !== space))
    if (Object.keys(rest).length) keep(OLD_KEY, JSON.stringify({ spaces: rest }))
    else forget(OLD_KEY)
  }

  private async refreshHeads(): Promise<void> {
    const space = this.space
    const heads = await listThreads(space).catch(() => this.heads)
    if (this.space === space) this.heads = heads
  }

  /** A new thread on the provider Used for > Ask names, in the last mode picked. Not
   *  written down until something is sent in it. */
  private fresh(): Thread {
    const provider = this.providerForNew()
    const model = provider?.model ?? ''
    const effort = provider ? effortFor(provider.id, model) : 'auto'
    return newThread(this.space, provider?.id ?? '', model, effort, lastMode())
  }

  /** A thread nothing has been sent in follows Settings > AI > Used for > Ask, so a
   *  provider set up or changed while the panel is open is the one it asks. Called from
   *  an effect with the provider, so it reads only the plain thread. */
  adopt(provider: Provider | null): void {
    const thread = this.open
    if (!thread || thread.turns.length || !provider || thread.provider === provider.id) return
    thread.provider = provider.id
    thread.model = provider.model
    thread.effort = effortFor(provider.id, provider.model)
    thread.usage = noUsage(null)
    this.head = headOf(thread)
    void this.loadModels(provider)
  }

  private show(thread: Thread): void {
    this.open = thread
    this.live.set(thread.id, thread)
    this.trouble = null
    this.dropped = []
    this.everything = true
    this.redraw()
    if (thread.turns.length) rememberOpen(thread.space, thread.id)
    const provider = ai.providers.find((one) => one.id === thread.provider)
    if (provider) void this.loadModels(provider)
  }

  async openThread(id: string, focus = true): Promise<void> {
    const held = this.live.get(id) ?? (await readThread(this.space, id).catch(() => null))
    if (!held) return
    this.listing = false
    this.show(held)
    if (focus) this.focus()
  }

  newThread(): void {
    this.listing = false
    this.popover = null
    if (this.open && !this.open.turns.length) {
      this.focus()
      return
    }
    this.show(this.fresh())
    rememberOpen(this.space, null)
    this.focus()
  }

  showThreads(query = ''): void {
    this.popover = null
    this.listing = true
    this.listQuery = query
    void this.refreshHeads()
  }

  /** What the thread list's field holds. */
  listQuery = $state('')

  focus(): void {
    this.focusAsked++
  }

  // ── Drawing ────────────────────────────────────────────

  /** The open thread's copy, brought up to date. */
  private redraw(): void {
    const thread = this.open
    if (!thread) {
      this.turns = []
      this.head = null
      return
    }
    this.turns = snapshot(thread.turns, this.turns, this.everything ? 'all' : this.changed)
    this.head = headOf(thread)
    this.changed.clear()
    this.everything = false
  }

  /** One engine event. Every one of them for the open thread asks for a frame; one
   *  for another thread only matters once it is done. */
  private heard(thread: Thread, event: EngineEvent): void {
    if (event.type === 'turn') {
      this.changed.add(event.turn.id)
      if (event.turn.role === 'you') {
        if (event.turn.steered) {
          const left = (this.steering[thread.id] ?? []).slice(1)
          this.steering = { ...this.steering, [thread.id]: left }
        } else this.pending = without(this.pending, thread.id)
      }
    } else if (event.type === 'part') {
      this.changed.add(event.turn)
    } else if (event.type === 'done') {
      this.everything = true
    }
    if (thread === this.open) this.draw()
  }

  // ── Sending ────────────────────────────────────────────

  /** Sends the field: queued behind a running turn, run at once otherwise. */
  submit(around: Around): void {
    const text = this.text.trim()
    const chips = this.chips
    if (!text && !chips.length) return
    this.text = ''
    this.chips = []
    this.say(text, chips, around)
  }

  /** `send` for the commands: words, with what the field's chips say now. */
  send(text: string): void {
    this.say(text, [], this.around?.() ?? { front: null, selection: '' })
  }

  /** How the panel says what is around the field; set by the panel. */
  around: (() => Around) | null = null

  private say(text: string, chips: Mention[], around: Around): void {
    const thread = this.open ?? this.fresh()
    if (!this.open) this.show(thread)
    if (this.running.includes(thread.id)) {
      const list = this.queued[thread.id] ?? []
      this.queued = {
        ...this.queued,
        [thread.id]: [...list, { id: crypto.randomUUID(), text, chips }],
      }
      return
    }
    void this.run(thread, text, chips, around)
  }

  private async run(thread: Thread, text: string, chips: Mention[], around: Around): Promise<void> {
    const provider = ai.providers.find((one) => one.id === thread.provider)
    if (!provider) {
      this.trouble = t('Add an AI provider in Settings first.')
      this.text ||= text
      return
    }
    this.trouble = null
    const stopper = this.begin(thread, text)
    try {
      const draft: Draft = await draftOf(text, chips, thread.mode, around.front, around.selection)
      await this.sendDraft(thread, provider, draft, stopper)
    } catch (error) {
      if (thread === this.open) {
        this.trouble = message(error, t('The model did not answer.'))
        if (!this.text) this.text = text
      }
    } finally {
      await this.finish(thread)
    }
    // A stop pauses the queue: what was waiting stays, to be sent or taken back.
    if (!stopper.signal.aborted) this.next(thread, around)
  }

  /** A thread starts answering: its stop, its mark in the list, its message drawn. */
  private begin(thread: Thread, text?: string): AbortController {
    const stopper = new AbortController()
    this.stoppers.set(thread.id, stopper)
    this.running = [...this.running, thread.id]
    if (text !== undefined) this.pending = { ...this.pending, [thread.id]: text }
    return stopper
  }

  /** A thread is done answering, however it ended: drawn whole and written down. */
  private async finish(thread: Thread): Promise<void> {
    this.stoppers.delete(thread.id)
    this.running = this.running.filter((one) => one !== thread.id)
    this.pending = without(this.pending, thread.id)
    this.steering = without(this.steering, thread.id)
    this.everything = true
    if (thread === this.open) this.redraw()
    if (!thread.turns.length) return
    await keepThread(thread).catch(() => undefined)
    if (thread.space !== this.space) return
    if (thread === this.open) rememberOpen(thread.space, thread.id)
    await this.refreshHeads()
  }

  private async sendDraft(
    thread: Thread,
    provider: Provider,
    draft: Draft,
    stopper: AbortController,
  ): Promise<void> {
    const engine = await engineOf(provider.kind)
    let error: string | undefined
    await engine.send(
      thread,
      draft,
      (event) => {
        if (event.type === 'done' && event.stop === 'error' && !thread.turns.length)
          error = event.error
        this.heard(thread, event)
      },
      stopper.signal,
    )
    // A send refused before any turn (no provider, no engine) has nowhere to say so but
    // under the thread.
    if (error) throw new Error(error)
  }

  private next(thread: Thread, around: Around): void {
    const [first, ...rest] = this.queued[thread.id] ?? []
    if (!first) return
    this.queued = { ...this.queued, [thread.id]: rest }
    void this.run(thread, first.text, first.chips, around)
  }

  /** Words into the running turn (Ctrl+Enter): taken after the call in flight. With
   *  nothing running it is an ordinary send. */
  steer(around: Around): void {
    const thread = this.open
    const text = this.text.trim()
    if (!text) return
    if (!thread || !this.running.includes(thread.id)) {
      this.submit(around)
      return
    }
    this.text = ''
    this.steerWords(thread, text)
  }

  private steerWords(thread: Thread, text: string): void {
    const provider = ai.providers.find((one) => one.id === thread.provider)
    if (!provider) return
    this.steering = { ...this.steering, [thread.id]: [...(this.steering[thread.id] ?? []), text] }
    void engineOf(provider.kind).then((engine) => engine.steer(thread, text))
  }

  /** Stops the open thread's turn; what arrived stays. */
  stop(): void {
    const id = this.open?.id
    if (id) this.stoppers.get(id)?.abort()
  }

  get busy(): boolean {
    return !!this.head && this.running.includes(this.head.id)
  }

  // ── The queue ──────────────────────────────────────────

  private setQueue(list: Queued[]): void {
    const id = this.open?.id
    if (id) this.queued = { ...this.queued, [id]: list }
  }

  get queue(): Queued[] {
    const id = this.head?.id
    return id ? (this.queued[id] ?? []) : []
  }

  unqueue(id: string): void {
    this.setQueue(this.queue.filter((one) => one.id !== id))
  }

  /** A queued message back in the field, to change before it goes. */
  editQueued(id: string): void {
    const one = this.queue.find((each) => each.id === id)
    if (!one) return
    this.unqueue(id)
    this.text = one.text
    this.chips = one.chips
    this.focus()
  }

  /** A queued message sent into the running turn now (Copilot's Steer). */
  steerQueued(id: string): void {
    const one = this.queue.find((each) => each.id === id)
    const thread = this.open
    if (!one || !thread) return
    this.unqueue(id)
    if (this.running.includes(thread.id)) this.steerWords(thread, one.text)
    else
      void this.run(thread, one.text, one.chips, this.around?.() ?? { front: null, selection: '' })
  }

  moveQueued(from: number, to: number): void {
    const list = this.queue.slice()
    const [moved] = list.splice(from, 1)
    if (!moved) return
    list.splice(Math.max(0, Math.min(to, list.length)), 0, moved)
    this.setQueue(list)
  }

  /** The last message again, in place of its answer (Ask again); with a model named,
   *  that model answers this time and from here on (retry with another model). */
  retry(model?: { provider: string; id: string }): void {
    const thread = this.open
    if (!thread || this.running.includes(thread.id)) return
    if (model) this.setModel(model.provider, model.id)
    let at = thread.turns.length - 1
    while (at >= 0 && (thread.turns[at]?.role !== 'you' || thread.turns[at]?.steered)) at--
    const asked = thread.turns[at]
    if (!asked?.draft) return
    thread.turns.splice(at)
    this.everything = true
    this.redraw()
    const provider = ai.providers.find((one) => one.id === thread.provider)
    if (!provider) return
    const stopper = this.begin(thread, asked.draft.text)
    void this.sendDraft(thread, provider, asked.draft, stopper)
      .catch((error: unknown) => (this.trouble = message(error, t('The model did not answer.'))))
      .finally(() => void this.finish(thread))
  }

  // ── Mode, model, effort ────────────────────────────────

  setMode(mode: Mode): void {
    const thread = this.open
    rememberMode(mode)
    if (!thread) return
    thread.mode = mode
    this.changedHead(thread)
  }

  /** Shift+Tab: Ask, Plan, Agent, and round again. */
  nextMode(): void {
    const at = MODES.indexOf(this.open?.mode ?? 'ask')
    this.setMode(MODES[(at + 1) % MODES.length] ?? 'ask')
  }

  /** A provider's models, asked once a session. A list that cannot be had leaves the
   *  popover with the model the thread already has. */
  async loadModels(provider: Provider): Promise<ModelInfo[]> {
    const held = this.models[provider.id]
    if (held) return held
    let asked = this.asking.get(provider.id)
    if (!asked) {
      asked = engineOf(provider.kind)
        .then((engine) => engine.models(provider))
        .catch(() => [])
      this.asking.set(provider.id, asked)
    }
    const list = await asked
    if (list.length) this.models = { ...this.models, [provider.id]: list }
    else this.asking.delete(provider.id)
    return list
  }

  /** Another model for this thread, and the effort last used with it. */
  setModel(provider: string, model: string): void {
    const thread = this.open
    if (!thread) return
    const changed = thread.provider !== provider
    thread.provider = provider
    thread.model = model
    const info = this.models[provider]?.find((one) => one.id === model)
    thread.effort = within(effortFor(provider, model), info?.efforts ?? ['auto'])
    if (changed) thread.usage = noUsage(info?.window ?? null)
    else if (info) thread.usage = { ...thread.usage, window: info.window ?? thread.usage.window }
    if (!info?.fast) delete thread.fast
    this.changedHead(thread)
    const listed = ai.providers.find((one) => one.id === provider)
    if (listed) void this.loadModels(listed)
  }

  modelNamed(name: string): boolean {
    const provider = this.provider
    const list = provider ? (this.models[provider.id] ?? []) : []
    const want = name.toLowerCase()
    const found =
      list.find((one) => one.id.toLowerCase() === want || one.name.toLowerCase() === want) ??
      list.find(
        (one) => one.id.toLowerCase().includes(want) || one.name.toLowerCase().includes(want),
      )
    if (!found || !provider) return false
    this.setModel(provider.id, found.id)
    return true
  }

  setEffort(effort: Effort | 'next'): void {
    const thread = this.open
    const model = this.model
    if (!thread || !model) return
    const level =
      effort === 'next' ? nextEffort(thread.effort, model.efforts) : within(effort, model.efforts)
    thread.effort = level
    rememberEffort(thread.provider, thread.model, level)
    this.changedHead(thread)
  }

  setFast(on?: boolean): void {
    const thread = this.open
    if (!thread || !this.model?.fast) return
    if (on ?? !thread.fast) thread.fast = true
    else delete thread.fast
    this.changedHead(thread)
  }

  /** A change to what the controls show, written down where the thread is kept. */
  private changedHead(thread: Thread): void {
    if (thread === this.open) this.head = headOf(thread)
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  // ── Context ────────────────────────────────────────────

  compact(focus?: string): void {
    const thread = this.open
    const provider = this.provider
    if (!thread?.turns.length || !provider || this.running.includes(thread.id)) return
    this.begin(thread)
    void engineOf(provider.kind)
      .then((engine) => engine.compact(thread, focus))
      .catch((error: unknown) => (this.trouble = message(error, t('The model did not answer.'))))
      .finally(() => void this.finish(thread))
  }

  openContext(): void {
    this.popover = 'context'
  }

  openModels(): void {
    this.popover = 'model'
  }

  toggleFolded(): void {
    this.unfolded = !this.unfolded
  }

  /** A chip the panel offered on its own, taken off for this thread. */
  drop(key: string): void {
    if (!this.dropped.includes(key)) this.dropped = [...this.dropped, key]
  }

  // ── The thread's own menu ──────────────────────────────

  async rename(name?: string): Promise<void> {
    const thread = this.open
    if (!thread) return
    const named = name ?? (await prompt.ask({ title: t('Rename'), value: thread.title }))
    if (!named?.trim()) return
    thread.title = named.trim()
    this.changedHead(thread)
    void this.refreshHeads()
  }

  /** A copy of the thread up to here, and the reader in it (`/branch`). */
  branch(name?: string): void {
    const thread = this.open
    const last = thread?.turns.at(-1)
    if (!thread || !last) return
    const copy = branchThread(thread, last.id, name ?? thread.title)
    this.show(copy)
    void keepThread(copy).then(() => this.refreshHeads())
  }

  async exportThread(): Promise<void> {
    const thread = this.open
    if (!thread?.turns.length) return
    const path = await workspace.noteFrom(threadMarkdown(thread, t('Untitled')))
    if (path) await workspace.open(path)
  }

  archive(id = this.open?.id): void {
    void this.setArchived(id, true)
  }

  unarchive(id: string): void {
    void this.setArchived(id, false)
  }

  private async setArchived(id: string | undefined, archived: boolean): Promise<void> {
    if (!id) return
    const thread = this.live.get(id) ?? (await readThread(this.space, id).catch(() => null))
    if (!thread) return
    if (archived) thread.archived = true
    else delete thread.archived
    await keepThread(thread).catch(() => undefined)
    if (archived && thread === this.open) this.newThread()
    await this.refreshHeads()
  }

  async remove(id = this.open?.id): Promise<void> {
    if (!id) return
    const sure = await prompt.confirm({
      title: t('Delete this chat?'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!sure) return
    this.stoppers.get(id)?.abort()
    await deleteThread(this.space, id).catch(() => undefined)
    this.live.delete(id)
    if (this.open?.id === id) this.newThread()
    await this.refreshHeads()
  }

  /** The reader's answer to a question a tool call asked (`needs_approval`). */
  async approve(approval: string, allow: boolean): Promise<void> {
    await invoke('agents_answer', { id: approval, allow, always: false }).catch(() => undefined)
  }
}

export const chat = new Chat()
