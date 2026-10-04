import { history, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@nib/markdown/edits'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { tickLines } from '../task-tick'
import { noteIndex, type TaskHelp } from '../wikilink/notes'
import { buildDecorations, loadTaskChips } from './decorate'
import { chipsOf, TaskChipsWidget } from './task-chips'
import { takeHint, taskHint } from './task-hint'

/** A task line in a note: its fields hidden like marks and said again as chips, the
 *  source back with the caret on its line (docs/tasks.md 5.7); a box ticked the way the
 *  engine ticks, as one undo; and a date typed at the end offered for Tab. */

beforeAll(async () => {
  await loadTaskChips()
})

/** A stand-in for the app's help: a recurring task's tick written by hand, the way
 *  occurrence.ts in @nib/bases writes it, and `tomorrow` read as a day. */
const HELP: TaskHelp = {
  tick(note, line) {
    const lines = note.split('\n')
    const text = lines[line] ?? ''
    const from = lines.slice(0, line).reduce((sum, one) => sum + one.length + 1, 0)
    const box = text.indexOf('[ ]') + 1
    const edits: TextEdit[] = []
    if (text.includes('🔁')) {
      edits.push({ from, to: from, insert: `${text.replace('2026-10-05', '2026-10-12')}\n` })
    }
    edits.push({ from: from + box, to: from + box + 1, insert: 'x' })
    edits.push({ from: from + text.length, to: from + text.length, insert: ' ✅ 2026-10-07' })
    return Promise.resolve(edits)
  },
  pick: () => undefined,
  dayAtEnd(text) {
    const at = text.lastIndexOf('tomorrow')
    if (at === -1 || at + 'tomorrow'.length !== text.trimEnd().length) return null
    return { from: at, due: '2026-10-08', label: 'Tomorrow' }
  },
}

function stateOf(doc: string, cursor: number, help: TaskHelp | null = null) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        history(),
        taskHint,
        ...(help
          ? [
              noteIndex.of({
                notes: [],
                files: [],
                path: null,
                read: () => Promise.resolve(null),
                tasks: help,
              }),
            ]
          : []),
      ],
    }),
  )
}

/** The words the reader does not see. */
function hidden(state: EditorState): string[] {
  const out: string[] = []
  buildDecorations(state).atomic.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

/** Whether chips are drawn after the line. */
function chipsDrawn(state: EditorState): boolean {
  let found = false
  buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
    if (value.spec.widget instanceof TaskChipsWidget) found = true
  })
  return found
}

/** A view that is only a state and a dispatch, which is all the tick and the hint use. */
function viewOf(state: EditorState) {
  const view = {
    state,
    sent: [] as Transaction[],
    dispatch(spec: Transaction | TransactionSpec) {
      // A command hands a transaction, the tick and the hint a spec, as a view takes both.
      const transaction = spec instanceof Transaction ? spec : view.state.update(spec)
      view.sent.push(transaction)
      view.state = transaction.state
    },
  }
  return view
}

const LINE = '- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 2026-10-06'
const PARKED = `${LINE}\n\nwords`

describe("a task's fields", () => {
  test('are hidden like marks while the caret is elsewhere, the tag kept', () => {
    const shown = hidden(stateOf(PARKED, PARKED.length))
    expect(shown).toEqual(expect.arrayContaining([' [time:: 16:00]', ' ⏫', ' 📅 2026-10-06']))
    expect(shown.join('')).not.toContain('#admin')
    expect(chipsDrawn(stateOf(PARKED, PARKED.length))).toBe(true)
  })

  test('and are the source again with the caret on the line, with no chips', () => {
    const state = stateOf(PARKED, 10)
    expect(hidden(state).join('')).not.toContain('📅')
    expect(chipsDrawn(state)).toBe(false)
  })

  test("every task line but the caret's gets its own", () => {
    const two = '- [ ] Call mum tomorrow #family 🔺\n- [ ] Pay rent ⏫ 📅 2026-10-09\n'
    let drawn = 0
    const state = stateOf(two, 0)
    buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget instanceof TaskChipsWidget) drawn++
    })
    expect(drawn).toBe(1)
    expect(hidden(state)).toEqual(expect.arrayContaining([' ⏫', ' 📅 2026-10-09']))
  })

  test('a task with no field draws nothing extra', () => {
    const plain = '- [ ] Water the plants\n\nwords'
    expect(chipsDrawn(stateOf(plain, plain.length))).toBe(false)
  })
})

describe('the chips', () => {
  test('say the day, the rule, the flag, the bell and the length, in that order', () => {
    const chips = chipsOf(
      {
        text: 'x',
        status: ' ',
        done: false,
        cancelled: false,
        due: '2026-10-06',
        time: '16:00',
        recurrence: 'every week',
        priority: 1,
        remind: [{ before: 15 }],
        duration: 90,
        tags: [],
        dependsOn: [],
        fields: {},
      },
      '2026-10-01',
    )
    expect(chips.map((chip) => chip.field)).toEqual([
      'date',
      'recurrence',
      'priority',
      'remind',
      'duration',
    ])
    expect(chips.find((chip) => chip.field === 'duration')?.text).toBe('⏱ 1h30m')
    expect(chips.find((chip) => chip.field === 'priority')?.tone).toBe('p1')
  })

  test('mark a day gone by as overdue, and not a done one', () => {
    const base = {
      text: 'x',
      status: ' ',
      done: false,
      cancelled: false,
      due: '2026-09-30',
      priority: 4 as const,
      remind: [],
      tags: [],
      dependsOn: [],
      fields: {},
    }
    expect(chipsOf(base, '2026-10-01')[0]?.tone).toBe('overdue')
    expect(chipsOf({ ...base, done: true }, '2026-10-01')[0]?.tone).toBeUndefined()
  })
})

describe('a box ticked', () => {
  test('writes the next occurrence and the done line as one transaction, one undo', async () => {
    const note = '- [ ] Gym 🔁 every week 📅 2026-10-05\n'
    const view = viewOf(stateOf(note, note.length, HELP))
    await tickLines(view as unknown as EditorView, HELP, [1])

    expect(view.sent).toHaveLength(1)
    expect(view.state.doc.toString()).toBe(
      '- [ ] Gym 🔁 every week 📅 2026-10-12\n- [x] Gym 🔁 every week 📅 2026-10-05 ✅ 2026-10-07\n',
    )
    undo(view)
    expect(view.state.doc.toString()).toBe(note)
  })

  test('is dropped where the note changed while the engine was being asked', async () => {
    const note = '- [ ] Go\n'
    const view = viewOf(stateOf(note, 0, HELP))
    const slow: TaskHelp = {
      ...HELP,
      tick: async (text, line) => {
        view.dispatch(view.state.update({ changes: { from: 0, insert: 'typed ' } }))
        return HELP.tick(text, line)
      },
    }
    await tickLines(view as unknown as EditorView, slow, [1])
    expect(view.state.doc.toString()).toBe('typed - [ ] Go\n')
  })
})

describe('a date typed at the end of a task', () => {
  test('is offered after the caret, and Tab writes it as the field', async () => {
    const note = '- [ ] Call mum tomorrow'
    const state = stateOf(note, note.length, HELP)
    expect(state.field(taskHint)?.day.due).toBe('2026-10-08')

    const view = viewOf(state)
    expect(takeHint(view as unknown as EditorView)).toBe(true)
    // The writer is fetched by the Tab that asks for it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(view.state.doc.toString()).toBe('- [ ] Call mum 📅 2026-10-08')
    undo(view)
    expect(view.state.doc.toString()).toBe(note)
  })

  test('is not offered in the middle of the words, on a dated task, or with no app', () => {
    const note = '- [ ] Call mum tomorrow'
    expect(stateOf(note, 10, HELP).field(taskHint)).toBeNull()
    const dated = '- [ ] Call mum 📅 2026-10-09 tomorrow'
    expect(stateOf(dated, dated.length, HELP).field(taskHint)).toBeNull()
    expect(stateOf(note, note.length).field(taskHint)).toBeNull()
  })

  test('and Tab with nothing offered is not taken', () => {
    const note = '- [ ] Call mum'
    expect(takeHint(viewOf(stateOf(note, note.length, HELP)) as unknown as EditorView)).toBe(false)
  })
})
