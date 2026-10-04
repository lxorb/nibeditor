/** The rows both translucent themes offer, glass and wallpaper, written once.
 *
 *  Content: how far what is behind the frame reaches the surfaces somebody reads on.
 *  Three words, because the useful places are three - the paper as it was, the least
 *  paper the words allow, and halfway - and a dial between them would be a dial whose
 *  every other position meant nothing. What each level lays down is content-ground.ts.
 *
 *  And the two shapes each theme's own dials take: a range whose value is painted
 *  nowhere, because the frame or the picture is worked out again from it, and the tint's
 *  colour, the accent's until another is picked. */

import { ACCENTS } from './accents'
import { CONTENT_INITIAL, CONTENT_LEVELS, type ContentLevel } from './content-ground'
import { t } from './i18n.svelte'
import type { ThemeSetting } from './themes/settings'

const NAMES: Record<ContentLevel, string> = {
  opaque: 'Opaque',
  tinted: 'Tinted',
  clear: 'See-through',
}

export function contentSetting(): ThemeSetting {
  return {
    id: 'content',
    label: t('Content'),
    own: true,
    kind: 'choice',
    options: CONTENT_LEVELS.map((value) => ({ value, label: t(NAMES[value]) })),
    initial: CONTENT_INITIAL,
    paint: () => ({}),
  }
}

/** The level a value names, or where a reader starts. */
export function contentOf(value: unknown): ContentLevel {
  return CONTENT_LEVELS.find((one) => one === value) ?? CONTENT_INITIAL
}

/** A dial in per cent or pixels whose value is painted nowhere. */
export function rangeSetting(
  id: string,
  label: string,
  min: number,
  max: number,
  initial: number,
  unit: string,
): ThemeSetting & { kind: 'range' } {
  return {
    id,
    label,
    own: true,
    kind: 'range',
    min,
    max,
    step: 1,
    unit,
    initial,
    paint: () => ({}),
  }
}

/** The tint colour's own swatch for "the accent, whichever it is", first in the row. */
export const ACCENT_SWATCH = 'accent'

/** The Tint colour row: the accent, then every accent by name. */
export function tintColourSetting(id: string, when: () => boolean): ThemeSetting {
  return {
    id,
    label: t('Tint colour'),
    own: true,
    kind: 'colour',
    initial: ACCENT_SWATCH,
    options: [
      { value: ACCENT_SWATCH, name: t('Accent'), dark: 'var(--accent)', light: 'var(--accent)' },
      ...ACCENTS.map((one) => ({
        value: one.id,
        name: t(one.name),
        dark: one.dark,
        light: one.light,
      })),
    ],
    when,
    paint: () => ({}),
  }
}
