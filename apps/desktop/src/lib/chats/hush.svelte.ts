/** What pings for every chat at once (docs/chats.md 4.11): the reader's keywords, the
 *  hours pings are let through, and whether a notification shows the words and makes a
 *  sound. Slack's notification preferences, in one place rather than four.
 *
 *  On the account, so a quiet evening is quiet on every device, and kept on this one so
 *  the first notification after a launch already knows; the account's answer wins when
 *  it arrives, as every other setting's does (modes.svelte.ts). What a chat of its own
 *  says - all, mentions or nothing, and a mute - is the chat's, `PUT /v2/chats/:id/me`;
 *  see notify.ts. */

import { type Hours, isHours, isKeywords } from '@nib/chats/notify'
import { account } from '../account.svelte'
import { api, type AccountSettings } from '../api'
import { isBoolean, isRecord, keep, stored } from '../stored'

const KEY = 'nib.chat-hush'

/** Monday to Friday, the days Slack's schedule offers first. */
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

/** Nine to six, where a schedule starts the first time it is turned on. */
export const WORKING_HOURS: Hours = { days: WEEKDAYS, from: 9 * 60, to: 18 * 60 }

class Hush {
  keywords = $state<string[]>([])
  /** Null for every hour. */
  hours = $state<Hours | null>(null)
  /** Who wrote and what, or only that something came: Signal's switch. */
  previews = $state(true)
  /** One quiet sound, off until asked for. */
  sound = $state(false)

  constructor() {
    const saved = stored(KEY)
    if (isRecord(saved)) this.took(saved)
  }

  /** The keywords from a line the reader typed, split at commas. */
  setKeywords(line: string) {
    const words = [
      ...new Set(
        line
          .split(',')
          .map((one) => one.trim())
          .filter(Boolean),
      ),
    ]
    if (!isKeywords(words) || words.join('\0') === this.keywords.join('\0')) return
    this.keywords = words
    this.changed({ chatKeywords: words })
  }

  setHours(hours: Hours | null) {
    if (hours !== null && !isHours(hours)) return
    this.hours = hours
    this.changed({ chatHours: hours })
  }

  setPreviews(on: boolean) {
    this.previews = on
    this.changed({ chatPreviews: on })
  }

  setSound(on: boolean) {
    this.sound = on
    this.changed({ chatSound: on })
  }

  /** Takes over what the account holds: the last device to choose wins. */
  receive(remote: AccountSettings) {
    this.took({
      keywords: remote.chatKeywords,
      hours: remote.chatHours,
      previews: remote.chatPreviews,
      sound: remote.chatSound,
    })
    this.persist()
  }

  /** Whatever of the four a value holds, each only where it reads. */
  private took(value: Record<string, unknown>) {
    if (isKeywords(value.keywords)) this.keywords = value.keywords
    if (value.hours === null || isHours(value.hours)) this.hours = value.hours
    if (isBoolean(value.previews)) this.previews = value.previews
    if (isBoolean(value.sound)) this.sound = value.sound
  }

  private changed(patch: AccountSettings) {
    this.persist()
    const token = account.accountToken
    // Signed out, it stays a choice of this device's until there is an account to tell.
    if (token) void api.saveSettings(token, patch).catch(() => undefined)
  }

  private persist() {
    keep(
      KEY,
      JSON.stringify({
        keywords: this.keywords,
        hours: this.hours,
        previews: this.previews,
        sound: this.sound,
      }),
    )
  }
}

export const hush = /* @__PURE__ */ new Hush()
