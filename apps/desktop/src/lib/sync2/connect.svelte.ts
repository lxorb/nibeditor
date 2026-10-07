/** What sync v2 starts once the first paint is on screen: the socket to the account's
 *  hub, for anybody signed in, and web logins that travel, where the account says so.
 *
 *  Nothing of this is in front of the first paint (docs/sync-v2.md 9.3): start.ts
 *  fetches it at the launch's `rooms` turn, beside the sockets the open notes join.
 *
 *  The account's `webSync` switch arrives with `/v1/me`, which a launch answers after the
 *  window is drawn and pages may already be on their way. So the last answer is kept on
 *  this device and a launch goes by it until the account has spoken, which is what lets
 *  a page restored at launch wait for its login rather than run on another computer's.
 *  A web login is a desktop's alone: a phone and a browser have no web tabs. */

import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { keep, storedText } from '../stored'
import { isDesktop } from '../tauri'
import { startHere } from '../people/here'
import { hub } from './hub.svelte'

/** The last thing the account said about its switch. */
const WEB_SYNC = 'nib:web-sync'

let connected = false

/** Whether web logins travel on this device: what the account said, or, while it has
 *  not said yet this launch, what it said last time, for as long as there is a session. */
export function travels(
  user: { webSync?: boolean } | null,
  token: string | null,
  remembered: string | null,
): boolean {
  if (user) return user.webSync === true
  return token !== null && remembered === 'on'
}

/** Starts the hub, whether somebody is at this device (people/here.ts), and web logins
 *  where they travel. Once. */
export function connect(): void {
  if (connected) return
  connected = true
  hub.start()
  startHere()
  if (!isDesktop) return

  $effect.root(() => {
    $effect(() => {
      const user = account.user
      const token = account.token
      untrack(() => {
        if (user) keep(WEB_SYNC, user.webSync === true ? 'on' : 'off')
        if (travels(user, token, storedText(WEB_SYNC)))
          void import('../web-tab/web-sync.svelte').then((one) => one.startWebSync())
      })
    })
  })
}
