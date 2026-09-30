/** What the Ask panel hands a model besides the question: numbered passages of the
 *  reader's own notes, and nothing else of them.
 *
 *  A model asked about somebody's notes and shown none of them answers about the
 *  world instead, confidently. So a question goes with the passages that are about
 *  it - out of the note in front, and out of the space - and with nothing that is not.
 *  Only the lines that matched and a few either side, only a handful of notes, and a
 *  budget in tokens counted before the request rather than trusted after it: the
 *  privacy promise is that what leaves the machine is what the answer needs.
 *
 *  There is no index. Obsidian's assistants build one of embeddings over the whole
 *  vault, and that is what their readers complain about: a launch that hangs while it
 *  builds, a bill for embedding notes nobody asked about, an index that is stale the
 *  moment a note changes. nib asks its own search instead, the one the Search panel
 *  runs - the crate's walk over the bodies it already holds, or the browser build's
 *  worker - once per question and never before one. It is bounded three ways: the
 *  words asked for, the lines it may answer with, and a deadline after which the
 *  question goes with what has arrived. Archived and excluded notes are skipped before
 *  they are read, by the same list the Search panel skips them by.
 *
 *  Numbered because an answer has to be checkable. The model cites `[2]`, and `[2]` is
 *  a note and a line: the panel opens that note at that passage. A citation by name
 *  would be a name to resolve; a number is the passage itself.
 *
 *  Pure except for `retrieve`, which is the one function here that searches. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import type { Hit } from '../search/match'
import type { Query } from '../search/query'
import { searchSpace } from '../search/space'
import { waited } from '../timing'
import type { Message } from './providers'

/** One piece of one note, as the model is shown it and as a citation opens it. */
export interface Passage {
  /** The note, relative to the space: what a citation opens. */
  path: string
  /** What the note is called, which is what the reader reads beside a citation. */
  name: string
  /** The line a citation lands on, counting from nought: the first that matched. */
  line: number
  text: string
}

/** How many notes of the space a question is worth reading, and how many passages
 *  it may carry in all. Past that the request is the space rather than an answer. */
const MOST_NOTES = 6
const MOST_PASSAGES = 10

/** Budgets in tokens: the space's passages, any one note's share of them, the note
 *  in front, and what is selected in it. A few pages in all, next to a 4,096-token
 *  answer; see MOST_TOKENS in providers.ts. */
const BUDGET = 3000
const PER_NOTE = 700
const FRONT_BUDGET = 1500
const SELECTION_BUDGET = 800

/** How many lines of the space a search may answer with, and how long it may take
 *  before the question goes with what has arrived. A space of ten thousand notes is
 *  read by the crate from memory in well under that; the deadline is for the first
 *  question of a sitting on a slow disk. */
const MOST_LINES = 400
const DEADLINE = 1500

/** How many lines either side of a matching one go with it: a paragraph, in most
 *  notes. */
const AROUND = 3

/** How many tokens a text is, near enough: four characters each, which is what the
 *  tokenisers' own documentation says of English and over-counts CJK, so the request
 *  comes out under its budget rather than over it. */
export function tokensIn(text: string): number {
  return Math.ceil(text.length / 4)
}

/** As much of a text as fits a budget, cut at a line rather than mid-word. */
export function fitted(text: string, tokens: number): string {
  if (tokensIn(text) <= tokens) return text

  const room = tokens * 4
  const cut = text.slice(0, room)
  const lastBreak = cut.lastIndexOf('\n')
  return lastBreak > room / 2 ? cut.slice(0, lastBreak) : cut
}

/** The words of English and German that say nothing about which note. A language
 *  without a list keeps its short words, which costs a little ranking and never an
 *  answer. */
const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in' +
    ' into is it its me my no not of on or our should so than that the their them then there' +
    ' these they this to was we were what when where which who why will with would you your' +
    ' about all any tell show give find summarise summarize note notes' +
    ' der die das den dem des ein eine einer einen und oder ist sind war wie was wo wer warum' +
    ' ich du er sie es wir ihr mit von zu im in am an auf für nicht auch noch nur mein meine' +
    ' dass über welche welcher welches gibt habe hat haben kann können notiz notizen'
  ).split(' '),
)

/** The words of a question worth searching for: the grammar gone, one of each, the
 *  longest `most` of them kept - a long word is a specific one - in the order they
 *  were asked. Unicode-aware, so a question in Greek or Japanese splits on its own
 *  punctuation; a single character is dropped in every script. */
export function searchWords(question: string, most = 8): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_#-]+/u)
    .map((one) => one.replace(/^-+|-+$/g, ''))
    .filter((one) => !/^.?$/su.test(one) && !STOP.has(one))

  const seen = [...new Set(words)]
  const kept = new Set(
    [...seen]
      .sort((one, other) => other.length - one.length || (one < other ? -1 : 1))
      .slice(0, most),
  )

  return seen.filter((one) => kept.has(one))
}

/** Any of the words rather than all of them: a sentence's words are not all in one
 *  note. The ranking below is what makes "any" useful. */
export function queryFor(words: readonly string[]): Query {
  return { kind: 'any', of: words.map((text) => ({ kind: 'text', text, fold: true })) }
}

/** One note the search found, with what it was worth. */
export interface Ranked {
  path: string
  name: string
  score: number
  lines: number[]
}

/** The notes the search answered, best first.
 *
 *  Scored by which of the question's words each note says, each word weighted by how
 *  rare it is among the notes that answered - a word every note says tells them apart
 *  by nothing, and one only two notes say is the question. A word in the note's own
 *  name counts twice: a question about kestrels is answered by the note called
 *  Kestrels. Ties by how many lines matched, then by path, so the same question of
 *  the same space picks the same notes in the same order. A paper answers by page and
 *  has no lines to quote, so it is left to the Search panel. */
export function ranked(hits: readonly Hit[], words: readonly string[]): Ranked[] {
  const notes = new Map<string, { name: string; lines: Set<number>; said: Map<string, number> }>()

  for (const hit of hits) {
    if (hit.page !== undefined) continue

    const held = notes.get(hit.path) ?? { name: hit.name, lines: new Set(), said: new Map() }
    if (hit.ranges.length) held.lines.add(hit.line)

    const line = hit.text.toLowerCase()
    const name = hit.name.toLowerCase()
    for (const word of words) {
      const worth = name.includes(word) ? 2 : line.includes(word) ? 1 : 0
      if (worth > (held.said.get(word) ?? 0)) held.said.set(word, worth)
    }

    notes.set(hit.path, held)
  }

  const saying = new Map<string, number>()
  for (const held of notes.values()) {
    for (const word of held.said.keys()) saying.set(word, (saying.get(word) ?? 0) + 1)
  }

  const count = notes.size
  return [...notes]
    .map(([path, held]) => ({
      path,
      name: held.name,
      score: [...held.said].reduce(
        (sum, [word, worth]) => sum + worth * Math.log(1 + count / (saying.get(word) ?? 1)),
        0,
      ),
      lines: [...held.lines].sort((one, other) => one - other),
    }))
    .sort(
      (one, other) =>
        other.score - one.score ||
        other.lines.length - one.lines.length ||
        (one.path < other.path ? -1 : 1),
    )
}

/** The lines of a text that say any of the words, counting from nought. What the
 *  note in front is searched by, since it is in hand already. */
export function linesSaying(text: string, words: readonly string[]): number[] {
  if (!words.length) return []

  const out: number[] = []
  text.split('\n').forEach((line, at) => {
    const folded = line.toLowerCase()
    if (words.some((word) => folded.includes(word))) out.push(at)
  })
  return out
}

/** Where a note's words start: past its front matter, which is what the app reads
 *  rather than what the note says. */
function firstLine(text: string): number {
  const block = frontMatterBlock(text)
  return block ? text.slice(0, block.to).split('\n').length - 1 : 0
}

/** The passages of one note: each run of matching lines with its neighbours, runs
 *  that touch joined, within a budget; and where nothing matched - a note found by its
 *  name - the head of it instead, which is what a note is about. */
export function passagesOf(
  note: { path: string; name: string; text: string },
  lines: readonly number[],
  tokens: number,
): Passage[] {
  const rows = note.text.split('\n')
  const start = firstLine(note.text)
  const head = (): Passage[] => {
    const text = fitted(rows.slice(start).join('\n').trim(), tokens)
    return text ? [{ path: note.path, name: note.name, line: start, text }] : []
  }

  const matched = lines.filter((one) => one >= start && one < rows.length)
  if (!matched.length) return head()

  const runs: { from: number; to: number; line: number }[] = []
  for (const line of matched) {
    const from = Math.max(start, line - AROUND)
    const to = Math.min(rows.length - 1, line + AROUND)
    const last = runs.at(-1)

    if (last && from <= last.to + 1) last.to = Math.max(last.to, to)
    else runs.push({ from, to, line })
  }

  const out: Passage[] = []
  let left = tokens
  for (const run of runs) {
    if (left <= 0) break
    const text = fitted(
      rows
        .slice(run.from, run.to + 1)
        .join('\n')
        .trim(),
      left,
    )
    if (!text) continue

    out.push({ path: note.path, name: note.name, line: run.line, text })
    left -= tokensIn(text)
  }

  return out
}

/** The note in front, which is what "this" means in a question: the whole of it where
 *  it is short, and otherwise its passages about the question, or its head where the
 *  question names nothing in it - "summarise this". */
export function frontPassages(
  note: { path: string; name: string; text: string },
  words: readonly string[],
): Passage[] {
  const lines = linesSaying(note.text, words)
  const start = firstLine(note.text)
  const body = note.text.split('\n').slice(start).join('\n').trim()
  if (!body) return []

  if (tokensIn(body) > FRONT_BUDGET) return passagesOf(note, lines, FRONT_BUDGET)

  const line = lines.find((one) => one >= start) ?? start
  return [{ path: note.path, name: note.name, line, text: body }]
}

/** What `retrieve` needs of the app: the space to search, what it leaves out, and how
 *  to read a note. Handed over rather than imported, so the retrieval can be driven
 *  with a folder of strings in a test. */
export interface Space {
  root: string
  /** What the search skips before reading: excluded and archived notes. */
  excluded: readonly string[]
  /** The note the search answered with, relative to the space, or null for one
   *  outside it. */
  relative: (path: string) => string | null
  read: (path: string) => Promise<string | null>
  /** Asks the space, handful by handful; the app's own is `searchSpace`. */
  search?: typeof searchSpace
  deadline?: number
}

/** The passages of the space that are about a question, after the note in front's
 *  own and never repeating it. */
export async function retrieve(
  question: string,
  space: Space,
  front: { path: string; name: string; text: string } | null,
): Promise<Passage[]> {
  const words = searchWords(question)
  const own = front ? frontPassages(front, words) : []
  if (!words.length) return own

  const hits: Hit[] = []
  let open = true
  const search = space.search ?? searchSpace
  const asked = search(
    space.root,
    queryFor(words),
    [],
    MOST_LINES,
    (found) => {
      if (open) hits.push(...found.hits)
    },
    space.excluded,
  ).catch(() => undefined)

  await Promise.race([asked, waited(space.deadline ?? DEADLINE)])
  open = false

  const out = [...own]
  let spent = 0
  for (const note of ranked(hits, words).slice(0, MOST_NOTES + 1)) {
    if (spent >= BUDGET || out.length >= MOST_PASSAGES) break

    const path = space.relative(note.path)
    if (path === null || path === front?.path) continue

    const text = await space.read(note.path)
    if (text === null) continue

    const name = note.name.replace(/\.(?:md|markdown)$/i, '')
    const found = passagesOf({ path, name, text }, note.lines, Math.min(PER_NOTE, BUDGET - spent))
    for (const passage of found.slice(0, MOST_PASSAGES - out.length)) {
      out.push(passage)
      spent += tokensIn(passage.text)
    }
  }

  return out
}

/** The passages as the model is shown them, one system message, numbered from one in
 *  the order the reader's citations will count them. Nothing at all where there are
 *  none: a model told "here are the notes" and shown none answers about the ones it
 *  imagines. */
export function contextFor(passages: readonly Passage[], selection: string): Message[] {
  const out: Message[] = []

  if (passages.length) {
    const blocks = passages.map(
      (one, at) =>
        `<passage n="${at + 1}" note="${one.name.replace(/"/g, "'")}" line="${one.line + 1}">\n${one.text}\n</passage>`,
    )
    out.push({
      role: 'system',
      content: `Passages from the reader's notes:\n\n${blocks.join('\n\n')}`,
    })
  }

  if (selection.trim()) {
    out.push({
      role: 'system',
      content: `What the reader has selected in the note in front:\n\n<selection>\n${fitted(selection, SELECTION_BUDGET)}\n</selection>`,
    })
  }

  return out
}

/** A citation as the model writes one: `[2]`, or `[1, 3]` for two at once. Not a
 *  footnote's `[^1]`, and not a link's own `[2](…)`. */
const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g

/** Code, where a `[1]` is an index and not a citation. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/

/** The answer with every citation of a passage it was given made a link the panel
 *  answers - `[2](#cite-2)` - and anything else left as it was written. Outside
 *  code only. */
export function citationLinks(answer: string, count: number): string {
  return answer
    .split(CODE)
    .map((part, at) =>
      at % 2
        ? part
        : part.replace(CITATION, (whole, numbers: string) => {
            const cited = numbers.split(',').map((one) => Number(one.trim()))
            if (cited.some((one) => one < 1 || one > count)) return whole
            return cited.map((one) => `[${one}](#cite-${one})`).join('')
          }),
    )
    .join('')
}

/** Which passages an answer cited, by number, in the order it first cited them. */
export function citedIn(answer: string, count: number): number[] {
  const out: number[] = []
  for (const part of answer.split(CODE).filter((_part, at) => at % 2 === 0)) {
    for (const match of part.matchAll(CITATION)) {
      for (const one of (match[1] ?? '').split(',')) {
        const cited = Number(one.trim())
        if (cited >= 1 && cited <= count && !out.includes(cited)) out.push(cited)
      }
    }
  }
  return out
}

/** An earlier answer as it goes back to the model: its citations taken out, because
 *  the numbers belonged to passages that are not being sent again. */
export function uncited(answer: string): string {
  return answer.replace(/ ?\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, '')
}

/** The wikilink a citation becomes once the answer leaves the panel. */
function linkTo(source: { path: string; name: string }): string {
  const stem = source.path.replace(/\.(?:md|markdown)$/i, '')
  return stem === source.name ? `[[${stem}]]` : `[[${stem}|${source.name}]]`
}

/** An answer as it goes into a note or onto the clipboard: every citation the
 *  wikilink to the note it cited, so what the answer was built from stays one press
 *  away there too, and the same link twice in a row once. */
export function linkedAnswer(
  answer: string,
  sources: readonly { path: string; name: string }[],
): string {
  return answer
    .split(CODE)
    .map((part, at) =>
      at % 2
        ? part
        : part
            .replace(CITATION, (whole, numbers: string) => {
              const notes = numbers
                .split(',')
                .map((one) => sources[Number(one.trim()) - 1])
                .filter((one) => one !== undefined)
                .map(linkTo)
              return notes.length ? [...new Set(notes)].join(' ') : whole
            })
            .replace(/(\[\[[^\]]+\]\])(?:\s*\1)+/g, '$1'),
    )
    .join('')
}
