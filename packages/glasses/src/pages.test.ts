import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, test } from 'vitest'
import { SPACE, width, wrap } from './firmware'
import { pageAt, pageOfLine, pagesOf, type Paging } from './pages'
import { BODY_INNER, BODY_ROWS, GUTTER } from './panel'
import { costOf, NOTE, PAGING, typed } from '../test/cost'

const paging = (over: Partial<Paging> = {}): Paging => ({
  breakAt: 2,
  gutter: 0,
  inner: BODY_INNER,
  rows: BODY_ROWS,
  ...over,
})

const pages = (source: string, over: Partial<Paging> = {}) => pagesOf(source, paging(over))

/** The column of line numbers, as `panel.ts` sizes it when the reader has asked
 *  for them. The body is the whole width either way; the numbers are laid over its
 *  left and the note's rows are pushed in to clear them. */
const NUMS = GUTTER

const PROSE = Array.from(
  { length: 30 },
  (_one, at) =>
    `Paragraph ${at} with enough words in it to run past the end of one line of the panel quite easily.`,
).join('\n\n')

/** The rule the whole reading experience turns on: a page is `BODY_ROWS` lines of
 *  the firmware's own measure, and never one more. */
describe('a page holds what the panel holds', () => {
  test('never puts more lines on a page than the body has', () => {
    for (const page of pages(PROSE)) {
      expect(page.words.split('\n').length).toBeLessThanOrEqual(BODY_ROWS)
    }
  })

  test('and never a line wider than the body', () => {
    for (const page of pages(PROSE)) {
      for (const row of page.words.split('\n')) expect(width(row)).toBeLessThanOrEqual(BODY_INNER)
    }
  })

  test('agrees with the firmware about how many rows a row is', () => {
    // Two models of the same font: ours, which breaks the lines, and pretext's
    // `measureTextWrap`, which is what the firmware's own shaping was measured
    // into. Every row we send has to be exactly one row when it lands.
    const note = `${PROSE}\n\n\`\`\`ts\nconst somethingRatherLong = aFunctionCall(withArguments, andMore)\n\`\`\`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`
    for (const page of pages(note, { gutter: NUMS })) {
      for (const row of page.words.split('\n')) {
        if (row.trim() === '') continue
        expect(measureTextWrap(row, BODY_INNER).lineCount, JSON.stringify(row)).toBe(1)
      }
    }
  })

  test('fills the pages rather than leaving them half empty', () => {
    const all = pages(PROSE, { breakAt: 0 })
    // Every page but the last carries at least most of the panel.
    for (const page of all.slice(0, -1)) {
      expect(page.words.split('\n').length).toBeGreaterThanOrEqual(BODY_ROWS - 2)
    }
  })

  test('answers with nothing for a note with nothing in it', () => {
    expect(pages('')).toEqual([])
    expect(pages('   \n\n')).toEqual([])
  })
})

/** Item two of the brief: a heading level at which a new page starts. */
describe('a page starts at a heading', () => {
  const note = [
    '# The title',
    '',
    'Some words under the title.',
    '',
    '## First section',
    '',
    'Words in the first section.',
    '',
    '### Not a break by default',
    '',
    'More words.',
    '',
    '## Second section',
    '',
    'Words in the second.',
    '',
  ].join('\n')

  test('breaks at H1 and H2 by default, and not at H3', () => {
    const all = pages(note)

    expect(all.map((page) => page.section)).toEqual([
      'THE TITLE',
      'FIRST SECTION',
      'SECOND SECTION',
    ])
  })

  test('breaks only at H1 when asked for one', () => {
    const all = pages(note, { breakAt: 1 })

    // One section, however many pages it takes: every lower heading is then a
    // line of the note like any other.
    expect([...new Set(all.map((page) => page.section))]).toEqual(['THE TITLE'])
    expect(all.map((page) => page.words).join('\n')).toContain('FIRST SECTION')
  })

  test('breaks at H3 as well when asked for three', () => {
    expect(pages(note, { breakAt: 3 }).map((page) => page.section)).toEqual([
      'THE TITLE',
      'FIRST SECTION',
      'NOT A BREAK BY DEFAULT',
      'SECOND SECTION',
    ])
  })

  test('breaks at no heading at all when asked for none', () => {
    const all = pages(note, { breakAt: 0 })

    // No page has a section, because no heading opened one.
    expect([...new Set(all.map((page) => page.section))]).toEqual([''])
    // Every heading is then a line of the note like any other, underline
    // included, and nothing has been lost.
    const set = all.map((page) => page.words).join('\n')
    expect(set).toContain('THE TITLE')
    expect(set).toContain('═'.repeat(28))
    expect(set).toContain('SECOND SECTION')
  })

  test('takes the heading out of the body and into the head band', () => {
    const [first] = pages(note)

    expect(first?.section).toBe('THE TITLE')
    expect(first?.words).not.toContain('THE TITLE')
    // And its underline with it, so it is not drawn twice.
    expect(first?.words).not.toContain('═')
  })

  test('says which rule the head band wears, by the level of the heading', () => {
    const all = pages(note)

    expect(all[0]?.rule).toBe('═')
    expect(all[1]?.rule).toBe('─')
  })

  test('keeps the heading up for every page of a long section', () => {
    const long = `## A long section\n\n${PROSE}\n`
    const all = pages(long)

    expect(all.length).toBeGreaterThan(3)
    for (const page of all) expect(page.section).toBe('A LONG SECTION')
  })

  test('leaves a rule the author wrote in the body', () => {
    const [first] = pages('## A section\n\n---\n\nwords\n')

    expect(first?.words).toContain('─'.repeat(28))
  })

  test('starts a page even when the one before it had room', () => {
    const all = pages('## One\n\nshort\n\n## Two\n\nshort\n')

    expect(all).toHaveLength(2)
  })

  test('says nothing for a note that opens without a heading', () => {
    const [first] = pages('Just words.\n')

    expect(first?.section).toBe('')
  })
})

/** Item two again: the line numbers.
 *
 *  They live in a column of their own rather than in front of the body's own
 *  text, because a text container has no alignment of any kind: padded into the
 *  words, the words of each row start at a slightly different pixel. See
 *  `panel.ts`. */
describe('line numbers', () => {
  const note = 'one\n\ntwo\n\nthree\n'

  test('are nothing at all unless asked for', () => {
    const [page] = pages(note, { gutter: 0 })

    expect(page?.words).toBe('one\ntwo\nthree')
    expect(page?.numbers).toBe('')
  })

  test('are a column over the body, one number to a line', () => {
    const [page] = pages(note, { gutter: NUMS })

    // The words are pushed in by a constant, which is what has no jitter in it, and
    // the numbers sit in the room that makes.
    expect(page?.words.split('\n').map((row) => row.trim())).toEqual(['one', 'two', 'three'])
    expect(page?.numbers.split('\n').map((row) => row.trim())).toEqual(['1', '3', '5'])
    for (const row of page?.words.split('\n') ?? []) {
      expect(width(row) - width(row.trimStart())).toBeGreaterThanOrEqual(NUMS)
    }
  })

  test('have exactly as many lines as the body has rows', () => {
    const long = Array.from({ length: 30 }, (_one, at) => `paragraph ${at} of this note`).join(
      '\n\n',
    )

    for (const page of pages(long, { gutter: NUMS, breakAt: 0 })) {
      expect(page.numbers.split('\n')).toHaveLength(page.words.split('\n').length)
    }
  })

  test('say nothing on the rows a long line wrapped to', () => {
    const long = `a ${'word '.repeat(60)}\n`
    const [page] = pages(long, { gutter: NUMS })
    const rows = page?.numbers.split('\n') ?? []

    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.trim()).toBe('1')
    // The rest are the same line of the note, and saying so twice is a lie about
    // where you are.
    for (const row of rows.slice(1)) expect(row.trim()).toBe('')
  })

  test('sit against the right of their column, whatever their digits', () => {
    const long = Array.from({ length: 60 }, (_one, at) => `word ${at}`).join('\n\n')

    // The column, less the space it keeps clear of the words on either side.
    const room = NUMS - 10

    for (const page of pages(long, { gutter: NUMS, breakAt: 0 })) {
      for (const row of page.numbers.split('\n')) {
        // Never wider than the column, so a number can never run into the words.
        expect(width(row)).toBeLessThanOrEqual(room)
        if (row.trim() === '') continue
        // And within one space of its right hand edge.
        expect(width(row)).toBeGreaterThan(room - SPACE - 1)
      }
    }
  })

  test('cost the note some of its width, and never more than it has', () => {
    const wide = pages(PROSE, { gutter: 0, breakAt: 0 })
    const narrow = pages(PROSE, { gutter: NUMS, breakAt: 0 })
    const widest = (all: ReturnType<typeof pages>) =>
      Math.max(
        ...all.flatMap((page) => page.words.split('\n').map((row) => width(row.trimStart()))),
      )

    // The words have a column less of the panel to run in.
    expect(widest(narrow)).toBeLessThan(widest(wide))
    expect(narrow.length).toBeGreaterThanOrEqual(wide.length)
    // And nothing runs off the edge of the glass either way, indent and all.
    for (const page of [...wide, ...narrow]) {
      for (const row of page.words.split('\n')) expect(width(row)).toBeLessThanOrEqual(BODY_INNER)
    }
  })
})

/** A line is never split across a page. */
describe('what moves whole', () => {
  test('keeps a fence together with the line that opens it', () => {
    const note = `${'filler paragraph that takes a line\n\n'.repeat(6)}\`\`\`ts\nconst a = 1\nconst b = 2\n\`\`\`\n`
    const all = pages(note, { breakAt: 0 })
    const opens = all.find((page) => page.words.includes('‘‘‘ts'))

    // Wherever the fence went, its body went with it.
    expect(opens?.words).toContain('const a = 1')
    expect(opens?.words).toContain('const b = 2')
  })

  test('keeps a table together with its head', () => {
    const note = `${'filler paragraph that takes a line\n\n'.repeat(6)}| Kind | Size |\n| --- | --- |\n| Image | 288 |\n`
    const all = pages(note, { breakAt: 0 })
    const head = all.find((page) => page.words.includes('Kind'))

    expect(head?.words).toContain('Image')
  })

  test('breaks a run longer than a page rather than losing it', () => {
    const code = Array.from({ length: 30 }, (_one, at) => `line ${at}`).join('\n')
    const all = pages(`\`\`\`\n${code}\n\`\`\`\n`, { breakAt: 0 })

    expect(all.length).toBeGreaterThan(1)
    const set = all.map((page) => page.words).join('\n')
    for (let at = 0; at < 30; at++) expect(set).toContain(`line ${at}`)
  })

  test('loses no line of the note across the pages', () => {
    const note = [
      '# Title',
      '',
      ...Array.from({ length: 20 }, (_one, at) => `Paragraph ${at}.\n`),
      '## Section',
      '',
      '- a',
      '- b',
      '',
      '```',
      'code',
      '```',
      '',
    ].join('\n')

    const set = pages(note)
      .map((page) => `${page.section}\n${page.words}`)
      .join('\n')

    for (let at = 0; at < 20; at++) expect(set).toContain(`Paragraph ${at}.`)
    for (const want of ['TITLE', 'SECTION', '• a', '• b', '‘‘‘', 'code']) {
      expect(set, want).toContain(want)
    }
  })
})

/** Where a page is in the note, which is what binds the glasses to the phone. */
describe('where a page is', () => {
  test('numbers the pages in order and only goes forwards', () => {
    const all = pages(PROSE)

    expect(all.map((page) => page.index)).toEqual(all.map((_one, at) => at))
    let last = -1
    for (const page of all) {
      expect(page.from).toBeGreaterThanOrEqual(last)
      last = page.from
    }
  })

  test('ends the last page at the end of the note', () => {
    expect(pages(PROSE).at(-1)?.to).toBe(PROSE.length)
  })

  test('maps an offset back to the page it is on', () => {
    const all = pages(PROSE)

    expect(pageAt(all, 0)).toBe(0)
    expect(pageAt(all, PROSE.length)).toBe(all.length - 1)
    for (const page of all) expect(pageAt(all, page.from)).toBe(page.index)
  })

  test('maps a line of the note to the page it is on', () => {
    const note = Array.from({ length: 60 }, (_one, at) => `line ${at + 1}`).join('\n\n')
    const all = pages(note, { breakAt: 0 })

    expect(pageOfLine(all, 1)).toBe(0)
    for (const page of all) {
      expect(pageOfLine(all, page.firstLine)).toBe(page.index)
      expect(pageOfLine(all, page.lastLine)).toBe(page.index)
    }
    // Past the end of the note is the last page rather than nothing.
    expect(pageOfLine(all, 10_000)).toBe(all.length - 1)
  })

  test('says which lines of the note it shows', () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
    const [first, second] = pages(`${words.join('\n\n')}\n`)

    // Ten paragraphs, a blank line between each: the eight rows of a page reach line
    // fifteen, which is the eighth paragraph, and the ninth starts the next page.
    expect(first?.firstLine).toBe(1)
    expect(first?.lastLine).toBe(15)
    expect(second?.firstLine).toBeGreaterThan(first?.lastLine ?? 0)
  })
})

/** A page that has not changed is not sent again. */
describe('telling two pages apart', () => {
  test('hashes a page by everything the panel would show', () => {
    const [first] = pages(PROSE)
    const [again] = pages(PROSE)

    expect(first?.hash).toBe(again?.hash)
  })

  test('changes the hash when the words change', () => {
    expect(pages(PROSE)[0]?.hash).not.toBe(pages(`x. ${PROSE}`)[0]?.hash)
  })

  test('changes the hash when only the heading over it changed', () => {
    const one = pages('## One\n\nsame words\n')[0]
    const two = pages('## Two\n\nsame words\n')[0]

    expect(one?.words).toBe(two?.words)
    expect(one?.hash).not.toBe(two?.hash)
  })

  test('leaves a page alone when an edit further down the note moved nothing', () => {
    const note = `## One\n\nwords one\n\n## Two\n\nwords two\n`
    const before = pages(note)
    const after = pages(note.replace('words two', 'words two, edited'))

    expect(after[0]?.hash).toBe(before[0]?.hash)
    expect(after[1]?.hash).not.toBe(before[1]?.hash)
  })
})

/** Speed, which is the whole reason the glasses are written to rather than drawn
 *  on. Item three of the brief asks for a keystroke inside one frame. */
describe('what a page costs', () => {
  test('pages a note of twenty thousand characters', () => {
    expect(NOTE.length).toBeGreaterThan(20_000)
    expect(pagesOf(NOTE, PAGING).length).toBeGreaterThan(100)
  })

  /** What actually happens while somebody types: the note is paged again from the
   *  top and one line of it has changed. Every other line was broken before and is
   *  not broken again.
   *
   *  Asserted by identity rather than by a clock. The brief asks for a keystroke
   *  inside one frame, and on a quiet machine it is about 6 ms of the 16.7 there
   *  are - but a wall clock in a suite running seven packages at once measures the
   *  queue in front of it as much as the work, and a timing test that fails when the
   *  machine is busy is a test nobody trusts. The measured numbers are printed by
   *  `measure.test.ts` and written down in docs/even.md; what is asserted here is
   *  the property they rest on. */
  test('breaks a line once and remembers it, which is what a keystroke costs nothing', () => {
    const line = 'a line of a note, long enough to wrap across the panel more than once over'

    // The very same rows, not a second array with the same strings in it.
    expect(wrap(line, 400)).toBe(wrap(line, 400))
    // And a different question is a different answer.
    expect(wrap(line, 400)).not.toBe(wrap(line, 300))
    expect(wrap(line, 400)).not.toBe(wrap(line, 400, '  '))
  })

  test('re-pages a note after a keystroke without breaking its lines again', () => {
    const first = pagesOf(typed(0), PAGING)
    const after = pagesOf(typed(1), PAGING)

    // One line changed, so one page changed. Every other page hashes as it did,
    // which is also what keeps the keystroke off the radio.
    const moved = after.filter((page, index) => page.hash !== first[index]?.hash)
    expect(moved.length).toBeLessThanOrEqual(2)
    expect(first.length).toBe(after.length)
  })

  /** Counted rather than timed. This asked for a paging in under 60 ms and a runner
   *  with the whole suite on it answers well over that while the code is exactly as
   *  fast as it was: a wall clock measures the queue in front of the work as much as
   *  the work, and what this is watching for - a cache that stopped working, a pager
   *  that went quadratic - shows up in the counts as a factor of hundreds rather
   *  than as a percent of a millisecond.
   *
   *  `Work` in firmware.ts and in pages.ts say what a paging did: the lines walked,
   *  the pages cut, the lines broken, the lines read out of the cache instead and
   *  the glyphs measured. Every one of them is the same number on a busy machine as
   *  on an idle one. */
  test('pages a long note again and again without slowing down', () => {
    /** One paging, and what the firmware and the pager were asked to do for it.
     *
     *  The rounds are marked, so that every one of them is a line the cache has not
     *  seen: the tests above have already broken `typed(0)` and `typed(1)`, and a
     *  line already broken is answered rather than broken. */
    const round = (at: number) => {
      let pages = 0
      const cost = costOf(() => (pages = pagesOf(typed(at, 'k'), PAGING).length))
      return { pages, ...cost }
    }

    // Eight rounds: a pager gone quadratic is already paying several times over by
    // the eighth, and twenty were more than a gate's busy machine finished in the
    // five seconds a test has.
    const first = round(0)
    let last = first
    for (let at = 1; at < 8; at++) last = round(at)

    // A keystroke changes one line of the note, so one line is broken and the
    // other four hundred and seventy nine are handed back from the cache. A cache
    // that stopped working is four hundred and eighty breaks instead, which is the
    // difference between a keystroke inside a frame and one the reader can see.
    expect(first.set.broken).toBe(1)
    expect(first.set.cached).toBeGreaterThan(400)

    // And the eighth paging is the first one over again, to the glyph: paging a
    // note eight times costs eight times what paging it once costs, which is
    // what a pager gone quadratic would not.
    expect(last.set).toEqual(first.set)
    expect(last.paged).toEqual(first.paged)
    expect(last.pages).toBe(first.pages)
  })
})
