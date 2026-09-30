import { describe, expect, test } from 'vitest'
import { NoteDoc, type TabKind, UNTITLED } from './documents.svelte'
import {
  draftFile,
  fileNamed,
  hasWords,
  isDraft,
  isUnsaved,
  namedByWords,
  offeredName,
} from './drafts'

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

describe('a tab waiting for a place', () => {
  test('is a draft, or a web tab nobody has kept, and nothing with a file', () => {
    expect(isUnsaved(doc(''))).toBe(true)
    expect(isUnsaved(doc('', { kind: 'web', name: 'Site' }))).toBe(true)
    expect(isUnsaved(doc('', { kind: 'web', path: '/space/Site.url' }))).toBe(false)
    expect(isUnsaved(doc('', { kind: 'terminal', name: 'pwsh' }))).toBe(false)
    expect(isUnsaved(doc('', { kind: 'graph', name: 'Graph' }))).toBe(false)
  })

  /** A browser tab has nothing unwritten in it, so only the draft wears the dot. */
  test('wears the dot only where it has words of its own', () => {
    expect(isDraft(doc('', { kind: 'canvas' }))).toBe(true)
    expect(isDraft(doc('', { kind: 'web', name: 'Site' }))).toBe(false)
  })

  test('a plane has something worth keeping once anything was drawn on it', () => {
    const plane = doc('{}', { kind: 'canvas' })
    expect(hasWords(plane)).toBe(false)

    plane.live.replace('{"nodes":[{"id":"a"}]}', true)
    expect(hasWords(plane)).toBe(true)
  })
})

describe('the name Save offers', () => {
  test('is a note’s first heading or line, and Untitled where there is none', () => {
    expect(offeredName(doc('# Plan for Monday\n\nwords'))).toBe('Plan for Monday')
    expect(offeredName(doc(''))).toBe(UNTITLED)
  })

  test('is a web tab’s page title, as a file can hold it', () => {
    expect(offeredName(doc('', { kind: 'web', name: 'x.com' }), 'Home / X')).toBe('Home X')
    expect(offeredName(doc('', { kind: 'web', name: 'svelte.dev' }))).toBe('svelte.dev')
    // A page that has said nothing yet is called what its tab is.
    expect(offeredName(doc('', { kind: 'web', name: 'Website' }), '')).toBe('Website')
  })

  test('is the name an import came with', () => {
    expect(offeredName(doc('# Other', { name: 'Report.md' }))).toBe('Report')
  })
})
