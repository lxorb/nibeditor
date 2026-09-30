/** A note cut into the blocks a person thinks in, for the rule that asks when one side
 *  deleted what the other side rewrote.
 *
 *  Not a markdown parser. The classifier asks one question of a block - did one side
 *  take it out while the other wrote in it - and needs only where each one starts and
 *  ends: a paragraph, a list item with its continuation lines, a heading, a fenced
 *  block from fence to fence, one row of a table, a quote, and the front matter. A
 *  walk over lines answers that, reading fences and front matter the way
 *  `@nib/markdown` reads them, so the classifier and the renderer agree about where
 *  code starts and stops. */

import { closesFence, fenceMark } from '@nib/markdown/fences'
import { frontMatterBlock } from '@nib/markdown/front-matter'

type BlockKind = 'front-matter' | 'heading' | 'paragraph' | 'item' | 'fence' | 'row' | 'quote'

/** One block, as the offsets of its text without the line break that ends it. */
export interface Block {
  from: number
  to: number
  kind: BlockKind
}

interface Line {
  from: number
  to: number
  text: string
}

function linesOf(text: string, from: number): Line[] {
  const out: Line[] = []
  let at = from
  while (at < text.length) {
    const end = text.indexOf('\n', at)
    const stop = end === -1 ? text.length : end
    out.push({ from: at, to: stop, text: text.slice(at, stop).replace(/\r$/, '') })
    at = stop + 1
  }
  return out
}

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/
const ROW = /^\s*\|/
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/
const QUOTE = /^\s{0,3}>/

/** What opens a block of each kind and is not its words: a list item's marker and
 *  box, a heading's hashes, a quote's angle, a table row's pipes. */
const LEAD: Partial<Record<BlockKind, RegExp>> = {
  item: /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,
  heading: /^ {0,3}#{1,6}\s*/,
  quote: /^\s{0,3}>\s?/,
  row: /^\s*\|\s*/,
}

/** What closes a table row and is not its words. */
const ROW_END = /\s*\|?\s*$/

/** Where a block's words are: without its opening marks, and for a table row without
 *  its closing pipe.
 *
 *  Asked because a deletion is not always reported where it was made. Taking out
 *  `- milk` and its line break between two items leaves the same text as taking out
 *  `milk`, the line break and the next item's `- `, and a diff is free to say either;
 *  both take out every word of the item, which is the question that matters. */
export function contentOf(text: string, block: Block): Block {
  const written = text.slice(block.from, block.to)
  const lead = LEAD[block.kind]?.exec(written)?.[0].length ?? 0
  const trail = block.kind === 'row' ? (ROW_END.exec(written.slice(lead))?.[0].length ?? 0) : 0
  const from = block.from + lead
  return { ...block, from, to: Math.max(from, block.to - trail) }
}

/** The blocks of a note, in order. */
export function blocksOf(text: string): Block[] {
  const out: Block[] = []
  const front = frontMatterBlock(text)
  const start = front ? front.to : 0
  if (front)
    out.push({
      from: 0,
      to: text[front.to - 1] === '\n' ? front.to - 1 : front.to,
      kind: 'front-matter',
    })

  const lines = linesOf(text, start)
  let open: Block | null = null
  const close = () => {
    if (open) out.push(open)
    open = null
  }

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (!line) continue

    if (!line.text.trim()) {
      close()
      continue
    }

    const mark = fenceMark(line.text)
    if (mark) {
      close()
      let end = at + 1
      while (end < lines.length && !closesFence(lines[end]?.text ?? '', mark)) end++
      const last = lines[Math.min(end, lines.length - 1)] ?? line
      out.push({ from: line.from, to: last.to, kind: 'fence' })
      at = end
      continue
    }

    const own: BlockKind | null = HEADING.test(line.text)
      ? 'heading'
      : ROW.test(line.text)
        ? 'row'
        : ITEM.test(line.text)
          ? 'item'
          : null

    if (own === 'heading' || own === 'row') {
      close()
      out.push({ from: line.from, to: line.to, kind: own })
      continue
    }

    if (own === 'item') {
      close()
      open = { from: line.from, to: line.to, kind: 'item' }
      continue
    }

    const kind: BlockKind = QUOTE.test(line.text) ? 'quote' : 'paragraph'
    // A line that is neither a new item nor a new kind of block continues the one it
    // follows: a list item's wrapped line, a paragraph's next line, a quote's next.
    if (open && (open.kind === kind || open.kind === 'item' || kind === 'paragraph')) {
      open.to = line.to
      continue
    }

    close()
    open = { from: line.from, to: line.to, kind }
  }

  close()
  return out
}
