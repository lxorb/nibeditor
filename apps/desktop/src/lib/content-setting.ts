/** The Content row both translucent themes offer: how far what is behind the frame
 *  reaches the surfaces somebody reads on. Three words, because the useful places are
 *  three - the paper as it was, the least paper the words allow, and halfway - and a
 *  dial between them would be a dial whose every other position meant nothing. What
 *  each level lays down is content-ground.ts. */

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
