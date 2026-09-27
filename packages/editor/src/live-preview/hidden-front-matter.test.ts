import { history, moveLineUp, selectAll, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { setSearchQuery } from '@codemirror/search'
import {
  Compartment,
  EditorSelection,
  EditorState,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import type { PropertiesMode } from '@nib/markdown/properties'
import { beforeAll, describe, expect, test } from 'vitest'
import { insertFrontMatter } from '../commands'
import { external } from '../external'
import { findExtensions, findTally, loadFind, NO_FIND } from '../find'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import { blockDecorations } from './blocks'
import { dragFreeze } from './dragging'
import {
  hiddenFrontMatter,
  hiddenFrontMatterGuard,
  onThePage,
  propertiesMode,
} from './hidden-front-matter'

/** A note's front matter kept off the page, and everything that has to hold for
 *  "off the page" to be true: the caret stays out of it, nothing typed lands in it,
 *  nothing deleted takes it with it, a search does not find it, and the file keeps it
 *  byte for byte. State-level throughout; the three answers are photographed by
 *  apps/desktop/test/e2e/properties.py. */

const META = '---\nicon: list-checks\n---\n'
const NOTE = `${META}# Groceries\n\nMilk and eggs.\n`
/** The first position the reader can see: the start of the heading. */
const PAGE = META.length
/** The end of the closing fence's own line. */
const FENCE_END = META.length - 1

const shown = new Compartment()

function stateOf(doc: string, cursor = 0, mode?: PropertiesMode): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        history(),
        dragFreeze,
        blockDecorations,
        hiddenFrontMatterGuard,
        shown.of(mode ? propertiesMode.of(mode) : []),
      ],
    }),
  )
}

function run(state: EditorState, command: StateCommand): EditorState {
  let after = state
  command({ state, dispatch: (transaction) => (after = transaction.state) })
  return parsed(after)
}

function typed(state: EditorState, text: string): EditorState {
  return parsed(state.update({ ...state.replaceSelection(text), userEvent: 'input.type' }).state)
}

function updated(state: EditorState, spec: TransactionSpec): EditorState {
  return parsed(state.update(spec).state)
}

/** The block replacements, as the text each stands over and whether it draws a
 *  widget. */
function drawn(state: EditorState): string[] {
  const out: string[] = []
  state.field(blockDecorations).decorations.between(0, state.doc.length, (from, to, value) => {
    const widget = (value.spec as { widget?: object }).widget
    out.push(`${widget ? widget.constructor.name : 'nothing'}:${state.doc.sliceString(from, to)}`)
  })
  return out
}

describe('front matter nobody asked to see', () => {
  test('is hidden by default, as a replacement with nothing in it', () => {
    expect(drawn(stateOf(NOTE))).toEqual([`nothing:${META.slice(0, -1)}`])
    expect(hiddenFrontMatter(stateOf(NOTE))).toEqual({ end: FENCE_END, after: PAGE })
  })

  test('and shown again as rows or as source where the reader asked', () => {
    expect(drawn(stateOf(NOTE, NOTE.length, 'properties'))).toEqual([
      `PropertiesWidget:${META.slice(0, -1)}`,
    ])
    expect(drawn(stateOf(NOTE, NOTE.length, 'source'))).toEqual([])
    expect(hiddenFrontMatter(stateOf(NOTE, 0, 'properties'))).toBeNull()
  })

  test('and the setting redraws it without the note or the caret moving', () => {
    const state = stateOf(NOTE, NOTE.length)
    const after = state.update({ effects: shown.reconfigure(propertiesMode.of('source')) }).state

    expect(drawn(after)).toEqual([])
    expect(after.doc.toString()).toBe(NOTE)
    expect(after.selection.main.head).toBe(NOTE.length)
  })

  test('is not a block whose closing fence is still to be written', () => {
    // The parser reads an unclosed block to the end of the note, and hiding that
    // would hide the note.
    const open = '---\ntitle: half\n\nwords\n'
    expect(drawn(stateOf(open))).toEqual([])
    expect(hiddenFrontMatter(stateOf(open))).toBeNull()
  })

  test('is nothing to hide in a note that has none', () => {
    expect(hiddenFrontMatter(stateOf('# Just words\n'))).toBeNull()
  })

  test('is not hidden without the live preview, which is source mode', () => {
    const state = EditorState.create({
      doc: NOTE,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    })
    expect(hiddenFrontMatter(parsed(state))).toBeNull()
  })
})

describe('the caret', () => {
  test('put anywhere in the hidden lines lands at the start of the page', () => {
    for (const at of [0, 1, 5, FENCE_END]) {
      const state = updated(stateOf(NOTE, NOTE.length), { selection: { anchor: at } })
      expect(state.selection.main.head, String(at)).toBe(PAGE)
    }
  })

  test('selecting up past the top stops at the top of the page', () => {
    const state = updated(stateOf(NOTE, NOTE.length), {
      selection: { anchor: NOTE.length, head: 0 },
    })
    expect(state.selection.main.from).toBe(PAGE)
    expect(state.selection.main.to).toBe(NOTE.length)
  })

  test('Ctrl+A selects what is on the page', () => {
    const all = run(stateOf(NOTE, NOTE.length), selectAll)
    expect(all.selection.main.from).toBe(PAGE)
    expect(all.selection.main.to).toBe(NOTE.length)
  })

  test('is left at 0 on open, and by a transaction that only carries it', () => {
    // A note opens with the caret at 0 and the folds it asks for restate it. Moved,
    // it would stand on the first line and reveal whatever that line hides.
    const state = stateOf(NOTE)
    const carried = updated(state, { selection: state.selection })
    expect(carried.selection.main.head).toBe(0)
  })

  test('is not moved by content arriving from outside', () => {
    const state = stateOf(NOTE, NOTE.length)
    const loaded = updated(state, {
      changes: { from: 0, to: state.doc.length, insert: NOTE },
      selection: { anchor: 0 },
      annotations: external.of(true),
    })
    expect(loaded.selection.main.head).toBe(0)
  })

  test('is free to go anywhere where the front matter is showing', () => {
    const state = updated(stateOf(NOTE, NOTE.length, 'properties'), { selection: { anchor: 5 } })
    expect(state.selection.main.head).toBe(5)
  })
})

describe('an edit by hand', () => {
  test('typed at the caret a note opens with goes where the reader can see it', () => {
    const state = typed(typed(stateOf(NOTE), 'A'), 'b')

    expect(state.doc.toString()).toBe(`${META}Ab# Groceries\n\nMilk and eggs.\n`)
    expect(state.selection.main.head).toBe(PAGE + 2)
  })

  test('pasted there goes there too', () => {
    const state = stateOf(NOTE)
    const after = updated(state, {
      ...state.replaceSelection('Pasted\n'),
      userEvent: 'input.paste',
    })
    expect(after.doc.toString()).toBe(`${META}Pasted\n# Groceries\n\nMilk and eggs.\n`)
  })

  test('in a note that is nothing but its metadata starts a line of its own', () => {
    const bare = '---\nicon: rocket\n---'
    const state = typed(stateOf(bare), 'Hi')
    expect(state.doc.toString()).toBe(`${bare}\nHi`)
    expect(state.selection.main.head).toBe(state.doc.length)
  })

  test('a Backspace at the top of the page joins nothing', () => {
    const state = stateOf(NOTE, NOTE.length)
    const after = updated(state, {
      changes: { from: FENCE_END, to: PAGE },
      userEvent: 'delete.backward',
    })
    expect(after.doc.toString()).toBe(NOTE)
  })

  test('a Delete at 0, which the atomic block stretches over all of it, deletes nothing', () => {
    const after = updated(stateOf(NOTE), {
      changes: { from: 0, to: FENCE_END },
      userEvent: 'delete.forward',
    })
    expect(after.doc.toString()).toBe(NOTE)
  })

  test('a line moved up past the top stays where it is', () => {
    const after = run(stateOf(NOTE, PAGE + 2), moveLineUp)
    expect(after.doc.toString()).toBe(NOTE)
  })

  test('over everything selected keeps the metadata, and Ctrl+Z brings the rest back', () => {
    const all = run(stateOf(NOTE, NOTE.length), selectAll)
    const cleared = updated(all, { ...all.replaceSelection(''), userEvent: 'delete.selection' })
    expect(cleared.doc.toString()).toBe(META)

    const retyped = typed(all, 'New')
    expect(retyped.doc.toString()).toBe(`${META}New`)

    expect(run(cleared, undo).doc.toString()).toBe(NOTE)
  })

  test('undone puts the note back byte for byte', () => {
    const state = typed(stateOf(NOTE), 'A')
    expect(run(state, undo).doc.toString()).toBe(NOTE)
  })

  test('is made as it came where the front matter is showing', () => {
    const state = typed(stateOf(NOTE, 0, 'source'), 'A')
    expect(state.doc.toString()).toBe(`A${NOTE}`)
  })
})

describe('an edit the app makes on purpose', () => {
  test('is left alone: an icon changed, a cover dragged', () => {
    const icon = NOTE.indexOf('list-checks')
    for (const userEvent of [undefined, 'input.cover.position', 'input.property']) {
      const after = updated(stateOf(NOTE), {
        changes: { from: icon, to: icon + 'list-checks'.length, insert: 'rocket' },
        ...(userEvent ? { userEvent } : {}),
      })
      expect(after.doc.toString(), String(userEvent)).toBe(NOTE.replace('list-checks', 'rocket'))
    }
  })
})

describe('inserting front matter while it is hidden', () => {
  test('shows the block it already has, with the caret in it', () => {
    const state = run(stateOf(NOTE, NOTE.length), insertFrontMatter)

    expect(state.selection.main.head).toBe(NOTE.indexOf('\n---'))
    expect(drawn(state)).toEqual([])
    expect(hiddenFrontMatter(state)).toBeNull()

    // Typed into, it stays up.
    const written = typed(state, 's')
    expect(written.doc.toString()).toBe(NOTE.replace('list-checks', 'list-checkss'))
    expect(drawn(written)).toEqual([])
  })

  test('and tucks it away again once the caret leaves', () => {
    const state = run(stateOf(NOTE, NOTE.length), insertFrontMatter)
    const left = updated(state, { selection: { anchor: NOTE.length } })

    expect(drawn(left)).toEqual([`nothing:${META.slice(0, -1)}`])
    expect(left.selection.main.head).toBe(NOTE.length)
  })

  test('and until another note is opened', () => {
    const state = run(stateOf(NOTE, NOTE.length), insertFrontMatter)
    const other = updated(state, {
      changes: { from: 0, to: state.doc.length, insert: NOTE },
      annotations: external.of(true),
    })
    expect(drawn(other)).toEqual([`nothing:${META.slice(0, -1)}`])
  })

  test('shows the block it writes into a note that had none', () => {
    const state = run(stateOf('# Words\n', 8), insertFrontMatter)

    expect(state.doc.toString()).toBe('---\ntitle: \n---\n\n# Words\n')
    expect(state.selection.main.head).toBe('---\ntitle: '.length)
    expect(drawn(state)).toEqual([])
  })
})

describe('find', () => {
  beforeAll(async () => {
    await loadFind()
  })

  test('only finds what is on the page', async () => {
    const { queryFor } = await import('../finding')
    const note = `---\ntags: [milk]\n---\nmilk and more milk\n`
    const looking = (mode?: PropertiesMode) => {
      const base = EditorState.create({
        doc: note,
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          blockDecorations,
          hiddenFrontMatterGuard,
          findExtensions(),
          ...(mode ? [propertiesMode.of(mode)] : []),
        ],
      })
      return parsed(base).update({
        effects: setSearchQuery.of(queryFor({ ...NO_FIND, query: 'milk' })),
      }).state
    }

    expect(findTally(looking()).count).toBe(2)
    expect(findTally(looking('source')).count).toBe(3)
  })

  test('is told which positions are hidden', () => {
    const state = stateOf(NOTE)
    expect(onThePage(state, 5)).toBe(false)
    expect(onThePage(state, PAGE)).toBe(true)
    expect(onThePage(stateOf(NOTE, 0, 'properties'), 5)).toBe(true)
  })
})
