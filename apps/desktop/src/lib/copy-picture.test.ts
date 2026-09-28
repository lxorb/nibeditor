import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyPicture } from './copy-picture'

/** What the clipboard was handed: the kinds of each item, and the bytes behind them. */
function clipboard() {
  const written: Record<string, Promise<Blob>>[] = []

  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(readonly items: Record<string, Promise<Blob>>) {
        written.push(items)
      }
    },
  )
  vi.stubGlobal('navigator', {
    clipboard: {
      write: async (items: { items: Record<string, Promise<Blob>> }[]) => {
        await Promise.all(items.flatMap((one) => Object.values(one.items)))
      },
    },
  })

  return written
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a picture copied from its menu', () => {
  test('goes onto the clipboard as the picture, not as its path', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(png)))
    const written = clipboard()

    await copyPicture('asset://space/cat.png')

    expect(written.map((one) => Object.keys(one))).toEqual([['image/png']])
    const handed = await written[0]?.['image/png']
    expect(handed?.type).toBe('image/png')
    expect(handed?.size).toBe(4)
  })

  test('and says so when the picture could not be read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })))
    clipboard()

    await expect(copyPicture('asset://space/gone.png')).rejects.toThrow('404')
  })
})
