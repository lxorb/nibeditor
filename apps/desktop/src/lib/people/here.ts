/** Whether somebody is at this device, said to the account's hub: what the others see
 *  as the dot on this person's face.
 *
 *  One `Activity` for the device (web-tab/activity.ts), made here and shared: web logins
 *  that travel hand a site over by the same answer (web-tab/web-sync.svelte.ts), and two
 *  ears saying two things to one hub would be a site handed over because a face went
 *  idle. Started for every signed-in device after the first paint, beside the hub (see
 *  sync2/connect.svelte.ts); the hub works out the person from all their devices and
 *  writes it down when it changes (services/sync/src/people/presence.ts). The zone this
 *  device is in is kept on the account in the same turn, so a card tells the time where
 *  the person is. See docs/chats.md 4.10. */

import { invoke, isDesktop } from '../tauri'
import { hub } from '../sync2/hub.svelte'
import { Activity, listenForInput, readSystemInput } from '../web-tab/activity'
import { keepZone } from './mine'

/** What else keeps this device in use without a hand on it: a page playing sound, an
 *  agent at work. Added by whoever knows; see web-sync.svelte.ts. */
const busy = new Set<() => boolean>()

let made: Activity | null = null

/** The device's one answer to whether somebody is at it. */
export function deviceActivity(): Activity {
  if (made) return made
  made = new Activity({
    now: () => Date.now(),
    // The system's idle clock is the crate's, on a desktop; elsewhere the page's own
    // keys and pointer are the whole answer.
    system: async () => (isDesktop ? readSystemInput(await invoke<unknown>('input_idle')) : null),
    busy: () => [...busy].some((one) => one()),
    listen: listenForInput,
    every: (ms, tick) => {
      const timer = setInterval(tick, ms)
      return () => clearInterval(timer)
    },
  })
  made.start()
  return made
}

/** Counts something as somebody at this device while it says so. */
export function busyWhile(asking: () => boolean): void {
  busy.add(asking)
}

let started = false

/** Tells the hub, now and on every change and every reconnect, from the window that
 *  holds its socket. Once. */
export function startHere(): void {
  if (started) return
  started = true

  const activity = deviceActivity()
  const say = () => {
    if (hub.leads) hub.send({ t: activity.active ? 'active' : 'idle' })
  }
  activity.changed(say)
  hub.opened(() => {
    say()
    // A zone that could not be kept is the card telling the time it last knew; the
    // next connect tries again.
    void keepZone().catch(() => undefined)
  })
}
