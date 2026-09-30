/** A theme as the handful of colours its card in the picker is drawn in.
 *
 *  A card is nib in small - the title bar, the list with the open note in it, a
 *  note - and it has to show *that* theme whatever the window is wearing. So it
 *  cannot be painted by the page's stylesheets: those answer for the window's own
 *  theme on every element that carries the scheme attribute, which is how a card
 *  for the built-in came out in high contrast while high contrast was on. It is
 *  painted inline instead, from colours worked out here out of the sheets' own
 *  text: the app's tokens, then the theme's, then custom.css, in the order the
 *  page applies them and by the rules it applies them by.
 *
 *  Pure, so it is tested without a page; see looks.test.ts. */

import type { Scheme } from '../theme.svelte'
import { rules } from '../themes/sample'
import { declarationsOf } from '../themes/validate'

/** What a card draws. Each is read off the token the app itself reads for that
 *  part of the window, so a theme that restates one part moves the same part of
 *  its card; see `lookOf`. */
export interface Look {
  /** The note, and the window under everything. */
  ground: string
  /** The list down the side. */
  side: string
  /** The title bar the tabs sit in. */
  frame: string
  text: string
  muted: string
  line: string
  accent: string
  /** The open note's row in the list. */
  open: string
}

/** One custom property as a sheet states it, with what decides whether it wins. */
interface Stated {
  name: string
  value: string
  /** The body's own outrank whatever the root hands down, whatever either says. */
  body: boolean
  important: boolean
  /** How specific the selector was, in the one currency these selectors use. */
  weight: number
  /** The scheme the rule is for, or null for both. */
  scheme: Scheme | null
}

/** Which element a selector is about and how specific it is, for the handful of
 *  shapes a theme puts tokens under. Anything else - a prose rule, a media width,
 *  a descendant - says nothing about the window's own colours and is null. */
function aimOf(selector: string): { body: boolean; weight: number; scheme: Scheme | null } | null {
  const bare = selector.replace(/['"\s]/g, '').toLowerCase()
  if (bare === 'body') return { body: true, weight: 1, scheme: null }

  const found = /^(:root|html)?(?:\[data-theme=(dark|light)\])?$/.exec(bare)
  if (!found || bare === '') return null

  const [, root, scheme] = found
  const weight = (root === ':root' ? 10 : root === 'html' ? 1 : 0) + (scheme ? 10 : 0)
  return { body: false, weight, scheme: scheme === 'dark' || scheme === 'light' ? scheme : null }
}

/** Every custom property a sheet states for the window, in the order it states
 *  them. Held per sheet, because the app's tokens are read for every card. */
const read = new Map<string, Stated[]>()

function statedIn(sheet: string): Stated[] {
  const held = read.get(sheet)
  if (held) return held

  const found: Stated[] = []
  for (const rule of rules(sheet)) {
    const aims = rule.prelude.split(',').map(aimOf)

    for (const [name, written] of declarationsOf(rule.body)) {
      if (!name.startsWith('--')) continue

      const important = /!\s*important\s*$/i.test(written)
      const value = written.replace(/!\s*important\s*$/i, '').trim()
      for (const aim of aims) if (aim) found.push({ name, value, important, ...aim })
    }
  }

  read.set(sheet, found)
  return found
}

/** Where the `var(` that starts at `from` closes, and the comma splitting its name
 *  from its fallback, counting the parentheses in between. */
function argumentsOf(value: string, from: number): { end: number; comma: number } {
  let depth = 0
  let comma = -1

  for (let at = from; at < value.length; at++) {
    const letter = value[at]
    if (letter === '(') depth++
    else if (letter === ')' && --depth === 0) return { end: at, comma }
    else if (letter === ',' && depth === 1 && comma < 0) comma = at
  }

  return { end: value.length, comma }
}

/** A value with every `var()` in it replaced by what it names, the way the browser
 *  substitutes one: the name if it is set, else the fallback, else the whole value
 *  is invalid, which is null. Ten names deep at most, which is also what ends a
 *  cycle. */
function substituted(value: string, known: Map<string, string>, depth = 0): string | null {
  const start = value.indexOf('var(')
  if (start < 0) return value
  if (depth > 10) return null

  const { end, comma } = argumentsOf(value, start + 3)
  const name = value.slice(start + 4, comma < 0 ? end : comma).trim()
  const fallback = comma < 0 ? null : value.slice(comma + 1, end).trim()
  const named = known.get(name)

  const inner =
    named !== undefined
      ? substituted(named, known, depth + 1)
      : fallback === null
        ? null
        : substituted(fallback, known, depth + 1)
  // The rest of the value at the same depth: a `color-mix()` of two tokens is two
  // substitutions side by side, not one inside the other.
  const rest = substituted(value.slice(end + 1), known, depth)
  if (inner === null || rest === null) return null

  return `${value.slice(0, start)}${inner}${rest}`
}

/** The winner for each name on one element: the last of the strongest. */
function winners(stated: Stated[]): Map<string, string> {
  const rank = (one: Stated) => (one.important ? 1000 : 0) + one.weight
  const best = new Map<string, Stated>()

  for (const one of stated) {
    const held = best.get(one.name)
    if (!held || rank(one) >= rank(held)) best.set(one.name, one)
  }

  return new Map([...best].map(([name, one]) => [name, one.value]))
}

/** Every value on one element, with the `var()`s in it worked out against that
 *  same element's own values, which is where the browser works them out. */
function resolved(own: Map<string, string>, inherited = new Map<string, string>()) {
  const known = new Map([...inherited, ...own])
  const out = new Map(inherited)

  for (const [name, value] of own) {
    const one = substituted(value, known)
    if (one === null) out.delete(name)
    else out.set(name, one)
  }

  return out
}

/** The colours a card draws `scheme` in, out of `sheets` in the order the page has
 *  them, with `inline` standing for what the app writes onto the root element
 *  itself: the reader's accent, which outranks every sheet short of `!important`. */
export function lookOf(
  sheets: readonly string[],
  scheme: Scheme,
  inline: Readonly<Record<string, string>> = {},
): Look {
  const stated = sheets
    .flatMap(statedIn)
    .filter((one) => one.scheme === null || one.scheme === scheme)
  const written = Object.entries(inline).map(([name, value]): Stated => ({
    name,
    value,
    body: false,
    important: false,
    weight: 100,
    scheme: null,
  }))

  const root = resolved(winners([...stated.filter((one) => !one.body), ...written]))
  const body = resolved(winners(stated.filter((one) => one.body)), root)

  const token = (name: string) => body.get(name) ?? ''

  return {
    ground: token('--bg'),
    side: token('--side-bar-bg-color'),
    frame: token('--tab-frame'),
    text: token('--text'),
    muted: token('--muted'),
    line: token('--line'),
    accent: token('--accent'),
    open: token('--surface-selected'),
  }
}
