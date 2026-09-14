/** What the glasses are showing, and what a gesture does to it.
 *
 *  The G2 gives an app five gestures and nothing else: a tap, a double tap, a
 *  hold, and a scroll each way, off either temple or off the ring. There is no
 *  pointer, no rotation and no delta; see docs/even.md. So every screen the
 *  plugin has has to be reachable with those five, and this is the whole of how:
 *
 *  | Gesture | Where | What |
 *  | --- | --- | --- |
 *  | tap | the note | open the sidebar |
 *  | tap | a list | open the row under the cursor |
 *  | hold | anywhere | open the modal |
 *  | double tap | the note | the system's own leave-this-app question |
 *  | double tap | anything else | close it, one level |
 *  | scroll | the note | a page each way |
 *  | scroll | a list | the cursor, a row each way |
 *  | scroll | an answer | a line each way |
 *
 *  A stack rather than a mode, because the modal opens over the note and the note
 *  picker opens over the modal, and a double tap has to close exactly one of them.
 *  The note is the floor of the stack and is never popped: a double tap there is
 *  the one gesture the platform reserves, and every app is checked for raising the
 *  exit dialogue on its root page.
 *
 *  Nothing here knows about Svelte, a radio or a workspace. The lists come from a
 *  `World` handed in and the words from a `Words` handed in, which is what makes
 *  the table above a test rather than a hope. */

import {
  BODY_INNER,
  BODY_ROWS,
  fit,
  pageOfLine,
  ruleOf,
  HEAD_INNER,
  spread,
  width,
  wrap,
} from '@nib/glasses'
import type { Session } from './session'

/** One row of a list on the glasses. */
export interface Row {
  /** What it is called. Cut to the panel by the view, not here. */
  label: string
  /** How far in it sits, in steps. */
  depth: number
  /** True when choosing it opens or shuts it rather than going into it. */
  folder: boolean
  /** True when it is a folder that is open. */
  open: boolean
  /** Whether the cursor may land on it at all.
   *
   *  False for a folder in the sidebar, where every folder is already open and
   *  there is nothing a tap on one could do. The names still show, because they are
   *  what says where a note lives; the cursor steps over them, so every tap the
   *  reader makes opens something. A dead gesture is worse than a plain label. */
  pick: boolean
  /** What the world calls it: a path, a space id, a choice. */
  id: string
}

/** Everything the shell cannot work out for itself.
 *
 *  Read afresh every time a screen is drawn rather than held, because the space's
 *  contents change under us: a note arriving through a room, a folder renamed on
 *  the desktop. A list on the glasses is never a stale list. */
export interface World {
  /** The name of the space the reader is in. */
  space: () => string
  /** Everything in the space with every folder open, canvases never among them.
   *  What a single tap puts up. */
  contents: () => Row[]
  /** The spaces, to switch between. */
  spaces: () => Row[]
  /** The same tree, but with folders that open and shut. */
  tree: () => Row[]
  /** Opens a note. Canvases cannot be opened in the plugin at all, so nothing
   *  here ever names one. */
  open: (id: string) => void
  /** Opens or shuts a folder in the tree. */
  fold: (id: string) => void
  /** Switches space. */
  enter: (id: string) => void
  /** Turns the microphone on or off. */
  listen: (on: boolean) => void
  /** Whether it is on now. */
  listening: () => boolean
  /** The space the reader is in, by the id its row carries, so a list of spaces
   *  opens with the cursor on the one they are already in rather than at the top. */
  atSpace: () => string
  /** The note on the glasses, by the id its row carries. Same reason: a list you
   *  opened to change something starts where you are. */
  atNote: () => string
}

/** The glasses' own settings, as rows the cursor walks.
 *
 *  Handed in rather than reached for, like the world and the words, so that this
 *  file knows nothing about the app's stores and the whole screen is a test. What
 *  is on the other end is one schema shared with the phone's own Settings section;
 *  see even/settings.ts. Adding a setting adds a row here and a row there, and
 *  nothing in this file changes. */
export interface Settings {
  /** Every setting, in order: what it is called and what it says now. Read afresh
   *  every draw, like the lists, so a setting changed on the phone is changed here
   *  before the reader's thumb is off the temple. */
  rows: () => SettingRow[]
  /** A tap on one. Answers the choices to put up when it is a choice, and null
   *  when the tap was the whole of it - a toggle flips where it stands. */
  tap: (id: string) => readonly Option[] | null
  /** One of those choices, chosen. */
  pick: (id: string, value: string) => void
  /** Every glasses setting back to what it started as. */
  reset: () => void
}

export interface SettingRow {
  id: string
  label: string
  /** What it says now, already translated: `On`, `H2 and above`, a phrase. Empty
   *  for the row that is an action rather than a setting. */
  value: string
}

export interface Option {
  value: string
  label: string
}

/** The handful of words the glasses say for themselves, already translated.
 *
 *  Handed in so that this file has no locale in it and the four dictionaries have
 *  one entry each; see i18n.svelte.ts. */
export interface Words {
  spaces: string
  notes: string
  switchSpace: string
  changeNote: string
  voiceOn: string
  voiceOff: string
  thinking: string
  nothingHere: string
  noAnswer: string
  settings: string
  reset: string
  done: string
}

/** What the reader is looking at. */
export type Screen =
  | { kind: 'note' }
  | { kind: 'sidebar'; at: number }
  | { kind: 'modal'; at: number }
  | { kind: 'spaces'; at: number }
  | { kind: 'tree'; at: number }
  | { kind: 'settings'; at: number }
  | { kind: 'choice'; id: string; title: string; rows: readonly Option[]; at: number }
  | { kind: 'asking'; question: string }
  | { kind: 'answer'; question: string; rows: readonly string[]; at: number }

/** The five bands of the panel, filled. What the app writes to the glasses; see
 *  `panel.ts` in @nib/glasses for where each one sits. */
export interface View {
  head: string
  rule: string
  body: string
  nums: string
  mic: string
}

/** The three choices the hold gesture puts up. In this order, because the first is
 *  the one somebody holding the temple most often wants. */
const CHOICES = ['space', 'note', 'voice', 'settings'] as const
type Choice = (typeof CHOICES)[number]

/** What a gesture is, once `sdk.ts` has read it off the wire. */
export type Gesture = 'tap' | 'double' | 'hold' | 'up' | 'down'

/** What the shell wants done outside itself, having handled a gesture.
 *
 *  Answered rather than done, because leaving the app is the platform's own
 *  business and a page is the radio's: both belong to the caller, and a shell that
 *  did them itself could not be tested without either. */
export type Wish = 'none' | 'leave' | 'draw'

/** The id of the row that is an action rather than a setting. A name no setting
 *  can have, because a setting's id names a field. */
const RESET = 'reset:action'

const CURSOR = '▶ '
const NOWHERE = '  '
const OPEN = '▼ '
const SHUT = '▶ '
const STEP = '  '

/** How many rows of a list are shown at once. The body's own seven. */
const SHOWN = BODY_ROWS

/** A window of `SHOWN` rows that keeps the cursor inside it.
 *
 *  Scrolled rather than paged: the cursor moves a row at a time and the window
 *  follows it only when it would leave, which is how a list feels on anything
 *  else with a cursor in it. */
function windowOf(at: number, count: number): number {
  if (count <= SHOWN) return 0
  return Math.min(Math.max(0, at - Math.floor(SHOWN / 2)), count - SHOWN)
}

function clamp(at: number, count: number): number {
  return Math.min(Math.max(0, at), Math.max(0, count - 1))
}

/** The next row the cursor may land on, going `by` from `at`.
 *
 *  Answers where it started when there is nowhere to go, which is what makes the
 *  end of a list feel like the end of a list rather than like a dropped gesture. */
function nextPick(rows: readonly Row[], at: number, by: number): number {
  for (let to = at + by; to >= 0 && to < rows.length; to += by) {
    if (rows[to]?.pick) return to
  }

  return at
}

/** One setting's choices, as rows like any other list's. */
function optionRows(options: readonly Option[]): Row[] {
  return options.map((one) => ({
    label: one.label,
    depth: 0,
    folder: false,
    open: false,
    pick: true,
    id: one.value,
  }))
}

/** The first row the cursor may land on. Where a list opens with nothing to open
 *  it on. */
function firstPick(rows: readonly Row[]): number {
  const at = rows.findIndex((row) => row.pick)
  return at < 0 ? 0 : at
}

/** Where a list opens: on the row the reader is already in, if it is in the list.
 *
 *  A list of five spaces that always opens on the first is a list that costs four
 *  scrolls to say "not that one, the one I am in". Opening on where you are makes
 *  the cursor an answer to "where am I" as well as a way to choose. */
function startAt(rows: readonly Row[], id: string): number {
  const at = rows.findIndex((row) => row.pick && row.id === id)
  return at < 0 ? firstPick(rows) : at
}

export class Shell {
  /** The note is the floor and is never popped. */
  private stack: Screen[] = [{ kind: 'note' }]
  /** What the foot says for a moment instead of what it usually says: a command
   *  just heard, or a word about what went wrong. Cleared by the caller's timer. */
  private flashed = ''

  constructor(
    private readonly world: World,
    /** Asked for rather than handed over, the way everything in `World` is.
     *
     *  It was an object built once, when the bridge connected - and a plugin connects
     *  to the glasses in milliseconds while its interface catalogue is a dynamic
     *  import that lands a moment later. So every label on the glass was whatever the
     *  catalogue said before it had loaded, which is English: a German reader read
     *  "Settings" over a list of German rows, because the rows are built per render
     *  and these were built once. Read per render now, which is twelve lookups. */
    private readonly saying: () => Words,
    private readonly session: Session,
    private readonly settings: Settings,
  ) {}

  /** What the panel says, in the reader's language as it stands now. */
  private get words(): Words {
    return this.saying()
  }

  get screen(): Screen {
    return this.stack.at(-1) ?? { kind: 'note' }
  }

  /** True when anything at all is open over the note. What a spoken "close" and
   *  the back gesture both ask. */
  get open(): boolean {
    return this.stack.length > 1
  }

  /** How many rows an answer came to, once it was wrapped to the panel. Only a test
   *  asks; the reader is told in the foot. */
  get answerRows(): number {
    const screen = this.screen
    return screen.kind === 'answer' ? screen.rows.length : 0
  }

  /** One gesture off a temple or off the ring. */
  handle(gesture: Gesture): Wish {
    switch (gesture) {
      case 'hold':
        // From anywhere, including from inside another screen: a hold is the way
        // to the modal and never has to be reached for twice.
        return this.show('modal')

      case 'double':
        return this.back()

      case 'tap':
        return this.choose()

      case 'up':
        return this.move(-1)

      case 'down':
        return this.move(1)
    }
  }

  /** Closes one level, or asks to leave the app when there is nothing to close.
   *
   *  This is the whole of item four's back gesture: the plugin consumes the double
   *  tap while anything is open, and hands it back to the system only on the root
   *  page, which is where a review expects the exit dialogue. */
  back(): Wish {
    if (this.stack.length > 1) {
      this.stack.pop()
      return 'draw'
    }

    return 'leave'
  }

  /** Puts a screen up by name. What a spoken command asks for. */
  show(kind: 'sidebar' | 'modal' | 'spaces' | 'tree' | 'settings'): Wish {
    this.stack = [{ kind: 'note' }, { kind, at: this.opensAt(kind) }]
    return 'draw'
  }

  /** Where a screen's cursor starts: on what the reader is already in. */
  private opensAt(kind: 'sidebar' | 'modal' | 'spaces' | 'tree' | 'settings'): number {
    const rows = this.rowsFor(kind)
    switch (kind) {
      case 'spaces':
        return startAt(rows, this.world.atSpace())
      case 'sidebar':
      case 'tree':
        return startAt(rows, this.world.atNote())
      case 'modal':
      case 'settings':
        return firstPick(rows)
    }
  }

  /** The rows a screen is made of, by its name. */
  private rowsFor(kind: 'sidebar' | 'modal' | 'spaces' | 'tree' | 'settings'): Row[] {
    switch (kind) {
      case 'sidebar':
        return this.world.contents()
      case 'spaces':
        return this.world.spaces()
      case 'tree':
        return this.world.tree()
      case 'modal':
        return this.choices()
      case 'settings':
        return this.settingRows()
    }
  }

  /** The settings, as rows like any other list's: what each is called on the left
   *  and what it says now on the right, and the reset at the foot of them where an
   *  action belongs. Spread so the cursor and the drawing cannot disagree. */
  private settingRows(): Row[] {
    const rows: Row[] = this.settings.rows().map((one) => ({
      label: one.value ? spread(one.label, one.value, BODY_INNER - width(CURSOR)) : one.label,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: one.id,
    }))

    rows.push({
      label: this.words.reset,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: RESET,
    })

    return rows
  }

  /** Back to the note, whatever was over it. */
  close(): Wish {
    this.stack = [{ kind: 'note' }]
    return 'draw'
  }

  /** A question on its way to the model, and then its answer. */
  asking(question: string): Wish {
    this.stack = [{ kind: 'note' }, { kind: 'asking', question }]
    return 'draw'
  }

  answered(question: string, answer: string): Wish {
    // A model hard wraps its own prose at whatever width it was trained to, and a
    // panel is 560 pixels: read as breaks, its lines come out as a ragged column
    // with two words on every other row. A single newline is a space, as it is in
    // markdown; a blank line still parts two paragraphs.
    //
    // Wrapped here rather than by the container, so that the rows the reader
    // scrolls through are the rows the firmware will draw, one for one.
    const rows = answer.split(/\n\s*\n/u).flatMap((part, at) => {
      const flowed = part.replace(/\s*\n\s*/gu, ' ').trim()
      const wrapped = flowed === '' ? [] : [...wrap(flowed, BODY_INNER)]
      return at === 0 ? wrapped : ['', ...wrapped]
    })
    const said = rows.some((row) => row !== '') ? rows : [this.words.noAnswer]

    this.stack = [{ kind: 'note' }, { kind: 'answer', question, rows: said, at: 0 }]
    return 'draw'
  }

  /** A word in the foot for a moment: a command heard, a name not found. */
  flash(said: string): void {
    this.flashed = said
  }

  clearFlash(): void {
    this.flashed = ''
  }

  /** The page of the note the reader is on, by whichever route they asked.
   *
   *  Here rather than on the session because a page turn means nothing while a
   *  list is up: the scroll belongs to whatever is in front of the reader. */
  turn(by: number): Wish {
    this.session.turn(by)
    return 'draw'
  }

  /** Straight to a page, for "open page 4". */
  goToPage(page: number): Wish {
    this.session.goTo(page - 1)
    return 'draw'
  }

  /** Straight to a line of the note, for "go to line 40". */
  goToLine(line: number): Wish {
    const pages = this.session.pages
    if (!pages.length) return 'none'

    this.session.goTo(pageOfLine(pages, line))
    return 'draw'
  }

  /** The cursor, or the page, or a line of an answer: whatever the screen in front
   *  of the reader scrolls. */
  private move(by: number): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.turn(by)

      case 'sidebar':
        return this.step(screen, this.world.contents(), by)

      case 'spaces':
        return this.step(screen, this.world.spaces(), by)

      case 'tree':
        return this.step(screen, this.world.tree(), by)

      case 'modal':
        return this.step(screen, this.choices(), by)

      case 'settings':
        return this.step(screen, this.settingRows(), by)

      case 'choice':
        return this.step(screen, optionRows(screen.rows), by)

      case 'answer': {
        const most = Math.max(0, screen.rows.length - SHOWN)
        const at = Math.min(Math.max(0, screen.at + by), most)
        if (at === screen.at) return 'none'

        screen.at = at
        return 'draw'
      }

      case 'asking':
        // Nothing to scroll, and nothing to be confused about: the model is
        // working and the panel says so.
        return 'none'
    }
  }

  private step(screen: { at: number }, rows: readonly Row[], by: number): Wish {
    const at = nextPick(rows, clamp(screen.at, rows.length), by)
    if (at === screen.at) return 'none'

    screen.at = at
    return 'draw'
  }

  /** A tap: into the row under the cursor, or into the sidebar from the note. */
  private choose(): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.show('sidebar')

      case 'sidebar': {
        const row = this.world.contents()[screen.at]
        if (!row?.pick) return 'none'

        this.world.open(row.id)
        return this.close()
      }

      case 'spaces': {
        const row = this.world.spaces()[screen.at]
        if (!row) return 'none'

        this.world.enter(row.id)
        // Straight into that space's notes, because nobody switches space to look
        // at the note they were already reading. Emil's rule, and the two taps it
        // saves are two taps on a temple.
        this.stack = [{ kind: 'note' }, { kind: 'tree', at: this.opensAt('tree') }]
        return 'draw'
      }

      case 'tree': {
        const row = this.world.tree()[screen.at]
        if (!row) return 'none'

        // A folder opens where it stands and the reader keeps their place; a note
        // opens and the tree goes away, because they asked for the note.
        if (row.folder) {
          this.world.fold(row.id)
          return 'draw'
        }

        this.world.open(row.id)
        return this.close()
      }

      case 'modal':
        return this.take(CHOICES[clamp(screen.at, CHOICES.length)] ?? 'space')

      case 'settings': {
        const row = this.settingRows()[screen.at]
        if (!row) return 'none'

        if (row.id === RESET) {
          this.settings.reset()
          this.flash(this.words.done)
          return 'draw'
        }

        // A toggle flips where it stands and the row says so at once; a choice
        // opens as a list like every other list here, with the cursor on the value
        // it already has.
        const options = this.settings.tap(row.id)
        if (!options) return 'draw'

        const label = this.settings.rows().find((one) => one.id === row.id)
        const at = options.findIndex((one) => one.label === label?.value)
        this.stack.push({
          kind: 'choice',
          id: row.id,
          title: label?.label ?? '',
          rows: options,
          at: at < 0 ? 0 : at,
        })
        return 'draw'
      }

      case 'choice': {
        const option = screen.rows[clamp(screen.at, screen.rows.length)]
        if (!option) return 'none'

        this.settings.pick(screen.id, option.value)
        // Back to the settings, where the row now says what was chosen. One level,
        // the way a double tap would have gone.
        this.stack.pop()
        return 'draw'
      }

      case 'answer':
      case 'asking':
        return 'none'
    }
  }

  private take(choice: Choice): Wish {
    switch (choice) {
      case 'space':
        this.stack.push({ kind: 'spaces', at: this.opensAt('spaces') })
        return 'draw'

      case 'note':
        this.stack.push({ kind: 'tree', at: this.opensAt('tree') })
        return 'draw'

      case 'settings':
        this.stack.push({ kind: 'settings', at: this.opensAt('settings') })
        return 'draw'

      case 'voice': {
        // Answered by the dot in the corner and by nothing else. It used to flash the
        // words in the head, and the head is where the heading a reader is under
        // belongs: Emil, on his own glasses, found "Voice off" sitting where the
        // section should be. The dot is beside the page number, which is where it was
        // before any of this.
        this.world.listen(!this.world.listening())
        return this.close()
      }
    }
  }

  /** The five bands, filled for whatever is in front of the reader.
   *
   *  One function for every screen, so that they cannot drift apart: the sidebar
   *  and the note picker are the same seven rows in the same band with the same
   *  cursor, which is the whole of why they feel like one design. */
  view(): View {
    const mic = this.world.listening() ? '●' : ' '
    const screen = this.screen

    switch (screen.kind) {
      case 'note':
        return { ...this.note(), mic }

      case 'sidebar':
        return { ...this.list(this.world.space(), this.world.contents(), screen.at), mic }

      case 'spaces':
        return { ...this.list(this.words.spaces, this.world.spaces(), screen.at), mic }

      case 'tree':
        return { ...this.list(this.words.notes, this.world.tree(), screen.at), mic }

      case 'modal':
        return { ...this.modal(screen.at), mic }

      case 'settings':
        return { ...this.list(this.words.settings, this.settingRows(), screen.at), mic }

      case 'choice':
        return { ...this.list(screen.title, optionRows(screen.rows), screen.at), mic }

      case 'asking':
        return {
          head: this.top(screen.question, ''),
          rule: ruleOf('─', BODY_INNER),
          body: this.words.thinking,
          nums: '',
          mic,
        }

      case 'answer': {
        const from = Math.min(screen.at, Math.max(0, screen.rows.length - SHOWN))
        const shown = screen.rows.slice(from, from + SHOWN)
        const more = screen.rows.length > SHOWN
        return {
          head: this.top(
            screen.question,
            more ? `${String(from + shown.length)}/${String(screen.rows.length)}` : '',
          ),
          rule: ruleOf('─', BODY_INNER),
          body: shown.join('\n'),
          nums: '',
          mic,
        }
      }
    }
  }

  /** The note itself: the section in the head, seven lines in the body, the note's
   *  own name and which page of how many in the foot. */
  private note(): View {
    const page = this.session.page
    const showing = this.session.showing
    if (!page || !showing) {
      return { head: fit(this.flashed, HEAD_INNER), rule: '', body: '', nums: '', mic: '' }
    }

    // The section the reader is in, or the note's own name at the top of a note
    // that opens without a heading. Either way the head answers "where am I" - and
    // a word just heard takes the line for a moment, because that is the one thing
    // more urgent than where you are.
    const where = page.section === '' ? showing.name : page.section
    return {
      head: this.top(this.flashed || where, this.place(showing)),
      rule: ruleOf(page.rule, BODY_INNER),
      body: this.session.words,
      nums: this.session.numbers,
      mic: '',
    }
  }

  /** Which page of how many.
   *
   *  Always there: the app cuts the note into panels and turns them, which is the
   *  only way the glass is ever fed, so a page number always means a page. It was a
   *  question for as long as the glasses could be asked to scroll the note
   *  themselves; see even/settings.ts for why that is gone. */
  private place(showing: { page: number; count: number }): string {
    return `${String(showing.page + 1)}/${String(showing.count)}`
  }

  /** The head band: what this screen is, and where in it the reader is, at the
   *  right beside the microphone's corner.
   *
   *  Emil: "the page number should be shown in the top right", next to the voice
   *  indicator. One band rather than two, because a text container has no alignment
   *  and a band costs 83 ms of radio: `spread` pads the gap in the firmware's own
   *  measure, which is what makes the number land on the right pixel. */
  private top(said: string, where: string): string {
    if (!where) return fit(said, HEAD_INNER)
    return spread(said, where, HEAD_INNER)
  }

  /** A list: its name over a rule, eight rows of it, and where in it the cursor is.
   *
   *  The window follows the cursor rather than paging, and the cursor is a triangle
   *  in a column of its own so that every row's words start at the same pixel
   *  whether it is the chosen one or not. */
  private list(title: string, rows: readonly Row[], at: number): View {
    const from = windowOf(at, rows.length)
    const shown = rows.slice(from, from + SHOWN)
    const body = shown.map((row, index) => {
      const mark = from + index === at ? CURSOR : NOWHERE
      const lead = row.folder ? (row.open ? OPEN : SHUT) : ''
      return fit(`${mark}${STEP.repeat(row.depth)}${lead}${row.label}`, BODY_INNER)
    })

    return {
      head: this.top(title, rows.length ? `${String(at + 1)}/${String(rows.length)}` : ''),
      rule: ruleOf('─', BODY_INNER),
      body: (rows.length ? body : [this.words.nothingHere]).join('\n'),
      nums: '',
      mic: '',
    }
  }

  /** The three choices a hold puts up. Deliberately the same shape as a list, so a
   *  reader who has used one has used the other. */
  private modal(at: number): View {
    return this.list(this.world.space(), this.choices(), at)
  }

  /** The three choices, as rows like any other list's. Said once, so that the
   *  cursor and the drawing cannot disagree about what is on the screen. */
  private choices(): Row[] {
    const said: Record<Choice, string> = {
      space: this.words.switchSpace,
      note: this.words.changeNote,
      voice: this.world.listening() ? this.words.voiceOff : this.words.voiceOn,
      settings: this.words.settings,
    }

    return CHOICES.map((choice) => ({
      label: said[choice],
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: choice,
    }))
  }
}
