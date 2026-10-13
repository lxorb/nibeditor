import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The name a reader sees is Orden.
 *
 *  The product was Nib, then nibeditor (2026-09-08, docs/backlog.md Q18), and is
 *  Orden since 2026-10-12. After the first rename the old name stayed on in the
 *  welcome note, the Mac's menu, a window's title and a dozen sentences, because
 *  nothing said where it was. This does: every string in the app's source and in
 *  every catalogue is read, comments left out, and one that calls the app Nib or
 *  nibeditor fails.
 *
 *  What still says an old name on purpose is an identifier, and changing one breaks
 *  an install somebody already has: the folder the notes live in (`Documents/Nib`),
 *  the folder an install from before a rename keeps (`AppData\Local\Nib`, and
 *  `Nib.app` until it renames itself; see src-tauri/src/bundle_name.rs), the keys a
 *  `.url` shortcut carries (`Nib-Icon`), the address the service had (`nibeditor.com`,
 *  which goes on answering), and the welcome note an older version wrote, which has
 *  to be recognised word for word. Those are told apart below by where the word
 *  sits, or named one by one. And one sentence says both names, because saying the
 *  old one is its whole point: the notice that the name changed. */

const APP = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(APP, 'src')

/** Either old name, as a word of its own. Letters of another script may touch it -
 *  a Gujarati suffix, an Amharic prefix, a Korean particle - and it is still the
 *  name. `NibEditor` is how some people wrote the second one. */
const OLD_NAME = /(?<![A-Za-z])(?:Nib|[Nn]ib[Ee]ditor)(?![A-Za-z])/g

/** Where the word is an identifier rather than a name: a segment of a path, a file
 *  of the installed app, a host (`nibeditor.com`), or one of a `.url` shortcut's own
 *  keys. */
function identifier(text: string, at: number, length: number): boolean {
  const before = text[at - 1] ?? ''
  const after = text.slice(at + length)
  return /[\\/]/.test(before) || /^(?:[\\/]|\.[A-Za-z]|-(?:Added|Home|Icon|Data)\b)/.test(after)
}

/** Strings that say an old name because they have to, by the file that holds them. */
const NAMED: Record<string, string[]> = {
  // The seeds as the app wrote them under each earlier name, recognised so they
  // never sync.
  'lib/welcome.ts': ['# Welcome to Nib', '# Welcome to nibeditor'],
  // The browser's stand-in for the folder every desktop keeps its spaces in.
  'lib/web/commands.ts': ['Nib'],
}

/** Rows every catalogue holds under an old name, because a server that has not been
 *  renamed yet sends these words and they are looked up as sent. Their translations
 *  say Orden. */
const SENT: string[] = ['set an OpenAI key in nibeditor’s settings first']

/** The one sentence that says the old name and the new one together, in whatever
 *  language: the notice that the name changed. Nothing else names both. */
const renaming = (text: string) => text.includes('Orden')

/** The string literals in a script, its comments left out: everything in it a
 *  person could be shown. A template's `${}` is read as script again, so a string
 *  inside one is found as well. Escapes are kept as written. */
function literals(code: string): string[] {
  const found: string[] = []
  /** The brace depth each open `${` was entered at, innermost last. */
  const open: number[] = []
  let depth = 0
  let at = 0

  /** A quote's contents, from the quote to its twin or the end of the line. */
  function quoted(quote: string): string {
    const start = ++at
    while (at < code.length && code[at] !== quote && code[at] !== '\n') {
      at += code[at] === '\\' ? 2 : 1
    }
    return code.slice(start, at++)
  }

  /** A template's text, from where `at` is to the backtick or the `${` that ends it. */
  function run(): string {
    const start = at
    while (at < code.length) {
      if (code[at] === '\\') at += 2
      else if (code[at] === '`') return code.slice(start, at++)
      else if (code[at] === '$' && code[at + 1] === '{') {
        open.push(depth)
        depth = 0
        at += 2
        return code.slice(start, at - 2)
      } else at++
    }
    return code.slice(start)
  }

  while (at < code.length) {
    const one = code[at]
    const next = code[at + 1]

    if (one === '/' && next === '/') {
      const end = code.indexOf('\n', at)
      at = end < 0 ? code.length : end
    } else if (one === '/' && next === '*') {
      const end = code.indexOf('*/', at + 2)
      at = end < 0 ? code.length : end + 2
    } else if (one === "'" || one === '"') {
      found.push(quoted(one))
    } else if (one === '`') {
      at++
      found.push(run())
    } else if (one === '}' && depth === 0 && open.length > 0) {
      depth = open.pop() ?? 0
      at++
      found.push(run())
    } else {
      if (one === '{') depth++
      if (one === '}') depth--
      at++
    }
  }

  return found
}

/** What a reader could be shown out of one file: a script's strings, and all of a
 *  component's markup but its comments. */
function readable(path: string, source: string): string[] {
  if (!path.endsWith('.svelte')) return literals(source)

  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  )
  const markup = source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  return [...scripts.flatMap(literals), markup]
}

/** Every script and component under `dir`, tests left out. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

/** Each place `text` calls the app by an old name, the identifiers left out. */
function oldNames(text: string): number[] {
  return [...text.matchAll(OLD_NAME)]
    .filter((match) => !identifier(text, match.index, match[0].length))
    .map((match) => match.index)
}

describe('reading a script for its strings', () => {
  test('finds each kind of string and no comment', () => {
    const code = [
      "const a = 'one' // 'not this'",
      '/* "nor this" */ const b = "two"',
      "const c = `three ${d ? `four` : 'five'} six`",
      "const e = { f: 'se\\'ven' }",
    ].join('\n')

    expect(literals(code)).toEqual(['one', 'two', 'three ', 'four', 'five', ' six', "se\\'ven"])
  })
})

describe('the name a reader sees', () => {
  test('is Orden in every string of the app and every catalogue', () => {
    const offenders: string[] = []

    for (const path of sources(SOURCE)) {
      const where = relative(SOURCE, path).replace(/\\/g, '/')
      const named = [...(NAMED[where] ?? []), ...(where.startsWith('locales/') ? SENT : [])]

      for (const text of readable(path, readFileSync(path, 'utf8'))) {
        if (named.includes(text) || renaming(text)) continue
        for (const at of oldNames(text)) {
          offenders.push(`${where}: ${text.slice(Math.max(0, at - 50), at + 50).trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  test('is Orden in the pages the app is served in and on its manifests', () => {
    for (const name of [
      'index.html',
      'presenter.html',
      'quick-add.html',
      'even.html',
      'handoff.html',
      'public/manifest.webmanifest',
      'even.app.json',
    ]) {
      const text = readFileSync(join(APP, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      expect(oldNames(text), name).toEqual([])
      expect(text, name).toContain('Orden')
    }
  })

  test('tells an identifier from the name', () => {
    expect(oldNames('Documents/Nib')).toEqual([])
    expect(oldNames('C:\\Users\\a\\AppData\\Local\\Nib\\nib.exe')).toEqual([])
    expect(oldNames('/Applications/Nib.app')).toEqual([])
    expect(oldNames('Nib-Icon=https://a.example/favicon.ico')).toEqual([])
    expect(oldNames('Nib-Data=3f9a0c17e2b4d685')).toEqual([])
    expect(oldNames('https://nibeditor.com/handoff')).toEqual([])
    expect(oldNames('Notes from nibeditor.com')).toEqual([])
    expect(oldNames('github.com/lxorb/nibeditor')).toEqual([])

    expect(oldNames('Welcome to Nib')).toEqual([11])
    expect(oldNames('Nib-E-Mail')).toEqual([0])
    expect(oldNames('Nibનું')).toEqual([0])
    expect(oldNames('Welcome to nibeditor')).toEqual([11])
    expect(oldNames('NibEditor is now Orden')).toEqual([0])
    expect(oldNames('nibeditor-E-Mail')).toEqual([0])
    expect(oldNames('nibeditor가')).toEqual([0])
    expect(oldNames('Orden')).toEqual([])
  })
})
