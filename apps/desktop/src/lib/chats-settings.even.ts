import type * as Real from './chats-settings'

/** The plugin's twin of chats-settings.ts: the glasses have no chats, so Settings has no
 *  group for them, and nothing of the chats comes into the package. */
export const chatsGroups: typeof Real.chatsGroups = () => []
