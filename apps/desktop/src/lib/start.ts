/** What the app does on the way up, and what it has to do before it goes down.
 *
 *  Every store restores itself; the order here is the one they depend on. It
 *  lives outside the root component because none of it is about markup, and
 *  because a launch that has to be read in order should be readable in one
 *  place. */

import { agentMarks, listenForAgents } from './agent-marks.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { installAiRunner } from './ai/ask'
import { guardDrops } from './drops'
import { i18n } from './i18n.svelte'
import { joining } from './joining.svelte'
import { collectErrors, log } from './log'
import { onTheActivity } from './mobile/bridge'
import { modes } from './modes.svelte'
import {
  anythingRuns,
  GIVE_UP,
  handBack,
  handingBack,
  settleUp,
  stillWriting,
  trayKeeper,
  written,
} from './parting'
import { warmDoors } from './surfaces.svelte'
import { recovery } from './recovery.svelte'
import { reloading } from './reloading.svelte'
import { record } from './sync/record.svelte'
import { settings } from './settings.svelte'
import { startup } from './startup.svelte'
import { shortcuts } from './shortcuts.svelte'
import { currentWindow, isDesktop, isMobile } from './tauri'
import { HANDS_BACK_WITHIN } from './backoff'
import { waited } from './timing'
import { factsOfLaunch, mark } from './trace'
import { theme } from './theme.svelte'
import { pull } from './pull.svelte'
import { toolbar } from './toolbar.svelte'
import { trash } from './trash.svelte'
import { installStaged, ready } from './updater'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

const DAY = 24 * 60 * 60 * 1000

/** Brings everything up. Answers the teardown for what it started, so the root
 *  component can hand it to `onDestroy`. */
export function start(): () => void {
  mark('start')
  collectErrors()
  // A frame the page could not draw for a second is written down with what ran in it,
  // from the launch's own frames on; set going once the launch is drawn. See stalls.ts.
  void startup.turn('doors').then(async () => (await import('./stalls')).watchStalls())
  // And what the launch opened, said beside its phases in the log's line about it.
  factsOfLaunch(() => `${workspace.spaces.length} spaces, ${workspace.tabs.length} tabs`)
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

  /** What `nib://` links, the `nib` command and the pages another program hands over
   *  are heard on: all three act on a space and so cannot be listened for until there
   *  is one. Torn down with everything else. */
  let stopAutomation: (() => void) | null = null

  /** And the phone's own three ways in: something another app shared, a quick
   *  settings tile, a widget row. See mobile/handed.ts. */
  let stopHanded: (() => void) | null = null

  /** And the agents' news; see agent-marks.svelte.ts. */
  let stopAgents: (() => void) | null = null

  void workspace
    .restore()
    .then(async () => {
      mark('space restored')
      // The plugin is a page on a pair of glasses: nothing can hand it a link and
      // it has no socket, so the whole of automation is left out of that build
      // rather than guarded inside it. See vite.even.config.ts.
      if (!__EVEN_PLUGIN__) {
        const { startAutomation } = await import('./automation/start')
        stopAutomation = await startAutomation()
        // The agents' news, which fetches their interface; see agent-marks.svelte.ts.
        stopAgents = await listenForAgents()
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

  // A file dragged in from another app and let go where nothing takes it is not
  // opened in place of the app; see drops.ts.
  const stopStrayDrops = guardDrops()

  void guardClose()

  // A chunk that did not arrive; see reloading.svelte.ts.
  const stopReloading = reloading.watch(async () => {
    settle()
    await workspace.writesSettled()
    return !workspace.writing && !busy.active
  })

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
  void warmDoors().catch(() => {
    // Answered by reloading.svelte.ts.
  })

  // The rows of every space, for Today, the views and the reminders, at the last turn
  // of the launch order: the open space's out of the link index's scan, then the rest
  // one at a time. See rows/rows.svelte.ts.
  // Not the glasses' plugin, which has no view of them yet and whose package has no room
  // for the engine they bring.
  if (!__EVEN_PLUGIN__) void startup.turn('right').then(() => import('./rows/rows.svelte'))

  // And the reminders, which plan over those rows and hand the plan to whatever rings
  // with nib closed; never the glasses' plugin. See reminders/start.svelte.ts.
  if (!__EVEN_PLUGIN__) {
    void startup.turn('right').then(() => import('./reminders/start.svelte'))
  }

  // The chats: the account's list, each chat's store caught up, the outbox sent, at the
  // last turn of the launch order; never the glasses' plugin. See chats/start.svelte.ts.
  if (!__EVEN_PLUGIN__) void startup.turn('right').then(() => import('./chats/start.svelte'))

  // The account's hub, beside the sockets the open notes join, after the first paint;
  // never the glasses' plugin, which stays on sync v1. See sync2/connect.svelte.ts.
  if (!__EVEN_PLUGIN__) {
    void startup.turn('rooms').then(() =>
      import('./sync2/connect.svelte').then(({ connect }) => {
        connect()
      }),
    )
  }

  // A web note is open in one window of the app; see web-tab/one-window.svelte.ts.
  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup.turn('rooms').then(() => import('./web-tab/one-window.svelte'))
  }

  // Quick add's key over every other app, a desktop's alone and after the launch
  // order: the window it opens is made the first time the key is pressed. See
  // quick-add/anywhere.svelte.ts.
  let stopAnywhere: (() => void) | null = null
  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup
      .turn('right')
      .then(() => import('./quick-add/anywhere.svelte'))
      .then((one) => (stopAnywhere = one.listen()))
  }

  // The pointer hides while somebody types; see typing-pointer.ts.
  let stopPointer: (() => void) | null = null
  if (!__EVEN_PLUGIN__) {
    void import('./typing-pointer').then((one) => (stopPointer = one.hidePointerWhileTyping()))
  }

  return () => {
    stopPointer?.()
    stopAnywhere?.()
    clearInterval(sweeper)
    stopRecovery()
    stopReloading()
    stopStrayDrops()
    stopLooking()
    stopAutomation?.()
    stopHanded?.()
    stopAgents?.()
  }
}

/** Nothing with words in it is lost on the way out: what is owed is written as the
 *  window goes, and the window waits for it. Nothing is ever asked. */
async function guardClose() {
  // A phone never closes the window. It puts the app away, and may end it while it
  // is away without a word to it - so a sentence typed a moment before the home
  // gesture was waiting on a pause that never came, and on an iPhone it went with
  // the app. What is owed is written as the page goes out of sight instead, which
  // is the same writes the close button runs and nothing at all when nothing is
  // owed. A browser tab sent to the back, which a browser may also discard, gets
  // the same.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') settle()
    // And a phone's notes are in its Files app as well, where somebody can put a file
    // into a space while the app is away; the list is read again as it comes back.
    else if (isMobile) void workspace.loadTree()
  })
  addEventListener('pagehide', () => settle())

  const window = await currentWindow()
  // The handler answers at once and the waiting happens after: preventing the close
  // is the only part that has to be synchronous.
  await window.onCloseRequested((event) => void onClose(event, window))

  // Cmd+Q closes no window, so the crate holds the quit and asks each window to
  // go as its close button would; see lifecycle.rs.
  if (!__EVEN_PLUGIN__ && isDesktop) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const own = getCurrentWindow()
    await own.listen('nib://quit', () => void onQuit(window))
    // Asked first whether what runs may stop, by the crate and by the other windows.
    await own.listen(
      'nib://quit-ask',
      () => void import('./quitting/ask').then((one) => one.quitAsked()),
    )
    void startup
      .turn('right')
      .then(async () => (await import('./quitting/windows')).answer(own.label))
  }
}

interface Closing {
  preventDefault(): void
}

interface Closable {
  destroy(): Promise<void>
}

/** Whether the window is already on its way out, so a second close waits for the
 *  first rather than starting another. */
let going = false

async function onClose(event: Closing, window: Closable) {
  settle()

  // An agent's pages live in this window, or the reminders keep nib in the tray: it
  // hides instead, and the tray has Quit (docs/agent-native.md, open question 6, and
  // docs/tasks.md decision 6).
  const hide = agentMarks.holding ? agentMarks.hide : trayKeeper()
  if (hide) {
    event.preventDefault()
    if ((await hide()) || going) return
    // Not kept after all: the last agent went a moment ago.
    await go()
    await window.destroy()
    return
  }

  // A browser tab cannot wait for anything - `beforeunload` runs to completion
  // before a write could come back - and it asks nothing either: the session holds
  // every word the disk has not been given yet, synchronously, and the next visit
  // writes them.
  if (!isDesktop) return

  // Nothing being written or running, no web login to hand back and no update to put in
  // place: the window just goes. What runs is asked about first; see lib/quitting.
  const runs = anythingRuns()
  if (!runs && !workspace.writing && !stillWriting() && !handingBack() && !ready() && !going) return

  event.preventDefault()
  if (going) return
  if (!__EVEN_PLUGIN__ && runs && !(await (await import('./quitting/ask')).mayStop('window')))
    return
  await go()
  await window.destroy()
}

/** The app is quitting: go as the close button would. */
async function onQuit(window: Closable) {
  if (going) return

  settle()
  await go()
  await window.destroy()
}

/** Whatever is waiting on a timer goes down now, before anything can end the
 *  window: a filter typed into the graph's card in the last breath is written once
 *  the typing stops, a plane's file once the drawing does, and a note's a moment
 *  after its last keystroke. All of them run off a timer that a window going away
 *  would never reach, and a plane has to go first - it writes into a document, and
 *  the document is what goes to the disk. Whoever owes a write has said so
 *  themselves rather than being reached for from here; see parting.ts. */
function settle() {
  settleUp()
  workspace.graphSettings.flush()
}

/** The writes that are owed, and the web logins this computer holds handed back to the
 *  account, waited for; and a waiting update put in place. */
async function go(): Promise<void> {
  going = true
  try {
    await Promise.race([
      Promise.all([
        workspace.writesSettled(),
        written(),
        Promise.race([handBack(), waited(HANDS_BACK_WITHIN)]),
      ]),
      waited(GIVE_UP),
    ])
    await installStaged()
  } finally {
    going = false
  }
}
