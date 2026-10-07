/** The reminders, as the app runs them: the scheduler (scheduler.ts) put on the rows,
 *  the automatic reminder's setting and the device's way of ringing, and the presses on
 *  what rang answered (docs/tasks.md 5.10).
 *
 *  Fetched at the last turn of the launch order, after the rows, never in the first
 *  paint (start.ts); importing this is starting it. Nothing is handed over until every
 *  space has been read, and from then on only when the plan changed. */

import { untrack } from 'svelte'
import { answer } from '../mobile/bridge'
import { modes } from '../modes.svelte'
import { quickAdd } from '../quick-add/asked.svelte'
import { rows } from '../rows/rows.svelte'
import { insideSpace } from '../space-paths'
import { invoke, isDesktop } from '../tauri'
import { workspace } from '../workspace.svelte'
import { askToShow } from '../notify'
import { hand, show, taken } from './platform'
import { type Host as PressHost, type Pressed, respond } from './presses'
import { residency } from './residency.svelte'
import { Ringer } from './ring'
import { Scheduler } from './scheduler'

const later = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/** Settles once every space has been read. */
function whenReady(): Promise<void> {
  if (rows.ready) return Promise.resolve()
  return new Promise((done) => {
    const stop = rows.watch(() => {
      if (!rows.ready) return
      stop()
      done()
    })
  })
}

const pressHost: PressHost = {
  rootOf: (space) => workspace.spaces.find((one) => one.name === space)?.root ?? null,
  rowsAt: (path) => rows.at(path),
  ready: whenReady,
  tick: (row) => rows.write(row, { task: { done: true } }),
  inside: insideSpace,
  async open(root, path, line) {
    const space = workspace.spaces.find((one) => one.root === root)
    if (space && workspace.activeSpace?.root !== root) await workspace.selectSpace(space.id)
    await workspace.open(path)
    workspace.goto = { path, line }
  },
}

/** Every press waiting, answered in the order they came. */
async function answerAll() {
  const presses = await taken()
  for (const one of presses) await answered(one)
  // A launch for nothing but a Done goes again once it is answered, unless the tray
  // keeps it; see reminders.rs.
  if (presses.length && isDesktop) {
    await invoke('reminders_quietly').catch(() => undefined)
  }
}

async function answered(press: Pressed) {
  await respond(press, pressHost).catch(() => false)
}

const ringer = new Ringer({
  now: () => Date.now(),
  later,
  show: (one) => show(one, (press) => void answered(press)),
})

/** The automatic reminder as the setting last said, null for none. */
let auto: number | null = null

const scheduler = new Scheduler({
  rows: () => rows.of(),
  ready: () => rows.ready,
  watch: (listener) => rows.watch(listener),
  auto: () => auto,
  now: () => Date.now(),
  hand,
  ring(plan) {
    if (plan.length) askToShow()
    ringer.ring(plan)
  },
  waiting(any) {
    residency.waiting = any
  },
  later,
})
scheduler.start()

// The automatic reminder, and whether nib stays in the tray, followed as they change.
// Handed on untracked, so nothing the scheduler or the crate reads is this effect's.
$effect.root(() => {
  $effect(() => {
    const minutes = modes.remindBefore
    untrack(() => {
      auto = minutes < 0 ? null : minutes
      scheduler.changed()
    })
  })
  // The quick add key from any app needs nib running, so it keeps nib in the tray too:
  // the key the system holds, not the switch, which asks for one it may not get.
  $effect(() => {
    const held = quickAdd.held
    untrack(() => (residency.quickAdd = held))
  })
  $effect(() => {
    const on = residency.on
    untrack(() => residency.apply(on))
  })
})

// The presses: any that started the app, and every one after it as it arrives.
void answerAll()
if (isDesktop) {
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen('nib://reminder', () => void answerAll()),
  )
} else {
  answer('__nibReminders', () => void answerAll())
}
