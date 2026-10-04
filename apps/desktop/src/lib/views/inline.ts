/** A task's words drawn the way the line reads: bold, italic, code, struck and links
 *  as themselves, the marks gone (docs/tasks.md 5.5, "markdown drawn inline").
 *
 *  As pieces rather than as HTML, so a view never puts somebody's markup into the page
 *  (a task line can come from a shared space): each piece is text with how it looks,
 *  and the component draws text. One pass over one line; nothing here is per row more
 *  than once. */

export interface Piece {
  text: string
  strong?: boolean
  em?: boolean
  code?: boolean
  struck?: boolean
  /** A wikilink's note or a link's address. */
  link?: string
}

/** The inline forms, earliest match first. Each names its words' group. */
const FORMS: { pattern: RegExp; make: (found: RegExpExecArray) => Piece }[] = [
  { pattern: /`([^`]+)`/, make: (found) => ({ text: found[1] ?? '', code: true }) },
  {
    pattern: /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/,
    make: (found) => ({ text: found[2] ?? found[1] ?? '', link: found[1] ?? '' }),
  },
  {
    pattern: /\[([^\]]+)\]\(([^)\s]+)\)/,
    make: (found) => ({ text: found[1] ?? '', link: found[2] ?? '' }),
  },
  {
    pattern: /\*\*([^*]+)\*\*|__([^_]+)__/,
    make: (found) => ({ text: found[1] ?? found[2] ?? '', strong: true }),
  },
  { pattern: /~~([^~]+)~~/, make: (found) => ({ text: found[1] ?? '', struck: true }) },
  { pattern: /==([^=]+)==/, make: (found) => ({ text: found[1] ?? '' }) },
  {
    pattern: /(?<![\w*])\*([^*\s][^*]*)\*(?!\*)|(?<!\w)_([^_\s][^_]*)_(?!\w)/,
    make: (found) => ({ text: found[1] ?? found[2] ?? '', em: true }),
  },
]

/** The words as pieces. */
export function pieces(words: string): Piece[] {
  const out: Piece[] = []
  let rest = words
  while (rest) {
    let best: { at: number; length: number; piece: Piece } | null = null
    for (const form of FORMS) {
      const found = form.pattern.exec(rest)
      if (found && (best === null || found.index < best.at)) {
        best = { at: found.index, length: found[0].length, piece: form.make(found) }
      }
    }
    if (!best) {
      out.push({ text: rest })
      break
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at) })
    out.push(best.piece)
    rest = rest.slice(best.at + best.length)
  }
  return out
}

/** The words with every mark taken off, for a card's title and a search. */
export function plain(words: string): string {
  return pieces(words)
    .map((one) => one.text)
    .join('')
}
