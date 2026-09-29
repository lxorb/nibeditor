/** What this device calls itself, for the account to say where something came
 *  from.
 *
 *  Two things read it: a version kept on the account, which says which device
 *  wrote those words, and the sync log, which says which device a pass belongs
 *  to. Both are answering the same question - "was that me, or the laptop?" -
 *  and neither is worth a setting: what somebody wants to see there is the kind
 *  of machine, and the kind of machine is something the app can tell.
 *
 *  Kept once it has been worked out, so a phone that reports itself differently
 *  after an update does not become a second device in the list. */

import { keep, storedText } from './stored'
import { isMobile, isNative, platform } from './tauri'

const STORAGE_KEY = 'nib:device'

/** As long as the account keeps; see versions.ts. */
const LONGEST = 40

let held: string | null = null

/** An iPhone or an iPad, by the screen: an iPad's WebKit says it is a Mac, and the
 *  native build knows only that it is iOS. The same line the layout draws between a
 *  phone and a tablet (`PHONE_SIDE` in viewport.svelte.ts), on the screen's narrow
 *  side, so turning it round changes nothing. */
export function appleHandheld(): 'iPhone' | 'iPad' {
  const narrow = typeof screen === 'undefined' ? 0 : Math.min(screen.width, screen.height)
  return narrow > 500 ? 'iPad' : 'iPhone'
}

/** The words, from what the platform says and nothing else: no serial, no
 *  fingerprint, nothing that outlives this account's own storage. */
function worked(): string {
  // The native iOS build knows what it is, where its agent would call an iPad a Mac.
  if (isNative && platform() === 'ios') return appleHandheld()

  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent

  const system = /Windows/i.test(agent)
    ? 'Windows'
    : /Android/i.test(agent)
      ? 'Android'
      : /iPhone|iPad/i.test(agent)
        ? 'iOS'
        : /Mac OS X|Macintosh/i.test(agent)
          ? 'Mac'
          : /Linux/i.test(agent)
            ? 'Linux'
            : ''

  const shape = isNative ? (isMobile ? 'phone' : 'desktop') : 'browser'

  return [system, shape].filter(Boolean).join(' ').slice(0, LONGEST)
}

export function deviceName(): string {
  if (held !== null) return held

  // A browser with storage turned off still syncs; it just says less.
  const saved = storedText(STORAGE_KEY)
  if (saved) {
    held = saved.slice(0, LONGEST)
    return held
  }

  held = worked() || 'a device'
  // Nothing depends on this being kept: a device that cannot remember its name
  // works one out again, and it works out the same one.
  keep(STORAGE_KEY, held)

  return held
}
