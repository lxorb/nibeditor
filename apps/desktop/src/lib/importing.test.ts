import { describe, expect, test } from 'vitest'

import { folderNameFor } from './importing.svelte'
import type { Picked } from './import/sources'

function picked(name: string, inside = ''): Picked {
  return {
    name,
    webkitRelativePath: inside,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

describe('the folder an import makes for itself', () => {
  test('is named after the file that was picked', () => {
    expect(folderNameFor([picked('Travel.enex')], 'evernote')).toBe('Travel')
    expect(folderNameFor([picked('My notes.zip')], 'markdown')).toBe('My notes')
  })

  test('is named after the folder that was dropped', () => {
    expect(
      folderNameFor([picked('2026_01_02.md', 'My graph/journals/2026_01_02.md')], 'logseq'),
    ).toBe('My graph')
  })

  test('is the app it came out of where the file name is one an exporter made up', () => {
    expect(folderNameFor([picked('Export-9f1c2d3e.zip')], 'notion')).toBe('Notion')
    expect(folderNameFor([picked('takeout-20260102.zip')], 'keep')).toBe('Google Keep')
    expect(folderNameFor([picked('backup.zip')], 'bear')).toBe('Bear')
  })

  test('is the app it came out of when several files were picked', () => {
    expect(folderNameFor([picked('Work.enex'), picked('Home.enex')], 'evernote')).toBe('Evernote')
  })

  test('is a name a file may have, whatever the export called itself', () => {
    expect(folderNameFor([picked('Plans: 2026.zip')], 'markdown')).toBe('Plans 2026')
  })
})

/** A folder picked whole, the way the sheet's button and a drop both hand one over:
 *  every file's path starts with the folder's own name. The import's folder is named
 *  after it, so the files inside must not carry that name again - a folder called
 *  Vault became Vault/Vault/Home.md, and one called Bear, Bear/Bear. The first-run
 *  card has always taken the name off for the same reason; see first-space.svelte.ts. */
describe('a folder picked whole', () => {
  function inFolder(path: string, words: string): Picked {
    const bytes = new TextEncoder().encode(words)
    return {
      name: path.split('/').pop() ?? path,
      webkitRelativePath: path,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    }
  }

  test('is the import folder, and is not a folder inside it as well', async () => {
    const { importing } = await import('./importing.svelte')
    await importing.take([
      inFolder('Vault/Home.md', '# Home\n\nSee [[Leaf]].\n'),
      inFolder('Vault/Sub/Leaf.md', '# Leaf\n'),
    ])

    expect(importing.folder).toBe('Vault')
    expect(importing.plan?.files.map((one) => one.path).sort()).toEqual(['Home.md', 'Sub/Leaf.md'])
  })
})
