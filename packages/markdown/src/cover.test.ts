import { describe, expect, test } from 'vitest'
import {
  COVER_KEY,
  COVER_MIDDLE,
  COVER_POSITION_KEY,
  coverFigure,
  coverOf,
  coverPosition,
} from './cover'
import { renderMarkdown } from './index'

const withCover = (rows: string) => `---\n${rows}\n---\n\n# Head\n\nWords.\n`

describe('the cover a note names', () => {
  test('is nothing at all for a note that names none', () => {
    expect(coverOf('# Head\n\nWords.\n')).toBeNull()
    expect(coverOf(withCover('title: Note'))).toBeNull()
  })

  test('is the picture the front matter says, taken from the middle', () => {
    expect(coverOf(withCover('cover: assets/wide.jpg'))).toEqual({
      src: 'assets/wide.jpg',
      position: COVER_MIDDLE,
    })
  })

  test('reads a wikilink as the file it names', () => {
    expect(coverOf(withCover('cover: "[[wide.jpg]]"'))?.src).toBe('wide.jpg')
    expect(coverOf(withCover('cover: "![[wide.jpg]]"'))?.src).toBe('wide.jpg')
    expect(coverOf(withCover('cover: "[[wide.jpg|400]]"'))?.src).toBe('wide.jpg')
  })

  test('keeps an address as the address it is', () => {
    expect(coverOf(withCover('cover: https://nibeditor.com/wide.jpg'))?.src).toBe(
      'https://nibeditor.com/wide.jpg',
    )
  })

  test('takes the band from where the second key says', () => {
    expect(coverOf(withCover('cover: wide.jpg\ncover-position: 20'))?.position).toBe(20)
  })

  test('is nothing for a key with nothing under it', () => {
    expect(coverOf(withCover('cover:'))).toBeNull()
  })

  test('names its two keys for every writer of them', () => {
    expect([COVER_KEY, COVER_POSITION_KEY]).toEqual(['cover', 'cover-position'])
  })
})

describe('where the band is taken from', () => {
  test('is the middle for anything a number cannot be made of', () => {
    for (const said of [null, undefined, '', 'middle', 'NaN']) {
      expect(coverPosition(said), String(said)).toBe(COVER_MIDDLE)
    }
  })

  test('stays inside the picture', () => {
    expect(coverPosition('-40')).toBe(0)
    expect(coverPosition('180')).toBe(100)
  })

  test('is a whole number, because a pointer wrote it', () => {
    expect(coverPosition('43.7183')).toBe(44)
  })
})

describe('the banner every surface draws', () => {
  test('is one element carrying the picture and where its band sits', () => {
    const html = coverFigure({ src: 'assets/wide.jpg', position: 20 })

    expect(html).toContain('class="nib-cover"')
    expect(html).toContain('src="assets/wide.jpg"')
    expect(html).toContain('object-position: 50% 20%')
  })

  test('is nothing for no cover, and nothing for an address that is not a picture', () => {
    expect(coverFigure(null)).toBe('')
    expect(coverFigure({ src: 'javascript:alert(1)', position: 50 })).toBe('')
  })

  test('cannot be talked into ending its own attribute', () => {
    const html = coverFigure({ src: '"><script>bad()</script>', position: 50 })
    expect(html).not.toContain('<script>')
  })
})

/** The one renderer answers it, so the reading view, the HTML export, the ePub and
 *  a published page cannot disagree about whether a note has a banner. */
describe('a rendered note', () => {
  const source = withCover('title: Note\ncover: assets/wide.jpg\ncover-position: 30')

  test('draws the banner where the caller asked for one', () => {
    const html = renderMarkdown(source, { cover: true })

    expect(html).toContain('class="nib-cover"')
    expect(html.indexOf('nib-cover')).toBeLessThan(html.indexOf('<h1'))
    expect(html).toContain('object-position: 50% 30%')
  })

  test('draws none where the caller did not ask', () => {
    expect(renderMarkdown(source)).not.toContain('nib-cover')
  })

  test('puts the banner above the properties, which are above the note', () => {
    const html = renderMarkdown(source, { cover: true, properties: true })

    expect(html.indexOf('nib-cover')).toBeLessThan(html.indexOf('class="property'))
    expect(html.indexOf('class="property')).toBeLessThan(html.indexOf('<h1'))
  })

  test('leaves a note with no cover exactly as it was', () => {
    const plain = '# Head\n\nWords.\n'
    expect(renderMarkdown(plain, { cover: true })).toBe(renderMarkdown(plain))
  })
})
