import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import * as lucide from 'lucide'
import { fileMark, type FileMark as Mark, MARKS } from './file-mark'

describe('the mark a file wears', () => {
  test('a note is a note by its extension, whichever one is written', () => {
    expect(fileMark('Read me.md')).toBe('note')
    expect(fileMark('Plan.markdown')).toBe('note')
    expect(fileMark('Notes.mdown')).toBe('note')
    expect(fileMark('Old.mkd')).toBe('note')
  })

  test('a canvas, a paper and a picture each have their own', () => {
    expect(fileMark('Board.canvas')).toBe('canvas')
    expect(fileMark('Deep Learning.pdf')).toBe('pdf')
    expect(fileMark('shot.png')).toBe('picture')
  })

  test('every extension a picture is written in', () => {
    for (const name of [
      'a.png',
      'a.apng',
      'a.jpg',
      'a.jpeg',
      'a.gif',
      'a.webp',
      'a.avif',
      'a.bmp',
      'a.ico',
      'a.svg',
    ]) {
      expect(fileMark(name), name).toBe('picture')
    }
  })

  test('and anything else is a plain file', () => {
    expect(fileMark('notes.txt')).toBe('file')
    expect(fileMark('data.json')).toBe('file')
    expect(fileMark('archive.zip')).toBe('file')
  })

  test('a name with no extension is a file rather than a note', () => {
    expect(fileMark('Makefile')).toBe('file')
    expect(fileMark('')).toBe('file')
  })

  test('a dotfile is read by what follows its last dot', () => {
    expect(fileMark('.gitignore')).toBe('file')
    expect(fileMark('.keep')).toBe('file')
    // Nothing but an extension is still that extension.
    expect(fileMark('.md')).toBe('note')
  })

  test('the case of the extension makes no difference', () => {
    expect(fileMark('SHOUTING.MD')).toBe('note')
    expect(fileMark('Paper.PDF')).toBe('pdf')
    expect(fileMark('Board.CANVAS')).toBe('canvas')
    expect(fileMark('Shot.PNG')).toBe('picture')
  })

  test('only the last dot decides', () => {
    expect(fileMark('Notes v1.2.md')).toBe('note')
    expect(fileMark('backup.md.bak')).toBe('file')
    expect(fileMark('paper.pdf.md')).toBe('note')
    expect(fileMark('shot.png.canvas')).toBe('canvas')
  })

  test('a name that is only an extension-looking word is a file', () => {
    expect(fileMark('md')).toBe('file')
    expect(fileMark('pdf')).toBe('file')
    expect(fileMark('canvas')).toBe('file')
    expect(fileMark('pages')).toBe('file')
  })

  /** A page note wears its own mark and never a canvas's, though the two hold the
   *  same format: what a row says is what a press on it will open. */
  test('a page note is its own mark', () => {
    expect(fileMark('Lecture 4.pages')).toBe('pages')
    expect(fileMark('Lecture 4.PAGES')).toBe('pages')
    expect(fileMark('Lecture 4.pages.canvas')).toBe('canvas')
    expect(fileMark('Lecture 4.canvas.pages')).toBe('pages')
  })
})

/** The drawings themselves. What is worth checking is not which icon was
 *  chosen but that the set is one set: every mark has a drawing, every drawing
 *  is Lucide's own, and no two marks are the same picture. */
describe('the marks a row wears', () => {
  const MARK_NAMES: Mark[] = ['note', 'canvas', 'pages', 'pdf', 'picture', 'file', 'web']

  /** And no folder among them: no row in the list is a folder, so there is no
   *  drawing of one to reach for. See folder-notes.ts. */
  test('every kind of row has one, and a folder is not a kind of row', () => {
    for (const name of MARK_NAMES) {
      expect(MARKS[name], name).toBeDefined()
      expect(MARKS[name].length, name).toBeGreaterThan(0)
    }

    expect(Object.keys(MARKS).sort()).toEqual([...MARK_NAMES].sort())
  })

  /** By value rather than by identity, because the marks are imported one file each
   *  rather than off the library's index - a static import from the index puts all six
   *  thousand icons in front of the app's first paint. The two are the same drawing and
   *  need not be the same array; see file-mark.ts. */
  test('all of them come from the icon library rather than being drawn here', () => {
    const library = Object.values(lucide)
      .filter(Array.isArray)
      .map((one) => JSON.stringify(one))

    for (const name of MARK_NAMES) {
      expect(library, name).toContain(JSON.stringify(MARKS[name]))
    }
  })

  test('no two rows wear the same picture', () => {
    const drawn = MARK_NAMES.map((name) => JSON.stringify(MARKS[name]))
    expect(new Set(drawn).size).toBe(MARK_NAMES.length)
  })

  /** The marks are drawn by naming each element the library asks for, so an
   *  icon made of something FileMark cannot name would come out as an empty
   *  box - visible only as a missing mark in the tree. */
  test('and each is made of shapes a stroke can be drawn on', () => {
    const drawable = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']

    for (const name of MARK_NAMES) {
      for (const [tag] of MARKS[name]) {
        expect(drawable, `${name}: ${tag}`).toContain(tag)
      }
    }
  })
})

/** A note, a canvas or a folder that chose an icon of its own wears it in the same
 *  box, and one place draws it: every list that shows a file draws this component,
 *  so the tree, the tab strip, a search result, a bookmark and the Move sheet all
 *  show the chosen icon without any of them knowing where icons are kept. Read out
 *  of the component, in the way menus.test.ts reads the menus and
 *  touch-scale.test.ts the sizes. */
describe('the mark a file or folder chose for itself', () => {
  const source = readFileSync(fileURLToPath(new URL('./FileMark.svelte', import.meta.url)), 'utf8')

  test('comes from the path the row already knows, through the one reader of all three', () => {
    expect(source).toContain('chosenIcon(path)')
  })

  test('and the kind s own mark is what a row falls back to', () => {
    // Which covers all four of: a row that chose nothing, a caller that knows no
    // path, a name no set holds, and the moment before a set has arrived.
    expect(source).toContain('fallback={MARKS[mark]}')
  })

  /** Which KIND a row is comes off its name: a website is `Svelte docs.url`, a
   *  shortcut file, so the globe is drawn from the name like every other kind's and
   *  no list has to ask the index what the file is - the lookup the old `url:` note
   *  needed does not come back. The site's own favicon, which a website does wear
   *  over the globe, is read through the same chosen-icon façade every mark uses, so
   *  this component still names no store of its own. */
  test('the store is reached through the façade, never named here', () => {
    expect(source).not.toContain('links.')
    expect(source).toContain("from './chosen-icon'")
    expect(source).toContain('faviconFor(path)')
  })

  /** One box, whichever of the three kinds is in it, and one size in it: `--icon-md`
   *  is 16px under a pointer and `--touch-mark` under a thumb, which the tokens
   *  restate. The font size is there as well as the box because an emoji is type and
   *  a glyph has no width of its own to be stretched; see Icon.svelte. */
  test('every kind of icon is drawn in one box, at one size', () => {
    const style = source.slice(source.indexOf('<style>'))

    expect(style).toContain('width: var(--icon-md)')
    expect(style).toContain('height: var(--icon-md)')
    expect(style).toContain('font-size: var(--icon-md)')
  })
})
