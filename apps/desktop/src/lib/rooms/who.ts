/** What this device calls itself in a room, and the colour it wears there.
 *
 *  Both names travel and neither is the answer on its own. Two of one person's
 *  own machines want to be told apart by machine - "that is my phone" is the
 *  question two carets in one note raise, and "Emil" on both of them answers
 *  nothing - while two people in a shared space want to be told apart by person.
 *  Which it is depends on who else turns up, so it is decided by whoever is
 *  looking; see rooms/peers.ts.
 *
 *  The colour is the device's own and is kept, so the phone is the same colour
 *  every morning and two machines of the same make are still told apart. */

import { account } from '../account.svelte'
import { ACCENTS } from '../accents'
import { keep, storedText } from '../stored'
import { isNative, platform } from '../tauri'
import { browserName } from './browser'
import { appleHandheld } from '../device'

const KEY = 'nib:device-colour'

/** Which platform this is, as a person would name it. Proper nouns, so none of
 *  them is translated, and neither is the browser's own name. */
const NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  android: 'Android',
}

/** What to call this device. `browser` is the word to fall back on, which is
 *  what a browser nothing recognises is left with; a browser that says which one
 *  it is says so instead, since half a shared space is in one. */
export function deviceName(browser: string): string {
  if (!isNative) return browserName(navigator) ?? browser
  if (platform() === 'ios') return appleHandheld()

  return NAMES[platform()] ?? browser
}

/** Whoever is at this device, when there is anybody to name. The name on the
 *  account, or the one a guest was given by their device and may change: a guest
 *  a link let in is a person in the note like any other, and the caret beside
 *  the owner's has to say which person. Undefined while signed out, where there
 *  is nobody to name and the device is the whole answer. */
export function personName(): string | undefined {
  return account.name ?? undefined
}

/** And the face the others draw them by: the account, its small picture and its accent
 *  (docs/chats.md 4.9). Nothing while signed out or a guest, whose face is an initial. */
export function personFace(): {
  id?: string
  face?: string | undefined
  tint?: string | undefined
} {
  const user = account.user
  return user ? { id: user.id, face: user.avatar?.s, tint: user.accent ?? undefined } : {}
}

/** One of the accent colours, chosen once for this device and kept. Which one is
 *  random rather than derived from anything: two devices picking their own is how
 *  they end up different, and a name or an id would put every Windows machine on
 *  the same colour. */
export function deviceAccent(): string {
  const held = storedText(KEY)
  if (held && ACCENTS.some((accent) => accent.id === held)) return held

  const picked = ACCENTS[Math.floor(Math.random() * ACCENTS.length)]?.id ?? ACCENTS[0]?.id ?? ''
  keep(KEY, picked)
  return picked
}
