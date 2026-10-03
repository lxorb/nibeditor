/** The engine as a device of `@nib/sync-core`'s simulator (docs/sync-v2.md section 12).
 *
 *  The simulator drives devices over an unkind network and judges what everybody ends up
 *  holding. This hands it the engine that runs in the window - the same passes, the same
 *  store tables (in memory, surviving a crash the way the SQLite file does), the same
 *  files on a disk - with nothing standing in but the disk (a map of files), the network
 *  (the simulator's) and the person. What the person does is what the app would hear:
 *  typing goes into the document the way the editor's binding puts it there, a file made,
 *  renamed, moved or deleted is done to the disk first and then said to the engine the
 *  way `workspace.fileOps` says it, another program's edit is a file written behind the
 *  engine's back and then noticed.
 *
 *  So a seed that fails here is the engine failing, and replays as one. */

import { nameKey } from '@nib/sync-core/tree'
import { hash32, seedUpdate } from '@nib/sync-core/seed'
import { textops } from '@nib/sync-core/textops'
import { frame, unframe } from '@nib/sync-core/wire'
import type {
  Action,
  Answer,
  Classification,
  Clock,
  DeviceAdapter,
  Held,
  Link,
  Pick,
  Random,
  Seeded,
  View,
} from '@nib/sync-core/sim'
import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { HERE } from './docs'
import { Engine } from './engine'
import { holdsDocument } from './kinds'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { Refused } from './transport'
import { folderOf, joined, nameOf } from './places'
import { numbersRow, wantedRow } from './records'
import { put, type Change } from './store'
import type { World } from './world'

const SPACE = 'sim'

/** The place `fraction` of the way into a text that falls on whitespace or the end, so
 *  words put there never join a word already there. The simulator's own rule. */
function spot(text: string, fraction: number): number {
  let at = Math.max(0, Math.min(text.length, Math.floor(fraction * text.length)))
  while (at < text.length && !/\s/.test(text.charAt(at))) at++
  return at
}

function withWords(text: string, fraction: number, words: string): string {
  if (!text) return words
  const at = spot(text, fraction)
  return `${text.slice(0, at)} ${words}${text.slice(at)}`
}

function withoutWords(text: string, fraction: number, length: number): string {
  const from = spot(text, fraction)
  const to = spot(text, Math.min(1, (from + length) / Math.max(1, text.length)))
  return text.slice(0, from) + text.slice(Math.max(from, to))
}

/** A name free in a folder, numbered the way the file list numbers a duplicate. */
function freeIn(taken: (path: string) => boolean, folder: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let counter = 1; ; counter += 1) {
    const candidate = counter === 1 ? name : `${stem} ${String(counter)}${extension}`
    const path = joined(folder, candidate)
    if (!taken(path)) return path
  }
}

export class EngineDevice implements DeviceAdapter {
  readonly disk = new MemoryDisk()
  readonly store: MemoryStore
  private engine: Engine | null = null
  private link: Link | null = null
  private heldNow: Held[] = []
  running = true
  private life = 0
  private readonly root: string
  private starting: Promise<void>

  constructor(
    readonly id: string,
    private readonly clock: Clock,
    private readonly random: Random,
    seeded: readonly Seeded[],
    private readonly skew = 0,
  ) {
    this.store = new MemoryStore(`device-${id}`)
    this.root = `/sim/${id}`
    this.starting = this.seed(seeded).then(() => this.launchNow())
  }

  /** A device that already holds the notes the run starts with, as a migrated one does:
   *  each note the seed of its words at epoch 1, on the disk, and the feed read past it. */
  private async seed(seeded: readonly Seeded[]) {
    const store = this.store.open()
    const changes: Change[] = [
      put('spaces', {
        space_id: SPACE,
        root: this.root,
        cursor: seeded.length,
        role: 'owner',
        store: null,
      }),
      put('meta', wantedRow(SPACE, new Map())),
    ]
    seeded.forEach((note, index) => {
      const confirmed = seedUpdate(note.id, 1, note.text)
      changes.push(
        put('entries', {
          id: note.id,
          space_id: SPACE,
          kind: 'note',
          parent: null,
          name: note.name,
          local_path: note.name,
          file_key: null,
          written_hash: null,
          mtime: null,
          size: null,
          seq: index + 1,
          deleted: false,
        }),
        put('docs', {
          id: note.id,
          epoch: 1,
          client_id: 1 + this.random.int(2 ** 31),
          confirmed,
          confirmed_sv: Y.encodeStateVectorFromUpdateV2(confirmed),
          pending: null,
          pending_at: null,
        }),
        put(
          'meta',
          numbersRow(note.id, { seq: 1, pulled: index + 1, pending: false, flight: null }),
        ),
        put('written', { id: note.id, text: note.text }),
      )
      this.disk.files.set(`${this.root}/${note.name}`, note.text)
    })
    await store.write(changes)
    await store.cleanExit(true)
  }

  private world(): World {
    return {
      disk: this.disk,
      account: {
        ask: async (route, body) => {
          const link = this.link
          if (!link || route === 'prepare') return null
          const reply = await link(route, frame(body))
          if (reply === null) return null
          const value = unframe(reply)
          // The account's refusal of one request, as a status the Worker's adapter says.
          if (
            typeof value === 'object' &&
            value !== null &&
            'refused' in value &&
            typeof value.refused === 'number'
          ) {
            const error = (value as { error?: unknown }).error
            throw new Refused(value.refused, typeof error === 'string' ? error : '')
          }
          return value
        },
      },
      name: this.id,
      now: () => this.clock.now + this.skew,
      random: () => this.random.next(),
      digest: (text) =>
        Promise.resolve(`${hash32('a', text).toString(16)}${hash32('b', text).toString(16)}`),
      join: (root, path) => `${root}/${path}`,
      foldsCase: true,
      platform: 'other',
    }
  }

  private async launchNow() {
    this.engine = await Engine.start(this.world(), this.store.open(), { freshens: false })
    await this.refreshHeld()
  }

  private async ready(): Promise<Engine | null> {
    await this.starting
    return this.running ? this.engine : null
  }

  private async refreshHeld() {
    const engine = this.engine
    if (!engine) return
    await engine.core.use(() => this.readHeld(engine))
  }

  private async readHeld(engine: Engine) {
    const out: Held[] = []
    for (const note of engine.held.notes) {
      const holding = engine.core.held.get(note.id)
      const doc = await engine.core.doc(note.id)
      if (!holding || !doc) continue
      const against = holding.against
      if (against.t === 'moved') {
        const { fileOfUpdates } = await import('./kinds')
        out.push({
          id: note.id,
          base: doc.confirmedText(),
          local: doc.text(),
          remote: fileOfUpdates(doc.shape, doc.row().confirmed, against.update),
          times: { local: doc.pendingAt, remote: against.at },
        })
      } else if (against.t !== 'blob') {
        out.push({
          id: note.id,
          base: against.base,
          local: against.local,
          remote: doc.text(),
          times: { local: holding.row.at, remote: doc.pendingAt },
        })
      }
    }
    this.heldNow = out
  }

  // -------------------------------------------------------------------------
  // The tree as the person sees it

  private live(engine: Engine) {
    const space = engine.core.spaces.get(SPACE)
    if (!space) return []
    return [...space.shown().entries.values()]
      .filter((entry) => !entry.deleted)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  private chosen<T>(list: readonly T[], pick: Pick): T | undefined {
    return list[Math.min(list.length - 1, Math.floor(pick * list.length))]
  }

  /** A note the person can type into: shown, with its words here, and not held. */
  private writable(engine: Engine, pick: Pick): string | null {
    const notes = this.live(engine).filter(
      (entry) =>
        holdsDocument(entry.kind) &&
        engine.core.hasDoc(entry.id) &&
        !engine.core.isHeld(entry.id) &&
        this.pathOf(engine, entry.id) !== null,
    )
    return this.chosen(notes, pick)?.id ?? null
  }

  /** Where an entry's file is on the disk now, which is what a person acts on: null for
   *  one that is not on the disk yet. */
  private pathOf(engine: Engine, id: string | null): string | null {
    if (id === null) return ''
    const path = engine.core.spaces.get(SPACE)?.entries.get(id)?.local_path
    return path === undefined || path === '' ? null : path
  }

  private full(path: string): string {
    return path ? `${this.root}/${path}` : this.root
  }

  private taken(engine: Engine): (path: string) => boolean {
    const space = engine.core.spaces.get(SPACE)
    return (path) => {
      if (!space) return false
      const key = nameKey(path)
      for (const one of space.paths().values()) if (nameKey(one) === key) return true
      for (const one of this.disk.files.keys())
        if (nameKey(one) === nameKey(this.full(path))) return true
      return false
    }
  }

  // -------------------------------------------------------------------------
  // What the person does

  async act(action: Action): Promise<void> {
    const engine = await this.ready()
    if (!engine) return
    const life = this.life
    await engine.core.use(() => this.perform(engine, action))
    if (this.life === life) await this.refreshHeld()
  }

  private async type(engine: Engine, id: string, to: (text: string) => string) {
    const doc = await engine.core.doc(id)
    if (!doc) return
    doc.write((live) => {
      const text = live.getText(TEXT)
      const from = text.toJSON()
      const next = to(from)
      if (next !== from) textops(text, from, next, HERE)
    })
  }

  private async perform(engine: Engine, action: Action) {
    switch (action.t) {
      case 'type': {
        const id = this.writable(engine, action.note)
        if (id) await this.type(engine, id, (text) => withWords(text, action.at, action.words))
        return
      }
      case 'cut': {
        const id = this.writable(engine, action.note)
        if (id) await this.type(engine, id, (text) => withoutWords(text, action.at, action.length))
        return
      }
      case 'drop-paragraph': {
        const id = this.writable(engine, action.note)
        if (!id) return
        await this.type(engine, id, (text) => {
          const blocks = text.split('\n\n')
          const at = Math.min(blocks.length - 1, Math.floor(action.at * blocks.length))
          return blocks.filter((_, index) => index !== at).join('\n\n')
        })
        return
      }
      case 'create':
      case 'mkdir': {
        const folders = this.live(engine).filter((entry) => entry.kind === 'folder')
        const folder =
          action.folder === null ? null : (this.chosen(folders, action.folder)?.id ?? null)
        const at = this.pathOf(engine, folder)
        if (at === null) return
        const path = freeIn(this.taken(engine), at, action.name)
        if (action.t === 'mkdir') {
          await this.disk.mkdir(this.full(path))
          await engine.created(this.full(path), true)
        } else {
          await this.disk.write(this.full(path), action.words)
          await engine.created(this.full(path), false, action.words)
        }
        return
      }
      case 'rename': {
        const target = this.chosen(this.live(engine), action.target)
        const from = target ? this.pathOf(engine, target.id) : null
        if (!target || !from) return
        const taken = this.taken(engine)
        const wanted = joined(folderOf(from), action.name)
        const to =
          nameKey(wanted) === nameKey(from) ? wanted : freeIn(taken, folderOf(from), action.name)
        if (to === from) return
        await this.disk.move(this.full(from), this.full(to))
        await engine.moved(this.full(from), this.full(to))
        return
      }
      case 'move': {
        const entries = this.live(engine)
        const target = this.chosen(entries, action.target)
        const folders = entries.filter((entry) => entry.kind === 'folder')
        const parent =
          action.folder === null ? null : (this.chosen(folders, action.folder)?.id ?? null)
        const from = target ? this.pathOf(engine, target.id) : null
        const into = this.pathOf(engine, parent)
        if (!target || !from || into === null || parent === target.id) return
        // The file list refuses a folder dropped into itself.
        if (into === from || into.startsWith(`${from}/`)) return
        if (folderOf(from) === into) return
        const to = freeIn(this.taken(engine), into, nameOf(from))
        await this.disk.move(this.full(from), this.full(to))
        await engine.moved(this.full(from), this.full(to))
        return
      }
      case 'delete': {
        const target = this.chosen(this.live(engine), action.target)
        const path = target ? this.pathOf(engine, target.id) : null
        if (!path) return
        await this.disk.remove(this.full(path))
        await engine.removed(this.full(path))
        return
      }
      case 'append-day': {
        const day = this.live(engine).find(
          (entry) =>
            entry.parent === null &&
            nameKey(entry.name) === nameKey(action.name) &&
            holdsDocument(entry.kind),
        )
        if (day) {
          if (engine.core.hasDoc(day.id) && !engine.core.isHeld(day.id)) {
            await this.type(engine, day.id, (text) =>
              text ? `${text}\n${action.words}` : action.words,
            )
          }
          return
        }
        const path = freeIn(this.taken(engine), '', action.name)
        await this.disk.write(this.full(path), action.words)
        await engine.created(this.full(path), false, action.words, '')
        return
      }
      case 'edit-file': {
        const id = this.writable(engine, action.note)
        const path = id ? this.pathOf(engine, id) : null
        if (!id || !path) return
        const doc = await engine.core.doc(id)
        if (!doc) return
        const { writtenOf } = await import('./ingest')
        const ancestor = (await writtenOf(engine.core, id)) ?? doc.text()
        const file = withoutWords(
          withWords(ancestor, action.at, action.words),
          1 - action.at,
          action.cut,
        )
        await this.disk.write(this.full(path), file)
        await engine.foreign(this.full(path))

        return
      }
      case 'save':
        await engine.pause()
        return
    }
  }

  // -------------------------------------------------------------------------
  // Passes and answers

  async pass(link: Link): Promise<void> {
    const engine = await this.ready()
    if (!engine || this.link) return
    const life = this.life
    this.link = link
    try {
      await engine.pause()
      await engine.pass(SPACE)
    } finally {
      if (this.life === life) {
        this.link = null
        await this.refreshHeld()
      }
    }
  }

  held(): readonly Held[] {
    return this.heldNow
  }

  async answer(id: string, choice: Answer): Promise<void> {
    const engine = await this.ready()
    if (!engine) return
    await engine.held.answer(id, choice)
    await engine.pause()
    await this.refreshHeld()
  }

  // -------------------------------------------------------------------------
  // Life

  async quit(): Promise<void> {
    const engine = await this.ready()
    if (!engine) return
    await engine.pause()
    await engine.quit()
    engine.stop()
    this.stopped()
  }

  async crash(): Promise<void> {
    const engine = await this.ready()
    engine?.stop()
    this.stopped()
  }

  private stopped() {
    this.running = false
    this.life += 1
    this.link = null
    this.engine = null
    this.heldNow = []
  }

  async launch(): Promise<void> {
    if (this.running) return
    this.running = true
    this.starting = this.launchNow()
    await this.starting
  }

  // -------------------------------------------------------------------------
  // What it holds

  async view(): Promise<View> {
    const engine = await this.ready()
    if (!engine) return { entries: [], texts: {} }
    return await engine.core.use(async () => {
      const entries = this.live(engine).map(({ id, kind, parent, name }) => ({
        id,
        kind,
        parent,
        name,
      }))
      const texts: Record<string, string> = {}
      for (const entry of entries) {
        if (!holdsDocument(entry.kind)) continue
        texts[entry.id] = (await engine.core.doc(entry.id))?.text() ?? ''
      }
      // A note deleted elsewhere while this device still has words for it to send: not in
      // the tree, but its words are here until the push brings it back.
      for (const id of engine.core.numbers.keys()) {
        if (id in texts || !engine.core.hasPending(id)) continue
        texts[id] = (await engine.core.doc(id))?.text() ?? ''
      }
      return { entries, texts }
    })
  }

  classified(): Classification[] {
    const engine = this.engine
    if (!engine) return []
    return engine.core.classified.splice(0)
  }
}
