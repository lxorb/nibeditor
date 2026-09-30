import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { buildBlockDecorations } from '../live-preview/blocks'
import { buildDecorations } from '../live-preview/decorate'
import { linkAt } from './at'
import { embedOfBlock } from './embed'
import { jumpAt } from './follow'
import {
  jumpFor,
  type NoteIndex,
  noteIndex,
  type NoteRef,
  resolveFile,
  resolveNote,
  resolveRelative,
  resolves,
} from './notes'
import { parsed } from '../../test/parsed'

/** Somewhere to park the caret that is outside every construct under test. */
const PARK = '\n\nx'

function note(
  path: string,
  headings: string[] = [],
  blocks: string[] = [],
  aliases: string[] = [],
): NoteRef {
  return {
    path,
    name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
    headings,
    blocks,
    aliases,
  }
}

function index(
  notes: NoteRef[],
  path: string | null = null,
  bodies: Record<string, string> = {},
  files: string[] = [],
) {
  const built: NoteIndex = {
    notes,
    files,
    path,
    read: (wanted) => Promise.resolve(bodies[wanted] ?? null),
  }
  return built
}

const SPACE = index(
  [note('Plan.md', ['Today', 'Later']), note('ideas/Plan.md'), note('ideas/Spark.md')],
  'Plan.md',
  {},
  ['paper.pdf', 'reading/Deep Learning.pdf', 'shot.png'],
)

function state(doc: string, cursor: number, notes = SPACE) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        noteIndex.of(notes),
      ],
    }),
  )
}

/** Every node of one name in a document, as the text it covers. */
function nodes(doc: string, name: string): string[] {
  const out: string[] = []
  const tree = syntaxTree(state(doc, 0))
  tree.iterate({
    enter: (node) => {
      if (node.name === name) out.push(doc.slice(node.from, node.to))
    },
  })
  return out
}

describe('the parser sees a wikilink', () => {
  test('in every spelling', () => {
    expect(nodes('a [[Note]] b', 'Wikilink')).toEqual(['[[Note]]'])
    expect(nodes('[[Note|shown]]', 'Wikilink')).toEqual(['[[Note|shown]]'])
    expect(nodes('[[Note#Heading]]', 'Wikilink')).toEqual(['[[Note#Heading]]'])
    expect(nodes('[[Note#^abc]]', 'Wikilink')).toEqual(['[[Note#^abc]]'])
    expect(nodes('![[Note]]', 'Wikilink')).toEqual(['![[Note]]'])
    expect(nodes('[[folder/A Note.md]]', 'Wikilink')).toEqual(['[[folder/A Note.md]]'])
  })

  test('with the marks around the words a reader sees', () => {
    expect(nodes('[[Note]]', 'WikilinkMark')).toEqual(['[[', ']]'])
    expect(nodes('[[Note|shown]]', 'WikilinkMark')).toEqual(['[[Note|', ']]'])
    expect(nodes('![[Note]]', 'WikilinkMark')).toEqual(['![[', ']]'])
    expect(nodes('[[ Note ]]', 'WikilinkMark')).toEqual(['[[ ', ' ]]'])
    // An alias that is only space is no alias, so the target is what shows.
    expect(nodes('[[Note| ]]', 'WikilinkMark')).toEqual(['[[', '| ]]'])
  })

  test('and does not see one where there is none', () => {
    expect(nodes('[[]]', 'Wikilink')).toEqual([])
    expect(nodes('[[a]b]]', 'Wikilink')).toEqual([])
    expect(nodes('[[a\nb]]', 'Wikilink')).toEqual([])
    expect(nodes('[single]', 'Wikilink')).toEqual([])
  })

  test('a backslash makes it text, as it does for any bracket', () => {
    expect(nodes('\\[[Note]]', 'Wikilink')).toEqual([])
  })

  test('code holds no links', () => {
    expect(nodes('`[[Note]]`', 'Wikilink')).toEqual([])
    expect(nodes('```\n[[Note]]\n```', 'Wikilink')).toEqual([])
  })

  test('the brackets are not read as a link or an image as well', () => {
    expect(nodes('[[Note]]', 'Link')).toEqual([])
    expect(nodes('![[pic.png]]', 'Image')).toEqual([])
  })
})

/** The link marks a document gets: the words shown, the target, and whether the
 *  space could answer for it. */
function linkMarks(doc: string, cursor?: number, notes = SPACE) {
  const full = cursor === undefined ? doc + PARK : doc
  const out: { text: string; note: string | null; missing: boolean }[] = []

  buildDecorations(state(full, cursor ?? full.length, notes)).decorations.between(
    0,
    full.length,
    (from, to, value) => {
      const classes = String(value.spec.class ?? '')
      if (!classes.includes('nib-link')) return

      out.push({
        text: full.slice(from, to),
        note: value.spec.attributes?.['data-note'] ?? null,
        missing: classes.includes('nib-link-missing'),
      })
    },
  )

  return out
}

/** Text the reader never sees. */
function concealed(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const out: string[] = []
  buildDecorations(state(full, cursor ?? full.length)).atomic.between(
    0,
    full.length,
    (from, to) => {
      out.push(full.slice(from, to))
    },
  )
  return out
}

describe('a link into a note the space has archived', () => {
  const archived = index([{ ...note('Plan.md'), archived: true }, note('Spark.md')], null)

  /** The classes each link wears, by the words it shows. */
  function looks(doc: string): Record<string, string> {
    const full = doc + PARK
    const out: Record<string, string> = {}
    buildDecorations(state(full, full.length, archived)).decorations.between(
      0,
      full.length,
      (from, to, value) => {
        const classes = String(value.spec.class ?? '')
        if (classes.includes('nib-link')) out[full.slice(from, to)] = classes
      },
    )
    return out
  }

  test('still resolves, and is drawn marked rather than missing', () => {
    expect(looks('[[Plan]] and [[Spark]] and [[Gone]]')).toEqual({
      Plan: 'nib-link nib-link-archived',
      Spark: 'nib-link',
      Gone: 'nib-link nib-link-missing',
    })
  })
})

describe('a wikilink in the live preview', () => {
  test('shows the target and hides the brackets', () => {
    expect(linkMarks('see [[Plan]] now')).toEqual([{ text: 'Plan', note: 'Plan', missing: false }])
    expect(concealed('see [[Plan]] now')).toEqual(['[[', ']]'])
  })

  test('shows the alias and hides the target with it', () => {
    expect(linkMarks('see [[Plan|the plan]] now')).toEqual([
      { text: 'the plan', note: 'Plan', missing: false },
    ])
    expect(concealed('see [[Plan|the plan]] now')).toEqual(['[[Plan|', ']]'])
  })

  test('keeps a heading and a block in what it shows', () => {
    expect(linkMarks('[[Plan#Today]]')).toEqual([
      { text: 'Plan#Today', note: 'Plan#Today', missing: false },
    ])
    expect(linkMarks('[[Plan#^abc]]')).toEqual([
      { text: 'Plan#^abc', note: 'Plan#^abc', missing: false },
    ])
  })

  test('a name nothing answers to is drawn muted', () => {
    expect(linkMarks('[[Nowhere]]')).toEqual([{ text: 'Nowhere', note: 'Nowhere', missing: true }])
  })

  test('a link into this note is never missing', () => {
    expect(linkMarks('[[#Today]]')).toEqual([{ text: '#Today', note: '#Today', missing: false }])
  })

  test('the caret inside shows the whole link as source', () => {
    const doc = 'see [[Plan|the plan]] now'
    expect(concealed(doc, 10)).toEqual([])
  })

  test('a markdown link into the space reads as a link between notes', () => {
    expect(linkMarks('see [the plan](ideas/Plan.md) now')).toEqual([
      { text: 'the plan', note: 'ideas/Plan.md', missing: false },
    ])
  })

  test('a markdown link out at the web is left to links.ts', () => {
    expect(linkMarks('see [docs](https://x.dev) now')).toEqual([
      { text: 'docs', note: null, missing: false },
    ])
  })

  test('unicode and spaces in a name survive', () => {
    const notes = index([note('Mémo für Späteres.md'), note('日本語のノート.md')])
    expect(linkMarks('[[Mémo für Späteres]]', undefined, notes)[0]).toMatchObject({
      text: 'Mémo für Späteres',
      missing: false,
    })
    expect(linkMarks('[[日本語のノート]]', undefined, notes)[0]).toMatchObject({ missing: false })
  })
})

describe('the name a block carries', () => {
  test('is hidden, with the space that separated it', () => {
    expect(concealed('A paragraph. ^abc123')).toEqual([' ^abc123'])
    expect(concealed('^on-its-own')).toEqual(['^on-its-own'])
  })

  test('comes back while the caret is on its line', () => {
    const doc = 'A paragraph. ^abc123\n\nmore'
    expect(concealed(doc, 3)).toEqual([])
    expect(concealed(doc, 24)).toEqual([' ^abc123'])
  })

  test('is nothing where there is no name', () => {
    expect(concealed('x^2 is a square')).toEqual([])
    expect(concealed('a^b')).toEqual([])
  })

  test('a caret inside code is code', () => {
    // The fence's own backticks hide as usual; nothing on the line inside does.
    expect(concealed('```\nxor eax ^abc\n```')).toEqual(['```', '```'])
  })

  test('a block link is not read as one', () => {
    expect(concealed('see [[Plan#^abc]]')).toEqual(['[[', ']]'])
  })
})

describe('which note a name means', () => {
  test('a whole path wins over the end of one', () => {
    expect(resolveNote(SPACE, 'ideas/Plan')?.path).toBe('ideas/Plan.md')
    expect(resolveNote(SPACE, 'ideas/Plan.md')?.path).toBe('ideas/Plan.md')
  })

  test('a bare name finds a note wherever it lives', () => {
    expect(resolveNote(index([note('deep/down/Spark.md')]), 'Spark')?.path).toBe(
      'deep/down/Spark.md',
    )
  })

  test('case does not matter', () => {
    expect(resolveNote(SPACE, 'sPaRk')?.path).toBe('ideas/Spark.md')
  })

  test('two notes of one name: the one beside the note that links to it', () => {
    const here = index([note('Plan.md'), note('ideas/Plan.md')], 'ideas/Notes.md')
    expect(resolveNote(here, 'Plan')?.path).toBe('ideas/Plan.md')

    const top = index([note('deep/Plan.md'), note('Plan.md')], 'Elsewhere.md')
    expect(resolveNote(top, 'Plan')?.path).toBe('Plan.md')
  })

  test('nothing at all is nothing', () => {
    expect(resolveNote(SPACE, 'Nowhere')).toBeNull()
    expect(resolveNote(SPACE, '   ')).toBeNull()
  })

  /** A website is a shortcut file, and it is a document of the space like a note:
   *  `[[Svelte docs]]` points at it without the extension, the way `[[Plan]]` points
   *  at `Plan.md`, and with the extension as well for anyone who writes it that way.
   *  See `OWN` in notes.ts. */
  test('a website answers to its name, with the extension or without', () => {
    const space = index([note('Svelte docs.url'), note('Plan.md')])
    expect(resolveNote(space, 'Svelte docs')?.path).toBe('Svelte docs.url')
    expect(resolveNote(space, 'Svelte docs.url')?.path).toBe('Svelte docs.url')
    expect(resolveNote(space, 'svelte DOCS')?.path).toBe('Svelte docs.url')
  })

  test('and a note of the same name wins, because a note is the older meaning', () => {
    const space = index([note('Plan.url'), note('Plan.md')])
    expect(resolveNote(space, 'Plan')?.path).toBe('Plan.md')
  })

  /** `Ü` as one letter, which a keyboard types, and as `U` with a combining mark,
   *  which is how some Mac tools name a file. Neither side is ever renamed. */
  test('a name matches however its letters are composed', () => {
    const decomposed = 'U\u0308bersicht'
    const space = index([note(`ideas/${decomposed}.md`)], null, {}, [`${decomposed}.pdf`])
    expect(resolveNote(space, 'Übersicht')?.path).toBe(`ideas/${decomposed}.md`)
    expect(resolveFile(space, 'Übersicht.pdf', 'wikilink')).toBe(`${decomposed}.pdf`)

    const other = index([note('Übersicht.md')], null, {}, ['Übersicht.pdf'])
    expect(resolveNote(other, decomposed)?.path).toBe('Übersicht.md')
    expect(resolveFile(other, `${decomposed}.pdf`, 'wikilink')).toBe('Übersicht.pdf')
  })

  test('a relative markdown target folds against the note it was written in', () => {
    const here = index([note('ideas/Spark.md'), note('Plan.md')], 'ideas/Deep/Note.md')
    expect(resolveRelative(here, '../Spark.md')?.path).toBe('ideas/Spark.md')
    expect(resolveRelative(here, '../../Plan.md')?.path).toBe('Plan.md')
    expect(resolveRelative(here, './Nothing.md')).toBeNull()
  })
})

/** A name a note gave itself in its own front matter. A file always wins: the
 *  aliases are only looked at when nothing in the space is called that. */
describe('a name a note answers to', () => {
  test('finds the note that declared it', () => {
    const notes = [note('Plan.md', [], [], ['Roadmap', 'The plan'])]
    expect(resolveNote(index(notes), 'Roadmap')?.path).toBe('Plan.md')
    expect(resolveNote(index(notes), 'The plan')?.path).toBe('Plan.md')
  })

  test('is read whatever case it is written in', () => {
    const notes = [note('Plan.md', [], [], ['Roadmap'])]
    expect(resolveNote(index(notes), 'roadmap')?.path).toBe('Plan.md')
  })

  test('gives way to a file of that name', () => {
    const notes = [note('Plan.md', [], [], ['Roadmap']), note('Roadmap.md')]
    expect(resolveNote(index(notes), 'Roadmap')?.path).toBe('Roadmap.md')
  })

  test('picks the nearest where two notes answer to it', () => {
    const notes = [
      note('far/Plan.md', [], [], ['Roadmap']),
      note('here/Other.md', [], [], ['Roadmap']),
    ]
    expect(resolveNote(index(notes, 'here/Note.md'), 'Roadmap')?.path).toBe('here/Other.md')
  })

  test('is a link that resolves, so it is not drawn as a name nothing answers to', () => {
    const notes = [note('Plan.md', [], [], ['Roadmap'])]
    const link = { target: 'Roadmap', heading: null, block: null, alias: null, embed: false }
    expect(resolves(index(notes), link, 'wikilink')).toBe(true)
  })

  test('is nothing when no note claims it', () => {
    expect(resolveNote(index([note('Plan.md')]), 'Roadmap')).toBeNull()
  })
})

describe('where a link goes', () => {
  const wiki = (target: string, heading: string | null = null, block: string | null = null) => ({
    target,
    heading,
    block,
    alias: null,
    embed: false,
  })

  test('to the note it names, with the heading it names', () => {
    expect(jumpFor(SPACE, wiki('ideas/Spark', 'Later'), 'wikilink')).toEqual({
      path: 'ideas/Spark.md',
      target: 'ideas/Spark',
      heading: 'Later',
      block: null,
      page: null,
    })
  })

  test('to nowhere for a name nothing answers to, which is the cue to make it', () => {
    expect(jumpFor(SPACE, wiki('Nowhere'), 'wikilink').path).toBeNull()
    expect(resolves(SPACE, wiki('Nowhere'), 'wikilink')).toBe(false)
  })

  test('to this note for a link with no target', () => {
    expect(jumpFor(SPACE, wiki('', 'Today'), 'wikilink').path).toBe('Plan.md')
  })

  test('to a PDF in the space, at the page it names', () => {
    expect(jumpFor(SPACE, wiki('paper.pdf', 'page=3'), 'wikilink')).toEqual({
      path: 'paper.pdf',
      target: 'paper.pdf',
      heading: null,
      block: null,
      page: 3,
    })
  })

  test('to a PDF with no page for a link that names none', () => {
    expect(jumpFor(SPACE, wiki('Deep Learning.pdf'), 'wikilink')).toEqual({
      path: 'reading/Deep Learning.pdf',
      target: 'Deep Learning.pdf',
      heading: null,
      block: null,
      page: null,
    })
  })

  test('a markdown link to a PDF folds against the note it was written in', () => {
    const here = index([note('ideas/Note.md')], 'ideas/Note.md', {}, ['reading/paper.pdf'])
    expect(jumpFor(here, wiki('../reading/paper.pdf', 'page=2'), 'markdown')).toMatchObject({
      path: 'reading/paper.pdf',
      page: 2,
    })
  })

  test('a PDF the space does not hold is not a note to make', () => {
    const jump = jumpFor(SPACE, wiki('missing.pdf', 'page=1'), 'wikilink')
    expect(jump.path).toBeNull()
    expect(jump.page).toBe(1)
    expect(resolves(SPACE, wiki('missing.pdf'), 'wikilink')).toBe(false)
  })

  test('a PDF the space holds resolves, so the link is not drawn as missing', () => {
    expect(resolves(SPACE, wiki('paper.pdf'), 'wikilink')).toBe(true)
    expect(resolves(SPACE, wiki('PAPER.PDF'), 'wikilink')).toBe(true)
  })

  test('a file Nib cannot open stays unresolved', () => {
    expect(resolves(SPACE, wiki('shot.png'), 'wikilink')).toBe(false)
  })

  test('what a click on one would do, read off the document', () => {
    const doc = 'see [[ideas/Spark#Later]] and [[Nowhere]] and plain words'
    const where = state(doc, 0)

    expect(jumpAt(where, doc.indexOf('Spark'))).toEqual({
      path: 'ideas/Spark.md',
      target: 'ideas/Spark',
      heading: 'Later',
      block: null,
      page: null,
    })
    expect(jumpAt(where, doc.indexOf('Nowhere'))).toEqual({
      path: null,
      target: 'Nowhere',
      heading: null,
      block: null,
      page: null,
    })
    expect(jumpAt(where, doc.indexOf('plain'))).toBeNull()
  })
})

describe('the link under a position', () => {
  test('is found from inside it and from either edge', () => {
    const doc = 'see [[Plan#Today]] now'
    for (const at of [4, 8, 18]) {
      expect(linkAt(state(doc, 0), at)).toMatchObject({ target: 'Plan', heading: 'Today' })
    }
  })

  test('is nothing where there is no link', () => {
    expect(linkAt(state('plain words', 0), 3)).toBeNull()
  })

  test('reads a markdown link as well', () => {
    expect(linkAt(state('[a](ideas/Plan.md)', 0), 2)).toMatchObject({
      kind: 'markdown',
      target: 'ideas/Plan.md',
      alias: 'a',
    })
  })
})

/** Whole-line constructs replaced by a rendered block. */
function blocks(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const out: string[] = []
  buildBlockDecorations(state(full, cursor ?? full.length)).between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

describe('an embed', () => {
  test('alone between blank lines is drawn as the note', () => {
    expect(blocks('one\n\n![[Plan]]\n\ntwo')).toEqual(['![[Plan]]'])
  })

  test('with words beside it stays a link', () => {
    expect(blocks('see ![[Plan]] here')).toEqual([])
    expect(linkMarks('see ![[Plan]] here')).toEqual([
      { text: 'Plan', note: 'Plan', missing: false },
    ])
  })

  test('on a line inside a paragraph stays a link', () => {
    expect(blocks('one\n![[Plan]]\ntwo')).toEqual([])
  })

  test('is source again while the caret is in it', () => {
    expect(blocks('one\n\n![[Plan]]\n\ntwo', 8)).toEqual([])
  })

  test('a picture is a picture wherever it is written', () => {
    expect(blocks('one\n\n![[pic.png]]\n\ntwo')).toEqual([])
    expect(concealed('one\n\n![[pic.png]]\n\ntwo')).toEqual(['![[pic.png]]'])
  })

  test('the block reading and the inline reading agree', () => {
    const doc = 'one\n\n![[Plan]]\n\ntwo'
    const found = embedOfBlock(state(doc, 0), 5, 14)
    expect(found).toMatchObject({ target: 'Plan', embed: true })
    expect(embedOfBlock(state('x ![[Plan]]', 0), 2, 11)).toBeNull()
  })

  test('a recording and a film are drawn where they stand, like a picture', () => {
    for (const name of ['clip.mp3', 'demo.mp4', 'demo.webm']) {
      const doc = `one\n\n![[${name}]]\n\ntwo`
      expect(blocks(doc), name).toEqual([])
      expect(concealed(doc), name).toEqual([`![[${name}]]`])
    }
  })

  test('a paper and a plane are cards of their own, which needs a line to itself', () => {
    expect(blocks('one\n\n![[paper.pdf#page=3]]\n\ntwo')).toEqual(['![[paper.pdf#page=3]]'])
    expect(blocks('one\n\n![[Board.canvas]]\n\ntwo')).toEqual(['![[Board.canvas]]'])
    // In a sentence there is no room for a card, so it reads as a link.
    expect(blocks('see ![[paper.pdf]] here')).toEqual([])
  })

  test('and every kind is source again while the caret is in it', () => {
    for (const doc of [
      'one\n\n![[clip.mp3]]\n\ntwo',
      'one\n\n![[paper.pdf]]\n\ntwo',
      'one\n\n![[Board.canvas]]\n\ntwo',
    ]) {
      expect(blocks(doc, 8), doc).toEqual([])
      expect(concealed(doc, 8), doc).toEqual([])
    }
  })
})
