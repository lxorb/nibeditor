/** A page into a note: `capture_to_note` (docs/agent-native.md 5.4).
 *
 *  The clipper's own road for a page. `clip` is the markdown the clip button writes
 *  (web-tab/note.ts `clipNote`), with `source:`, `title:` and `clipped:` as it writes
 *  them; `screenshot` is a picture of the page and `pdf` the page printed on the
 *  reader's own paper, each kept beside the note as the note's own file and embedded
 *  the way a pasted picture is; `link` is the address. Into a new note named after the
 *  page, stepped like every new file's name, or under a heading of a note that is
 *  there, which is an anchored edit like every other agent write.
 *
 *  The page is read by the crate (`agents_capture`), a reader's tab and an agent's own
 *  out-of-sight one alike: through the gate every browser verb goes through, in nib's
 *  own world rather than the page's, every filled secret field painted over in a
 *  picture and a page holding one never printed (9.4). Where the engine has no road to
 *  a page, a reader's tab is clipped the clip button's own way, and nothing is
 *  photographed or printed that could not be painted over.
 *
 *  A reader's tab is theirs, so capturing one needs `browser.reader` and the space it
 *  is in, and an agent's own tab `browser`, as reading either does. The answer is
 *  marked as the page's: the note is named after what the page calls itself. */

import { freePath } from '@nib/markdown/paths'
import { writeFrontMatter } from '@nib/markdown/front-matter'
import { asWords } from '@nib/markdown/words'
import type { AgentAnswer } from '../../automation/caller'
import { attachmentFolder } from '../../attachments'
import { modes } from '../../modes.svelte'
import { paperInches } from '../../page-setup'
import { settings } from '../../settings.svelte'
import { nameOf, relativeTo } from '../../space-paths'
import { invoke } from '../../tauri'
import { pages } from '../../web-tab/pages.svelte'
import { clipNote } from '../../web-tab/note'
import { type Entry, workspace } from '../../workspace.svelte'
import { notes } from '../docs'
import { CAPTURE_AS, type CaptureAs, type Code, type Overview } from '../verbs'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, needScope, writerOf } from './call'
import { made } from './notes'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place, placeFor } from './spaces'
import { treeOf } from './tree'

const SHAPES = [...CAPTURE_AS, 'link'] as const
type Shape = (typeof SHAPES)[number]

/** A file kept beside the note: a picture or a PDF, as base64. */
interface Kept {
  base64: string
  extension: 'png' | 'pdf'
}

/** A page as a capture reads it. */
interface Page {
  url: string
  title: string
  /** The article's HTML, for a clip. */
  html: string
  /** The picture or the PDF, for those two. */
  file: Kept | null
}

function isShape(value: string): value is Shape {
  return SHAPES.some((one) => one === value)
}

/** The page in a tab: one of the reader's or one of the agent's own, as the crate reads
 *  it; for a link, only what the window already knows of it. */
async function pageIn(call: Call, tab: string, shape: Shape): Promise<Page> {
  const reader = workspace.tabs.find((one) => one.id === tab && one.kind === 'web')
  if (reader) {
    needScope(call, 'browser.reader', "the reader's tab")
    // The reader's tabs belong to the space they are in; an agent that may not reach
    // it has no business with them.
    placeFor(call, null)
    const known: Page = {
      url: pages.addressOf(tab) ?? workspace.webAddressOf(reader) ?? '',
      title: reader.shown,
      html: '',
      file: null,
    }
    if (shape === 'link') return known
    // A tab behind another one is not being drawn, and a page nobody draws has no
    // picture to take.
    if (shape === 'screenshot' && workspace.showing(reader.paneId)?.id !== reader.id) {
      throw new Refused('failed', 'the page is not on screen, so there is no picture of it')
    }
    return readersPage(call, tab, shape, known)
  }

  needScope(call, 'browser', 'an agent tab')
  if (shape !== 'link') return captured(call, tab, shape)

  const state = await invoke<Overview>('agents_state').catch(() => null)
  const own = state?.tabs.find(([agent, one]) => agent === call.caller.agent?.id && one.id === tab)
  if (!own) throw new Refused('no_such_tab', `there is no tab ${tab}: browser_tabs lists them`)
  return { url: own[1].url, title: own[1].title, html: '', file: null }
}

/** A reader's tab through the crate, or what the clip button would write where the
 *  crate cannot read it: on an engine with no road to a page, the page read the
 *  button's own way; for a page put away to give the memory back, the address and the
 *  title. A picture or a PDF of either is refused rather than taken without the
 *  secret fields painted over, or of a page that is not there. */
async function readersPage(call: Call, tab: string, shape: CaptureAs, known: Page): Promise<Page> {
  try {
    return await captured(call, tab, shape)
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    if (error.code === 'unsupported_on_this_engine' && shape === 'clip') {
      const read = await pages.read(tab, false)
      return read ? { ...read, file: null } : known
    }
    if (error.code === 'no_such_tab') {
      if (shape === 'clip') return known
      throw new Refused('failed', "that tab's page is put away until the reader looks at it again")
    }
    throw error
  }
}

/** The page as the crate reads it, or the crate's own refusal, code and all: the log
 *  files the call by that code. */
async function captured(call: Call, tab: string, shape: CaptureAs): Promise<Page> {
  const said = recordOf(
    await invoke<unknown>('agents_capture', {
      agent: call.caller.agent?.id ?? null,
      tab,
      shape,
      fullPage: flag(call, 'full_page'),
      page: paperInches(settings.page),
    }).catch((error: unknown) => ({ status: 'error', code: 'failed', message: String(error) })),
  )

  if (said.status === 'error') {
    const message = typeof said.message === 'string' ? said.message : 'the page was not read'
    // The crate's own word for why (verbs.rs `Code`), passed on as it said it; one the
    // contract does not have is filed as a failure by the log all the same.
    throw new Refused(String(said.code) as Code, message)
  }
  if (said.status !== 'ok') throw new Refused('failed', 'the page was not read')

  const page = pageOf(recordOf(said.result), shape)
  if (shape !== 'clip' && !page.file) throw new Refused('failed', 'the engine answered nothing')
  return page
}

/** An answer from the crate, which crossed a boundary: a record, or nothing. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The crate's result, read at the boundary. */
function pageOf(record: Record<string, unknown>, shape: CaptureAs): Page {
  const words = (key: string) => (typeof record[key] === 'string' ? record[key] : '')
  const base64 = shape === 'screenshot' ? words('png') : shape === 'pdf' ? words('pdf') : ''

  return {
    url: words('url'),
    title: words('title'),
    html: words('html'),
    file: base64 ? { base64, extension: shape === 'pdf' ? 'pdf' : 'png' } : null,
  }
}

/** What goes into a note for a page, and the front matter a new note of it wears. */
async function wordsFor(page: Page, shape: Shape, embed: string | null): Promise<string> {
  if (shape === 'clip') return clipNote(page, new Date())

  const title = page.title.trim() || page.url
  const shown = embed === null ? `<${page.url}>` : `![[${embed}]]`
  return `${frontMatter(page, title)}\n\n# ${asWords(title)}\n\n${shown}\n`
}

function frontMatter(page: Page, title: string): string {
  return writeFrontMatter([
    ['source', page.url],
    ['title', title],
    ['date', new Date().toISOString()],
  ])
}

/** The body of a capture without its front matter: what goes under a heading of a note
 *  that is already there, where a second block of front matter would be words. */
function body(words: string): string {
  return words.replace(/^---\n[\s\S]*?\n---\n+/, '').trim()
}

/** A note path nobody has in a place, from a page's title. */
async function freshPath(place: Place, folder: string | null, title: string): Promise<string> {
  const tree = await treeOf(place)
  const taken = new Set<string>()
  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      taken.add(relativeTo(place.space.root, child.path))
      walk(child)
    }
  }
  if (tree) walk(tree)

  const stem =
    title
      .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Untitled'
  const inside = (name: string) => (folder ? `${folder}/${name}` : name)
  return inside(freePath(`${stem}.md`, (candidate) => taken.has(inside(candidate))))
}

export async function captureToNote(call: Call): Promise<AgentAnswer> {
  const shape = maybe(call, 'as') ?? 'clip'
  if (!isShape(shape)) throw new Refused('bad_arguments', `as is one of ${SHAPES.join(', ')}`)

  const place = placeFor(call, maybe(call, 'space'))
  const page = await pageIn(call, need(call, 'tab'), shape)
  if (!page.url) throw new Refused('failed', 'that tab has no page to capture')

  const named = maybe(call, 'note')
  const target = named === null ? null : judgedForWriting(named)
  const relative =
    target === null
      ? await freshPath(place, maybe(call, 'folder'), page.title || page.url)
      : nameOf(target).includes('.')
        ? target
        : `${target}.md`

  const question = await asked(call, null, `Capture ${page.url} into ${relative}`)
  if (question) return question

  const path = onDisk(place, relative)
  const embed = page.file ? await attachment(place, path, page.file) : null
  const words = await wordsFor(page, shape, embed)

  const there = (await workspace.noteText(path)) !== null
  if (!there) {
    await made(place, relative, words, false)
    return done({ path: relative, source: page.url, created: true }, page.url)
  }

  const under = maybe(call, 'under')
  const title = page.title.trim() || page.url
  const section = `## ${asWords(title)}\n\n${shape === 'clip' ? `<${page.url}>\n\n` : ''}${body(words).replace(/^# .*\n+/, '')}`
  await notes.editNote(writerOf(call), { path: relative, space: place.space.id }, [
    { at: under === null ? { end: true } : { heading: under }, insert_after: section },
  ])

  return done({ path: relative, source: page.url, created: false }, page.url)
}

/** A picture or a PDF kept beside a note the way a pasted picture is: in the folder the
 *  reader's Attachments setting says, under a name of its own. Answers what the note
 *  embeds. */
async function attachment(place: Place, notePath: string, file: Kept): Promise<string> {
  const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))
  const saved = await invoke<string>('save_asset', {
    notePath,
    folder: attachmentFolder(modes.attachments, notePath, place.space.root),
    name: `page-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${file.extension}`,
    bytes: [...bytes],
  })

  return saved
}
