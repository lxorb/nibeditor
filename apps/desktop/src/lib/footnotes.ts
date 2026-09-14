/** The footnotes of a note: what each one says, and where it is written.
 *
 *  Read off the text the way the headings are, and for the same three reasons:
 *  the panel is about the note the workspace holds rather than whichever note an
 *  editor view happens to show, it can be tested without a document, and the walk
 *  is in one place. See outline.ts, which this sits beside.
 *
 *  A footnote is two things in two places - a `[^1]` in the middle of a sentence
 *  and a `[^1]: …` at the bottom - and the panel is the one screen that puts them
 *  together. So a row carries both lines: the one the mark is on in the words above,
 *  which is where pressing the row goes, and the one the definition is written on,
 *  which the Footnotes panel offers beside it. Reading the note is what you were
 *  doing, so the mark is what a press answers; the definition is a second press for
 *  the times you came looking for what it says. */

export interface Footnote {
  /** The label between the brackets, which is what the note shows as a raised
   *  number: `1`, or `why` for somebody who names them. */
  id: string
  /** What the definition says, as written. Empty for one written nowhere. */
  text: string
  /** The line the first `[^id]` in the words is on, or the definition's own line
   *  for a footnote nothing refers to. */
  line: number
  /** The line the definition is written on, or null for a mark nothing defines -
   *  which is a real thing to find in a note and the reason this is not simply the
   *  line above. */
  defined: number | null
  /** Whether anything in the note actually points at it. */
  used: boolean
}

/** `[^id]: what it says`, at the start of a line. */
const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/

/** Every `[^id]` on a line, definitions included; the one at the start of a
 *  definition is filtered out by where it sits. */
const REFERENCE = /\[\^([^\]\s]+)\]/g

const FENCE = /^\s*(```|~~~)/

/** Every footnote the note holds, in the order the note refers to them, with
 *  the ones nothing refers to after. A definition written twice is read once,
 *  the way the renderer reads it.
 *
 *  Walked with indexOf rather than split, so a large note is not copied into an
 *  array of lines only to be thrown away again. */
export function scanFootnotes(text: string): Footnote[] {
  if (!text.includes('[^')) return []

  const said = new Map<string, string>()
  const definedAt = new Map<string, number>()
  const order: string[] = []
  const usedAt = new Map<string, number>()

  let fenced = false
  let line = 0
  let from = 0

  for (;;) {
    const end = text.indexOf('\n', from)
    const row = text.slice(from, end === -1 ? text.length : end)

    if (FENCE.test(row)) fenced = !fenced
    else if (!fenced) {
      const defined = DEFINITION.exec(row)
      if (defined) {
        const id = defined[1] ?? ''
        // The first definition wins, which is how the renderer reads a label
        // written twice.
        if (!said.has(id)) {
          said.set(id, (defined[2] ?? '').trim())
          definedAt.set(id, line)
        }
      }

      for (const found of row.matchAll(REFERENCE)) {
        const id = found[1] ?? ''
        // The `[^1]` that opens a definition is the definition, not a mention
        // of it.
        if (defined && found.index === 0) continue
        if (!usedAt.has(id)) {
          usedAt.set(id, line)
          order.push(id)
        }
      }
    }

    if (end === -1) break
    from = end + 1
    line++
  }

  // Referred to first, in the order the words reach them; then the ones defined
  // and never used, which are worth seeing precisely because nothing points at
  // them.
  const unused = [...said.keys()].filter((id) => !usedAt.has(id))

  return [...order, ...unused].map((id) => ({
    id,
    text: said.get(id) ?? '',
    line: usedAt.get(id) ?? definedAt.get(id) ?? 0,
    defined: definedAt.get(id) ?? null,
    used: usedAt.has(id),
  }))
}
