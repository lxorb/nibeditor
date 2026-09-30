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

  new Visitor({
    Literal(node) {
      if (typeof node.value === 'string') found.add(node.value)
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

/** A catalogue's module with only the rows `keep` says yes to, each one exactly as
 *  it was written.
 *
 *  A catalogue is one object, keyed by its English, as every file in src/locales is
 *  written. Anything else would be a new way of writing one, which this should hear
 *  about rather than pass over whole. */
export function onlyRows(code: string, keep: (english: string) => boolean): string {
  const tables = parsed(code, 'js').body.flatMap((statement) =>
    statement.type === 'VariableDeclaration'
      ? statement.declarations.flatMap((one) =>
          one.init?.type === 'ObjectExpression' ? [one.init] : [],
        )
      : [],
  )
  const [table, ...more] = tables
  if (!table || more.length) throw new Error(`a catalogue is one table, not ${tables.length}`)

  // The English a row is filed under is its key, however the key is spelled.
  const kept = table.properties.filter((row) => {
    if (row.type === 'Property' && !row.computed) {
      if (row.key.type === 'Identifier') return keep(row.key.name)
      if (row.key.type === 'Literal' && typeof row.key.value === 'string') {
        return keep(row.key.value)
      }
    }
    throw new Error('a catalogue row is `English: text`')
  })
  const rows = kept.map((row) => code.slice(row.start, row.end)).join(',')

  return code.slice(0, table.start + 1) + rows + code.slice(table.end - 1)
}
