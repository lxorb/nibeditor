/** A `#tag`, as a note writes one and a page draws one.
 *
 *  Obsidian's grammar, so a file means the same in either app: a hash opening a
 *  word, then a letter, then letters, digits, `-`, `_` and `/` - the slash nests
 *  `#work/nib` under `work`. The letter rules out `#42` and a heading's `# `, and
 *  the opened word rules out `C#` and an address's `#fragment`. The editor's parser,
 *  the renderer below and the `#` popup read it here; the index's twins are the
 *  app's search/tags.ts and the crate's tags.rs. */

import type { MarkedExtension, Token, Tokens } from 'marked'
import { attributeUrl, escapeAll } from './html'

export const TAG_NAME = String.raw`\p{L}[\p{L}\p{N}\-_/]*`

/** Read where the hash is, so a paragraph is never copied to look at one word. */
const NAME_AT = new RegExp(TAG_NAME, 'uy')

const HASH = '#'

/** Whether a hash after this character opens a word: nothing, a blank, a `(`. */
export function opensTag(before: string): boolean {
  return before === '' || before === '(' || /\s/u.test(before)
}

/** The name of the tag whose hash is at `at`, or null. The character before is the
 *  caller's to ask, through `opensTag`. */
export function tagNameAt(text: string, at: number): string | null {
  if (text.charAt(at) !== HASH) return null

  NAME_AT.lastIndex = at + 1
  return NAME_AT.exec(text)?.[0] ?? null
}

/** Where marked should stop a run of text for a tag. Marked hands this the text
 *  from its second character, so a hash at 0 is offered and the tokenizer asks the
 *  token before it. */
function nextTag(src: string): number | undefined {
  for (let at = src.indexOf(HASH); at !== -1; at = src.indexOf(HASH, at + 1)) {
    if ((at === 0 || opensTag(src.charAt(at - 1))) && tagNameAt(src, at) !== null) return at
  }

  return undefined
}

/** Where a pressed tag goes on this page, or null to leave it as words. */
export type TagHref = (tag: string) => string | null

/** `#work/nib`, drawn as a tag: a link where the surface says where one goes, and
 *  a `<span>` elsewhere, since a page that cannot go anywhere should not look as if
 *  it could. `tag` is the class Obsidian's pages and their themes already use.
 *
 *  Never in a link's words. At the start of a run there is no token before to ask,
 *  and a run opens a paragraph, heading, cell or item nearly always; so `**#tag**`
 *  is drawn here and left as words in the editor. The token carries its words as
 *  `text` for readers that never heard of a tag - a Word document, the glasses. */
export function hashtags(href?: TagHref): MarkedExtension {
  return {
    extensions: [
      {
        name: 'hashtag',
        level: 'inline',
        start: nextTag,
        tokenizer(src: string, tokens: Token[]) {
          if (this.lexer.state.inLink) return undefined
          if (!opensTag(tokens.at(-1)?.raw.slice(-1) ?? '')) return undefined

          const name = tagNameAt(src, 0)
          if (name === null) return undefined

          const raw = `${HASH}${name}`
          return { type: 'hashtag', raw, text: raw, name }
        },
        renderer(token: Tokens.Generic) {
          const name = String(token.name)
          const said = `data-tag="${escapeAll(name)}"`
          const shown = escapeAll(`${HASH}${name}`)
          const target = href?.(name) ?? null

          return target === null
            ? `<span class="tag" ${said}>${shown}</span>`
            : `<a class="tag" href="${attributeUrl(target)}" ${said}>${shown}</a>`
        },
      },
    ],
  }
}
