import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ASSET_ROUTE, assetRoute, assetStorePath, assetType } from './asset-route'
import { MIME_TYPES, mimeOfPath, UNKNOWN_TYPE } from '../mime'

const SW = new URL('../../../public/sw.js', import.meta.url)

describe('the address a picture has in a browser', () => {
  test('a store path becomes a route under the space it is in', () => {
    expect(assetRoute('/Work/assets/pic.png')).toBe('/asset/Work/assets/pic.png')
  })

  test('a path is folded and rooted first, so one picture has one address', () => {
    expect(assetRoute('Work/notes/../assets/pic.png')).toBe('/asset/Work/assets/pic.png')
    expect(assetRoute('//Work//assets//pic.png')).toBe('/asset/Work/assets/pic.png')
  })

  test('a segment is encoded, and the slashes between them are not', () => {
    expect(assetRoute('/Read me/100% done/a#b.png')).toBe(
      '/asset/Read%20me/100%25%20done/a%23b.png',
    )
  })

  test('the journey back gives the path the store knows', () => {
    for (const path of [
      '/Work/assets/pic.png',
      '/Read me/100% done/a#b.png',
      '/Work/a?b/c.png',
      '/Work/пример.png',
    ]) {
      expect(assetStorePath(assetRoute(path))).toBe(path)
    }
  })

  test('a whole address off a rendered page comes back too', () => {
    expect(assetStorePath('http://localhost:1420/asset/Work/pic.png')).toBe('/Work/pic.png')
    expect(assetStorePath('https://orden.so/asset/Work/pic.png')).toBe('/Work/pic.png')
  })

  test('anything that is not one of ours is not one of ours', () => {
    expect(assetStorePath('assets/pic.png')).toBeNull()
    expect(assetStorePath('/assets/index-a1b2.js')).toBeNull()
    expect(assetStorePath('https://example.com/pic.png')).toBeNull()
    expect(assetStorePath('data:image/png;base64,AA')).toBeNull()
    // The words, but not at the start and not after a host.
    expect(assetStorePath('/Work/asset/pic.png')).toBeNull()
    // The prefix and nothing after it names no row.
    expect(assetStorePath(ASSET_ROUTE)).toBeNull()
  })

  test('encoding that is not encoding names nothing', () => {
    expect(assetStorePath('/asset/Work/%ZZ.png')).toBeNull()
  })

  test('the route is not the folder the build writes its own chunks into', () => {
    expect(ASSET_ROUTE).not.toBe('/assets/')
    expect('/assets/index-a1b2.js'.startsWith(ASSET_ROUTE)).toBe(false)
  })
})

describe('what a stored file says it is', () => {
  test('the spellings a browser insists on', () => {
    expect(mimeOfPath('a.jpg')).toBe('image/jpeg')
    expect(mimeOfPath('a.JPEG')).toBe('image/jpeg')
    expect(mimeOfPath('a.svg')).toBe('image/svg+xml')
    expect(mimeOfPath('a.png')).toBe('image/png')
    expect(mimeOfPath('/Work/assets/a.webp')).toBe('image/webp')
  })

  test('a name that says nothing says nothing', () => {
    expect(mimeOfPath('a.wat')).toBeNull()
    expect(mimeOfPath('noextension')).toBeNull()
    expect(assetType('a.wat')).toBe(UNKNOWN_TYPE)
  })

  test('the name is asked before the row, because old rows are wrong', () => {
    expect(assetType('/Work/a.svg', 'image/svg')).toBe('image/svg+xml')
    expect(assetType('/Work/a.jpg', 'image/jpg')).toBe('image/jpeg')
  })

  test('what was written down answers for a name that cannot', () => {
    expect(assetType('/Work/a.wat', 'application/wat')).toBe('application/wat')
    expect(assetType('/Work/a.wat')).toBe(UNKNOWN_TYPE)
  })
})

/** The service worker is a page of its own and cannot import any of the above, so
 *  it says the same three things a second time. This is what keeps the two copies
 *  the same; see the note at the top of asset-route.ts. */
describe('the worker and the page agree', () => {
  const source = readFileSync(SW, 'utf8')

  test('on the route', () => {
    expect(source).toContain(`const ROUTE = '${ASSET_ROUTE}'`)
  })

  test('on where the rows are', () => {
    expect(source).toContain(`const DATABASE = 'nib'`)
    expect(source).toContain(`const STORE = 'assets'`)
  })

  test('on every media type there is', () => {
    // Walked out of the app's own table rather than listed again here, so a type
    // added to one and not the other is what fails.
    for (const [extension, type] of Object.entries(MIME_TYPES)) {
      expect(source).toContain(`${extension}: '${type}'`)
    }

    expect(source).toContain(`const UNKNOWN_TYPE = '${UNKNOWN_TYPE}'`)
  })

  test('and it serves nothing else at all', () => {
    // No app shell, no precache, no cache storage: a worker that answered for the
    // page would answer with yesterday's page.
    expect(source).not.toContain('caches')
    expect(source).not.toContain('addAll')
  })
})
