/** A page into a note: `capture_to_note` (docs/agent-native.md 5.4).
 *
 *  The clipper's own road for a page. `clip` is the markdown the clip button writes
 *  (web-tab/note.ts `clipNote`), with `source:`, `title:` and `date:` as it writes
 *  them, read out of the page the way the button reads it (`web_clip`); `screenshot`
 *  is a picture of the page kept beside the note as the note's own, embedded the way
 *  a pasted picture is; `link` is the address. Into a new note named after the page,
 *  stepped like every new file's name, or under a heading of a note that is there,
 *  which is an anchored edit like every other agent write.
 *
 *  A reader's tab is theirs, so capturing one needs `browser.reader`, and an agent's
 *  own tab `browser`, as reading either does. */

import { freePath } from '@nib/markdown/paths'
import { writeFrontMatter } from '@nib/markdown/front-matter'
import { asWords } from '@nib/markdown/words'
import type { AgentAnswer } from '../../automation/caller'
import { attachmentFolder } from '../../attachments'
import { modes } from '../../modes.svelte'
import { nameOf, relativeTo } from '../../space-paths'
import { invoke } from '../../tauri'
import { pages } from '../../web-tab/pages.svelte'
import { clipNote } from '../../web-tab/note'
import { type Entry, workspace } from '../../workspace.svelte'
import { notes } from '../docs'
import type { Overview } from '../verbs'
import { asked } from './asks'
import { type Call, done, maybe, need, needScope, writerOf } from './call'
import { made } from './notes'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place, placeFor } from './spaces'
import { treeOf } from './tree'

const SHAPES = ['clip', 'screenshot', 'link', 'pdf'] as const
type Shape = (typeof SHAPES)[number]

/** A page as a capture reads it. */
interface Page {
  url: string
  title: string
  /** The page's HTML for a clip, when it was read. */
  html: string
  /** A picture of it, as a PNG data address, for a screenshot. */
  png: string | null
}

/** The page in a tab: one of the reader's, read as the clip button reads it, or one of
 *  the agent's own, of which the window knows the address and the title. */
async function pageIn(call: Call, tab: string, shape: Shape): Promise<Page> {
  const reader = workspace.tabs.find((one) => one.id === tab && one.kind === 'web')
  if (reader) {
    needScope(call, 'browser.reader', "the reader's tab")
    const url = pages.addressOf(tab) ?? workspace.webAddressOf(reader) ?? ''
    const read = shape === 'clip' ? await pages.read(tab, false) : null
    const png =
      shape === 'screenshot'
        ? await invoke<string | null>('web_shot', { tab }).catch(() => null)
        : null
    return {
      url: read?.url ?? url,
      title: read?.title ?? reader.shown,
      html: read?.html ?? '',
      png,
    }
  }

  needScope(call, 'browser', 'an agent tab')
  const state = await invoke<Overview>('agents_state').catch(() => null)
  const own = state?.tabs.find(([agent, one]) => agent === call.caller.agent?.id && one.id === tab)
  if (!own) throw new Refused('no_such_tab', `there is no tab ${tab}: browser_tabs lists them`)
  if (shape !== 'link') {
    // The page of an agent's tab is the crate's, which reads it for `browser_read`
    // and `browser_screenshot`; the window has no road to it yet.
    throw new Refused(
      'unsupported_on_this_engine',
      'an agent tab is captured as a link: read it with browser_read and write it with create_note',
    )
  }

  return { url: own[1].url, title: own[1].title, html: '', png: null }
}

/** What goes into a note for a page, and the front matter a new note of it wears. */
async function wordsFor(page: Page, shape: Shape, embed: string | null): Promise<string> {
  if (shape === 'clip') return clipNote(page, new Date())

  const title = page.title.trim() || page.url
  const shown = shape === 'screenshot' ? `![[${embed ?? ''}]]` : `<${page.url}>`
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
  const shape = (maybe(call, 'as') ?? 'clip') as Shape
  if (!SHAPES.includes(shape))
    throw new Refused('bad_arguments', `as is one of ${SHAPES.join(', ')}`)
  if (shape === 'pdf') {
    throw new Refused(
      'unsupported_on_this_engine',
      'a page is captured as a clip, a screenshot or a link',
    )
  }

  const place = placeFor(call, maybe(call, 'space'))
  const page = await pageIn(call, need(call, 'tab'), shape)
  if (!page.url) throw new Refused('failed', 'that tab has no page to capture')
  if (shape === 'screenshot' && !page.png) {
    throw new Refused('failed', 'the page is not on screen, so there is no picture of it')
  }

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
  const embed = page.png ? await picture(place, path, page.png) : null
  const words = await wordsFor(page, shape, embed)

  const there = (await workspace.noteText(path)) !== null
  if (!there) {
    await made(place, relative, words, false)
    return done({ path: relative, source: page.url, created: true })
  }

  const under = maybe(call, 'under')
  const title = page.title.trim() || page.url
  const section = `## ${asWords(title)}\n\n${shape === 'clip' ? `<${page.url}>\n\n` : ''}${body(words).replace(/^# .*\n+/, '')}`
  await notes.editNote(writerOf(call), { path: relative, space: place.space.id }, [
    { at: under === null ? { end: true } : { heading: under }, insert_after: section },
  ])

  return done({ path: relative, source: page.url, created: false })
}

/** A PNG kept beside a note the way a pasted picture is: in the folder the reader's
 *  Attachments setting says, under a name of its own. Answers what the note embeds. */
async function picture(place: Place, notePath: string, png: string): Promise<string> {
  const base64 = png.replace(/^data:image\/png;base64,/, '')
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  const saved = await invoke<string>('save_asset', {
    notePath,
    folder: attachmentFolder(modes.attachments, notePath, place.space.root),
    name: `page-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
    bytes: [...bytes],
  })

  return saved
}
