import type * as Real from './chats'
import { Refused } from './problem'

/** The plugin's twin of chats.ts. Chats are not on the glasses (docs/chats.md 4.19), so
 *  none of the chats' store is in the package, and an agent asking the phone about a
 *  chat is told there is none to read here. */
const absent = () => Promise.reject(new Refused('not_found', 'chats are not on this device'))

export const listChats: typeof Real.listChats = absent
export const readChat: typeof Real.readChat = absent
export const searchChats: typeof Real.searchChats = absent
export const draftMessage: typeof Real.draftMessage = absent
export const postMessage: typeof Real.postMessage = absent
export const react: typeof Real.react = absent
