import { describe, expect, test } from 'vitest'

import { convertIdLinks, convertRoam, convertTags, converted, idsIn } from './convert'

describe("Bear's closed tags", () => {
  test('become tags, and are counted', () => {
    const said = convertTags('#two words# and #work# again')

    expect(said.text).toBe('#two-words and #work again')
    expect(said.changes).toBe(2)
  })

  test('are left alone inside a fence and in the middle of a word', () => {
    const said = convertTags('a#b#c\n```\n#include <x>\n#define Y#\n```\n')

    expect(said.changes).toBe(0)
    expect(said.text).toContain('#define Y#')
  })

  test('a tag that is already one is not a change', () => {
    expect(convertTags('#work and #home/kitchen').changes).toBe(0)
  })
})

describe('a Zettelkasten id link', () => {
  const ids = idsIn(['202201011200 The first note.md', '202301011200.md', 'Ordinary note.md'])

  test('is written out as the note it means', () => {
    const said = convertIdLinks('See [[202201011200]] for that.', ids)

    expect(said.text).toBe('See [[202201011200 The first note]] for that.')
    expect(said.changes).toBe(1)
  })

  test('keeps the words the link showed', () => {
    expect(convertIdLinks('[[202201011200|the first one]]', ids).text).toBe(
      '[[202201011200 The first note|the first one]]',
    )
  })

  test('a note whose whole name is the id needs no rewriting', () => {
    expect(convertIdLinks('[[202301011200]]', ids).changes).toBe(0)
  })

  test('an id no note carries is left exactly as it was', () => {
    expect(convertIdLinks('[[209901011200]]', ids).text).toBe('[[209901011200]]')
  })

  test('an ordinary wikilink is not an id link', () => {
    expect(convertIdLinks('[[Ordinary note]]', ids).changes).toBe(0)
  })
})

describe('which note each id names', () => {
  test('is the note whose name begins with it', () => {
    const ids = idsIn(['202201011200 A.md', '20220101120000 B.md', 'C.md'])

    expect(ids.get('202201011200')).toBe('202201011200 A')
    expect(ids.get('20220101120000')).toBe('20220101120000 B')
    expect(ids.size).toBe(2)
  })

  test('the first one wins where two notes carry the same id', () => {
    const ids = idsIn(['202201011200 First.md', '202201011200 Second.md'])

    expect(ids.get('202201011200')).toBe('202201011200 First')
  })

  test('a name that only starts with digits is not an id', () => {
    expect(idsIn(['2026 plans.md', '12345 notes.md']).size).toBe(0)
  })
})

describe('both rewrites together', () => {
  test('count as one number', () => {
    const said = converted('#two words# and [[202201011200]]', ['202201011200 A note.md'])

    expect(said.changes).toBe(2)
    expect(said.text).toBe('#two-words and [[202201011200 A note]]')
  })

  test("leave a note that needs nothing exactly as it was, which is what says it doesn't", () => {
    const text = '# A note\n\n#work and [[Another]] and `#code#`\n'

    expect(converted(text, ['Another.md'])).toEqual({ text, changes: 0 })
  })

  test("Roam's own wikilinks are already nib's, so nothing is done to them", () => {
    const text = 'See [[The plan]] and [[Ideas]].'

    expect(converted(text, ['The plan.md', 'Ideas.md']).changes).toBe(0)
  })

  test('and a note pasted out of Roam gets its boxes and its highlights', () => {
    const said = converted('- {{[[TODO]]}} Buy ^^milk^^\n', [])

    expect(said.text).toBe('- [ ] Buy ==milk==\n')
    expect(said.changes).toBe(2)
  })
})

/** The importer's own rules, run on a note that is already here: `roamText` is what
 *  an imported Roam page is written with, and a note pasted out of Roam holds exactly
 *  the same markup. See import/roam.test.ts for what each spelling becomes. */
describe("Roam's own spellings in a note", () => {
  const roam = (text: string) => convertRoam(text)

  test('a box becomes a task, marker and all, on a line that had none', () => {
    expect(roam('{{[[TODO]]}} Buy milk').text).toBe('- [ ] Buy milk')
    expect(roam('{{[[DONE]]}} Bought it').text).toBe('- [x] Bought it')
  })

  test('and only the box on a line that is already a list item', () => {
    expect(roam('- {{[[TODO]]}} Buy milk').text).toBe('- [ ] Buy milk')
    expect(roam('  * {{[[DONE]]}} Bought it').text).toBe('  * [x] Bought it')
    expect(roam('1. {{[[TODO]]}} Buy milk').text).toBe('1. [ ] Buy milk')
  })

  test('and the indentation is kept, so a nested task stays nested', () => {
    expect(roam('    {{[[TODO]]}} Buy milk').text).toBe('    - [ ] Buy milk')
  })

  test('a highlight becomes the one everything else reads', () => {
    expect(roam('The ^^whole^^ point.').text).toBe('The ==whole== point.')
  })

  test('and whatever else a pair of braces wrapped is the words it wrapped', () => {
    expect(roam('{{[[query]]}} here').text).toBe('query here')
  })

  test('a block reference is left exactly as it was, because nothing here knows it', () => {
    const text = 'As ((abc123)) said.'

    expect(roam(text)).toEqual({ text, changes: 0 })
  })

  test('nothing inside a fence, where braces and carets are code', () => {
    const text = ['```', '{{[[TODO]]}} not a task', '^^not a highlight^^', '```'].join('\n')

    expect(roam(text)).toEqual({ text, changes: 0 })
  })

  test('and every mark on a line is counted, not just the line', () => {
    const said = roam('{{[[TODO]]}} Buy ^^milk^^ and ^^bread^^')

    expect(said.text).toBe('- [ ] Buy ==milk== and ==bread==')
    expect(said.changes).toBe(3)
  })

  test('a note with none of it is left exactly as it was', () => {
    const text = '# Plan\n\n- [ ] Buy milk\n\nA ==highlight== and a [[link]].\n'

    expect(roam(text)).toEqual({ text, changes: 0 })
  })
})
