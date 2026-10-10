import { beforeEach, describe, expect, test } from 'vitest'
import { MOST_IMAGE } from '@nib/online/wire'
import { busy } from '../busy.svelte'
import { carried, type Picture, pictureAt, pictureOf } from './images'
import type { Source } from './source'

/** Issue 228: pictures carried to the machine a terminal reaches, and pasted as their
 *  paths there. */

const picture = (size: number): Picture => ({
  kind: 'png',
  bytes: () => Promise.resolve(new Uint8Array(size)),
})

/** A source on another machine that writes each picture where `where` says. */
function machine(where: (at: number) => string | Error): Source & { sizes: number[] } {
  const sizes: number[] = []
  return {
    remote: true,
    sizes,
    start: () => Promise.resolve(),
    write: () => Promise.resolve(),
    resize: () => undefined,
    seen: () => undefined,
    end: () => undefined,
    image: (bytes) => {
      sizes.push(bytes.length)
      const path = where(sizes.length)
      return path instanceof Error ? Promise.reject(path) : Promise.resolve(path)
    },
  }
}

beforeEach(() => {
  busy.clear()
})

describe('pictures carried to another machine', () => {
  test('are their paths there, a space apart, quoted where a shell would split one', async () => {
    const source = machine((at) => (at === 1 ? '/home/me/a.png' : '/home/me/my shots/b.png'))
    expect(await carried(source, [picture(3), picture(5)])).toBe(
      "/home/me/a.png '/home/me/my shots/b.png'",
    )
    expect(source.sizes).toEqual([3, 5])
  })

  test('one larger than a paste carries is never sent, and the line says so', async () => {
    const source = machine(() => '/x.png')
    expect(await carried(source, [picture(MOST_IMAGE + 1)])).toBeNull()
    expect(source.sizes).toEqual([])
    expect(busy.trouble).toBe('Could not send the image')
  })

  test('one the machine refused is nothing pasted, and the line says so', async () => {
    expect(
      await carried(
        machine(() => new Error('refused')),
        [picture(1)],
      ),
    ).toBeNull()
    expect(busy.trouble).toBe('Could not send the image')
  })

  test('nothing goes where the source cannot carry a picture', async () => {
    const local = machine(() => '/x.png')
    delete local.image
    expect(await carried(local, [picture(1)])).toBeNull()
    expect(local.sizes).toEqual([])
    expect(busy.trouble).toBeNull()
  })
})

describe('a picture', () => {
  test('is one an agent reads, by its type or by its file’s name', () => {
    expect(pictureOf(new Blob([], { type: 'image/webp' }))?.kind).toBe('webp')
    expect(pictureOf(new Blob([], { type: 'text/plain' }))).toBeNull()
    expect(pictureAt('Space/shots/one.jpeg')?.kind).toBe('jpeg')
    expect(pictureAt('Space/notes.md')).toBeNull()
  })
})
