import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { blockNamer, wikilinkCompletions } from './complete'
import {
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndex,
  type NoteRef,
  type SpaceBlock,
} from './notes'
import { parsed } from '../../test/parsed'

/** What the space offers, and what it was asked for: every test below counts the
 *  work as well as reading the rows, because the whole promise of the two
 *  space-wide lists is that neither of them reads a space. */
interface Asked {
  index: NoteIndex
  /** One entry per note read, in order. */
  reads: string[]
  /** One entry per search of the space. */
  searches: string[]
}

function note(path: string, headings: string[] = [], blocks: string[] = []): NoteRef {
  return {
    path,
    name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
    headings,
    blocks,
    aliases: [],
  }
}

function space(
  notes: NoteRef[],
  options: { path?: string | null; bodies?: Record<string, string>; found?: SpaceBlock[] } = {},
): Asked {
  const asked: Asked = {
    reads: [],
    searches: [],
    index: { notes, files: [], path: null, read: () => Promise.resolve(null) },
  }

  asked.index = {
    notes,
    files: [],
    path: options.path ?? null,
    read: (wanted) => {
      asked.reads.push(wanted)
      return Promise.resolve(options.bodies?.[wanted] ?? null)
    },
    searchBlocks: (text) => {
      asked.searches.push(text)
      return Promise.resolve(options.found ?? [])
    },
  }

  return asked
}

/** A writer that spells out every fact the row handed over rather than only the
 *  ones a wikilink keeps, so a test can see what the popup knew. The app's own
 *  writer makes a markdown link out of the same four facts; see link-format.ts. */
function spelled(target: LinkWrite): string {
  return `[${target.name}](${target.path ?? ''}|${target.from ?? ''}|${target.fragment ?? ''})`
}

function state(
  doc: string,
  index: NoteIndex,
  at = doc.length,
  write?: (target: LinkWrite) => string,
): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        noteIndex.of(index),
        blockNamer.of((path, line) => Promise.resolve(`from-${path.replace(/\W/g, '')}-${line}`)),
        ...(write ? [linkWriter.of(write)] : []),
      ],
    }),
  )
}

/** The rows for a document whose caret is at its end. */
async function rowsFor(doc: string, asked: Asked): Promise<CompletionResult | null> {
  const built = state(doc, asked.index)
  return await wikilinkCompletions(new CompletionContext(built, doc.length, false))
}

function labels(found: CompletionResult | null): string[] {
  return (found?.options ?? []).map((one) => one.label)
}

function details(found: CompletionResult | null): (string | undefined)[] {
  return (found?.options ?? []).map((one) => one.detail)
}

/** Picks one row, and answers with the document it left behind and where the
 *  caret went. No DOM: a completion's `apply` reads the document and dispatches,
 *  which is all of a view it ever touches. */
async function picked(
  doc: string,
  asked: Asked,
  label: string,
  write?: (target: LinkWrite) => string,
): Promise<{ doc: string; head: number }> {
  const found = await rowsFor(doc, asked)
  const row = found?.options.find((one) => one.label === label)
  if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)

  let built = state(doc, asked.index, doc.length, write)
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView

  row.apply(view, row, found.from, doc.length)
  // The block namer answers in a microtask, so the link it writes lands in one.
  await Promise.resolve()
  await Promise.resolve()

  return { doc: built.doc.toString(), head: built.selection.main.head }
}

const SPACE = [
  note('Plan.md', ['Today', 'The plan for Monday'], ['a1b2c3']),
  note('ideas/Spark.md', ['Sparks']),
]

describe('every heading of the space, behind `[[##`', () => {
  test('offers them all, with the note each is in beside it', async () => {
    const asked = space(SPACE)
    const found = await rowsFor('[[##', asked)

    expect(labels(found)).toEqual(['Today', 'The plan for Monday', 'Sparks'])
    expect(details(found)).toEqual(['Plan', 'Plan', 'Spark'])
  })

  test('finds one by a few of its letters, wherever they are', async () => {
    expect(labels(await rowsFor('[[##pln', space(SPACE)))).toEqual(['The plan for Monday'])
    expect(labels(await rowsFor('[[##spk', space(SPACE)))).toEqual(['Sparks'])
  })

  test('starts the popup past the two hashes, so the rows filter on the words', async () => {
    const found = await rowsFor('[[##pl', space(SPACE))
    expect(found?.from).toBe('[[##'.length)
  })

  test('writes the whole link and takes the hashes with it', async () => {
    const written = await picked('[[##pln', space(SPACE), 'The plan for Monday')

    expect(written.doc).toBe('[[Plan#The plan for Monday]]')
    expect(written.head).toBe(written.doc.length)
  })

  test('steps over a closing pair that is already there', async () => {
    const asked = space(SPACE)
    const built = state('[[##pln]]', asked.index, '[[##pln'.length)
    const found = await wikilinkCompletions(new CompletionContext(built, '[[##pln'.length, false))
    const row = found?.options[0]
    if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')

    let now = built
    const view = {
      get state() {
        return now
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state
      },
    } as unknown as EditorView

    row.apply(view, row, found.from, '[[##pln'.length)
    expect(now.doc.toString()).toBe('[[Plan#The plan for Monday]]')
    expect(now.selection.main.head).toBe(now.doc.length)
  })

  test('reads no note at all, whatever the space holds', async () => {
    const many = Array.from({ length: 500 }, (_, at) =>
      note(`folder/Note ${at}.md`, ['A heading', 'Another heading', 'A third']),
    )
    const asked = space(many)
    const found = await rowsFor('[[##head', asked)

    expect(asked.reads).toEqual([])
    expect(asked.searches).toEqual([])
    // A list and not a thousand rows.
    expect(found?.options.length).toBe(40)
  })

  test('leaves the popup to filter what came back rather than asking again', async () => {
    const found = await rowsFor('[[##p', space(SPACE))

    // What is typed next still matches, so the source is not asked a second time.
    expect(found?.validFor).toBeInstanceOf(RegExp)
    expect((found?.validFor as RegExp).test('plan for')).toBe(true)
  })
})

describe('every block of the space, behind `[[^^`', () => {
  test('offers the ones that already have a name, out of the index', async () => {
    const asked = space(SPACE)
    const found = await rowsFor('[[^^', asked)

    expect(labels(found)).toEqual(['^a1b2c3'])
    expect(details(found)).toEqual(['Plan'])
    // One character is not a question worth asking a space.
    expect(asked.searches).toEqual([])
    expect(asked.reads).toEqual([])
  })

  test('writes a link to a named one without touching any note', async () => {
    const asked = space(SPACE)
    const written = await picked('[[^^a1b', asked, '^a1b2c3')

    expect(written.doc).toBe('[[Plan#^a1b2c3]]')
    // The rows came from the index; the search that ran beside them read no note
    // and found nothing to add.
    expect(asked.reads).toEqual([])
  })

  test('asks the space once two characters are in, and never reads a note', async () => {
    const asked = space(SPACE, {
      found: [
        { path: 'ideas/Spark.md', line: 4, text: 'the second half of the plan', id: null },
        { path: 'Plan.md', line: 9, text: 'a plan already named', id: 'zz9999' },
      ],
    })
    const found = await rowsFor('[[^^plan', asked)

    expect(asked.searches).toEqual(['plan'])
    expect(asked.reads).toEqual([])
    expect(labels(found)).toEqual([
      // The named ones first, then what the words found.
      'the second half of the plan',
      'a plan already named',
    ])
    expect(details(found)).toEqual(['Spark', 'Plan'])
  })

  test('links a found block by the name it has', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'Plan.md', line: 9, text: 'a plan already named', id: 'zz9999' }],
    })

    expect((await picked('[[^^plan', asked, 'a plan already named')).doc).toBe('[[Plan#^zz9999]]')
  })

  test('names one that has no name yet, through the app, and links that', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'ideas/Spark.md', line: 4, text: 'the second half', id: null }],
    })
    const written = await picked('[[^^second', asked, 'the second half')

    expect(written.doc).toBe('[[Spark#^from-ideasSparkmd-4]]')
  })

  test('leaves the blocks of the note being written in to `[[#^`', async () => {
    const asked = space(SPACE, {
      path: 'Plan.md',
      found: [{ path: 'Plan.md', line: 2, text: 'a line of this very note', id: null }],
    })

    expect(labels(await rowsFor('[[^^line', asked))).toEqual([])
  })

  test('offers nothing where the editor is standing on its own', async () => {
    const alone: NoteIndex = {
      notes: SPACE,
      files: [],
      path: null,
      read: () => Promise.resolve(null),
    }
    const built = state('[[^^plan', alone)
    const found = await wikilinkCompletions(new CompletionContext(built, '[[^^plan'.length, false))

    // The named blocks the index knows, and nothing found by words: there is
    // nothing here that could search a space.
    expect(labels(found)).toEqual([])
  })
})

describe('the lists that were already there', () => {
  test('a bare `[[` still offers the notes', async () => {
    expect(labels(await rowsFor('[[', space(SPACE)))).toEqual(['Plan', 'Spark'])
  })

  test('`[[Note#` still offers that one note headings', async () => {
    expect(labels(await rowsFor('[[Plan#', space(SPACE)))).toEqual(['Today', 'The plan for Monday'])
  })

  test('`[[Note#^` still reads that one note, and only that one', async () => {
    const asked = space(SPACE, { bodies: { 'Plan.md': 'first block\n\nsecond block\n' } })
    const found = await rowsFor('[[Plan#^', asked)

    expect(asked.reads).toEqual(['Plan.md'])
    expect(labels(found)).toEqual(['first block', 'second block'])
  })
})

/** The Links setting is the app's, and the app answers it in one writer; the popup
 *  hands that writer what it knows and puts back whatever comes out. Every kind of
 *  row here, because the whole of the bug was that one of them wrote a wikilink
 *  whatever the setting said - and all of them did.
 *
 *  What the four spellings actually look like is the app's own test, over a nested
 *  space: see link-format.test.ts. */
describe('every row writes the link the app spells', () => {
  const ALIASED: NoteRef[] = [
    { ...note('ideas/Spark.md', ['Sparks'], ['b2c3d4']), aliases: ['The spark'] },
  ]

  test('a note row hands over its name, its path and the note being written in', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[Spa', asked, 'Spark', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|)',
    )
  })

  test('an alias row writes the alias over the note it belongs to', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[spa', asked, 'The spark', spelled)).doc).toBe(
      '[The spark](ideas/Spark.md|journal/Monday.md|)',
    )
  })

  test('a heading row of one note carries the heading', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[Spark#Spa', asked, 'Sparks', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|Sparks)',
    )
  })

  test('a block row of one note carries the block it already answers to', async () => {
    const asked = space(ALIASED, {
      path: 'journal/Monday.md',
      bodies: { 'ideas/Spark.md': 'a line of it ^b2c3d4\n' },
    })

    expect((await picked('[[Spark#^', asked, 'a line of it', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^b2c3d4)',
    )
  })

  test('a block the app had to name carries the name it gave it', async () => {
    const asked = space(ALIASED, {
      path: 'journal/Monday.md',
      bodies: { 'ideas/Spark.md': 'a line with no name\n' },
    })

    expect((await picked('[[Spark#^', asked, 'a line with no name', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^from-ideasSparkmd-0)',
    )
  })

  test('a `[[##` row carries the heading and takes the hashes with it', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[##spk', asked, 'Sparks', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|Sparks)',
    )
  })

  test('a `[[^^` row out of the index carries the block', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[^^b2c', asked, '^b2c3d4', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^b2c3d4)',
    )
  })

  test('a `[[^^` row the search found carries it too, named or not', async () => {
    const named = space(ALIASED, {
      path: 'journal/Monday.md',
      found: [{ path: 'ideas/Spark.md', line: 9, text: 'already named', id: 'zz9999' }],
    })
    expect((await picked('[[^^alrea', named, 'already named', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^zz9999)',
    )

    const fresh = space(ALIASED, {
      path: 'journal/Monday.md',
      found: [{ path: 'ideas/Spark.md', line: 4, text: 'not named yet', id: null }],
    })
    expect((await picked('[[^^not n', fresh, 'not named yet', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^from-ideasSparkmd-4)',
    )
  })

  /** A link into the note it is written in has no name to write, which is exactly
   *  what `[[#Heading]]` is - and what the app spells as an anchor on its own. */
  test('a heading of this very note hands over no name at all', async () => {
    const asked = space([note('Plan.md', ['Today'])], { path: 'Plan.md' })

    expect((await picked('[[#Tod', asked, 'Today', spelled)).doc).toBe('[](Plan.md|Plan.md|Today)')
  })

  test('writes a wikilink where nothing told it otherwise, as it always has', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })

    expect((await picked('[[Spa', asked, 'Spark')).doc).toBe('[[Spark]]')
    expect((await picked('[[Spark#Spa', asked, 'Sparks')).doc).toBe('[[Spark#Sparks]]')
  })
})
