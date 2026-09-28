/** Files that change under the app.
 *
 *  A note in a space is the app's own: it writes it, it syncs it, and it knows
 *  when it changed. A file the reader opened from anywhere else on the disk is not
 *  the app's at all - a build writes it, a script rewrites it, git checks another
 *  branch out over the top - and a note sitting stale in the editor until somebody
 *  saves over what is now on disk is a note that loses work.
 *
 *  So every open file of the reader's own is stamped, and asked about now and then
 *  and whenever the window comes back to the front, which is when somebody has
 *  just been in the other program. Two answers, and both of them keep whatever the
 *  person has:
 *
 *  A file that changed under a note nobody has edited quietly becomes what is on
 *  disk. There is nothing to lose and nothing to ask, and a question in the way of
 *  a file that simply reloaded is a question nobody thanked anybody for.
 *
 *  A file that changed under a note with unsaved words in it keeps every one of
 *  those words, and the light in the corner goes red. That is a clash, only the
 *  person can settle it, and the app's job is to say so and to touch nothing.
 *
 *  It costs a stat call per open file of the reader's own, which is almost always
 *  none: a space's notes are not watched, because nothing else writes them. */

import { SvelteSet } from 'svelte/reactivity'
import { t } from './i18n.svelte'
import { isExternalFile } from './save-as'
import { sync } from './sync.svelte'
import { fileStamp, type Stamp } from './sync/mirror'
import { invoke, isDesktop } from './tauri'
import type { NoteDoc } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** How often the open files are asked about. Long enough to cost nothing, short
 *  enough that a file changed in another window is caught before anybody has
 *  finished reading the paragraph they are on. */
const EVERY = 4000

/** One stamp as one string, so two of them are compared with `===`. */
const mark = (stamp: Stamp): string => `${stamp.modified}:${stamp.len}`

class Watch {
  /** The files that changed under a note with unsaved words in it. Held here as
   *  well as shown on the light, because the light is the sync store's and its
   *  next pass has its own news to report. */
  readonly clashing = new SvelteSet<string>()

  /** What each watched file looked like the last time it was asked. */
  private readonly seen = new Map<string, string>()

  /** Starts watching, and answers the teardown. Nothing at all in a browser: a
   *  page has no disk under it, and its notes come out of its own storage. */
  start(): () => void {
    if (!isDesktop) return () => undefined

    const look = () => void this.look()
    const timer = setInterval(look, EVERY)
    window.addEventListener('focus', look)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', look)
    }
  }

  /** One look at every open file of the reader's own. */
  async look(): Promise<void> {
    const watched = workspace.openNotes.filter((one) => isExternalFile(one.path))
    if (!watched.length) {
      this.forgetAll()
      return
    }

    // The editor's last few keystrokes are still a rope until something asks for
    // them as a string, and comparing a file with the note is asking.
    workspace.flush()

    const open = new Set(watched.map((one) => one.path))
    for (const path of [...this.seen.keys()]) if (!open.has(path)) this.forget(path)

    for (const { path, note } of watched) await this.check(path, note)
  }

  private async check(path: string, note: NoteDoc): Promise<void> {
    const answer = await fileStamp(path)
    // A file that is gone is not a change to follow: it may be halfway through
    // being replaced, and the note is the only copy of it left either way.
    if (!answer) return

    const now = mark(answer)
    const before = this.seen.get(path)
    this.seen.set(path, now)

    // The first look at a file is what it looks like, not news about it.
    if (before === undefined || before === now) {
      // A note saved since the clash was noticed has settled it.
      if (this.clashing.has(path) && !note.dirty) this.clashing.delete(path)
      return
    }

    await this.settle(path, note)
  }

  /** What to do about a file that has changed since the last look. */
  private async settle(path: string, note: NoteDoc): Promise<void> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return

    // The document has moved on to another note since this look began - the one
    // tab that previews a note takes another note on, and there are two round
    // trips between the pair being read and here. These words are this file's, and
    // that document is not this file any more, so they have nowhere to go.
    if (note.path !== path) {
      console.warn(`nib: a reload of ${path} was refused - that tab is on another note now`)
      return
    }

    // The app's own write, most likely a save a moment ago: the file and the note
    // say the same thing, so there is nothing to reload and nothing to report.
    if (text === note.text) {
      this.clashing.delete(path)
      return
    }

    if (note.dirty) {
      this.clash(path, note.name)
      return
    }

    // Quietly: the note becomes the file, every pane showing it follows, and the
    // note is as saved afterwards as it was before.
    note.replace(text, false)
    this.clashing.delete(path)
  }

  /** Both copies are worth keeping and only the person can choose. The editor's
   *  words stay exactly as they are; the light says there is something to look at.
   *
   *  The sync light rather than a sheet in the way: a file that changed while
   *  somebody was typing is news, not an emergency, and it is the same news the
   *  light already carries for a note two devices wrote at once. */
  private clash(path: string, name: string) {
    this.clashing.add(path)
    sync.status = 'error'
    sync.lastError = t('{name} changed on the disk. What is in the editor is yours.', { name })
  }

  private forget(path: string) {
    this.seen.delete(path)
    this.clashing.delete(path)
  }

  private forgetAll() {
    this.seen.clear()
    this.clashing.clear()
  }
}

export const watch = new Watch()
