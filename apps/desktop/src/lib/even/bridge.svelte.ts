/** What ties the plugin's own editor to the glasses.
 *
 *  The whole of the app is already here: the same stores, the same notes, the same
 *  account, the same sync, the same rooms. So this is small on purpose. It watches
 *  the active note and the reader's own settings, hands the words to the session,
 *  hands the session's page to the panel, and hands the gestures and the words it
 *  hears back to the shell.
 *
 *  Four things live here because they are the four that need the app:
 *
 *  - **the world**, which is the space's own contents as rows on the glasses;
 *  - **the binding**, which keeps the phone's scroll and the page on the panel the
 *    same place in the note, in both directions;
 *  - **the voice**, which is a microphone, a grammar and a model;
 *  - **the settle**, which is the 700 ms that keeps a keystroke off the radio.
 *
 *  None of it runs in the plain web build, because nothing in the plain web build
 *  imports it. */

import { BODY_INNER, BODY_ROWS, GUTTER, type Page, type Paging } from '@nib/glasses'
import { account } from '../account.svelte'
import { api } from '../api'
import { bestOf, type Command, commandIn, commandWords, settled } from './commands'
import type { Field } from '../preferences'
import { fileMark } from '../file-mark'
import { modes } from '../modes.svelte'
import { shownName } from '../note-name'
import { panelWord } from './panel-words'
import { Panel } from './screen'
import { connectGlasses, type Glasses, type Input } from './sdk'
import { type OpenNote, Session } from './session'
import { glassesSettings, glassesStamp, resetGlasses } from './settings'
import { type Row, type Settings, Shell, type Wish, type Words, type World } from './shell'
import { type Listening, Voice } from './voice'
import { rooms } from '../rooms.svelte'
import { type Entry, workspace } from '../workspace.svelte'

/** How long after a keystroke the glasses are brought up to date.
 *
 *  Far longer than the editor's own idle. A band on the panel costs about 83 ms of
 *  radio, so the last thing anybody wants is one send per word; short enough that
 *  putting the phone down and looking up shows the sentence just typed. */
const SETTLE = 700

/** How long a change to a note somebody else is also in waits.
 *
 *  Much shorter, because most of what changes in a shared note is not this reader's
 *  typing: a collaborator's paragraph should appear rather than sit behind three
 *  quarters of a second, and it does not arrive one character at a time. Long enough
 *  to fold a burst of them into one send. See docs/collaboration.md.
 *
 *  Told apart by whether anybody else is in the note rather than by where the change
 *  came from, because that is the honest signal the app already has: `rooms.present`
 *  counts the other devices in each open file. Alone, the point is keeping a
 *  keystroke off the radio; together, the point is that the note is live. */
const SHARED = 80

/** How long a word heard, or a word about what went wrong, stays in the foot. */
const FLASH = 1400

/** How long after a page turn a scroll on the phone is the plugin's own doing.
 *
 *  The plugin scrolls the phone to the page it just turned to, and the scroll that
 *  causes is read a fifth of a second later; see Glasses.svelte. Anything inside
 *  this window is that scroll coming back, and acting on it is the two ends of the
 *  binding chasing each other round the note. */
const STEERING = 500

/** Whether a folder in a list can be shut. `null` when every one of them is open
 *  and no tap could change that, which is the sidebar. */
type Folds = ((path: string) => boolean) | null

/** What a setting says now, as one word for the right of its row.
 *
 *  A switch is on or off, a choice is the label of the option it is on, a number is
 *  the number. Translated by whoever built the field, so this only picks. */
function saying(field: Field): string {
  if (field.kind === 'switch') return field.get() ? panelWord('On') : panelWord('Off')
  if (field.kind === 'slider') return `${String(field.get())}${field.unit ?? ''}`
  if (field.kind === 'text') return field.get() || field.placeholder

  const value = field.get()
  return field.options.find((one) => one.value === value)?.label ?? value
}

/** Whatever was thrown, in as few words as carry the reason. */
function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How the bridge is getting on, in one word.
 *
 *  `alone` is every browser: no phone app behind the page, so there is nothing to
 *  show and nothing to say. The others are only ever reached on a phone. */
type Health = 'alone' | 'reaching' | 'live' | 'stalled' | 'failed'

/** The rows of a space, as the glasses list them.
 *
 *  Folders and notes. Canvases are never listed, which is Emil's rule and also the
 *  only sane one: a canvas cannot be set in one font on seven lines. PDFs and
 *  pictures go the same way for the same reason, and the deviation is written down
 *  in docs/even.md rather than left to be discovered.
 *
 *  `folds` says whether a folder can be shut at all: `null` is the sidebar, where
 *  everything is open and a folder is a label, and a function is the picker, where
 *  it follows the folds the reader has made and a tap changes them. */
function rowsOf(entry: Entry | null, folds: Folds, depth = 0): Row[] {
  if (!entry) return []

  const out: Row[] = []
  for (const child of entry.children) {
    if (child.is_dir) {
      const open = folds === null || folds(child.path)
      // A folder in a list where every folder is already open has nothing a tap
      // could do, so the cursor steps over it and its name is a label; see
      // `Row.pick`. In the picker it opens and shuts, so it is a row like any other.
      out.push({
        label: child.name,
        depth,
        folder: true,
        open,
        pick: folds !== null,
        id: child.path,
      })
      if (open) out.push(...rowsOf(child, folds, depth + 1))
      continue
    }

    if (fileMark(child.name) !== 'note') continue

    out.push({
      label: shownName(child.name),
      depth,
      folder: false,
      open: false,
      pick: true,
      id: child.path,
    })
  }

  return out
}

class Bridge {
  /** What the glasses are showing, so the plugin can draw a frame around it. Null
   *  while there is no pair in front of us, which is every browser. */
  showing = $state<{ from: number; to: number; page: number; count: number } | null>(null)
  /** How it is getting on. The plugin shows nothing about this unless it is
   *  wrong: nobody writing a note wants a dialog about a radio. */
  health = $state<Health>('reaching')
  /** How long the plugin itself took over the last command it heard, from the end
   *  of the speech to the panel being asked to change.
   *
   *  Ours, and not the recogniser's: what it took to hear the words is the
   *  recogniser's own and is not ours to measure. Kept rather than logged so that a
   *  test and a screenshot can both read it. */
  latency = $state(0)
  /** What the reader is being asked or told, for the phone to show too: the
   *  question that went to the model, and whether the microphone is open. */
  asked = $state('')
  answer = $state('')
  listening = $state(false)
  /** Where the voice is, in the few facts one screenshot has to answer with.
   *
   *  Real UI rather than a dev panel, because "voice mode simply doesn't work
   *  whatever I say" is four different faults wearing one face - no recogniser, a
   *  microphone that was refused, frames that never arrive, a transcription that
   *  was turned down - and nobody can read a log off a pair of glasses. See
   *  voice.ts, and the readout in Glasses.svelte. */
  voiceState = $state<Listening>({
    on: false,
    path: 'none',
    frames: 0,
    heard: '',
    nothing: false,
    trouble: '',
    detail: '',
    took: null,
  })

  private glasses: Glasses | null = null
  private panel: Panel | null = null
  private shell: Shell | null = null
  private voice: Voice | null = null
  private readonly session = new Session()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flashing: ReturnType<typeof setTimeout> | undefined
  /** One draw at a time. A burst of scrolls moves the target and nothing else; see
   *  `pump`. */
  private drawing: Promise<void> | null = null
  private wanted = false
  /** Until when a scroll on the phone is this plugin's own doing rather than the
   *  reader's.
   *
   *  A page turn scrolls the phone, and the scroll that causes arrives a moment
   *  later and would turn the page again. A flag cleared on the next turn of the
   *  loop is not enough: the plugin reads the scroller after a pause, so the window
   *  has to outlast that pause. Long enough to cover it, short enough that a reader
   *  who turns a page and then scrolls is not ignored. */
  private steerUntil = 0

  /** Brings the glasses up and starts following the active note. Answers with a
   *  teardown either way, so the entry hands it to `onDestroy` without asking
   *  whether anything happened. */
  start(): () => void {
    let stop: (() => void) | undefined
    void this.connect().then(
      (teardown) => {
        stop = teardown
      },
      (error: unknown) => {
        this.health = 'failed'
        console.warn('nib for g2:', why(error))
      },
    )

    return () => {
      clearTimeout(this.timer)
      clearTimeout(this.flashing)
      void this.voice?.stop()
      stop?.()
    }
  }

  private async connect(): Promise<(() => void) | undefined> {
    const glasses = await connectGlasses()
    if (!glasses) {
      // No phone app behind this page. Every browser ends here, and the plugin is
      // then simply the editor.
      this.health = 'alone'
      return undefined
    }

    this.glasses = glasses
    // A pair of glasses answered, once, ever. What the Glasses section on every
    // other device waits for: somebody who has never worn a pair should not be
    // offered a pane of settings about them, and the account is the only place that
    // can carry the answer between devices. See preferences.ts.
    modes.sawGlasses()

    const panel = new Panel(glasses, modes.glassesLineNumbers)
    const made = await panel.open()
    if (made !== 'made') {
      // The page is asked for exactly once a launch, so there is nothing to try
      // again: whatever the host answered is the answer for this sitting.
      this.health = 'failed'
      console.warn('nib for g2: the page was not made:', made)
      return undefined
    }

    this.panel = panel
    this.shell = new Shell(this.world(), () => this.words(), this.session, this.settings())
    this.voice = new Voice({
      microphone: (open) => glasses.microphone(open),
      // A session, and nothing else. Which model turns the sound into words is the
      // Worker's business: the account's own OpenAI key where there is one, and
      // Whisper on Workers AI where there is not. Emil has no OpenAI account and the
      // plugin used to answer "no way to listen", which was true of the key and
      // useless to somebody wearing a microphone. See services/sync/src/ask/heard.ts.
      canTranscribe: () => !!account.accountToken,
      // The grammar decides when half an utterance is already the whole of a
      // command, so that "next" is obeyed while the reader is still saying it. The
      // reader's own phrases, because a rebound one is the one they will say.
      settled: (said) => settled(said, modes.glassesWords),
      // The connection, up before there is anything to send through it.
      warm: () => api.warm(),
      transcribe: (wav) => this.transcribe(wav),
      heard: (heard) => this.heard(heard.said, heard.ended),
      failed: (said) => this.flash(said),
      said: (state) => {
        this.voiceState = state
      },
    })
    this.health = 'live'

    const listening = glasses.listen((input) => this.input(input))
    const watching = this.watch()
    if (modes.glassesVoice) void this.listen(true)

    return () => {
      listening()
      watching()
    }
  }

  /** The space's own contents, and what the glasses may do to them. */
  private world(): World {
    return {
      space: () => workspace.activeSpace?.name ?? panelWord('Notes'),
      contents: () => rowsOf(workspace.tree, null),
      spaces: () =>
        workspace.spaces.map((one) => ({
          label: one.name,
          depth: 0,
          folder: false,
          open: false,
          pick: true,
          id: one.id,
        })),
      tree: () => rowsOf(workspace.tree, (path) => workspace.isExpanded(path)),
      open: (id) => {
        // Notes only. A canvas is never in a list the glasses show, and this is the
        // second lock on the same door.
        if (fileMark(id.split(/[\\/]/).at(-1) ?? '') !== 'note') return
        void workspace.openEntry(id)
      },
      fold: (id) => workspace.toggleFolder(id),
      enter: (id) => void workspace.showSpace(id),
      listen: (on) => void this.listen(on),
      listening: () => this.listening,
      atSpace: () => workspace.activeSpace?.id ?? '',
      // By path, because that is what a row in these lists is named by. The note
      // the glasses are on is the note the plugin has active; see session.ts.
      atNote: () => workspace.active?.path ?? '',
    }
  }

  /** The words the glasses say for themselves, translated once. */
  /** What the panel says, in a language the firmware can draw.
   *
   *  `panelWord` rather than `t`: the app has forty catalogues and the firmware
   *  has one font, so a reader in Thai or Hindi had a menu of boxes. The phone's own
   *  panes stay in their language; see panel-words.ts. */
  private words(): Words {
    return {
      spaces: panelWord('Spaces'),
      notes: panelWord('Notes'),
      switchSpace: panelWord('Switch space'),
      changeNote: panelWord('Change note'),
      voiceOn: panelWord('Voice on'),
      voiceOff: panelWord('Voice off'),
      thinking: panelWord('Thinking'),
      nothingHere: panelWord('Nothing here'),
      noAnswer: panelWord('No answer'),
      settings: panelWord('Settings'),
      reset: panelWord('Reset glasses settings'),
      done: panelWord('Done'),
    }
  }

  /** The glasses' own settings screen, from the one schema the phone's Settings
   *  section is drawn from too. Nothing about which settings there are lives here;
   *  see even/settings.ts. */
  private settings(): Settings {
    const found = (id: string) => glassesSettings(panelWord).find((one) => one.id === id)

    return {
      rows: () =>
        glassesSettings(panelWord)
          .filter((one) => one.onGlasses)
          .map((one) => ({ id: one.id, label: one.field.label, value: saying(one.field) })),

      tap: (id) => {
        const field = found(id)?.field
        if (!field) return null

        // A toggle flips where it stands. A choice hands its options back for the
        // shell to put up as a list; a number steps to the next value it has, which
        // is the only thing a tap can mean for one.
        if (field.kind === 'switch') {
          field.set(!field.get())
          return null
        }

        if (field.kind === 'select') return field.options

        if (field.kind === 'slider') {
          const next = field.get() + field.step
          field.set(next > field.max ? field.min : next)
        }

        return null
      },

      pick: (id, value) => {
        const field = found(id)?.field
        if (field?.kind === 'select') field.set(value)
      },

      reset: () => resetGlasses(),
    }
  }

  /** How the reader wants a note paged, as the pager takes it.
   *
   *  The body is the whole width on every screen; the line numbers are a column laid
   *  over its left, and the note's own rows carry a constant indent to clear it. See
   *  panel.ts in @nib/glasses for why that is the shape. */
  private paging(): Paging {
    return {
      breakAt: modes.glassesBreak,
      gutter: modes.glassesLineNumbers ? GUTTER : 0,
      inner: BODY_INNER,
      rows: BODY_ROWS,
      marks: modes.glassesMarks,
      compaction: modes.glassesCompaction,
    }
  }

  /** Everything that decides what the glasses show, in one value.
   *
   *  Derived rather than read one at a time inside the effect, so the effect depends
   *  on all of it and the timer below sees one thing rather than seven. `revision`
   *  is what makes a keystroke reach here, and what makes an edit arriving through a
   *  room reach here too: a room writes into the same document. */
  private readonly reading = $derived.by(() => {
    const tab = workspace.active
    const note = tab?.kind === 'note' ? tab.note : null
    if (!note) return null

    // The reader's own settings are deliberately not in here: they belong to the
    // effect below, which applies them at once rather than after the settle. A
    // setting that waits three quarters of a second for a keystroke is a setting
    // that looks broken.
    return {
      note,
      revision: note.revision,
      shared: (rooms.present[note.key] ?? 0) > 0,
    }
  })

  private watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const reading = this.reading
        if (!reading) return

        const { note } = reading
        clearTimeout(this.timer)

        // Only this reader's typing, alone in a note, waits the full pause. A switch
        // to another note and the first page of a sitting are somebody asking for a
        // note and then watching the glass; a change to a note somebody else is in
        // is a paragraph appearing. Neither should sit behind three quarters of a
        // second.
        const switching = this.session.showing?.key !== note.key
        const wait = switching ? 0 : reading.shared ? SHARED : SETTLE

        this.timer = setTimeout(() => {
          note.flush()
          // Without the extension: on a panel of seven lines `.md` is four
          // characters of nothing, and the reader knows what their notes are.
          const name = shownName(note.name)
          this.follow({ key: note.key, name, text: note.text })
        }, wait)
      })

      // The line numbers move the body, and geometry is fixed when the page is
      // made, so this is the one setting that rebuilds it.
      $effect(() => {
        const numbered = modes.glassesLineNumbers
        const panel = this.panel
        if (!panel) return

        void panel.renumber(numbered).then(() => {
          this.again()
        })
      })

      // Any glasses setting at all, applied at once.
      //
      // This is Emil's page number: he turned it off and on again and it never came
      // back. Nothing was wrong with the setting - the page had not changed a
      // character, so `follow` sent nothing, so the panel kept the words it had. A
      // setting that waits for the next keystroke is a setting that looks broken, so
      // a change to any of them re-cuts the page and draws whatever moved, whether
      // or not the note did. The stamp is built from the schema, so a setting added
      // later is watched by having been added; see even/settings.ts.
      $effect(() => {
        const stamp = glassesStamp()
        if (!this.panel || !stamp) return

        this.again()
      })
    })
  }

  /** The note as it stands, re-paged with the settings as they stand, and drawn.
   *
   *  Unconditionally: the panel itself sends only the bands whose words changed, so
   *  a draw that changes nothing costs nothing, and a setting that changes only the
   *  head - the page number - is the case that has to reach the glass anyway. */
  private again(): void {
    const reading = this.reading
    if (reading) {
      const name = shownName(reading.note.name)
      this.session.follow({ key: reading.note.key, name, text: reading.note.text }, this.paging())
    }

    this.showing = this.session.showing
      ? {
          from: this.session.showing.from,
          to: this.session.showing.to,
          page: this.session.showing.page,
          count: this.session.showing.count,
        }
      : null

    this.draw()
  }

  /** The note, paged, and the panel brought up to date if anything moved. */
  private follow(note: OpenNote | null): void {
    this.session.follow(note, this.paging())
    this.showing = this.session.showing
      ? {
          from: this.session.showing.from,
          to: this.session.showing.to,
          page: this.session.showing.page,
          count: this.session.showing.count,
        }
      : null

    // Nothing the reader can see has moved, so nothing is sent. This is the whole
    // of what keeps a keystroke off the radio.
    if (!this.session.moved && this.shell?.screen.kind === 'note') return

    this.draw()
  }

  /** One gesture, one frame of sound, or one lifecycle event. */
  private input(input: Input): void {
    if (input.kind === 'audio') {
      this.voice?.frame(input.pcm)
      return
    }

    if (input.kind === 'life') {
      // The host clears the page when it puts a layer of its own up, so coming
      // back to the front means drawing all of it again.
      if (input.life === 'foreground') {
        this.panel?.forget()
        this.draw()
      }
      return
    }

    this.act(this.shell?.handle(input.gesture) ?? 'none')
  }

  /** What the shell asked for, done. */
  private act(wish: Wish): void {
    if (wish === 'leave') {
      // The system's own leave-this-app question, which every app is checked for on
      // its root page.
      void this.glasses?.leave()
      return
    }

    if (wish === 'draw') {
      this.showing = this.session.showing
        ? {
            from: this.session.showing.from,
            to: this.session.showing.to,
            page: this.session.showing.page,
            count: this.session.showing.count,
          }
        : null
      // A page turned on the glasses scrolls the phone to the same words. The other
      // half of the binding; the flag is what stops the two chasing each other.
      this.steer()
      this.draw()
    }
  }

  /** The phone, scrolled to where the glasses are.
   *
   *  Half of item three's binding. `goto` is the app's own way of saying "open this
   *  note at this line", which the pane reads and clears; see workspace.svelte.ts. */
  private steer(): void {
    const showing = this.session.showing
    const path = workspace.active?.path
    if (!showing || !path || this.shell?.screen.kind !== 'note') return

    this.steerUntil = performance.now() + STEERING
    workspace.goto = { path, line: showing.firstLine }
  }

  /** Whether the phone is being scrolled by the plugin rather than by a thumb.
   *
   *  Read by the card on the note: while this is true the scroll is the plugin's own
   *  doing and the card belongs where the glasses are, rather than wherever the note
   *  is passing through on its way there. */
  get steering(): boolean {
    return performance.now() < this.steerUntil
  }

  /** Where the panel would be if the note were scrolled to this offset.
   *
   *  Arithmetic and nothing else: no send, no page written down, no radio. What the
   *  card on the phone follows while a finger is dragging, so that it moves with the
   *  words on every frame instead of waiting for the glasses to be told. See
   *  session.ts. */
  regionAt(offset: number): { from: number; to: number; page: number; count: number } | null {
    const where = this.session.regionAt(offset)
    if (!where) return null

    return { from: where.from, to: where.to, page: where.page, count: where.count }
  }

  /** The glasses, taken to where the phone is.
   *
   *  The other half. Called by the plugin's own editor as it scrolls, with the
   *  offset of the first character on screen. Most of a scroll is inside the page
   *  that is already up and means nothing at all, which is what `holds` is for.
   *
   *  Ignored while the phone is being scrolled *because* of a page turn, or the two
   *  would chase each other round the note. */
  scrolled(offset: number): void {
    if (performance.now() < this.steerUntil || !this.panel) return
    if (this.shell?.screen.kind !== 'note') return
    if (this.session.holds(offset)) return

    this.session.goToOffset(offset)
    this.showing = this.session.showing
      ? {
          from: this.session.showing.from,
          to: this.session.showing.to,
          page: this.session.showing.page,
          count: this.session.showing.count,
        }
      : null
    this.draw()
  }

  /** Draws, once, and again if something changed while it was drawing.
   *
   *  A band costs about 83 ms over the radio, so five flicks of the ring used to
   *  start five sends that queued behind each other: the reader asked to be on page
   *  six and watched pages two to five go by. The target moves; the draw catches up.
   *  Concurrent sends are also the documented way to wedge the host's channel. */
  private draw(): void {
    this.wanted = true
    if (this.drawing) return

    this.drawing = this.pump()
    void this.drawing.finally(() => {
      this.drawing = null
      if (this.wanted) this.draw()
    })
  }

  private async pump(): Promise<void> {
    const panel = this.panel
    const shell = this.shell
    if (!panel || !shell) return

    while (this.wanted) {
      this.wanted = false
      try {
        await panel.show(shell.view())
        if (shell.screen.kind === 'note') this.session.drew()
        this.health = 'live'
      } catch (error) {
        // The plugin is an editor first. A page that did not reach the glasses
        // says so here and nowhere else.
        this.health = 'stalled'
        console.warn('nib for g2:', why(error))
        return
      }
    }
  }

  /** A word in the foot of the panel for a moment: a command heard, or a reason. */
  private flash(said: string): void {
    this.shell?.flash(said)
    this.draw()
    clearTimeout(this.flashing)
    this.flashing = setTimeout(() => {
      this.shell?.clearFlash()
      this.draw()
    }, FLASH)
  }

  /** The microphone, on or off. Kept on the account, so it is on next launch. */
  private async listen(on: boolean): Promise<void> {
    const voice = this.voice
    if (!voice) return

    if (on) {
      const opened = await voice.start()
      this.listening = opened
    } else {
      await voice.stop()
      this.listening = false
    }

    modes.setGlassesVoice(this.listening)
    this.draw()
  }

  /** One utterance, as words. Only reached where the WebView has no recogniser of
   *  its own, which is the phone doing this for nothing where it can. Through Nib,
   *  for the same reason a question goes through it: the key is there.
   *
   *  Whatever it refuses with is thrown rather than swallowed. "Nothing was heard"
   *  and "the account is over its ceiling" are different faults and only the phone
   *  can tell anybody which; see the readout in Glasses.svelte. */
  private async transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string | null> {
    const token = account.accountToken
    if (!token) throw new Error('sign in first')

    return (await api.askHeard(token, wav, this.vocabulary())).said
  }

  /** The words the model is told to expect: the spoken commands as this reader has
   *  them. Half a second of "next" comes back as "text" often enough to matter, and a
   *  prompt of the phrases is what settles it. */
  private vocabulary(): string {
    return commandWords()
      .map((one) => modes.glassesWords[one.id] ?? one.said)
      .join(', ')
  }

  /** Something was said. What it means, and how long it took to mean it.
   *
   *  `ended` is when the reader stopped talking, which is the only honest place to
   *  measure a command's latency from; see voice.ts. */
  private heard(said: string, ended: number): void {
    // With the phrases the reader chose, where they chose any: the grammar reads
    // them rather than holding a second copy. See even/settings.ts.
    const command = commandIn(said, modes.glassesWords)
    if (!command) return

    this.flash(said.slice(0, 40))
    this.obey(command)
    // The plugin's own share of the latency, from the end of the speech to the
    // panel being asked to change. What the recogniser took before that is the
    // recogniser's, and is not ours to measure.
    this.latency = performance.now() - ended
  }

  private obey(command: Command): void {
    const shell = this.shell
    if (!shell) return

    switch (command.kind) {
      case 'next':
        this.act(shell.handle('down'))
        return

      case 'back':
        // One page back, or out of whatever is open: the same word for the same
        // idea, which is what the gesture does too.
        this.act(shell.open ? shell.back() : shell.handle('up'))
        return

      case 'close':
        this.act(shell.close())
        return

      case 'spaces':
        this.act(shell.show('spaces'))
        return

      case 'notes':
        this.act(shell.show('tree'))
        return

      case 'switchSpace': {
        const spaces = workspace.spaces
        const name = bestOf(
          command.name,
          spaces.map((one) => one.name),
        )
        const found = spaces.find((one) => one.name === name)
        if (!found) {
          // The picker rather than nothing: they asked to change space, and the
          // name did not land.
          this.act(shell.show('spaces'))
          return
        }

        void workspace.showSpace(found.id)
        this.act(shell.close())
        return
      }

      case 'switchNote': {
        const notes = workspace.notes
        const name = bestOf(
          command.name,
          notes.map((one) => shownName(one.name)),
        )
        const found = notes.find((one) => shownName(one.name) === name)
        if (!found) {
          this.act(shell.show('tree'))
          return
        }

        void workspace.openEntry(found.path)
        this.act(shell.close())
        return
      }

      case 'page':
        this.act(shell.goToPage(command.number))
        return

      case 'line':
        this.act(shell.goToLine(command.number))
        return

      case 'voice':
        void this.listen(command.on)
        return

      case 'question':
        void this.ask(command.asked)
        return
    }
  }

  /** A question, asked of the model and answered on the glasses.
   *
   *  The plugin sends the question, the model and the effort, and nothing else: no
   *  key, and none of the notes. Nib runs the model call and the two note tools
   *  against the account's own notes, because the key is written and never read
   *  back and Nib is the only thing that can open it. See services/sync/src/ask. */
  private async ask(question: string): Promise<void> {
    const shell = this.shell
    if (!shell) return

    this.asked = question
    this.answer = ''
    this.act(shell.asking(question))

    const token = account.accountToken
    if (!token) {
      this.act(shell.answered(question, panelWord('Sign in to ask a question.')))
      return
    }

    try {
      const { answer } = await api.ask(token, question, modes.glassesModel, modes.glassesEffort)
      this.answer = answer
      this.act(shell.answered(question, answer))
    } catch (error) {
      this.answer = ''
      this.act(shell.answered(question, why(error)))
    }
  }

  /** The page the glasses are on, for the frame the plugin draws. Null when there
   *  is nothing on them. */
  get page(): Page | null {
    return this.session.page
  }
}

export const bridge = new Bridge()
