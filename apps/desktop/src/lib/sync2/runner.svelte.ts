/** Sync v2 in the window: the engine (engine.ts) started for the account signed in, and
 *  everything around it that is the app's rather than the engine's.
 *
 *  - **When it runs.** After the first paint, at the launch's `rooms` turn, never
 *    before. A pass over a space when the account's hub pokes about it (about a second
 *    after another device wrote), when something changed here, when the window comes
 *    back, and every five minutes in case a poke went missing; at v1's cadence while
 *    the hub cannot be reached (docs/sync-v2.md 5.12).
 *  - **Which folder is which space**, worked out as v1 does (space-pairing.ts), kept in
 *    the sync store; a space's first pass is migrate.ts.
 *  - **What this device does**, heard as the workspace says it (workspace/file-ops.ts),
 *    and what autosave wrote (`wrote`); what the engine does to the disk is said back
 *    to the workspace the same way, and its own operations are not heard twice.
 *  - **Open notes** joined to their documents (binding.ts), and to their rooms.
 *  - **The light**: syncing, failed, or - when the account cannot be reached - hollow,
 *    never red for being offline.
 *  - **The question** (asking.svelte.ts), handed the held notes. */

import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { api, ApiError } from '../api'
import { pollDelay, RECONCILE_INTERVAL } from '../backoff'
import { log } from '../log'
import { type Pairing, pairSpaces } from '../space-pairing'
import { readMirror, type Mirror } from '../sync/mirror'
import { isRecord, keep, stored } from '../stored'
import { workspace } from '../workspace.svelte'
import type { FileOp } from '../workspace/file-ops'
import { owesLast, writing } from '../parting'
import { isDesktop } from '../tauri'
import { waited } from '../timing'
import { appWorld, type Telling } from './app-world'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { PlaneSurface } from '../canvas/shared'
import type { Watched } from './watching'
import { rooms } from '../rooms.svelte'
import * as Y from 'yjs'
import { asking, type Held, type HeldAnswer } from './asking.svelte'
import { attach, attachPlane, type PlaneJoin } from './binding'
import { carry, uncarry } from './carry'
import { kindOfName } from './create'
import { Engine } from './engine'
import { holdsDocument } from './kinds'
import { hub } from './hub.svelte'
import { firstPass, mirrorsFrom, type V1Listing, type V1Space } from './migrate'
import { forgetSyncStore, get, openSyncStore, put } from './store'
import { Refused } from './transport'

type Light = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

/** How long after a change here the pass that sends it waits, so a burst of saves is one
 *  pass. */
const NUDGE = 2_000

/** How often a space is passed with nothing said about it, while the hub can poke. */
const FALLBACK = 5 * 60_000

/** v1's mirrors: what the first pass of each space starts from, never written while v2
 *  runs, and written from the store only when the account goes back to v1 or this device
 *  signs out. */
const MIRRORS = 'nib:mirrors'

/** The meta row that says a space's first pass is done. */
const FIRST = 'first:'

/** How long a path the engine moved or took away is the engine's own to the watcher. */
const TOUCHED = 5_000

function v1Spaces(accountId: string): Map<string, V1Space> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once by the first pass; nothing renders from it
  const out = new Map<string, V1Space>()
  const saved = stored(MIRRORS)
  if (!isRecord(saved)) return out
  if (typeof saved.account === 'string' && saved.account !== accountId) return out
  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  for (const [root, one] of Object.entries(held)) {
    const mirror: Mirror | null = readMirror(root, one)
    if (mirror) out.set(mirror.spaceId, { cursor: mirror.cursor, notes: mirror.notes })
  }
  return out
}

class Runner {
  status = $state<Light>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)
  /** The held notes, as the question reads them: reactive, where the engine's list is
   *  not. */
  heldNotes = $state.raw<readonly Held[]>([])

  engine: Engine | null = null
  private accountId: string | null = null

  /** Whose store is open now. */
  get accountNow(): string | null {
    return this.accountId
  }
  private stops: (() => void)[] = []
  private due = new Set<string>()
  private passing_: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private quiet = 0
  private reconciledAt = 0
  /** Operations the engine made on the disk, which the workspace says back: not heard
   *  as this person's. */
  private readonly own = new Set<string>()
  /** Paths the engine moved or took away lately, by when that stops mattering: what the
   *  folder's watcher reports a moment later is the engine's own doing. */
  private readonly touched = new Map<string, number>()
  /** Spaces whose first pass is done. */
  private readonly firsts = new Set<string>()
  /** Open notes joined to their documents, by document key. */
  private readonly bound = new Map<
    string,
    { id: string; part: () => void; plane?: PlaneJoin | null }
  >()
  private binding = Promise.resolve()
  /** The space folders' watch, on the desktop; see watching.ts. */
  private watched: Watched | null = null

  /** Starts the engine for the account signed in. */
  async start(): Promise<void> {
    const user = account.user
    if (!user || this.engine) return
    this.accountId = user.id
    const store = await openSyncStore(user.id)
    const engine = await Engine.start(
      appWorld(() => account.token, this.telling),
      store,
      {
        names: (device) => this.nameOf(device),
      },
    )
    if (this.accountId !== user.id) {
      await store.close()
      return
    }
    this.engine = engine
    engine.held.changed = (notes) => (this.heldNotes = notes)
    this.heldNotes = engine.held.notes

    // The question reads the held notes reactively; the engine's own list is plain.
    const notes = () => this.heldNotes
    this.stops.push(
      asking.connect({
        held: {
          get notes() {
            return notes()
          },
          answer: (id, answer) => this.answer(id, answer),
        },
        store: engine.store,
        copies: engine,
        on: (type, listener) => engine.on(type, listener),
      }),
    )
    this.stops.push(hub.on('poke', (frame) => this.kick(frame.space)))
    this.stops.push(hub.opened(() => this.kick()))
    const back = () => {
      if (document.visibilityState !== 'hidden') this.kick()
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    this.stops.push(() => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    })
    this.stops.push(this.followOpen())
    // A canvas's surface arrives after its tab: the planes are joined once it has.
    rooms.drawn = () => this.rebind()
    this.stops.push(() => (rooms.drawn = null))
    if (isDesktop) {
      const { watchFolders } = await import('./watching')
      const watched = watchFolders({
        engine,
        own: (path) => this.ownPath(path),
        ready: (id) => this.firsts.has(id),
        changed: () => this.nudge(),
      })
      this.watched = watched
      this.stops.push(() => {
        watched.stop()
        this.watched = null
      })
    }

    this.status = 'idle'
    this.kick()
  }

  /** A held note answered: Keep mine, Keep theirs or Keep both. Answers the copy's path
   *  for the third. */
  async answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    const engine = this.engine
    if (!engine) return undefined
    const copy = await engine.held.answer(id, answer)
    this.nudge()
    // Answered: the note may be carried by its room again.
    this.rebind()
    if (copy) this.treeStale()
    return copy
  }

  /** Lets the engine go: signing out, or the account going back to v1. While signing
   *  out is writing v1's mirrors from the store, it is the one that lets go: syncing is
   *  told to stop in the same moment (the account's session has gone), and a stop that
   *  closed the store under it left the mirrors unwritten and the words typed offline
   *  with nothing saying they were this device's. */
  stop(): Promise<void> {
    return this.leaving ?? this.halt()
  }

  /** Signing out, while it runs. */
  private leaving: Promise<void> | null = null

  private async halt(): Promise<void> {
    for (const stop of this.stops.splice(0)) stop()
    for (const key of this.carried) uncarry(key)
    this.carried.clear()
    for (const one of this.bound.values()) one.part()
    this.bound.clear()
    clearTimeout(this.timer)
    const engine = this.engine
    this.engine = null
    this.accountId = null
    this.status = 'off'
    if (engine) {
      await engine.quit().catch(() => undefined)
      engine.stop()
      await engine.core.store.close().catch(() => undefined)
    }
  }

  /** The window going: everything typed written down, and the session marked ended
   *  cleanly, after autosave's own last writes. */
  parting() {
    const engine = this.engine
    if (!engine) return
    writing(
      workspace
        .writesSettled()
        .then(() => engine.quit())
        .catch(() => undefined),
    )
  }

  /** The account went back to v1 (docs/sync-v2.md section 11): whatever this device has
   *  pending goes up first, then v1's mirrors are written from the store and the
   *  account's own listing, so v1 meets each note as one it knows, at the version the
   *  account holds, and writes no copy of anything. The store goes once they are written:
   *  v1 moves the files on from here, and a later switch to v2 starts again from v1's
   *  word, as the first switch did.
   *
   *  Answers whether v1 may start. Not while the account cannot be reached: v1 starting
   *  from mirrors older than what v2 did here would delete every note v2 renamed. */
  async rollBack(): Promise<boolean> {
    const user = account.user
    const token = account.token
    if (!user || !token) return false
    const store = await openSyncStore(user.id)
    const engine = await Engine.start(
      appWorld(() => account.token, this.telling),
      store,
    )
    let back = false
    try {
      const done = await this.kept(engine)
      if (!done.size) return (back = true)
      if (!(await sentAll(engine, done))) return false
      const listings = await listingsOf(token, done)
      const mirrors = await this.mirrorsNow(engine, user.id, listings, done)
      back = keep(MIRRORS, JSON.stringify({ account: user.id, seen: true, mirrors }))
      return back
    } catch (error) {
      log('warn', `sync: the way back to v1 waits - ${String(error)}`)
      return false
    } finally {
      await engine.quit().catch(() => undefined)
      engine.stop()
      await store.close().catch(() => undefined)
      if (back) {
        this.firsts.clear()
        await forgetSyncStore(user.id).catch(() => undefined)
      }
    }
  }

  /** The way back, tried until it is walked, at v1's cadence while the account cannot be
   *  reached. Answers whether v1 may start, false once `alive` says this session ended. */
  async walkBack(alive: () => boolean): Promise<boolean> {
    for (let tries = 0; alive(); tries += 1) {
      if (await this.rollBack().catch(() => false)) return alive()
      await waited(pollDelay(tries, document.hidden))
    }
    return false
  }

  /** The spaces v2 kept here: the ones whose first pass is done. */
  private async kept(engine: Engine): Promise<ReadonlySet<string>> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once on the way back; nothing renders from it
    const done = new Set<string>()
    for (const id of engine.core.spaces.keys()) {
      if (await this.firstDone(engine, id)) done.add(id)
    }
    return done
  }

  /** v1's mirrors as they stand now: the spaces v2 kept, written from the store, and
   *  every other space as v1 last wrote it. */
  private async mirrorsNow(
    engine: Engine,
    accountId: string,
    listings: ReadonlyMap<string, V1Listing> | null,
    done: ReadonlySet<string>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    const saved = stored(MIRRORS)
    if (isRecord(saved) && (typeof saved.account !== 'string' || saved.account === accountId)) {
      const held = isRecord(saved.mirrors) ? saved.mirrors : saved
      for (const [root, one] of Object.entries(held)) {
        const mirror = readMirror(root, one)
        if (mirror && !done.has(mirror.spaceId)) out[root] = one
      }
    }
    return { ...out, ...(await mirrorsFrom(engine.core, listings, (id) => done.has(id))) }
  }

  /** Signing out: the store goes, as it empties the vault (docs/sync-v2.md section 10),
   *  but first v1's mirrors are written from it. Words typed and not sent yet are on the
   *  disk, and the mirrors say what the account had confirmed under them, so the next
   *  first pass - or v1 - sends them as this device's edits rather than meeting them as
   *  a stranger's. */
  signedOut(accountId: string): Promise<void> {
    this.leaving ??= this.leave(accountId).finally(() => (this.leaving = null))
    return this.leaving
  }

  private async leave(accountId: string): Promise<void> {
    const engine = this.engine
    if (engine) {
      try {
        const done = await this.kept(engine)
        const mirrors = done.size ? await this.mirrorsNow(engine, accountId, null, done) : null
        if (mirrors) keep(MIRRORS, JSON.stringify({ account: accountId, seen: true, mirrors }))
      } catch (error) {
        log('warn', `sync: signing out kept no mirrors - ${String(error)}`)
      }
    }
    await this.halt()
    this.firsts.clear()
    await forgetSyncStore(accountId)
  }

  // -------------------------------------------------------------------------
  // When to pass

  /** Whether a pass is under way. */
  get passing(): boolean {
    return this.passing_ !== null
  }

  /** Every space passed now, waited for: what automation and a link joining ask for.
   *  Answers whether anything moved. */
  async passNow(): Promise<boolean> {
    const before = this.lastSyncedAt
    this.kick()
    await this.passing_
    return this.lastSyncedAt !== before
  }

  /** A pass soon over one space, or all of them. */
  kick(space?: string) {
    const engine = this.engine
    if (!engine) return
    if (space) {
      if (engine.core.spaces.has(space)) this.due.add(space)
    } else {
      for (const id of engine.core.spaces.keys()) this.due.add(id)
      this.due.add('')
    }
    this.passing_ ??= this.run().finally(() => {
      this.passing_ = null
      this.schedule()
    })
  }

  /** Something changed here: a pass in a moment, unless one is sooner. */
  nudge() {
    if (!this.engine) return
    this.quiet = 0
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.kick(), NUDGE)
  }

  private schedule() {
    const engine = this.engine
    if (!engine) return
    clearTimeout(this.timer)
    const waiting = [...engine.core.spaces.keys()].some((id) => engine.waiting(id))
    const delay = waiting
      ? NUDGE
      : hub.state === 'open'
        ? FALLBACK
        : pollDelay(this.quiet, document.hidden)
    this.timer = setTimeout(() => this.kick(), delay)
  }

  private async run(): Promise<void> {
    const engine = this.engine
    if (!engine) return
    this.status = 'syncing'
    this.lastError = null
    let offline = false
    let moved = false
    try {
      if (this.due.delete('') || Date.now() - this.reconciledAt >= RECONCILE_INTERVAL) {
        // The account out of reach is the hollow light, never the red one: the passes
        // below find the same and stop quietly.
        await this.reconcile(engine).catch((error: unknown) => {
          if (!unreachable(error)) throw error
          offline = true
        })
      }
      while (this.due.size && this.engine === engine) {
        const [id] = this.due
        if (id === undefined) break
        this.due.delete(id)
        const space = engine.core.spaces.get(id)
        if (!space) continue
        if (!(await this.firstDone(engine, id))) {
          const v1 = this.accountId ? (v1Spaces(this.accountId).get(id) ?? null) : null
          if (!(await firstPass(engine.core, space, v1))) {
            offline = true
            await engine.core.commit([
              ...engine.core.forgetSpace(id),
              ...engine.core.addSpace(id, space.row.root, space.row.role),
            ])
            continue
          }
          await engine.core.commit([put('meta', { key: `${FIRST}${id}`, value: 1 })])
          this.firsts.add(id)
          this.watched?.follow()
        }
        const passed = await engine.pass(id)
        if (!passed?.finished) offline = true
        if (passed && (passed.pulled || passed.pushed)) moved = true
        if (passed?.pulled && id === this.spaceOnScreen(engine)) await workspace.loadTree()
      }
      this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
      if (this.engine !== engine) return
      this.lastSyncedAt = Date.now()
      this.status = offline ? 'offline' : 'idle'
    } catch (error) {
      if (this.engine !== engine) return
      // The session ended on the account: signed out here too, as every other request
      // signs out.
      if ((error instanceof Refused || error instanceof ApiError) && error.status === 401) {
        void account.signOut()
        return
      }
      log('error', `sync: ${error instanceof Error ? error.message : String(error)}`)
      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private async firstDone(engine: Engine, id: string): Promise<boolean> {
    if (this.firsts.has(id)) return true
    const [row] = await engine.core.store.read([get('meta', `${FIRST}${id}`)])
    if (row !== null) this.firsts.add(id)
    return row !== null
  }

  /** Whether the engine itself moved or took away a path a moment ago, or anything above
   *  it. */
  private ownPath(path: string): boolean {
    const now = Date.now()
    const at = path.replaceAll('\\', '/')
    for (const [one, until] of this.touched) {
      if (until < now) {
        this.touched.delete(one)
        continue
      }
      if (at === one || at.startsWith(`${one}/`)) return true
    }
    return false
  }

  private spaceOnScreen(engine: Engine): string | null {
    const root = workspace.activeSpace?.root
    for (const space of engine.core.spaces.values()) if (space.row.root === root) return space.id
    return null
  }

  /** Which folder is which space: v1's rules, with the pairing in the sync store. */
  private async reconcile(engine: Engine) {
    const token = account.token
    if (!token) return
    await account.loadSpaces()
    this.reconciledAt = Date.now()
    const core = engine.core
    const changes: Parameters<typeof core.commit>[0][number][] = []
    const pairing: Pairing = {
      pairs: () =>
        [...core.spaces.values()].map((space) => ({
          root: space.row.root,
          spaceId: space.id,
          shared: space.row.role !== null && space.row.role !== 'owner',
        })),
      pair: (root, spaceId, shared) => {
        const known = core.spaces.get(spaceId)
        if (known) changes.push(...core.rootMoved(spaceId, root))
        else changes.push(...core.addSpace(spaceId, root, shared ? 'write' : 'owner'))
      },
      unpair: (root) => {
        const space = [...core.spaces.values()].find((one) => one.row.root === root)
        if (space) changes.push(...core.forgetSpace(space.id))
      },
      share: (root, shared) => {
        const space = [...core.spaces.values()].find((one) => one.row.root === root)
        if (!space) return
        const role =
          account.spaces.find((one) => one.id === space.id)?.role ?? (shared ? 'write' : 'owner')
        if (space.row.role === role) return
        space.row = { ...space.row, role }
        changes.push(put('spaces', { ...space.row }))
      },
    }
    await pairSpaces(token, pairing)
    await core.commit(changes)
    this.watched?.follow()
    for (const id of core.spaces.keys()) this.due.add(id)
  }

  // -------------------------------------------------------------------------
  // This device's own changes

  /** The engine's own operations on the disk, said to the workspace and not heard back. */
  private readonly telling: Telling = {
    touching: (path) => {
      this.touched.set(path.replaceAll('\\', '/'), Date.now() + TOUCHED)
    },
    moved: async (from, to, kind) => {
      this.own.add(`moved:${from}`)
      try {
        await workspace.fileMoved(from, to, kind)
      } finally {
        this.own.delete(`moved:${from}`)
      }
    },
    gone: async (path, kind) => {
      this.own.add(`removed:${path}`)
      try {
        await workspace.fileGone(path, kind)
      } finally {
        this.own.delete(`removed:${path}`)
      }
    },
    written: () => {
      this.treeStale()
    },
  }

  private treeTimer: ReturnType<typeof setTimeout> | undefined
  private treeStale() {
    clearTimeout(this.treeTimer)
    this.treeTimer = setTimeout(() => void workspace.loadTree(), 200)
  }

  /** A file operation, heard as everything kept by path hears it. Answers what is left to
   *  do, which the operation waits for, so the account hears operations in the order
   *  they were done. */
  follow(op: FileOp): Promise<void> | undefined {
    const engine = this.engine
    if (!engine) return undefined
    const key =
      op.op === 'moved' ? `moved:${op.from}` : op.op === 'removed' ? `removed:${op.path}` : ''
    if (key && this.own.has(key)) return undefined

    const done = (async () => {
      if (op.op === 'created') {
        const document = op.key ? workspace.documents.find((one) => one.key === op.key) : undefined
        // A picture or a recording travels as its bytes, which the engine reads itself.
        const text =
          op.kind === 'folder' || !holdsDocument(kindOfName(op.path))
            ? undefined
            : (document?.latest ?? (await engine.core.world.disk.read(op.path)) ?? '')
        // A day's note the append action made starts from nothing, which is what two of
        // them made apart are merged against.
        const mergeable = this.mergeables.delete(op.path) ? '' : undefined
        await engine.created(op.path, op.kind === 'folder', text, mergeable)
        this.rebind()
      } else if (op.op === 'moved') {
        if (op.kind === 'space') {
          const space = [...engine.core.spaces.values()].find((one) => one.row.root === op.from)
          if (space) await engine.core.commit(engine.core.rootMoved(space.id, op.to))
        } else {
          await engine.moved(op.from, op.to)
        }
      } else if (op.kind !== 'space') {
        await engine.removed(op.path)
      }
      this.nudge()
    })()
    return done.catch((error: unknown) => {
      log('error', `sync: ${op.op} - ${String(error)}`)
    })
  }

  /** Paths of notes about to be made by the append action: made `mergeable`. */
  private readonly mergeables = new Set<string>()

  mergeable(path: string) {
    this.mergeables.add(path)
  }

  /** Autosave wrote a note: recorded, and what was typed is one more pending update. */
  async wrote(path: string, text: string): Promise<void> {
    const engine = this.engine
    if (!engine) return
    await engine.saved(path, text).catch((error: unknown) => {
      log('error', `sync: saved ${path} - ${String(error)}`)
    })
    this.nudge()
  }

  /** The account's id for a space's folder. */
  remoteIdFor(root: string): string | null {
    for (const space of this.engine?.core.spaces.values() ?? []) {
      if (space.row.root === root) return space.id
    }
    return null
  }

  /** What the account holds for a note on this disk: its id, its version, and the digest
   *  of what nib last wrote. */
  tracked(path: string): { id: string; version: number; hash: string } | null {
    const engine = this.engine
    const entry = engine?.entryAt(path)
    if (!engine || entry?.seq == null) return null
    return {
      id: entry.id,
      version: engine.core.numbers.get(entry.id)?.seq ?? 0,
      hash: entry.written_hash ?? '',
    }
  }

  /** A space deleted here: its rows go with it. */
  async forget(root: string): Promise<void> {
    const engine = this.engine
    const space = [...(engine?.core.spaces.values() ?? [])].find((one) => one.row.root === root)
    if (engine && space) await engine.core.commit(engine.core.forgetSpace(space.id))
  }

  /** A device's name, by its id on the account. */
  private names: Map<string, string> | null = null
  private async nameOf(device: string | null): Promise<string> {
    if (!device) return ''
    if (!this.names) {
      this.names = new Map()
      const token = account.token
      if (token) {
        const { request } = await import('../api')
        const listed = await request<{ devices?: { id: string; name: string }[] }>('/v2/devices', {
          token,
        }).catch(() => ({ devices: [] }))
        for (const one of listed.devices ?? []) this.names.set(one.id, one.name)
      }
    }
    return this.names.get(device) ?? ''
  }

  // -------------------------------------------------------------------------
  // Open notes

  /** Joins every open note to its document, and parts the ones that closed. */
  private followOpen(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const open = workspace.openNotes
        untrack(() => this.rebind(open))
      })
    })
  }

  private rebind(open = workspace.openNotes) {
    this.binding = this.binding.then(() => this.bindNow(open)).catch(() => undefined)
  }

  private async bindNow(open: typeof workspace.openNotes) {
    const engine = this.engine
    if (!engine) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away within this call
    const wanted = new Map<string, { id: string; on: On; arrivals: () => number }>()
    for (const one of open) {
      if (!one.path) continue
      const note = one.note
      const surface = rooms.planes.get(one.key)
      const on: On | null = note.kind === 'note' ? { note } : surface ? { surface } : null
      const entry = on && engine.entryAt(one.path)
      if (on && entry && engine.core.hasDoc(entry.id))
        wanted.set(one.key, { id: entry.id, on, arrivals: () => note.arrivals })
    }

    for (const [key, one] of this.bound) {
      if (wanted.get(key)?.id === one.id) continue
      uncarry(key)
      this.carried.delete(key)
      one.part()
      this.bound.delete(key)
    }

    for (const [key, one] of wanted) {
      if (this.bound.has(key)) {
        if (!this.carried.has(key)) this.enter(engine, key, one.id, one.on)
        continue
      }
      const arrivals = one.arrivals()
      const holds = () => one.arrivals() === arrivals && this.bound.get(key)?.id === one.id
      this.bound.set(key, { id: one.id, part: () => undefined })
      // A document made again under the note - the account's words taken, a new epoch -
      // is a document its room has never met: the room is joined afresh.
      const again = () => {
        uncarry(key)
        this.carried.delete(key)
        this.enter(engine, key, one.id, one.on)
      }
      const joined =
        'note' in one.on
          ? await attach(engine, one.id, one.on.note, holds, again)
          : await attachPlane(engine, one.id, one.on.surface, holds, again)
      const part = typeof joined === 'function' ? joined : (joined?.part ?? null)
      if (!part || this.bound.get(key)?.id !== one.id) {
        part?.()
        if (this.bound.get(key)?.id === one.id) this.bound.delete(key)
        continue
      }
      this.bound.set(key, { id: one.id, part, plane: typeof joined === 'function' ? null : joined })
      this.enter(engine, key, one.id, one.on)
    }
  }

  /** Open notes whose documents a room is carrying, by document key. */
  private readonly carried = new Set<string>()

  /** An open note's document, carried live through its room: only one the account
   *  knows, on the epoch the account is on, and not held for the question. */
  private enter(engine: Engine, key: string, id: string, on: On) {
    const core = engine.core
    const doc = core.docs.get(id)
    const entry = core.entry(id)
    const space = core.spaceOf(id)
    if (!doc?.live || entry?.seq == null || !space || core.isHeld(id)) return
    if (doc.epoch < (core.epochs.get(id) ?? doc.epoch) || !account.token) return

    this.carried.add(key)
    const room = carry(key, {
      noteId: id,
      on,
      gone: () => {
        this.carried.delete(key)
        this.kick(space.id)
      },
      carrying: {
        doc: doc.live,
        device: core.device,
        pending: () => doc.hasPending,
        confirmedSv: () => doc.confirmedSv(),
        met: async (update) => {
          const met = await engine.meet(id, Y.convertUpdateFormatV1ToV2(update))
          if (met === 'hold') {
            // Out of the room until the question is answered; the answer joins it again.
            queueMicrotask(() => {
              uncarry(key)
              this.carried.delete(key)
            })
          }
          return met
        },
        acked: (seq, sv) => void engine.acked(id, seq, sv),
        epoch: (epoch) => {
          core.epochs.set(id, epoch)
          this.kick(space.id)
        },
        live: (on) => {
          if (on) core.carried.add(id)
          else core.carried.delete(id)
        },
      },
    })
    // A canvas's pointer goes to the others through the room while there is one.
    void room.then((entered) => {
      const plane = this.bound.get(key)?.plane
      if (plane && entered?.hand) plane.hand = entered.hand.bind(entered)
    })
  }
}

/** What an open note is joined through: its views, or a canvas's surface. */
type On = { note: NoteDoc } | { surface: PlaneSurface }

/** Whether a request failed for want of the account rather than by its answer: no
 *  network, or the account too busy or failing to say anything (transport.ts reads the
 *  engine's own requests the same way). */
function unreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500
  return error instanceof TypeError
}

export const runner = new Runner()

owesLast(() => runner.parting())

/** How many rounds of passes the way back gives what is pending to go up and be taken. */
const SENDING_ROUNDS = 4

/** How long between them: a room takes what was pushed a moment after the push. */
const SETTLING = 1_500

/** Passes over the spaces until nothing in them waits to go up, or a few rounds have
 *  gone by. Answers false where the account could not be reached. What still waits
 *  after that - refused, or held for the question - is left to v1's own judgement,
 *  through the words the mirrors say this device confirmed. */
async function sentAll(engine: Engine, spaces: ReadonlySet<string>): Promise<boolean> {
  for (let round = 0; round < SENDING_ROUNDS; round += 1) {
    if (round) await waited(SETTLING)
    for (const id of spaces) {
      const passed = await engine.pass(id)
      if (!passed?.finished) return false
    }
    if (![...spaces].some((id) => engine.waiting(id))) return true
  }
  return true
}

/** v1's whole listing of each space. */
async function listingsOf(
  token: string,
  spaces: ReadonlySet<string>,
): Promise<ReadonlyMap<string, V1Listing>> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once on the way back; nothing renders from it
  const out = new Map<string, V1Listing>()
  for (const id of spaces) out.set(id, await listingOf(token, id))
  return out
}

/** v1's whole listing of a space, deleted notes too, page by page. */
async function listingOf(token: string, spaceId: string): Promise<V1Listing> {
  const notes: V1Listing['notes'][number][] = []
  let cursor = 0
  for (;;) {
    const page = await api.changes(token, spaceId, cursor)
    notes.push(...page.notes)
    const asked = cursor
    cursor = page.cursor
    if (!page.more || cursor === asked) return { cursor, notes }
  }
}

// Signing out deletes the account's sync store, as it empties the vault (docs/sync-v2.md
// section 10): what is in it is the account's, and the next account is somebody else.
account.forgetWithSession(() => {
  const id = runner.accountNow
  if (id) void runner.signedOut(id)
})
