/** What sync did, and what it is waiting on.
 *
 *  Two things a reader asks when syncing is not obviously working, and neither
 *  has had an answer: "did it run, and what did it do", and "is something
 *  stuck". The light in the corner says syncing or failed, which is the right
 *  amount to say in a corner and not enough to act on.
 *
 *  So: the last few dozen passes, one line each, with what moved and what went
 *  wrong in the server's own words. Kept on the device, because a pass is
 *  something a device did - the account's side of the same question is which
 *  device wrote a version, which the history sheet already shows. Nothing new is
 *  sent anywhere to make this work, which is why it is a list rather than a
 *  table on the server: a log nobody reads should not cost a write on every
 *  pass.
 *
 *  And the notes waiting to be settled, for the reader who asked to be asked
 *  about two copies. See conflicts.ts for the three answers and why asking is
 *  quiet rather than a dialog. */

import { log } from '../log'
import { insideSpace, withinSpace } from '../space-paths'
import { forget, isRecord, keep, stored } from '../stored'
import { invoke } from '../tauri'
import type { Answer, Clash } from './conflicts'

const STORAGE_KEY = 'nib:sync-log'

/** How many passes are kept. Enough to see a pattern over an afternoon, few
 *  enough that the list is still a list. */
const KEPT = 60

/** One pass over one space. */
interface Pass {
  at: number
  /** The space, by the name the reader knows it by. */
  space: string
  /** How many notes came down and how many went up. */
  pulled: number
  pushed: number
  /** Notes whose two copies disagreed. */
  clashed: number
  /** What went wrong, in the words the server used, or null. */
  failed: string | null
}

interface Saved {
  passes?: unknown
  clashes?: unknown
}

function isPass(value: unknown): value is Pass {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Pass>

  return typeof one.at === 'number' && typeof one.space === 'string'
}

function isClash(value: unknown): value is Clash {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Clash>

  return typeof one.path === 'string' && typeof one.id === 'string' && typeof one.at === 'number'
}

class Record {
  /** Newest first, which is the order anybody reads a log in. */
  passes = $state<Pass[]>([])

  /** Notes the reader asked to be asked about. */
  clashes = $state<Clash[]>([])

  /** Whether anything is waiting, which is the only thing the settings row has
   *  to say when nothing is. */
  readonly waiting = $derived(this.clashes.length)

  restore() {
    // Read as an unknown and taken field by field, like every other store that
    // reads its own storage: the entry may have been written by another version
    // of the app, or edited by hand.
    const held: unknown = stored(STORAGE_KEY)
    const saved: Saved = isRecord(held) ? held : {}

    this.passes = Array.isArray(saved.passes) ? saved.passes.filter(isPass).slice(0, KEPT) : []
    this.clashes = Array.isArray(saved.clashes) ? saved.clashes.filter(isClash) : []
  }

  /** One pass, written down. Nothing is written for a pass that found nothing
   *  and went wrong with nothing: a log of "nothing happened" every twenty
   *  seconds is a log nobody can read. */
  wrote(pass: Pass) {
    if (!pass.pulled && !pass.pushed && !pass.clashed && !pass.failed) return

    this.passes = [pass, ...this.passes].slice(0, KEPT)
    this.persist()
  }

  /** A note whose copies disagree, waiting for an answer. One per path: a
   *  second pass finding the same disagreement is the same disagreement. */
  clash(clash: Clash) {
    if (this.clashes.some((one) => one.path === clash.path)) return

    this.clashes = [...this.clashes, clash]
    this.persist()
  }

  /** The paths a pass must leave alone, which is every one still waiting. */
  readonly held = $derived(new Set(this.clashes.map((one) => one.path)))

  /** Settles one: keep what is here, take what the account holds, or keep both.
   *
   *  Only the files are touched. Nothing is sent: letting go of the clash is what
   *  lets the next pass push, and the pass is the one thing that knows which
   *  version it would be writing on top of. So an answer costs no request, and an
   *  answer given with the network down is still the answer when it comes back.
   *
   *  Whichever is chosen, the words that lose are kept as a version first, so
   *  this is never the moment something goes for good. */
  async settle(clash: Clash, answer: Answer): Promise<void> {
    // The path went through storage, so what is in hand is a string rather than a
    // path: this entry was written by some version of this app, possibly an older
    // one, and storage is a place anybody at this machine can type into. What
    // follows is two `write_note`s carrying words the other device sent, which is
    // the whole of an escape - so the path is judged again here, against the
    // spaces this device actually holds, and what is written is the path built
    // back up from the space and the name rather than the string that was held.
    //
    // Judged here rather than in `restore`, because the log is restored before the
    // spaces have been listed and there would be nothing to judge it against; see
    // start.ts. Nothing else reads a clash's path onto disk.
    const path = await placed(clash.path)
    if (path === null) {
      log('warn', 'sync: a note waiting to be settled is in no space, so it was let go of')
      this.forget(clash.path)
      return
    }

    if (answer === 'theirs') {
      const here = await invoke<string>('read_note', { path }).catch(() => null)
      if (here?.trim()) {
        await invoke('snapshot_note', { path, content: here }).catch(() => undefined)
      }

      await invoke('write_note', { path, content: clash.theirs })
      // And the document, if the note is open. The file is theirs now and the
      // document is still holding what this machine said - so the note on screen
      // reads as words the file no longer has, and the first keystroke after that
      // writes them back over the copy the reader had just chosen. Nothing writes
      // a file a document is open on without telling the document; see
      // workspace/open.ts.
      const { workspace } = await import('../workspace.svelte')
      workspace.reload(path, clash.theirs)
    }

    if (answer === 'both') {
      const { conflictPath } = await import('@nib/markdown/paths')
      await invoke('write_note', { path: conflictPath(path), content: clash.theirs })
    }

    this.forget(clash.path)
  }

  forget(path: string) {
    this.clashes = this.clashes.filter((one) => one.path !== path)
    this.persist()
  }

  /** The list, for somebody who wants it gone. What is still waiting to be
   *  answered stays: a clash is work, not a log line, and the other copy is the
   *  only place those words are. */
  clear() {
    this.passes = []
    this.persist()
  }

  /** And all of it, when the session goes.
   *
   *  A clash holds the other device's whole note, so this store is the one place
   *  on the device where somebody else's words sit outside the vault. The vault is
   *  emptied on sign-out and this was not, which left a note readable by whoever
   *  is at the machine next with no session that could have fetched it. */
  forgetEverything() {
    this.passes = []
    this.clashes = []

    forget(STORAGE_KEY)
  }

  private persist() {
    // A browser with storage turned off, and a full one, still sync; they just
    // forget the log.
    keep(STORAGE_KEY, JSON.stringify({ passes: this.passes, clashes: this.clashes }))
  }
}

export const record = new Record()

/** A path a space holds, built back up from that space and the name it holds the
 *  note under, or null when no space on this device holds it.
 *
 *  The workspace is asked for rather than imported, because this store is restored
 *  before it and nothing here needs it until somebody answers a clash. */
async function placed(path: string): Promise<string | null> {
  const { workspace } = await import('../workspace.svelte')

  for (const space of workspace.spaces) {
    const relative = withinSpace(space.root, path)
    if (relative !== null) return insideSpace(space.root, relative)
  }

  return null
}
