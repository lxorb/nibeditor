/** The accent colours a person can pick, the way GNOME offers a row of them.
 *  Each carries its own shade per scheme, because a colour bright enough to
 *  read on black is usually too pale on white.
 *
 *  And each shade carries its scheme's `--accent-ink` at four and a half to one or
 *  better - the dark ink on every dark shade, white on every light one - so a button,
 *  a badge or a caret's name is readable whichever colour it was filled with. Teal,
 *  green and yellow were a step too light for white on the light side (3.44, 4.10
 *  and 4.48) and are a step darker. See test/ink.test.ts. */

import { t } from './i18n.svelte'
import type { ThemeSetting } from './themes/settings'

export interface Accent {
  id: string
  name: string
  dark: string
  light: string
}

/** The one every fallback lands on, named rather than reached for by index:
 *  the list is data, and `ACCENTS[0]` promises an order it does not have. */
const VIOLET: Accent = { id: 'violet', name: 'Violet', dark: '#7c6bf5', light: '#5b4be0' }

export const ACCENTS: Accent[] = [
  VIOLET,
  { id: 'blue', name: 'Blue', dark: '#3584e4', light: '#1c71d8' },
  { id: 'teal', name: 'Teal', dark: '#33c7ba', light: '#0d8277' },
  { id: 'green', name: 'Green', dark: '#3fcf8e', light: '#188556' },
  { id: 'yellow', name: 'Yellow', dark: '#e5b23c', light: '#9f6a07' },
  { id: 'orange', name: 'Orange', dark: '#f08437', light: '#c64600' },
  { id: 'red', name: 'Red', dark: '#f2555a', light: '#c01c28' },
  { id: 'pink', name: 'Pink', dark: '#e56ba8', light: '#c4287f' },
  { id: 'slate', name: 'Slate', dark: '#8aa0b8', light: '#5b6b7f' },
]

export const DEFAULT_ACCENT = VIOLET.id

function accentById(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? VIOLET
}

/** One accent as the shade this scheme needs. What a caret belonging to another
 *  device is drawn in: which colour is theirs, which shade of it is the reader's.
 *  See rooms/peers.ts. */
export function accentColour(id: string, scheme: 'dark' | 'light'): string {
  return accentById(id)[scheme]
}

/** The colour somebody wears where people are listed: the square with their
 *  initial in it in the Share sheet.
 *
 *  Derived from whatever names them rather than picked, which is the opposite of
 *  how a device chooses the colour of its caret (see rooms/who.ts). Two of one
 *  person's own machines have to end up different, so those are random and kept;
 *  two people looking at the same list have to agree, so this is a function of
 *  the name and nothing else - the same person is the same colour on every device,
 *  after every reload, without anybody having to store a thing. */
export function accentFor(name: string, scheme: 'dark' | 'light'): string {
  let sum = 0
  for (const character of name.trim().toLowerCase()) {
    sum = (sum + (character.codePointAt(0) ?? 0)) % 4093
  }

  return accentColour(ACCENTS[sum % ACCENTS.length]?.id ?? DEFAULT_ACCENT, scheme)
}

/** `#rrggbb` to its three channels. */
function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((one) => Math.round(one).toString(16).padStart(2, '0')).join('')}`
}

/** Moves a colour toward white or black, for the hover and the press shades. */
function shift(hex: string, towards: 'light' | 'dark', amount = 0.14): string {
  const target = towards === 'light' ? 255 : 0
  return toHex(
    channels(hex).map((one) => one + (target - one) * amount) as [number, number, number],
  )
}

/** Every token that depends on the accent, so one choice restyles the app.
 *
 *  These took a third answer once, for a contrast switch that pushed the colour
 *  further from the page. Contrast is a theme now, and a theme that states an
 *  accent keeps it - nothing here is painted over such a theme at all, see
 *  `paintsOver` in themes/settings.ts - so the push had nowhere left to land: the
 *  contrast theme's own accent is the one that wins, which is what a theme chosen
 *  from a picture of it is supposed to do. */
export function accentTokens(id: string, scheme: 'dark' | 'light'): Record<string, string> {
  const away = scheme === 'dark' ? 'light' : 'dark'
  const base = accentById(id)[scheme]
  const [r, g, b] = channels(base)
  const soft = scheme === 'dark' ? 0.15 : 0.1
  const line = scheme === 'dark' ? 0.42 : 0.38
  const chosen = scheme === 'dark' ? 0.28 : 0.18

  return {
    '--accent': base,
    // Hover moves away from the background, whichever way that is, and a press a
    // step further: away from the page is away from the ink too, so the words on a
    // filled button only get clearer as it is pressed.
    '--accent-hover': shift(base, away),
    '--accent-press': shift(base, away, 0.26),
    '--accent-soft': `rgb(${r} ${g} ${b} / ${soft})`,
    '--accent-line': `rgb(${r} ${g} ${b} / ${line})`,
    '--selection': `rgb(${r} ${g} ${b} / ${chosen})`,
  }
}

/** The accent as a theme setting: declared in code for its words and its six tokens,
 *  and shared, so it follows the reader across themes; see themes/settings.ts. */
export function accentSetting(): ThemeSetting {
  return {
    id: 'accent',
    label: t('Accent'),
    shared: true,
    kind: 'colour',
    initial: DEFAULT_ACCENT,
    options: ACCENTS.map((one) => ({
      value: one.id,
      name: t(one.name),
      dark: one.dark,
      light: one.light,
    })),
    paint: (value, scheme) => accentTokens(String(value), scheme),
  }
}
