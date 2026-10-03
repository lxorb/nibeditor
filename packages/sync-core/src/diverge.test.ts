import { TEXT } from '@nib/rooms'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { changes, edited, note } from '../test/markdown'
import { CONTESTED, diverge, excerpt } from './diverge'
import { analyse } from './merge3'
import { seedUpdate } from './seed'
import { textops } from './textops'

const LOCAL_NEWER = { local: 2, remote: 1 }

const REMOTE_NEWER = { local: 1, remote: 2 }

/** Two devices' documents grown from one seed, each edited to its text, and merged:
 *  the CRDT's M, which is what the engine hands `diverge`. */
function crdtMerge(base: string, local: string, remote: string): string {
  const seed = seedUpdate('n', 1, base)
  const docs = [local, remote].map((text, index) => {
    const doc = new Y.Doc()
    doc.clientID = index + 10
    Y.applyUpdateV2(doc, seed)
    textops(doc.getText(TEXT), base, text)
    return doc
  })
  const [one, other] = docs as [Y.Doc, Y.Doc]
  Y.applyUpdateV2(one, Y.encodeStateAsUpdateV2(other))
  return one.getText(TEXT).toJSON()
}

describe('diverge', () => {
  test('edits in different paragraphs are clean, and the resolution holds both', () => {
    const base = 'First paragraph here.\n\nSecond paragraph there.\n'
    const local = 'First paragraph, edited here.\n\nSecond paragraph there.\n'
    const remote = 'First paragraph here.\n\nSecond paragraph edited there.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(
      'First paragraph, edited here.\n\nSecond paragraph edited there.\n',
    )
  })

  test('both fixed the same typo: clean, and the fix once, not thethe', () => {
    const base = 'I saw teh cat.'
    const fixed = 'I saw the cat.'
    const merged = crdtMerge(base, fixed, fixed)

    const result = diverge(base, fixed, fixed, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(fixed)
  })

  test('both appended to one list: clean, both kept in the order the CRDT gave', () => {
    const base = '- milk\n'
    const local = '- milk\n- eggs\n'
    const remote = '- milk\n- bread\n'
    const merged = crdtMerge(base, local, remote)

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('clean')
    expect(result.resolution).toBe(merged)
  })

  test('the same word changed two ways: minor, the newer stands', () => {
    const base = 'Meet at the station at noon.'
    const local = 'Meet at the station at one.'
    const remote = 'Meet at the station at two.'

    const newer = diverge(base, local, remote, LOCAL_NEWER)
    expect(newer.verdict).toBe('minor')
    expect(newer.overlaps[0]?.newer).toBe('local')
    expect(newer.resolution).toBe(local)

    const older = diverge(base, local, remote, REMOTE_NEWER, crdtMerge(base, local, remote))
    expect(older.verdict).toBe('minor')
    expect(older.resolution).toBe(remote)
  })

  test('a sentence written two ways: diverged, by size', () => {
    const base = 'We should ship the release on Monday after the review.\n'
    const local = 'Let us hold the release until every reviewer has signed off on it.\n'
    const remote = 'The release goes out Friday morning, whatever the review says.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('diverged')
    expect(result.overlaps.some((overlap) => overlap.asks === 'size')).toBe(true)
    expect(result.overlaps.every((overlap) => overlap.size > 0)).toBe(true)
    expect(result.resolution).toBeNull()
  })

  test('the boundary is CONTESTED characters, inclusive', () => {
    const word = (length: number) => 'x'.repeat(length)
    // One replaced word each side: the ancestor word, and two replacements of the
    // same length, so the size is three times it.
    const fits = Math.floor(CONTESTED / 3)
    const small = diverge(
      `a ${word(fits)} b`,
      `a ${'y'.repeat(fits)} b`,
      `a ${'z'.repeat(fits)} b`,
      LOCAL_NEWER,
    )
    expect(small.overlaps[0]?.size).toBeLessThanOrEqual(CONTESTED)
    expect(small.verdict).toBe('minor')

    const big = fits + 1
    const large = diverge(
      `a ${word(big)} b`,
      `a ${'y'.repeat(big)} b`,
      `a ${'z'.repeat(big)} b`,
      LOCAL_NEWER,
    )
    expect(large.overlaps[0]?.size).toBeGreaterThan(CONTESTED)
    expect(large.verdict).toBe('diverged')
  })

  test('a paragraph deleted on one side and rewritten on the other asks', () => {
    const base = 'Keep this.\n\nBuy milk\n\nKeep that.\n'
    const local = 'Keep this.\n\nKeep that.\n'
    const remote = 'Keep this.\n\nBuy milk and eggs and bread and cheese\n\nKeep that.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('diverged')
    expect(result.overlaps.some((overlap) => overlap.asks === 'block')).toBe(true)
  })

  test('a paragraph deleted on one side and a typo fixed in it on the other does not', () => {
    const base = 'Keep this.\n\nBuy mlik\n\nKeep that.\n'
    const local = 'Keep this.\n\nKeep that.\n'
    const remote = 'Keep this.\n\nBuy milk\n\nKeep that.\n'

    expect(diverge(base, local, remote, LOCAL_NEWER).verdict).not.toBe('diverged')
  })

  test('a list item deleted while the other side appended to it asks, touching or not', () => {
    const base = '- one\n- buy milk\n- three\n'
    const local = '- one\n- three\n'
    const remote = '- one\n- buy milk, eggs, bread and some cheese\n- three\n'

    expect(diverge(base, local, remote, REMOTE_NEWER).verdict).toBe('diverged')
  })

  test('front matter the merge would break asks', () => {
    const base = '---\na: 1\n---\nb: 2\n'
    const local = '---\na: 1\nb: 2\n---\n'
    const remote = '---\na: 1\n---\n# heading\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.broken).toBe('front-matter')
    expect(result.verdict).toBe('diverged')
  })

  test('a fence the merge would leave open asks', () => {
    const base = 'A long first paragraph that nobody touches at all.\nqq\n'
    const local = '```\nA long first paragraph that nobody touches at all.\nq\n```\nq\n'
    const remote = 'A long first paragraph that nobody touches at all.\nzz\n'

    const result = diverge(base, local, remote, REMOTE_NEWER)
    expect(result.broken).toBe('fence')
    expect(result.verdict).toBe('diverged')
  })

  test('the excerpt is the first contested passage of each side, the differences marked', () => {
    const base = 'Intro.\n\nWe should ship the release on Monday after the review.\n\nOutro.\n'
    const local =
      'Intro.\n\nLet us hold the release until every reviewer has signed off.\n\nOutro.\n'
    const remote =
      'Intro.\n\nThe release goes out Friday morning, whatever the review says.\n\nOutro.\n'

    const result = diverge(base, local, remote, LOCAL_NEWER)
    const shown = excerpt(base, local, remote, result.overlaps)

    expect(shown.local.text).toBe('Let us hold the release until every reviewer has signed off.')
    expect(shown.remote.text).toBe('The release goes out Friday morning, whatever the review says.')
    expect(shown.local.marks.length).toBeGreaterThan(0)
    expect(shown.remote.marks.length).toBeGreaterThan(0)
    for (const [from, to] of [...shown.local.marks, ...shown.remote.marks]) {
      expect(from).toBeLessThan(to)
    }
  })

  test('the marks are whole words, and only the words that differ', () => {
    const base =
      'Intro.\n\nWe meet on the old bridge at noon with the whole team today.\n\nOutro.\n'
    const local =
      'Intro.\n\nWe meet on the new bridge at one with the whole team today.\n\nOutro.\n'
    const remote =
      'Intro.\n\nWe meet on the stone bridge at two with the whole team tomorrow.\n\nOutro.\n'

    const shown = excerpt(base, local, remote, diverge(base, local, remote, LOCAL_NEWER).overlaps)
    const marked = (side: { text: string; marks: [number, number][] }) =>
      side.marks.map(([from, to]) => side.text.slice(from, to))

    expect(marked(shown.local)).toEqual(['new', 'one', 'today'])
    expect(marked(shown.remote)).toEqual(['stone', 'two', 'tomorrow'])
  })

  test("a minor overlap keeps the newer side's words where the CRDT ordered them otherwise", () => {
    // Found by the simulator (seed 45): the CRDT put the local words before the
    // remote ones at the overlap, and laying the corrections onto its text as a merge
    // of their own lost the local words the newer side had written.
    const base = 'We ship on Monday after the review.\n\n- milk\n- eggs\n'
    const local = 'We ship on Monday after mk8z after the review.\n\n- milk milk the mk3z'
    const remote = 'We mk15z on eggs the ship on Monday after the mk17z mk27z plan milk'
    const merged =
      'We mk15z on eggs the ship on Monday after mk8z after the  milk the mk3zmk17z mk27z plan milk'

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('minor')
    for (const word of ['mk3z', 'mk8z', 'mk15z']) expect(result.resolution).toContain(word)
  })

  test('a long line is cut down to the passage and some context', () => {
    const filler = 'word '.repeat(200)
    const base = `${filler}alpha beta gamma ${filler}`
    const local = `${filler}alpha BETA-ONE gamma ${filler}`
    const remote = `${filler}alpha BETA-TWO gamma ${filler}`

    const shown = excerpt(base, local, remote, diverge(base, local, remote, LOCAL_NEWER).overlaps)
    expect(shown.local.text.length).toBeLessThan(400)
    expect(shown.local.text).toContain('BETA-ONE')
  })

  const distinctTimes = fc
    .tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }))
    .filter(([one, other]) => one !== other)

  test('property: diverge(B, L, B) is clean, and resolves to L', () => {
    fc.assert(
      fc.property(note, changes, (base, mine) => {
        const local = edited(base, mine)
        const result = diverge(base, local, base, LOCAL_NEWER)
        expect(result.verdict).toBe('clean')
        expect(result.resolution).toBe(local)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: disjoint edits are clean and the resolution holds both', () => {
    fc.assert(
      fc.property(note, note, changes, changes, (first, second, mine, theirs) => {
        const separator = '\n\n<!-- apart -->\n\n'
        const base = `${first}${separator}${second}`
        const local = `${edited(first, mine)}${separator}${second}`
        const remote = `${first}${separator}${edited(second, theirs)}`

        const result = diverge(base, local, remote, LOCAL_NEWER)
        expect(result.overlaps).toEqual([])
        // A fence opened on one side of the separator and closed on the other is
        // the one way two disjoint edits can still break something together.
        if (result.broken === null) {
          expect(result.verdict).toBe('clean')
          expect(result.resolution).toBe(
            `${edited(first, mine)}${separator}${edited(second, theirs)}`,
          )
        }
      }),
      { numRuns: 1000 },
    )
  })

  test('a passage the older side moved out of an overlap is said once, not twice', () => {
    // Found by the engine's simulated runs: the account's side moved "mk18z ship mk8z
    // on" further along, and the newer side's version of the overlap still held it
    // where it was. The newer side standing would have said it twice.
    const base =
      'We milk mk18z ship mk8z on review plan we review mk16z ship mk20z on mk9z milk review on Monday after the review.\n\n- milk\n'
    const local =
      'We milk mk18z ship mk8z on review mk32z plan we review mk16z ship mk20z on mk9z milk review on Monday milk\n'
    const remote =
      'We milk plan mk30z plan on after mk18z ship mk8z on mk20z on mk9z milk review after the review.\n\n- milk\n'
    const merged = crdtMerge(base, local, remote)

    const result = diverge(base, local, remote, LOCAL_NEWER, merged)
    expect(result.verdict).toBe('minor')
    for (const word of ['mk18z', 'mk8z', 'mk32z', 'mk30z']) {
      expect(result.resolution?.split(word).length, word).toBe(2)
    }
  })

  test('a few words two devices each put back over a deletion are said once', () => {
    // Also found by the engine's runs: both devices kept their own version over a
    // deletion, so each typed "mk4z we mk2z the" back - one as an insertion, the other
    // replacing the next word - and the CRDT holds two copies of one passage.
    const base = '# Ideas\n\nA long paragraph review monday about mk3z plan on\n'
    const local =
      '# Ideas\n mk25z monday\nA long paragraph review monday mk4z we mk2z the mk36z we about what comes\n'
    const remote =
      '# Ideas\n\nA long paragraph review monday mk4z we mk2z the about mk37z what comes next.\n'

    const result = diverge(base, local, remote, REMOTE_NEWER, crdtMerge(base, local, remote))
    expect(result.verdict).not.toBe('clean')
    expect(result.resolution?.split('mk4z').length ?? 2).toBe(2)
  })

  test('a line one side wrote that the other wrote too and went on from is not asked about', () => {
    // Found by the conflict drive under v2: a note closed offline and opened again
    // against a file nib wrote before the line, so one side is the line and the other
    // the line and what came after it.
    const base = '# Plan\n\nthe line both of them start from\n'
    const line = '\nMachine one, from the train: the platform moved to track nine.\n'
    const local = `${base}${line}`
    const remote = `${base}${line}\nMeanwhile at the desk we drafted the budget for spring.\n`

    for (const times of [REMOTE_NEWER, { local: 2, remote: 1 }]) {
      const result = diverge(base, local, remote, times)
      expect(result.verdict).not.toBe('diverged')
      expect(result.resolution).toBe(remote)
    }
  })

  test('property: diverge(B, L, R) and diverge(B, R, L) give the same verdict', () => {
    fc.assert(
      fc.property(note, changes, changes, distinctTimes, (base, mine, theirs, [one, other]) => {
        const local = edited(base, mine)
        const remote = edited(base, theirs)
        const forward = diverge(base, local, remote, { local: one, remote: other })
        const backward = diverge(base, remote, local, { local: other, remote: one })

        expect(backward.verdict).toBe(forward.verdict)
        if (forward.resolution !== null)
          expect(backward.resolution).toHaveLength(forward.resolution.length)
      }),
      { numRuns: 2000 },
    )
  })

  test('property: with the CRDT merge in hand, the resolution keeps its order and drops no word', () => {
    let same = 0
    let clean = 0
    fc.assert(
      fc.property(note, changes, changes, distinctTimes, (base, mine, theirs, [one, other]) => {
        const local = edited(base, mine)
        const remote = edited(base, theirs)
        const merged = crdtMerge(base, local, remote)
        const result = diverge(base, local, remote, { local: one, remote: other }, merged)
        if (result.verdict !== 'clean' || result.resolution === null) return
        clean += 1

        // Clean: nothing overlapped, so everything either side wrote is in the note,
        // whole, and in most runs the note is simply the CRDT's merge.
        const { alone } = analyse(base, local, remote)
        for (const edit of [...alone.local, ...alone.remote]) {
          expect(result.resolution).toContain(edit.insert)
        }
        if (result.resolution === merged) same += 1

        const doc = new Y.Doc()
        doc.getText(TEXT).insert(0, merged)
        textops(doc.getText(TEXT), merged, result.resolution)
        expect(doc.getText(TEXT).toJSON()).toBe(result.resolution)
      }),
      { numRuns: 1000 },
    )
    // The CRDT's own order is kept wherever it is only a matter of order.
    expect(same).toBeGreaterThan(clean * 0.9)
  })

  test('a word changed at each end of a hundred kilobytes is clean', () => {
    const paragraph = 'The plan for tomorrow is to write, then to rest, then to write again.\n\n'
    const base = paragraph.repeat(Math.ceil(100_000 / paragraph.length))
    const local = base.replace('rest', 'sleep')
    const last = base.lastIndexOf('write')
    const remote = `${base.slice(0, last)}draw${base.slice(last + 'write'.length)}`

    const result = diverge(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.overlaps).toEqual([])
    expect(result.resolution).toContain('sleep')
    expect(result.resolution).toContain('draw again')
  })
})
