import { history, undoDepth } from '@codemirror/commands'
import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { type DocView, documentOf, fromInput, letGo, SharedDoc, sharedOf, sharing } from './shared'

/** A view without a DOM: the state a pane holds, and the dispatch a document
 *  reaches it through. The extensions are the two the document needs from a
 *  view, so the history asserted about below is the real one. */
class Pane implements DocView {
  private held: EditorState

  constructor(note: SharedDoc, cursor = 0) {
    this.held = EditorState.create({
      doc: note.text,
      selection: EditorSelection.cursor(cursor),
      extensions: [history(), sharing()],
    })
    note.join(this)
  }

  get state(): EditorState {
    return this.held
  }

  dispatch(spec: TransactionSpec) {
    this.held = this.held.update(spec).state
  }

  get text(): string {
    return this.held.doc.toString()
  }

  get caret(): number {
    return this.held.selection.main.head
  }

  /** What the editor does with an edit: applies it, then hands the change over to
   *  the document this view is on. See the update listener in editor.ts, which
   *  does exactly this - and asks which document the same way. */
  edit(changes: ChangeSpec, cursor: number) {
    const made = this.held.update({
      changes,
      selection: EditorSelection.cursor(cursor),
      userEvent: 'input.type',
    })

    this.held = made.state
    documentOf(this)?.local(made.changes, made.state.selection, this)
  }

  type(at: number, insert: string) {
    this.edit({ from: at, insert }, at + insert.length)
  }
}

describe('a document in two panes', () => {
  test('carries a change from one pane into the other', () => {
    const note = new SharedDoc('Hello')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(5, ' there')

    expect(note.text.toString()).toBe('Hello there')
    expect(right.text).toBe('Hello there')
    expect(left.text).toBe('Hello there')
  })

  test('leaves the other pane’s caret where it was', () => {
    const note = new SharedDoc('one two')
    const left = new Pane(note)
    const right = new Pane(note, 7)

    left.type(0, 'zero ')

    // Five characters went in ahead of it, so the same place in the text is
    // five further along. What must not happen is that caret following the
    // typing, which is what replacing the text would have done.
    expect(right.caret).toBe(12)
    expect(left.caret).toBe(5)
  })

  test('says the note changed once per change', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    const heard: string[] = []
    note.onChange = (doc) => heard.push(doc.toString())

    left.type(0, 'a')
    right.type(1, 'b')

    expect(heard).toEqual(['a', 'ab'])
  })

  test('records nothing in either pane’s own history', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'typed')

    expect(undoDepth(left.state)).toBe(0)
    expect(undoDepth(right.state)).toBe(0)
  })

  test('undoes the last edit whichever pane asks', () => {
    // Far apart on purpose: two edits typed next to each other within the
    // moment are one thing done, and CodeMirror's history undoes them together.
    const note = new SharedDoc('one two')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'L')
    right.type(8, 'R')
    expect(note.text.toString()).toBe('Lone twoR')

    // Typed in the right pane, undone from the left: one history.
    expect(note.undo(left)).toBe(true)
    expect(left.text).toBe('Lone two')
    expect(right.text).toBe('Lone two')

    expect(note.undo(right)).toBe(true)
    expect(note.text.toString()).toBe('one two')
  })

  test('puts an undone edit back', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'words')
    note.undo(right)
    expect(note.redo(right)).toBe(true)

    expect(left.text).toBe('words')
    expect(right.text).toBe('words')
  })

  test('answers no when there is nothing left to undo', () => {
    const note = new SharedDoc('as it was')
    const only = new Pane(note)

    expect(note.undo(only)).toBe(false)
    expect(note.redo(only)).toBe(false)
    expect(only.text).toBe('as it was')
  })

  test('takes the caret to the undone edit in the pane that asked', () => {
    const note = new SharedDoc('start')
    const left = new Pane(note)
    const right = new Pane(note)

    // Two edits far enough apart to be two things done rather than one.
    left.type(0, 'A')
    left.type(6, 'B')
    expect(right.caret).toBe(0)

    note.undo(right)

    // The pane that asked lands on the edit that went away. The other keeps
    // its own caret, mapped back through the change rather than moved by it.
    expect(right.caret).toBe(1)
    expect(left.caret).toBe(6)
    expect(right.text).toBe('Astart')
  })

  test('stops carrying changes to a pane that has left', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    note.leave(right)
    left.type(0, 'after')

    expect(note.panes).toBe(1)
    expect(right.text).toBe('')
    expect(left.text).toBe('after')
  })

  test('brings a joining pane to the text the document holds', () => {
    const note = new SharedDoc('first')
    const left = new Pane(note)
    left.type(5, ' words')

    const late = new Pane(note)

    expect(late.text).toBe('first words')
    expect(note.panes).toBe(2)
  })

  test('tells every pane which document it is looking at', () => {
    const note = new SharedDoc('')
    const only = new Pane(note)

    expect(sharedOf(only.state)).toBe(note)
  })

  test('puts text from outside into every pane', () => {
    const note = new SharedDoc('old')
    const left = new Pane(note)
    const right = new Pane(note)

    note.replace('restored')

    expect(left.text).toBe('restored')
    expect(right.text).toBe('restored')
    expect(note.text.toString()).toBe('restored')
  })

  test('takes an edit from outside as an edit, so no caret is swept away', () => {
    const note = new SharedDoc('alpha here\nalpha there\n')
    // A caret near the end of the note, which is what a whole-text replacement
    // would leave sitting at the end of the new text instead.
    const only = new Pane(note, 22)

    note.edit([
      { from: 0, to: 5, insert: 'beta' },
      { from: 11, to: 16, insert: 'beta' },
    ])

    expect(only.text).toBe('beta here\nbeta there\n')
    expect(only.caret).toBe(20)
    expect(note.text.toString()).toBe('beta here\nbeta there\n')
  })

  test('an edit from outside reaches every pane', () => {
    const note = new SharedDoc('alpha')
    const left = new Pane(note)
    const right = new Pane(note)

    note.edit([{ from: 0, to: 5, insert: 'beta' }])

    expect(left.text).toBe('beta')
    expect(right.text).toBe('beta')
  })

  test('carries a deletion as a deletion', () => {
    const note = new SharedDoc('keep this word')
    const left = new Pane(note)
    const right = new Pane(note, 14)

    left.edit({ from: 4, to: 9 }, 4)

    expect(right.text).toBe('keep word')
    expect(right.caret).toBe(9)
    expect(note.text.toString()).toBe('keep word')
  })
})

describe('a document with one pane', () => {
  test('is still the one place the words live', () => {
    const note = new SharedDoc('alone')
    const only = new Pane(note)

    only.type(5, '!')

    expect(note.text.toString()).toBe('alone!')
    expect(note.panes).toBe(1)
  })
})

/** A view looks at one note at a time, and the documents are what make that true.
 *
 *  Emil, on the desktop app: *"I switch to a different note and then for some
 *  reason it gets some random useless content ... switched from a web note tab to
 *  a normal note tab and then it had some strange web note tab content in it."*
 *  That is a view left on the note it came from: the note it came from goes on
 *  carrying its changes into it, and those words are then the note that is up,
 *  under that note's name, on their way to the disk and to every other device.
 *
 *  It used to take one forgotten `leave` anywhere in the pane's swap. Now a join
 *  is the only way in and it takes the view off whatever it was on, so there is
 *  nothing anybody can forget. */
describe('a view looks at one note at a time', () => {
  test('joining a second document takes it off the first', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('the website')
    const view = new Pane(here)

    there.join(view)

    expect(documentOf(view)).toBe(there)
    expect(here.panes).toBe(0)
    expect(there.panes).toBe(1)
  })

  test('the note it came from no longer reaches it', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('[InternetShortcut]\nURL=https://a.example\n')
    const view = new Pane(here)

    there.join(view)
    // The reading moved on, so the shortcut is rewritten under the website's name.
    there.replace('[InternetShortcut]\nURL=https://b.example\n')
    // And the note it came from is edited too, from another pane or a sync.
    here.replace('the note, changed')

    expect(view.text).toBe('[InternetShortcut]\nURL=https://b.example\n')
  })

  test('a keystroke goes to the document the view is on', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('the website')
    const view = new Pane(here)

    there.join(view)
    view.type(view.text.length, '!')

    expect(there.text.toString()).toBe('the website!')
    expect(here.text.toString()).toBe('the note')
  })

  test('a state that still names a document it has left is not believed', () => {
    const note = new SharedDoc('the note')
    const view = new Pane(note)
    // What a swap leaves behind: the view is off the document, and the state it
    // is holding still says the document's name.
    note.leave(view)
    expect(sharedOf(view.state)).toBe(note)
    expect(documentOf(view)).toBeNull()

    // Meanwhile the note is written to by the other pane it is open in.
    note.replace('the note, changed')
    expect(view.text).toBe('the note')

    // Coming back to it brings it up to the words rather than trusting the claim.
    note.join(view)
    expect(view.text).toBe('the note, changed')
  })

  test('letting a view go takes it off whatever it was on', () => {
    const note = new SharedDoc('the note')
    const view = new Pane(note)

    letGo(view)

    expect(documentOf(view)).toBeNull()
    expect(note.panes).toBe(0)
  })

  test('joining the document it is already on costs nothing and says nothing', () => {
    const note = new SharedDoc('the note')
    const view = new Pane(note)
    const before = view.state

    note.join(view)

    // The very same state: a view that has been following has had every change
    // there was, so there is nothing to tell it.
    expect(view.state).toBe(before)
    expect(note.panes).toBe(1)
  })
})

/** The swap a pane makes on every switch, asked of the document rather than of
 *  the two halves separately; see held.ts, which is what calls it. */
describe('a document changing hands', () => {
  test('moves from the one that was following to the one taking over', () => {
    const note = new SharedDoc('the note')
    const was = new Pane(note)
    const now = new Pane(note)
    note.leave(now)

    note.handOver(was, now, () => undefined)

    expect(documentOf(was)).toBeNull()
    expect(documentOf(now)).toBe(note)
    expect(note.panes).toBe(1)
  })

  test('takes the one taking over off whatever it was on', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('the website')
    const was = new Pane(here)
    const now = new Pane(there)

    here.handOver(was, now, () => undefined)

    expect(documentOf(now)).toBe(here)
    expect(there.panes).toBe(0)
  })

  test('brings the words over where the one leaving was not following', () => {
    const note = new SharedDoc('the note')
    const was = new Pane(note)
    note.leave(was)
    // Nobody was following, so whoever takes over is a newcomer and is brought up
    // to the words like any other.
    const now = new Pane(note)
    note.leave(now)
    note.replace('the note, changed')

    note.handOver(was, now, () => undefined)

    expect(now.text).toBe('the note, changed')
  })
})

/** A Mac's Cmd+Z never reaches the page as a key: the Edit menu in the menu bar
 *  holds it, and sends the page a `beforeinput` of `historyUndo` instead, as a
 *  browser's own Edit menu does. The library answers that from the pane's own
 *  history, which holds nothing (see above), so the key undid nothing at all. */
describe('an undo that arrives as input rather than as a key', () => {
  test('undoes and redoes the document’s own history', () => {
    const note = new SharedDoc('Hello')
    const pane = new Pane(note)
    pane.type(5, ' there')

    // A pane here is the part of a view the commands read, which is all of a view
    // `undoEdit` touches.
    const view = pane as unknown as EditorView
    expect(fromInput('historyUndo')?.(view)).toBe(true)
    expect(pane.text).toBe('Hello')
    expect(fromInput('historyRedo')?.(view)).toBe(true)
    expect(pane.text).toBe('Hello there')
  })

  test('and nothing else typed is one', () => {
    expect(fromInput('insertText')).toBeNull()
    expect(fromInput('deleteContentBackward')).toBeNull()
  })
})

/** Something that read the note a moment ago - a replacement across the space, an
 *  agent's edit - landing on the words as they are now. What it was worked out
 *  against is words the document held; what it lands on may have a keystroke more. */
describe('edits carried onto the words as they are now', () => {
  test('land where they meant after the reader typed before them', () => {
    const note = new SharedDoc('the plan for monday')
    const pane = new Pane(note)
    pane.type(0, 'Re: ')

    const edits = note.carried([{ from: 13, to: 16, insert: 'tues' }], 'the plan for monday')

    expect(edits).toEqual([{ from: 17, to: 20, insert: 'tues' }])
  })

  test('and through every change since, whoever made it', () => {
    const note = new SharedDoc('one two three')
    const pane = new Pane(note)
    pane.type(0, 'zero ')
    note.arrived([{ from: 8, to: 8, insert: ' and a half' }])
    note.edit([{ from: 0, to: 4, insert: 'nil' }])

    const edits = note.carried([{ from: 8, to: 13, insert: 'THREE' }], 'one two three')

    expect(edits).toEqual([{ from: 23, to: 28, insert: 'THREE' }])
    expect(note.text.toString()).toBe('nil one and a half two three')
  })

  test('keep a keystroke made at the very place they change, before them', () => {
    const note = new SharedDoc('ab')
    const pane = new Pane(note)
    pane.type(1, 'X')

    const edits = note.carried([{ from: 1, to: 1, insert: 'Y' }], 'ab') ?? []
    note.edit(edits)

    expect(note.text.toString()).toBe('aXYb')
  })

  test('come back unchanged where nothing moved', () => {
    const note = new SharedDoc('same')

    expect(note.carried([{ from: 0, to: 4, insert: 'new' }], 'same')).toEqual([
      { from: 0, to: 4, insert: 'new' },
    ])
  })

  test('are refused for words the document never held, unless it may guess', () => {
    const note = new SharedDoc('the plan for monday!')

    expect(note.carried([{ from: 0, to: 3, insert: 'a' }], 'the plan for monday')).toBeNull()
    // The one span the two differ by is at the end, clear of the edit.
    expect(note.carried([{ from: 0, to: 3, insert: 'a' }], 'the plan for monday', true)).toEqual([
      { from: 0, to: 3, insert: 'a' },
    ])
  })

  test('and forgotten when the document takes another note on', () => {
    const note = new SharedDoc('first note')
    note.edit([{ from: 0, to: 0, insert: '# ' }])
    note.takeOn('second note')

    expect(note.since('first note')).toBeNull()
    expect(note.since('second note')?.empty).toBe(true)
  })

  test('remembered for hundreds of keystrokes, and no further', () => {
    const note = new SharedDoc('')
    const pane = new Pane(note)
    for (let at = 0; at < 1000; at++) pane.type(at, 'x')

    expect(note.since('x'.repeat(700))?.length).toBe(700)
    expect(note.since('')).toBeNull()
  })
})

/** What an agent's edit is in a note somebody is writing in: a step of its own in
 *  the reader's Ctrl+Z, named, and heard by whoever is keeping track of it - which
 *  is how "undo the agent's edits" knows what the reader has already taken back. */
describe('an edit from outside, as a step of its own', () => {
  test('is one Ctrl+Z, apart from the typing either side of it', () => {
    const note = new SharedDoc('one')
    const pane = new Pane(note)
    pane.type(3, ' two')
    note.edit([{ from: 0, to: 0, insert: 'AGENT ' }], { userEvent: 'agent' })
    pane.type(13, ' three')

    const view = pane as unknown as EditorView
    fromInput('historyUndo')?.(view)
    expect(pane.text).toBe('AGENT one two')
    fromInput('historyUndo')?.(view)
    expect(pane.text).toBe('one two')
    fromInput('historyUndo')?.(view)
    expect(pane.text).toBe('one')
  })

  test('is heard with its marks, and so is the Ctrl+Z that takes it back', () => {
    const note = new SharedDoc('one')
    const pane = new Pane(note)
    const heard: string[] = []
    note.listen(({ by, marks }) => {
      heard.push(`${by}${marks.map((mark) => ` ${mark.id}:${String(mark.undone)}`).join('')}`)
    })

    note.edit([{ from: 3, to: 3, insert: '!' }], {
      userEvent: 'agent',
      marks: [{ id: 'a1', undone: false }],
    })
    const view = pane as unknown as EditorView
    fromInput('historyUndo')?.(view)
    fromInput('historyRedo')?.(view)

    expect(heard).toEqual(['outside a1:false', 'reader a1:true', 'reader a1:false'])
  })

  test('and stops being heard when asked', () => {
    const note = new SharedDoc('one')
    const heard: string[] = []
    const stop = note.listen(({ by }) => void heard.push(by))

    note.edit([{ from: 0, to: 0, insert: '>' }])
    stop()
    note.edit([{ from: 0, to: 0, insert: '>' }])

    expect(heard).toEqual(['outside'])
  })
})

/** Where the reader has been writing lately, which an agent's edit asks before it
 *  goes there; see docs/agent-native.md 8.3. */
describe('where the reader typed lately', () => {
  test('is where their keystrokes are now, carried through what came after', () => {
    const note = new SharedDoc('one two')
    const pane = new Pane(note)
    pane.type(7, '!')
    note.edit([{ from: 0, to: 0, insert: '>> ' }])

    expect(note.touchedWithin(2000)).toEqual([{ from: 10, to: 11 }])
    expect(note.readerAt).not.toBeNull()
  })

  test('and nothing once it is longer ago than asked', () => {
    const note = new SharedDoc('one')
    const pane = new Pane(note)
    pane.type(3, '!')

    expect(note.touchedWithin(2000, Date.now() + 5000)).toEqual([])
  })

  test('counts nothing somebody else wrote', () => {
    const note = new SharedDoc('one')
    note.edit([{ from: 0, to: 0, insert: '>' }])
    note.arrived([{ from: 0, to: 0, insert: '<' }])

    expect(note.touchedWithin(2000)).toEqual([])
    expect(note.readerAt).toBeNull()
  })
})
