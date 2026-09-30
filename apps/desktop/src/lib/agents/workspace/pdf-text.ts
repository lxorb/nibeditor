/** A PDF page's words as pdf.js lays them out, and a quote found among them. Pure: the
 *  arithmetic of where words sit, apart from the PDF they sit in; see pdf.ts. */

import type { Quad } from '../../pdf/highlights'
import { Refused } from './problem'

/** The pages a call asks for, `1-3,7` as a printer's dialog says it, in order and each
 *  once; every page when it asks for none. */
export function pagesAsked(said: string | null, count: number): number[] {
  if (said === null) return Array.from({ length: count }, (_, at) => at + 1)

  const pages = new Set<number>()
  for (const part of said.split(',')) {
    const [from, to] = part.split('-').map((one) => Number(one.trim()))
    if (from === undefined || !Number.isInteger(from)) {
      throw new Refused('bad_arguments', 'pages is like 1-3,7')
    }
    const last = to ?? from
    if (!Number.isInteger(last)) throw new Refused('bad_arguments', 'pages is like 1-3,7')

    for (let page = Math.max(1, from); page <= Math.min(last, count); page++) pages.add(page)
  }

  return [...pages].sort((one, other) => one - other)
}

/** One run of text as pdf.js lays it out: its words and where they sit. */
export interface Run {
  str: string
  transform: number[]
  width: number
  height: number
  /** Whether the line ends after it, as pdf.js says. */
  hasEOL?: boolean
}

export function runsOf(items: readonly unknown[]): Run[] {
  return items.flatMap((item) => {
    const run = item as Partial<Run>
    return typeof run.str === 'string' && Array.isArray(run.transform)
      ? [
          {
            str: run.str,
            transform: run.transform,
            width: run.width ?? 0,
            height: run.height ?? 0,
            hasEOL: run.hasEOL === true,
          },
        ]
      : []
  })
}

/** A page's words as one string, and where each run starts in it. The runs of two lines
 *  are kept apart by a line break, which pdf.js does not write, so the last word of one
 *  line and the first of the next are two words. */
export function laidOut(runs: readonly Run[]): { text: string; starts: number[] } {
  let text = ''
  const starts: number[] = []
  let baseline: number | null = null

  for (const run of runs) {
    const y = run.transform[5] ?? 0
    if (baseline !== null && Math.abs(y - baseline) > 0.5 && !/\s$/.test(text)) text += '\n'
    starts.push(text.length)
    text += run.str
    if (run.hasEOL === true) text += '\n'
    baseline = y
  }

  return { text, starts }
}

/** Words compared the way a reader compares them: spaces and line breaks of any kind
 *  and length are one space. Answers the folded words and, for each of their
 *  characters, where it came from. */
function folded(text: string): { text: string; at: number[] } {
  let out = ''
  const at: number[] = []
  let space = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? ''
    if (/\s/.test(character)) {
      space = out.length > 0
      continue
    }
    if (space) {
      out += ' '
      at.push(index)
      space = false
    }
    out += character
    at.push(index)
  }

  return { text: out, at }
}

/** Where a quote is on a page, as the characters of `laidOut` it covers, every place
 *  it is when there is more than one. */
export function quoteIn(runs: readonly Run[], quote: string): { from: number; to: number }[] {
  const whole = folded(laidOut(runs).text)
  const wanted = folded(quote).text
  if (!wanted) return []

  const found: { from: number; to: number }[] = []
  for (let at = whole.text.indexOf(wanted); at !== -1; at = whole.text.indexOf(wanted, at + 1)) {
    const from = whole.at[at] ?? 0
    const to = (whole.at[at + wanted.length - 1] ?? from) + 1
    found.push({ from, to })
  }

  return found
}

/** The boxes a stretch of a page's characters covers, one per line, as quads in PDF
 *  user space: each run's share of its own width, from its baseline down to its
 *  descender and up to its ascender, and the pieces on one line joined into one band. */
export function quadsOver(runs: readonly Run[], from: number, to: number): Quad[] {
  const lines = new Map<number, { left: number; right: number; top: number; bottom: number }>()
  const { starts } = laidOut(runs)

  for (const [index, run] of runs.entries()) {
    const start = starts[index] ?? 0
    const end = start + run.str.length
    if (end <= from || start >= to || !run.str.length) continue

    const [, , , , x = 0, y = 0] = run.transform
    const share = (at: number) => (at - start) / run.str.length
    const left = x + run.width * share(Math.max(from, start))
    const right = x + run.width * share(Math.min(to, end))
    const size = run.height || Math.abs(run.transform[3] ?? 0)
    const key = Math.round(y)
    const line = lines.get(key)

    const top = y + size * 0.8
    const bottom = y - size * 0.2
    lines.set(
      key,
      line
        ? {
            left: Math.min(line.left, left),
            right: Math.max(line.right, right),
            top: Math.max(line.top, top),
            bottom: Math.min(line.bottom, bottom),
          }
        : { left, right, top, bottom },
    )
  }

  return [...lines.values()].map(({ left, right, top, bottom }) => [
    left,
    top,
    right,
    top,
    right,
    bottom,
    left,
    bottom,
  ])
}
