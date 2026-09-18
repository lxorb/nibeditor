import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the app evaluates before it has drawn anything.
 *
 *  Emil wants nib to open like Notepad, and the one number that decides whether it
 *  can is the size of the module graph in front of the first paint: every module
 *  reached by a static import from `src/main.ts` is fetched, parsed and run before a
 *  window is on screen, whether or not the reader ever uses what is in it.
 *
 *  Batch 109 measured that graph at 3.20 megabytes of built JavaScript and brought it
 *  to 1.70. Nothing in it was wrong; it was five static imports of things that are
 *  almost never needed at once - the whole Lucide set for seven file marks, KaTeX and
 *  its chemistry pack and the emoji table for the notes that have a formula or a
 *  `:shortcode:` in them, the Vim keymap for a mode that is off, the canvas and the
 *  PDF viewer and the graph and the settings sheet for a window that opens on a note.
 *
 *  Batch 110 took the same 1.70 to 1.47, and every one of the four was the same shape
 *  again: the sheets App.svelte mounted for a window that shows none of them, the
 *  collaboration engine for a session nobody has signed in to, the list of a hundred
 *  and forty-three fence languages for a note with no fence in it, and the HTML
 *  converter for a paste of plain text. Each is one edge below.
 *
 *  Batch 118 took the built figure from 1.52 megabytes to 1.35, and that one was not an
 *  edge of ours at all: `@codemirror/lang-markdown` imports `@codemirror/lang-html` for
 *  the raw blocks and inline tags in a note, which brings the CSS and JavaScript
 *  grammars and the LR parser runtime with it - a hundred and sixty-seven kilobytes,
 *  fourteen milliseconds of the launch measured in Chrome, for the notes that have a
 *  tag in them. What that package asks for now is a door of nib's own, said once in the
 *  root manifest; see packages/lang-html. Which is why the last two tests here are
 *  about a manifest and a dynamic import rather than about this graph: the edge that
 *  holds those five packages out is inside a dependency, where no walk of our own
 *  source can see it.
 *
 *  Batch 119 took 1.36 megabytes to 1.29, and this time none of it was a library at
 *  all: it was the shell itself - what the window carries in order to draw a note and
 *  a file list. The Search panel and the engine that ranks for it, the find bar, the
 *  reading view, the rows of the app menu, the publish sheet's store, the import
 *  sheet's store and the whole recorder were in front of the first paint for a window
 *  that shows none of them. Each is one edge below, and each of them is asked for
 *  rather than carried now: four of them at the last turn of the launch order, so that
 *  a key which can open one at any moment never waits for it; see `warmDoors` in
 *  src/lib/surfaces.svelte.ts.
 *
 *  Batch 120 took 1.29 megabytes to 1.23, over five edges of five different kinds, and
 *  the largest of them was a dependency's again: `@codemirror/lang-markdown` imports the
 *  completion library at the top of its module, for the tag names a `<` offers through a
 *  source nib never asks, and that held the whole popup - thirty-five kilobytes - in
 *  front of the first paint. The others were the crate's own IPC, held there by one line
 *  of JavaScript asking for the platform's name; everything the app knows about talking
 *  to a model, for a glyph nobody had pressed; the phone's share intent and its speech
 *  recogniser, on a desktop that has neither; and JSON Canvas, for a window with no
 *  plane in it. Four of the five are capability or gesture gated now rather than
 *  fetched at a stage: a share arrives on the device that can receive one, a model on
 *  the press that asks, a plane on the first plane, and the popup with the first editor.
 *
 *  Batch 121 took 1.23 megabytes to 1.21, and it was one package with one edge in the
 *  most careful file in the editor: `keymap.ts` read `@codemirror/search` in order to
 *  adopt Find, its two steps and goto-line off the library's own keymap, and reading
 *  that array is importing the engine - fifteen kilobytes of query, cursor and
 *  replacement for a bar nobody has opened. The four keys are declared by hand now and
 *  run nib's own commands through a door, the library's keymap is not spread underneath
 *  them any more (every one of its seven keys was already adopted, claimed or dead, and
 *  `unclaimedKeymap` says which is which), and the engine arrives in a compartment at
 *  the launch's last turn - because one thing it carries happens unasked, the faint
 *  marks under the other occurrences of a selected word. The keys are bound from the
 *  first frame throughout: a Control+F in front of the fetch opens the bar, once, and
 *  what was typed into it is looked for as the engine lands. See
 *  packages/editor/src/find.ts, and find-keys.test.ts for the cold press.
 *
 *  Each of those is one edge in this graph, and any of them can come back by
 *  accident: a barrel import instead of a file, a type that was not imported as a
 *  type, a helper moved into a module that happens to sit behind a library. So the
 *  graph is measured here rather than remembered, and this is the only test in the
 *  repository whose job is to fail when somebody makes the app slower to open.
 *
 *  Read off the source rather than out of a bundle, the way
 *  packages/editor/test/weight.test.ts is, so it needs no build and answers the same
 *  whichever bundler the app is built with. It counts our own source; the packages it
 *  reaches are held to a list of names instead, because what a library weighs is not
 *  something a file in this repository can read. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url))

/** The workspace packages, by the name an import asks for them under. Resolved
 *  through each one's own `exports` map, so a subpath reaches the module that subpath
 *  exists for - which is the whole point of having them. */
const WORKSPACE = ['@nib/editor', '@nib/glasses', '@nib/markdown', '@nib/rooms', '@nib/themes']

/** Where a workspace import lands, or null when the specifier is not one of ours. */
function workspaceFile(specifier: string): string | null {
  const name = WORKSPACE.find((one) => specifier === one || specifier.startsWith(`${one}/`))
  if (!name) return null

  const folder = join(ROOT, 'packages', name.slice('@nib/'.length))
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>
  }
  const sub = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  const target = manifest.exports?.[sub]

  return target === undefined ? null : resolve(folder, target)
}

/** Where a relative import lands. The extensions a bundler would try, in its order. */
function relativeFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const tries = [base, `${base}.ts`, `${base}.svelte`, `${base}.js`, join(base, 'index.ts')]

  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

/** A static `import` or `export … from`, and a bare `import 'x'` for its side effects.
 *  A dynamic `import(…)` is a boundary by definition and is not matched: the whole
 *  question here is what runs before anything is drawn. */
const STATIC =
  /(?:^|[\n;}])[^\S\n]*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\n;}])[^\S\n]*import\s*['"]([^'"]+)['"]/g

/** A comment, so a specifier written in prose is not read as an import. Every file in
 *  this repository is heavily commented and several of the comments name modules. */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g

/** What a file asks for at load time. `import type` is erased before anything runs, so
 *  a type from a heavy module costs nothing and is left out. */
function asked(file: string): string[] {
  const source = readFileSync(file, 'utf8').replace(COMMENTS, (_whole, head?: string) => head ?? '')
  const found: string[] = []

  for (const match of source.matchAll(STATIC)) {
    const specifier = match[1] ?? match[2]
    if (specifier === undefined) continue
    if (/\b(?:import|export)\s+type\b/.test(match[0])) continue

    found.push(specifier)
  }

  return found
}

/** A file asked for as text rather than as itself: `?raw` hands the module a string of
 *  the whole file, `?inline` a data URI of it. Either way the bytes are in the chunk of
 *  whoever asked, and no bundler can shake out the part that is not read - a string is
 *  a string.
 *
 *  `?url` is deliberately not here. It yields an address, and the file it names is
 *  fetched when something uses it, which is a door like any other; the PDF worker is
 *  asked for that way.
 *
 *  This is where a hundred and twenty-six kilobytes were hiding. `raw.ts` in
 *  @nib/themes holds seven stylesheets as text for what an export and a deck bake into
 *  the file they write, the shell wanted one of them - the high contrast palette, three
 *  kilobytes - and a module is the unit a chunk is made of, so the shell got all seven.
 *  The module's own source is a dozen lines of comment, so the budget above saw nothing
 *  at all: 1.21 megabytes of built JavaScript in front of the first paint measured on
 *  2026-09-13, 1.41 measured on 2026-09-14, and no test between the two. See
 *  packages/themes/src/contrast.ts, which is the one sheet the shell may have. */
const TEXT = /\?(?:raw|inline)$/

/** Where a specifier asked for as text lands, whether it is ours or a library's.
 *
 *  A library's is looked for the way a bundler looks: every `node_modules` from the
 *  asking file up to the root, because a workspace package keeps its own dependencies
 *  beside itself and KaTeX's stylesheet is one of those. */
function assetFile(from: string, specifier: string): string | null {
  const bare = specifier.replace(/\?.*$/, '')
  const tries: string[] = []

  if (bare.startsWith('.')) tries.push(resolve(dirname(from), bare))
  else {
    let folder = dirname(from)
    for (;;) {
      tries.push(join(folder, 'node_modules', bare))
      const up = dirname(folder)
      if (up === folder || !folder.startsWith(ROOT.replace(/[\\/]$/, ''))) break
      folder = up
    }
  }

  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

/** Every file the entry reaches without crossing a dynamic import, every package any of
 *  them asks for, and every file any of them asks for as text. */
function eagerGraph(entry: string): {
  files: string[]
  packages: Set<string>
  bytes: number
  assets: string[]
  assetBytes: number
} {
  const files: string[] = []
  const packages = new Set<string>()
  const assets: string[] = []
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || files.includes(file)) continue
    files.push(file)

    for (const specifier of asked(file)) {
      if (TEXT.test(specifier)) {
        const text = assetFile(file, specifier)
        if (text && !assets.includes(text)) assets.push(text)
        continue
      }

      // A stylesheet is not a module graph: it is a rule, and the faces inside it are
      // fetched only once something on the page wears one.
      if (specifier.endsWith('.css')) continue

      const found = specifier.startsWith('.')
        ? relativeFile(file, specifier)
        : workspaceFile(specifier)
      if (found) queue.push(found)
      else if (!specifier.startsWith('.')) packages.add(specifier)
    }
  }

  const bytes = files.reduce((sum, one) => sum + statSync(one).size, 0)
  const assetBytes = assets.reduce((sum, one) => sum + statSync(one).size, 0)

  return { files, packages, bytes, assets, assetBytes }
}

/** Every file of ours under a folder, for the tests that ask a question of the whole
 *  source rather than of the graph. */
function everySource(folder: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name)
    if (entry.isDirectory()) out.push(...everySource(full))
    else if (/\.(?:ts|svelte)$/.test(entry.name)) out.push(full)
  }

  return out
}

const graph = eagerGraph(ENTRY)
const names = new Set(graph.files.map((one) => one.replace(/\\/g, '/')))

/** Whether any file in the graph is this one, named by the tail of its path. */
function holds(tail: string): boolean {
  return [...names].some((one) => one.endsWith(tail))
}

/** How much of our own source the app reads before it draws anything, in bytes, and
 *  how many files that is.
 *
 *  3,088,857 bytes over 372 files, measured on 2026-09-15, against 1,264,446 bytes of
 *  built JavaScript in the chunks `index.html` preloads - source counts the comments,
 *  and this repository has a great many of them. The built figure was 1,412,342 earlier
 *  the same day: the difference is one module split in two, and the test below that
 *  would have caught it in the first place.
 *
 *  This ceiling is one per cent over what was measured, where it used to be ten. The
 *  app opens in under a second and that is a rule rather than an aspiration, so the
 *  number is held close: a margin wide enough to absorb a subsystem is a margin that
 *  lets one in. One per cent is about thirty kilobytes, which is a module or two of
 *  ordinary work; anything larger is a decision, and a decision belongs in this
 *  comment beside the figure it moved.
 *
 *  It was 2,783,997 over 351 files on 2026-09-13. What moved it is the order the file
 *  list is read in, which is eager by definition rather than by accident: the first
 *  paint *is* the file list, and which row is row forty is decided over the listing
 *  before a row is drawn. What is *not* eager is everything about that order a reader
 *  has not asked for yet - the lift and the gap and the arithmetic of a drop
 *  (tree-lift.ts, tree-arranging.ts), the seven words of its menu (order-menu.ts) and
 *  the account's half of what somebody arranged (workspace/arranging.ts), thirty-one
 *  kilobytes fetched by the first drag, the first press on the menu and the first
 *  syncing pass. See docs/tree.md and lib/ai/ask.ts, which is the same seam.
 *
 *  3,117,488 over 373 files on 2026-09-15. Two and a half kilobytes of that is a batch of
 *  Emil's: one list of the kinds a new tab can be (new-kinds.ts), the chord that opens it,
 *  and the sheet that names an unsaved tab. Eager because a menu is: the strip's plus
 *  holds the list and the File menu reads the same one. What is not eager is the two
 *  heaviest halves of it - the buttons a pane with nothing open shows (NewHere.svelte,
 *  through `emptySurface`) and the places a save can write to (move-targets.ts, fetched by
 *  the first save) - so what arrived here is the list itself and the words for it.
 *
 *  3,123,073 over 374 files on 2026-09-15, which is where the ceiling below is set from,
 *  and it went *up* by five and a half kilobytes in a round whose whole subject was the
 *  launch. Worth saying why, because the number on its own reads backwards. The file is
 *  ground.ts, which is how the window opens in the colour it was last seen in rather than
 *  waiting for the webview to have something to show; and the round's saving is in the
 *  other two figures rather than this one - 1,412,342 built bytes to 1,264,446, and
 *  147,467 bytes of stylesheet quoted into a chunk to 3,092. A module that quotes a
 *  hundred and fifty kilobytes of CSS is a dozen lines long, so this figure could never
 *  have seen it. That is what `MOST_TEXT` below is for.
 *
 *  The two figures move independently, which is the point of having both: batch 118
 *  took a hundred and sixty-seven kilobytes out of the built one and put five hundred
 *  bytes of comment into this one, because what it moved was a library's own import.
 *
 *  Our own source only, and the library names below instead, because what a package in
 *  `node_modules` weighs is not something this file can read - and because the
 *  libraries are where the megabytes were in the first place. Which is also why the
 *  count matters beside the bytes: every one of these modules is parsed and run before
 *  a window is on screen, and half of them are twenty lines.
 *
 *  The built figure beside it is what a browser actually fetches before the entry
 *  module has run, and it is read off the build rather than from here:
 *
 *      pnpm exec vite build --mode production
 *
 *  then sum the `assets/*.js` that `dist/index.html` names - the entry script and
 *  every `rel="modulepreload"` beside it, which is exactly the eager graph as the
 *  bundler chunked it. Anything not in that list is behind a dynamic import.
 *
 *  Raised 2026-09-18 for open-link.ts, which is where a pressed link goes now that
 *  nib has pages of its own to put one in. 5,800 bytes of it, and it cannot be lazy:
 *  the pane hands the editor its link opener as the editor is built, and a module
 *  fetched on the first press would be a press that did nothing for a frame. Nor is
 *  it a subsystem arriving early - it is one pure decision and four lines of act, and
 *  the two stores it reaches for are both in this graph already.
 *
 *  Not a raise: measured 3,259,980 with the chord below in the graph beside it, which
 *  the ceiling that day was already raised past. So the figure stands where it is,
 *  and the next thing to arrive has that much less room.
 *
 *  Raised a third time 2026-09-17, to 3,277,000, for the Ctrl+T chord. The chord
 *  itself is not in here - new-kind-chord.ts is fetched at the launch's last turn
 *  with the other doors, which is why 279 lines cost nothing at the first paint.
 *  What is in here is the small eager half it needs: the key helpers, the note of
 *  which kind was chosen last, and a field on a menu row. Measured 3,244,532, which
 *  is 7,532 bytes and a fifth of one percent.
 *
 *  Three raises in one day is drift worth naming. Together they are 2.7 per cent of
 *  source bytes, and this figure is a proxy for the thing Emil actually asked for -
 *  a launch under a second - which was last measured at about 735 ms warm. Nothing
 *  here is near that. But the next raise should be asked to justify itself against a
 *  measured launch rather than against this number.
 *
 *  Raised again 2026-09-17, to 3,237,000, and this one is a debt rather than a
 *  cost. Fixing the glance card - so it draws a note's pictures at the space's own
 *  address and shows its metadata as rows instead of opening on raw YAML - made
 *  preview-card.ts import `frontMatterBlock`, and packages/markdown/src/front-matter.ts
 *  is 12,313 bytes. preview-card.ts is imported statically by Editor.svelte, so all
 *  of it now lands in front of the first paint for the sake of a card nobody sees
 *  until they hover a link. Measured 3,205,123, and 13,123 of the increase is that
 *  one module plus note-images.ts.
 *
 *  The right answer is to build the card behind a dynamic import, which would give
 *  back more than it took, and it is a change to Editor.svelte and the editor's
 *  option type rather than to this file. Until then the number says what happened.
 *
 *  Raised 2026-09-17 from 3,154,000 for workspace/open.ts, which is 6,756 bytes and
 *  a fifth of one percent. It is in the launch graph on purpose and cannot be made
 *  lazy: restoring a session opens documents, and it is the thing that makes two
 *  opens of one file one document. Without it a note could be open twice over, each
 *  copy reporting its own words as that file's, and whichever saved last won - one
 *  person's writing under another note's name, on disk and on the account. Measured
 *  3,160,756; this is that plus one percent. */
const BUDGET = 3_277_000
const MOST_FILES = 386

/** And how much of the first paint's weight is not code at all but a file quoted into a
 *  chunk: 3,092 bytes as this is written, which is contrast.css and nothing else.
 *
 *  A ceiling of its own rather than a share of `BUDGET`, because these bytes are
 *  invisible to it - the module that quotes a file is a line long whatever the file
 *  weighs - and because one stylesheet is the whole of what the shell has any business
 *  quoting. Anything that lands here is a subsystem's text arriving for a window that
 *  is not showing that subsystem, which is the same mistake as an eager import and the
 *  budget above cannot see it. Twice what is measured, so the sheet may grow. */
const MOST_TEXT = 6_500

describe('what the app evaluates before it draws anything', () => {
  test('is under the budget, in bytes of our own source', () => {
    expect(graph.bytes).toBeLessThan(BUDGET)
  })

  test('and under it in modules, which is what the parsing costs', () => {
    expect(graph.files.length).toBeLessThan(MOST_FILES)
  })

  test('and quotes almost no file into a chunk as text', () => {
    expect(graph.assetBytes, graph.assets.join(', ')).toBeLessThan(MOST_TEXT)
  })

  test('which for the one sheet it does quote is the contrast palette', () => {
    expect(
      graph.assets.map((one) => one.replace(/\\/g, '/').replace(/.*\/packages\//, '')),
    ).toEqual(['themes/src/contrast.css'])
  })

  /** Every one of these was in the first paint's graph before batch 109, and each is
   *  here because of the edge that put it there. Named rather than weighed: this file
   *  cannot read what a package in `node_modules` costs, and the point is the edge. */
  test.each([
    // The whole stroked set, six thousand icons, because file-mark.ts imported seven
    // of them off the library's index instead of out of their own files. The index is
    // loaded when the picker or a row wants an icon nobody named at build time; see
    // src/lib/icons.ts.
    ['lucide', 'the icon library'],
    // The formula engine, its chemistry pack and the emoji table, because the renderer
    // imported all three outright. Loaded when a note turns out to have a formula or a
    // `:shortcode:` in it; see @nib/markdown/engines.
    ['katex', 'the formula engine'],
    ['katex/contrib/mhchem', 'the chemistry pack'],
    ['node-emoji', 'the emoji table'],
    // The Vim keymap, for a mode that is off unless somebody turned it on. Loaded when
    // modal editing is asked for; see packages/editor/src/vim.ts.
    ['@replit/codemirror-vim', 'the vim keymap'],
    // The firmware font metrics, because the app's mode settings read the glasses'
    // compaction names off the package that also holds its text engine. Those names
    // are @nib/glasses/choices now.
    ['@evenrealities/pretext', 'the firmware font metrics'],
    // These four were already behind a boundary and must stay there: the diagram
    // drawers, the PDF viewer, and the writers an export loads.
    ['mermaid', 'the diagram drawer'],
    ['flowchart.js', "Typora's flowcharts"],
    ['pdfjs-dist', 'the PDF viewer'],
    ['docx', 'the Word writer'],
    ['jszip', 'the zip writer'],
    ['pdf-lib', 'the PDF writer'],
    ['emojilib', "the emoji table's own names"],
    ['unicode-emoji-json', 'the emoji index'],
    ['lucide-static', "Lucide's tags"],
    // The crate's IPC, and the one line of JavaScript that used to drag it in: the os
    // plugin, asked for the platform's name. Both are behind src/lib/native.ts and a
    // property read now; see the two tests at the foot of this file.
    ['@tauri-apps/api/core', "the crate's own IPC"],
    ['@tauri-apps/plugin-os', "the platform's name, asked for the long way"],
    // Batch 110's four. The collaboration engine, which is what a room costs and is
    // of no use until somebody signs in: it comes with the account now, because a
    // room is only ever joined for a file the account holds. See rooms.svelte.ts.
    ['yjs', 'the shared document'],
    ['y-protocols/awareness', 'the awareness protocol'],
    // The stock list of a hundred and forty-three fence languages - the list, not the
    // parsers, which were always fetched one at a time. It arrives with the first
    // fence that names a language; see packages/editor/src/languages.ts.
    ['@codemirror/language-data', 'the language list'],
    // The HTML converter, which arrives with the first page pasted or clipped. See
    // packages/editor/src/paste.ts.
    ['turndown', 'the HTML converter'],
    ['turndown-plugin-gfm', "the converter's GFM rules"],
    // Batch 118's five, which arrive with the first note that has a tag in it. The HTML
    // grammar is what colours a raw block or an inline tag, and it brings the other four
    // with it: CSS and JavaScript for what a `<style>` and a `<script>` inside it hold,
    // and the LR parser runtime all three are built on, which nothing else eager needs -
    // markdown's own parser is written by hand. Reached through packages/lang-html, and
    // through the fences that name them; never from here.
    ['@codemirror/lang-html', 'the HTML grammar'],
    ['@codemirror/lang-css', 'the CSS grammar'],
    ['@codemirror/lang-javascript', 'the JavaScript grammar'],
    ['@lezer/html', "HTML's own"],
    ['@lezer/css', "CSS's own"],
    ['@lezer/javascript', "JavaScript's own"],
    ['@lezer/lr', 'the parser runtime under all three'],
    // Batch 120's: the popup and the bracket pairs, which is everything that happens
    // after a keystroke rather than in order to draw a note. Held in the first paint by
    // the markdown language's own import of it until the manifest substituted a door;
    // see the two tests at the foot of this file, and completion.ts for what fetches
    // the real thing as the first editor is built.
    ['@codemirror/autocomplete', 'the completion popup'],
    // Batch 121's, and the last CodeMirror package in front of the first paint that is
    // not the editor itself: the query, the cursor that walks it and what a `$1` in a
    // replacement means. Held there by the keymap until the four keys it carried were
    // declared by hand; see `unclaimedKeymap` in packages/editor/src/keymap.ts.
    ['@codemirror/search', 'the search engine'],
  ])('does not reach %s (%s)', (asked) => {
    expect([...graph.packages]).not.toContain(asked)
  })

  /** And the same for our own code: the surfaces a window does not open on, and the
   *  two modules whose whole job is to import a library outright. */
  test.each([
    ['/lib/Canvas.svelte', 'the canvas'],
    ['/lib/canvas/ink.ts', "the canvas's ink"],
    ['/lib/Graph.svelte', 'the graph'],
    ['/lib/graph-layout.ts', "the graph's layout"],
    ['/lib/Pdf.svelte', 'the PDF viewer'],
    ['/lib/Pages.svelte', 'the pages surface'],
    ['/lib/PagesNavigator.svelte', "the pages surface's thumbnails"],
    ['/lib/web-tab/WebTab.svelte', 'the web tab'],
    ['/lib/SettingsPanel.svelte', 'the settings sheet'],
    ['/lib/export.ts', 'the exporters'],
    ['/editor/src/vim-mode.ts', "the vim mode's own module"],
    ['/markdown/src/maths.ts', 'the formula engine, dressed'],
    ['/markdown/src/eager.ts', "the Worker's pair of engines"],
    ['/glasses/src/mark.ts', "the glasses' text engine"],
    // The sheets App.svelte used to mount for a window that shows none of them. Each
    // is latched there and fetched the first time something opens it; see surfaces.svelte.ts.
    ['/lib/History.svelte', 'the version list'],
    ['/lib/ShareSheet.svelte', 'the share sheet'],
    ['/lib/PublishSheet.svelte', 'the publish sheet'],
    ['/lib/ImportSheet.svelte', 'the import sheet'],
    ['/lib/IconPicker.svelte', 'the icon picker'],
    ['/lib/Slides.svelte', 'the deck'],
    // The two kinds of room and the protocol under them, which is where yjs came in.
    ['/lib/rooms/room.ts', "a note's room"],
    ['/lib/rooms/plane.ts', "a canvas's room"],
    ['/rooms/src/index.ts', 'the room protocol'],
    // The fence languages: the vocabulary, the modes beside it and Mermaid's own.
    ['/editor/src/language-spellings.ts', "the fence languages' vocabulary"],
    ['/editor/src/language-modes.ts', 'the languages nobody ported'],
    ['/editor/src/mermaid.ts', "the diagram fence's tokenizer"],
    // The popup's own side of the same bargain: the library is fetched as the first
    // editor is built, which is a frame after the note is on screen rather than before
    // it. What every editor carries is the compartment; see editor/src/completion.ts.
    ['/editor/src/completing.ts', 'what the popup is built out of'],
    ['/editor/src/finding.ts', 'what a search is made of'],
    // And the converter a pasted page goes through.
    ['/markdown/src/from-html.ts', 'the HTML converter'],
    // Batch 119's: the shell's own, each of them a part of the window that is not on
    // screen when the window opens.
    //
    // The Search panel, with the field that understands operators, the tag tree under
    // it and the engine that ranks a loose match - which is what the panel is, and one
    // of five panels the sidebar has. Fetched when the tab is chosen, and at the last
    // turn of the launch either way; see Sidebar.svelte.
    ['/lib/SearchPanel.svelte', 'the Search panel'],
    ['/lib/search/fuzzy.ts', 'the ranking engine'],
    ['/lib/search/suggest.ts', 'the operator values it offers'],
    ['/lib/TagTree.svelte', "the panel's tag tree"],
    // The bar a note is searched through, which three panes draw and none has until a
    // key asks; see Pane.svelte.
    ['/lib/FindBar.svelte', 'the find bar'],
    // The note through the renderer, which is a face a tab wears rather than a window
    // the app opens on. The same bargain the five surfaces above are.
    ['/lib/Reading.svelte', 'the reading view'],
    ['/lib/reading/render.ts', 'what it draws with'],
    // The app menu's rows: every command in the app, named, asked whether it may run,
    // with the export list and the shortcut hints beside them. The menu itself stays -
    // it is the button in the title bar - and what it builds does not; see
    // AppMenu.svelte.
    ['/lib/app-menu.ts', "the app menu's rows"],
    // The two sheets whose stores the shell used to carry in order to know whether to
    // mount them. Each knocks on its own door as it is shown instead, so neither half
    // is here; see publishing.svelte.ts and importing.svelte.ts.
    ['/lib/publishing.svelte.ts', "the publish sheet's store"],
    ['/lib/importing.svelte.ts', "the import sheet's store"],
    ['/lib/import/read.ts', 'the readers behind it'],
    // And the recorder: the microphone, the container it writes, the WAV pieces, the
    // live transcript, the summary, and the pill that is the whole of what the window
    // says about an open microphone. What is left in the shell is the two rows' own
    // question - whether this device can record at all - and what they are called; see
    // recorder/commands.ts.
    ['/lib/recorder/recording.svelte.ts', 'the recorder'],
    ['/lib/recorder/microphone.ts', 'the microphone'],
    ['/lib/recorder/transcript.ts', "the transcript's markdown"],
    ['/lib/RecordingPill.svelte', 'the pill'],
    // Everything the app knows about talking to a model: which providers there are,
    // where their keys are kept, the streaming, what a model is told, the four
    // rewrites and the sheet they are read in. The glyph on an `ai` fence still
    // answers from the first paint - `installAiRunner` registers a stub that fetches
    // the runner with the first press - which is the whole of what the launch keeps.
    // See ai/ask.ts and ai/answering.ts.
    ['/lib/ai/answering.ts', 'what answers an ai fence'],
    ['/lib/ai/store.svelte.ts', 'the providers'],
    ['/lib/ai/providers.ts', 'what a provider is'],
    ['/lib/ai/complete.ts', 'the request to a model'],
    ['/lib/ai/keys.ts', 'where a key is kept'],
    ['/lib/ai/rewriting.svelte.ts', 'the four rewrites'],
    ['/lib/RewriteSheet.svelte', 'the sheet they are read in'],
    // The phone's own three ways in - something another app shared, a quick settings
    // tile, a widget row - and the recogniser behind Dictate. Gated on the capability
    // rather than on the build, so one bundle still runs everywhere: `onTheActivity`
    // and `speechRecogniser` are property reads, and a desktop answers no to both for
    // ever. Which also takes the import writer with them, since a share was the only
    // thing in the first paint that wrote one. See start.ts and mobile/dictation.ts.
    ['/lib/mobile/handed.ts', 'what the activity hands over'],
    ['/lib/mobile/shared.ts', 'what a share becomes'],
    ['/lib/mobile/widgets.svelte.ts', 'the rows the home screen draws'],
    ['/lib/mobile/dictating.ts', 'the two recognisers'],
    ['/lib/import/apply.ts', 'the import writer'],
    ['/lib/import/names.ts', 'the names it gives'],
    // JSON Canvas: the reader, the writer, the merge, and the scan that reads a plane
    // into the link index. A window that opens on a note has no plane to read, and four
    // one-line edges were holding the whole format in front of the first paint - an
    // empty plane's text, a plane's icon, the index's scan of one, and the mirror's
    // merge of two. Each is fetched by the first plane that needs it; see
    // scan-canvas.ts, workspace.createCanvas, file-icon.ts and sync/mirror.ts.
    ['/lib/scan-canvas.ts', 'a plane, read into the index'],
    ['/lib/canvas/format.ts', "the app's side of the format"],
    ['/markdown/src/canvas.ts', 'the format itself'],
    ['/markdown/src/canvas-merge.ts', 'the merge two devices settle on'],
    // And the pages engine, which a window that opens on a note has no stack of paper
    // to read. The canvas reader under it is not here and cannot be: the link index
    // scans a plane's cards for links and the sync mirror merges two versions of one,
    // so both reach it before anything is drawn. See workspace.createPages.
    ['/markdown/src/pages.ts', 'the pages engine'],
  ])('nor %s (%s)', (tail) => {
    expect(holds(tail), tail).toBe(false)
  })

  /** The other half of the claim: the graph is not small because the walk is broken.
   *  These are the modules a window does open on, and all of them must be in it. */
  test.each([
    ['/src/App.svelte', 'the app'],
    ['/lib/Pane.svelte', 'a pane'],
    ['/lib/Editor.svelte', 'the editor'],
    ['/lib/Tree.svelte', 'the file list'],
    ['/editor/src/editor.ts', "the editor's own state"],
    ['/markdown/src/index.ts', 'the renderer'],
    ['/markdown/src/engines.ts', 'the holder the two heavy libraries arrive in'],
    // The doors of the four above, which are the other half of each claim: a boundary
    // nothing reaches is a subsystem somebody deleted rather than one somebody moved.
    ['/lib/surfaces.svelte.ts', 'the doors the sheets come through'],
    ['/lib/rooms.svelte.ts', 'the store that joins a room'],
    ['/editor/src/languages.ts', "the fence languages' door"],
    ['/editor/src/paste.ts', 'the paste that asks for the converter'],
    ['/editor/src/completion.ts', 'the door the popup comes through'],
    ['/editor/src/find.ts', 'the door a search comes through, and the bar’s own seam'],
    ['/editor/src/open-views.ts', 'the editors a late arrival has to reach'],
    // And batch 119's doors, for the same reason: what is left of each subsystem when
    // the subsystem itself has gone behind one.
    ['/lib/menu-item.ts', 'what a menu row is, which the app menu walks without it'],
    ['/lib/recorder/commands.ts', 'the two rows that wake the recorder'],
    ['/lib/recorder/container.ts', 'whether this device can record at all'],
    ['/lib/ai/ask.ts', 'the stub behind an ai fence’s glyph'],
    ['/lib/mobile/bridge.ts', 'whether there is an activity at all'],
    ['/lib/mobile/dictation.ts', 'whether anything can hear'],
  ])('while %s (%s) is', (tail) => {
    expect(holds(tail), tail).toBe(true)
  })

  /** The forty catalogues, which are the other side of the same bargain: one
   *  chunk per language, fetched when a reader chooses one. Between them they are
   *  larger than everything else this test is about, and a single static import of any
   *  of them would put every row of every language in front of the first paint. See
   *  src/lib/i18n.svelte.ts, which loads them. */
  test('and no catalogue of any language', () => {
    const catalogues = readdirSync(fileURLToPath(new URL('../src/locales/', import.meta.url)))
    expect(catalogues.length).toBeGreaterThan(30)

    for (const one of catalogues) {
      expect(holds(`/locales/${one}`), one).toBe(false)
    }
  })

  test('and CodeMirror with the markdown mode, which is what shows a note', () => {
    for (const wanted of [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/lang-markdown',
      'svelte',
    ]) {
      expect([...graph.packages], wanted).toContain(wanted)
    }
  })

  /** The markdown mode above is why the HTML grammar has to be kept out from inside a
   *  dependency rather than from here.
   *
   *  `markdown()` builds `html({ matchClosingTags: false })` at module level for the raw
   *  blocks and inline tags in a note, so the import stands whether or not anybody asks
   *  for it - and the export that reads it cannot be dropped either, because
   *  `@codemirror/language-data` names `markdown()` for the ```markdown fence, which
   *  keeps every export of that module alive in whatever chunk holds it. The editor
   *  holds it in the first chunk: the base parser is in it, and so are the two keys that
   *  continue a list and take a level of markup off.
   *
   *  So the grammar is substituted instead, once, in the root manifest. These two are
   *  that edge: the manifest still says it, and the door still asks for the grammar
   *  rather than importing it. Either one gone and the five packages above are back in
   *  front of the first paint, with nothing else in this file any the wiser. */
  const OVERRIDE = '@codemirror/lang-markdown>@codemirror/lang-html'
  const DOOR = join(ROOT, 'packages/lang-html/src/index.ts')

  test('and the HTML grammar comes through nib’s own door, as the manifest says', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }

    expect(manifest.pnpm?.overrides?.[OVERRIDE]).toBe('workspace:@nib/lang-html@*')
    expect(existsSync(DOOR)).toBe(true)
  })

  /** And the second substitution inside the same dependency, for the same reason.
   *
   *  `@codemirror/lang-markdown` also imports the completion library outright - one
   *  class, to build a context with, in order to offer the names of HTML tags when a `<`
   *  is typed. That source is registered in the language's own data and nib never asks
   *  it: the popup is built with `override`, which is the whole list of sources rather
   *  than an addition to one. So thirty-five kilobytes of popup were evaluated before
   *  the window had drawn anything, for a source nothing reaches.
   *
   *  What that package gets instead carries the three things a context is made of and
   *  imports nothing; see packages/autocomplete. The popup the app does use imports the
   *  real library by name and is fetched as the first editor is built; see
   *  packages/editor/src/completion.ts. */
  const POPUP = '@codemirror/lang-markdown>@codemirror/autocomplete'
  const POPUP_DOOR = join(ROOT, 'packages/autocomplete/src/index.ts')

  test('and the completion library the same way, said in the same manifest', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }

    expect(manifest.pnpm?.overrides?.[POPUP]).toBe('workspace:@nib/autocomplete@*')
    expect(existsSync(POPUP_DOOR)).toBe(true)
    expect(asked(POPUP_DOOR)).not.toContain('@codemirror/autocomplete')
  })

  test('and the door asks for the grammar rather than importing it', () => {
    expect(asked(DOOR)).not.toContain('@codemirror/lang-html')
    expect(readFileSync(DOOR, 'utf8')).toContain("import('@codemirror/lang-html')")
  })

  /** And the crate's own IPC, which is the same shape of edge inside a different
   *  dependency.
   *
   *  `@tauri-apps/api/core` is what the window, the events, the images and the webview
   *  are all built on, so five modules of that package import it outright: a dynamic
   *  `import('@tauri-apps/api/core')` cannot move it anywhere, and the bundler said so
   *  on every build. It was in front of the first paint besides, because
   *  `@tauri-apps/plugin-os` - one line of JavaScript over a global, asked for the
   *  platform's name - imports it too.
   *
   *  So there is a door of nib's own again: src/lib/native.ts names the package and
   *  nothing else does, the platform's name is read off the page where the plugin's
   *  Rust half writes it, and a browser build fetches neither. */
  const CRATE = join(ROOT, 'apps/desktop/src/lib/native.ts')

  test('and the crate comes through nib’s own door', () => {
    expect(existsSync(CRATE)).toBe(true)
    expect(readFileSync(CRATE, 'utf8')).toContain("from '@tauri-apps/api/core'")
  })

  test('which nothing asks for dynamically, since nothing could move it', () => {
    // The comments go first, because the door's own prose names the specifier it is
    // there to keep out of everybody else's hands.
    const named = everySource(join(ROOT, 'apps/desktop/src')).filter((one) =>
      /import\(\s*['"]@tauri-apps\/api\/core['"]/.test(
        readFileSync(one, 'utf8').replace(COMMENTS, (_whole, head?: string) => head ?? ''),
      ),
    )

    expect(named).toEqual([])
  })
})

/** What the reading view fetches the first time somebody reads a note.
 *
 *  Not the first paint, so it is not in the graph above - but it is the same shape of
 *  mistake one step later, and a reader feels it: the switch to the reading view is a
 *  button press, and it waits for whatever the module behind it drags in.
 *
 *  What it used to drag in was the exporter. Two functions are wanted - the diagrams
 *  drawn and the fence grammars fetched before a render that cannot wait, see
 *  before-render.ts - and they lived in export.ts, which imports the print stylesheets
 *  as JavaScript strings, the picture inliner, the save dialog, the maths fonts, the
 *  page setup and the Pandoc format list. Half a megabyte of built JavaScript, a
 *  hundred and forty kilobytes of it stylesheets, for a surface that has a stylesheet
 *  of its own and never saves a file.
 *
 *  The edge is read off each surface's own source rather than named here, so this is
 *  about which module that surface reaches and not about what it is called. */
describe('what reading a note fetches', () => {
  const READING = fileURLToPath(new URL('../src/lib/reading/render.ts', import.meta.url))
  const SLIDES = fileURLToPath(new URL('../src/lib/slides/render.ts', import.meta.url))
  const EXPORTER = fileURLToPath(new URL('../src/lib/export.ts', import.meta.url))

  /** The module a surface waits for before it renders, named by its own source. */
  function waitedFor(surface: string): string {
    const source = readFileSync(surface, 'utf8')
    const found = /prepareFences[^}]*\}\s*=\s*await import\('([^']+)'\)/.exec(source)
    expect(found, 'the surface no longer awaits prepareFences').not.toBeNull()

    const file = relativeFile(surface, found?.[1] ?? '')
    expect(file, `nothing at ${found?.[1]}`).not.toBeNull()

    return file ?? ''
  }

  /** What a graph costs that the app has not already read.
   *
   *  The marginal weight, not the whole graph: both of these reach `@nib/editor` for
   *  the two lists of languages the renderer draws rather than colours, and the editor
   *  is on screen before either surface is asked for, so the bundler has it in a chunk
   *  the page already has. What a reader waits for is the part that is new. */
  const already = new Set(graph.files)

  function newBytes(files: readonly string[]): number {
    return files
      .filter((one) => !already.has(one))
      .reduce((sum, one) => sum + statSync(one).size, 0)
  }

  /** The exporter's own weight, which is what these surfaces used to pay. */
  const exporter = newBytes(eagerGraph(EXPORTER).files)

  for (const [what, surface] of [
    ['the reading view', READING],
    ['the slides', SLIDES],
  ] as const) {
    test(`${what} does not fetch the exporter to render a note`, () => {
      const ahead = eagerGraph(waitedFor(surface))
      const reached = ahead.files.map((one) => one.replace(/\\/g, '/'))

      // The stylesheets are the largest single thing in it and the plainest to name:
      // an export carries its own CSS because it lands in a file somebody else opens,
      // and a surface on screen is already wearing the app's.
      //
      // By the file rather than by the specifier: `@nib/themes/raw` is one of ours and
      // resolves through the package's own exports map, so it is a module in the graph
      // and never a name in `packages`. Asked the other way this read as green whatever
      // the surface imported.
      expect(reached.filter((one) => one.endsWith('/themes/src/raw.ts'))).toEqual([])
      expect(ahead.assets, 'stylesheets quoted into the surface').toEqual([])

      for (const heavy of [
        '/export.ts',
        '/export/save.ts',
        '/export/pictures.ts',
        '/export/document.ts',
        '/export-formats.ts',
        '/math-fonts.ts',
        '/page-setup.ts',
      ]) {
        expect(
          reached.filter((one) => one.endsWith(heavy)),
          heavy,
        ).toEqual([])
      }

      // And a size, because a name can be moved and the weight is the point: less than
      // half of what the exporter brings that the app has not already read, which is
      // the difference between the two functions this needs and the module they used to
      // live in.
      expect(newBytes(ahead.files)).toBeLessThan(exporter / 2)
    })
  }
})
