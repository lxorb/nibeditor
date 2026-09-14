import { BODY_INNER, BODY_ROWS } from '@nib/glasses'
import { beforeEach, describe, expect, test } from 'vitest'
import { Session } from './session'
import {
  type Option,
  type Row,
  type SettingRow,
  type Settings,
  Shell,
  type Words,
  type World,
} from './shell'

const WORDS: Words = {
  spaces: 'Spaces',
  notes: 'Notes',
  switchSpace: 'Switch space',
  changeNote: 'Change note',
  voiceOn: 'Voice on',
  voiceOff: 'Voice off',
  thinking: 'Thinking',
  nothingHere: 'Nothing here',
  noAnswer: 'No answer',
  settings: 'Settings',
  reset: 'Reset glasses settings',
  done: 'Done',
}

/** Settings that answer like the app's own and write down what they were told.
 *  Two of them, one of each kind, which is the whole of what the screen does. */
class FakeSettings implements Settings {
  numbers = true
  breakAt = '2'
  readonly resets: number[] = []

  rows = (): SettingRow[] => [
    { id: 'lineNumbers', label: 'Line numbers', value: this.numbers ? 'On' : 'Off' },
    { id: 'break', label: 'New page at', value: this.breakAt === '2' ? 'H2 and above' : 'Never' },
  ]

  tap = (id: string): readonly Option[] | null => {
    if (id === 'lineNumbers') {
      this.numbers = !this.numbers
      return null
    }

    return [
      { value: '2', label: 'H2 and above' },
      { value: '0', label: 'Never' },
    ]
  }

  pick = (id: string, value: string) => {
    if (id === 'break') this.breakAt = value
  }

  reset = () => void this.resets.push(1)
}

const paging = { breakAt: 2, gutter: 0, inner: BODY_INNER, rows: BODY_ROWS }

const NOTE = [
  '# The title',
  '',
  'Words under the title, enough of them to run past one line of the panel.',
  '',
  '## A section',
  '',
  'More words in the section.',
  '',
].join('\n')

function row(label: string, over: Partial<Row> = {}): Row {
  return { label, depth: 0, folder: false, open: false, pick: true, id: label, ...over }
}

/** A world that answers like the app's own, and writes down what it was asked. */
class Fake implements World {
  spaceName = 'Work'
  contentRows: Row[] = [
    row('Inbox', { folder: true, open: true }),
    row('Monday standup', { depth: 1 }),
    row('Meeting notes', { depth: 1 }),
    row('Reading list'),
  ]
  spaceRows: Row[] = [row('Work'), row('Home'), row('Nib')]
  treeRows: Row[] = [row('Inbox', { folder: true, open: false }), row('Reading list')]
  on = false
  readonly opened: string[] = []
  readonly folded: string[] = []
  readonly entered: string[] = []

  space = () => this.spaceName
  contents = () => this.contentRows
  spaces = () => this.spaceRows
  tree = () => this.treeRows
  open = (id: string) => void this.opened.push(id)
  fold = (id: string) => void this.folded.push(id)
  enter = (id: string) => void this.entered.push(id)
  listen = (on: boolean) => {
    this.on = on
  }
  listening = () => this.on
  /** Where the reader already is, which is where a list opens. Empty by default,
   *  so the cases that are not about that behave as they always did. */
  space_ = ''
  note_ = ''
  atSpace = () => this.space_
  atNote = () => this.note_
}

let world: Fake
let session: Session
let shell: Shell
let settings: FakeSettings

beforeEach(() => {
  world = new Fake()
  session = new Session()
  settings = new FakeSettings()
  session.follow({ key: 'a', name: 'A note', text: NOTE }, paging)
  shell = new Shell(world, () => WORDS, session, settings)
})

/** The table in the file's own header, as tests. */
describe('what a gesture does', () => {
  test('a tap on the note opens the sidebar', () => {
    expect(shell.handle('tap')).toBe('draw')
    expect(shell.screen.kind).toBe('sidebar')
  })

  test('a tap on the sidebar opens the row under the cursor and closes it', () => {
    shell.handle('tap')
    shell.handle('down')
    shell.handle('tap')

    expect(world.opened).toEqual(['Monday standup'])
    expect(shell.screen.kind).toBe('note')
  })

  test('a hold opens the modal, from anywhere', () => {
    expect(shell.handle('hold')).toBe('draw')
    expect(shell.screen.kind).toBe('modal')

    shell.handle('tap')
    expect(shell.screen.kind).toBe('spaces')
    // Held again from inside another screen, and it is the modal again rather
    // than one more thing on the stack.
    shell.handle('hold')
    expect(shell.screen.kind).toBe('modal')
  })

  /** Emil, on his own glasses: switching space should land in that space's notes.
   *  Nobody switches space to look at the note they were already reading. */
  test('choosing a space goes straight into that space’s notes', () => {
    shell.show('spaces')
    expect(shell.handle('tap')).toBe('draw')

    expect(world.entered).toEqual(['Work'])
    expect(shell.screen.kind).toBe('tree')
    // And one double tap is back to the note rather than back to the spaces: the
    // spaces screen was a step on the way, not somewhere to return to.
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
  })

  test('a list of spaces opens on the space the reader is in', () => {
    world.space_ = 'Nib'
    shell.show('spaces')

    expect(shell.screen).toEqual({ kind: 'spaces', at: 2 })
    expect(shell.view().head.trimEnd()).toMatch(/^Spaces {2,}3\/3$/)
  })

  test('a list of notes opens on the note the reader is in', () => {
    world.note_ = 'Reading list'
    shell.show('tree')
    expect(shell.screen).toEqual({ kind: 'tree', at: 1 })

    shell.show('sidebar')
    expect(shell.screen).toEqual({ kind: 'sidebar', at: 3 })
  })

  test('and on the first row it can land on when that note is not in the list', () => {
    world.note_ = 'Somewhere else'
    shell.show('sidebar')

    // Back to the first row the cursor may land on, which is where a list opened
    // before any of this.
    expect(shell.screen).toEqual({ kind: 'sidebar', at: 0 })
  })

  test('a double tap on the note asks the system to leave the app', () => {
    // The one gesture the platform reserves, and every app is checked for it.
    expect(shell.handle('double')).toBe('leave')
    expect(shell.screen.kind).toBe('note')
  })

  test('a double tap closes whatever is open instead of leaving', () => {
    shell.handle('hold')
    shell.handle('tap')
    expect(shell.screen.kind).toBe('spaces')

    // One level at a time: the picker, then the modal, then the note.
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('modal')
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
    // And only then the system's own question.
    expect(shell.handle('double')).toBe('leave')
  })

  test('a scroll on the note turns a page', () => {
    const before = session.showing?.page ?? 0

    shell.handle('down')
    expect(session.showing?.page).toBe(before + 1)
    shell.handle('up')
    expect(session.showing?.page).toBe(before)
  })

  test('a scroll on a list moves the cursor a row', () => {
    shell.handle('tap')

    shell.handle('down')
    shell.handle('down')
    expect(shell.screen).toMatchObject({ kind: 'sidebar', at: 2 })
    shell.handle('up')
    expect(shell.screen).toMatchObject({ kind: 'sidebar', at: 1 })
  })

  test('a cursor stops at each end rather than wrapping round', () => {
    shell.handle('tap')

    shell.handle('up')
    expect(shell.screen).toMatchObject({ at: 0 })
    for (let n = 0; n < 20; n++) shell.handle('down')
    expect(shell.screen).toMatchObject({ at: world.contentRows.length - 1 })
    // And says so, rather than redrawing a panel that has not changed.
    expect(shell.handle('down')).toBe('none')
  })
})

/** The tree, which is the one list where a tap does two different things. */
describe('the note picker', () => {
  beforeEach(() => {
    shell.handle('hold')
    shell.handle('down')
    shell.handle('tap')
  })

  test('opens on the tree', () => {
    expect(shell.screen.kind).toBe('tree')
  })

  test('a tap on a folder opens it and keeps the reader where they are', () => {
    shell.handle('tap')

    expect(world.folded).toEqual(['Inbox'])
    expect(shell.screen.kind).toBe('tree')
  })

  test('a tap on a note opens it and puts the tree away', () => {
    shell.handle('down')
    shell.handle('tap')

    expect(world.opened).toEqual(['Reading list'])
    expect(shell.screen.kind).toBe('note')
  })

  test('draws a folder open or shut', () => {
    expect(shell.view().body).toContain('▶ Inbox')
    world.treeRows = [row('Inbox', { folder: true, open: true }), row('Reading list')]
    expect(shell.view().body).toContain('▼ Inbox')
  })
})

/** The modal, which is three rows and the same cursor as every other list. */
describe('the modal', () => {
  test('offers switch space, change note, the microphone and the settings', () => {
    shell.handle('hold')
    const body = shell.view().body

    expect(body).toContain('Switch space')
    expect(body).toContain('Change note')
    expect(body).toContain('Voice on')
    expect(body).toContain('Settings')
  })

  /** And says so with the dot in the corner and nothing else. It used to flash the
   *  words in the head, where the heading a reader is under belongs: Emil, on his own
   *  glasses, found "Voice off" sitting where the section should be. */
  test('turns the microphone on, and the head keeps the heading', () => {
    shell.handle('hold')
    shell.handle('down')
    shell.handle('down')
    shell.handle('tap')

    expect(world.on).toBe(true)
    expect(shell.screen.kind).toBe('note')
    expect(shell.view().head).toContain('THE TITLE')
    expect(shell.view().head).not.toContain('Voice')
    // The dot is the answer, beside the page number.
    expect(shell.view().mic).toBe('●')
  })

  test('offers to turn it off once it is on', () => {
    world.on = true
    shell.handle('hold')

    expect(shell.view().body).toContain('Voice off')
  })
})

/** Every screen is the same five bands, which is the whole reason a gesture costs
 *  two sends and not a rebuild. */
describe('the view', () => {
  test('never puts more rows in the body than the panel holds', () => {
    for (const open of [() => undefined, () => shell.handle('tap'), () => shell.handle('hold')]) {
      open()
      expect(shell.view().body.split('\n').length).toBeLessThanOrEqual(BODY_ROWS)
      shell.close()
    }
  })

  test('says the section in the head, and the note and the page in the foot', () => {
    const view = shell.view()

    expect(view.rule).toMatch(/^═+$/)
    // One band, with the count pushed against the right hand edge beside the
    // microphone's corner: a text container has no alignment, so the gap is spent on
    // spaces. Emil: "the page number should be shown in the top right".
    expect(view.head.trimEnd()).toMatch(/^THE TITLE {2,}1\/\d+$/)
  })

  /** There is no setting for this any more. It used to be off wherever the glasses
   *  were scrolling the note themselves, and that mode is gone: the app turns every
   *  page, so a number always means a page. See even/settings.ts. */
  test('and the number is there on every page, because the app turns them all', () => {
    expect(shell.view().head.trimEnd()).toMatch(/\d+\/\d+$/)

    session.turn(1)
    expect(shell.view().head.trimEnd()).toMatch(/2\/\d+$/)
  })

  test('falls back to the note name when a note opens without a heading', () => {
    session.follow({ key: 'b', name: 'Plain', text: 'Just words.\n' }, paging)

    expect(shell.view().head.trimEnd()).toMatch(/^Plain {2,}1\/1$/)
  })

  test('marks the row under the cursor, and only that one', () => {
    shell.handle('tap')
    const rows = shell.view().body.split('\n')

    expect(rows[0]?.startsWith('▶ ')).toBe(true)
    for (const row_ of rows.slice(1)) expect(row_.startsWith('▶ ')).toBe(false)
  })

  test('keeps every row of a list starting at the same pixel', () => {
    shell.handle('tap')
    const rows = shell.view().body.split('\n')

    // The cursor has a column of its own: a row that is not chosen is indented by
    // the room the triangle took, so the words do not jump sideways as it moves.
    for (const row_ of rows) expect(row_.slice(0, 2)).toMatch(/^(▶ | {2})$/)
  })

  test('says where in a list the cursor is', () => {
    shell.handle('tap')
    shell.handle('down')

    // Against the right hand edge, where the page count goes on the note screen: one
    // place on the panel means one thing, whichever screen is up.
    expect(shell.view().head.trimEnd()).toMatch(/^Work {2,}2\/4$/)
  })

  test('steps the cursor over a folder in the sidebar, so every tap opens a note', () => {
    // Every folder in the sidebar is already open, so a tap on one could do nothing
    // at all. Its name still shows, because that is what says where a note lives.
    world.contentRows = [
      row('Inbox', { folder: true, open: true, pick: false }),
      row('Monday standup', { depth: 1 }),
      row('Archive', { folder: true, open: true, pick: false }),
      row('Older', { depth: 1 }),
    ]
    shell.handle('tap')

    // Opens on the first note rather than on the folder above it.
    expect(shell.view().head.trimEnd()).toMatch(/ 2\/4$/)
    shell.handle('down')
    // And steps straight over the second folder to the note under it.
    expect(shell.view().head.trimEnd()).toMatch(/ 4\/4$/)

    shell.handle('tap')
    expect(world.opened).toEqual(['Older'])
  })

  test('scrolls the window only when the cursor would leave it', () => {
    world.contentRows = Array.from({ length: 30 }, (_one, at) => row(`note ${at}`))
    shell.handle('tap')

    expect(shell.view().body.split('\n')[0]).toContain('note 0')
    for (let n = 0; n < 20; n++) shell.handle('down')
    const rows = shell.view().body.split('\n')
    expect(rows).toHaveLength(BODY_ROWS)
    expect(rows.some((one) => one.includes('▶ note 20'))).toBe(true)
  })

  test('says so when a space has nothing in it', () => {
    world.contentRows = []
    shell.handle('tap')

    expect(shell.view().body).toBe('Nothing here')
    // The space's name, and nothing at the right: there is no row to be at.
    expect(shell.view().head).toBe('Work')
  })

  test('lights the corner while the microphone is open', () => {
    expect(shell.view().mic).toBe(' ')
    world.on = true
    expect(shell.view().mic).toBe('●')
  })

  test('cuts a name too long for the panel rather than wrapping it', () => {
    world.contentRows = [row('a note with a name far longer than the panel is wide '.repeat(3))]
    shell.handle('tap')

    expect(shell.view().body.split('\n')).toHaveLength(1)
    expect(shell.view().body).toContain('…')
  })
})

/** The answer view, which is the one screen that scrolls a line at a time. */
describe('an answer from the model', () => {
  // One sentence, a blank line, and then the detail: the shape the model is asked
  // for, and long enough that the reader has to scroll through it.
  const answer = [
    'The short answer.',
    '',
    ...Array.from(
      { length: 10 },
      (_one, at) => `Paragraph ${at} of the detail, with enough words in it to wrap the panel.`,
    ),
  ].join('\n\n')

  test('shows the question over the answer', () => {
    shell.answered('what did I decide', answer)
    const view = shell.view()

    expect(view.head.startsWith('what did I decide')).toBe(true)
    expect(view.body.split('\n')[0]).toBe('The short answer.')
  })

  test('scrolls a line at a time rather than a page', () => {
    shell.answered('q', answer)
    const first = shell.view().body.split('\n')[0]

    shell.handle('down')
    const second = shell.view().body.split('\n')[0]
    expect(second).not.toBe(first)
    // One line, not seven: the second row of the first view is the first of this.
    expect(second).toBe('')
  })

  test('stops at the end of the answer', () => {
    shell.answered('q', answer)
    for (let n = 0; n < 100; n++) shell.handle('down')

    expect(shell.handle('down')).toBe('none')
    expect(shell.view().body.split('\n')).toHaveLength(BODY_ROWS)
  })

  test('says how far down the answer the reader is', () => {
    shell.answered('q', answer)
    const rows = shell.answerRows

    // A panel of rows out of however many the answer came to, against the right
    // hand edge beside the microphone's corner.
    const where = ` ${String(BODY_ROWS)}/${String(rows)}`
    expect(shell.view().head.trimEnd().endsWith(where)).toBe(true)
    expect(rows).toBeGreaterThan(BODY_ROWS)
  })

  test('a double tap closes it, back to the note', () => {
    shell.answered('q', answer)

    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
  })

  test('flows the model’s own line breaks, and keeps its paragraphs', () => {
    // A model hard wraps at whatever width it was trained to; a panel is 560 pixels
    // wide. Read as breaks, its lines are a ragged column of two words a row.
    shell.answered('q', 'One short\nsentence first.\n\nThen a second\nparagraph.')
    const rows = shell.view().body.split('\n')

    expect(rows[0]).toBe('One short sentence first.')
    expect(rows[1]).toBe('')
    expect(rows[2]).toBe('Then a second paragraph.')
  })

  test('says it is thinking while the model is', () => {
    shell.asking('what did I decide')

    // The question in the head, and the waiting where the note's words go: the
    // last line of the panel is the note, so nothing else may sit there.
    expect(shell.view().head).toBe('what did I decide')
    expect(shell.view().body).toBe('Thinking')
  })

  test('says so when the model answered with nothing', () => {
    shell.answered('q', '')

    expect(shell.view().body).toBe('No answer')
  })

  test('wraps an answer too wide for the panel', () => {
    shell.answered('q', 'a '.repeat(300))

    for (const row_ of shell.view().body.split('\n')) {
      expect(row_.length).toBeLessThan(120)
    }
  })
})

/** What a spoken command asks of the shell. */
describe('what a command asks for', () => {
  test('puts a screen up by name', () => {
    shell.show('spaces')
    expect(shell.screen.kind).toBe('spaces')
    shell.show('tree')
    expect(shell.screen.kind).toBe('tree')
  })

  test('closes everything at once, however deep', () => {
    shell.handle('hold')
    shell.handle('tap')

    shell.close()
    expect(shell.screen.kind).toBe('note')
    expect(shell.open).toBe(false)
  })

  test('says whether anything is open, which is what "back" asks', () => {
    expect(shell.open).toBe(false)
    shell.handle('tap')
    expect(shell.open).toBe(true)
  })

  test('goes to a page', () => {
    shell.goToPage(2)
    expect(session.showing?.page).toBe(1)
  })

  test('goes to a line of the note', () => {
    shell.goToLine(7)
    const showing = session.showing

    expect(showing).not.toBeNull()
    expect(showing?.firstLine).toBeLessThanOrEqual(7)
    expect(showing?.lastLine).toBeGreaterThanOrEqual(7)
  })

  test('flashes what it heard in the head, and forgets it', () => {
    shell.flash('Next')
    // A word just heard takes the line for a moment: it is the one thing more
    // urgent than which section you are in.
    expect(shell.view().head.trimEnd()).toMatch(/^Next {2,}1\/\d+$/)

    shell.clearFlash()
    expect(shell.view().head).toContain('THE TITLE')
  })
})

/** The words on the glass, in the reader's language as it stands *now*.
 *
 *  They used to be an object built once, when the bridge connected - and a plugin
 *  reaches the glasses in milliseconds while its interface catalogue is a dynamic
 *  import that lands a moment later. So a German reader read "Settings" over a list
 *  of German rows: the rows are built per render, and the labels were built once,
 *  before the catalogue existed. */
describe('a catalogue that lands after the glasses did', () => {
  test('reaches the panel, with nothing rebuilt and no screen reopened', () => {
    const said = { ...WORDS }
    const session = new Session()
    session.follow({ key: 'a', name: 'A note', text: NOTE }, paging)
    const late = new Shell(new Fake(), () => said, session, new FakeSettings())

    late.handle('hold')
    expect(late.view().body).toContain(WORDS.switchSpace)

    // The catalogue arrives, and the next render is in the reader's language.
    said.switchSpace = 'Raum wechseln'
    said.settings = 'Einstellungen'
    expect(late.view().body).toContain('Raum wechseln')

    // Including the head of a screen opened before it landed.
    late.handle('down')
    late.handle('down')
    late.handle('down')
    late.handle('tap')
    expect(late.view().head).toContain('Einstellungen')
  })
})
