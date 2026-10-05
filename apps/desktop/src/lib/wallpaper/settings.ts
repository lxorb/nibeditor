/** The wallpaper's dials, said in code behind the theme's door (see `own` in
 *  theme.svelte.ts): more than a theme file may declare, and two of them - the tint's
 *  colour, which is the accent's until another is picked, and what a dial's floor is -
 *  are not something a stylesheet can say.
 *
 *  Windows Terminal's background image is the role model for what is offered (fit,
 *  alignment, opacity) and Arc's theme for how little is said about it (a colour, its
 *  strength, a grain). What nib adds is that none of them can make the frame unreadable:
 *  every floor is worked out from the picture under the dials; see look.ts. */

import { t } from '../i18n.svelte'
import type { ThemeSetting, ThemeValue } from '../themes/settings'
import { theme } from '../theme.svelte'
import {
  ACCENT_SWATCH,
  contentOf,
  contentSetting,
  rangeSetting as range,
  tintColourSetting,
} from '../translucent-settings'
import { type Dials, type Fit, FITS } from './look'

const FIT_NAMES: Record<Fit, string> = {
  fill: 'Fill',
  fit: 'Fit',
  tile: 'Tile',
  centre: 'Centre',
}

export function wallpaperSettings(): ThemeSetting[] {
  return [
    range('blur', t('Blur'), 0, 60, 28, 'px'),
    {
      ...range('dim', t('Dim'), 0, 90, 10, '%'),
      paint: (value) => ({ '--nib-dim': `${String(value)}%` }),
    },
    range('saturation', t('Saturation'), 0, 200, 100, '%'),
    range('tint', t('Tint'), 0, 100, 0, '%'),
    tintColourSetting('tint-colour', () => Number(theme.values.tint ?? 0) > 0),
    range('grain', t('Grain'), 0, 100, 0, '%'),
    {
      id: 'fit',
      label: t('Fit'),
      own: true,
      kind: 'choice',
      options: FITS.map((value) => ({ value, label: t(FIT_NAMES[value]) })),
      initial: 'fill',
      paint: () => ({}),
    },
    {
      id: 'empty',
      label: t('Empty panes'),
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    contentSetting(),
  ]
}

function isFit(value: unknown): value is Fit {
  return FITS.includes(value as Fit)
}

/** The dials the sheet depends on, out of the settings' values. */
export function dialsOf(values: Record<string, ThemeValue>): Dials {
  return {
    blur: Number(values.blur ?? 28),
    dim: Number(values.dim ?? 10),
    grain: Number(values.grain ?? 0),
    fit: isFit(values.fit) ? values.fit : 'fill',
    empty: values.empty !== false,
    content: contentOf(values.content),
  }
}

/** What is baked into the picture besides the blur: its saturation and a tint toward a
 *  colour, as the three numbers the canvas needs. */
export interface Tone {
  saturation: number
  tint: number
  colour: string
}

export function toneOf(values: Record<string, ThemeValue>, accent: string): Tone {
  const chosen = String(values['tint-colour'] ?? ACCENT_SWATCH)
  return {
    saturation: Number(values.saturation ?? 100) / 100,
    tint: Number(values.tint ?? 0) / 100,
    colour: chosen === ACCENT_SWATCH ? accent : chosen,
  }
}
