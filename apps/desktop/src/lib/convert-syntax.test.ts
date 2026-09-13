import { describe, expect, test } from 'vitest'
import { syntaxChanges } from './convert-syntax'

/** What the Convert syntax command would write, before it writes any of it.
 *
 *  The count the reader is shown and the edits that are then applied come from one
 *  call, which is the whole point of `syntaxChanges` being pure: a sheet that said
 *  "rewrite 3 things" and then wrote four would be a sheet nobody could trust. So
 *  what is held here is that the two agree, that a note needing nothing is not in the
 *  list at all, and that every change carries the way back - it is one thing to undo
 *  however many notes it touched.
 *
 *  Which spelling becomes what is import/convert.test.ts; this is about the command
 *  around it. */

const note = (path: string, text: string) => ({ path, text })

describe('what Convert syntax would rewrite', () => {
  test('a note per note that needs one, and none for the rest', () => {
    const said = syntaxChanges(
      [note('One.md', '#two words# here'), note('Two.md', 'nothing to do here')],
      [],
    )

    expect(said.changes.map((one) => one.path)).toEqual(['One.md'])
    expect(said.changes[0]?.after).toBe('#two-words here')
    expect(said.rewrites).toBe(1)
  })

  test('and nothing at all for a space that needs nothing', () => {
    const said = syntaxChanges([note('One.md', '# Plan\n\n#work and [[Two]]\n')], ['Two.md'])

    expect(said.changes).toEqual([])
    expect(said.rewrites).toBe(0)
  })

  test('counts every rewrite rather than every note, which is what the sheet says', () => {
    const said = syntaxChanges(
      [note('One.md', '#two words# and #three more words#'), note('Two.md', '#one more#')],
      [],
    )

    expect(said.changes).toHaveLength(2)
    expect(said.rewrites).toBe(3)
  })

  test('an id link needs the space’s names, and finds the note they hold', () => {
    const said = syntaxChanges(
      [note('One.md', 'see [[202201011200]]')],
      ['202201011200 The plan.md'],
    )

    expect(said.changes[0]?.after).toBe('see [[202201011200 The plan]]')
    expect(said.rewrites).toBe(1)
  })

  test('and Roam’s own markup is rewritten in a note that arrived some other way', () => {
    const said = syntaxChanges(
      [note('One.md', '{{[[TODO]]}} Buy ^^milk^^\n\nAs ((abc123)) said.\n')],
      [],
    )

    // The box becomes a task with its marker, the highlight becomes the one
    // everything else reads, and the block reference is left as it was.
    expect(said.changes[0]?.after).toBe('- [ ] Buy ==milk==\n\nAs ((abc123)) said.\n')
    expect(said.rewrites).toBe(2)
  })

  test('every change carries the words it came from and the way back', () => {
    const said = syntaxChanges([note('One.md', '#two words# here')], [])
    const change = said.changes[0]

    expect(change?.before).toBe('#two words# here')
    expect(change?.edits.length).toBeGreaterThan(0)
    expect(change?.back.length).toBeGreaterThan(0)
  })

  /** A note whose rewrite comes out the same text has nothing to apply, and a change
   *  with no edit in it would be a row in the undo stack that undid nothing. */
  test('and a rewrite that changes no character is not a change', () => {
    expect(syntaxChanges([note('One.md', '')], []).changes).toEqual([])
  })
})
