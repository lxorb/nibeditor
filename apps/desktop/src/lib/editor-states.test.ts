import {
  documentOf,
  editorState,
  EditorState,
  HeldState,
  SharedDoc,
  StateEffect,
  type StateView,
  type TransactionSpec,
} from '@nib/editor'
import { describe, expect, test } from 'vitest'
import { EditorStates, type NoteTab } from './editor-states'

/** Stands in for a scroll snapshot; see held.test.ts in the editor package. */
const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

/** A pane's view without a DOM: the state it holds, and where it is scrolled. */
class Surface implements StateView {
  state = EditorState.create({})
  at = 0
  /** The element that scrolls, as far as a swap looks at it. */
  readonly scrollDOM = { scrollTop: 0 }
  /** How many transactions it has been handed. A switch should cost one. */
  transactions = 0

  setState(next: EditorState) {
    this.state = next
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    this.transactions++

    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }

  /** What the editor does with a keystroke: applies it, then hands the change to
   *  the document this view is on. See the update listener in editor.ts. */
  type(insert: string) {
    const at = this.state.doc.length
    const made = this.state.update({ changes: { from: at, insert }, userEvent: 'input.type' })

    this.state = made.state
    documentOf(this)?.local(made.changes, made.state.selection, this)
  }
}

/** A tab, as much of one as a pane's states read: the document it is a view of,
 *  and how many notes that document has held. */
class Tab implements NoteTab {
  note: { live: SharedDoc; arrivals: number }

  constructor(text: string) {
    this.note = { live: new SharedDoc(text), arrivals: 0 }
  }

  /** The one tab that previews a note, moving on to another one; see
   *  `NoteDoc.adopt` in workspace/documents.svelte.ts. */
  adopt(text: string) {
    this.note.arrivals++
    this.note.live.takeOn(text)
  }

  /** The state a pane builds the first time it shows this tab. */
  state(): HeldState {
    return HeldState.waiting(this.note.live, editorState({ shared: this.note.live }))
  }
}

/** The invariant, asked after every gesture: the view is on exactly one note, and
 *  what it is holding is that note's words. */
function shows(view: Surface, tab: Tab) {
  expect(documentOf(view)).toBe(tab.note.live)
  expect(view.state.doc.toString()).toBe(tab.note.live.text.toString())
}

describe('the states a pane keeps', () => {
  test('builds one the first time it shows a note and keeps it after that', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    expect(states.show(view, alpha, () => alpha.state())).toBe(true)
    expect(states.show(view, beta, () => beta.state())).toBe(true)
    expect(states.show(view, alpha, () => alpha.state())).toBe(false)

    expect(states.count).toBe(2)
    shows(view, alpha)
  })

  test('a note switched away from and back to keeps its place', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('one\ntwo\nthree')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    view.at = 8
    states.show(view, beta, () => beta.state())
    shows(view, beta)

    states.show(view, alpha, () => alpha.state())

    shows(view, alpha)
    expect(view.at).toBe(8)
  })

  test('a note not on show still hears every change made to it', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    states.show(view, beta, () => beta.state())

    // A rename rewrites the title of a note nobody is looking at.
    alpha.note.live.replace('Alpha renamed')
    states.show(view, alpha, () => alpha.state())

    shows(view, alpha)
    expect(view.state.doc.toString()).toBe('Alpha renamed')
  })

  test('a tab that closes lets its document go', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    states.show(view, beta, () => beta.state())
    expect(alpha.note.live.panes).toBe(1)

    states.keepOnly([beta])

    expect(states.count).toBe(1)
    expect(alpha.note.live.panes).toBe(0)
  })

  test('the note on show stays even when the list forgets to mention it', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')

    states.show(view, alpha, () => alpha.state())
    states.keepOnly([])

    expect(states.count).toBe(1)
    expect(states.shows(alpha)).toBe(true)
  })

  test('a note closed and opened again is built afresh, at the top', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('one\ntwo\nthree')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    view.at = 8
    states.show(view, beta, () => beta.state())
    states.keepOnly([beta])

    // Reopened, the tab is a new tab, so nothing of the old one is in the way;
    // where it was being read is the app's to remember.
    const again = new Tab('one\ntwo\nthree')
    view.at = 0
    expect(states.show(view, again, () => again.state())).toBe(true)
    expect(view.at).toBe(0)
  })

  test('what a state is dressed for is remembered against its tab', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    expect(states.fitted(alpha)).toBeUndefined()

    states.show(view, alpha, () => alpha.state())
    states.fit(alpha, 'modes and keys')

    expect(states.fitted(alpha)).toBe('modes and keys')

    states.show(view, beta, () => beta.state())
    states.keepOnly([beta])

    // The tab has gone, and everything remembered about it with it.
    expect(states.fitted(alpha)).toBeUndefined()
  })

  test('the note the view was built on is settled once, not on every look', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('one\ntwo\nthree')
    // What `createEditor` does: the view is built on the note and joins it.
    view.setState(editorState({ shared: alpha.note.live }))
    alpha.note.live.join(view)
    view.transactions = 0

    states.started(alpha, view, scrolledTo.of(8))
    states.show(view, alpha, () => alpha.state())
    expect(view.at).toBe(8)
    expect(view.transactions).toBe(1)

    // A reader who has scrolled on since is not dragged back to where they came
    // in by an effect running again.
    view.at = 40
    states.show(view, alpha, () => alpha.state())

    expect(view.at).toBe(40)
    expect(view.transactions).toBe(1)
  })

  test('a pane that goes lets go of everything it held, the view included', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    states.show(view, beta, () => beta.state())
    states.releaseAll(view)

    expect(states.count).toBe(0)
    expect(documentOf(view)).toBeNull()
    expect(alpha.note.live.panes).toBe(0)
    expect(beta.note.live.panes).toBe(0)
  })
})

/** What a state is kept under, and why it has to be the tab and the note rather
 *  than a name spelled out of the two.
 *
 *  A pane used to key its states by `${tab.id} ${tab.note.arrivals}`, a string
 *  built afresh by whoever was asking. Two callers spelling it differently - or
 *  one of them reading it a moment after the other - meant the pane looking for a
 *  state under a name nothing had put anything under, and the note the view was
 *  actually holding was then nobody's to take back. */
describe('which note a state is a state of', () => {
  test('a note renamed is still the same note', () => {
    const states = new EditorStates()
    const view = new Surface()
    const tab = new Tab('# Draft')

    states.show(view, tab, () => tab.state())
    // Renaming rewrites the title and moves the file; the tab and the document
    // are the ones that were there before.
    tab.note.live.replace('# Named')

    expect(states.shows(tab)).toBe(true)
    expect(states.show(view, tab, () => tab.state())).toBe(false)
    expect(states.count).toBe(1)
  })

  test('the preview moving on to another note is another note', () => {
    const states = new EditorStates()
    const view = new Surface()
    const preview = new Tab('First')
    const kept = new Tab('Kept')

    states.show(view, preview, () => preview.state())
    view.at = 4
    states.show(view, kept, () => kept.state())

    // A click in the file list: the same tab, another note.
    preview.adopt('Second')
    // Half way down whatever was last in the scroller, which the note arriving
    // has to undo: nobody has read this one.
    view.scrollDOM.scrollTop = 1200
    expect(states.show(view, preview, () => preview.state())).toBe(true)

    shows(view, preview)
    expect(view.state.doc.toString()).toBe('Second')
    // The place the note it came from was being read at does not follow it here.
    expect(view.scrollDOM.scrollTop).toBe(0)
    // And the state that was the note it came from's is gone, rather than left
    // holding the document.
    expect(states.count).toBe(2)
    expect(preview.note.live.panes).toBe(1)
  })

  test('the preview moving on while it is the note on show is another note', () => {
    const states = new EditorStates()
    const view = new Surface()
    const preview = new Tab('First')

    states.show(view, preview, () => preview.state())
    preview.adopt('Second')

    expect(states.shows(preview)).toBe(false)
    expect(states.show(view, preview, () => preview.state())).toBe(true)

    shows(view, preview)
    expect(states.count).toBe(1)
    expect(preview.note.live.panes).toBe(1)
  })

  test('two tabs on one note are two states of it', () => {
    const states = new EditorStates()
    const view = new Surface()
    const note = new SharedDoc('Shared')
    const here: Tab = Object.assign(new Tab(''), { note: { live: note, arrivals: 0 } })
    const there: Tab = Object.assign(new Tab(''), { note: { live: note, arrivals: 0 } })

    states.show(view, here, () => here.state())
    states.show(view, there, () => there.state())

    expect(states.count).toBe(2)
    shows(view, there)
  })
})

/** The sequences a reader actually makes, with the invariant asked after each
 *  one: the view is on the note its tab names, and on nothing else.
 *
 *  Emil, on the desktop app: *"I switch to a different note and then for some
 *  reason it gets some random useless content ... switched from a web note tab to
 *  a normal note tab and then it had some strange web note tab content in it."*
 *  A web tab's words are its shortcut file, and the file is rewritten as the
 *  reading moves on - so a view left on it is a note wearing `[InternetShortcut]`
 *  and saving it under its own name. */
describe('a pane switching between notes', () => {
  test('a website and a note, back and forth', () => {
    const states = new EditorStates()
    const view = new Surface()
    const note = new Tab('# The note')
    const site = new Tab('[InternetShortcut]\nURL=https://a.example\n')

    states.show(view, note, () => note.state())
    shows(view, note)

    states.show(view, site, () => site.state())
    shows(view, site)

    states.show(view, note, () => note.state())
    shows(view, note)

    // The reading moved on, so the shortcut is rewritten under the website's name.
    site.note.live.replace('[InternetShortcut]\nURL=https://b.example\n', false)

    shows(view, note)
    expect(view.state.doc.toString()).toBe('# The note')
  })

  test('a tab dragged into another pane leaves this one on its own note', () => {
    const left = new EditorStates()
    const right = new EditorStates()
    const here = new Surface()
    const there = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    left.show(here, alpha, () => alpha.state())
    left.show(here, beta, () => beta.state())

    // Beta is dragged across, and the pane it came from falls back to Alpha.
    left.show(here, alpha, () => alpha.state())
    left.keepOnly([alpha])
    right.show(there, beta, () => beta.state())
    right.keepOnly([beta])

    shows(here, alpha)
    shows(there, beta)
    expect(beta.note.live.panes).toBe(1)
    expect(alpha.note.live.panes).toBe(1)
  })

  test('the same note in two panes is one note with two views', () => {
    const left = new EditorStates()
    const right = new EditorStates()
    const here = new Surface()
    const there = new Surface()
    const note = new SharedDoc('Shared')
    const one: Tab = Object.assign(new Tab(''), { note: { live: note, arrivals: 0 } })
    const two: Tab = Object.assign(new Tab(''), { note: { live: note, arrivals: 0 } })

    left.show(here, one, () => one.state())
    right.show(there, two, () => two.state())

    expect(note.panes).toBe(2)
    shows(here, one)
    shows(there, two)
  })

  /** Nothing owns "one document per file".
   *
   *  `workspace.open` looks for a tab already on the path, then awaits the file
   *  before it makes the document, and nothing says an open is in flight - so two
   *  opens of one path a moment apart make two documents of it, each with its own
   *  words, its own history and its own saver. `openWeb` has the same shape.
   *
   *  A pane cannot put that right and does not pretend to: what is asserted here is
   *  what the reader is left looking at, so that whoever holds the open documents
   *  can see what it has to guarantee. */
  test('two documents over one file are two notes wearing one name', () => {
    const states = new EditorStates()
    const view = new Surface()
    // Both from the same file, read twice.
    const first = new Tab('# The note\n')
    const second = new Tab('# The note\n')

    const written: string[] = []
    first.note.live.onChange = (doc) => written.push(doc.toString())
    second.note.live.onChange = (doc) => written.push(doc.toString())

    states.show(view, first, () => first.state())
    view.type('written here\n')
    states.show(view, second, () => second.state())
    view.type('and written there\n')

    // The pane is honest about both: each tab holds its own document's words, and
    // the view is only ever on one of them.
    expect(documentOf(view)).toBe(second.note.live)
    expect(first.note.live.text.toString()).toBe('# The note\nwritten here\n')
    expect(second.note.live.text.toString()).toBe('# The note\nand written there\n')

    // And that is the damage: one file, two sets of words, each reported as the
    // file's own, and whichever is written last is what the file ends up saying.
    expect(written).toEqual(['# The note\nwritten here\n', '# The note\nand written there\n'])
  })

  test('closing the tab that is showing leaves the view on the next note', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')

    states.show(view, alpha, () => alpha.state())
    states.show(view, beta, () => beta.state())
    // Beta closes, so the pane falls back to Alpha and lets Beta's state go.
    states.show(view, alpha, () => alpha.state())
    states.keepOnly([alpha])

    shows(view, alpha)
    expect(beta.note.live.panes).toBe(0)
    expect(states.count).toBe(1)
  })
})
