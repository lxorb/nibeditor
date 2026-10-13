import { afterEach, describe, expect, test, vi } from 'vitest'
import { fromBase64, parseDataUri, toBase64 } from '../bytes'
import {
  inlinePictures,
  isRemote,
  mimeOf,
  type Picture,
  readPictures,
  sourcesIn,
  suffixFor,
  swapSources,
} from './pictures'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])

const picture = (src: string, name: string, mime = 'image/png'): Picture => ({
  src,
  name,
  mime,
  bytes: PNG,
})

describe('reading bytes back and forth', () => {
  test('base64 survives a round trip, whatever the length', () => {
    for (const length of [0, 1, 2, 3, 255, 1000]) {
      const bytes = new Uint8Array(length).map((_, at) => at % 256)
      expect([...fromBase64(toBase64(bytes))], String(length)).toEqual([...bytes])
    }
  })

  test('a long run does not overflow the stack it is written with', () => {
    const bytes = new Uint8Array(300_000).map((_, at) => at % 256)
    expect(fromBase64(toBase64(bytes)).length).toBe(bytes.length)
  })

  test('a data URI comes apart into its type and its bytes', () => {
    expect(parseDataUri(`data:image/png;base64,${toBase64(PNG)}`)).toEqual({
      mime: 'image/png',
      bytes: PNG,
    })
  })

  test('one that is not base64 reads as the text it holds', () => {
    expect(parseDataUri('data:text/plain,hello%20there')?.mime).toBe('text/plain')
    expect(new TextDecoder().decode(parseDataUri('data:text/plain,hello')?.bytes)).toBe('hello')
  })

  test('anything that is not a data URI is not one', () => {
    expect(parseDataUri('assets/pic.png')).toBeNull()
    expect(parseDataUri('https://orden.so/a.png')).toBeNull()
  })
})

describe('telling one kind of source from another', () => {
  test('knows a remote picture from a local one', () => {
    expect(isRemote('https://orden.so/a.png')).toBe(true)
    expect(isRemote('//orden.so/a.png')).toBe(true)
    expect(isRemote('assets/a.png')).toBe(false)
    expect(isRemote('C:/notes/a.png')).toBe(false)
  })

  test('reads the type off the extension, whatever its case', () => {
    expect(mimeOf('a.PNG')).toBe('image/png')
    expect(mimeOf('a.jpeg')).toBe('image/jpeg')
    expect(mimeOf('a.svg')).toBe('image/svg+xml')
    expect(mimeOf('a.png?v=2')).toBe('image/png')
  })

  test('falls back where the name says nothing', () => {
    expect(mimeOf('picture')).toBe('image/png')
    expect(mimeOf('picture', 'image/jpeg')).toBe('image/jpeg')
  })

  test('names the extension a type is normally written with', () => {
    expect(suffixFor('image/jpeg')).toBe('jpg')
    expect(suffixFor('application/octet-stream')).toBe('png')
  })
})

describe('the pictures a page names', () => {
  test('are every img src in it, once each, in order', () => {
    const html = '<img src="b.png"><p><img alt="x" src="a.png"></p><img src="b.png">'
    expect(sourcesIn(html)).toEqual(['b.png', 'a.png'])
  })

  test('leave out the ones already carried inline', () => {
    expect(sourcesIn('<img src="data:image/png;base64,AAA"><img src="a.png">')).toEqual(['a.png'])
  })

  test('include the remote ones, because a page that stands alone carries those too', () => {
    expect(sourcesIn('<img src="https://orden.so/a.png">')).toEqual(['https://orden.so/a.png'])
  })

  test('a page with no pictures names none', () => {
    expect(sourcesIn('<p>words</p>')).toEqual([])
  })
})

describe('pointing a page’s pictures somewhere else', () => {
  test('swaps only the sources the caller named', () => {
    const html = '<img src="a.png"><img src="b.png">'
    const out = swapSources(html, new Map([['a.png', '../images/a.png']]))

    expect(out).toBe('<img src="../images/a.png"><img src="b.png">')
  })

  test('keeps every other attribute exactly as it was', () => {
    const html = '<img alt="A cat" src="a.png" width="20">'
    expect(swapSources(html, new Map([['a.png', 'x.png']]))).toBe(
      '<img alt="A cat" src="x.png" width="20">',
    )
  })

  test('does nothing at all when the map is empty', () => {
    const html = '<img src="a.png">'
    expect(swapSources(html, new Map())).toBe(html)
  })

  test('carries a picture inside the page as a data URI', () => {
    const out = inlinePictures('<img src="a.png">', [picture('a.png', 'a.png')])
    expect(out).toBe(`<img src="data:image/png;base64,${toBase64(PNG)}">`)
  })

  test('leaves one nobody read pointing where it pointed', () => {
    const out = inlinePictures('<img src="a.png"><img src="b.png">', [picture('a.png', 'a.png')])
    expect(out).toContain('<img src="b.png">')
  })
})

describe('naming the pictures inside a package', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Every picture read straight out of a data URI, which is the one road that
   *  needs neither a disk nor a network. */
  const inline = (mime: string) => `data:${mime};base64,${toBase64(PNG)}`

  test('keeps the name a picture came with', async () => {
    const read = await readPictures([inline('image/png'), 'x'], () => 'x')
    expect(read[0]?.name).toBe('picture.png')
  })

  test('gives two pictures of the same name one name each', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })),
    )

    const read = await readPictures([
      'https://one.example.com/pic.png',
      'https://two.example.com/pic.png',
    ])

    expect(read.map((one) => one.name)).toEqual(['pic.png', 'pic 2.png'])
  })

  test('takes the type the server declared over the one the name suggests', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      ),
    )

    const read = await readPictures(['https://orden.so/odd.png'])
    expect(read[0]?.mime).toBe('image/jpeg')
  })

  test('leaves out a remote picture that cannot be fetched', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await readPictures(['https://orden.so/a.png'])).toEqual([])
  })

  test('leaves out one the server answered with an error page', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 404 })))
    expect(await readPictures(['https://orden.so/a.png'])).toEqual([])
  })

  test('decodes the pictures a note already carries inline', async () => {
    const read = await readPictures([inline('image/jpeg')])

    expect(read).toHaveLength(1)
    expect(read[0]?.mime).toBe('image/jpeg')
    expect([...(read[0]?.bytes ?? [])]).toEqual([...PNG])
    expect(read[0]?.name).toBe('picture.jpg')
  })

  test('a name that encodes a separator stays one name', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })),
    )

    const read = await readPictures(['https://evil.example.com/a%2F..%2F..%2Fevil.png'])

    expect(read[0]?.name).not.toContain('/')
    expect(read[0]?.name).not.toContain('..')
  })

  test('a name that is nothing but separators still gets one', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })),
    )

    const read = await readPictures(['https://evil.example.com/%2E%2E%2F'])
    expect(read[0]?.name).toBe('picture.png')
  })

  test('a declared type that is not a plain media type is not trusted', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(PNG, { status: 200, headers: { 'content-type': 'image/png" onerror="x' } }),
      ),
    )

    const read = await readPictures(['https://evil.example.com/a.png'])
    expect(read[0]?.mime).toBe('image/png')
  })

  test('a data URI cannot name a type that would break the file it goes into', async () => {
    const read = await readPictures([`data:image/png" onerror="x;base64,${toBase64(PNG)}`])
    expect(read[0]?.mime).toBe('image/png')
  })

  test('keeps the order it was asked in, minus what it could not read', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const read = await readPictures([
      inline('image/png'),
      'https://orden.so/gone.png',
      inline('image/gif'),
    ])

    expect(read.map((one) => one.mime)).toEqual(['image/png', 'image/gif'])
  })
})
