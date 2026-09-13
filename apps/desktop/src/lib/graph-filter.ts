/** Which notes a query keeps in the picture of a space.
 *
 *  The same query language the space search speaks, so a habit is a habit: bare
 *  words, `"a phrase"`, `-` to exclude, `OR` to widen, brackets to group, `path:`,
 *  `file:` and `tag:`. One field, one grammar, two surfaces; see search/query.ts,
 *  which parses it.
 *
 *  What a picture can answer is narrower than what a search can, and it says so
 *  rather than pretending. A node is a note's name, its path and its tags - the
 *  index holds nothing else about it, and reading five thousand notes off the disk
 *  to answer one keystroke is not a filter, it is a search. So a bare word asks
 *  the name and the path, and the operators that need the note's own lines -
 *  `[key:value]`, `line:(a b)` and `content:` - narrow nothing rather than quietly
 *  matching nothing: a filter that emptied the picture over an operator it cannot
 *  read would look like an answer. The field's placeholder is what says which
 *  three things it reads.
 *
 *  Compiled once per query rather than walked per node: a space of five thousand
 *  notes asks this five thousand times a keystroke, and a regular expression built
 *  inside that loop is built five thousand times. */

import type { GraphNode } from './graph'
import { aKindOfLine, type Query } from './search/query'

/** Whether one note stays in the picture. */
export type Keeps = (node: GraphNode) => boolean

const EVERYTHING: Keeps = () => true

/** A query as one predicate over a node. */
export function graphFilter(query: Query): Keeps {
  switch (query.kind) {
    case 'all': {
      const parts = query.of.map(graphFilter)
      return (node) => parts.every((one) => one(node))
    }

    case 'any': {
      const parts = query.of.map(graphFilter)
      return (node) => parts.some((one) => one(node))
    }

    case 'not': {
      const inner = graphFilter(query.of)
      return (node) => !inner(node)
    }

    // A word with no operator in front of it asks the two things a picture knows
    // a note by: what it is called, and where it lives.
    case 'text': {
      const wanted = folded(query.text, query.fold)
      return (node) =>
        folded(node.name, query.fold).includes(wanted) ||
        folded(node.id, query.fold).includes(wanted)
    }

    case 'path': {
      const wanted = folded(query.text, query.fold)
      return (node) => folded(node.id, query.fold).includes(wanted)
    }

    case 'file': {
      const wanted = folded(query.text, query.fold)
      return (node) => folded(node.name, query.fold).includes(wanted)
    }

    // A tag's slashes make it a path, so `tag:work` keeps a note tagged
    // `#work/2026` as well - the reading the operator has always had.
    case 'tag': {
      const wanted = query.tag
      return (node) => node.tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))
    }

    case 'regex': {
      const pattern = compiled(query.source, query.fold)
      if (!pattern) return EVERYTHING
      // Reset between notes: a pattern is used again here, and `lastIndex` is the
      // one piece of state a regular expression carries between uses.
      return (node) => {
        pattern.lastIndex = 0
        return pattern.test(node.name)
      }
    }

    // Nearness inside a note means nothing to a picture of the space, but the
    // words it groups still do: `line:(plan later)` asks for both of them.
    //
    // A task is not a distance, though. `task-todo:plan` asks about one line of a
    // note, and keeping every note whose name says plan would be answering a
    // different question, so it narrows nothing the way front matter does.
    case 'scope':
      return aKindOfLine(query.unit) ? EVERYTHING : graphFilter(query.of)

    // A node carries no front matter and none of the note's own words. Narrowing
    // nothing leaves the picture as it was, which is the honest answer to a
    // question it cannot hear.
    case 'property':
    case 'content':
      return EVERYTHING
  }
}

function folded(text: string, fold: boolean): string {
  return fold ? text.toLowerCase() : text
}

/** The pattern, or null for one that does not compile - which is what half of one
 *  looks like while it is still being typed. */
function compiled(source: string, fold: boolean): RegExp | null {
  try {
    return new RegExp(source, fold ? 'iu' : 'u')
  } catch {
    return null
  }
}
