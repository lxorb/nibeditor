/** Recording, as one thing the whole app shares.
 *
 *  One store, because there is one microphone. The palette's row, the Paragraph menu,
 *  the `/` menu and the quick settings tile on Android all run the same command
 *  and all end up here; the pill in the status bar is this store, read. A second
 *  recorder anywhere would be a second red dot and a fight over the device.
 *
 *  What it does is small: sound, written beside the note and embedded at the caret as a
 *  player. Nothing leaves the machine, so it works on a train with no signal. Turning it
 *  into words is a row on the embed's own menu afterwards; see transcribing.ts.
 *
 *  The pill is the whole of what is shown while it runs: a red dot, the time so far,
 *  and a stop. What actually went wrong is said on the line at the top of the document,
 *  where work that failed and carried on already says so. There is no dialog anywhere in
 *  this file. */

import { storeBeside } from '../assets'
import { busy } from '../busy.svelte'
import { key, message, t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { reloading } from '../reloading.svelte'
import { settings } from '../settings.svelte'
import { nameOf } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { canRecordHere, recordingName } from './container'
import { MOST_BYTES, record, type Recording } from './microphone'
import { appendTo, noteToRecordInto, viewFor, writeAtCaret } from './note'
import { spaceRelative } from './paths'
import { recordingPill } from '../surfaces.svelte'
import { embedFor } from './transcript'

/** How often the pill's clock is read again. Twice a second: the seconds have to
 *  change when they change, and nothing here is worth a frame. */
const TICK = 500

class Recorder {
  /** Null while nothing is being recorded, which is what the pill reads. */
  private held: Recording | null = null

  /** Whether the microphone is open. Its own field rather than `!!held`, because the
   *  pill has to appear the moment the row is pressed and the device takes a moment to
   *  open. */
  on = $state(false)

  /** And whether the recording that has stopped is still being written down. The pill
   *  stays up, without the dot. */
  saving = $state(false)

  /** How long it has been running, in seconds. */
  elapsed = $state(0)

  private ticking: ReturnType<typeof setInterval> | undefined
  /** A stop pressed while the microphone was still being opened, kept until it is
   *  open: there is nothing to stop before then, and a stop that went nowhere let the
   *  recording start anyway and run until somebody pressed it again. */
  private stopAsked = false
  private started = new Date()
  /** When the run started, by the clock the elapsed time is measured on. A monotonic
   *  one, because a laptop that changes its mind about the date mid recording must not
   *  change how long the recording has been running. */
  private at = performance.now()

  /** The note being recorded into. */
  private path: string | null = null

  /** Whether recording is possible at all: a microphone to open and a container to
   *  write. The question itself is container.ts's, because a menu has to answer it
   *  without fetching any of this; see `canRecordHere`. */
  get available(): boolean {
    return canRecordHere()
  }

  /** The one command. Pressed while it is running, it stops - the row says so, the
   *  pill's own button does the same thing, and the Android tile calls this.
   *
   *  Takes no view. Which editor the words go into is decided by the note, not by the
   *  pane the row was pressed in: recording may make a note of its own, and by the time
   *  there is anything to write the pane that asked may be showing something else. */
  toggle() {
    if (this.on) {
      void this.stop()
      return
    }

    // The pill, asked for as the microphone opens rather than drawn while a recording
    // runs: it is what stays up while what was recorded is still being written down,
    // so the bar mounts it for good the first time anything asks. See
    // surfaces.svelte.ts and StatusBar.svelte.
    void recordingPill.ask()

    void this.start()
  }

  async start() {
    if (this.on) return

    this.started = new Date()
    this.reset()
    this.on = true

    try {
      const path = await noteToRecordInto()
      if (!path) throw new Error(key('Open a space to record into.'))
      this.path = path

      this.held = await record({
        full: () => this.failed(t('That is as much as one recording may hold.')),
      })

      this.ticking = setInterval(() => {
        this.elapsed = (performance.now() - this.at) / 1000
      }, TICK)

      if (this.stopAsked) void this.stop()
    } catch (error) {
      this.on = false
      this.held = null
      this.stopAsked = false
      settings.error = message(error, key('That microphone could not be opened.'))
    }
  }

  private reset() {
    this.at = performance.now()
    this.elapsed = 0
    this.path = null
    // Whatever the last run had to say about itself is not about this one.
    busy.clear()
  }

  /** Stops, and writes the file beside the note.
   *
   *  The line at the top of the document is on while it happens: saving a file is
   *  seconds in which nothing on screen has changed. */
  async stop() {
    const held = this.held
    const path = this.path
    if (!this.on) return

    // Still opening: stopped the moment it is open; see `stopAsked`.
    if (!held) {
      this.stopAsked = true
      return
    }

    this.stopAsked = false
    this.on = false
    this.saving = true
    this.held = null
    clearInterval(this.ticking)

    try {
      await busy.run(t('Saving the recording'), async () => {
        const file = await held.stop()
        this.elapsed = file.seconds

        if (!path) throw new Error(key('Open a space to record into.'))
        await this.keep(path, file.bytes, held.extension)
      })
    } catch (error) {
      settings.error = message(error, key('That recording could not be saved.'))
    } finally {
      this.saving = false
      void workspace.writesSettled()
    }
  }

  /** The file, written where a pasted picture is written, and named after the minute
   *  it was made in. The note names it by that name, so what the embed says and what
   *  is on the disk are the same word. */
  private async keep(path: string, bytes: ArrayBuffer, extension: string) {
    if (bytes.byteLength > MOST_BYTES) {
      throw new Error(key('That is as much as one recording may hold.'))
    }

    const written = await storeBeside(bytes, path, recordingName(this.started, extension))
    if (!written) throw new Error(key('That recording could not be saved.'))

    // Before the embed is written, not after: the index is what makes a bare name
    // resolve, and a player is drawn the moment the words are in the note.
    const root = workspace.activeSpace?.root
    const relative = root ? spaceRelative(root, path, written) : null
    if (relative) links.fileAdded(relative)

    const embed = embedFor(nameOf(written))
    const view = viewFor(path)

    // Where the caret was, which is where it was asked for.
    if (view) writeAtCaret(view, embed)
    else appendTo(path, `\n${embed}\n`)

    void workspace.loadTree()
  }

  /** Something to say, for a moment.
   *
   *  The line at the top of the document, which is where work that failed and carried
   *  on some other way already says so - an export that could not be written, a
   *  picture that would not store. A recording never stops for any of this, so a
   *  sentence that fades is the right size of saying it, and a second place to put one
   *  would be a second design. See busy.svelte.ts and Progress.svelte. */
  private failed(reason: string) {
    busy.failed(reason)
  }
}

export const recorder = new Recorder()

// A page that reloads itself for a newer build waits for the microphone to close and
// the recording to be written down; see reloading.svelte.ts.
reloading.holds(() => recorder.on || recorder.saving)
