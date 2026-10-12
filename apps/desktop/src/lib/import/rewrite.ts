/** Making the links in an imported note point at the notes that arrived with it.
 *
 *  Every one of these exports writes links its own way and all of them break on
 *  the way in, because the import renames things: Notion's id comes off the end
 *  of every file, a title that held a slash loses it, and two notes called the
 *  same thing are stepped apart.
 *
 *  What a link becomes:
 *
 *  A link to another note becomes a wikilink. That is nib's own way of pointing
 *  at a note, and it is the one that survives the reader renaming it afterwards,
 *  which a path does not. It is also what the graph, the backlinks and the
 *  unlinked mentions read.
 *
 *  A link to anything else - a picture, a paper, a spreadsheet - stays a markdown
 *  link with a relative path, which is what the app itself writes when a picture
 *  is pasted, and what keeps the folder readable in another editor.
 *
 *  A link to something that was not in the export is left exactly as it was. An
 *  address into the app it came from is a fact about where the note used to live,
 *  and rewriting it to nothing would lose that. */

import { foldName } from '@nib/markdown/links'

import { linkTo } from '../composer'
import { folderOf, isMarkdownPath, relativePath } from '../space-paths'

/** Where a link points, once the import has decided where things go. */
export interface Found {
  /** The path inside the import, relative to wherever the import lands. */
  path: string
  /** The name to write in a wikilink: the file name without its extension. */
  name: string
}

/** Answers where a link's target ended up, or null for one that was not in the
 *  export. `from` is the file the link is written in, as the export named it. */
export type Resolver = (target: string, from: string) => Found | null

/** Answers whether a wikilink naming `found`, written in the note at `from` (where
 *  that note is going), is read by nib as that very file. */
export type Reaching = (found: Found, from: string) => boolean

/** A markdown link or embed. The target is read as everything between the
 *  brackets, because an exported path is as likely to hold a space as not, and
 *  a title after it is put back as it was. A bracket with a backslash in front of
 *  it is only a bracket, the way every markdown reader takes it, so `\[label\](x)`
 *  is words somebody wrote about a link rather than one. */
const LINK = /(!?)(?<!\\)\[((?:[^\]\\\n]|\\.)*)\]\(([^()\n]*)\)/g

/** A wikilink, which Bear, Logseq, Roam and Obsidian all write. */
const WIKILINK = /!?\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g

/** What a wikilink cannot hold in its name: a `]` ends it and a `|` starts the
 *  words it shows, so a note named with either is reached by a markdown link. */
const UNLINKABLE = /[[\]|]/

/** The size Obsidian writes after a picture's `|`: a width, or a width and a
 *  height. */
const SIZE = /^\d+(?:x\d+)?$/

/** The row of dashes under a table's header, which is what makes the lines around it
 *  a table: `| --- | :-: |`, with or without the pipes at its ends. */
const DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/** The `>` in front of every line of a callout or a quote, however deep. */
const QUOTED = /^(?: {0,3}>[ \t]?)*/

/** A line indented far enough to be code: four spaces, or a tab. */
const INDENTED = /^(?: {4}| {0,3}\t)/

/** A line that starts a list item: a bullet, or a number and its dot. */
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/

export interface Rewriting {
  /** Where the note sat in the export, which is what a relative link resolves
   *  against. */
  was: string
  /** Where it is going, which is what a relative link is written from. */
  now: string
}

export function rewriteLinks(
  text: string,
  at: Rewriting,
  find: Resolver,
  reaches: Reaching = () => true,
): string {
  const folder = folderOf(at.now)
  const code = codeRanges(text)
  const tables = tableRanges(text)

  /** What one markdown link becomes. */
  function markdownLink(
    whole: string,
    bang: string,
    label: string,
    inside: string,
    offset: number,
  ): string {
    if (inCode(code, offset)) return whole

    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return whole

    // The heading, block or page after the `#` is kept apart from the path, so
    // the link still goes to the same place in the file once it is found.
    const { path: written, fragment } = splitFragment(target)
    const found = find(decoded(written), at.was)
    if (!found) return whole

    // A note is pointed at by name, so the link survives it being renamed - or in
    // the spelling the Links setting asks for, since `linkTo` is the one place in
    // the app that writes a link to a note and this is the app writing one.
    // A name a wikilink cannot hold keeps the markdown link it came in, which is
    // the one way Obsidian could link to it either.
    // So does a name nib would read as another note from where this one is going:
    // a note at the top of the vault is named by its name alone, and a note of the
    // same name beside the link is nearer.
    // And so do words a wikilink cannot show: a `]` in them would end it.
    if (
      isMarkdownPath(found.path) &&
      !UNLINKABLE.test(found.name) &&
      !/[[\]]/.test(label) &&
      reaches(found, at.now)
    ) {
      const link = linkTo(found.name, label, {
        path: found.path,
        from: at.now,
        embed: bang === '!',
        fragment: fragment === null ? null : decoded(fragment),
      })
      return inCode(tables, offset) ? inCell(link) : link
    }

    const path = relativePath(folder, found.path)
    const anchor = fragment === null ? '' : `#${fragment}`
    return `${bang}[${label}](${encodeTarget(path)}${anchor}${title})`
  }

  // Where the links this pass writes sit in what it hands on, so the pass after it
  // does not read a wikilink it wrote as one the note came with. That one would be
  // found again from the note's own folder, which a link that said `../` was not.
  const rewritten: [number, number][] = []
  let moved = 0

  const linked = text.replace(
    LINK,
    (whole, bang: string, label: string, inside: string, offset: number) => {
      const link = markdownLink(whole, bang, label, inside, offset)
      if (link !== whole) rewritten.push([offset + moved, offset + moved + link.length])
      moved += link.length - whole.length
      return link
    },
  )

  // `shown` is the second group, which a link with no `|` in it does not have: the
  // replacer is handed `undefined` there whatever the types say. Through `linkTo`
  // as well, so an import writes one spelling throughout rather than keeping the
  // exporting app's wherever it happened to match nib's. The code is found again,
  // because the pass above moved everything after the first link it rewrote.
  const stillCode = codeRanges(linked)
  const stillTables = tableRanges(linked)
  return linked.replace(
    WIKILINK,
    (whole, target: string, shown: string | undefined, offset: number) => {
      if (inCode(stillCode, offset) || inCode(rewritten, offset)) return whole

      // In a table Obsidian writes the `|` before the shown words as `\|`, and the
      // backslash is the cell's business rather than part of the name.
      // A wikilink is a name rather than an address, so nothing in it is percent
      // encoding: Obsidian reads `[[50%25 off]]` as the note called just that.
      const named = shown === undefined ? target : target.replace(/\\$/, '')
      const { path, fragment } = splitFragment(named.trim())
      const found = find(path, at.was)
      if (!found) return whole

      // A link that found its file only by ignoring case keeps the case it was
      // written in: those are words in a sentence, and nib reads a name without
      // regard to case just as Obsidian does.
      const name = found.name.toLowerCase() === path.toLowerCase() ? path : found.name
      const words = shown?.slice(1) ?? null
      const embed = whole.startsWith('!')
      // A picture's size has no place in a markdown image, where it would only be
      // its alt text, so a sized embed stays a wikilink whatever the Links setting.
      const sized = embed && !isMarkdownPath(found.path) && SIZE.test(words?.trim() ?? '')
      const written = linkTo(
        name,
        words,
        { path: found.path, from: at.now, embed, fragment },
        sized ? 'wikilink' : undefined,
      )
      return inCode(stillTables, offset) ? inCell(written) : written
    },
  )
}

/** Where the note's tables are, as stretches of its text: the header row, the row of
 *  dashes under it and every row after, up to the first blank line. A callout's or a
 *  quote's `>` in front of each line is a table in there all the same. */
function tableRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n').map((line) => line.replace(QUOTED, ''))
  const starts: number[] = []
  let at = 0
  for (const line of text.split('\n')) {
    starts.push(at)
    at += line.length + 1
  }

  for (let one = 1; one < lines.length; one++) {
    const head = lines[one - 1] ?? ''
    const divider = lines[one] ?? ''
    if (!DIVIDER.test(divider) || !divider.includes('|') || !head.includes('|')) continue

    let last = one
    while ((lines[last + 1] ?? '').trim()) last += 1
    ranges.push([starts[one - 1] ?? 0, (starts[last + 1] ?? text.length + 1) - 1])
    one = last
  }

  return ranges
}

/** A link written into a table cell. A bare `|` there ends the cell, which would cut
 *  a wikilink's shown words off into a cell of their own, so it is written `\|`, the
 *  way Obsidian writes it and nib reads it. */
function inCell(link: string): string {
  return link.replace(/(?<!\\)\|/g, '\\|')
}

/** A link's target and what follows its `#`: a heading, a `^blockid`, a PDF's
 *  `page=3`. Null when there is no `#`, so an empty fragment is still told apart
 *  from none. */
function splitFragment(target: string): { path: string; fragment: string | null } {
  const at = target.indexOf('#')
  if (at < 0) return { path: target, fragment: null }
  return { path: target.slice(0, at), fragment: target.slice(at + 1) }
}

/** Where the note's code is, as stretches of its text: fenced blocks, indented
 *  blocks and inline code spans, in a callout or a quote as well. A link written
 *  there is an example of one, which is words to copy exactly as they are, and
 *  neither Obsidian nor nib reads it as a link. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n')
  const properties = propertiesEnd(lines)
  let fence: { mark: string; from: number } | null = null
  let indented: { from: number; to: number } | null = null
  // An indented block needs a blank line above it, since an indented line straight
  // under a paragraph is more of the paragraph, and it cannot sit in a list item,
  // whose indented lines are more of the item.
  let blank = true
  let listed = false
  let prose = 0
  let at = 0

  for (const [index, whole] of lines.entries()) {
    // A callout's or a quote's `>` comes off first: its code is code all the same.
    const line = whole.replace(QUOTED, '')
    const empty = !line.trim()
    const marked = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const mark = marked?.[1] ?? ''
    const rest = marked?.[2] ?? ''

    if (index < properties) {
      // The properties at the top are YAML, where an indent is only an indent.
    } else if (fence) {
      // A fence closes on a run of its own mark at least as long, with nothing after.
      if (
        mark &&
        mark.startsWith(fence.mark.charAt(0)) &&
        mark.length >= fence.mark.length &&
        !rest.trim()
      ) {
        ranges.push([fence.from, at + whole.length])
        fence = null
        prose = at + whole.length
      }
    } else {
      // An indented block runs on through blank lines, and ends on the first line
      // that is not indented, which is then read like any other.
      if (indented && !empty && INDENTED.test(line)) indented.to = at + whole.length
      else if (indented && !empty) {
        ranges.push([indented.from, indented.to])
        prose = indented.to
        indented = null
      }

      if (indented) {
        // Still in the block.
      } else if (mark && !(mark.startsWith('`') && rest.includes('`'))) {
        spans(text, prose, at, ranges)
        fence = { mark, from: at }
      } else if (!empty && INDENTED.test(line) && blank && !listed) {
        spans(text, prose, at, ranges)
        indented = { from: at, to: at + whole.length }
      } else if (!empty && !INDENTED.test(line)) {
        listed = LIST_ITEM.test(line)
      }
    }

    blank = empty
    at += whole.length + 1
  }

  // A fence nobody closed runs to the end of the note, which is how markdown reads it.
  if (fence) {
    ranges.push([fence.from, text.length])
    return ranges
  }

  if (indented) {
    ranges.push([indented.from, indented.to])
    prose = indented.to
  }
  spans(text, prose, text.length, ranges)
  return ranges
}

/** How many lines the properties at the top of the note take, the two `---` lines
 *  included, or nothing for a note that has none. */
function propertiesEnd(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0
  const closing = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
  return closing < 0 ? 0 : closing + 1
}

/** The inline code spans between `from` and `to`: a run of backticks, up to the
 *  next run of exactly as many. A run with no partner is only backticks. */
function spans(text: string, from: number, to: number, ranges: [number, number][]) {
  const runs = [...text.slice(from, to).matchAll(/`+/g)]

  for (let one = 0; one < runs.length; one++) {
    const open = runs[one]
    if (!open) continue
    const close = runs.findIndex((run, at) => at > one && run[0].length === open[0].length)
    if (close < 0) continue

    const shut = runs[close]
    if (!shut) continue
    ranges.push([from + open.index, from + shut.index + shut[0].length])
    one = close
  }
}

function inCode(ranges: readonly [number, number][], offset: number): boolean {
  return ranges.some(([from, to]) => offset >= from && offset < to)
}

/** The target and the title inside a link's brackets, told apart the way every
 *  markdown reader does: the title is quoted and comes last. */
function splitTarget(inside: string): { target: string; title: string } {
  const said = inside.trim()
  const quoted = /\s+("[^"]*"|'[^']*')$/.exec(said)
  const target = quoted ? said.slice(0, quoted.index).trim() : said
  const title = quoted ? ` ${quoted[1] ?? ''}` : ''

  return { target: target.replace(/^<|>$/g, ''), title }
}

/** Whether this points somewhere else entirely, in which case it is left alone:
 *  a web address, a mail address, or a heading inside this very note.
 *
 *  `file:` is the exception, because it is not somewhere else: it is a path on
 *  the machine the export came off, which is what macOS writes into a note's
 *  HTML for every attachment. If that file is in the export it is one of the
 *  files arriving, and if it is not, the link is left as it was like any other. */
function isAddress(target: string): boolean {
  if (/^file:/i.test(target)) return false

  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')
}

/** A path out of what a link wrote, with the percent encoding every exporter
 *  uses for spaces undone. A target that is not valid encoding is its own
 *  answer rather than an error. */
function decoded(target: string): string {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

/** A space encoded again on the way out, and the two characters a link cannot hold
 *  as themselves: a `%`, which would start an escape, and a `#`, which would start a
 *  heading. Nothing else, so a reader who opens the note sees the file name they
 *  would see in the file list. */
function encodeTarget(path: string): string {
  return path.replace(/%/g, '%25').replace(/#/g, '%23').replace(/ /g, '%20')
}

/** Finding a link's target among the files an export held.
 *
 *  Three tries, in the order the exports need them: the path as written from the
 *  note's own folder, the same path from the top of the export, and finally the
 *  bare file name anywhere in the export. The last is what Obsidian, Bear and
 *  Logseq all rely on, since none of them writes a path at all. */
export class ExportFiles {
  /** Every file in the export, by its export path. */
  private readonly byPath = new Spellings()

  /** The same, by bare name, for the shortest-path links. A name two files share
   *  answers with the first, which is what any reader of those spaces does. */
  private readonly byName = new Spellings()

  /** Notes by name without the extension, which is how a wikilink names a note.
   *  Only notes: Obsidian reads a link with no extension as a link to a note, so
   *  `[[Budget]]` beside nothing but `Budget.xlsx` is a note nobody has written yet,
   *  not the spreadsheet, and a canvas or a paper of the same stem never answers. */
  private readonly byStem = new Spellings()

  /** How many of the files arriving a wikilink would call by each name. */
  private readonly named = new Map<string, number>()

  /** The notes arriving, by the last part of their path without its extension, the
   *  way nib looks a wikilink's name up. */
  private readonly arriving = new Map<string, string[]>()

  add(was: string, found: Found) {
    this.byPath.add(was, found)

    const name = was.split('/').pop() ?? was
    this.byName.add(name, found)

    const stem = name.replace(/\.[^.]+$/, '')
    if (stem !== name && isMarkdownPath(found.path)) this.byStem.add(stem, found)

    const said = found.name.toLowerCase()
    this.named.set(said, (this.named.get(said) ?? 0) + 1)

    if (isMarkdownPath(found.path)) {
      const last = foldName(withoutExtension(found.path)).split('/').pop() ?? ''
      this.arriving.set(last, [...(this.arriving.get(last) ?? []), found.path])
    }
  }

  /** Whether nib reads a wikilink naming `found`, written in the note at `from`, as
   *  that very note. It takes a name as the end of a path and picks the nearest note
   *  that fits: the one beside the link, then the shallowest, then the first by path.
   *  See `resolveNote` in @nib/editor, whose reading this is. */
  readonly reaches: Reaching = (found, from) => {
    const wanted = foldName(found.name)
    const fits = (this.arriving.get(wanted.split('/').pop() ?? '') ?? []).filter((path) => {
      const said = foldName(withoutExtension(path))
      return said === wanted || said.endsWith(`/${wanted}`)
    })

    const here = folderOf(from)
    const depth = (path: string) => path.split('/').length
    const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
    const nearest = [...fits].sort(
      (one, other) =>
        beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
    )[0]
    return nearest === undefined || nearest === found.path
  }

  /** The resolver `rewriteLinks` asks. */
  readonly find: Resolver = (target, from) => {
    // The heading is already off: a `#` still here was `%23` in the link, and part
    // of the file's name.
    // A path that starts with `/` starts at the top of the vault, which is how
    // Obsidian reads it, so it is not looked for in the note's own folder.
    const rooted = target.startsWith('/')
    const cleaned = target.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
    if (!cleaned) return null

    const here = folderOf(from)
    // A wikilink to a note in a folder writes the path without the extension.
    const tries = (rooted ? [cleaned] : [joined(here, cleaned), cleaned]).flatMap((one) => [
      one,
      `${one}.md`,
    ])

    for (const one of tries) {
      const found = this.byPath.get(one)
      if (found) return this.told(found)
    }

    const name = cleaned.split('/').pop() ?? cleaned
    return this.byName.get(name) ?? this.byStem.get(name) ?? null
  }

  /** A file the link named by its path, with enough of that path kept to say which
   *  file is meant when another arriving shares its name. The bare name would go to
   *  whichever of them the space finds first. A link that named only the name is
   *  left to answer the way it did, so it is not handed here. */
  private told(found: Found): Found {
    if ((this.named.get(found.name.toLowerCase()) ?? 0) < 2) return found
    return { ...found, name: found.path.replace(/\.md$/i, '') }
  }
}

/** Files by a name, found by the exact spelling first and then without regard to
 *  case, the first file added answering either way. A vault off a Linux disk can
 *  hold `Plan.md` and `plan.md` side by side, and `[[Plan]]` there means the one
 *  spelled that way rather than whichever of the two came last. */
class Spellings {
  private readonly exact = new Map<string, Found>()
  private readonly folded = new Map<string, Found>()

  add(key: string, found: Found) {
    if (!this.exact.has(key)) this.exact.set(key, found)
    const lower = key.toLowerCase()
    if (!this.folded.has(lower)) this.folded.set(lower, found)
  }

  get(key: string): Found | undefined {
    return this.exact.get(key) ?? this.folded.get(key.toLowerCase())
  }
}

/** A path without the extension on its last part. */
function withoutExtension(path: string): string {
  return path.replace(/\.[^./]+$/, '')
}

/** Two paths joined, with `..` resolved, all inside the export. */
function joined(folder: string, relative: string): string {
  const parts = folder ? folder.split('/') : []

  for (const part of relative.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return parts.join('/')
}
