import type * as Real from './chats'

/** The plugin's twin of chats.ts: no chat is on the glasses (docs/chats.md 4.19), so
 *  `/catchup` and `/reply` find nothing and draft nothing, and the chats' store is not
 *  carried into the package for them. */
export const draftReply: typeof Real.draftReply = () => Promise.resolve(false)
export const reply: typeof Real.reply = () => Promise.resolve()
export const catchup: typeof Real.catchup = () => Promise.resolve()
