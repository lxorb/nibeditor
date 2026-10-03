/** The keys a page let go by, and what each asks of the tab: its find, a step through
 *  it, its address field, or a modifier tapped twice.
 *
 *  Chrome gives Ctrl+F, Ctrl+G, F3, Ctrl+L and Alt+D to the page first and answers them
 *  only when nothing in the page took the key, so a site with a find or a Ctrl+L of its
 *  own keeps it. A line of script in the page asks when the key went by, and the crate
 *  reads the ask into one of eight words for the tab it came from (see web_opens.rs).
 *  They are read here too, so nothing a page says reaches anything but its own tab's
 *  find and address field, and the one key that works everywhere: Shift twice, which
 *  opens the palette over the page, as it does over a note. The page keeps its own
 *  Shift, and one it answered itself does not count; see double-tap.ts. */

import type { Modifier } from '../double-tap'
import { isRecord } from '../stored'
import { heard } from '../tapped'
import type { Page } from './pages.svelte'
import { sought } from './seek'

/** A modifier tapped twice in a page, as the crate says it. */
const TAPS: Record<string, Modifier> = {
  'shift-shift': 'Shift',
  'ctrl-ctrl': 'Control',
  'alt-alt': 'Alt',
}

/** What a page's key asked for. */
export type Passed =
  'find' | 'next' | 'previous' | 'address' | 'shift-shift' | 'ctrl-ctrl' | 'alt-alt' | 'install'

/** A page's ask, as the crate says it. */
export interface Ask {
  tab: string
  key: Passed
}

const PASSED: readonly Passed[] = [
  'find',
  'next',
  'previous',
  'address',
  'shift-shift',
  'ctrl-ctrl',
  'alt-alt',
  'install',
]

export function readAsk(value: unknown): Ask | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const key = PASSED.find((one) => one === value.key)
  return key ? { tab: value.tab, key } : null
}

/** The last ask for a page's address field, which that page's bar answers by taking the
 *  keyboard. A new object every time, so the same page asked twice is asked twice. */
export const addressing = $state<{ asked: { page: Page } | null }>({ asked: null })

/** Answers one ask for the tab it came from. */
export function answer(tab: string, page: Page, key: Passed): void {
  const tapped = TAPS[key]
  if (tapped) heard(tapped)
  else if (key === 'address') addressing.asked = { page }
  else if (key === 'find' || key === 'next' || key === 'previous') sought(tab, page, key)
  // The store's own install button, pressed on an extension's page: nib installs it,
  // since neither engine installs from a store for a host. See extensions.svelte.ts.
  else if (key === 'install' && page.url)
    void import('./extensions.svelte').then(({ extensions }) => extensions.install(page.url ?? ''))
}
