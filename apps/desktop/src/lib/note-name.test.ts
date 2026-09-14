import { describe, expect, test } from 'vitest'
import { nameToWrite } from './naming'
import { draftName, endingOf, nameFromContent, rowName, shownName, titleFrom } from './note-name'

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

  /** Emil, 2026-09-13: no filename endings anywhere a name is shown. A website is
   *  written as a shortcut file in one of two formats and is known by its title,
   *  like every other kind nib opens in a tab. */
  test('drops a website, written either way', () => {
    expect(shownName('Svelte docs.url')).toBe('Svelte docs')
    expect(shownName('Page.webloc')).toBe('Page')
  })

  /** A paper, a picture and anything else nib did not write are files from
   *  somewhere else with no title behind them, so the name is the file's own -
   *  which is what Obsidian shows and what Emil asked for on 2026-09-14. The mark
   *  beside the row says which kind it is either way. */
  test('keeps the extension of a paper, a picture and a file it knows nothing about', () => {
    expect(shownName('Paper.pdf')).toBe('Paper.pdf')
    expect(shownName('Paper.PDF')).toBe('Paper.PDF')
    expect(shownName('shot.png')).toBe('shot.png')
    expect(shownName('notes.txt')).toBe('notes.txt')
  })

  test('leaves an extension in the middle alone', () => {
    expect(shownName('shot.png.canvas')).toBe('shot.png')
    expect(shownName('backup.md.bak')).toBe('backup.md.bak')
    expect(shownName('a.canvas.md')).toBe('a.canvas')
  })

  test('keeps a dot that is part of somebody name', () => {
    expect(shownName('v1.2 plan.md')).toBe('v1.2 plan')
    expect(shownName('v1.2 plan')).toBe('v1.2 plan')
  })

  /** Taking the ending off would leave the row, the tab, the tooltip and the window
   *  title with nothing to say at all. */
  test('keeps a name that is nothing but an ending', () => {
    expect(shownName('.md')).toBe('.md')
    expect(shownName('.canvas')).toBe('.canvas')
    expect(shownName('.url')).toBe('.url')
  })
})

describe('the name a row of the file list is under', () => {
  /** A folder called `Papers.pdf` is not holding a paper and one called `Notes.md`
   *  is not a note, so a folder is called what it is called. */
  test('is the folder own name, whatever it looks like', () => {
    expect(rowName('Papers.pdf', true)).toBe('Papers.pdf')
    expect(rowName('Notes.md', true)).toBe('Notes.md')
    expect(rowName('Work', true)).toBe('Work')
  })

  test('and a file name as every other list shows it', () => {
    expect(rowName('Plan.md', false)).toBe('Plan')
    expect(rowName('report.pdf', false)).toBe('report.pdf')
  })
})

describe('the ending a name wears', () => {
  test('is one of the ones a document is known by', () => {
    expect(endingOf('Plan.md')).toBe('.md')
    expect(endingOf('Plan.markdown')).toBe('.markdown')
    expect(endingOf('Board.canvas')).toBe('.canvas')
    expect(endingOf('Sketch.pages')).toBe('.pages')
    expect(endingOf('Svelte docs.url')).toBe('.url')
  })

  /** However it was written, so a rename puts back the name that is on the disk
   *  rather than a tidied-up spelling of it. */
  test('in the case the file wrote it in', () => {
    expect(endingOf('NOTE.MD')).toBe('.MD')
    expect(endingOf('Board.CANVAS')).toBe('.CANVAS')
  })

  test('or the file own extension, for a file nib did not write', () => {
    expect(endingOf('report.pdf')).toBe('.pdf')
    expect(endingOf('shot.png')).toBe('.png')
    expect(endingOf('notes.txt')).toBe('.txt')
    expect(endingOf('backup.md.bak')).toBe('.bak')
  })

  test('and the whole of a name that is nothing else', () => {
    expect(endingOf('.md')).toBe('.md')
    expect(endingOf('.url')).toBe('.url')
  })

  /** A run with a space in it is part of somebody name. Reading it as an extension
   *  is what renamed `v1.2 plan` to `v1.3 plan.2 plan`. */
  test('and nothing at all where the name wears none', () => {
    expect(endingOf('Readme')).toBeNull()
    expect(endingOf('v1.2 plan')).toBeNull()
    expect(endingOf('.hidden folder')).toBeNull()
  })
})

/** The one rule, read from both ends. Whatever a list leaves off a name, a rename
 *  puts back, so every name nib lists survives being shown and typed back
 *  unchanged - which is what keeps an ending from doubling up or going missing. The
 *  pair is `shownName` and `endingOf` here, and `nameToWrite` in naming.ts. */
describe('what a list leaves off and a rename puts back', () => {
  const LISTED = [
    'Plan.md',
    'Plan.markdown',
    'Plan.mdown',
    'Plan.mkd',
    'NOTE.MD',
    'Board.canvas',
    'Board.CANVAS',
    'Sketch.pages',
    'Svelte docs.url',
    'Page.webloc',
    'report.pdf',
    'report.PDF',
    'shot.png',
    'notes.txt',
    '.md',
    '.url',
    'a.canvas.md',
    'v1.2 plan.md',
    'shot.png.canvas',
  ]

  test.each(LISTED)('is the same name again: %s', (name) => {
    expect(nameToWrite(shownName(name), endingOf(name) ?? '')).toBe(name)
  })
})
