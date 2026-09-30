import type { SchemeChoice } from './theme.svelte'

/** The three the controls offer, in the order they draw them. Following the
 *  system first, because it is where everybody starts.
 *
 *  Beside the store rather than in it: the store needs none of this to paint a
 *  window, and the pane, the palette and the picker are all fetched after one. */
export const SCHEME_CHOICES: SchemeChoice[] = ['system', 'dark', 'light']

/** What each is called. Named here rather than at a control, so every control that
 *  offers the choice says the same word. */
export const SCHEME_NAMES: Record<SchemeChoice, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
}
