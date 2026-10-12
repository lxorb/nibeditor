/** Which app an export came out of, and reading it.
 *
 *  Nobody is asked to pick a format. A reader who exported their notes yesterday
 *  knows what they exported; what they have in front of them is a file, and every
 *  one of these formats says what it is if you look. So the sheet looks, names
 *  what it found, and shows what it is about to make.
 *
 *  The order below is the order of certainty: a `.obsidian/` folder can only be
 *  a vault, whatever else is in it, a `.enex` can only be Evernote, a
 *  32-character id on every file name can only be Notion, and a folder of
 *  markdown is what is left when nothing more specific fits. */

import type { FormatId, ImportPlan } from './plan'
import type { Source } from './sources'
import { hasNotionId, looksLikePapers } from './names'
import type { Rows } from './table'

/** How many files are opened to work out what an export is. Enough to be sure,
 *  few enough that a zip of six thousand notes is not unpacked to answer it. */
const PEEK = 20

/** Obsidian's own folder at the top of a vault, or one folder down. */
const VAULT = /^([^/]+\/)?\.obsidian\//

/** One Apple Journal entry, as its export names it. */
const ENTRY = /(^|\/)entries\/[^/]+\.html?$/i

/** The three marks macOS leaves in rich text it writes out as HTML. */
const APPLE_HTML = /Cocoa HTML Writer|Apple-converted-space|-apple-system-font/i

/** What pandoc reads and nothing here does. Only offered where pandoc is
 *  installed, which the sheet knows and this does not. */
const PANDOC = /\.(docx|odt|rtf|epub|rst|textile|tex|opml|org|docbook|fb2)$/i

export async function detect(sources: readonly Source[]): Promise<FormatId | null> {
  if (!sources.length) return null

  const paths = sources.map((one) => one.path)
  const has = (pattern: RegExp) => paths.some((one) => pattern.test(one))

  // Obsidian keeps its settings in `.obsidian/` at the top of a vault, and nothing
  // else writes that folder. Asked first, because a vault is somebody's whole set of
  // files: a `.enex` kept in one is an old export lying in the vault, not the thing
  // being imported, and a vault with a `pages/` folder in it is still a vault and
  // not a Logseq graph. One folder deep as well, for a zip whose only entry is the
  // vault itself.
  if (has(VAULT)) return 'obsidian'

  if (has(/\.enex$/i)) return 'evernote'
  if (has(/\.note$/i)) return 'tomboy'

  // Papers and nothing else: somebody's own PDF, to be written on rather than
  // converted. Before everything below, because a `.pdf` is the one extension on this
  // list that says outright what the file is; after the two above only because those
  // are as certain and were already asked. See pdf-pages.ts.
  if (looksLikePapers(paths)) return 'pdf-pages'

  const bundle = await bundleWriter(sources)
  if (bundle) return bundle

  // Apple Journal writes `Entries/` beside `Resources/` and its own date above
  // every entry, which nothing else does.
  if (await looksLikeJournal(sources)) return 'journal'

  // Takeout names the folder, and a Keep note says what it is even loose. The folder
  // with a note of Keep's in it: a folder of somebody's own notes called Keep is still
  // theirs, and read as Keep it would bring none of them.
  if (has(/(^|\/)Keep\/[^/]+\.json$/i)) return 'keep'

  const json = await jsonKind(sources)
  if (json) return json

  // At the top, or one folder down for a zip whose one entry is the graph. Not
  // deeper: a `pages/` folder four folders into somebody's notes is a website's
  // pages, and reading the whole folder as Logseq would turn every `- TODO` in it
  // into a checkbox. Logseq's own `logseq/` or its `pages/`, named in lower case as
  // Logseq names them, and not a `journals/` folder alone: somebody's Obsidian notes
  // keep their days in `Journals/2024/01/` as often, and read as Logseq those would
  // be flattened and given the wrong dates.
  if (has(/^([^/]+\/)?logseq\//i) || has(/^([^/]+\/)?pages\//)) return 'logseq'
  if (looksLikeNotion(paths)) return 'notion'

  const markdown = paths.filter((one) => /\.(md|markdown|txt)$/i.test(one))
  const html = paths.filter((one) => /\.html?$/i.test(one))
  const csv = paths.filter((one) => /\.csv$/i.test(one))

  if (csv.length && (await looksLikeTodoist(sources))) return 'todoist'
  if (csv.length && !markdown.length && !html.length) return 'table'

  // Both of these say so in the HTML itself, and both are asked before the
  // markdown branch: an exporter that writes a note twice, once as markdown and
  // once as HTML, is still that app's export.
  if (html.length && (await looksLikeOneNote(sources))) return 'onenote'
  if (html.length && (await looksLikeApple(sources))) return 'apple-notes'

  if (markdown.length) return (await looksLikeBear(sources)) ? 'bear' : 'markdown'
  if (html.length) return 'markdown'
  if (has(PANDOC)) return 'pandoc'

  return null
}

/** Notion's id on the end of every page's name. Every one, because a single page
 *  somebody exported once and kept among their own notes is one of those notes, and
 *  read as Notion the lines under each title would all become properties. A page is
 *  a note or a web page, bar the `index.html` an HTML export opens on; an export of
 *  nothing but databases has its id on each table instead. */
function looksLikeNotion(paths: readonly string[]): boolean {
  const named = (path: string) => hasNotionId(path.split('/').pop() ?? path)
  const pages = paths.filter(
    (one) => /\.(md|markdown|html?)$/i.test(one) && !/(^|\/)index\.html$/i.test(one),
  )
  return pages.length ? pages.every(named) : paths.some(named)
}

/** What wrote a TextBundle, which the bundle itself says. */
async function bundleWriter(sources: readonly Source[]): Promise<FormatId | null> {
  const info = sources.find((one) => /\.textbundle\/info\.json$/i.test(one.path))
  if (!info) return null

  const said = (await info.text()).toLowerCase()
  if (said.includes('shinyfrog')) return 'bear'
  if (said.includes('lukilabs')) return 'craft'

  // A bundle from somewhere else is still a folder of markdown, which is read.
  return 'markdown'
}

/** Whether the JSON in here is a Roam graph, a Keep note, or neither. */
async function jsonKind(sources: readonly Source[]): Promise<FormatId | null> {
  const jsons = sources.filter((one) => /\.json$/i.test(one.path)).slice(0, PEEK)

  for (const one of jsons) {
    let said: unknown
    try {
      said = JSON.parse(await one.text())
    } catch {
      continue
    }

    if (Array.isArray(said)) {
      const pages: unknown[] = said
      const page = pages.find((entry) => !!entry && typeof entry === 'object')
      if (page && 'title' in page && 'children' in page) return 'roam'
      continue
    }

    if (said && typeof said === 'object') {
      const note = said as Record<string, unknown>
      const keep =
        'textContent' in note ||
        'listContent' in note ||
        'isTrashed' in note ||
        'isArchived' in note
      if (keep) return 'keep'
    }
  }

  return null
}

/** Bear's closed tags, which nothing else writes: `#two words#`. One is enough to
 *  say where a folder of markdown came from, and the only difference it makes is
 *  that those tags are tidied. */
async function looksLikeBear(sources: readonly Source[]): Promise<boolean> {
  const notes = sources.filter((one) => /\.(md|markdown)$/i.test(one.path)).slice(0, PEEK)

  for (const note of notes) {
    if (/(^|[\s(])#[^#\s][^#\n]{0,60}#/m.test(await note.text())) return true
  }

  return false
}

/** An Apple Journal export: one HTML document per entry under `Entries/`, with
 *  the media under `Resources/`.
 *
 *  The entry says so itself - Journal draws the date above it in a div of its own
 *  - and a set of dated names beside a `Resources/` folder says it too, for an
 *  export whose documents that line is not in. */
async function looksLikeJournal(sources: readonly Source[]): Promise<boolean> {
  const entries = sources.filter((one) => ENTRY.test(one.path)).slice(0, PEEK)
  if (!entries.length) return false

  for (const entry of entries) {
    if (/class="pageHeader"/i.test((await entry.text()).slice(0, 8000))) return true
  }

  const dated = entries.every((one) => /^\d{4}-\d{2}-\d{2}/.test(one.path.split('/').pop() ?? ''))
  return dated && sources.some((one) => /(^|\/)resources\//i.test(one.path))
}

/** Apple's own HTML, which is what every Apple Notes exporter hands over: a
 *  note's rich text written out the way macOS writes rich text anywhere. The
 *  third-party exporters read the note through the system and save that, so this
 *  is the sign they share rather than a sign one of them invented. */
async function looksLikeApple(sources: readonly Source[]): Promise<boolean> {
  const pages = sources.filter((one) => /\.html?$/i.test(one.path)).slice(0, PEEK)

  for (const page of pages) {
    if (APPLE_HTML.test((await page.text()).slice(0, 4000))) return true
  }

  return false
}

/** Todoist's CSV says so in its header, the same on every one. */
async function looksLikeTodoist(sources: readonly Source[]): Promise<boolean> {
  if (__EVEN_PLUGIN__) return false
  const { isTodoistCsv } = await import('./todoist')
  const tables = sources.filter((one) => /\.csv$/i.test(one.path)).slice(0, PEEK)
  for (const table of tables) if (isTodoistCsv(await table.text())) return true
  return false
}

/** OneNote says so in the HTML it writes. */
async function looksLikeOneNote(sources: readonly Source[]): Promise<boolean> {
  const pages = sources.filter((one) => /\.html?$/i.test(one.path)).slice(0, PEEK)

  for (const page of pages) {
    if (/content="Microsoft OneNote/i.test((await page.text()).slice(0, 4000))) return true
  }

  return false
}

export interface ReadOptions {
  /** What a bare table becomes, which is the one thing the sheet asks. */
  rows?: Rows
}

/** The plan for these files, read as this format. */
export async function readAs(
  format: FormatId,
  sources: readonly Source[],
  options: ReadOptions = {},
): Promise<ImportPlan> {
  // The glasses plugin offers no import, and this is what keeps every reader and
  // the HTML converter out of its package: said as a throw rather than a guard so
  // the bundler drops what is under it. See vite.even.config.ts.
  if (__EVEN_PLUGIN__) throw new Error('no import in the Even Realities plugin')

  switch (format) {
    case 'notion': {
      const { readNotion } = await import('./notion')
      return readNotion(sources)
    }
    case 'evernote': {
      const { readEvernote } = await import('./evernote')
      return readEvernote(sources)
    }
    case 'keep': {
      const { readKeep } = await import('./keep')
      return readKeep(sources)
    }
    case 'bear': {
      const { readBear } = await import('./bear')
      return readBear(sources)
    }
    case 'logseq': {
      const { readLogseq } = await import('./logseq')
      return readLogseq(sources)
    }
    case 'roam': {
      const { readRoam } = await import('./roam')
      return readRoam(sources)
    }
    case 'table': {
      const { readTable } = await import('./table')
      return readTable(sources, options.rows ?? 'table')
    }
    case 'tomboy': {
      const { readTomboy } = await import('./tomboy')
      return readTomboy(sources)
    }
    case 'journal': {
      const { readJournal } = await import('./journal')
      return readJournal(sources)
    }
    case 'todoist': {
      const { readTodoistFiles } = await import('./todoist')
      return readTodoistFiles(sources)
    }
    case 'pdf-pages': {
      const { readPdfPages } = await import('./pdf-pages')
      return readPdfPages(sources)
    }
    case 'obsidian': {
      const { readPlain } = await import('./plain')
      const { atVaultTop, leftInVault, lostInVault } = await import('./obsidian')
      const vault = atVaultTop(sources)
      const plan = await readPlain(vault, { format, skip: leftInVault, asTheyAre: true })
      plan.lost.push(...lostInVault(vault))
      return plan
    }
    case 'craft':
    case 'onenote':
    case 'apple-notes':
    case 'markdown': {
      const { readPlain } = await import('./plain')
      const { isHidden } = await import('./folder')
      // Hidden files stay behind, as they do from a vault: a folder of notes kept in
      // git, or a vault whose `.obsidian/` was never synced, holds `.git` and a
      // `.trash/` of notes somebody threw away, and none of it is anybody's writing.
      return readPlain(sources, { format, skip: isHidden })
    }
    case 'pandoc': {
      // Pandoc is a program on the machine rather than a reader in here, and the
      // sheet sends those files straight to it.
      return { format, files: [], lost: [] }
    }
  }
}
