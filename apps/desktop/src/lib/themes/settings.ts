/** What a theme offers besides itself: its settings, where their answers are kept, and
 *  what they are worth.
 *
 *  The accent was the first, hard-wired into Appearance and hidden by hand under a
 *  theme with a colour of its own. So a theme declares what it offers and the app draws
 *  whatever it finds: a theme file in its own stylesheet, as a custom property under
 *  `--nib-setting-` (the grammar is declared.ts, behind a door of its own), and the app
 *  in code, for the words and the several tokens one choice may write (see
 *  `accentSetting` in accents.ts). A custom property, because a theme file goes through
 *  validate.ts, which keeps the token blocks and nothing else.
 *
 *  `--nib-setting-blur` is answered as `--nib-blur`, written onto the root element, so
 *  it outranks the sheet it came from; the sheet states its own default beside the
 *  declaration, so a theme looks as its author drew it before any dial is touched. */

import type { Scheme } from '../theme.svelte'

/** What a control gives back: a choice or a colour, a number, a switch. */
export type ThemeValue = string | number | boolean

/** One colour a `colour` setting offers, in the shade each scheme needs. */
interface Swatch {
  value: string
  name: string
  dark: string
  light: string
}

interface Common {
  /** What the value is filed under. */
  id: string
  /** What the row says, through `t()` where it is drawn. */
  label: string
  /** The app's own rather than a theme's: inherited by every theme that does not
   *  paint over it, and filed under the app, so it follows the reader across themes. */
  shared?: boolean
  /** Every custom property a value writes: the accent is six tokens, not one. */
  paint(value: ThemeValue, scheme: Scheme): Record<string, string>
}

export type ThemeSetting = Common &
  (
    | { kind: 'colour'; options: Swatch[]; initial: string }
    | { kind: 'choice'; options: { value: string; label: string }[]; initial: string }
    | { kind: 'range'; min: number; max: number; step: number; unit: string; initial: number }
    | { kind: 'switch'; initial: boolean }
  )

/** Every theme's answers in one entry: read once at launch, written on every turn. */
export const SETTINGS_KEY = 'nib:theme-settings'

/** Drawer (a theme's id, or `SHARED`), then setting id, then what was chosen. */
export type ChosenSettings = Record<string, Record<string, ThemeValue>>

/** The app's own drawer. No theme id can be a star. */
export const SHARED = '*'

/** Where a declaration is written, and where its answer is written back. */
export const DECLARES = '--nib-setting-'
export const WRITES = '--nib-'

/** Whether a sheet declares anything, which decides whether the grammar is fetched. */
export function declares(css: string): boolean {
  return css.includes(DECLARES)
}

/** What a setting holds, given whatever storage came back with: a number pulled into
 *  the range, and anything the setting cannot mean replaced by where it starts. */
export function valueOf(setting: ThemeSetting, held: unknown): ThemeValue {
  if (setting.kind === 'switch') return typeof held === 'boolean' ? held : setting.initial

  if (setting.kind === 'range') {
    if (typeof held !== 'number' || !Number.isFinite(held)) return setting.initial
    return Math.min(setting.max, Math.max(setting.min, held))
  }

  if (typeof held !== 'string') return setting.initial
  return setting.options.some((one) => one.value === held) ? held : setting.initial
}

/** Every custom property the settings write for the values in force, as one map, so
 *  the caller has one thing to take off again when the theme changes. */
export function paintOf(
  settings: ThemeSetting[],
  values: Record<string, ThemeValue>,
  scheme: Scheme,
): Record<string, string> {
  const painted: Record<string, string> = {}

  for (const setting of settings) {
    Object.assign(painted, setting.paint(valueOf(setting, values[setting.id]), scheme))
  }

  return painted
}

/** Whether a sheet paints an app setting's tokens itself, which withdraws the setting:
 *  a theme that states `--accent` was chosen from a picture of itself. Read off the
 *  sheet, not the page, which always has an `--accent`. A token said to `inherit` is
 *  kept rather than painted - glass keeps the reader's accent that way inside a part of
 *  the frame that wears the other scheme - so it withdraws nothing. */
export function paintsOver(css: string, setting: ThemeSetting): boolean {
  const tokens = Object.keys(setting.paint(setting.initial, 'dark'))
  return tokens.some((token) => new RegExp(`${token}\\s*:(?!\\s*inherit\\b)`).test(css))
}
