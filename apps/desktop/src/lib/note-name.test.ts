import { describe, expect, test } from 'vitest'
import { draftName, nameFromContent, shownName, titleFrom } from './note-name'

const lines = (doc: string) => doc.split('\n')

describe('naming a note after its own words', () => {
  test('takes a heading without its hashes', () => {
    expect(nameFromContent('# Shopping list\n\nmilk\n')).toBe('Shopping list')
    expect(nameFromContent('### Deep heading\n')).toBe('Deep heading')
  })

  test('takes plain prose', () => {
    expect(nameFromContent('Meeting notes for Tuesday\n')).toBe('Meeting notes for Tuesday')
  })

  test('skips the blank lines above it', () => {
    expect(nameFromContent('\n\n  \n# Real title\n')).toBe('Real title')
  })

  test('drops a leading bullet or quote', () => {
    expect(nameFromContent('- first item\n')).toBe('first item')
    expect(nameFromContent('> quoted\n')).toBe('quoted')
  })

  test('replaces what a filesystem would refuse', () => {
    expect(nameFromContent('report: q1/q2\n')).toBe('report q1 q2')
    expect(nameFromContent('a<b>c|d*e"f\n')).toBe('a b c d e f')
  })

  test('has nothing to offer for an empty note', () => {
    expect(nameFromContent('')).toBeNull()
    expect(nameFromContent('\n\n   \n')).toBeNull()
  })

  test('has nothing to offer when only markup is left', () => {
    expect(nameFromContent('# \n')).toBeNull()
    expect(nameFromContent('///\n')).toBeNull()
  })

  test('keeps it short enough to be a filename', () => {
    expect(nameFromContent(`# ${'word '.repeat(40)}\n`)!.length).toBeLessThanOrEqual(60)
  })

  test('keeps letters other languages use', () => {
    expect(nameFromContent('# Notizen über Bücher\n')).toBe('Notizen über Bücher')
  })
})

describe('the line a note is titled after', () => {
  test('is the heading, even below a line of prose', () => {
    expect(titleFrom(lines('a stray thought\n\n# The real title\n'))).toBe('The real title')
  })

  test('is the first heading where there are several', () => {
    expect(titleFrom(lines('# One\n\n# Two\n'))).toBe('One')
  })

  test('is the first line with anything on it where there is no heading', () => {
    expect(titleFrom(lines('\n\nplain words\nmore\n'))).toBe('plain words')
  })

  /** Naming a tab is asked again on every keystroke, so it may not scale with
   *  the note. A heading further down than anybody would title a note from is
   *  past where this looks. */
  test('does not read the whole note looking for a heading', () => {
    const far = `${'prose\n'.repeat(200)}# Buried\n`
    expect(titleFrom(lines(far))).toBe('prose')
  })

  /** The same thing said as work rather than as an answer: however many lines
   *  are offered, only so many are ever taken. Counted, not timed - a clock
   *  measures the machine as much as the code; see docs/conventions.md. */
  test('takes a fixed number of lines however many it is offered', () => {
    let pulled = 0

    function* endless() {
      for (let line = 0; line < 100_000; line++) {
        pulled += 1
        yield 'prose'
      }
    }

    titleFrom(endless())
    expect(pulled).toBeLessThanOrEqual(40)
  })

  test('takes lines from anything that hands them over one at a time', () => {
    function* rope() {
      yield ''
      yield '# From an iterator'
    }

    expect(titleFrom(rope())).toBe('From an iterator')
  })

  test('has nothing to say about a note that says nothing', () => {
    expect(titleFrom([])).toBeNull()
    expect(titleFrom(lines('\n  \n'))).toBeNull()
  })
})

describe('what a draft is called on screen', () => {
  test('is its heading', () => {
    expect(draftName(lines('# Tuesday standup\n\nnotes\n'))).toBe('Tuesday standup')
  })

  test('is its first line when it has no heading', () => {
    expect(draftName(lines('ring the dentist\n'))).toBe('ring the dentist')
  })

  /** A tab is not a filename: a colon and a slash read perfectly well in one,
   *  and taking them out would make two drafts about Q1 and Q2 read alike. */
  test('keeps the punctuation a filename would lose', () => {
    expect(draftName(lines('Q1: costs/savings\n'))).toBe('Q1: costs/savings')
  })

  test('collapses the space inside it', () => {
    expect(draftName(lines('#   two    words  \n'))).toBe('two words')
  })

  test('is nothing at all while the draft says nothing', () => {
    expect(draftName([])).toBeNull()
    expect(draftName(lines('\n\n'))).toBeNull()
  })

  test('stays short enough for a tab', () => {
    expect(draftName(lines(`# ${'word '.repeat(40)}`))!.length).toBeLessThanOrEqual(60)
  })
})

describe('the name a document is listed under', () => {
  test('drops markdown, whichever extension it wears', () => {
    expect(shownName('Today.md')).toBe('Today')
    expect(shownName('Today.markdown')).toBe('Today')
    expect(shownName('Today.MKD')).toBe('Today')
  })

  test('drops a canvas and a page note, the way it drops a note', () => {
    expect(shownName('Board.canvas')).toBe('Board')
    expect(shownName('Board.CANVAS')).toBe('Board')
    expect(shownName('Sketch.pages')).toBe('Sketch')
  })

  /** Emil, 2026-09-13: no filename endings anywhere a name is shown. A website's two
   *  endings and a PDF's go too, so nothing in the list, the strip or the title wears
   *  one. */
  test('drops a website and a PDF as well', () => {
    expect(shownName('Svelte docs.url')).toBe('Svelte docs')
    expect(shownName('Page.webloc')).toBe('Page')
    expect(shownName('Paper.pdf')).toBe('Paper')
    expect(shownName('Paper.PDF')).toBe('Paper')
  })

  /** A picture is a file from somewhere else with no title behind it, so its name is
   *  the file's own. The tree says which kind a row is with the mark beside it. */
  test('keeps the extension of a picture', () => {
    expect(shownName('shot.png')).toBe('shot.png')
    expect(shownName('notes.txt')).toBe('notes.txt')
  })

  test('leaves an extension in the middle alone', () => {
    expect(shownName('shot.png.canvas')).toBe('shot.png')
    expect(shownName('backup.md.bak')).toBe('backup.md.bak')
  })
})
