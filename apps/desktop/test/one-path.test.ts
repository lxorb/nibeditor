import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Two paths are compared one way: `samePath`, `within` and `movedTo` in
 *  src/lib/space-paths.ts, which set separators, composition and - where the disk
 *  does - case aside. A bare `===` between two paths is the comparison that made
 *  `plan.md` and `Plan.md` two documents over one file, and a bare `startsWith`
 *  is the one that closed `Workshop.md` when the folder `Work` was deleted.
 *
 *  Held over the workspace and the stores it keeps by path, which is where every
 *  file operation lands. Two operands both named for a path are the test; a rename's
 *  own question, whether a name is written any differently at all, is
 *  `sameSpelling`. Where the spaces folder itself moved is not two paths compared
 *  but a folder's stored text said again under another; see moved.ts. */

const LIB = fileURLToPath(new URL('../src/lib/', import.meta.url))

const FILES = [
  'workspace.svelte.ts',
  ...readdirSync(join(LIB, 'workspace'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'moved.ts')
    .map((name) => `workspace/${name}`),
]

/** An operand that names a path: a word or a member ending in path, root, folder or
 *  dir, whatever its case, and not the name of a call. */
const PATH = String.raw`[\w$.?]*(?:[pP]ath|PATH|[rR]oot|[fF]older|\bdir)\b(?!\s*\()`

const COMPARED = new RegExp(String.raw`${PATH}\s*[!=]==\s*${PATH}`, 'g')
const PREFIXED = new RegExp(String.raw`${PATH}\??\.startsWith\(`, 'g')

/** What each file says where it compares two paths by hand, comments left out. */
function offenders(pattern: RegExp): string[] {
  const out: string[] = []

  for (const name of FILES) {
    const lines = readFileSync(join(LIB, name), 'utf8').split('\n')
    lines.forEach((line, at) => {
      const code = line.replace(/\/\/.*$/, '')
      if (/^\s*(\*|\/\*\*)/.test(code)) return
      if (pattern.test(code)) out.push(`${name}:${at + 1}: ${code.trim()}`)
      pattern.lastIndex = 0
    })
  }

  return out
}

describe('two space paths', () => {
  test('the scan reads the files it holds to', () => {
    expect(FILES.length).toBeGreaterThan(35)
  })

  test('are never compared with a bare === outside the helper', () => {
    expect(offenders(COMPARED)).toEqual([])
  })

  test('nor one found inside another by its first characters', () => {
    expect(offenders(PREFIXED)).toEqual([])
  })
})
