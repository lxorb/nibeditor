/** How one answer is laid out, Codex's way (docs/ai-sidebar.md 4.3): the work and then
 *  the answer. While it runs, every step is a row as it arrives; once it is done, the
 *  steps that led to the last words fold into one row, "Worked for 12s", so what was
 *  asked for is what is read and the way there is a press away.
 *
 *  Reads that follow one another (a note read, a search, a list) are one step, "Explored",
 *  as Codex draws them: a run of them says one thing, that the agent looked around.
 *  Pure, so the layout is tested apart from the panel. */

import type { Part } from '../chat/types'
import { verbOf } from './verbs'

type Notice = Extract<Part, { kind: 'notice' }>
type Tool = Extract<Part, { kind: 'tool' }>
type Row = Extract<Part, { kind: 'thinking' | 'tool' }>

export type Block =
  | { kind: 'words'; text: string; at: number }
  | { kind: 'notice'; notice: Notice; at: number }
  | { kind: 'row'; row: Row; at: number }
  /** Two or more reads in a row: one step that opens to each. */
  | { kind: 'explored'; rows: Tool[]; at: number }

/** The verbs that only look: a run of them is one Explored step. */
const LOOKING = new Set(['Read', 'Searched', 'Listed', 'Checked'])

/** Whether a call only looked around, and is done looking. One that asks the reader
 *  stays a row of its own, where its question is. */
function looks(part: Part): part is Tool {
  return part.kind === 'tool' && part.state !== 'asking' && LOOKING.has(verbOf(part.verb) ?? '')
}

/** The parts as blocks: consecutive words as one, so a paragraph split across two rounds
 *  of a stream is one paragraph, and consecutive reads as one Explored step. */
export function blocksOf(parts: readonly Part[]): Block[] {
  const out: Block[] = []
  parts.forEach((part, at) => {
    const before = out.at(-1)
    if (part.kind === 'text') {
      if (before?.kind === 'words') before.text += part.text
      else out.push({ kind: 'words', text: part.text, at })
    } else if (part.kind === 'notice') out.push({ kind: 'notice', notice: part, at })
    else if (looks(part) && before?.kind === 'explored') before.rows.push(part)
    else if (looks(part) && before?.kind === 'row' && looks(before.row))
      out[out.length - 1] = { kind: 'explored', rows: [before.row, part], at: before.at }
    else out.push({ kind: 'row', row: part, at })
  })
  return out
}

/** An answer split round its work: what came before the first step (a line saying
 *  another model answers from here), the steps and the words between them, and the last
 *  words with whatever followed them. `work` is empty where nothing folds: while the
 *  answer runs, where no tool was called, or where no words came after the steps. */
export function foldOf(
  blocks: readonly Block[],
  live: boolean,
): { before: Block[]; work: Block[]; after: Block[] } {
  const first = blocks.findIndex((one) => one.kind === 'row' || one.kind === 'explored')
  // A thought alone is already one folded row: only work with a call in it folds.
  const called = blocks.some(
    (one) => one.kind === 'explored' || (one.kind === 'row' && one.row.kind === 'tool'),
  )
  const said = (one: Block | undefined) => one?.kind === 'words' && one.text.trim() !== ''
  let last = blocks.length - 1
  while (last >= 0 && !said(blocks[last])) last--
  if (live || !called || first < 0 || last < first)
    return { before: [...blocks], work: [], after: [] }
  return {
    before: blocks.slice(0, first),
    work: blocks.slice(first, last),
    after: blocks.slice(last),
  }
}
