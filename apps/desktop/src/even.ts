/** Nib as an Even Realities plugin.
 *
 *  The same app: the same components, the same stores, the same browser storage,
 *  the same sign-in and the same sync. One thing is added and nothing is taken
 *  away - a bridge that keeps the G2 showing whatever note is active here. See
 *  lib/even and docs/even.md.
 *
 *  A separate entry rather than a flag inside `main.ts` so that the plain web
 *  build carries none of it: nothing in `index.html` reaches this file, so the
 *  Even Hub SDK and the glasses renderer are in chunks the editor never asks
 *  for. */

// FIRST, and not to be moved: it marks the page as the plugin and puts the
// plugin's own storage in front of the page's. Every import below it builds a store
// that reads storage as it is built, and the page's own is empty in a packed
// plugin - which is what "I don't see the icons of the spaces" was. See
// lib/even/first.ts, which says it at length.
import { filling } from './lib/even/first'
import '@nib/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { account } from './lib/account.svelte'
import Glasses from './lib/even/Glasses.svelte'
import { bridge } from './lib/even/bridge.svelte'
import { everywhere, seedFlag } from './lib/even/keep'
import { recovery } from './lib/recovery.svelte'
import { rememberSeedIn } from './lib/seeded'
import { sync } from './lib/sync.svelte'
import { serveAssets } from './lib/web/asset-worker'
import { workspace } from './lib/workspace.svelte'

// The plugin's page keeps its notes and its pictures where the web app does, so it
// needs the same worker in front of them. See public/sw.js.
serveAssets()

const target = document.getElementById('app')
if (!target) throw new Error('even.html has no #app to mount into')

// The line the page paints before any of this ran. Its job is done: it is here
// to be seen when this file never gets to run at all.
document.getElementById('boot')?.remove()

// Before the app, because mounting it is what restores the session, and a packed
// plugin's page has no store it can count on. See lib/even/keep.ts.
account.alsoKeepIn(everywhere)

// The same reasoning for the same reason: whether this device has been given the
// welcome note is an answer that has to outlive a launch, and this page's own
// stores do not. The plugin never seeds at all, so this is the belt rather than
// the braces; see welcome.ts for what happened without either.
rememberSeedIn(seedFlag)

// A cookie holds what decides the first paint and the phone app's own store holds
// everything else, and the second of those answers seconds after the app was built.
// So everything read from storage while it was built is read again once it has
// landed. Each of these is a store whose key rides the host store alone; see the
// list in lib/even/local.ts.
//
// The syncing is the one that cost something. `nib:mirrors` is what it knows about
// every note it has seen, it is far too big for a cookie, and being dropped there
// read as "this account has never seen these notes".
void filling.then(() => {
  workspace.device.reread()
  workspace.folderIcons.reread()
  workspace.graphSettings.reread()
  workspace.excluded.reread()
  workspace.archivedFolders.reread()
  sync.reread()
  recovery.restore()
})

const app = mount(App, { target })
// After the app, so the workspace has restored its tabs before the glasses are
// asked what is active. The frame marks the region of the note that is on the
// panel; it is the only thing the plugin adds to the page.
const frame = mount(Glasses, { target })
bridge.start()

export default { app, frame }
