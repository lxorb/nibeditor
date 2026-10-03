/** Glass's own dials, said in code behind the theme's door (see `own` in
 *  theme.svelte.ts).
 *
 *  Windows Terminal is the role model for what is offered: which material, and how much
 *  of the window's colour lies over it, all the way to none of the desk at all. Arc's
 *  theme is the one for the colour: follow what is open, or one colour of the reader's.
 *  What glass adds is the floor: the Opacity dial's track is grey below the least wash
 *  the frame's words read on over the material, and the knob stops there; see tint.ts.
 *
 *  The material and the opacity are a desktop's: where the platform puts nothing behind
 *  the window - a Mac's opaque webview, Linux, a browser, a phone - glass is the frame
 *  taking its colour from what is open, and those rows would turn nothing. */

import { ACCENTS } from '../accents'
import { contentSetting } from '../content-setting'
import { t } from '../i18n.svelte'
import { isDesktop, platform } from '../tauri'
import { theme } from '../theme.svelte'
import type { ThemeSetting, ThemeValue } from '../themes/settings'
import { chrome } from './chrome.svelte'
import { DIALS, type Dials } from './tint'

/** The theme's id, which is also the drawer its dials are kept in. */
const GLASS = 'glass'

/** The fixed colour's own swatch for "the accent, whichever it is", first in the row. */
export const ACCENT_COLOUR = 'accent'

const MATERIALS = [
  { value: 'mica-alt', label: 'Mica Alt' },
  { value: 'mica', label: 'Mica' },
  { value: 'acrylic', label: 'Acrylic' },
  { value: 'clear', label: 'No blur' },
] as const

/** Whether there is a material to choose: Windows, today (see `hasMaterial` in
 *  theme.svelte.ts), or a window the root says stands on one. */
function hasMaterial(): boolean {
  return (isDesktop && platform() === 'windows') || chrome.material !== null
}

/** Glass's dials as they stand: what is tried, else what was kept - read off the kept
 *  drawer too, for a launch whose settings door has not opened yet - else nothing, which
 *  is where each starts. */
export function glassValues(): Record<string, ThemeValue> {
  const values: Record<string, ThemeValue> = {}
  for (const id of ['material', 'opacity', 'follow', 'tint', 'colour', 'tab', 'content']) {
    const said = theme.values[id] ?? theme.keptFor(GLASS, id)
    if (said !== undefined) values[id] = said
  }
  return values
}

/** Whether the frame is following what is open. */
function following(): boolean {
  return glassValues().follow !== false
}

export function glassSettings(): ThemeSetting[] {
  const material = hasMaterial()
  return [
    ...(material
      ? ([
          {
            id: 'material',
            label: t('Material'),
            own: true,
            reapplies: true,
            kind: 'choice',
            options: MATERIALS.map((one) => ({ value: one.value, label: t(one.label) })),
            initial: 'mica-alt',
            paint: () => ({}),
          },
          {
            id: 'opacity',
            label: t('Opacity'),
            own: true,
            kind: 'range',
            min: 0,
            max: 100,
            step: 1,
            unit: '%',
            initial: Math.round(DIALS.opacity * 100),
            least: () => Math.ceil(chrome.floor * 100),
            paint: () => ({}),
          },
        ] satisfies ThemeSetting[])
      : []),
    {
      id: 'follow',
      label: t('Follow the page'),
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    {
      id: 'tint',
      label: t('Tint'),
      own: true,
      kind: 'range',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      initial: Math.round(DIALS.strength * 100),
      paint: () => ({}),
    },
    {
      id: 'colour',
      label: t('Tint colour'),
      own: true,
      kind: 'colour',
      initial: ACCENT_COLOUR,
      options: [
        { value: ACCENT_COLOUR, name: t('Accent'), dark: 'var(--accent)', light: 'var(--accent)' },
        ...ACCENTS.map((one) => ({
          value: one.id,
          name: t(one.name),
          dark: one.dark,
          light: one.light,
        })),
      ],
      when: () => !following(),
      paint: () => ({}),
    },
    {
      id: 'tab',
      label: t('Coloured tab'),
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    ...(material ? [contentSetting()] : []),
  ]
}

/** The dials tint.ts works the frame out with, out of the settings' values. */
export function dialsOf(values: Record<string, ThemeValue>): Dials {
  const percent = (value: ThemeValue | undefined, initial: number) =>
    Math.min(1, Math.max(0, (typeof value === 'number' ? value : initial * 100) / 100))
  return {
    opacity: percent(values.opacity, DIALS.opacity),
    strength: percent(values.tint, DIALS.strength),
  }
}
