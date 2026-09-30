/** Every tag a note uses, once per use, and where each one sits in it.
 *
 *  One rule, four readers: the tag tree under an empty search field, the `tag:`
 *  operator, the browser's stand-in for `space_tags`, and renaming a tag across
 *  a space. The Rust side keeps the twin of this in tags.rs, and the tests hold
 *  the two to the same answers.
 *
 *  A tag is written two ways, which is Obsidian's pair and so what a file
 *  written by either app says. Inline, `#work/nib`: a heading is not one because
 *  it has a space after the hash and a tag never does, a tag starts a word, and
 *  its first character is a letter, which is what rules out `#42`. And in the
 *  front matter, under `tags:`, as a list on the line or as items under it,
 *  where the hash is optional because YAML would read it as a comment.
 *
 *  A tag's slashes make it a path: `work/nib/canvas` sits under `work/nib`,
 *  which sits under `work`, to any depth. Nothing here knows that - a tag is one
 *  string to this module - but tag-tree.ts and the `tag:` operator both read the
 *  slashes, so the characters that may appear in one are what decides how deep a
 *  tree can go. */

import { type FrontMatterBlock, frontMatterBlock } from '@nib/markdown/front-matter'

/** Where one use of a tag sits: the offsets of its name, the hash not included,
 *  so a rename splices a new path in and leaves whatever hung off the old one. */
export interface TagUse {
  /** The name as written, without the hash. */
  tag: string
  from: number
  to: number
}

/** What a tag's name may hold. The first character is a letter; after it,
 *  letters, digits, and the three characters that join words - the slash among
 *  them, which is what makes a tag nestable. */
const NAME = /^\p{L}[\p{L}\p{N}\-_/]*$/u

const TAG = /(^|[\s(])#(\p{L}[\p{L}\p{N}\-_/]*)/gu

const FENCE = /^\s*(```|~~~)/

/** `tags:` or `tag:` at the left margin of the front matter, and what follows
 *  it on the line. Both spellings, because Obsidian takes both. */
const KEY = /^tags?:(.*)$/i

/** One item of a list written under its key. */
const ITEM = /^\s*-\s*(.*?)\s*$/

/** One value inside a written-out list: `[a, b]`, `a, b` and `a b` all read. */
const VALUE = /[^\s,[\]'"]+/g

/** Every use of every tag in the note, in the order they appear. */
export function tagUses(body: string): TagUse[] {
  const out: TagUse[] = []
  const front = frontMatterBlock(body)

  if (front) readFront(body, front, out)
  readInline(body, front, out)

  return out
}

/** Every tag a note uses, once per use, with the hash. What the counts and the
 *  `tag:` operator read. */
export function tagsIn(body: string): string[] {
  return tagUses(body).map((use) => `#${use.tag}`)
}

/** Where `path` and everything under it sits in the note, as the span of the
 *  `path` part alone. `#work/nib/canvas` answers with the span of `work/nib`
 *  when asked about `work/nib`, so writing another path over it keeps the
 *  `/canvas` that hung off it.
 *
 *  Folded, because the operator is: a note that wrote `#Work/Nib` is under the
 *  same node of the tree as one that wrote `#work/nib`, and a rename has to
 *  reach both. */
export function tagSpans(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  return tagUses(body)
    .filter((use) => {
      const folded = use.tag.toLowerCase()
      return folded === wanted || folded.startsWith(`${wanted}/`)
    })
    .map((use) => ({ from: use.from, to: use.from + wanted.length }))
}

/** Where `path` and everything under it has to be cut from to be gone: the hash
 *  as well as the name, the space that was holding the tag apart from its
 *  neighbours, and, for a tag written as an item of the front matter list, the
 *  whole line it was the whole of.
 *
 *  A tag taken out of a sentence should leave the sentence reading as it did,
 *  which is what the widening is for: `words #tag words` has to come back as
 *  `words words` rather than with two spaces in the middle of it. */
export function tagCuts(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  const out: { from: number; to: number }[] = []

  for (const use of tagUses(body)) {
    const folded = use.tag.toLowerCase()
    if (folded !== wanted && !folded.startsWith(`${wanted}/`)) continue

    out.push(widened(body, use))
  }

  return out
}

/** One use, grown out to what taking it away has to remove.
 *
 *  A tag sits between separators, and a tag taken out has to take one of them
 *  with it or leave the note saying `words  words` or `[, other]`. Which side is
 *  eaten is whichever side there is one on, the following comma first, because
 *  that is the one a list would otherwise be left holding. */
function widened(body: string, use: TagUse): { from: number; to: number } {
  const from = body.charAt(use.from - 1) === '#' ? use.from - 1 : use.from
  const line = body.lastIndexOf('\n', from - 1) + 1
  const end = body.indexOf('\n', use.to)
  const after = end === -1 ? body.length : end

  // A list item that held nothing but this tag is a line with nothing left to
  // say, so the line goes with it.
  if (/^\s*-\s*$/.test(body.slice(line, from)) && body.slice(use.to, after).trim() === '') {
    return { from: line, to: end === -1 ? body.length : end + 1 }
  }

  // The comma this tag was in front of, and the space after it.
  if (body.charAt(use.to) === ',') {
    return { from, to: use.to + 1 + spaces(body, use.to + 1, after) }
  }

  // Or the separator behind it: the space, and the comma the space followed.
  const before = /(,?[ \t]+|,)$/.exec(body.slice(line, from))
  if (before) return { from: from - before[0].length, to: use.to }

  // Or, for a tag that opened its line, the space in front of what follows it.
  return { from, to: use.to + spaces(body, use.to, after) }
}

/** How many spaces or tabs run from `at`, without leaving the line. */
function spaces(body: string, at: number, stop: number): number {
  let over = 0
  while (at + over < stop && /[ \t]/.test(body.charAt(at + over))) over++
  return over
}

/** The tags under a `tags:` key, whether they are on its line or in items
 *  beneath it. Where the block sits is the one reader every other part of the app
 *  reads it with; see `frontMatterBlock` in @nib/markdown. */
function readFront(body: string, front: FrontMatterBlock, out: TagUse[]) {
  let at = front.body.from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    const line = body.slice(at, stop)
    const found = KEY.exec(line)

    if (found) {
      const [, rest = ''] = found
      // What is on the key's own line, then whatever items follow it.
      readValues(at + line.length - rest.length, rest, out)
      at = readItems(body, stop + 1, front, out)
      continue
    }

    if (end === -1) break
    at = end + 1
  }
}

/** The `- item` lines under a key, stopping at the first line that is not one.
 *  Answers where it stopped, so the caller reads on from there. */
function readItems(body: string, from: number, front: FrontMatterBlock, out: TagUse[]): number {
  let at = from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    const line = body.slice(at, stop)
    const item = ITEM.exec(line)
    if (!item) return at

    const [, value = ''] = item
    readValues(at + line.indexOf(value), value, out)
    if (end === -1) return front.close
    at = end + 1
  }

  return at
}

/** Every name in a written-out value, at the offsets it holds in the note. */
function readValues(from: number, text: string, out: TagUse[]) {
  for (const found of text.matchAll(VALUE)) {
    const [whole] = found

    // The hash is optional here, because YAML reads one as a comment; a value
    // that has one is the same tag as a value that has not.
    const hashed = whole.startsWith('#')
    const name = hashed ? whole.slice(1) : whole
    if (!NAME.test(name)) continue

    const at = from + found.index + (hashed ? 1 : 0)
    out.push({ tag: name, from: at, to: at + name.length })
  }
}

/** Every `#tag` in the note's own words. The front matter is left out of this
 *  pass: a hash there is a YAML comment, and the tags it holds have been read
 *  already. Fenced code is left out too, where a `#` is a comment or a heading
 *  in some other language. */
function readInline(body: string, front: FrontMatterBlock | null, out: TagUse[]) {
  let at = front ? front.to : 0
  let fenced = false

  while (at <= body.length) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 ? body.length : end
    const line = body.slice(at, stop)

    if (FENCE.test(line)) fenced = !fenced
    else if (!fenced) {
      for (const found of line.matchAll(TAG)) {
        const [, before = '', name] = found
        if (name === undefined) continue

        // Past what opened the word and past the hash, so the span is the name.
        const start = at + found.index + before.length + 1
        out.push({ tag: name, from: start, to: start + name.length })
      }
    }

    if (end === -1) break
    at = end + 1
  }
}
