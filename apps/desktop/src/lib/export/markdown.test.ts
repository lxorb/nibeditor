import type { FoundLink } from '@nib/markdown/links'
import { describe, expect, test } from 'vitest'
import { CORPUS } from './corpus'
import { toMarkdown } from './markdown'

/** A space that holds one note, so a wikilink to it resolves and everything else
 *  does not. Answers a path relative to the note being exported. */
const resolve = (link: FoundLink) => (link.target === 'Another note' ? 'Another note.md' : null)

describe('the note as it was written', () => {
  test('comes back character for character when nothing is asked of it', () => {
    expect(toMarkdown(CORPUS)).toBe(CORPUS)
  })

  test('keeps its front matter, which is the note’s own metadata', () => {
    expect(toMarkdown(CORPUS).startsWith('---\ntitle: Export corpus')).toBe(true)
  })
})

describe('wikilinks turned into real links', () => {
  const out = toMarkdown(CORPUS, { link: resolve })

  test('a resolved one becomes a relative markdown link', () => {
    expect(out).toContain('[Another note](Another%20note.md)')
  })

  test('an aliased one keeps the words it showed', () => {
    expect(out).toContain('[the other](Another%20note.md)')
  })

  test('no brackets are left anywhere', () => {
    expect(out).not.toContain('[[')
    expect(out).not.toContain(']]')
  })

  test('one nothing resolves reads as the words it showed', () => {
    const text = toMarkdown('See [[Missing note|that one]] there.\n', { link: () => null })
    expect(text).toBe('See that one there.\n')
  })

  test('a heading inside the link comes along as a fragment', () => {
    const text = toMarkdown('See [[Note#The heading]].\n', { link: () => 'sub/Note.md' })
    expect(text).toBe('See [Note#The heading](sub/Note.md%23The%20heading).\n')
  })

  test('an embed becomes a plain link, since no reader can inline a note', () => {
    const text = toMarkdown('![[Note]]\n', { link: () => 'Note.md' })
    expect(text).toBe('[Note](Note.md)\n')
  })

  test('a target with a hash or a question mark in it is written out', () => {
    const text = toMarkdown('[[Odd]]\n', { link: () => 'a#b?c.md' })
    expect(text).toBe('[Odd](a%23b%3Fc.md)\n')
  })

  test('everything that is not a wikilink is left alone', () => {
    const out2 = toMarkdown(CORPUS, { link: resolve })
    expect(out2).toContain('[link](https://orden.so)')
    expect(out2).toContain('![Pasted picture](assets/pic.png)')
    expect(out2).toContain('**bold**')
  })
})

describe('pictures pointed somewhere else', () => {
  const beside = (src: string) => (src === 'assets/pic.png' ? 'assets/pic.png' : null)

  test('a renamed picture keeps its words and its title', () => {
    const text = toMarkdown('![A cat](old/cat.png "Meow")\n', { picture: () => 'assets/cat.png' })
    expect(text).toBe('![A cat](assets/cat.png "Meow")\n')
  })

  test('one the caller says nothing about keeps the path the note wrote', () => {
    const text = toMarkdown('![A](one.png)\n\n![B](two.png)\n', {
      picture: (src) => (src === 'one.png' ? 'assets/one.png' : null),
    })

    expect(text).toBe('![A](assets/one.png)\n\n![B](two.png)\n')
  })

  test('a remote picture is left where it is when the caller says so', () => {
    expect(toMarkdown(CORPUS, { picture: beside })).toContain(
      '![Remote picture](https://orden.so/remote.jpg)',
    )
  })

  test('an angled source keeps its angles', () => {
    const text = toMarkdown('![A](<a space.png>)\n', { picture: () => 'assets/a space.png' })
    expect(text).toBe('![A](<assets/a space.png>)\n')
  })

  test('a path that gains a space gains the angles that keep it one path', () => {
    const text = toMarkdown('![A](p.png)\n', { picture: () => 'my assets/p.png' })
    expect(text).toBe('![A](<my assets/p.png>)\n')
  })

  test('picture syntax inside a fence is left alone, because it is an example', () => {
    const source = '```md\n![A](one.png)\n```\n\n![A](one.png)\n'
    const text = toMarkdown(source, { picture: () => 'assets/one.png' })

    expect(text).toBe('```md\n![A](one.png)\n```\n\n![A](assets/one.png)\n')
  })

  test('a plain link that happens to name a picture is not a picture', () => {
    const text = toMarkdown('[not a picture](one.png)\n', { picture: () => 'assets/one.png' })
    expect(text).toBe('[not a picture](one.png)\n')
  })
})

describe('both rewrites at once', () => {
  test('do not disturb each other’s offsets', () => {
    const source = 'See [[Another note]] and ![A](one.png) and [[Another note|again]].\n'
    const text = toMarkdown(source, {
      link: resolve,
      picture: () => 'assets/one.png',
    })

    expect(text).toBe(
      'See [Another note](Another%20note.md) and ![A](assets/one.png) and ' +
        '[again](Another%20note.md).\n',
    )
  })

  test('leave a note with neither exactly as it was', () => {
    const source = 'Nothing to rewrite here.\n'
    expect(toMarkdown(source, { link: resolve, picture: () => 'x' })).toBe(source)
  })
})
