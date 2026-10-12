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

/** A markdown link or embed. The target is read as everything between the
 *  brackets, because an exported path is as likely to hold a space as not, and
 *  a title after it is put back as it was. */
const LINK = /(!?)\[([^\]\n]*)\]\(([^()\n]*)\)/g

/** A wikilink, which Bear, Logseq, Roam and Obsidian all write. */
const WIKILINK = /!?\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g

/** The row of dashes under a table's header, which is what makes the lines around it
 *  a table: `| --- | :-: |`, with or without the pipes at its ends. */
const DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

export interface Rewriting {
  /** Where the note sat in the export, which is what a relative link resolves
   *  against. */
  was: string
  /** Where it is going, which is what a relative link is written from. */
  now: string
}

export function rewriteLinks(text: string, at: Rewriting, find: Resolver): string {
  const folder = folderOf(at.now)
  const code = codeRanges(text)
  const tables = tableRanges(text)

  const linked = text.replace(
    LINK,
    (whole, bang: string, label: string, inside: string, offset: number) => {
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
      if (isMarkdownPath(found.path)) {
        const written = linkTo(found.name, label, {
          path: found.path,
          from: at.now,
          embed: bang === '!',
          fragment: fragment === null ? null : decoded(fragment),
        })
        return inCode(tables, offset) ? inCell(written) : written
      }

      const path = relativePath(folder, found.path)
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${bang}[${label}](${encodeTarget(path)}${anchor}${title})`
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
      if (inCode(stillCode, offset)) return whole

      // In a table Obsidian writes the `|` before the shown words as `\|`, and the
      // backslash is the cell's business rather than part of the name.
      // A wikilink is a name rather than an address, so nothing in it is percent
      // encoding: Obsidian reads `[[50%25 off]]` as the note called just that.
      const named = shown === undefined ? target : target.replace(/\\$/, '')
      const { path, fragment } = splitFragment(named.trim())
      const found = find(path, at.was)
      if (!found) return whole

      const written = linkTo(found.name, shown?.slice(1) ?? null, {
        path: found.path,
        from: at.now,
        embed: whole.startsWith('!'),
        fragment,
      })
      return inCode(stillTables, offset) ? inCell(written) : written
    },
  )
}

/** Where the note's tables are, as stretches of its text: the header row, the row of
 *  dashes under it and every row after, up to the first blank line. A callout's or a
 *  quote's `>` in front of each line is a table in there all the same. */
function tableRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n').map((line) => line.replace(/^(?: {0,3}>[ \t]?)*/, ''))
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

/** Where the note's code is, as stretches of its text: fenced blocks and inline code
 *  spans. A link written there is an example of one, which is words to copy exactly
 *  as they are, and neither Obsidian nor nib reads it as a link. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let fence: { mark: string; from: number } | null = null
  let prose = 0
  let at = 0

  for (const line of text.split('\n')) {
    const marked = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const mark = marked?.[1] ?? ''
    const rest = marked?.[2] ?? ''

    if (fence) {
      // A fence closes on a run of its own mark at least as long, with nothing after.
      if (
        mark &&
        mark.startsWith(fence.mark.charAt(0)) &&
        mark.length >= fence.mark.length &&
        !rest.trim()
      ) {
        ranges.push([fence.from, at + line.length])
        fence = null
        prose = at + line.length
      }
    } else if (mark && !(mark.startsWith('`') && rest.includes('`'))) {
      spans(text, prose, at, ranges)
      fence = { mark, from: at }
    }

    at += line.length + 1
  }

  // A fence nobody closed runs to the end of the note, which is how markdown reads it.
  if (fence) ranges.push([fence.from, text.length])
  else spans(text, prose, text.length, ranges)

  return ranges
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
  /** Every file in the export, by its lowercased export path. */
  private readonly byPath = new Map<string, Found>()

  /** The same, by bare name, for the shortest-path links. A name two files share
   *  answers with the first, which is what any reader of those spaces does. */
  private readonly byName = new Map<string, Found>()

  /** By name without the extension, which is how a wikilink names a note. */
  private readonly byStem = new Map<string, Found>()

  /** How many of the files arriving a wikilink would call by each name. */
  private readonly named = new Map<string, number>()

  add(was: string, found: Found) {
    this.byPath.set(was.toLowerCase(), found)

    const name = was.split('/').pop()?.toLowerCase() ?? was
    if (!this.byName.has(name)) this.byName.set(name, found)

    // A wikilink writes no extension, so a note answers to its stem as well, and
    // ahead of a canvas or a paper of the same stem: Obsidian reads a link with no
    // extension as a link to a note, whichever file sorted first.
    const stem = name.replace(/\.[^.]+$/, '')
    const held = this.byStem.get(stem)
    if (stem !== name && (!held || (!isMarkdownPath(held.path) && isMarkdownPath(found.path)))) {
      this.byStem.set(stem, found)
    }

    const said = found.name.toLowerCase()
    this.named.set(said, (this.named.get(said) ?? 0) + 1)
  }

  /** The resolver `rewriteLinks` asks. */
  readonly find: Resolver = (target, from) => {
    // The heading is already off: a `#` still here was `%23` in the link, and part
    // of the file's name.
    const cleaned = target.replace(/^\.\//, '').replace(/\/+$/, '')
    if (!cleaned) return null

    const here = folderOf(from)
    // A wikilink to a note in a folder writes the path without the extension.
    const tries = [joined(here, cleaned), cleaned].flatMap((one) => [one, `${one}.md`])

    for (const one of tries) {
      const found = this.byPath.get(one.toLowerCase())
      if (found) return this.told(found)
    }

    const name = cleaned.split('/').pop()?.toLowerCase() ?? cleaned
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

/** Two paths joined, with `..` resolved, all inside the export. */
function joined(folder: string, relative: string): string {
  const parts = folder ? folder.split('/') : []

  for (const part of relative.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return parts.join('/')
}
