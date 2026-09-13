import { describe, expect, test } from 'vitest'
import {
  blockIdOf,
  blockIds,
  embedKind,
  embedSize,
  findLinks,
  formatWikilink,
  isAudioTarget,
  isNoteTarget,
  isCanvasTarget,
  isImageTarget,
  isPdfTarget,
  isTabFile,
  isVideoTarget,
  isWebTarget,
  MOST_LINKS,
  linkTarget,
  pageFragment,
  parseWikilink,
  headingsOf,
  sectionOf,
  shownText,
  withoutBlockIds,
} from './links'

describe('what is between the brackets', () => {
  test('a bare name', () => {
    expect(parseWikilink('Note')).toEqual({
      target: 'Note',
      heading: null,
      block: null,
      alias: null,
      embed: false,
    })
  })

  test('a name with spaces and letters of any script', () => {
    expect(parseWikilink('Mémo für Späteres')?.target).toBe('Mémo für Späteres')
    expect(parseWikilink('日本語のノート')?.target).toBe('日本語のノート')
    expect(parseWikilink('folder/Some Note.md')?.target).toBe('folder/Some Note.md')
  })

  test('space around the name is not part of it', () => {
    expect(parseWikilink('  Note  ')?.target).toBe('Note')
  })

  test('the bar names what to show', () => {
    expect(parseWikilink('Note|shown text')).toMatchObject({
      target: 'Note',
      alias: 'shown text',
    })
  })

  test('everything after the first bar is the alias, bars included', () => {
    expect(parseWikilink('Note|a | b')?.alias).toBe('a | b')
  })

  test('the hash names a heading', () => {
    expect(parseWikilink('Note#Some Heading')).toMatchObject({
      target: 'Note',
      heading: 'Some Heading',
      block: null,
    })
  })

  test('hash caret names a block', () => {
    expect(parseWikilink('Note#^abc123')).toMatchObject({
      target: 'Note',
      heading: null,
      block: 'abc123',
    })
  })

  test('a heading and an alias together', () => {
    expect(parseWikilink('Note#Heading|shown')).toMatchObject({
      target: 'Note',
      heading: 'Heading',
      alias: 'shown',
    })
  })

  test('no target means this note', () => {
    expect(parseWikilink('#Heading')).toMatchObject({ target: '', heading: 'Heading' })
    expect(parseWikilink('#^abc')).toMatchObject({ target: '', block: 'abc' })
  })

  test('nothing to point at is not a link', () => {
    expect(parseWikilink('')).toBeNull()
    expect(parseWikilink('   ')).toBeNull()
    expect(parseWikilink('|only an alias')).toBeNull()
  })

  test('an embed says so', () => {
    expect(parseWikilink('Note', true)?.embed).toBe(true)
  })
})

describe('a link written back as source', () => {
  const round = (inner: string, embed = false) => {
    const link = parseWikilink(inner, embed)
    expect(link).not.toBeNull()
    return link && formatWikilink(link)
  }

  test('comes out as it went in', () => {
    expect(round('Note')).toBe('[[Note]]')
    expect(round('Note|shown')).toBe('[[Note|shown]]')
    expect(round('Note#Heading')).toBe('[[Note#Heading]]')
    expect(round('Note#^abc123')).toBe('[[Note#^abc123]]')
    expect(round('Note#Heading|shown')).toBe('[[Note#Heading|shown]]')
    expect(round('Note', true)).toBe('![[Note]]')
    expect(round('#Heading')).toBe('[[#Heading]]')
  })
})

describe('the words a link shows', () => {
  test('the alias when it has one, the target when it does not', () => {
    expect(shownText(parseWikilink('Note|shown')!)).toBe('shown')
    expect(shownText(parseWikilink('Note#Heading')!)).toBe('Note#Heading')
    expect(linkTarget(parseWikilink('Note#^id')!)).toBe('Note#^id')
  })
})

describe('which targets belong to the space', () => {
  test('a relative path and a fragment do', () => {
    expect(isNoteTarget('Note.md')).toBe(true)
    expect(isNoteTarget('../other/Note.md')).toBe(true)
    expect(isNoteTarget('#heading')).toBe(true)
  })

  test('the web does not', () => {
    expect(isNoteTarget('https://x.dev')).toBe(false)
    expect(isNoteTarget('mailto:a@b.dev')).toBe(false)
    expect(isNoteTarget('//x.dev/a')).toBe(false)
    expect(isNoteTarget('javascript:alert(1)')).toBe(false)
  })
})

describe('which targets name a PDF', () => {
  test('anything ending in the extension, in either case', () => {
    expect(isPdfTarget('paper.pdf')).toBe(true)
    expect(isPdfTarget('reading/Deep Learning.PDF')).toBe(true)
    expect(isPdfTarget('  paper.pdf  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isPdfTarget('paper')).toBe(false)
    expect(isPdfTarget('paper.pdf.md')).toBe(false)
    expect(isPdfTarget('pdf')).toBe(false)
    expect(isPdfTarget('')).toBe(false)
  })
})

describe('which targets name a canvas', () => {
  test('anything ending in the extension, in either case', () => {
    expect(isCanvasTarget('Board.canvas')).toBe(true)
    expect(isCanvasTarget('boards/Quarter.CANVAS')).toBe(true)
    expect(isCanvasTarget('  Board.canvas  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isCanvasTarget('Board')).toBe(false)
    expect(isCanvasTarget('Board.canvas.md')).toBe(false)
    expect(isCanvasTarget('canvas')).toBe(false)
    expect(isCanvasTarget('')).toBe(false)
  })
})

describe('which targets name a picture', () => {
  test('every extension a browser draws, in either case', () => {
    expect(isImageTarget('a/b/pic.PNG')).toBe(true)
    expect(isImageTarget('shot.jpeg')).toBe(true)
    expect(isImageTarget('drawing.svg')).toBe(true)
    expect(isImageTarget('  frame.apng  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isImageTarget('Note.md')).toBe(false)
    expect(isImageTarget('Note')).toBe(false)
    expect(isImageTarget('png')).toBe(false)
    expect(isImageTarget('')).toBe(false)
  })
})

describe('which targets name sound or a film', () => {
  test('the extensions a browser plays, in either case', () => {
    expect(isAudioTarget('take.MP3')).toBe(true)
    expect(isAudioTarget('a/b/talk.m4a')).toBe(true)
    expect(isAudioTarget('  memo.opus  ')).toBe(true)
    expect(isVideoTarget('demo.mp4')).toBe(true)
    expect(isVideoTarget('clip.MOV')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isAudioTarget('Note.md')).toBe(false)
    expect(isAudioTarget('mp3')).toBe(false)
    expect(isAudioTarget('song.mp3.md')).toBe(false)
    expect(isVideoTarget('')).toBe(false)
  })
})

describe('what kind of thing an embed names', () => {
  test('one answer per file, and none for a note', () => {
    expect(embedKind('shot.png')).toBe('image')
    expect(embedKind('take.mp3')).toBe('audio')
    expect(embedKind('demo.mp4')).toBe('video')
    expect(embedKind('paper.pdf')).toBe('pdf')
    expect(embedKind('Board.canvas')).toBe('canvas')
    expect(embedKind('Another note')).toBe(null)
    expect(embedKind('')).toBe(null)
  })

  test('a container either can be in is read as what it usually holds', () => {
    expect(embedKind('a.webm')).toBe('video')
    expect(embedKind('a.weba')).toBe('audio')
    // Ogg went the other way round: `.ogg` meant sound before `.ogv` existed.
    expect(embedKind('a.ogg')).toBe('audio')
    expect(embedKind('a.ogv')).toBe('video')
  })

  test('is a wider question than what opens in a tab of its own', () => {
    expect(embedKind('take.mp3')).toBe('audio')
    expect(isTabFile('take.mp3')).toBe(false)
  })
})

describe('the size an embed asks for', () => {
  test('a width on its own, or a width and a height', () => {
    expect(embedSize('300')).toEqual({ width: 300, height: null })
    expect(embedSize('300x200')).toEqual({ width: 300, height: 200 })
  })

  test('and nothing at all for words', () => {
    expect(embedSize('the sketch')).toBe(null)
    expect(embedSize('300 wide')).toBe(null)
    expect(embedSize('x200')).toBe(null)
    expect(embedSize('')).toBe(null)
    expect(embedSize(null)).toBe(null)
  })
})

describe('which targets name a website', () => {
  test('a shortcut written by either system, in either case', () => {
    expect(isWebTarget('Svelte docs.url')).toBe(true)
    expect(isWebTarget('reading/Svelte docs.URL')).toBe(true)
    expect(isWebTarget('Svelte docs.webloc')).toBe(true)
    expect(isWebTarget('  Svelte docs.url  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isWebTarget('Svelte docs')).toBe(false)
    expect(isWebTarget('Svelte docs.url.md')).toBe(false)
    expect(isWebTarget('url')).toBe(false)
    expect(isWebTarget('')).toBe(false)
  })
})

describe('which targets open in a tab of their own', () => {
  test('a PDF, a canvas and a website, and no other file', () => {
    expect(isTabFile('paper.pdf')).toBe(true)
    expect(isTabFile('Board.canvas')).toBe(true)
    expect(isTabFile('Svelte docs.url')).toBe(true)
    expect(isTabFile('Note.md')).toBe(false)
    expect(isTabFile('shot.png')).toBe(false)
    expect(isTabFile('')).toBe(false)
  })
})

describe('the page a fragment names', () => {
  test('is the number after page=', () => {
    expect(pageFragment('page=3')).toBe(3)
    expect(pageFragment('page=1')).toBe(1)
    expect(pageFragment('PAGE=12')).toBe(12)
    expect(pageFragment(' page=7 ')).toBe(7)
  })

  test('read out of a link the way it is written', () => {
    expect(pageFragment(parseWikilink('paper.pdf#page=3')?.heading ?? null)).toBe(3)
    expect(pageFragment(parseWikilink('paper.pdf')?.heading ?? null)).toBeNull()
  })

  test('is nothing for a fragment that is not one', () => {
    expect(pageFragment(null)).toBeNull()
    expect(pageFragment('Some Heading')).toBeNull()
    expect(pageFragment('page')).toBeNull()
    expect(pageFragment('page=')).toBeNull()
    expect(pageFragment('page=3a')).toBeNull()
    expect(pageFragment('pages=3')).toBeNull()
  })

  test('is nothing before the first page', () => {
    expect(pageFragment('page=0')).toBeNull()
  })
})

describe('finding the links in a note', () => {
  test('a wikilink with its place in the text', () => {
    const text = 'see [[Other Note]] for more'
    const [link] = findLinks(text)

    expect(link).toMatchObject({ kind: 'wikilink', target: 'Other Note', from: 4, to: 18 })
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('Other Note')
  })

  test('the target span skips the space inside the brackets', () => {
    const text = '[[ Note ]]'
    const [link] = findLinks(text)
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('Note')
  })

  test('several on one line, in the order they were written', () => {
    const found = findLinks('[[A]] and [[B|b]] and ![[C]]')
    expect(found.map((one) => one.target)).toEqual(['A', 'B', 'C'])
    expect(found.map((one) => one.embed)).toEqual([false, false, true])
  })

  test('an internal markdown link counts too', () => {
    const found = findLinks('see [the note](notes/Other.md) here')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      kind: 'markdown',
      target: 'notes/Other.md',
      alias: 'the note',
    })
  })

  test('a markdown target keeps its heading and loses its encoding', () => {
    const [link] = findLinks('[x](My%20Note.md#a-heading)')
    expect(link).toMatchObject({ target: 'My Note.md', heading: 'a-heading' })
  })

  test('an angled markdown target holds spaces', () => {
    const text = '[x](<My Note.md>)'
    const [link] = findLinks(text)
    expect(link?.target).toBe('My Note.md')
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('My Note.md')
  })

  test('a link out at the web is not a link between notes', () => {
    expect(findLinks('[x](https://x.dev) [y](mailto:a@b.dev)')).toEqual([])
  })

  test('a fenced block holds no links', () => {
    expect(findLinks('```\n[[Note]]\n```\n[[Real]]').map((one) => one.target)).toEqual(['Real'])
  })

  test('a block closes on its own mark and on nothing else', () => {
    // A block showing tildes, and a block naming a language: neither of those
    // lines ends the block above it, so the links in between are still code.
    const shown = '```\n~~~\n[[Inside]]\n~~~\n```\n[[Real]]'
    expect(findLinks(shown).map((one) => one.target)).toEqual(['Real'])

    const named = '```\n[[One]]\n```ts\n[[Two]]\n```\n[[Real]]'
    expect(findLinks(named).map((one) => one.target)).toEqual(['Real'])
    expect(findLinks('~~~md\n[[Note]]\n~~~').map((one) => one.target)).toEqual([])
  })

  test('inline code holds no links', () => {
    expect(findLinks('write `[[Note]]` to link').map((one) => one.target)).toEqual([])
    expect(findLinks('`a` [[Note]] `b`').map((one) => one.target)).toEqual(['Note'])
  })

  test('a code span that never closes is text', () => {
    expect(findLinks('` [[Note]]').map((one) => one.target)).toEqual(['Note'])
  })

  test('a double backtick span holds a backtick and still hides a link', () => {
    expect(findLinks('`` ` [[Note]] `` [[Real]]').map((one) => one.target)).toEqual(['Real'])
  })

  test('an escaped bracket is not a link', () => {
    expect(findLinks('\\[[Note]]')).toEqual([])
    expect(findLinks('\\[label](Note.md)')).toEqual([])
  })

  test('a link inside a heading or a list is still a link', () => {
    expect(findLinks('# See [[Note]]\n- and [[Other]]').map((one) => one.target)).toEqual([
      'Note',
      'Other',
    ])
  })

  test('brackets inside the link end it, the way Obsidian does', () => {
    expect(findLinks('[[a]b]]')).toEqual([])
  })

  test('a same-note anchor is found with an empty target', () => {
    expect(findLinks('[[#Heading]]')[0]).toMatchObject({ target: '', heading: 'Heading' })
  })

  test('positions hold across lines', () => {
    const text = 'first\nsecond [[Note]]'
    const [link] = findLinks(text)
    expect(text.slice(link!.from, link!.to)).toBe('[[Note]]')
  })
})

describe('block names', () => {
  test('a caret word at the end of a line names the block', () => {
    expect(blockIdOf('Some paragraph. ^abc123')).toBe('abc123')
    expect(blockIdOf('^on-its-own')).toBe('on-its-own')
  })

  test('anything else is not a name', () => {
    expect(blockIdOf('a^b')).toBeNull()
    expect(blockIdOf('^abc in the middle')).toBeNull()
    expect(blockIdOf('x^2^ is a superscript')).toBeNull()
  })

  test('every name in a note, with its line', () => {
    expect(blockIds('one ^a\n\ntwo ^b')).toEqual([
      { id: 'a', line: 0 },
      { id: 'b', line: 2 },
    ])
  })

  test('a fence holds no names', () => {
    expect(blockIds('```\nxor eax ^a\n```')).toEqual([])
  })

  test('a note without them comes back exactly as it was', () => {
    const note = '# Title\n\nWords, and x^2 as well.\n'
    expect(withoutBlockIds(note)).toBe(note)
  })

  test('a name goes, and the space that separated it goes with it', () => {
    expect(withoutBlockIds('A paragraph. ^abc123\n\nmore')).toBe('A paragraph.\n\nmore')
    expect(withoutBlockIds('^on-its-own\n')).toBe('\n')
  })

  test('several go, and nothing between them moves', () => {
    expect(withoutBlockIds('one ^a\n\ntwo ^b\n\nthree')).toBe('one\n\ntwo\n\nthree')
  })

  test('a caret inside code stays', () => {
    expect(withoutBlockIds('```\nxor eax ^a\n```')).toBe('```\nxor eax ^a\n```')
  })
})

describe('the headings a note holds', () => {
  test('in order, as the words they show', () => {
    expect(headingsOf('# One\n\ntext\n\n## Two\n')).toEqual(['One', 'Two'])
  })

  test('with the hashes some styles close one with taken off', () => {
    expect(headingsOf('## Two ##\n')).toEqual(['Two'])
    expect(headingsOf('## ##\n')).toEqual([''])
  })

  test('keeping a hash that is a letter of the last word', () => {
    // The closing run needs a blank in front of it, or `F#` is not what it says.
    expect(headingsOf('# C# and F#\n')).toEqual(['C# and F#'])
  })

  test('and none from inside a fence', () => {
    expect(headingsOf('```\n# Not one\n```\n# One\n')).toEqual(['One'])
  })
})

describe('the part of a note a link points into', () => {
  test('a heading names the section under it', () => {
    const note = '# One\n\nfirst\n\n# Two\n\nsecond\n'
    expect(sectionOf(note, { heading: 'Two', block: null })).toBe('# Two\n\nsecond')
    expect(sectionOf(note, { heading: 'Nowhere', block: null })).toBe(null)
  })

  test('found by the words it shows, closing hashes and all', () => {
    const note = '# C# and F# #\n\nwords\n'
    expect(sectionOf(note, { heading: 'C# and F#', block: null })).toBe('# C# and F# #\n\nwords')
  })

  test('and a note with no heading named is the whole of it', () => {
    expect(sectionOf('words\n', { heading: null, block: null })).toBe('words\n')
  })
})

/** A note arrives from a share, a room, a folder somebody synced or a page somebody
 *  clipped, and every surface that renders one holds what this answers. */
describe('how many links one note is read for', () => {
  test('is the same ceiling the crate keeps', () => {
    expect(MOST_LINKS).toBe(5000)
  })

  test('and a note that says it more often than that is read to the ceiling', () => {
    const many = findLinks(['[[A]] '.repeat(4000), '[[B]] '.repeat(4000), ''].join('\n'))

    expect(many).toHaveLength(MOST_LINKS)
    // What is there is still read properly: the ceiling stops the reading rather
    // than changing it.
    expect(many[0]?.target).toBe('A')
  })

  test('while a note anybody wrote is read whole', () => {
    expect(findLinks('see [[A]] and [[B]]')).toHaveLength(2)
  })
})
