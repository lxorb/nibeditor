/** Which rows of an interface catalogue the Even Realities plugin can ask for.
 *
 *  The plugin ships the catalogues its firmware can draw, 24 of them, and it used to
 *  ship each one whole: every string the app gained cost the package twenty-four
 *  times its bytes, whether the plugin could ever show it or not - the terminal's
 *  words, the Mac's menu, the default browser. So its build keeps a row only where
 *  something can ask for it, and that is one of two things:
 *
 *    - Its English is written somewhere in the plugin's own code. Every string in the
 *      app is its own key and is handed to `t()` as it is written, so a row whose
 *      words are nowhere in the package is a row nothing in it can look up.
 *    - Its English is something the sync server says. The app looks those up as they
 *      arrive (see `message` in src/lib/i18n.svelte.ts), so no code of the app's
 *      writes them out and the plugin shows them all the same.
 *
 *  A row left out reads in English, which is what `t()` answers for any row a
 *  catalogue has not got; and nothing left out is anything the plugin can ask.
 *
 *  And the rows that are kept are written as a column: the English once, in
 *  src/lib/even/catalogue-keys.ts, and each catalogue as its words in the same order.
 *
 *  vite.even.config.ts trims with this, and src/lib/even/bundle.test.ts holds the
 *  staged package to both halves of it: nothing the plugin asks for missing, and
 *  nothing it cannot ask for shipped. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseSync, Visitor } from 'vite'

/** A piece of code as a tree, or an error: code that does not parse is not code this
 *  can say anything about, and a guess would trim a catalogue by it. */
function parsed(code: string, lang: 'js' | 'ts') {
  const { program, errors } = parseSync(`code.${lang}`, code, { lang })
  if (errors.length) throw new Error(errors.map((one) => one.message).join('\n'))

  return program
}

/** Every string a piece of code writes out whole: a quoted literal, or a template
 *  with nothing put into it, which is how the minifier likes to write one. */
export function stringsIn(code: string, lang: 'js' | 'ts' = 'js'): Set<string> {
  const found = new Set<string>()
  // A string that names a property is not words: `Effect["Blur"] = "blur"` is how a
  // compiled enum in a dependency spells its member, and the minifier then writes it
  // `e.Blur`, so the build would keep a row the shipped package never asks for.
  const named = new Set<unknown>()

  new Visitor({
    MemberExpression(node) {
      if (node.computed) named.add(node.property)
    },
    Literal(node) {
      if (typeof node.value === 'string' && !named.has(node)) found.add(node.value)
    },
    TemplateLiteral(node) {
      const [only, ...more] = node.quasis
      if (only?.value.cooked != null && !more.length) found.add(only.value.cooked)
    },
  }).visit(parsed(code, lang))

  return found
}

/** What the server can say, read off its source: every string in it, of which the
 *  ones a catalogue has a row for are its messages. */
export function serverWords(): Set<string> {
  const found = new Set<string>()
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        for (const one of stringsIn(readFileSync(path, 'utf8'), 'ts')) found.add(one)
      }
    }
  }

  walk(resolve(import.meta.dirname, '../../services/sync/src'))
  return found
}

/** The one table a catalogue's module is, and its rows by their English.
 *
 *  A catalogue is one object, keyed by its English, as every file in src/locales is
 *  written - exported or not, and handed to `rowsOf` once the build has wrapped it.
 *  Anything else would be a new way of writing one, which this should hear about
 *  rather than pass over whole. */
function tableIn(code: string, lang: 'js' | 'ts') {
  const tables = parsed(code, lang).body.flatMap((statement) => {
    const declared = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declared?.type !== 'VariableDeclaration') return []

    return declared.declarations.flatMap(({ init }) => {
      if (init?.type === 'ObjectExpression') return [init]
      const [only, ...more] = init?.type === 'CallExpression' ? init.arguments : []
      return only?.type === 'ObjectExpression' && !more.length ? [only] : []
    })
  })
  const [table, ...more] = tables
  if (!table || more.length) throw new Error(`a catalogue is one table, not ${tables.length}`)

  // The English a row is filed under is its key, however the key is spelled.
  const rows = table.properties.map((row) => {
    if (row.type === 'Property' && !row.computed) {
      const { key } = row
      const english =
        key.type === 'Identifier'
          ? key.name
          : key.type === 'Literal' && typeof key.value === 'string'
            ? key.value
            : null
      if (english !== null) return { english, text: code.slice(row.value.start, row.value.end) }
    }
    throw new Error('a catalogue row is `English: text`')
  })

  return { start: table.start, end: table.end, rows }
}

/** The English of every row a catalogue's module has, in the order it has them. */
export function englishIn(code: string): string[] {
  return tableIn(code, 'js').rows.map((row) => row.english)
}

/** A catalogue as written, with its table handed to `helper` - which the build points
 *  at catalogue-keys.ts, so that the module that will hold the English is one every
 *  shipped catalogue imports. */
export function handedTo(code: string, helper: string): string {
  const { start, end } = tableIn(code, 'ts')

  return `${code.slice(0, start)}${helper}(${code.slice(start, end)})${code.slice(end)}`
}

/** A catalogue's module with its table as a column: the rows `keys` names, in that
 *  order, each exactly as it was written, and nothing where it has no row. The English
 *  is the keys and is not repeated: written once in catalogue-keys.ts rather than in
 *  each of 24 catalogues, which is 550 KB of the same strings. */
export function inColumn(code: string, keys: readonly string[]): string {
  const { start, end, rows } = tableIn(code, 'js')
  const text = new Map(rows.map((row) => [row.english, row.text]))
  // A row that is not here is a hole, which `rowsOf` passes over.
  const column = keys.map((english) => text.get(english) ?? '').join(',')

  return `${code.slice(0, start)}[${column}]${code.slice(end)}`
}
