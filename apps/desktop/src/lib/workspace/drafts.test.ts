import { describe, expect, test } from 'vitest'
import { NoteDoc, type TabKind, UNTITLED } from './documents.svelte'
import { draftFile, fileNamed, followedName, hasWords, isDraft, namedByWords } from './drafts'

/** How a test document differs from a blank draft note. */
interface Made {
  path?: string | null
  kind?: TabKind
  name?: string
}

/** A tab's document: a draft where there is no path. */
function doc(text: string, { path = null, kind = 'note', name = UNTITLED }: Made = {}) {
  return new NoteDoc({ kind, path, name, text, dirty: false }, () => undefined)
}

/** What a folder holding nothing else steps a name to: the name itself. */
const free = (file: string) => file

describe('a draft', () => {
  test('is a document with words of its own and no file for them', () => {
    expect(isDraft(doc(''))).toBe(true)
    expect(isDraft(doc('', { path: '/space/Plan.md' }))).toBe(false)
  })

  test('is not a file somebody shared on its own, whose room keeps it', () => {
    const shared = new NoteDoc(
      { kind: 'note', path: null, name: 'Plan', text: 'x', dirty: false, shared: 'id' },
      () => undefined,
    )
    expect(isDraft(shared)).toBe(false)
  })

  test('has words once it holds a character that is not white space', () => {
    expect(hasWords(doc(''))).toBe(false)
    expect(hasWords(doc('  \n\t'))).toBe(false)
    expect(hasWords(doc('a'))).toBe(true)
  })

  /** Asked on each change until it has words, so it reads a fixed slice and never
   *  the whole of a paste. */
  test('with a very long paste of white space and then words has words', () => {
    expect(hasWords(doc(`${' '.repeat(5000)}a`))).toBe(true)
  })
})

describe('the file a draft becomes', () => {
  test('is named after its first heading, or its first line', () => {
    expect(draftFile(doc('# Plan for Monday\n\nwords'))).toBe('Plan for Monday.md')
    expect(draftFile(doc('Groceries\n- milk'))).toBe('Groceries.md')
  })

  test('with only what a filesystem takes, cut to a name’s length', () => {
    expect(draftFile(doc('Q1: costs/savings?'))).toBe('Q1 costs savings.md')
    expect(draftFile(doc('x'.repeat(200))).length).toBe(60 + '.md'.length)
  })

  test('keeps the name it came with, where it came with one', () => {
    const imported = doc('# Something else', { name: 'Report' })
    expect(draftFile(imported)).toBe('Report.md')
    expect(namedByWords(imported)).toBe(false)
  })

  test('a plane and a deck are Untitled under their own ending', () => {
    expect(draftFile(doc('{}', { kind: 'canvas' }))).toBe('Untitled.canvas')
    expect(fileNamed('Untitled', 'pages')).toBe('Untitled.pages')
    expect(fileNamed('Plan.canvas', 'canvas')).toBe('Plan.canvas')
  })
})

describe('a note that follows its words', () => {
  test('asks for the name its first line gives now', () => {
    const note = doc('# Plan', { path: '/space/P.md', name: 'P.md' })
    note.follows = true
    expect(followedName(note, free)).toBe('Plan.md')
  })

  test('and nothing where its file is already called that', () => {
    const note = doc('# Plan', { path: '/space/Plan.md', name: 'Plan.md' })
    note.follows = true
    expect(followedName(note, free)).toBeNull()
  })

  /** `Plan 2.md` beside somebody else's `Plan.md` is already what `Plan` asks for. */
  test('and nothing where the folder stepped it aside to the name it has', () => {
    const note = doc('# Plan', { path: '/space/Plan 2.md', name: 'Plan 2.md' })
    note.follows = true
    expect(followedName(note, () => 'Plan 2.md')).toBeNull()
  })

  /** Windows and a Mac call those one file, and refuse the rename. */
  test('and nothing where only the case of its words changed', () => {
    const note = doc('# Plan', { path: '/space/plan.md', name: 'plan.md' })
    note.follows = true
    expect(followedName(note, free)).toBeNull()
  })

  test('and nothing at all once somebody named it', () => {
    const note = doc('# Plan', { path: '/space/P.md', name: 'P.md' })
    expect(followedName(note, free)).toBeNull()
  })

  test('is called after its words on its tab as they are typed, not as the file catches up', () => {
    const note = doc('# Plan', { path: '/space/P.md', name: 'P.md' })
    note.follows = true
    note.live.replace('# Plan for Monday', true)

    expect(note.shown).toBe('Plan for Monday')
  })
})
