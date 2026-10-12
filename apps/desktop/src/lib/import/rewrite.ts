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
 *  is words somebody wrote about a link rather than one.
 *
 *  The words and the target may each hold brackets of their own that are balanced,
 *  as CommonMark allows: `[Paper [2019]](paper.pdf)`, and `Screenshot%20(1).png`,
 *  which is how Obsidian writes a link to `Screenshot (1).png`. The words do not
 *  start with a bracket, since `[[Plan]](x)` is a wikilink followed by words. */
const LINK =
  /(!?)(?<!\\)\[((?!\[)(?:[^[\]\\\n]|\\.|\[(?:[^[\]\\\n]|\\.)*\])*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g

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

/** A line that opens or closes a fenced code block: a run of backticks or tildes,
 *  and whatever is said after it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** The same inside a list item, where it sits as far in as the item's words. */
const LISTED_FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/

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
  const code = withMath(text, codeRanges(text))
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

    // A picture in a link's words, a badge or a cover that opens a page, is pointed at
    // its file the way a picture on its own is: the link around it is matched whole,
    // so the picture would otherwise never be read.
    const words = label.replace(LINK, (one, inner: string, said: string, held: string) =>
      markdownLink(one, inner, said, held, offset),
    )
    const kept = words === label ? whole : `${bang}[${words}](${inside})`

    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return kept

    // The heading, block or page after the `#` is kept apart from the path, so
    // the link still goes to the same place in the file once it is found.
    const { path: written, fragment } = splitFragment(target)
    const found = find(decoded(written), at.was)
    if (!found) return kept

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
      !/[[\]]/.test(words) &&
      reaches(found, at.now)
    ) {
      const link = linkTo(found.name, words, {
        path: found.path,
        from: at.now,
        embed: bang === '!',
        fragment: fragment === null ? null : decoded(fragment),
      })
      return inCode(tables, offset) ? inCell(link) : link
    }

    const path = relativePath(folder, found.path)
    const anchor = fragment === null ? '' : `#${fragment}`
    return `${bang}[${words}](${encodeTarget(path)}${anchor}${title})`
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
  const stillCode = withMath(linked, codeRanges(linked))
  const stillTables = tableRanges(linked)
  const properties = propertiesTo(linked)
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
      // A property holds a link only as a wikilink, in Obsidian and in nib alike, so
      // one there stays one: a markdown link would be only words, and the relation
      // it made would be gone.
      const property = offset < properties
      const written = linkTo(
        name,
        words,
        { path: found.path, from: at.now, embed, fragment },
        sized || property ? 'wikilink' : undefined,
      )
      return inCode(stillTables, offset) ? inCell(written) : written
    },
  )
}

/** A canvas whose file cards point at where the files they show went: `moved` maps
 *  a path as the canvas names it to the one the file has now. JSON Canvas names a
 *  file by its path from the top of the vault, so a card would otherwise go on
 *  showing a name the import changed, or a note of that name that was already in
 *  the space. Only those paths are written again, each in its place, so the rest
 *  of the file stays byte for byte; a canvas that is not UTF-8 is not one, and is
 *  left as it came. */
export function canvasFollowed(bytes: Uint8Array, moved: ReadonlyMap<string, string>): Uint8Array {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return bytes
  }

  const followed = text.replace(
    /("file"\s*:\s*)("(?:[^"\\]|\\.)*")/g,
    (whole, key: string, said: string) => {
      const now = moved.get(jsonString(said) ?? '')
      return now === undefined ? whole : `${key}${JSON.stringify(now)}`
    },
  )
  return followed === text ? bytes : new TextEncoder().encode(followed)
}

/** A note's links, pointing at where the import's own files went once some of them
 *  stepped aside: `moved` maps a path inside the import to the one the file has now,
 *  `paths` is every file the import holds, and `was` is the note's own path.
 *
 *  Each link is read the way nib reads it, so only a link that meant a file that
 *  moved is written again: `[[Plan]]` beside a root `Plan.md` that stayed is left on
 *  it when `Projects/Plan.md` is the one that stepped aside. A wikilink keeps its
 *  folders, its case, its heading and the `\|` a table writes, and only its name
 *  changes; a markdown link is followed by its path from this note, its heading,
 *  page and title kept. A link written as an example in code is left as it was. */
export function linksFollowed(
  text: string,
  was: string,
  moved: ReadonlyMap<string, string>,
  paths: readonly string[],
): string {
  const here = folderOf(was)
  const movedFolded = new Map([...moved].map(([from, to]) => [foldName(from), to] as const))
  const called = calledBy(paths)
  const code = withMath(text, codeRanges(text))

  /** What one markdown link becomes. */
  function markdownLink(
    whole: string,
    bang: string,
    label: string,
    inside: string,
    offset: number,
  ): string {
    if (inCode(code, offset)) return whole

    const words = label.replace(LINK, (one, inner: string, said: string, held: string) =>
      markdownLink(one, inner, said, held, offset),
    )
    const kept = words === label ? whole : `${bang}[${words}](${inside})`

    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return kept
    const { path: written, fragment } = splitFragment(target)
    // A path that starts with `/` starts at the top of the vault, as `find` reads it.
    const path = decoded(written)
    const meant = path.startsWith('/') ? path.replace(/^\/+/, '') : joined(here, path)
    const now = moved.get(meant) ?? movedFolded.get(foldName(meant))
    if (now === undefined) return kept

    const anchor = fragment === null ? '' : `#${fragment}`
    return `${bang}[${words}](${encodeTarget(relativePath(here, now))}${anchor}${title})`
  }

  const linked = text.replace(LINK, markdownLink)
  const stillCode = withMath(linked, codeRanges(linked))

  return linked.replace(
    WIKILINK,
    (whole, target: string, shown: string | undefined, offset: number) => {
      if (inCode(stillCode, offset)) return whole

      // In a table the `|` before the shown words is written `\|`, and the backslash
      // is the cell's business rather than part of the name.
      const cell = shown !== undefined && target.endsWith('\\')
      const named = cell ? target.slice(0, -1) : target
      const { path, fragment } = splitFragment(named)
      const said = path.trim()
      const meant = nearest(said, was, called)
      const now = meant === undefined ? undefined : moved.get(meant)
      if (meant === undefined || now === undefined) return whole

      const renamed = respelled(said, meant, now)
      if (renamed === null) return whole
      const bang = whole.startsWith('!') ? '!' : ''
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${bang}[[${path.replace(said, renamed)}${anchor}${cell ? '\\' : ''}${shown ?? ''}]]`
    },
  )
}

/** The files a wikilink could name, by the last part of the name it would use: a
 *  note's without its extension and with it, any other file's whole. */
function calledBy(paths: readonly string[]): Map<string, string[]> {
  const called = new Map<string, string[]>()
  for (const path of paths) {
    const name = path.split('/').pop() ?? path
    const names = isMarkdownPath(path) ? [name, withoutExtension(name)] : [name]
    for (const one of names) {
      const key = foldName(one)
      called.set(key, [...(called.get(key) ?? []), path])
    }
  }
  return called
}

/** The file a wikilink naming `said`, written in the note at `from`, is read as:
 *  the one whose path ends with the name, beside the link first, then the
 *  shallowest, then the first by path. See `reaches` above, whose reading this is. */
function nearest(
  said: string,
  from: string,
  called: ReadonlyMap<string, string[]>,
): string | undefined {
  const wanted = foldName(said.replace(/^\/+/, ''))
  const fits = (called.get(wanted.split('/').pop() ?? '') ?? []).filter((path) => {
    const whole = foldName(path)
    const bare = isMarkdownPath(path) ? foldName(withoutExtension(path)) : whole
    return [whole, bare].some((one) => one === wanted || one.endsWith(`/${wanted}`))
  })

  const here = folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
  return [...fits].sort(
    (one, other) =>
      beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
  )[0]
}

/** A wikilink's name for a file that moved from `from` to `to`, in the link's own
 *  spelling: its folders kept, the extension only where it wrote one, and the case
 *  it was typed in kept for the part of the name that did not change. Null where
 *  the name the link wrote is not the file's at all. */
function respelled(said: string, from: string, to: string): string | null {
  const parts = said.split('/')
  const last = parts.pop() ?? said
  const whole = from.split('/').pop() ?? from
  const name = [whole, withoutExtension(whole)].find((one) => foldName(one) === foldName(last))
  if (name === undefined) return null

  const fresh = to.split('/').pop() ?? to
  const after = name === whole ? fresh : withoutExtension(fresh)
  const spelled = after.startsWith(name) ? last + after.slice(name.length) : after
  return [...parts, spelled].join('/')
}

/** What a JSON string says, or null for one that is not valid JSON. */
function jsonString(said: string): string | null {
  try {
    const value: unknown = JSON.parse(said)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** Whether this file is a canvas, whose cards name the files they show. */
export function isCanvas(path: string): boolean {
  return /\.canvas$/i.test(path)
}

/** Where the note's tables are, as stretches of its text: the header row, the row of
 *  dashes under it and every row after, up to the first blank line. A callout's or a
 *  quote's `>` in front of each line is a table in there all the same, and so is the
 *  indent of a list item, a tab or four spaces, which is where Obsidian writes a table
 *  kept under one. Lines indented that far as code are code first, and a link there
 *  is left alone before its table is asked about. */
function tableRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n').map((line) => line.replace(QUOTED, '').replace(/^[ \t]+/, ''))
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
export function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n')
  const properties = propertiesEnd(lines)
  let fence: { mark: string; from: number; loose: boolean; depth: number } | null = null
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
    // So does the `\r` a note written on Windows ends every line with, which would
    // otherwise be read as words after a fence.
    const quoted = QUOTED.exec(whole)?.[0] ?? ''
    const depth = quoted.split('>').length - 1
    const line = whole.slice(quoted.length).replace(/\r$/, '')
    const empty = !line.trim()

    // A fence opened inside a callout or a quote closes when that ends, whether or
    // not its closing line came, the way CommonMark and Obsidian read it: what follows
    // the callout is the note's own words again.
    if (fence && depth < fence.depth) {
      ranges.push([fence.from, at])
      fence = null
      prose = at
    }

    // A fence can open on a list item's own line, after its marker, and inside a
    // list item it sits as far in as the item's words, which is past the three
    // spaces a fence may have anywhere else: `1. Write:` then `    ~~~` is a code
    // block in that item, in CommonMark and in Obsidian alike. The fence it opened
    // closes the same way.
    const item: RegExpExecArray | null = fence ? null : LIST_ITEM.exec(line)
    const loose: boolean = fence ? fence.loose : listed || item !== null
    const marked: RegExpExecArray | null = (loose ? LISTED_FENCE : FENCE).exec(
      item ? line.slice(item[0].length) : line,
    )
    const mark: string = marked?.[1] ?? ''
    const rest: string = marked?.[2] ?? ''

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
        fence = { mark, from: at, loose, depth }
        if (!INDENTED.test(line)) listed = item !== null
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

/** Math, `$$` blocks and `$` spans: what Obsidian reads after a `$` that is not
 *  followed by a space, up to one that is not after a space or before a digit, so
 *  a price is only a price. Neither is Markdown any more than code is, so a link
 *  never starts in it: `$f[x](y)$` is LaTeX, whatever notes the vault holds. */
const MATH =
  /(?<!\\)\$\$(?:[^$\\]|\\[\s\S]|\$(?!\$))*\$\$|(?<![\\$])\$(?![\s$])(?:[^$\n\\]|\\.|\n(?![ \t>]*\n))*?(?<![\s\\])\$(?!\d)/g

/** The code ranges, and the math outside them. A `$` in a code span is only a dollar,
 *  so the code is blanked out before the math is looked for, its lines kept so a
 *  span still ends at its paragraph. */
function withMath(text: string, code: [number, number][]): [number, number][] {
  if (!text.includes('$')) return code

  const parts: string[] = []
  let at = 0
  for (const [from, to] of [...code].sort((one, other) => one[0] - other[0])) {
    if (to <= at) continue
    const start = Math.max(from, at)
    parts.push(text.slice(at, start), text.slice(start, to).replace(/[^\n]/g, ' '))
    at = to
  }
  const plain = parts.join('') + text.slice(at)

  const math = [...plain.matchAll(MATH)].map((one): [number, number] => [
    one.index,
    one.index + one[0].length,
  ])
  return [...code, ...math]
}

/** How many lines the properties at the top of the note take, the two `---` lines
 *  included, or nothing for a note that has none. */
function propertiesEnd(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0
  const closing = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
  return closing < 0 ? 0 : closing + 1
}

/** Where the properties at the top of the note end, as an offset into its text, or
 *  nothing for a note that has none. */
function propertiesTo(text: string): number {
  const lines = text.split('\n')
  return lines.slice(0, propertiesEnd(lines)).join('\n').length
}

/** The inline code spans between `from` and `to`, a paragraph at a time. A code
 *  span cannot cross a blank line, in CommonMark and in Obsidian alike, so a lone
 *  backtick in one paragraph is only a backtick and does not pair with the opening
 *  one of a span further down. A blank line inside a callout or a quote is one too. */
function spans(text: string, from: number, to: number, ranges: [number, number][]) {
  let paragraph = from
  let at = from
  for (const line of text.slice(from, to).split('\n')) {
    if (!line.replace(QUOTED, '').trim()) {
      paired(text, paragraph, at, ranges)
      paragraph = at + line.length + 1
    }
    at += line.length + 1
  }
  paired(text, paragraph, to, ranges)
}

/** The inline code spans in one paragraph: a run of backticks, up to the next run
 *  of exactly as many. A run with no partner is only backticks. */
function paired(text: string, from: number, to: number, ranges: [number, number][]) {
  if (from >= to) return
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

export function inCode(ranges: readonly [number, number][], offset: number): boolean {
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

/** A space encoded again on the way out, and the characters a link cannot hold as
 *  themselves: a `%`, which would start an escape, a `#`, which would start a
 *  heading, and a bracket, since a `)` the name holds alone would end the link
 *  there, and every reader takes the encoded one the same. Nothing else, so a
 *  reader who opens the note sees the file name they would see in the file list. */
function encodeTarget(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

/** Finding a link's target among the files an export held.
 *
 *  Three tries, in the order the exports need them: the path as written from the
 *  note's own folder, the same path from the top of the export, and finally the
 *  bare file name anywhere in the export, or for a link that names folders too, the
 *  file whose path ends with them. The last is what Obsidian, Bear and Logseq all
 *  rely on, since none of them writes the whole path. */
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

  /** Every file in the export with its export path, in the order they came. */
  private readonly paths: [string, Found][] = []

  /** How many of the files arriving a wikilink would call by each name. */
  private readonly named = new Map<string, number>()

  /** How many of the files in the export a link could call by each name, the way it
   *  was before the import renamed anything. */
  private readonly called = new Map<string, number>()

  /** The notes arriving, by the last part of their path without its extension, the
   *  way nib looks a wikilink's name up. */
  private readonly arriving = new Map<string, string[]>()

  add(was: string, found: Found) {
    this.byPath.add(was, found)
    this.paths.push([was, found])

    const name = was.split('/').pop() ?? was
    this.byName.add(name, found)

    const stem = name.replace(/\.[^.]+$/, '')
    if (stem !== name && isMarkdownPath(found.path)) this.byStem.add(stem, found)

    const names = stem !== name && isMarkdownPath(found.path) ? [name, stem] : [name]
    for (const one of names) {
      const key = one.toLowerCase()
      this.called.set(key, (this.called.get(key) ?? 0) + 1)
    }

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

    // A link that names folders as well is held to them, the way Obsidian reads
    // one: the file whose path ends with what the link wrote. A link to
    // `Clients/Acme/Contacts` in a vault with only `Clients/Beta/Contacts.md` is a
    // note nobody has written yet, not Beta's. A path written on another machine,
    // `file:///Users/me/Export/pic.png`, ends with the file's own instead.
    const said = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..')
    if (said.length > 1) {
      const fits = this.paths.find(([was]) => endsTogether(was, said.join('/')))
      return fits ? this.told(fits[1]) : null
    }

    const name = cleaned.split('/').pop() ?? cleaned
    const found = this.byName.get(name) ?? this.byStem.get(name)
    if (!found) return null
    // A name only one file in the export had could only mean that file. Once a
    // renamed file arrives with it as well - `Why?` is `Why` on the way in - the
    // folder is written in too, so the link still says which.
    return (this.called.get(name.toLowerCase()) ?? 0) < 2 ? this.told(found) : found
  }

  /** A file the link named by its path, with enough of that path kept to say which
   *  file is meant when another arriving shares its name. The bare name would go to
   *  whichever of them the space finds first. A link that named only a name two
   *  files in the export had is left to answer the way it did, so it is not handed
   *  here. */
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

/** Whether one of two paths is the end of the other, whole folders and names at a
 *  time and without regard to case, a note's `.md` left off or not. */
function endsTogether(was: string, said: string): boolean {
  const one = was.toLowerCase()
  const other = said.toLowerCase()
  const ends = (path: string, end: string) => path === end || path.endsWith(`/${end}`)
  return [one, one.replace(/\.md$/, '')].some((path) => ends(path, other) || ends(other, path))
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
