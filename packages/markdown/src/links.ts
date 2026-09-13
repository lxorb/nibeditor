/** The links between notes, as syntax rather than as HTML.
 *
 *  One place for the grammar, because four parts of Nib read it: the editor
 *  draws wikilinks and follows them, the renderer turns them into anchors for
 *  an export and for a published page, the app rewrites them when a note is
 *  renamed, and the sync service counts them for backlinks. Four readings of
 *  one grammar would drift, and the drift would show as a link that follows in
 *  the editor and comes out as plain text on the web.
 *
 *  Obsidian's spelling exactly, so a note moves between the two apps
 *  unchanged: `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`,
 *  `[[Note#^blockid]]`, `![[Note]]` for the note's content rather than a link
 *  to it, and `^blockid` at the end of a paragraph to give it a name.
 *
 *  Imported on its own - `@nib/markdown/links` - by the editor, which wants the
 *  grammar and not the renderer that stands on it. */

import { closesFence, fenceMark } from './fences'

/** What one link between notes says. */
export interface Wikilink {
  /** The note it names, as written: `Note`, `folder/Note` or `Note.md`. Empty
   *  for a link into the note it is written in, such as `[[#Heading]]`. */
  target: string
  /** The heading after `#`, or null when it names none. */
  heading: string | null
  /** The block after `#^`, or null. */
  block: string | null
  /** The words to show in place of the target, or null to show the target. */
  alias: string | null
  /** `![[…]]` rather than `[[…]]`: the note's content, not a link to it. */
  embed: boolean
}

/** How a link was written, which decides how a rename rewrites it. */
export type LinkKind = 'wikilink' | 'markdown'

/** One link found in some text, and where it sits. */
export interface FoundLink extends Wikilink {
  kind: LinkKind
  /** The whole link, from its `[` or `!` to just past its end. */
  from: number
  to: number
  /** Where `target` sits inside it, which is the only part a rename rewrites. */
  targetFrom: number
  targetTo: number
  /** Which line it is on, counting from zero.
   *
   *  Carried out of here because this already knows it: the walk that finds the
   *  links goes down the note line by line and has the number in hand. A caller
   *  that wanted it used to count the newlines before the link instead, which is a
   *  pass down the note per link - four hundred megabytes read for a four hundred
   *  kilobyte note with a thousand links in it. See scan-note.perf.test.ts in the
   *  app, and `link.line = index` in links.rs, which is the same answer on the
   *  disk side. */
  line: number
}

/** Everything between the brackets of a wikilink, in one piece. `[` and `]` are
 *  not among it: Obsidian ends the link at the first `]`, and so does this.
 *
 *  Exported because the renderer's own wikilink extension matches the same thing
 *  anchored at the start of what is left, and two spellings of "between the
 *  brackets" would be two grammars. */
export const WIKILINK_INNER = '[^[\\]\\n]+'

/** `[[…]]`, or `![[…]]`. The lookbehind is what makes `\[[Note]]` text: a
 *  backslash escapes the bracket in markdown, and a link nobody wrote must not
 *  be rewritten when a note is renamed. */
const WIKILINK = new RegExp(`(?<!\\\\)(!?)\\[\\[(${WIKILINK_INNER})\\]\\]`, 'g')

/** `[label](target)`, with an optional `"title"` and an optional `<>` around a
 *  target that has spaces in it. Only the shape is matched here; whether the
 *  target names a note rather than the web is decided by `isNoteTarget`. */
const MARKDOWN_LINK =
  /(?<!\\)(!?)\[((?:[^[\]\\]|\\.)*)\]\(\s*(?:<([^<>\n]*)>|([^\s()]+))\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\)/g

/** How many links one note is read for. Far past any note anybody writes - a map of
 *  content points at a few hundred things - and a bound on what one file can cost
 *  every surface that renders it. The crate keeps the same number; see `MOST_LINKS`
 *  in apps/desktop/src-tauri/src/links.rs. */
export const MOST_LINKS = 5000

/** A block's name: `^abc123` at the end of it, on its own or after a space. */
const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/

/** The scheme a target names, or the empty string when it names none. `//host`
 *  counts as naming one, since a browser reads it as the page's own scheme. */
function schemeOf(target: string): string {
  if (target.startsWith('//')) return 'https'
  return /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLowerCase() ?? ''
}

/** Whether a markdown link's target points inside the space rather than out at
 *  the web. A `#fragment` on its own points inside the note it is written in,
 *  which counts: the Links panel lists it, and no rename touches it. */
export function isNoteTarget(target: string): boolean {
  return schemeOf(target) === ''
}

/** Whether a target names a PDF rather than a note. Here with the rest of the
 *  grammar because all four readers of a link have to agree: the editor follows
 *  `[[paper.pdf]]` to the file, the renderer links to it, the app opens it in a
 *  tab, and the index counts it as a link out. */
export function isPdfTarget(target: string): boolean {
  return /\.pdf$/i.test(target.trim())
}

/** Whether a target names a canvas: the plane of notes and cards Obsidian keeps
 *  in a `.canvas` file, which Nib reads and writes as JSON Canvas 1.0. Like a
 *  PDF it is a file rather than a note, so `[[Board.canvas]]` carries the
 *  extension the way `[[paper.pdf]]` does. */
export function isCanvasTarget(target: string): boolean {
  return /\.canvas$/i.test(target.trim())
}

/** Whether a target names a page note: pages of paper written on with a pen, which
 *  Nib keeps in a `.pages` file.
 *
 *  The bytes are a canvas's bytes - JSON Canvas 1.0, one reader, one writer; see
 *  canvas.ts - and the extension is what says which surface opens it and which
 *  panel goes beside it. Two extensions rather than one because the only thing both
 *  ends of a file can see is its name: a tab, a room and a Durable Object all ask
 *  the name what a file is, and a flag inside the JSON would be a question none of
 *  them could ask without reading the file first. */
export function isPagesTarget(target: string): boolean {
  return /\.pages$/i.test(target.trim())
}

/** Whether a target names a website: a shortcut file, which nib opens as a page in
 *  a tab rather than as words.
 *
 *  Two extensions because two systems already wrote them, and neither is nib's.
 *  `.url` is the Windows Internet Shortcut - an INI file with an address in it,
 *  which is what Explorer and every browser make when a page is dragged out onto
 *  the desktop - and it is the one nib writes. `.webloc` is the same idea on macOS,
 *  a plist, which is what Safari makes; nib reads one and never writes one. See
 *  `web-tab/shortcut.ts`. */
export function isWebTarget(target: string): boolean {
  return /\.(url|webloc)$/i.test(target.trim())
}

/** The extensions a picture is written in. `apng` and `ico` are here because a
 *  browser draws them and somebody's notes may hold one. */
const IMAGE = /\.(a?png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/** Whether a target names a picture rather than a note, which `![[…]]` embeds as
 *  an image the way `![](…)` does.
 *
 *  Beside the other two kind questions for the same reason they are here: one
 *  reading of a name, so the editor drawing an embed, the renderer writing an
 *  `<img>` and the file list marking a row all agree on what a picture is. */
export function isImageTarget(target: string): boolean {
  return IMAGE.test(target.trim())
}

/** The extensions sound is written in, as far as a browser plays them. `m4a` and
 *  `aac` are the two a phone records into, `opus` and `oga` what a voice memo
 *  turns up as, and `flac` because somebody's notes hold one. */
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i

/** And moving pictures. `webm` is a container either can be in, and it is in
 *  both lists' spirit but only one of them: what people put in a `.webm` is a
 *  film, and `.weba` is the spelling that says otherwise. `.ogg` goes the other
 *  way for the same reason - it has meant sound since before `.ogv` existed. */
const VIDEO = /\.(mp4|m4v|webm|mov|ogv|mkv|avi)$/i

/** Whether a target names sound rather than a note, which `![[…]]` embeds as a
 *  player the way `![[pic.png]]` embeds a picture. */
export function isAudioTarget(target: string): boolean {
  return AUDIO.test(target.trim())
}

/** Whether a target names a film. */
export function isVideoTarget(target: string): boolean {
  return VIDEO.test(target.trim())
}

/** What kind of thing a `![[…]]` names, which is the whole of what any surface
 *  needs to know to show one. `null` for a note, which is the only kind whose
 *  content has to be read before it can be shown.
 *
 *  One question answered once, because five places ask it: the editor drawing a
 *  block, the editor drawing an inline embed, the renderer writing the markup,
 *  the export deciding what it can carry, and the glasses naming it. Adding a
 *  kind here is what makes it appear on all five. */
export type EmbedKind = 'image' | 'audio' | 'video' | 'pdf' | 'canvas'

export function embedKind(target: string): EmbedKind | null {
  if (isImageTarget(target)) return 'image'
  // Before sound, so a container in both lists is read as the one it usually
  // holds; the two lists say which way each of those goes.
  if (isVideoTarget(target)) return 'video'
  if (isAudioTarget(target)) return 'audio'
  if (isPdfTarget(target)) return 'pdf'
  if (isCanvasTarget(target)) return 'canvas'

  return null
}

/** Whether a target names a file the app opens in a tab of its own rather than a
 *  note: a PDF, a canvas, a page note, or a website.
 *
 *  These four behave alike everywhere a link is read. All resolve through the
 *  files of the space rather than its notes, because a file has no headings and
 *  nothing to be told apart by except its extension; all are followed to the
 *  file itself; and a link to one the space does not hold is a link to nothing,
 *  never a reason to make a note under that name.
 *
 *  Not to be confused with `isNoteTarget`, which asks something else entirely:
 *  whether a target points inside the space at all rather than out at the web. */
export function isTabFile(target: string): boolean {
  return (
    isPdfTarget(target) || isCanvasTarget(target) || isPagesTarget(target) || isWebTarget(target)
  )
}

/** Obsidian writes how wide to draw an embed after the bar: `![[pic.png|300]]`,
 *  or `![[pic.png|300x200]]`. Anything else after the bar is what the thing is,
 *  the way alt text is in markdown. */
const SIZE = /^(\d+)(?:x(\d+))?$/

/** The size an embed's alias asks for, or null when the alias is words. Here so
 *  the editor drawing a picture and the renderer writing one agree, down to
 *  which of the two `300x200` means. */
export function embedSize(alias: string | null): { width: number; height: number | null } | null {
  const found = alias === null ? null : SIZE.exec(alias)
  if (!found) return null

  const height = found[2]
  return { width: Number(found[1]), height: height === undefined ? null : Number(height) }
}

/** The page a fragment names, or null when it names none.
 *
 *  `[[paper.pdf#page=3]]` is Obsidian's spelling and also the one a browser's own
 *  PDF viewer reads, so the same link works in Nib, in Obsidian and on a
 *  published page. A PDF has no headings to point at, so this is the only
 *  fragment one takes. Pages count from one; `#page=0` names nothing. */
export function pageFragment(fragment: string | null): number | null {
  const digits = fragment === null ? null : /^page=(\d+)$/i.exec(fragment.trim())?.[1]
  if (digits === undefined || digits === null) return null

  const page = Number(digits)
  return page >= 1 ? page : null
}

/** What is between the brackets, as a link. Null when it names nothing to point
 *  at: `[[]]`, or an alias with no target and no heading. */
export function parseWikilink(inner: string, embed = false): Wikilink | null {
  const bar = inner.indexOf('|')
  const named = bar === -1 ? inner : inner.slice(0, bar)
  // Everything after the first bar, so an alias may itself contain one.
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim()

  const hash = named.indexOf('#')
  const target = (hash === -1 ? named : named.slice(0, hash)).trim()
  const fragment = hash === -1 ? '' : named.slice(hash + 1).trim()

  const block = fragment.startsWith('^') ? fragment.slice(1) : null
  const heading = block === null && fragment ? fragment : null

  if (!target && !heading && !block) return null

  // An empty alias is not an alias: `[[Note|]]` shows the target, so that
  // deleting the words after the bar reads as taking the alias away.
  return { target, heading, block, alias: alias === '' ? null : alias, embed }
}

/** The link back as source, which is what a rename writes. */
export function formatWikilink(link: Wikilink): string {
  const alias = link.alias === null ? '' : `|${link.alias}`
  return `${link.embed ? '!' : ''}[[${linkTarget(link)}${alias}]]`
}

/** The part before the bar: the note, and the heading or block inside it. */
export function linkTarget(link: Wikilink): string {
  if (link.block !== null) return `${link.target}#^${link.block}`
  if (link.heading !== null) return `${link.target}#${link.heading}`
  return link.target
}

/** The words a link shows: its alias, or the target as written. */
export function shownText(link: Wikilink): string {
  return link.alias ?? linkTarget(link)
}

/** Which part of the text between the brackets a reader sees, as offsets into
 *  it: the alias when there is one, the target as written otherwise, in both
 *  cases without the space around it.
 *
 *  The editor hides everything on either side of this, which is how `[[Note|a
 *  name]]` reads as `a name` while the caret is away and as itself when the
 *  caret is inside. Here rather than there because it is the same reading of
 *  the same grammar as `shownText` above, and the two must agree. */
export function shownSpan(inner: string): { from: number; to: number } {
  const bar = inner.indexOf('|')
  const aliased = bar !== -1 && inner.slice(bar + 1).trim() !== ''

  let from = aliased ? bar + 1 : 0
  let to = aliased ? inner.length : bar === -1 ? inner.length : bar

  while (from < to && isBlank(inner[from])) from++
  while (to > from && isBlank(inner[to - 1])) to--

  return { from, to }
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

/** The same text with every code span blanked out, character for character, so
 *  offsets still line up while `[[Note]]` inside backticks is left alone. */
function withoutCode(line: string): string {
  let out = ''
  let at = 0

  while (at < line.length) {
    const tick = line.indexOf('`', at)
    if (tick === -1) {
      out += line.slice(at)
      break
    }

    // A span is closed by a run of backticks the same length as the one that
    // opened it, which is how `` ` `` holds a backtick.
    let openEnd = tick
    while (openEnd < line.length && line[openEnd] === '`') openEnd++
    const marks = line.slice(tick, openEnd)
    const close = line.indexOf(marks, openEnd)

    out += line.slice(at, tick)
    if (close === -1) {
      // Nothing closes it, so the backticks are text like anything else.
      out += line.slice(tick)
      break
    }

    out += ' '.repeat(close + marks.length - tick)
    at = close + marks.length
  }

  return out
}

/** Every link between notes in `text`, in the order they appear.
 *
 *  Code is skipped, both fenced blocks and inline spans: a `[[Note]]` written
 *  as an example is not a link, and renaming a note must not rewrite somebody's
 *  code sample. Links out at the web are skipped too - this is about the space. */
export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = []

  for (const row of lines(text)) {
    // A note that says where it points five thousand times has said it; see
    // `MOST_LINKS`. The reading stops rather than the walk, because every caller
    // holds what comes back: a note arrives from a share, a room, a folder somebody
    // synced or a page somebody clipped, and one megabyte of `[[A]]` is two hundred
    // thousand of these objects for one file. The same ceiling the space-wide index
    // in src-tauri/src/links.rs keeps, for the same reason.
    if (found.length >= MOST_LINKS) break
    if (!row.code) collect(withoutCode(row.text), row.from, row.line, found)
  }

  return found.length > MOST_LINKS ? found.slice(0, MOST_LINKS) : found
}

/** One line of some markdown, and whether it is code. */
interface Row {
  text: string
  /** Where the line starts in the whole text. */
  from: number
  /** Which line it is, counting from zero. */
  line: number
  /** True inside a fence, and on both of its delimiters: neither a link nor a
   *  block name can live in any of those. */
  code: boolean
}

/** Every line of some markdown, so the walks here do not each carry their own
 *  fence state.
 *
 *  Walked with indexOf rather than split, because this runs over every note in a
 *  space: a large note should not be copied into an array of lines only to be
 *  thrown away again.
 *
 *  Which lines are a fence is fences.ts, shared with the comment stripper and the
 *  deck's break scanner, so all three step over the same code. A block closes on
 *  its own mark and nothing else: a line of tildes inside a backtick block is
 *  code being shown, and reading it as the end of the block took the rest of the
 *  note for prose. */
function* lines(text: string): Generator<Row> {
  let fence: string | null = null
  let line = 0
  let at = 0

  for (;;) {
    const end = text.indexOf('\n', at)
    const row = text.slice(at, end === -1 ? text.length : end)

    let delimiter = false
    if (fence === null) {
      fence = fenceMark(row)
      delimiter = fence !== null
    } else if (closesFence(row, fence)) {
      fence = null
      delimiter = true
    }

    yield { text: row, from: at, line, code: delimiter || fence !== null }

    if (end === -1) break
    at = end + 1
    line++
  }
}

/** The links on one line of prose, added in the order they were written. */
function collect(line: string, offset: number, at: number, found: FoundLink[]) {
  const here: FoundLink[] = []

  for (const match of line.matchAll(WIKILINK)) {
    const [whole, bang = '', inner = ''] = match
    const link = parseWikilink(inner, bang === '!')
    if (!link) continue

    const from = offset + match.index
    // Where the target sits: past the `!`, the `[[`, and any space trimmed off
    // the front of it.
    const openTo = from + bang.length + 2
    const targetFrom = openTo + (inner.length - inner.trimStart().length)

    here.push({
      ...link,
      kind: 'wikilink',
      from,
      to: from + whole.length,
      targetFrom,
      targetTo: targetFrom + link.target.length,
      line: at,
    })
  }

  for (const match of line.matchAll(MARKDOWN_LINK)) {
    const [whole, bang = '', label = '', angled, bare] = match
    const written = angled ?? bare ?? ''
    if (!isNoteTarget(written)) continue

    const hash = written.indexOf('#')
    const target = hash === -1 ? written : written.slice(0, hash)
    const fragment = hash === -1 ? '' : written.slice(hash + 1)
    if (!target && !fragment) continue

    const from = offset + match.index
    const targetFrom = from + whole.indexOf(written, label.length + bang.length + 2)
    // `#^a1b2c3` names a block in a markdown link exactly as in a wikilink, which
    // is how Obsidian writes one and how nib writes one when the Links setting
    // asks for markdown links; see link-format.ts in the app.
    const block = fragment.startsWith('^') ? fragment.slice(1) : null

    here.push({
      target: decodeTarget(target),
      heading: block === null ? fragment || null : null,
      block,
      alias: label,
      embed: bang === '!',
      kind: 'markdown',
      from,
      to: from + whole.length,
      targetFrom,
      targetTo: targetFrom + target.length,
      line: at,
    })
  }

  here.sort((one, other) => one.from - other.from)
  found.push(...here)
}

/** A markdown target as the name it stands for: `My%20Note.md` is a link to
 *  `My Note.md`, and a rename has to recognise it as one. A target that is not
 *  valid encoding is taken as written. */
function decodeTarget(target: string): string {
  try {
    return decodeURI(target)
  } catch {
    return target
  }
}

/** The name a block link points at, when a line ends by naming one.
 *
 *  Asked of every line of every note, and of every visible line on every
 *  keystroke by the live preview, so a line with no caret in it at all is
 *  answered by a byte scan rather than by the pattern. Nearly every line is one:
 *  this was the second-most-run pattern in the preview. */
export function blockIdOf(line: string): string | null {
  if (!line.includes('^')) return null
  return BLOCK_ID.exec(line)?.[1] ?? null
}

/** The id a heading gets, the way GitHub forms them: lowercase words joined
 *  with hyphens, letters of any script kept.
 *
 *  Here because it is what turns a heading into the thing a link points at:
 *  `[[Note#Some Heading]]` and `[x](Note.md#some-heading)` name the same place,
 *  and only one of the two spells it out. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

/** A heading line, and the trailing hashes some styles close one with. */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/

/** A heading line and everything after its hashes, which is either nothing or a
 *  blank and then the words. `#` alone is an empty heading and `#Title` is not a
 *  heading at all, which is what CommonMark says of both. */
const HEADING_LINE = /^[ \t]{0,3}#{1,6}((?:[ \t].*)?)$/

/** A closing run of hashes, which needs a blank in front of it to be one.
 *
 *  Without the blank, `# C# and F#` lost its last character: the hash there is a
 *  letter of the name rather than the end of the heading. */
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/

/** The words a heading line shows: its opening hashes gone, and the closing ones
 *  gone as well. A line that is not a heading comes back as its own words.
 *
 *  Here with the grammar because it decides what `[[Note#Heading]]` can name. The
 *  editor reads a heading the same way - it draws the note's table of contents and
 *  writes a link to a heading - so both come through this. */
export function headingText(line: string): string {
  const found = HEADING_LINE.exec(line)
  if (found === null) return line.trim()

  return (found[1] ?? '').replace(CLOSING_HASHES, '').trim()
}

/** Every heading in a note, in order, as the words it shows. What a link may
 *  point at inside a note, which is why it lives here rather than with the
 *  outline: the browser's stand-in for the link scanner reads it, and so does the
 *  slice below, and the two have to agree on what counts as a heading. */
export function headingsOf(text: string): string[] {
  const found: string[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    if (HEADING.test(row.text)) found.push(headingText(row.text))
  }

  return found
}

/** The part of a note a link points into: the section under the heading it
 *  names, the block it names, or the whole note when it names neither. Null when
 *  the note has no such heading or block, which is a thing worth saying rather
 *  than showing an empty frame.
 *
 *  Here rather than in the editor because the same slice is needed wherever a
 *  note is read: an embed in the editor, an exported document, a published page. */
export function sectionOf(
  source: string,
  link: Pick<Wikilink, 'heading' | 'block'>,
): string | null {
  if (link.block !== null) return blockSection(source, link.block)
  if (link.heading !== null) return headingSection(source, link.heading)
  return source
}

/** From the heading down to the next one at its level or above it. */
function headingSection(source: string, wanted: string): string | null {
  const lines = source.split('\n')
  const needle = wanted.trim().toLowerCase()
  const slug = slugify(wanted)

  let fence: string | null = null
  let start = -1
  let level = 0

  for (const [index, line] of lines.entries()) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null
      continue
    }

    const mark = fenceMark(line)
    if (mark) {
      fence = mark
      continue
    }

    const hashes = HEADING.exec(line)?.[1]
    if (!hashes) continue

    const title = headingText(line)

    if (start === -1) {
      if (title.toLowerCase() === needle || slugify(title) === slug) {
        start = index
        level = hashes.length
      }
      continue
    }

    if (hashes.length <= level) return lines.slice(start, index).join('\n').trimEnd()
  }

  return start === -1 ? null : lines.slice(start).join('\n').trimEnd()
}

/** The block the name sits at the end of: the run of lines around it, with the
 *  name itself taken off, since it is a marker rather than a word of the text. */
function blockSection(source: string, wanted: string): string | null {
  const found = blockIds(source).find((one) => one.id === wanted)
  if (!found) return null

  const lines = source.split('\n')
  let start = found.line
  let end = found.line
  while (start > 0 && (lines[start - 1] ?? '').trim()) start--
  while (end + 1 < lines.length && (lines[end + 1] ?? '').trim()) end++

  const block = lines.slice(start, end + 1)
  block[found.line - start] = (lines[found.line] ?? '').replace(BLOCK_ID, '')

  return block.join('\n').trimEnd()
}

/** A name no block in the note has yet. Six characters of base 36, which is two
 *  billion names: short enough to read in the middle of a sentence, and it is
 *  only ever compared against the names in one note.
 *
 *  Beside the grammar that reads these rather than beside either of the two
 *  places that write one - the editor, naming a block somebody asked for a link
 *  to, and the app, naming one in a note that is not open - so both give out the
 *  same kind of name. */
export function freeBlockId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
}

/** Every block name in a note, with the line it sits on, counting from zero.
 *  Inside a fence a `^word` is code, so fences are skipped here as well. */
export function blockIds(text: string): { id: string; line: number }[] {
  const found: { id: string; line: number }[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    const id = blockIdOf(row.text)
    if (id) found.push({ id, line: row.line })
  }

  return found
}

/** One block of a note: a run of lines with blank ones around it. */
export interface NoteBlock {
  /** The line it starts on, counting from zero. */
  line: number
  /** Its first line as words, so a list of blocks can be read: the markup that
   *  opens the line and the name at the end of the block are both left off,
   *  since neither is something the block says. */
  text: string
  /** The name it already carries, or null for a block nothing links to yet. */
  id: string | null
}

/** How much of a block's first line is worth showing in a list of them. */
const BLOCK_LABEL = 80

/** Every block of a note, in order. What the editor offers after `#^`, where
 *  picking a block that has no name is what gives it one. */
export function blocksOf(text: string): NoteBlock[] {
  const found: NoteBlock[] = []
  let current: NoteBlock | null = null

  for (const row of lines(text)) {
    if (!row.code && row.text.trim() === '') {
      current = null
      continue
    }

    if (!current) {
      current = { line: row.line, text: firstWords(row.text), id: null }
      found.push(current)
    }

    if (row.code) continue
    const id = blockIdOf(row.text)
    if (id) current.id = id
  }

  return found
}

/** The same markdown with the block names taken out.
 *
 *  `^abc123` at the end of a block is a marker for a link to point at, not a
 *  word of the note, so nothing that shows a note shows it: not an export, not a
 *  published page, not an embed. The editor hides it the way it hides any other
 *  syntax mark, and brings it back when the caret is on its line. */
export function withoutBlockIds(text: string): string {
  let out = ''
  let at = 0

  for (const row of lines(text)) {
    if (row.code) continue

    const id = blockIdOf(row.text)
    if (!id) continue

    const end = row.from + row.text.trimEnd().length
    const caret = end - id.length - 1
    // The space that separated it from the words goes with it.
    const before = text[caret - 1]
    const from = before === ' ' || before === '\t' ? caret - 1 : caret

    out += text.slice(at, from)
    at = end
  }

  return at === 0 ? text : out + text.slice(at)
}

/** A block's first line as words: the heading hashes, the bullet, the quote mark
 *  and a name at the end all taken off. */
function firstWords(line: string): string {
  return line
    .replace(BLOCK_ID, '')
    .replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '')
    .trim()
    .slice(0, BLOCK_LABEL)
}
