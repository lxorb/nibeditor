import { describe, expect, test } from 'vitest'
import { noteLinks } from './note-links'
import type { LinkWrite, NoteIndex, NoteRef } from './notes'

function note(path: string): NoteRef {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
  return { path, name, headings: [], blocks: [], aliases: [] }
}

const index: NoteIndex = {
  notes: [note('Plan.md'), note('work/Plan.md'), note('Ideas.md')],
  files: ['paper.pdf', 'pics/cat.png', 'Board.canvas'],
  path: 'journal/Today.md',
  read: () => Promise.resolve(null),
}

const wikilink = (target: LinkWrite) => `[[${target.name}]]`
const markdown = (target: LinkWrite) =>
  `[${target.name}](${target.path ?? ''} from ${target.from ?? ''})`

describe('noteLinks', () => {
  test('a note is linked by its name', () => {
    expect(noteLinks(index, ['Ideas.md'], wikilink)).toBe('[[Ideas]]')
  })

  test('a name two notes share is linked by enough of the path to tell them apart', () => {
    expect(noteLinks(index, ['work/Plan.md'], wikilink)).toBe('[[work/Plan]]')
  })

  test('several notes are a line each, in the order they were carried', () => {
    expect(noteLinks(index, ['Ideas.md', 'paper.pdf'], wikilink)).toBe('[[Ideas]]\n[[paper.pdf]]')
  })

  test('a picture is embedded, and a paper or a canvas is linked with its extension', () => {
    expect(noteLinks(index, ['pics/cat.png'], wikilink)).toBe('![[cat.png]]')
    expect(noteLinks(index, ['Board.canvas'], wikilink)).toBe('[[Board.canvas]]')
  })

  test('a note not written yet is linked by the name that will find it', () => {
    expect(noteLinks(index, ['Trips/Trips.md'], wikilink)).toBe('[[Trips]]')
  })

  test('the writer is told where the target is and which note the link is in', () => {
    expect(noteLinks(index, ['Ideas.md'], markdown)).toBe('[Ideas](Ideas.md from journal/Today.md)')
  })
})
