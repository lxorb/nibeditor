/** The grammar a theme declares its own settings in, and reading one.
 *
 *  A declaration is a custom property under `--nib-setting-`, in whichever token
 *  block the theme wants it in:
 *
 *      :root {
 *        --nib-setting-blur: range "Blur" 0 40 20 px;
 *        --nib-setting-paper: switch "Frosted paper" off;
 *        --nib-setting-depth: choice "Depth" "Flat" 0 "Deep" 1;
 *        --nib-setting-glow: colour "Glow" "Violet" #7c6bf5 "Blue" #3584e4;
 *      }
 *
 *  The kind first, then the label, then whatever that kind is made of. Quotes round
 *  a label only where it has a space in it, the way a font family is written.
 *
 *  The names are found in the file and the values are read off the page, so a theme
 *  that states a setting once per scheme gets a different answer on each side - the
 *  cascade does that work, and nothing here has to understand a media query.
 *
 *  ── A door of its own ──
 *
 *  Behind a dynamic import, because the app's own tokens declare nothing and most
 *  themes declare nothing: a window that opens on the built-in theme should not
 *  have read a word of this, and the one that opens on a theme with a dial can
 *  afford the frame. See `wear` in theme.svelte.ts, `declares` in settings.ts, and
 *  the budget in test/weight.test.ts, which is what made this a file of its own.
 *
 *  ── Not trusted ──
 *
 *  A theme is somebody else's CSS. Every refusal below is a whole declaration
 *  refused: a spec half of which parsed would be a control the theme never
 *  described, and the theme's own file is the only thing that says what the app
 *  should draw. */

import { DECLARES, type ThemeSetting, WRITES } from './settings'

/** What a theme may ask for. A theme with more dials than this is a control
 *  panel, which is the thing a theme setting is not; the rest are bounds on how
 *  much of somebody else's file the app will read at all. */
const MOST_SETTINGS = 6
const MOST_OPTIONS = 12
const LONGEST_LABEL = 24

/** What an id may be: one word, the same shape a token is. */
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/

/** The units a range may carry, which are the ones a theme has any use for. A
 *  bare number is a range too - that is what a multiplier is - so the empty
 *  string is in the list. */
const UNITS = new Set(['', 'px', '%', 'rem', 'em', 'deg', 'ms', 's'])

/** A colour, written the way a stylesheet writes one. Deliberately only the two
 *  hex lengths: a swatch is painted with this and compared against the page for
 *  contrast, and every other notation is a second thing to parse for no colour
 *  that cannot be spelled this way. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** The pieces of a declaration: a quoted phrase is one piece however many spaces
 *  are in it, and everything else is split on whitespace.
 *
 *  Either quote, because CSS has both and nobody writing a stylesheet chooses
 *  which: prettier rewrites a theme's `"Tint"` to `'Tint'` on the way past, and
 *  a grammar that knew only one of them turned the app's own theme's labels into
 *  the word with its quotes still on.
 *
 *  Answers nothing where a quote is opened and never closed. The sheet has
 *  already been past `usableValue`, which refuses an odd number of either kind,
 *  but this also reads a built-in theme's own file and a declaration that cannot
 *  be read has to come back as one rather than as half of one. */
function pieces(spec: string): string[] | null {
  const found: string[] = []
  let at = 0

  while (at < spec.length) {
    const letter = spec[at]

    if (letter === undefined || /\s/.test(letter)) {
      at++
      continue
    }

    if (letter === '"' || letter === "'") {
      const end = spec.indexOf(letter, at + 1)
      if (end < 0) return null

      found.push(spec.slice(at + 1, end))
      at = end + 1
      continue
    }

    const next = /\s/.exec(spec.slice(at))
    const end = next ? at + next.index : spec.length
    found.push(spec.slice(at, end))
    at = end
  }

  return found
}

/** A number, or nothing. `Number('')` is zero and `Number('12px')` is not a
 *  number, and a declaration has to be able to tell all three apart. */
function numberOf(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+(?:\.\d+)?$/.test(text)) return null
  return Number(text)
}

/** The label/value pairs a choice and a colour are lists of. */
function pairs(rest: string[]): [string, string][] | null {
  if (!rest.length || rest.length % 2 || rest.length / 2 > MOST_OPTIONS) return null

  const found: [string, string][] = []
  for (let at = 0; at < rest.length; at += 2) {
    const label = rest[at] ?? ''
    const value = rest[at + 1] ?? ''
    if (!label || label.length > LONGEST_LABEL || !value) return null

    found.push([label, value])
  }

  return found
}

/** What a setting writes, for the kinds a stylesheet can declare: one property,
 *  named after the setting. A theme that wants a second token writes it in its
 *  own CSS - `--accent: var(--nib-glow)` - which is a line of the language it is
 *  already writing in and nothing here has to trust. */
function writes(id: string, value: string): Record<string, string> {
  return { [`${WRITES}${id}`]: value }
}

/** How far one press of an arrow key moves a range.
 *
 *  Worked out rather than declared, because a theme author has no business
 *  choosing it and every one of them would choose a different number: the power
 *  of ten at or below a twentieth of the range, never coarser than one. So 0 to
 *  40 moves by a whole pixel, 0 to 100 by a whole per cent, and 0 to 1 by a
 *  hundredth - and no dial anywhere in the app ever reads 0.4 or 0.013. */
function step(min: number, max: number): number {
  return Math.min(1, 10 ** Math.floor(Math.log10((max - min) / 20)))
}

/** One declaration, read. Null for anything this does not recognise. */
export function settingOf(id: string, spec: string): ThemeSetting | null {
  if (!ID.test(id)) return null

  const words = pieces(spec.trim())
  if (!words) return null

  const [kind, label, ...rest] = words
  if (!label || label.length > LONGEST_LABEL) return null

  if (kind === 'range') {
    const [min, max, initial, unit = ''] = rest
    const low = numberOf(min)
    const high = numberOf(max)
    const start = numberOf(initial)

    if (low === null || high === null || start === null) return null
    if (rest.length > 4 || low >= high || start < low || start > high) return null
    if (!UNITS.has(unit)) return null

    return {
      id,
      label,
      kind: 'range',
      min: low,
      max: high,
      step: step(low, high),
      unit,
      initial: start,
      paint: (value) => writes(id, `${String(value)}${unit}`),
    }
  }

  if (kind === 'switch') {
    if (rest.length !== 1 || (rest[0] !== 'on' && rest[0] !== 'off')) return null

    // One and zero rather than two words, because a number is the one thing CSS
    // can do arithmetic with: `calc(var(--nib-paper) * 20px)` is a theme turning
    // a switch into a length without the app knowing what the length is for.
    return {
      id,
      label,
      kind: 'switch',
      initial: rest[0] === 'on',
      paint: (value) => writes(id, value === true ? '1' : '0'),
    }
  }

  if (kind === 'choice') {
    const listed = pairs(rest)
    if (!listed) return null

    return {
      id,
      label,
      kind: 'choice',
      options: listed.map(([name, value]) => ({ value, label: name })),
      // The first, because a list has to start somewhere and the author wrote
      // theirs in the order they meant.
      initial: listed[0]?.[1] ?? '',
      paint: (value) => writes(id, String(value)),
    }
  }

  if (kind === 'colour') {
    const listed = pairs(rest)
    if (!listed?.every(([, hex]) => HEX.test(hex))) return null

    return {
      id,
      label,
      kind: 'colour',
      options: listed.map(([name, hex]) => ({ value: hex, name, dark: hex, light: hex })),
      initial: listed[0]?.[1] ?? '',
      paint: (value) => writes(id, String(value)),
    }
  }

  return null
}

/** What the page says a custom property resolves to, which is how a theme's own
 *  declarations are read: the cascade has already answered the scheme, the media
 *  queries and whatever else the author wrote round them. Nothing where there is no
 *  page to ask, which reads as a theme that declared nothing. */
export function readProperty(property: string): string {
  if (typeof getComputedStyle !== 'function') return ''

  try {
    return getComputedStyle(document.documentElement).getPropertyValue(property)
  } catch {
    return ''
  }
}

/** Which settings a stylesheet declares, by name. Read off the text, because the
 *  page can only be asked about a property somebody names; the values come from
 *  the page. */
function namesIn(css: string): string[] {
  const found = new Set<string>()
  for (const [, id] of css.matchAll(/--nib-setting-([a-z0-9-]+)\s*:/gi)) {
    if (id) found.add(id.toLowerCase())
  }

  return [...found]
}

/** What a theme declares: the names out of its stylesheet, the values off the
 *  page. `read` is the root element's computed style, which is why a theme that
 *  states a setting once per scheme is answered per scheme.
 *
 *  Capped, in the order the file wrote them: a theme with seven dials gets six,
 *  and which six is the theme's own doing rather than a hash's. */
export function declaredIn(css: string, read: (property: string) => string): ThemeSetting[] {
  const found: ThemeSetting[] = []

  for (const id of namesIn(css)) {
    if (found.length >= MOST_SETTINGS) break

    const setting = settingOf(id, read(`${DECLARES}${id}`))
    if (setting) found.push(setting)
  }

  return found
}
