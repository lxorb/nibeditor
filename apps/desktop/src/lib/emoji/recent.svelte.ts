/** What the emoji picker remembers on this device: the emoji last chosen, and the skin
 *  tone (docs/chats.md 3, #30 and #32).
 *
 *  The recent ones are what a row's hover bar offers before the picker, Slack's three,
 *  so a reaction somebody gives every day is one press. Before anything has been chosen
 *  they are the three every chat app starts with. About the person rather than any chat,
 *  so kept here and not in the account; see icon-recent.svelte.ts, which keeps the icon
 *  picker's the same way. */

import { isNumber, keep, stored, stringList } from '../stored'
import type { Tone } from './tones'

const RECENT_KEY = 'nib:emoji-recent'
const TONE_KEY = 'nib:emoji-tone'

/** One row of the picker. */
const MOST_RECENT = 16

const STARTERS = ['👍', '❤️', '😂']

function storedTone(): Tone {
  const said = stored(TONE_KEY)
  return isNumber(said) && Number.isInteger(said) && said >= 0 && said <= 5 ? (said as Tone) : 0
}

class EmojiRecent {
  list = $state<string[]>(stringList(stored(RECENT_KEY))?.slice(0, MOST_RECENT) ?? [])
  tone = $state<Tone>(storedTone())

  /** The first few, filled out with the starters where fewer have been chosen. */
  first(count: number): string[] {
    return [...new Set([...this.list, ...STARTERS])].slice(0, count)
  }

  add(emoji: string): void {
    this.list = [emoji, ...this.list.filter((one) => one !== emoji)].slice(0, MOST_RECENT)
    keep(RECENT_KEY, JSON.stringify(this.list))
  }

  setTone(tone: Tone): void {
    this.tone = tone
    keep(TONE_KEY, String(tone))
  }
}

export const emojiRecent = new EmojiRecent()
