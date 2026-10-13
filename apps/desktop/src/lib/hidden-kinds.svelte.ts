/** The kinds of tab a reader turned off in Settings › Note types, which nothing then
 *  offers to make. Which kinds there are, and what turning one off means, is
 *  kinds-here.ts.
 *
 *  On the account beside the shortcuts and the phone's bar, by the same rule: the last
 *  machine to change it wins, and a list that is the default is stored as nothing, so a
 *  kind added later reaches everybody who never chose. A list of the kinds turned off
 *  rather than of the ones on, for the same reason - a new kind arrives offered. */

import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { hiddenOf, type KindName, kindsHere, mayHide, shownOf } from './kinds-here'
import { forget, keep, stored } from './stored'

const STORAGE_KEY = 'nib:hidden-kinds'

class HiddenKinds {
  /** The kinds turned off, words this version does not know included; see `hiddenOf`. */
  hidden = $state<readonly string[]>([])

  /** The kinds offered on this device, in order. */
  get shown(): KindName[] {
    return shownOf(kindsHere(), this.hidden)
  }

  /** Whether anything should offer to make one of `kind`. */
  offers(kind: KindName): boolean {
    return this.shown.includes(kind)
  }

  /** Whether a kind's switch can be turned off now, which the last one offered
   *  cannot. */
  mayHide(kind: KindName): boolean {
    return mayHide(kind, kindsHere(), this.hidden)
  }

  restore() {
    this.hidden = hiddenOf(stored(STORAGE_KEY))
  }

  /** One kind on or off. Off is refused for the last kind offered. */
  set(kind: KindName, on: boolean) {
    if (on === !this.hidden.includes(kind)) return
    if (!on && !this.mayHide(kind)) return

    this.hidden = on ? this.hidden.filter((one) => one !== kind) : [...this.hidden, kind]
    this.settle()
    this.share()
  }

  /** Takes over the account's list; see the header. An account that has never been
   *  told takes this machine's, so a choice made before signing in follows it in. */
  receive(remote: AccountSettings) {
    const theirs = remote.hiddenKinds
    if (theirs === undefined) {
      if (this.hidden.length) this.share()
      return
    }

    const taken = hiddenOf(theirs)
    if (taken.join('\0') === this.hidden.join('\0')) return

    this.hidden = taken
    this.settle()
  }

  /** Through `keep`, the one place that writes; see stored.ts. */
  private settle() {
    if (this.hidden.length) keep(STORAGE_KEY, JSON.stringify(this.hidden))
    else forget(STORAGE_KEY)
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    // Null says "every kind", which has to travel: without it another machine could
    // never learn that this one turned the last of them back on.
    const hiddenKinds = this.hidden.length ? [...this.hidden] : null
    void api.saveSettings(token, { hiddenKinds }).catch(() => undefined)
  }
}

export const hiddenKinds = new HiddenKinds()
