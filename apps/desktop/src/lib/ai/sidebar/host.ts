/** Which of the panel's two places a component is drawn in: the right side, or a tab of
 *  its own ("Open in new tab"). The same thread, the same field's words and the same
 *  popovers are both places' (chat.svelte.ts), so while both are on screen the keyboard
 *  and a popover go only to the one used last, `chat.host`, which each place claims as
 *  it is pressed or typed in. */

import { getContext, setContext } from 'svelte'
import type { Host } from './chat.svelte'

const KEY = Symbol('ai-host')

export function setHost(host: Host): void {
  setContext(KEY, host)
}

/** The place this component is drawn in; the right side where nothing said. */
export function hostHere(): Host {
  return getContext<Host | undefined>(KEY) ?? 'side'
}
