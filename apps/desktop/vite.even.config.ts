/** The build that becomes the Even Realities plugin.
 *
 *  A build of its own rather than a third entry beside the editor's, because what
 *  the plugin ships is decided by leaving code *out*, and one bundle cannot leave
 *  something out of one of its entries. The store's own review is what asked for
 *  it, twice:
 *
 *    1. "Bundle contains URLs not covered by `network.whitelist`."
 *    2. "`new Function()` is used in the bundle ... same risk class as `eval()`."
 *
 *  Both are the same finding underneath: the plugin was carrying every library the
 *  editor has, including several a pair of glasses can never use, and each of them
 *  brought its own documentation links and its own way of turning a string into
 *  code. The answer is not to patch those strings. It is to not ship the libraries.
 *
 *  What is left out, and why:
 *
 *  | Left out | Why | What went with it |
 *  | --- | --- | --- |
 *  | running a fence | Emil: "JavaScript execution is not needed by the Even Realities plugin" | `new Function(CODE)`, `(0, eval)(CODE)`, the play button |
 *  | mermaid, flowchart.js | a diagram cannot be drawn on a panel of one font | 33 URLs, and lodash's `Function('return this')` four times over |
 *  | the exporters | a WebView cannot save a file | 71 URLs, two more `Function(...)`, jszip's string-fed timer |
 *  | the PDF viewer | the glasses cannot show a PDF, and the plugin never opens one | 4 URLs and 1.7 MB |
 *  | the pug mode | one language's highlighting, against `Function('', ...)` | the last `Function(` |
 *
 *  11.8 MB in 270 chunks became 6.0 MB in 162; the packed .ehpk, 4.4 MB to 2.7.
 *
 *  Everything else is the same app: the same components, the same stores, the same
 *  sync, the same rooms. `__EVEN_PLUGIN__` is what the app itself reads to know it
 *  should not offer what is not here, and the branches it guards are removed by the
 *  bundler along with everything they reach.
 *
 *  The few URLs that are left after that are a library's own error links, and they
 *  are rewritten where the folder is staged; see scripts/even-stage.mjs. Two tests
 *  hold the staged folder to both findings. */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import manifest from './even.app.json'

/** Modules the plugin does not have, by the specifier that asks for them.
 *
 *  Only libraries: our own code is left out by `__EVEN_PLUGIN__` instead, so that
 *  the app knows not to offer what is missing rather than finding out by throwing.
 *  Each one is here because it brought a URL or a way of evaluating a string, and
 *  because nothing the plugin does needs it. */
const LEFT_OUT = new Set([
  'mermaid',
  'flowchart.js',
  '@codemirror/legacy-modes/mode/pug',
  // The PDF viewer. `openEntry` already declines to open one here, but the viewer
  // is a component of a pane rather than a module behind that call, so the library
  // came along regardless: 1.7 MB of it, a fifth of the package. Both specifiers,
  // because the worker is asked for by URL.
  'pdfjs-dist',
  'pdfjs-dist/build/pdf.worker.min.mjs?url',
  // The icon sets that are data rather than drawing: the emoji index and the
  // coloured set. Half a megabyte of JSON between them, for a picker whose one job
  // on a phone is to put a mark on a folder, and the glasses draw a row as words
  // with no mark in it at all. The stroked set is still here, because it is what the
  // interface itself is drawn in. See icon-sets.ts, which says what each set is for,
  // and icon-library.svelte.ts, which says so calmly when one is not here.
  'unicode-emoji-json/data-by-group.json',
  '@iconify-json/flat-color-icons/icons.json',
  // And what those sets are searched by: Lucide's tags, another 256 KB, and the
  // emoji's keywords, which `node-emoji` brings along for the editor regardless and
  // which are named here for the rule rather than for the weight. The picker still
  // opens without either and still finds an icon by its name; see icon-sets.ts, where
  // the absence is caught rather than thrown.
  'lucide-static/tags.json',
  'emojilib/emojis.json',
])

/** What a module that is not here answers with.
 *
 *  A getter rather than a thrown error at import time: the app guards these paths
 *  with `__EVEN_PLUGIN__` and never reaches one, and a module that throws while it
 *  is being loaded would take a whole chunk with it if that guard ever slipped. */
const ABSENT = `
const gone = () => {
  throw new Error('not in the Even Realities plugin')
}

export default new Proxy({}, { get: gone, apply: gone })
`

/** Running a fence, as the plugin has it: not at all.
 *
 *  The editor composes the run panels into the live preview and binds a key to
 *  them, so this stands in for that module rather than the app being changed to
 *  ask for it. An empty extension draws no play button, and a command that answers
 *  false lets the key fall through to the one under it, which is what happens
 *  today when the caret is not in a fence.
 *
 *  It is here rather than behind `__EVEN_PLUGIN__` because the editor package is
 *  built and tested on its own, and a build-time constant it cannot see would be a
 *  reference error in its own tests. */
const NO_RUNNING = `
export const runExtension = []
export function runFenceAtCursor() {
  return false
}
export function isRunnableLanguage() {
  return false
}
export function runnableFenceAt() {
  return null
}
export function runFence() {
  return false
}
`

/** The module the run extension lives in, by where it sits rather than by what
 *  asks for it: two files import it under two different relative names. */
const RUNNER = 'packages/editor/src/run/run'

/** An interface catalogue, by the file it is in. */
const CATALOGUE = /\/locales\/([\w-]+)\.ts$/

/** The catalogues the firmware has no glyphs for.
 *
 *  The app has forty interface catalogues, one lazily loaded chunk each. A
 *  reader loads one of them; the store packs all forty, which took this package
 *  from 6.8 MB to 8.68 MB. And the firmware has one font: it draws Latin, Cyrillic,
 *  Greek, CJK and emoji, so these fifteen scripts - Devanagari (`hi`, `mr`), Bengali,
 *  Tamil, Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Arabic, Persian, Pashto,
 *  Urdu, Thai, Burmese and Amharic - would put a row of boxes on the glass however
 *  right the words are. They are not shipped, and the panel says those readers' words
 *  in English instead; see lib/even/panel-words.ts.
 *
 *  **Written out here and measured in the test**, because a Vite config is loaded by
 *  Node before anything is compiled and cannot import the metrics it would need to
 *  ask. `src/lib/even/bundle.test.ts` reads every catalogue, asks `undrawable` in the
 *  glasses package what share of it the font has no glyph for, and holds the staged
 *  package to the answer: every catalogue over a tenth absent, every one under it
 *  present. Measured, the two groups are 0.0% and 31% and more, so the day the
 *  firmware gains a script the test says which line to delete. */
const NOT_DRAWN = new Set([
  'am',
  'ar',
  'bn',
  'fa',
  'gu',
  'hi',
  'kn',
  'ml',
  'mr',
  'my',
  'pa',
  'ps',
  'ta',
  'te',
  'th',
  'ur',
])

function withoutWhatTheGlassesCannotUse() {
  const absent = '\0nib-absent'
  const runner = '\0nib-no-running'
  const catalogue = '\0nib-no-catalogue:'

  return {
    name: 'nib-even-without',
    // Before Vite's own resolver, which would otherwise answer first and there
    // would be nothing left to redirect.
    enforce: 'pre' as const,
    async resolveId(source: string, importer: string | undefined, options: object) {
      if (LEFT_OUT.has(source)) return absent

      // Resolved first, because the runner is asked for as `./run/run` from one
      // file and `../run/run` from another, and neither name says where it is.
      const found = await (this as unknown as Resolver).resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      if (!found) return null

      const path = found.id.replace(/\\/g, '/')
      const id = CATALOGUE.exec(path)?.[1]
      if (id !== undefined && NOT_DRAWN.has(id)) return `${catalogue}${id}`

      return path.includes(RUNNER) ? runner : null
    },
    load(asked: string) {
      if (asked === absent) return ABSENT
      if (asked === runner) return NO_RUNNING

      // An empty catalogue rather than a module that throws: every string in this app
      // is filed under what it says in English, so a catalogue with nothing in it
      // *is* English. `i18n.load` takes the named export straight out of the module,
      // and a stub that threw on the way would leave it holding undefined.
      if (asked.startsWith(catalogue)) {
        const id = asked.slice(catalogue.length)
        return `export const ${id.replace(/-/g, '_')} = {}\n`
      }

      return null
    },
  }
}

/** The part of a Rolldown plugin's context this uses. Said out loud because the
 *  plugin is written as a plain object rather than through a typed helper. */
interface Resolver {
  resolve(
    source: string,
    importer: string | undefined,
    options: object,
  ): Promise<{ id: string } | null>
}

export default defineConfig({
  plugins: [svelte(), withoutWhatTheGlassesCannotUse()],
  define: {
    // The plugin's own version, so a screenshot of a phone says which build is on
    // it, and the flag every branch below reads.
    __EVEN_BUILD__: JSON.stringify(`${manifest.version} even`),
    __EVEN_PLUGIN__: 'true',
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'esnext',
    outDir: 'dist-even',
    emptyOutDir: true,
    rollupOptions: {
      input: { even: resolve(import.meta.dirname, 'even.html') },
    },
  },
})
