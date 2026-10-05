/** Each online terminal's machine as its tab's mark shows it, by the tab's id: written by
 *  the terminal as its socket hears the machine (terminal/sessions.svelte.ts), read by the
 *  mark (terminal/TerminalMark.svelte). Kept here rather than on the tab, so nothing of it
 *  is in front of the first paint. */

import { SvelteMap } from 'svelte/reactivity'
import type { Machine } from '../terminal/source'

export const marks = new SvelteMap<string, Machine | null>()
