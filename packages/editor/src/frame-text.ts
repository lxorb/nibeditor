/** The frame script's characters, in a module of their own so that only a press
 *  pays for them.
 *
 *  Every sandboxed frame carries frame-script.js inline, and the app's policy
 *  allows it by the hash of exactly these characters (`FRAME_SCRIPT` in
 *  apps/desktop/src/csp.ts, held to the file by its test). Not a file the frame
 *  fetches: on Windows the app is served to its own window by intercepting requests
 *  to `http://tauri.localhost`, and a request from a frame with an opaque origin is
 *  not intercepted - it goes to the network, which refuses it. Measured in the
 *  packaged app: `net::ERR_CONNECTION_REFUSED`.
 *
 *  The runner imports this with the rest of itself, and a block of HTML asks for it
 *  on the press that opens one; the first paint carries neither. Null in a build
 *  that has none: the Even Realities plugin runs no JavaScript out of a note, so its
 *  build leaves the file out (apps/desktop/vite.even.config.ts), and there a block
 *  of a note's own HTML stays the card it is. */

import text from './frame-script.js?raw'

export const FRAME_SCRIPT: string | null = text || null
