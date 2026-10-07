import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parseSync } from 'vite'
import { describe, expect, test } from 'vitest'

/** The plugin's twins, held to the modules they stand in for.
 *
 *  The plugin's build answers `x.ts` with `x.even.ts` wherever there is one; see
 *  `twinOf` in vite.even.config.ts. Each twin's exports are typed by the real
 *  module's, so a signature that drifts is a type error, but a name the real module
 *  gains is not: the twin would simply not have it, and the plugin would import
 *  undefined. So this reads both and holds them to the same names. */

const repo = resolve(import.meta.dirname, '../../../../..')
const TWINS = Object.keys(
  import.meta.glob(['/src/**/*.even.{ts,svelte}', '/../../packages/*/src/**/*.even.{ts,svelte}']),
)

/** The names a module exports as values: a type is erased on the way into the
 *  package, so a twin owes none. */
function valuesOf(path: string): string[] {
  const { program } = parseSync(path, readFileSync(path, 'utf8'), { lang: 'ts' })
  const names: string[] = []

  for (const statement of program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      throw new Error(`${path}: \`export *\` cannot be held to a twin; name the exports`)
    }
    if (statement.type === 'ExportDefaultDeclaration') names.push('default')
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue

    const declared = statement.declaration
    if (declared?.type === 'VariableDeclaration') {
      for (const one of declared.declarations) {
        if (one.id.type === 'Identifier') names.push(one.id.name)
      }
    } else if (
      (declared?.type === 'FunctionDeclaration' || declared?.type === 'ClassDeclaration') &&
      declared.id
    ) {
      names.push(declared.id.name)
    }
    for (const one of statement.specifiers) {
      if (one.exportKind === 'type') continue
      names.push(one.exported.type === 'Identifier' ? one.exported.name : one.exported.value)
    }
  }

  return names.sort()
}

describe("the plugin's twins", () => {
  test('are found', () => {
    expect(TWINS.length).toBeGreaterThan(0)
  })

  for (const glob of TWINS) {
    const twin = resolve(import.meta.dirname, '../../..', glob.slice(1))
    const real = twin.replace(/\.even\.(ts|svelte)$/, '.$1')
    const name = relative(repo, twin).replace(/\\/g, '/')

    test(`${name} stands in for a module that is there, under the same names`, () => {
      expect(existsSync(real)).toBe(true)
      expect(valuesOf(twin)).toEqual(valuesOf(real))
    })
  }
})
