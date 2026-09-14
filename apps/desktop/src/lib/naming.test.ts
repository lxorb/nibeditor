import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { extensionOf, nameFault, nameToCommit, nameToWrite } from './naming'

/** What a name may be, read as a list of names.
 *
 *  The field on a row asks these between two keystrokes, so every answer here is
 *  a sentence the row can show and nothing here touches a disk. The last block
 *  reads the crate: the device names are stated in two languages and would
 *  otherwise drift into two different answers to the same question. */

const beside = (...taken: string[]) => taken

describe('a name that cannot be written', () => {
  const naming = { extension: '.md', taken: beside() }

  test('is nothing at all, which is a field nobody has finished rather than a mistake', () => {
    expect(nameFault({ ...naming, typed: '' })).toBe('empty')
    expect(nameFault({ ...naming, typed: '   ' })).toBe('empty')
  })

  test('or holds a separator, which would name another folder', () => {
    expect(nameFault({ ...naming, typed: 'Work/Plan' })).toBe('separator')
    expect(nameFault({ ...naming, typed: 'Work\\Plan' })).toBe('separator')
  })

  test('or holds one of the characters Windows keeps', () => {
    for (const typed of ['Q1: costs', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b']) {
      expect(nameFault({ ...naming, typed }), typed).toBe('illegal')
    }
  })

  test('or a control code, which no platform takes', () => {
    // Inside the name rather than at the end of it, which the commit trims off.
    expect(nameFault({ ...naming, typed: `Pl${String.fromCharCode(9)}an` })).toBe('illegal')
  })

  /** Windows drops it without a word, so the file would be under a name other
   *  than the one that was typed. */
  test('or ends with a dot', () => {
    expect(nameFault({ ...naming, typed: 'Plan.' })).toBe('trailing')
  })

  /** A trailing space is not a fault: it is what a name arrives with while
   *  somebody is typing the next word, and the commit trims it. */
  test('though a space on the end is only a space on the end', () => {
    expect(nameFault({ ...naming, typed: 'Plan ' })).toBeNull()
    expect(nameToWrite('Plan ', '.md')).toBe('Plan.md')
  })

  test('or names a device, whatever the extension and whatever the case', () => {
    expect(nameFault({ ...naming, typed: 'NUL' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'nul' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'com4' })).toBe('reserved')
    // The crate looks at the part in front of the first dot, and so does this.
    expect(nameFault({ ...naming, typed: 'NUL.old' })).toBe('reserved')
    // And a name that merely starts with those letters is a name.
    expect(nameFault({ ...naming, typed: 'Console' })).toBeNull()
  })
})

describe('a name already in the folder', () => {
  test('is taken, judged as the name that would be written', () => {
    const taken = beside('Plan.md', 'Work')
    expect(nameFault({ typed: 'Plan', extension: '.md', taken })).toBe('taken')
    expect(nameFault({ typed: 'Notes', extension: '.md', taken })).toBeNull()
  })

  /** Two of the three platforms the app runs on say those are one file, so a
   *  rename that only changes the case would fail on arrival. */
  test('whatever the case it is written in', () => {
    expect(nameFault({ typed: 'plan', extension: '.md', taken: beside('Plan.md') })).toBe('taken')
  })

  /** Which is the folder-note layout: `A.md` becomes `A/A.md`, and a note beside
   *  the folder of its own name is the pair the whole convention is made of. */
  test('but a folder of the same name is not, because a note may sit beside one', () => {
    expect(nameFault({ typed: 'A', extension: '.md', taken: beside('A') })).toBeNull()
    expect(nameFault({ typed: 'A', extension: '', taken: beside('A.md') })).toBeNull()
  })

  /** The row's own name is left out by whoever asks; if it were not, no name
   *  could ever be kept and every rename would open onto a red row. */
  test('and a row keeps its own name, since the caller leaves it out', () => {
    expect(nameFault({ typed: 'Plan', extension: '.md', taken: beside('Other.md') })).toBeNull()
  })
})

describe('the extension a commit puts back', () => {
  test('is the one the file was written with, so a vault of .markdown stays one', () => {
    expect(extensionOf('Plan.markdown', false)).toBe('.markdown')
    expect(nameToWrite('Second quarter', '.markdown')).toBe('Second quarter.markdown')
  })

  test('is nothing for a folder, which has none to keep', () => {
    expect(extensionOf('Work', true)).toBe('')
    expect(nameToWrite('Archive', '')).toBe('Archive')
  })

  test('is markdown for a note that somehow has none', () => {
    expect(extensionOf('Readme', false)).toBe('.md')
  })

  /** A paper is shown with its extension, so the field hands it back and a second
   *  copy of it would make `paper.pdf.pdf`. */
  test('is not added twice when the field already holds it', () => {
    expect(nameToWrite('paper.pdf', '.pdf')).toBe('paper.pdf')
    expect(nameToWrite('other', '.pdf')).toBe('other.pdf')
  })

  /** The file's spelling and not the reader's. `NOTE.MD` renamed by typing `Note.md`
   *  asks the disk for a name it already has under another spelling, which both
   *  Windows and a Mac refuse - and the row wore the name it could not have. */
  test('is the one the file wrote, whatever case the field holds it in', () => {
    expect(nameToWrite('paper.PDF', '.pdf')).toBe('paper.pdf')
    expect(nameToWrite('NOTE.md', '.MD')).toBe('NOTE.MD')
    expect(nameToWrite('Note.MD', '.md')).toBe('Note.md')
  })

  /** A run with a space in it is part of somebody's name, so renaming `v1.2 plan`
   *  no longer asks for `v1.3 plan.2 plan`. */
  test('is nothing a dot in the middle of a name made up', () => {
    expect(extensionOf('v1.2 plan.md', false)).toBe('.md')
    expect(nameToWrite('v1.3 plan', extensionOf('v1.2 plan.md', false))).toBe('v1.3 plan.md')
  })

  /** The ending the list took off, read back by the same rule; see note-name.ts. */
  test('is the ending the list leaves off', () => {
    expect(extensionOf('Board.canvas', false)).toBe('.canvas')
    expect(extensionOf('Sketch.pages', false)).toBe('.pages')
    expect(extensionOf('Svelte docs.url', false)).toBe('.url')
    expect(extensionOf('report.pdf', false)).toBe('.pdf')
    expect(extensionOf('NOTE.MD', false)).toBe('.MD')
    expect(extensionOf('a.canvas.md', false)).toBe('.md')
  })
})

describe('leaving the field', () => {
  const naming = { extension: '.md', taken: beside('Taken.md'), was: 'Plan' }

  test('writes the name that was typed', () => {
    expect(nameToCommit({ ...naming, typed: 'Second quarter' })).toBe('Second quarter.md')
  })

  test('does nothing with a name that cannot be written', () => {
    expect(nameToCommit({ ...naming, typed: 'Work/Plan' })).toBeNull()
    expect(nameToCommit({ ...naming, typed: 'Taken' })).toBeNull()
  })

  /** So a blur is safe to treat as a commit, which is what every file manager
   *  does: nothing to write is nothing to write, and the row is as it was. */
  test('does nothing with a name nobody changed', () => {
    expect(nameToCommit({ ...naming, typed: 'Plan' })).toBeNull()
    expect(nameToCommit({ ...naming, typed: '  Plan  ' })).toBeNull()
  })

  /** A row that is being made starts with nothing, and a row that was never
   *  named is a row that makes nothing. */
  test('and nothing with an empty field on a row that is being made', () => {
    expect(nameToCommit({ ...naming, was: '', typed: '' })).toBeNull()
    expect(nameToCommit({ ...naming, was: '', typed: 'Fresh' })).toBe('Fresh.md')
  })
})

/** The device names are held in two languages: the crate refuses them when the
 *  rename lands, and this module refuses them while the name is being typed. Two
 *  copies of one list is two answers waiting to disagree, so this reads the
 *  crate and holds them to the same one. */
describe('the names the crate keeps for devices', () => {
  const paths = readFileSync(
    fileURLToPath(new URL('../../src-tauri/src/paths.rs', import.meta.url)),
    'utf8',
  )

  test('are the ones this refuses, and no others', () => {
    const block = /pub const RESERVED: \[&str; (\d+)\] = \[([^\]]*)\]/.exec(paths)
    expect(block, 'the crate no longer states RESERVED as a list of names').not.toBeNull()

    const crate = [...(block?.[2] ?? '').matchAll(/"([^"]+)"/g)].map((one) => one[1] ?? '')
    expect(crate).toHaveLength(Number(block?.[1]))

    for (const name of crate) {
      expect(nameFault({ typed: name, extension: '.md', taken: [] }), name).toBe('reserved')
    }

    // And nothing this refuses is missing from the crate: a name the field takes
    // and the rename then throws out is the failure this module exists to stop.
    const refused = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'].filter(
      (name) => !crate.includes(name),
    )
    expect(refused).toEqual([])
  })
})
