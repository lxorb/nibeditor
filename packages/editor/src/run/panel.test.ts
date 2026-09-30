import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from '../markdown/extensions'
import {
  addRunLines,
  closeRun,
  dropRun,
  formatElapsed,
  MAX_RUN_LINES,
  openRun,
  type RunPanel,
  runPanels,
} from './panel'
import { isRunnableLanguage, runnableFenceAt } from './door'
import { parsed } from '../../test/parsed'

function state(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        runPanels,
      ],
    }),
  )
}

const FENCED = 'intro\n\n```js\nconsole.log(1)\n```\n\ntail\n'

describe('which fences can be run', () => {
  test('accepts the spellings of JavaScript, whatever their case', () => {
    for (const language of ['js', 'javascript', 'mjs', 'cjs', 'JS', ' JavaScript ']) {
      expect(isRunnableLanguage(language), language).toBe(true)
    }
  })

  test('refuses everything that is not JavaScript', () => {
    for (const language of ['', 'ts', 'typescript', 'jsx', 'node', 'python', 'mermaid', 'json']) {
      expect(isRunnableLanguage(language), language).toBe(false)
    }
  })
})

describe('finding the fence the caret is in', () => {
  test('reaches it from inside the code', () => {
    const found = runnableFenceAt(state(FENCED), FENCED.indexOf('console'))
    expect(found).not.toBeNull()
    expect(found?.code).toBe('console.log(1)')
    expect(found?.from).toBe(FENCED.indexOf('```js'))
    expect(found?.to).toBe(FENCED.indexOf('```\n\ntail') + 3)
  })

  test('reaches it from the fence lines themselves', () => {
    expect(runnableFenceAt(state(FENCED), FENCED.indexOf('```js') + 2)).not.toBeNull()
    expect(runnableFenceAt(state(FENCED), FENCED.indexOf('```\n\ntail') + 1)).not.toBeNull()
  })

  test('finds nothing in the prose around it', () => {
    expect(runnableFenceAt(state(FENCED), 2)).toBeNull()
    expect(runnableFenceAt(state(FENCED), FENCED.indexOf('tail'))).toBeNull()
  })

  test('finds nothing in a fence of another language', () => {
    const other = 'x\n\n```python\nprint(1)\n```\n'
    expect(runnableFenceAt(state(other), other.indexOf('print'))).toBeNull()
  })

  test('reads a fence of more than one line whole', () => {
    const many = '```js\nlet a = 1\na += 1\na\n```\n'
    expect(runnableFenceAt(state(many), many.indexOf('a += 1'))?.code).toBe('let a = 1\na += 1\na')
  })

  test('reads a fence inside a list item whole, prefix and all', () => {
    // A fence whose lines carry a prefix has the prefix outside its node, so the
    // parser hands out one piece of code text per line. Reading the first alone
    // ran the first line of such a block and dropped the rest without a word.
    const inList = '- item\n\n  ```js\n  let a = 1\n  a += 1\n  a\n  ```\n'
    expect(runnableFenceAt(state(inList), inList.indexOf('a += 1'))?.code).toBe(
      'let a = 1\na += 1\na',
    )
  })

  test('reads a fence inside a blockquote whole', () => {
    const quoted = '> ```js\n> let a = 1\n> a += 1\n> ```\n'
    expect(runnableFenceAt(state(quoted), quoted.indexOf('a += 1'))?.code).toBe('let a = 1\na += 1')
  })
})

/** A run started on the fence in `FENCED`. */
function started(doc = FENCED) {
  const from = doc.indexOf('```js')
  const to = doc.indexOf('```\n\ntail') + 3
  const begun = state(doc).update({
    effects: openRun.of({ run: 1, from, to, startedAt: 1000 }),
  }).state

  return { begun, from, to }
}

const only = (value: EditorState): RunPanel | undefined => value.field(runPanels)[0]

describe('the panel state', () => {
  test('opens a panel on the block the run belongs to', () => {
    const { begun, from, to } = started()
    expect(only(begun)).toMatchObject({ run: 1, from, to, status: 'running', lines: [] })
  })

  test('moves with the text above it', () => {
    const { begun, from, to } = started()
    const after = parsed(begun.update({ changes: { from: 0, insert: 'a new first line\n' } }).state)
    expect(only(after)).toMatchObject({ from: from + 17, to: to + 17 })
  })

  test('stays put when the text below it changes', () => {
    const { begun, from, to } = started()
    const after = parsed(
      begun.update({ changes: { from: begun.doc.length, insert: 'more\n' } }).state,
    )
    expect(only(after)).toMatchObject({ from, to })
  })

  test('keeps its output while it moves', () => {
    const { begun } = started()
    const withLines = parsed(
      begun.update({
        effects: addRunLines.of({ run: 1, lines: [{ level: 'log', text: 'hi' }] }),
      }).state,
    )
    const after = parsed(withLines.update({ changes: { from: 0, insert: 'x\n' } }).state)
    expect(only(after)?.lines).toEqual([{ level: 'log', text: 'hi' }])
  })

  test('stays on a fence that is indented into a list item', () => {
    // `from` is the start of the *line*, so a fence in a list item or a
    // blockquote has the indent or the quote mark ahead of its backticks. A
    // stricter reading dropped the panel on the next keystroke anywhere.
    const inList = '- item\n\n  ```js\n  console.log(1)\n  ```\n\ntail\n'
    const from = inList.indexOf('  ```js')
    const begun = state(inList).update({
      effects: openRun.of({ run: 1, from, to: inList.indexOf('  ```\n\ntail') + 5, startedAt: 1 }),
    }).state

    const after = parsed(begun.update({ changes: { from: begun.doc.length, insert: 'x' } }).state)
    expect(after.field(runPanels)).toHaveLength(1)
  })

  test('stays on a fence inside a blockquote', () => {
    const quoted = '> ```js\n> console.log(1)\n> ```\n\ntail\n'
    const begun = state(quoted).update({
      effects: openRun.of({ run: 1, from: 0, to: quoted.indexOf('> ```\n') + 5, startedAt: 1 }),
    }).state

    const after = parsed(begun.update({ changes: { from: begun.doc.length, insert: 'x' } }).state)
    expect(after.field(runPanels)).toHaveLength(1)
  })

  test('keeps naming the same block when text is typed at the fence line start', () => {
    // `from` says which block a panel belongs to, and it is compared against a
    // line start. Left one character along, a second run of the same block read
    // as a different block: two panels, and two sandboxes running at once.
    const doc = '```js\nconsole.log(1)\n```\n\ntail\n'
    const to = doc.indexOf('```\n\ntail') + 3
    const begun = state(doc).update({
      effects: openRun.of({ run: 1, from: 0, to, startedAt: 1 }),
    }).state

    const indented = parsed(begun.update({ changes: { from: 0, insert: ' ' } }).state)
    expect(only(indented)?.from).toBe(0)

    const again = parsed(
      indented.update({
        effects: openRun.of({ run: 2, from: 0, to: to + 1, startedAt: 2 }),
      }).state,
    )
    expect(again.field(runPanels)).toHaveLength(1)
    expect(only(again)?.run).toBe(2)
  })

  test('goes when the block it belongs to is deleted', () => {
    const { begun, from, to } = started()
    const after = parsed(begun.update({ changes: { from, to, insert: '' } }).state)
    expect(after.field(runPanels)).toEqual([])
  })

  test('goes when the whole note is replaced, as a reopened note replaces it', () => {
    const { begun } = started()
    const after = parsed(
      begun.update({
        changes: { from: 0, to: begun.doc.length, insert: 'another note\n' },
      }).state,
    )
    expect(after.field(runPanels)).toEqual([])
  })

  test('goes when the fence stops being a fence', () => {
    const { begun, from } = started()
    const after = parsed(begun.update({ changes: { from, to: from + 3, insert: '' } }).state)
    expect(after.field(runPanels)).toEqual([])
  })

  test('survives the language on the fence being retyped', () => {
    const { begun, from } = started()
    const after = parsed(
      begun.update({ changes: { from: from + 3, to: from + 5, insert: 'mjs' } }).state,
    )
    expect(after.field(runPanels)).toHaveLength(1)
  })

  test('appends output as it arrives', () => {
    const { begun } = started()
    const first = parsed(
      begun.update({
        effects: addRunLines.of({ run: 1, lines: [{ level: 'log', text: 'one' }] }),
      }).state,
    )
    const second = parsed(
      first.update({
        effects: addRunLines.of({ run: 1, lines: [{ level: 'error', text: 'two' }] }),
      }).state,
    )

    expect(only(second)?.lines).toEqual([
      { level: 'log', text: 'one' },
      { level: 'error', text: 'two' },
    ])
  })

  test('ignores output from a run that has been replaced', () => {
    const { begun } = started()
    const after = parsed(
      begun.update({
        effects: addRunLines.of({ run: 99, lines: [{ level: 'log', text: 'stale' }] }),
      }).state,
    )
    expect(only(after)?.lines).toEqual([])
  })

  test('stops keeping output once there is too much of it, and says so', () => {
    const { begun } = started()
    const many = Array.from({ length: MAX_RUN_LINES + 10 }, (_, index) => ({
      level: 'log' as const,
      text: String(index),
    }))
    const after = parsed(begun.update({ effects: addRunLines.of({ run: 1, lines: many }) }).state)

    expect(only(after)?.lines).toHaveLength(MAX_RUN_LINES)
    expect(only(after)?.truncated).toBe(true)
  })

  test('records how a run ended and how long it took', () => {
    const { begun } = started()
    const after = parsed(
      begun.update({
        effects: closeRun.of({ run: 1, status: 'timeout', elapsed: 10_000 }),
      }).state,
    )
    expect(only(after)).toMatchObject({ status: 'timeout', elapsed: 10_000 })
  })

  test('lets the first ending stand, so a timeout cannot overwrite a result', () => {
    const { begun } = started()
    const done = parsed(
      begun.update({
        effects: closeRun.of({ run: 1, status: 'done', elapsed: 4 }),
      }).state,
    )
    const later = parsed(
      done.update({
        effects: closeRun.of({ run: 1, status: 'timeout', elapsed: 10_000 }),
      }).state,
    )
    expect(only(later)).toMatchObject({ status: 'done', elapsed: 4 })
  })

  test('replaces the panel of the block when it is run again', () => {
    const { begun, from, to } = started()
    const again = parsed(
      begun.update({
        effects: [
          addRunLines.of({ run: 1, lines: [{ level: 'log', text: 'old' }] }),
          openRun.of({ run: 2, from, to, startedAt: 2000 }),
        ],
      }).state,
    )

    expect(again.field(runPanels)).toHaveLength(1)
    expect(only(again)).toMatchObject({ run: 2, lines: [] })
  })

  test('leaves the other blocks alone when one of them is run', () => {
    const two = '```js\n1\n```\n\n```js\n2\n```\n'
    const first = two.indexOf('```js')
    const second = two.lastIndexOf('```js')
    const both = state(two).update({
      effects: [
        openRun.of({ run: 1, from: first, to: first + 11, startedAt: 1 }),
        openRun.of({ run: 2, from: second, to: second + 11, startedAt: 2 }),
      ],
    }).state

    expect(both.field(runPanels).map((panel) => panel.run)).toEqual([1, 2])
  })

  test('is dismissed on its own', () => {
    const { begun } = started()
    const after = parsed(begun.update({ effects: dropRun.of(1) }).state)
    expect(after.field(runPanels)).toEqual([])
  })

  test('is nowhere near the document, whatever it holds', () => {
    const { begun } = started()
    const after = parsed(
      begun.update({
        effects: addRunLines.of({ run: 1, lines: [{ level: 'log', text: 'hi' }] }),
      }).state,
    )
    expect(after.doc.toString()).toBe(FENCED)
  })

  test('follows a selection change without being rebuilt', () => {
    const { begun } = started()
    const after = parsed(begun.update({ selection: EditorSelection.cursor(0) }).state)
    expect(after.field(runPanels)).toBe(begun.field(runPanels))
  })
})

describe('showing how long a run took', () => {
  test('counts in milliseconds while that reads well', () => {
    expect(formatElapsed(0)).toBe('0 ms')
    expect(formatElapsed(47.6)).toBe('48 ms')
    expect(formatElapsed(999)).toBe('999 ms')
  })

  test('switches to seconds, and drops the decimal once it is long', () => {
    expect(formatElapsed(1000)).toBe('1.0 s')
    expect(formatElapsed(1440)).toBe('1.4 s')
    expect(formatElapsed(10_000)).toBe('10 s')
  })
})
