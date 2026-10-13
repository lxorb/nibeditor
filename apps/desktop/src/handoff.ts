/** `handoff.html`: the old address hands what it holds to the new one, and closes.
 *
 *  It answers only at the old address and only to a page that opened it, and it
 *  addresses the message to the new address alone, so the browser delivers it there
 *  or nowhere: a page anywhere else that opened this learns nothing. Nothing else of
 *  the app is loaded, so nothing writes to this origin's storage before it is read.
 *  See lib/web/handoff.ts. */

import { LEGACY_WEB, pack, WEB } from './lib/web/handoff'

/** Long enough for the message to be on its way before the window goes. */
const LINGER = 200

const opener = window.opener as Window | null

if (opener && location.origin === LEGACY_WEB) {
  void pack()
    .then((handoff) => opener.postMessage(handoff, WEB))
    .finally(() => setTimeout(() => window.close(), LINGER))
}
