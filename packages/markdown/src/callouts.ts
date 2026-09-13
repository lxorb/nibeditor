/** What a callout is, in one place.
 *
 *  `> [!warning]- Mind the gap` is Obsidian's, and it is file content: the
 *  editor never rewrites it, every exporter carries it through, and a note
 *  written here opens the same way over there. So the grammar for it lives
 *  here and nowhere else. It used to live in four places - the renderer, the
 *  glasses, the editor's decorations and the exporters' document model - each
 *  with its own regular expression and its own list of kinds, and each list was
 *  a different length.
 *
 *  A marker line is a type, an optional fold sign, and an optional title:
 *
 *      > [!tip]                     the type on its own
 *      > [!tip] Watch the step      a title of the writer's own
 *      > [!tip]- Watch the step     folded to begin with
 *      > [!tip]+ Watch the step     open to begin with, and foldable
 *
 *  **A type nothing knows is still a callout.** It renders as one, carrying its
 *  own name in `data-callout`, so a theme can dress `[!recipe]` with a rule of
 *  its own and there is no registry anywhere to add it to first. That is
 *  Obsidian's "custom callout types via CSS" without the ceremony.
 *
 *  **Thirteen looks, and every other word an alias of one of them.** Thirteen is
 *  Obsidian's list, and the aliases are Obsidian's too - which is the whole of the
 *  reason both are exactly these. `important` and `caution` were the two that were
 *  not: nib had them as GitHub alert kinds before it had any of the others, so they
 *  kept looks and colours of their own, and an `[!important]` written here came out
 *  violet where Obsidian draws it green. A file that reads differently in the editor
 *  it was written for and in the one it travels to is a file this app got wrong, so
 *  they fold in with the rest: `important` wears `tip` and `caution` wears `warning`.
 *
 *  An alias resolves and the word survives, so `[!tldr]`, `[!summary]` and
 *  `[!important]` wear another look's icon and colour while still saying `tldr`,
 *  `summary` and `important` in `data-callout` - which is what lets a theme colour
 *  one of them differently again without a registry to add it to.
 *
 *  The icons are Lucide's; how one is drawn and how it is written out is
 *  icons.ts beside this. */

import type { IconNode } from 'lucide'
import Bug from 'lucide/dist/esm/icons/bug.mjs'
import Check from 'lucide/dist/esm/icons/check.mjs'
import CircleCheck from 'lucide/dist/esm/icons/circle-check.mjs'
import CircleQuestionMark from 'lucide/dist/esm/icons/circle-question-mark.mjs'
import ClipboardList from 'lucide/dist/esm/icons/clipboard-list.mjs'
import Flame from 'lucide/dist/esm/icons/flame.mjs'
import Info from 'lucide/dist/esm/icons/info.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import Quote from 'lucide/dist/esm/icons/quote.mjs'
import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
import X from 'lucide/dist/esm/icons/x.mjs'
import Zap from 'lucide/dist/esm/icons/zap.mjs'
import { CHEVRON, iconMarkup, type IconParts } from './icons'

/** Every look there is, and the icon it wears. The name is also the class the
 *  stylesheets colour it by - `.callout-warning` - and the only names those
 *  need to know, since an alias has resolved to one of these before any markup
 *  is written. */
const LOOKS: Record<string, IconNode> = {
  note: Pencil,
  abstract: ClipboardList,
  info: Info,
  todo: CircleCheck,
  tip: Flame,
  success: Check,
  question: CircleQuestionMark,
  warning: TriangleAlert,
  failure: X,
  danger: Zap,
  bug: Bug,
  example: List,
  quote: Quote,
}

/** The other words for those, Obsidian's own - all twelve of them, which is what
 *  makes a callout written in either app the same callout in both. */
const ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

/** Words that are not words. Title case would make these "Tldr" and "Faq". */
const SHOUTED = new Set(['tldr', 'faq'])

/** The marker line, in four parts: the marker itself with the space after it,
 *  the type, the fold sign, and whatever is left of the line. Four rather than
 *  three, so how much of the line the marker took is a length and not a sum
 *  that trimming can throw off. */
const MARKER = /^([ \t]*\[!([^\]\n]+)\]([-+])?[ \t]*)([^\n]*)/

/** A callout's opening line, read. */
export interface Callout {
  /** The type as the writer wrote it, lowercased. What a theme selects on, and
   *  what an unknown type carries so it can be styled without being registered
   *  anywhere. */
  type: string
  /** The look nib knows for that type, or null for one it has never heard of.
   *  An alias has already resolved: `tldr` answers `abstract`. */
  look: string | null
  /** What the title reads as when the writer wrote none: the type, as a word. */
  label: string
  /** The writer's own title, or the empty string. Plain words - a title is a
   *  name for the block, not a paragraph, so markdown inside one is not read. */
  title: string
  /** Whether a fold sign was written at all, and whether it was the `-` that
   *  says "start this folded". */
  foldable: boolean
  folded: boolean
  /** How much of the text the whole marker line took - the leading space, the
   *  brackets, the fold sign, the title and the line break after it - so
   *  anything reading the words rather than the source can cut exactly that
   *  much off the front and have the body. */
  taken: number
  /** What is left after that, which is the body. */
  rest: string
}

/** The callout a blockquote's first line opens, or nothing at all.
 *
 *  Given the quote's own text with the `>` marks already off it - which is what
 *  a token carries, and what the editor takes off itself. */
export function calloutOf(text: string): Callout | null {
  const found = MARKER.exec(text)
  if (!found) return null

  const type = (found[2] ?? '').trim().toLowerCase()
  if (!type) return null

  const sign = found[3]
  const title = (found[4] ?? '').trim()
  const after = text.slice(found[0].length)
  const body = after.startsWith('\n') ? after.slice(1) : after

  return {
    type,
    look: LOOKS[type] ? type : (ALIASES[type] ?? null),
    label: SHOUTED.has(type) ? type.toUpperCase() : type.charAt(0).toUpperCase() + type.slice(1),
    title,
    foldable: sign !== undefined,
    folded: sign === '-',
    taken: text.length - body.length,
    rest: body,
  }
}

/** The icon a look wears, as the elements it is drawn from, for anything
 *  building DOM rather than writing markup - the editor's callout widget.
 *  Nothing at all for a type nib has never heard of. */
export function calloutIconParts(look: string | null): IconParts | null {
  const node = look === null ? undefined : LOOKS[look]
  return node ?? null
}

/** A look's icon as markup.
 *
 *  Empty for a type nothing knows, which is what makes an unknown callout read
 *  as a plain one with its own name on it rather than as a broken known one. */
export function calloutIcon(look: string | null): string {
  const parts = calloutIconParts(look)
  return parts ? iconMarkup(parts, 'callout-icon') : ''
}

/** The mark a foldable callout carries beside its title: the same chevron the
 *  editor draws in the margin, turned by the stylesheet when it is open. */
export function calloutChevron(): string {
  return iconMarkup(CHEVRON, 'callout-fold')
}
