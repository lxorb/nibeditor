/** What the app does on the way up, and what it has to do before it goes down.
 *
 *  Every store restores itself; the order here is the one they depend on. It
 *  lives outside the root component because none of it is about markup, and
 *  because a launch that has to be read in order should be readable in one
 *  place. */

import { setBlocks } from '@nib/editor'
import { account } from './account.svelte'
import { installAiRunner } from './ai/ask'
import { blockRows } from './commands'
import { i18n } from './i18n.svelte'
import { joining } from './joining.svelte'
import { collectErrors, log } from './log'
import { onTheActivity } from './mobile/bridge'
import { modes } from './modes.svelte'
import { settleUp } from './parting'
import { warmDoors } from './surfaces.svelte'
import { recovery } from './recovery.svelte'
import { record } from './sync/record.svelte'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { currentWindow, invoke, isDesktop } from './tauri'
import { mark } from './trace'
import { theme } from './theme.svelte'
import { pull } from './pull.svelte'
import { toolbar } from './toolbar.svelte'
import { trash } from './trash.svelte'
import { installStaged, ready } from './updater'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { watch } from './watch.svelte'
import { workspace } from './workspace.svelte'

const DAY = 24 * 60 * 60 * 1000

/** Brings everything up. Answers the teardown for what it started, so the root
 *  component can hand it to `onDestroy`. */
export function start(): () => void {
  mark('start')
  collectErrors()
  viewport.start()
  i18n.restore()
  theme.init()
  modes.restore()
  shortcuts.restore()
  // What the phone's format bar holds, which is the reader's own list of the
  // same command ids the shortcuts are filed under; see toolbar.svelte.ts.
  toolbar.restore()
  // And which command a pull down past the top of a list runs.
  pull.restore()
  settings.restore()
  // The one glyph on an `ai` fence that asks a model, installed whether or not any
  // provider is set up: a press on a block in a note somebody was sent says where to
  // add one. What it installs is a stub that fetches the runner with the first press,
  // so the guarantee costs the launch one function; see ai/ask.ts. Which providers
  // there are is read by the store as it arrives, which is the same moment.
  installAiRunner()
  recovery.restore()
  // What the last passes did, and what is waiting to be settled; see
  // sync/record.svelte.ts. It goes with the session, because a clash holds the
  // other device's whole note and the session is what could read it.
  record.restore()
  account.forgetWithSession(() => record.forgetEverything())

  mark('stores restored')

  // A system that asks for more contrast is answered with the theme that answers it,
  // which the app ships with: chosen by the launch itself, with nothing to fetch. See
  // offerTheContrastTheme in theme.svelte.ts, which does the choosing and writes down
  // that it happened, once and never again.
  //
  // Appearance opens on the row it was chosen from, so nothing has silently changed
  // and putting it back is one press. Which is also where somebody would have gone
  // looking for it.
  if (theme.offerContrast) settings.show('appearance')

  // The blocks the editor's `/` menu offers, which are the app's rows rather
  // than a list the editor keeps: handed over as a function so the words follow
  // the language without anything having to hand them over again. See
  // packages/editor/src/slash.ts.
  setBlocks(blockRows)

  /** What the files handed over by a second launch are heard on, once there is
   *  something listening. Torn down with everything else. */
  let stopListening: (() => void) | null = null
  /** And the same for `nib://` links and the `nib` command, both of which act on a
   *  space and so cannot be listened for until there is one. */
  let stopAutomation: (() => void) | null = null

  /** And the phone's own three ways in: something another app shared, a quick
   *  settings tile, a widget row. See mobile/handed.ts. */
  let stopHanded: (() => void) | null = null

  void workspace
    .restore()
    .then(async () => {
      mark('space restored')
      stopListening = await openLaunchFiles()
      // The plugin is a page on a pair of glasses: nothing can hand it a link and
      // it has no socket, so the whole of automation is left out of that build
      // rather than guarded inside it. See vite.even.config.ts.
      if (!__EVEN_PLUGIN__) {
        const { startAutomation } = await import('./automation/start')
        stopAutomation = await startAutomation()
      }
      // After the space is open, because a share becomes a note in it, a widget
      // row names one, and the widget's own rows are read out of its file list.
      //
      // And only on the phone that can hand anything over: `onTheActivity` asks the
      // object MainActivity hangs on the page before the first script runs, so a
      // desktop and a browser answer no to it for ever and never fetch what a share
      // becomes - the import writer, the picture writer, the widget's rows. A capability
      // rather than a build, so one bundle still runs everywhere. See mobile/bridge.ts.
      if (onTheActivity()) {
        const { startHanded } = await import('./mobile/handed')
        stopHanded = startHanded()
      }
    })
    // Nothing else can put this right, and the strip is already showing
    // whatever did come back; the log is where a launch failure belongs, so it
    // is written there rather than dropped.
    .catch((error: unknown) => {
      log('error', `restore: ${error instanceof Error ? error.message : String(error)}`)
    })

  // Recently deleted on this device is swept at start and once a day after;
  // the account's is swept on the server.
  void trash.sweep()
  const sweeper = setInterval(() => void trash.sweep(), DAY)

  // The versions kept for recovery: one timer for the app that keeps whatever
  // is being written in, and a sweep on the same daily rhythm as the trash.
  const stopRecovery = recovery.start()

  // Files the reader opened from outside every space, which other programs write
  // too; see watch.svelte.ts.
  const stopWatching = watch.start()

  void guardClose()

  // A new version, now and every few hours after: an app somebody leaves open
  // for a month would otherwise only ever hear about one at launch.
  const stopLooking = updates.start()

  // The session first, because a link followed by somebody who is already
  // signed in walks straight through rather than asking for an address again.
  void account.restore().then(() => joining.start())

  // And last of all, the parts of the app that are fetched rather than carried and
  // that one keystroke can ask for: the find bar, the Search panel, the app menu's
  // rows, the reading view. Nothing waits for this and nothing is on screen for it;
  // it is the last turn of the launch order. See `warmDoors` in surfaces.svelte.ts.
  void warmDoors()

  return () => {
    clearInterval(sweeper)
    stopRecovery()
    stopWatching()
    stopLooking()
    stopListening?.()
    stopAutomation?.()
    stopHanded?.()
  }
}

/** Files named on the command line, and any handed over by a second launch.
 *  Answers how to stop listening for the second kind. */
async function openLaunchFiles(): Promise<(() => void) | null> {
  if (!isDesktop) return null

  for (const path of await invoke<string[]>('take_startup_files').catch(() => [])) {
    await workspace.open(path)
  }

  const { listen } = await import('@tauri-apps/api/event')
  return listen<string[]>('nib://open-files', (event) => void openAll(event.payload))
}

async function openAll(paths: string[]) {
  for (const path of paths) await workspace.open(path)
}

/** Nothing with words in it is lost on the way out: closing asks first. */
async function guardClose() {
  const window = await currentWindow()
  // The handler answers at once and the questions happen after: preventing the
  // close is the only part that has to be synchronous.
  await window.onCloseRequested((event) => void onClose(event, window))
}

interface Closing {
  preventDefault(): void
}

interface Closable {
  destroy(): Promise<void>
}

async function onClose(event: Closing, window: Closable) {
  // Whatever is waiting on a timer goes down now, before anything below can end the
  // window: a filter typed into the graph's card in the last breath is written once
  // the typing stops, and a plane's file once the drawing does. Both run off a timer
  // that a window going away would never reach, and a plane has to go first - it
  // writes into a document, and it is the unsaved documents that decide whether this
  // asks below. Whoever owes a write has said so themselves rather than being reached
  // for from here; see parting.ts.
  settleUp()
  workspace.graphSettings.flush()

  // A tab gets no chance to ask its own question - `beforeunload` runs to
  // completion before anything is painted. Preventing it is the whole
  // signal, and the browser puts up its own leave-page dialog.
  if (!isDesktop) {
    if (workspace.unsaved.length) event.preventDefault()
    return
  }

  // Nothing to ask about, but there may still be an update to put in place.
  if (!workspace.unsaved.length) {
    if (!ready()) return

    event.preventDefault()
    await installStaged()
    await window.destroy()
    return
  }

  event.preventDefault()

  // The same question a tab asks, once for each note that holds something: it is
  // the same decision, and a reader who has learned it on one note should not
  // meet a different sheet on the way out. Cancel at any of them leaves the
  // window where it is.
  if (!(await workspace.mayCloseWindow())) return

  // Everything is either written or deliberately given up on.
  await installStaged()
  await window.destroy()
}
