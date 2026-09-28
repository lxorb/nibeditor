/** Where an export goes, and the one rule that keeps it from going anywhere else.
 *
 *  The three roads out - a dialog, a download, a folder on a phone - each belong
 *  to a build, and a test cannot be all three at once. So what is measured here
 *  is the part that is the same on all of them: the calls that reach the crate,
 *  in the order and the shape it expects, over a stubbed bridge. Which road a
 *  build takes is measured in the browser instead; see scripts/export-e2e.py. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { toBase64 } from '../bytes'

/** Every call that went over the bridge, in order. */
const calls: { command: string; args: Record<string, unknown> }[] = []

vi.mock('../tauri', () => ({
  isNative: true,
  isMobile: false,
  isDesktop: true,
  folderOf: (path: string) => path.replace(/[\\/][^\\/]*$/, ''),
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args })
    return Promise.resolve(undefined)
  },
}))

/** What the link index was told, in order. */
const heard: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void heard.push(`saved ${path}`),
    cameBack: (path: string) => void heard.push(`came back ${path}`),
  },
}))

const { insideFolder, writeFile } = await import('./save')

beforeEach(() => {
  calls.length = 0
  heard.length = 0
})

describe('writing a file', () => {
  test('text goes through the note writer, as text', async () => {
    await writeFile('C:/notes/Note.md', 'the words')

    expect(calls).toEqual([
      { command: 'write_note', args: { path: 'C:/notes/Note.md', content: 'the words' } },
    ])
  })

  test('bytes go through the byte writer, as base64', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
    await writeFile('C:/notes/Note.docx', bytes)

    expect(calls).toEqual([
      { command: 'write_bytes', args: { path: 'C:/notes/Note.docx', base64: toBase64(bytes) } },
    ])
  })

  test('either way the link index is told, so an export saved into a space is linkable', async () => {
    await writeFile('C:/notes/Note.md', 'the words')
    await writeFile('C:/notes/Note.docx', new Uint8Array([1]))

    expect(heard).toEqual(['saved C:/notes/Note.md', 'came back C:/notes/Note.docx'])
  })

  test('bytes never reach the note writer, which would mangle them', async () => {
    await writeFile('C:/a.png', new Uint8Array([0xff, 0xd8]))
    expect(calls.map((one) => one.command)).toEqual(['write_bytes'])
  })

  test('a picture of any size crosses as one string rather than as digits', async () => {
    const big = new Uint8Array(60_000).map((_, at) => at % 256)
    await writeFile('C:/big.png', big)

    const base64 = calls[0]?.args.base64
    expect(typeof base64).toBe('string')
    // Four characters per three bytes, which is a third more rather than the six
    // characters a byte an array of JSON numbers would cost.
    expect(String(base64).length).toBeLessThan(big.length * 2)
  })

  test('an empty file is still a file', async () => {
    await writeFile('C:/empty.txt', '')
    expect(calls).toEqual([{ command: 'write_note', args: { path: 'C:/empty.txt', content: '' } }])
  })
})

describe('a path inside a package', () => {
  test('is a file under the folder it is joined onto', () => {
    expect(insideFolder('text.md')).toBe(true)
    expect(insideFolder('assets/one.png')).toBe(true)
    expect(insideFolder('assets/a..b.png')).toBe(true)
  })

  test('is not one that climbs out of it', () => {
    expect(insideFolder('../escaped.png')).toBe(false)
    expect(insideFolder('assets/../../escaped.png')).toBe(false)
    expect(insideFolder('assets\\..\\..\\escaped.png')).toBe(false)
  })

  test('is not an absolute one either', () => {
    expect(insideFolder('/etc/passwd')).toBe(false)
    expect(insideFolder('C:/Windows/System32/x.dll')).toBe(false)
    expect(insideFolder('\\\\server\\share\\x')).toBe(false)
  })
})
