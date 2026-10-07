/** The emoji a chat's picker offers, and how it finds them (docs/chats.md 3, #32).
 *
 *  Not a second index: the icon picker already ships the whole Unicode set with the
 *  names and keywords that make it findable (icon-sets.ts), from the app's own build and
 *  never from a CDN, and fetched the first time it is asked for. A reaction is the same
 *  question asked of the same list, so this reads that set and adds the one fact the
 *  icon picker has no use for: which emoji take a skin tone. Both arrive with the first
 *  picker opened, never in front of the first paint. */

import { door } from '@nib/markdown/door'
import { setNamed, tonedEmoji } from '../icon-sets'
import { EMOJI_SET, type IconEntry, rankIcons } from '../icons'

export interface EmojiData {
  entries: IconEntry[]
  /** Unicode's nine groups in its own order, each the emoji in it. */
  groups: { label: string; emojis: string[] }[]
  /** The emoji a skin tone applies to. */
  toned: ReadonlySet<string>
}

/** Everything the picker draws, fetched once however often it opens. */
export const emojiData: () => Promise<EmojiData> = door(async () => {
  const set = setNamed(EMOJI_SET)
  if (!set) throw new Error('no emoji set')
  const [loaded, toned] = await Promise.all([set.load(), tonedEmoji()])
  return {
    entries: loaded.entries,
    groups: loaded.groups.map((group) => ({ label: group.label, emojis: group.names })),
    toned,
  }
})

/** The emoji a query finds, best first: the icon picker's ranking, names before
 *  keywords. */
export function findEmoji(data: EmojiData, query: string): string[] {
  return rankIcons(data.entries, query, 96)
}
