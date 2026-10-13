/** Turning a kind of tab on or off in Settings › Note types, and the account that
 *  carries the choice. What is turned off is `hiddenKinds` in settings.svelte.ts, which
 *  the first paint reads; this is fetched with Settings and with the account's
 *  settings.
 *
 *  On the account beside the phone's bar, by its rule: the last machine to change it
 *  wins, and the default - every kind - is stored as nothing. A list of the kinds off
 *  rather than on, so a kind added later arrives offered. */

import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { hiddenKinds, KINDS_KEY, type KindName, kindsHere, shownOf } from './settings.svelte'
import { forget, isString, keep } from './stored'

/** The account's own limits; see services/sync/src/settings.ts. */
const MOST_KINDS = 32
const KIND = /^[a-z][a-z-]{0,23}$/

/** A received list, cleaned. A word this version does not know is kept, so a kind a
 *  newer build turned off stays off when this one writes the list back. */
export function hiddenOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const words = value.filter((one): one is string => isString(one) && KIND.test(one))
  return [...new Set(words)].slice(0, MOST_KINDS)
}

/** Whether a kind may be turned off: it is offered, and not the last one that is. */
export function mayHide(kind: KindName, here: readonly KindName[], hidden: readonly string[]) {
  const shown = shownOf(here, hidden)
  return shown.includes(kind) && shown.length > 1
}

/** Whether `kind` is off by the reader's choice, rather than not on this device. */
export function turnedOff(kind: KindName): boolean {
  return hiddenKinds.hidden.includes(kind) && !hiddenKinds.offers(kind)
}

/** Whether the switch for `kind` is out of anybody's hands: the last one offered. */
export function locked(kind: KindName): boolean {
  return hiddenKinds.offers(kind) && !mayHide(kind, kindsHere(), hiddenKinds.hidden)
}

/** One kind on or off. Off is refused for the last kind offered. */
export function setKind(kind: KindName, on: boolean) {
  const hidden = hiddenKinds.hidden
  if (on === !hidden.includes(kind)) return
  if (!on && !mayHide(kind, kindsHere(), hidden)) return

  hiddenKinds.hidden = on ? hidden.filter((one) => one !== kind) : [...hidden, kind]
  settle()
  share()
}

/** Takes over the account's list. An account that has never been told takes this
 *  machine's, so a choice made before signing in follows it in. */
export function receive(remote: AccountSettings) {
  const theirs = remote.hiddenKinds
  if (theirs === undefined) {
    if (hiddenKinds.hidden.length) share()
    return
  }

  const taken = hiddenOf(theirs)
  if (taken.join('\0') === hiddenKinds.hidden.join('\0')) return

  hiddenKinds.hidden = taken
  settle()
}

/** Through `keep`, the one place that writes; see stored.ts. */
function settle() {
  const hidden = hiddenKinds.hidden
  if (hidden.length) keep(KINDS_KEY, JSON.stringify(hidden))
  else forget(KINDS_KEY)
}

function share() {
  const token = account.accountToken
  if (!token) return

  // Null says "every kind", which has to travel: without it another machine could
  // never learn that this one turned the last of them back on.
  const hidden = hiddenKinds.hidden
  const list = hidden.length ? [...hidden] : null
  void api.saveSettings(token, { hiddenKinds: list }).catch(() => undefined)
}
