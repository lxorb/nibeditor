import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The documents in `docs/`, held to the tree they describe.
 *
 *  A map is only worth reading while it is true, and the way one stops being true
 *  is quietly: a module is renamed, the sentence naming it is not, and the next
 *  reader is sent to a file that is not there. So every path a document writes in
 *  backticks has to exist.
 *
 *  Paths only. What a module *owns* is prose and no test can hold it, but a path is
 *  a fact, and it is the half a rename breaks. Every document rather than the map
 *  alone, because they all point at the code the same way and rot the same way; the
 *  list is read off the folder, so a new one is covered by being written. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DOCS = `${ROOT}docs/`

/** What reads as a path into this repository, inside backticks.
 *
 *  Anchored on a folder every reader knows, so prose about `a/b` and a command like
 *  `pnpm test` are not mistaken for one. A path may end in a glob, which names a
 *  folder to look in rather than a file to find. */
const PATH = /`((?:apps|packages|services|scripts|spike|docs)\/[A-Za-z0-9_./*-]+)`/g

/** What a command makes rather than what is committed.
 *
 *  A document names these as well, and they are there on a machine that has built and
 *  absent on a fresh runner - so none is rot. Git knows which is which and is the
 *  obvious thing to ask, but it cannot answer the case that matters: `.gitignore` says
 *  `dist/`, a pattern that matches only a directory, and `git check-ignore` decides
 *  directory-ness off the filesystem - so with the build absent, which is the whole
 *  point, it reports the path as not ignored.
 *
 *  A list instead, three long and deliberate. Something added to it is a new kind of
 *  output somebody wrote a document about, which is worth a line. `dist-even` is the
 *  plugin package `build:even` stages and `pnpm even:pack` packs. It went a while
 *  without a line because the bundle test built it on every run; since that test
 *  builds into a folder of its own, a fresh runner has no `dist-even` at all. */
const MADE = ['apps/desktop/dist', 'apps/desktop/dist-even', 'apps/desktop/test/e2e/shots']

function exists(path: string): boolean {
  if (MADE.some((made) => path === made || path.startsWith(`${made}/`))) return true

  const star = path.indexOf('*')
  const named = star === -1 ? path : path.slice(0, path.lastIndexOf('/', star))

  return existsSync(`${ROOT}${named}`)
}

function pathsIn(name: string): string[] {
  const text = readFileSync(`${DOCS}${name}`, 'utf8')
  return [...new Set([...text.matchAll(PATH)].map((match) => match[1] ?? ''))]
}

const documents = readdirSync(DOCS)
  .filter((name) => name.endsWith('.md'))
  .sort()

describe('the paths the documents name', () => {
  test('the scan finds the documents', () => {
    expect(documents).toContain('conventions.md')
    expect(documents.length).toBeGreaterThan(10)
  })

  for (const name of documents) {
    test(`${name} points at files that are there`, () => {
      const missing = pathsIn(name).filter((path) => !exists(path))
      expect(missing, missing.join('\n')).toEqual([])
    })
  }

  /** A guard on the guard: the map is mostly paths, so a scan that matched none of
   *  them would pass every test above while holding nothing. */
  test('and the map names a good many of them', () => {
    expect(pathsIn('conventions.md').length).toBeGreaterThan(40)
  })
})
