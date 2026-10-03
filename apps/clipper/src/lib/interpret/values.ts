/** What the model said, read strictly enough to put in a file.
 *
 *  A model's JSON is loose in every way JSON can be loose: fenced, wrapped in a
 *  sentence of explanation, carrying keys nobody asked for, a number where a line
 *  was asked for, a list where a word was, a string with newlines in it. All of
 *  that arrives here and none of it may reach the note as anything but a value.
 *
 *  So the rule is: the template says which properties exist, and a property the
 *  template did not name does not exist however confidently the model named it. A
 *  value is one line of at most a few hundred characters or it is dropped. Nothing
 *  is coerced into a shape it was not asked for, and nothing is repaired - a reply
 *  that is not JSON at all is no reply, not a guess.
 *
 *  What keeps the block safe in the end is `writeFrontMatter`, which quotes
 *  whatever YAML would misread; this is the half that makes sure a value is a
 *  value: one line, so nothing can close the block early, and short, so nothing
 *  can bury the note under metadata. */

import { oneLine } from '@nib/markdown/front-matter'

import type { Template } from './templates'

/** One property, filled. The value is a list exactly when the template said the
 *  property was one, so the front matter writer never has to guess. */
export interface Filled {
  key: string
  value: string | string[]
}

/** As long as a title may be, and for the same reason: a property is a line above
 *  a note, and a page that hands over a paragraph is answering the wrong field. */
const LONGEST = 300

/** A member of a list is a word or a short phrase. The same ceiling the page's own
 *  tags get in `@nib/markdown/article`. */
const LONGEST_ITEM = 60
const MOST_ITEMS = 8

/** A fenced block, which is what a model writes when it has been told twice not
 *  to. The language after the ticks is ignored. */
const FENCED = /```[a-z]*\s*([\s\S]*?)```/i

/** The object in a reply, or null when there is none to be had.
 *
 *  Three shapes, in order: the reply is the object, the reply is a fence around
 *  it, or the reply is a sentence with the object somewhere in it. The last one
 *  takes the first `{` to the last `}`, which is the whole object whenever the
 *  prose around it holds no braces of its own - and when it does, `JSON.parse`
 *  refuses and the reply counts as unreadable, which is the right answer. */
export function objectIn(reply: string): Record<string, unknown> | null {
  const said = reply.trim()
  const inside = FENCED.exec(said)?.[1]?.trim()

  for (const candidate of [said, inside, braced(inside ?? said)]) {
    if (!candidate) continue

    try {
      const parsed: unknown = JSON.parse(candidate)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Not this shape; the next candidate may be.
    }
  }

  return null
}

/** From the first brace to the last, or null when there are not two of them. */
function braced(text: string): string | null {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  return from !== -1 && to > from ? text.slice(from, to + 1) : null
}

/** One line of at most `longest` characters, or null for a value that is not a
 *  line at all.
 *
 *  A number and a yes or no are accepted as the words they are: a model asked for
 *  a price or a count answers with one, and `4` is a perfectly good value for
 *  `servings`. Everything else - a nested object, a list where a line was asked
 *  for, a null standing in for "I could not find it" - is dropped. */
function line(value: unknown, longest: number): string | null {
  const said =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : typeof value === 'boolean'
          ? String(value)
          : null

  if (said === null) return null

  const one = oneLine(said).slice(0, longest).trim()
  return one || null
}

/** A list's members: the lines among them, deduplicated, capped. A model that
 *  answered a list field with one string meant a list of one. */
function items(value: unknown): string[] | null {
  const listed = Array.isArray(value) ? value : [value]
  const out: string[] = []

  for (const one of listed) {
    const said = line(one, LONGEST_ITEM)
    if (said && !out.includes(said)) out.push(said)
    if (out.length === MOST_ITEMS) break
  }

  return out.length ? out : null
}

/** The properties a reply fills in, in the order the template asked for them, or
 *  null when the reply was not an object at all.
 *
 *  An empty list is a real answer: the model read the page and found none of the
 *  properties in it, which is a clip with its usual four lines of front matter and
 *  nothing to apologise for. */
export function readFilled(reply: string, template: Template): Filled[] | null {
  const said = objectIn(reply)
  if (!said) return null

  const filled: Filled[] = []

  for (const field of template.fields) {
    // The key as the template spells it. A model answering `tags[]` with the key
    // `tags[]` is answering the right question in the wrong words, so both are
    // looked for; nothing else is.
    const answer = field.key in said ? said[field.key] : said[`${field.key}[]`]
    const value = field.list ? items(answer) : line(answer, LONGEST)

    if (value !== null) filled.push({ key: field.key, value })
  }

  return filled
}
