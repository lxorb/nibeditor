/** Recording, as one thing the whole app shares.
 *
 *  One store, because there is one microphone. The palette's row, the Paragraph menu,
 *  the plus on a phone and the quick settings tile on Android all run the same command
 *  and all end up here; the pill in the status bar is this store, read. A second
 *  recorder anywhere would be a second red dot and a fight over the device.
 *
 *  Two things it can be doing, and the difference between them is smaller than it
 *  looks:
 *
 *  - **A recording.** Sound, written beside the note, embedded at the caret as a
 *    player. Nothing leaves the machine, so it works on a train with no signal.
 *  - **A meeting.** The same recording, in a note of its own, with the transcript
 *    arriving in it every twenty seconds while somebody is still talking and a summary
 *    written above it when it stops. The transcript needs the account, because the
 *    speech models are on the Worker; the summary takes whichever model the reader has,
 *    and which one that is belongs to summarise.ts and not to this file.
 *
 *  The pill is the whole of what is shown while it runs: a red dot, the time so far,
 *  and a stop. The dot says when a piece of the transcript is being tried again, and
 *  what actually went wrong is said on the line at the top of the document, where work
 *  that failed and carried on already says so. There is no dialog anywhere in this
 *  file. */

import { storeBeside } from '../assets'
import { busy } from '../busy.svelte'
import { i18n, key, message, t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { settings } from '../settings.svelte'
import { nameOf } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { waited } from '../timing'
import { canRecordHere, recordingName } from './container'
import { MOST_BYTES, record, type Recording } from './microphone'
import {
  appendTo,
  insertAbove,
  noteToRecordInto,
  replaceAll,
  setFrontMatter,
  viewFor,
  writeAtCaret,
} from './note'
import { spaceRelative } from './paths'
import { recordingPill } from '../surfaces.svelte'
import { canSummarise, summaryOf } from './summarise'
import { canTranscribe } from '../ai/hears'
import { heardPiece, LIVE_SECONDS, transcribedBy } from './transcribe'
import {
  embedFor,
  languageName,
  meetingName,
  meetingNote,
  piece as asParagraph,
  spanOf,
  summaryBlock,
  transcriptHeading,
} from './transcript'

/** How often the pill's clock is read again. Twice a second: the seconds have to
 *  change when they change, and nothing here is worth a frame. */
const TICK = 500

/** How often the queue is looked at again while a summary waits for it to empty.
 *  Short enough that a finished queue is not sat on, long enough that waiting
 *  costs nothing. */
const LOOK_AGAIN = 100

/** How many pieces of a transcript may be waiting to be sent.
 *
 *  Four, which is eighty seconds of speech. A queue longer than that means the network
 *  has been gone for a minute and a half, and a transcript that catches up ten minutes
 *  later, in the wrong order, in the middle of somebody's notes, is worse than one that
 *  says it lost a minute. The oldest goes first, because the newest is the one still
 *  worth having in the note under what is being said now. */
const MOST_WAITING = 4

/** What is being recorded, which is what decides what happens when it stops. */
type Kind = 'note' | 'meeting'

class Recorder {
  /** Null while nothing is being recorded, which is what the pill reads. */
  private held: Recording | null = null

  kind = $state<Kind>('note')

  /** Whether the microphone is open. Its own field rather than `!!held`, because the
   *  pill has to appear the moment the row is pressed and the device takes a moment to
   *  open. */
  on = $state(false)

  /** And whether the recording that has stopped is still being written down: the file,
   *  the last piece of transcript, the summary. The pill stays up, without the dot. */
  saving = $state(false)

  /** How long it has been running, in seconds. */
  elapsed = $state(0)

  /** Pieces of transcript waiting to be sent, and whether the one being sent has
   *  already failed once. Both are in the pill: a transcript that is behind is
   *  something the reader can see rather than something they find out about later. */
  waiting = $state(0)
  retrying = $state(false)

  private ticking: ReturnType<typeof setInterval> | undefined
  private started = new Date()
  /** When the run started, by the clock the elapsed time is measured on. A monotonic
   *  one, because a laptop that changes its mind about the date mid recording must not
   *  change how long the recording has been running. */
  private at = performance.now()

  /** The note being recorded into, and where its transcript goes. */
  private path: string | null = null
  private marker = transcriptHeading()

  /** The pieces of sound not yet sent, oldest first, and whether the drain is running. */
  private queue: Uint8Array<ArrayBuffer>[] = []
  private draining = false

  /** The transcript so far, for the summary, and how it read. */
  private said: string[] = []
  private language = ''
  /** Text that arrived while the note was not open in any pane. */
  private pending = ''
  /** Pieces of sound the queue had to drop. Said once, in the note. */
  private lost = 0

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
  toggle(kind: Kind) {
    if (this.on) {
      void this.stop()
      return
    }

    // The pill, asked for as the microphone opens rather than drawn while a recording
    // runs: it is what stays up while what was recorded is still being written down,
    // so the bar mounts it for good the first time anything asks. See
    // surfaces.svelte.ts and StatusBar.svelte.
    void recordingPill.ask()

    void this.start(kind)
  }

  async start(kind: Kind) {
    if (this.on) return

    this.kind = kind
    this.started = new Date()
    this.reset()
    this.on = true

    try {
      const path = kind === 'meeting' ? await this.openMeeting() : await noteToRecordInto()
      if (!path) throw new Error(key('Open a space to record into.'))
      this.path = path

      this.held = await record({
        ...(kind === 'meeting' ? { piece: (wav) => this.take(wav), seconds: LIVE_SECONDS } : {}),
        full: () => this.failed(t('That is as much as one recording may hold.')),
      })

      this.ticking = setInterval(() => {
        this.elapsed = (performance.now() - this.at) / 1000
      }, TICK)
    } catch (error) {
      this.on = false
      this.held = null
      settings.error = message(error, key('That microphone could not be opened.'))
    }
  }

  private reset() {
    this.at = performance.now()
    this.elapsed = 0
    this.waiting = 0
    this.retrying = false
    this.queue = []
    this.said = []
    this.language = ''
    this.pending = ''
    this.lost = 0
    this.path = null
    this.marker = transcriptHeading()
    // Whatever the last run had to say about itself is not about this one.
    busy.clear()
  }

  /** Stops, writes the file beside the note, and finishes what the kind asks for.
   *
   *  The line at the top of the document is on while it happens: saving a file, waiting
   *  for the last piece of a transcript and asking for a summary are seconds in which
   *  nothing on screen has changed. */
  async stop() {
    const held = this.held
    const path = this.path
    if (!held || !this.on) return

    this.on = false
    this.saving = true
    this.held = null
    clearInterval(this.ticking)

    try {
      await busy.run(t('Saving the recording'), async () => {
        const file = await held.stop()
        this.elapsed = file.seconds

        // The tail of the sound, which had not filled a piece: a sentence like any
        // other, and the one a meeting would otherwise always be missing.
        if (this.kind === 'meeting' && file.spare) this.take(file.spare)

        if (!path) throw new Error(key('Open a space to record into.'))
        await this.keep(path, file.bytes, held.extension)
        await this.drained()
        await this.finish(path)
      })
    } catch (error) {
      settings.error = message(error, key('That recording could not be saved.'))
    } finally {
      this.saving = false
      void workspace.save()
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

    // A meeting's embed goes above its transcript, where the note's own words are; a
    // recording's goes where the caret was, which is where it was asked for.
    if (this.kind === 'meeting') insertAbove(path, this.marker, `${embed}\n\n`)
    else if (view) writeAtCaret(view, embed)
    else appendTo(path, `\n${embed}\n`)

    void workspace.loadTree()
  }

  /** The last of the transcript, the duration, and the summary. */
  private async finish(path: string) {
    if (this.kind !== 'meeting') return

    this.flush(path)
    setFrontMatter(path, 'duration', spanOf(this.elapsed))

    if (this.language) {
      // The heading says what language the words are in, once the models have agreed
      // on one. Rewritten in place rather than guessed at the start.
      const named = transcriptHeading(languageName(this.language, i18n.language))
      replaceLine(path, this.marker, named)
      this.marker = named
    }

    if (this.lost) {
      appendTo(path, `${t('{count} pieces of this meeting were lost.', { count: this.lost })}\n\n`)
    }

    const text = this.said.join('\n\n').trim()
    if (!text) return

    // A meeting with no model to summarise it still leaves the transcript, which is
    // most of what it was for; the line says the one thing that would add the rest.
    if (!canSummarise()) {
      this.failed(t('Add an AI provider in settings to summarise.'))
      return
    }

    try {
      // Which model, and whose key, is summarise.ts's business and nothing this has to
      // know: the reader's own provider where there is one, the account's OpenAI key
      // through the Worker where there is not. It answers with the name so the note can
      // say who wrote what is in it.
      const answered = await summaryOf(text)
      const written = summaryBlock(answered.text, answered.model)
      if (written) insertAbove(path, this.marker, written)
    } catch (error) {
      // The transcript is in the note whatever the model said, so this is something to
      // mention rather than to interrupt for.
      this.failed(message(error, key('The summary could not be written.')))
    }
  }

  /** One piece of sound, queued. */
  private take(wav: Uint8Array<ArrayBuffer>) {
    if (this.queue.length >= MOST_WAITING) {
      // The oldest, because the newest is the one still worth reading under what is
      // being said now.
      this.queue.shift()
      this.lost++
      this.failed(t('The transcript is behind and losing pieces.'))
    }

    this.queue.push(wav)
    this.waiting = this.queue.length
    void this.drain()
  }

  /** Sends what is queued, one piece at a time. */
  private async drain() {
    if (this.draining) return
    this.draining = true

    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        this.waiting = this.queue.length

        try {
          const heard = await heardPiece(next, () => {
            this.retrying = true
            this.failed(t('A piece of the transcript is being tried again.'))
          })
          this.retrying = false

          if (!this.language) this.language = heard.language
          if (heard.text) {
            this.said.push(heard.text)
            this.write(asParagraph(heard.text))
          }
        } catch (error) {
          this.lost++
          this.retrying = false
          this.failed(message(error, key('That recording could not be turned into words.')))
        }
      }
    } finally {
      this.draining = false
      this.waiting = this.queue.length
    }
  }

  /** Waits for the queue to empty, so a summary is of the whole meeting. Bounded by
   *  the tries each piece takes rather than by a timer: a piece that will not go gives
   *  up on its own. */
  private async drained() {
    while (this.queue.length || this.draining) {
      await waited(LOOK_AGAIN)
    }
  }

  /** A piece of transcript into the note, or held until the note is open again.
   *
   *  Held rather than written to the file underneath: the note may be open with unsaved
   *  words in it, and writing the file would be writing over them. */
  private write(text: string) {
    const path = this.path
    if (!path) return

    const whole = this.pending + text
    if (appendTo(path, whole)) this.pending = ''
    else this.pending = whole
  }

  private flush(path: string) {
    if (!this.pending) return
    if (appendTo(path, this.pending)) this.pending = ''
  }

  /** A meeting's note: made, then shaped. */
  private async openMeeting(): Promise<string | null> {
    if (!canTranscribe()) {
      throw new Error(key('Add an AI provider or sign in to turn speech into words.'))
    }
    if (!workspace.activeSpace) return null

    await workspace.createNote(undefined, `${meetingName(this.started)}.md`)
    const path = workspace.active?.path ?? null
    if (!path) return null

    replaceAll(path, meetingNote(meetingName(this.started), this.started, transcribedBy()))
    return path
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

/** Replaces the first line that reads exactly `line` with `insert`. Used once: the
 *  transcript's heading, once the models have said what language they heard. */
function replaceLine(path: string, line: string, insert: string) {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return

  const doc = view.state.doc
  for (let at = 1; at <= doc.lines; at++) {
    const one = doc.line(at)
    if (one.text.trim() !== line) continue

    view.dispatch({
      changes: { from: one.from, to: one.to, insert },
      userEvent: 'input.complete',
    })
    return
  }
}

export const recorder = new Recorder()
