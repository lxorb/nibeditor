import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { CORPUS } from './corpus'
import type { Picture } from './pictures'
import { bundleFiles, packEntries } from './textbundle'
import { zipOf } from './zip'

const PICTURES: Picture[] = [
  {
    src: 'assets/pic.png',
    name: 'pic.png',
    mime: 'image/png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  },
  {
    src: 'https://orden.so/remote.jpg',
    name: 'remote.jpg',
    mime: 'image/jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 9, 9]),
  },
]

const files = bundleFiles(CORPUS, PICTURES)
const byPath = new Map(files.map((file) => [file.path, file.body]))

const text = () => {
  const body = byPath.get('text.md')
  expect(typeof body).toBe('string')
  // Asserted on the line above.
  return body as string
}

describe('a TextBundle', () => {
  test('holds its metadata, its text and its pictures, in that order', () => {
    expect(files.map((file) => file.path)).toEqual([
      'info.json',
      'text.md',
      'assets/pic.png',
      'assets/remote.jpg',
    ])
  })

  test('says it is version two of the format, in plain markdown', () => {
    const info = JSON.parse(String(byPath.get('info.json'))) as Record<string, unknown>

    expect(info.version).toBe(2)
    expect(info.type).toBe('net.daringfireball.markdown')
    expect(info.transient).toBe(false)
    expect(typeof info.creatorIdentifier).toBe('string')
  })

  test('keeps the note whole, front matter and all', () => {
    expect(text().startsWith('---\ntitle: Export corpus')).toBe(true)
    expect(text()).toContain('**bold**')
  })

  test('points every picture at the assets folder beside the text', () => {
    expect(text()).toContain('![Pasted picture](assets/pic.png)')
    expect(text()).toContain('![Remote picture](assets/remote.jpg)')
  })

  test('carries each picture’s own bytes', () => {
    expect([...(byPath.get('assets/pic.png') as Uint8Array)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 1, 2, 3,
    ])
    expect([...(byPath.get('assets/remote.jpg') as Uint8Array)]).toEqual([0xff, 0xd8, 9, 9])
  })

  test('turns a wikilink into a real link when the caller resolves one', () => {
    const resolved = bundleFiles(CORPUS, [], {
      link: (link) => (link.target === 'Another note' ? 'Another note.md' : null),
    })

    expect(String(resolved[1]?.body)).toContain('[Another note](Another%20note.md)')
  })

  test('leaves a picture the caller could not read pointing where the note wrote', () => {
    const none = bundleFiles('![A](assets/gone.png)\n', [])
    expect(String(none[1]?.body)).toBe('![A](assets/gone.png)\n')
  })

  test('a bundle of a note with no pictures is two files', () => {
    expect(bundleFiles('Just words.\n', []).map((one) => one.path)).toEqual([
      'info.json',
      'text.md',
    ])
  })
})

describe('a TextPack', () => {
  test('is one zip whose only top-level entry is the bundle folder', async () => {
    const entries = packEntries('Export corpus.textbundle', files)
    expect(entries.map((one) => one.path)).toEqual([
      'Export corpus.textbundle/info.json',
      'Export corpus.textbundle/text.md',
      'Export corpus.textbundle/assets/pic.png',
      'Export corpus.textbundle/assets/remote.jpg',
    ])

    const zip = await JSZip.loadAsync(await zipOf(entries))
    const tops = new Set(Object.keys(zip.files).map((path) => path.split('/')[0]))
    expect([...tops]).toEqual(['Export corpus.textbundle'])
  })

  test('unzips to the very files the bundle held', async () => {
    const zip = await JSZip.loadAsync(await zipOf(packEntries('N.textbundle', files)))
    const picture = await zip.file('N.textbundle/assets/pic.png')?.async('uint8array')

    expect([...(picture ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect(await zip.file('N.textbundle/text.md')?.async('string')).toBe(text())
  })
})

describe('the zip the packages are built with', () => {
  test('keeps the order it was given, which is what an ePub needs', async () => {
    const zip = await JSZip.loadAsync(
      await zipOf([
        { path: 'mimetype', body: 'application/epub+zip', stored: true },
        { path: 'second.txt', body: 'second' },
      ]),
    )

    expect(Object.keys(zip.files)).toEqual(['mimetype', 'second.txt'])
  })

  test('leaves an entry that asked to be stored uncompressed', async () => {
    const bytes = await zipOf([
      { path: 'mimetype', body: 'application/epub+zip', stored: true },
      { path: 'other.txt', body: 'x'.repeat(400) },
    ])

    // The local file header's compression method sits at offset 8, and zero is
    // "stored". Read off the bytes rather than asked of the library, because it
    // is the file on disk a reader will judge.
    expect(bytes[8]).toBe(0)
    expect(bytes[9]).toBe(0)
  })

  test('writes text as UTF-8', async () => {
    const zip = await JSZip.loadAsync(await zipOf([{ path: 'a.txt', body: 'grüezi 日本語' }]))
    expect(await zip.file('a.txt')?.async('string')).toBe('grüezi 日本語')
  })
})
