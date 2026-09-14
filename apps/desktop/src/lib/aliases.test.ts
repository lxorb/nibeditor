/** The other names a note gives itself.
 *
 *  `aliases:` in the front matter is Obsidian's, and a link may use any of them.
 *  Read on the same pass as the icon, resolved only once nothing in the space is
 *  actually called that, and deliberately not followed when a rename rewrites
 *  links: a name the writer chose is not a filename to be replaced.
 *
 *  The index is the app's half; the resolver's own half is tested in
 *  packages/editor/src/wikilink/wikilink.test.ts. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Hit } from './search/match'
import type { Query } from './search/query'
import { scanNote, type SpaceLinks } from './scan-note'

const ROOT = '/space'

let notes: Record<string, string> = {}
let written: { path: string; content: string }[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'scan_links') {
      const found: SpaceLinks = {
        notes: Object.entries(notes).map(([path, content]) => scanNote(path, content)),
        files: [],
      }
      return Promise.resolve(found)
    }

    if (command === 'read_note') {
      const relative = String(args.path).replace(`${ROOT}/`, '')
      return Promise.resolve(notes[relative] ?? null)
    }

    if (command === 'write_note') {
      const relative = String(args.path).replace(`${ROOT}/`, '')
      notes[relative] = String(args.content)
      written.push({ path: relative, content: String(args.content) })
      return Promise.resolve(null)
    }

    if (command === 'snapshot_note') return Promise.resolve(null)

    return Promise.resolve(null)
  },
}))

/** The space search, stood in for: the real one is behind the Rust crate on a
 *  desktop and inside a worker in a browser, and neither is here. The matcher the
 *  app actually uses runs over the notes this file holds, so what is tested is the
 *  answer the app would get. */
vi.mock('./search/space', () => ({
  searchSpace: async (
    _root: string,
    query: Query,
    _terms: string[],
    limit: number,
    onFound: (found: { hits: Hit[]; loose: Hit[] }) => void,
  ) => {
    const { Matcher } = await import('./search/match')
    const matcher = new Matcher(query)
    const hits: Hit[] = []

    for (const [path, content] of Object.entries(notes)) {
      hits.push(
        ...matcher.hits(
          { path: `${ROOT}/${path}`, relative: path, name: path, body: content },
          limit,
        ),
      )
    }

    onFound({ hits, loose: [] })
  },
}))

const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')

// A space is scanned once its file list is on screen; see startup.svelte.ts.
void startup.shown()

async function space(contents: Record<string, string>) {
  notes = { ...contents }
  written = []
  await links.build(ROOT)
}

const at = (relative: string) => `${ROOT}/${relative}`

beforeEach(() => {
  links.clear()
})

describe('a note that declares other names', () => {
  test('is found by a link that uses one of them', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap, The plan]\n---\n\n# Plan\n',
      'Other.md': 'See [[Roadmap]] and [[The plan]].\n',
    })

    const out = links.outgoing(at('Other.md'))
    expect(out.map((one) => one.to)).toEqual(['Plan.md', 'Plan.md'])
  })

  test('is found whichever way the list was written', async () => {
    await space({
      'Plan.md': '---\naliases:\n  - Roadmap\n---\n',
      'One.md': '---\naliases: Blueprint\n---\n',
      'Other.md': '[[Roadmap]] and [[Blueprint]].\n',
    })

    expect(links.outgoing(at('Other.md')).map((one) => one.to)).toEqual(['Plan.md', 'One.md'])
  })

  test('counts a link written with one of them among its backlinks', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'Other.md': 'See [[Roadmap]].\n',
    })

    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['Other.md'])
  })

  test('gives way to a file that really is called that', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'Roadmap.md': '# Roadmap\n',
      'Other.md': '[[Roadmap]]\n',
    })

    expect(links.outgoing(at('Other.md'))[0]?.to).toBe('Roadmap.md')
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('is a link that resolves, so it is not a link out to nowhere', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'Other.md': '[[Roadmap]]\n',
    })

    const [out] = links.outgoing(at('Other.md'))
    expect(out?.to).not.toBeNull()
    // The row reads as the note it found rather than as the words that were
    // written, which is how a reader learns which note the alias meant. The file's
    // own name; the row shows `shownName` of it.
    expect(out?.name).toBe('Plan.md')
  })

  test('keeps the alias when the note is renamed', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'ByName.md': 'See [[Plan]].\n',
      'ByAlias.md': 'See [[Roadmap]].\n',
    })

    const touched = await links.retarget(at('Plan.md'), at('Programme.md'), ROOT)

    expect(touched).toBe(1)
    expect(notes['ByName.md']).toBe('See [[Programme]].\n')
    // A name the writer chose is not a filename, so a rename leaves it alone.
    expect(notes['ByAlias.md']).toBe('See [[Roadmap]].\n')
  })

  test('is mentioned when somebody writes it without a link', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'Other.md': 'The Roadmap is worth reading.\n',
    })

    const mentions = await links.unlinked(at('Plan.md'), ROOT)
    expect(mentions.map((one) => one.path)).toEqual(['Other.md'])
  })

  test('counts one line that writes two of its names once', async () => {
    await space({
      'Plan.md': '---\naliases: [Roadmap, Blueprint]\n---\n',
      'Other.md': 'The Roadmap, also the Blueprint.\n',
    })

    expect((await links.unlinked(at('Plan.md'), ROOT)).length).toBe(1)
  })

  test('changes the moment the note does, without the space being read again', async () => {
    await space({
      'Plan.md': '# Plan\n',
      'Other.md': '[[Roadmap]]\n',
    })
    expect(links.outgoing(at('Other.md'))[0]?.to).toBeNull()

    links.noteSaved(at('Plan.md'), '---\naliases: [Roadmap]\n---\n\n# Plan\n')
    expect(links.outgoing(at('Other.md'))[0]?.to).toBe('Plan.md')
  })
})
