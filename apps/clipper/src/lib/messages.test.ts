import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Clip, readAnswer, readAsk, readClip, readReading } from './messages'

const CLIP: Clip = {
  origin: { kind: 'page', url: 'https://site.example/a', title: 'A', tags: ['x'] },
  clipped: '2026-03-04T09:12:00.000Z',
  markdown: 'body',
  images: ['https://site.example/x.png'],
  filled: [],
}

describe('a clip arriving from the page', () => {
  test('is what it says it is', () => {
    expect(readClip(CLIP)).toEqual(CLIP)
  })

  test('is nothing when it is not an object', () => {
    expect(readClip(null)).toBe(null)
    expect(readClip('a clip')).toBe(null)
    expect(readClip([CLIP])).toBe(null)
  })

  test('is nothing when the kind is not one of the three', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, kind: 'everything' } })).toBe(null)
  })

  test('is nothing without the fields the note needs', () => {
    expect(readClip({ ...CLIP, markdown: undefined })).toBe(null)
    expect(readClip({ ...CLIP, clipped: 7 })).toBe(null)
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: null } })).toBe(null)
  })

  test('keeps the tags it can read and drops the rest', () => {
    expect(
      readClip({ ...CLIP, origin: { ...CLIP.origin, tags: ['a', 3, null, 'b'] } })?.origin.tags,
    ).toEqual(['a', 'b'])
  })

  test('has no tags when the tags are not a list', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, tags: 'a,b' } })?.origin.tags).toEqual([])
  })

  test('is nothing when the address is not one', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: 'not an address' } })).toBe(null)
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: '' } })).toBe(null)
  })

  // A note records the address, and a clipped link is nothing but the address.
  test('is nothing when the address is code rather than a place', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: 'javascript:alert(1)' } })).toBe(null)
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: 'data:text/html,<b>' } })).toBe(null)
  })

  test('writes the address the way a browser does, so nothing is left in it', () => {
    const read = readClip({
      ...CLIP,
      origin: { ...CLIP.origin, url: 'https://site.example/a b>c' },
    })
    expect(read?.origin.url).toBe('https://site.example/a%20b%3Ec')
  })

  test('is nothing when the instant is not a date', () => {
    expect(readClip({ ...CLIP, clipped: 'whenever' })).toBe(null)
  })
})

describe('what the worker is asked', () => {
  test('reads a request to clip', () => {
    expect(readAsk({ ask: 'clip', kind: 'selection' })).toEqual({ ask: 'clip', kind: 'selection' })
  })

  test('reads a request to save', () => {
    expect(readAsk({ ask: 'save', clip: CLIP, spaceId: 's1', folder: 'Reading' })).toEqual({
      ask: 'save',
      clip: CLIP,
      spaceId: 's1',
      folder: 'Reading',
    })
  })

  test('refuses a save with no clip in it', () => {
    expect(readAsk({ ask: 'save', spaceId: 's1', folder: '' })).toBe(null)
  })

  test('refuses a save that names no space', () => {
    expect(readAsk({ ask: 'save', clip: CLIP, folder: '' })).toBe(null)
  })

  test('refuses anything it was not asked', () => {
    expect(readAsk({ ask: 'delete' })).toBe(null)
    expect(readAsk({})).toBe(null)
    expect(readAsk(undefined)).toBe(null)
  })
})

describe('what the page is asked', () => {
  test('reads a reading with a link on it', () => {
    expect(readReading({ read: 'link', link: 'https://a.example' })).toEqual({
      read: 'link',
      link: 'https://a.example',
    })
  })

  test('reads one without', () => {
    expect(readReading({ read: 'page' })).toEqual({ read: 'page', link: null })
  })

  test('refuses a kind that is not one of the three', () => {
    expect(readReading({ read: 'everything' })).toBe(null)
  })
})

describe('what comes back', () => {
  test('a sentence saying why not', () => {
    expect(readAnswer({ problem: 'Sign in to Nib first.' })).toEqual({
      problem: 'Sign in to Nib first.',
    })
  })

  test('the path a note landed at', () => {
    expect(readAnswer({ path: 'Reading/A.md' })).toEqual({ path: 'Reading/A.md' })
  })

  test('a clip', () => {
    expect(readAnswer({ clip: CLIP })).toEqual({ clip: CLIP })
  })

  test('nothing recognisable at all', () => {
    expect(readAnswer({ ok: true })).toBe(null)
    expect(readAnswer(null)).toBe(null)
  })
})

/** The other half of the same boundary. Everything above reads what a message says;
 *  this is who said it, which the shape cannot tell you - and `save` writes a note
 *  into somebody's account. Read off the source, because a listener registered on the
 *  real `chrome` is not a thing a unit test holds. */
describe('who a message is taken from', () => {
  // Vitest runs in the package's own root, and `import.meta.url` is not a file URL
  // under jsdom; see i18n.test.ts, which reads the manifest the same way.
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

  test('the worker takes one from this extension’s own pages and nothing else', () => {
    const worker = read('background', 'index.ts')

    expect(worker).toContain('sender.id !== chrome.runtime.id')
    expect(worker).toContain("sender.url?.startsWith(chrome.runtime.getURL(''))")
    // And the sender is read rather than thrown away, which is what it used to be.
    expect(worker).not.toContain('(message: unknown, _sender, respond)')
  })

  test('and the reader in the page answers only this extension', () => {
    const content = read('content', 'index.ts')

    expect(content).toContain('sender.id !== chrome.runtime.id')
    expect(content).not.toContain('(message: unknown, _sender, respond)')
  })
})
