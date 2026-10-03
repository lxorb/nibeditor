/** The notes held for the one question, and the three answers (docs/sync-v2.md 5.4).
 *
 *  A note is held when two sides rewrote the same passage: a push answered `moved` whose
 *  overlap is past a sentence, a room's words met with pending edits the same way,
 *  another program's edit to a file whose document had moved too, or a day's note made on
 *  two devices and written two ways. A held note is never pushed, and nothing the account
 *  sends is read into it, until somebody answers.
 *
 *  What the reader sees of it is lane `sync-client-ux`'s (asking.svelte.ts): this hands
 *  over `notes`, each with both sides' first contested passage, and carries out `answer`.
 *
 *  The answers, precisely:
 *
 *  - **Keep (this device)**: the account's words are applied, then whatever turns the
 *    merge into this device's text, as this device's edits; the account's side is kept as
 *    a version. Every device ends at this device's text.
 *  - **Keep (the other device)**: this device's pending edits are dropped - they were
 *    never sent - and the document is the account's; this device's text is kept first,
 *    in its own history and on the account (`/v2/docs/keep`), so any device can put it
 *    back.
 *  - **Keep both**: as the other device, and this device's text becomes a new note beside
 *    the original, `Name (Device).md`, numbered if that is taken.
 *
 *  An answer is carried out against what the account holds when it is given, not when the
 *  question was drawn: the note is pulled again first, so words another device added in
 *  the meantime are kept by the second two answers and are a version under the first. */

import { readCanvas } from '@nib/markdown/canvas'
import { diverge, excerpt, type Excerpt } from '@nib/sync-core/diverge'
import { pullResponseOf } from '@nib/sync-core/wire'
import type { HeldAnswer, Held, HeldNotes, Side } from './asking.svelte'
import type { Core, Holding } from './core'
import { made } from './create'
import { type Doc, MINE } from './docs'
import { fileOfUpdates, turn } from './kinds'
import { folderOf, joined, type SpaceState } from './places'
import { project } from './project'
import { keepLosers } from './rejoin'
import { put, type Change, type EntryRow } from './store'
import * as Y from 'yjs'

/** Both sides of a held note, as texts. */
interface Sides {
  base: string
  local: string
  remote: string
}

function sidesOf(doc: Doc, against: Holding['against']): Sides {
  if (against.t === 'moved') {
    return {
      base: doc.confirmedText(),
      local: doc.text(),
      remote: fileOfUpdates(doc.shape, doc.whole(), against.update),
    }
  }
  if (against.t === 'blob') return { base: '', local: '', remote: '' }
  return { base: against.base, local: against.local, remote: doc.text() }
}

/** The account's side's own words, for a note held against a push: the confirmed
 *  document with what the account sent, and nothing of this device's. */
function remoteOnly(doc: Doc, against: Holding['against']): string {
  if (against.t !== 'moved') return doc.text()
  return fileOfUpdates(doc.shape, doc.row().confirmed, against.update)
}

/** A plane's excerpt is the plane itself, which the sheet draws. */
function planeOf(text: string): string | undefined {
  try {
    readCanvas(text)
    return text
  } catch {
    return undefined
  }
}

/** Each side's first contested passage. */
function passagesOf(sides: Sides, times: { local: number; remote: number }) {
  const overlaps = diverge(sides.base, sides.local, sides.remote, times).overlaps
  return excerpt(sides.base, sides.local, sides.remote, overlaps)
}

/** Names of devices, by the id the account knows them under. */
export type Names = (device: string | null) => Promise<string>

export class HeldList implements HeldNotes {
  notes: readonly Held[] = []
  /** Told whenever `notes` changes: what puts the list on screen (the app's runner keeps
   *  a reactive copy; see app.svelte.ts). */
  changed: ((notes: readonly Held[]) => void) | null = null
  /** Whether an answer pulls the account's newest words first. */
  freshens = true

  constructor(
    private readonly core: Core,
    private readonly names: Names,
  ) {}

  /** Reads the list again from what the engine holds. */
  refresh(): Promise<void> {
    return this.core.use(() => this.read())
  }

  private async read(): Promise<void> {
    const out: Held[] = []
    for (const [id, holding] of this.core.held) {
      const space = this.core.spaceOf(id)
      const entry = space?.entries.get(id)
      if (space && entry && holding.against.t === 'blob') {
        out.push(await this.fileHeld(space, entry, holding, holding.against))
        continue
      }
      const doc = await this.core.doc(id)
      if (!space || !entry || !doc) continue
      out.push(await this.heldOf(space, entry, doc, holding))
    }
    this.notes = out
    this.changed?.(out)
  }

  private async heldOf(
    space: SpaceState,
    entry: EntryRow,
    doc: Doc,
    holding: Holding,
  ): Promise<Held> {
    const against = holding.against
    const sides = sidesOf(doc, against)
    const theirsAt = against.t === 'moved' ? against.at : holding.row.at
    const times = { local: doc.pendingAt || holding.row.at, remote: theirsAt }
    const shown = doc.shape === 'plane' ? null : passagesOf(sides, times)
    const side = (text: string, passage: Excerpt | undefined, device: string, at: number): Side => {
      const out: Side = { device, at, excerpt: passage ?? { text: '', marks: [] } }
      const plane = doc.shape === 'plane' ? planeOf(text) : undefined
      if (plane !== undefined) out.plane = plane
      return out
    }
    return {
      id: entry.id,
      path: this.core.world.join(space.row.root, entry.local_path),
      name: entry.name,
      mine: side(sides.local, shown?.local, this.core.world.name, times.local),
      theirs: side(sides.remote, shown?.remote, await this.names(holding.row.device), theirsAt),
    }
  }

  /** A file both sides replaced: what stands in for words is the file itself. */
  private async fileHeld(
    space: SpaceState,
    entry: EntryRow,
    holding: Holding,
    against: Extract<Holding['against'], { t: 'blob' }>,
  ): Promise<Held> {
    const side = (device: string, at: number): Side => ({
      device,
      at,
      excerpt: { text: '', marks: [] },
      file: { name: entry.name, size: entry.size ?? 0, picture: null },
    })
    return {
      id: entry.id,
      path: this.core.world.join(space.row.root, entry.local_path),
      name: entry.name,
      mine: side(this.core.world.name, holding.row.at),
      theirs: side(await this.names(holding.row.device), against.at),
    }
  }

  /** Carries an answer out. Keep both answers with the path of the copy it made. */
  answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    return this.core.use(() => this.answered(id, answer))
  }

  private async answered(id: string, answer: HeldAnswer): Promise<string | undefined> {
    const core = this.core
    const holding = core.held.get(id)
    const space = core.spaceOf(id)
    const entry = space?.entries.get(id)
    if (holding && space && entry && holding.against.t === 'blob') {
      const copy = await this.fileAnswered(space, entry, answer)
      await this.read()
      return copy
    }
    const doc = await core.doc(id)
    if (!holding || !space || !entry || !doc) return undefined

    const against = await this.freshest(space, doc, holding)
    if (against.t === 'blob') return undefined
    const local = against.t === 'moved' ? doc.text() : against.local
    const remote = remoteOnly(doc, against)
    const changes: Change[] = []

    if (answer === 'mine') {
      if (against.t === 'moved') {
        doc.took(against.update, against.seq)
      }
      const now = doc.text()
      doc.write((live) => turn(doc.shape, live, now, local, MINE))
      doc.flush()
      changes.push(...keepLosers(core, space, id, { local: false, remote: true }, local, remote))
    } else {
      // This device's text, kept before it goes: here, and on the account.
      if (entry.local_path) {
        await core.world.disk.keep(core.world.join(space.row.root, entry.local_path), local)
      }
      changes.push(...keepLosers(core, space, id, { local: true, remote: false }, local, remote))
      if (against.t === 'moved') {
        doc.restart(fileBytes(doc, against.update), against.seq, doc.epoch, core.freshClient())
      }
    }

    changes.push(...core.letGoChanges(id))
    changes.push(...core.docChanges(doc))
    changes.push(...(await project(core, space, entry, doc)))

    let copy: string | undefined
    if (answer === 'both') {
      const path = this.copyPath(space, entry)
      await core.world.disk.write(core.world.join(space.row.root, path), local)
      const made_ = await made(core, space, { path, folder: false, text: local })
      changes.push(...made_.changes)
      copy = core.world.join(space.row.root, path)
    }

    // The note made here for a day's note the account already had goes with the answer:
    // its words are in the note, in a version, or in the copy.
    if (against.t === 'merge') changes.push(...core.forgetChanges(against.from))

    await core.commit(changes)
    await this.read()
    return copy
  }

  /** A held file answered. Keep mine: this disk's bytes replace the account's at the
   *  next pass. Keep theirs: this disk's go to the device's trash and the account's are
   *  fetched. Keep both: this disk's become a file of their own beside it, and the
   *  account's are fetched. The fetching and the sending are the next pass's. */
  private async fileAnswered(
    space: SpaceState,
    entry: EntryRow,
    answer: HeldAnswer,
  ): Promise<string | undefined> {
    const core = this.core
    const full = core.world.join(space.row.root, entry.local_path)
    const changes: Change[] = [...core.letGoChanges(entry.id)]
    let copy: string | undefined
    if (answer === 'mine') {
      // As though this disk had held the account's bytes: what it holds is then the
      // replacement it is, made against them.
      entry.written_hash = entry.file_key
      core.touched.add(entry.id)
    } else if (answer === 'theirs') {
      if (entry.local_path) await core.world.disk.remove(full, 'file')
    } else {
      const path = this.copyPath(space, entry)
      await core.world.disk.move(full, core.world.join(space.row.root, path), 'file')
      changes.push(...(await made(core, space, { path, folder: false })).changes)
      copy = core.world.join(space.row.root, path)
    }
    changes.push(put('entries', { ...entry }))
    await core.commit(changes)
    return copy
  }

  /** What the account holds now, for a note held against a push: pulled again, so an
   *  answer is carried out against the newest words. Offline, what was held. */
  private async freshest(
    space: SpaceState,
    doc: Doc,
    holding: Holding,
  ): Promise<Holding['against']> {
    const against = holding.against
    if (against.t !== 'moved' || !this.freshens) return against
    try {
      const reply = await this.core.world.account.ask(
        'pull',
        { docs: [{ id: doc.id, epoch: doc.epoch, sv: doc.confirmedSv() }] },
        space.id,
      )
      const answer = reply === null ? null : pullResponseOf(reply)
      const one = answer?.docs.find((each) => each.id === doc.id)
      if (one && 'update' in one)
        return { t: 'moved', update: one.update, seq: one.seq, at: against.at }
    } catch {
      // Offline or refused: what was held is what there is.
    }
    return against
  }

  /** `Name (Device).md` beside the note, numbered where that is taken. */
  private copyPath(space: SpaceState, entry: EntryRow): string {
    const name = entry.name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    const device = this.core.world.name.replace(/[\\/:*?"<>|]/g, '')
    const folder = folderOf(entry.local_path)
    for (let counter = 1; ; counter += 1) {
      const suffix = counter === 1 ? '' : ` ${String(counter)}`
      const path = joined(folder, `${stem} (${device})${suffix}${extension}`)
      if (!space.at(path)) return path
    }
  }
}

/** The confirmed document with what the account sent, as one update. */
function fileBytes(doc: Doc, update: Uint8Array): Uint8Array {
  return Y.mergeUpdatesV2([doc.row().confirmed, update])
}
