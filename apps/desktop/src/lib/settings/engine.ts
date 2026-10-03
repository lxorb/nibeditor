/** The Browser row's engines: which two there are on this system, and what the row
 *  offers from what the crate says. The row itself is EngineRow.svelte; the choosing,
 *  the fetching and the relaunch are src-tauri/src/engine_switch.rs.
 *
 *  Pure, so what the row shows is a test rather than a launch. */

import { key } from '../i18n.svelte'

/** The two engines, as the crate names them. */
export type Engine = 'system' | 'chromium'

/** What the crate says about them; `engine_state` in engine_switch.rs. */
export interface EngineState {
  running: Engine
  chosen: Engine
  offered: boolean
  installed: boolean
  fellBack: boolean
}

/** The system's own engine by the name a person knows it by: the browser it is the
 *  engine of. Empty where there is no choice to make, which is everywhere but Windows
 *  for now (`OFFERED` in engine_switch.rs): Linux cannot run the Chromium build, a Mac's
 *  freezes at its first web tab, and a phone or a browser tab has neither. A Mac's row,
 *  once it is there, is `Chromium | Safari`. */
export function systemName(os: string): string {
  return os === 'windows' ? 'Edge' : ''
}

/** What sits beside the control: nothing, the Relaunch chip once the chosen engine
 *  is ready to be started, or the ring while it is being fetched. `withUpdate` is
 *  Chromium fetched for the update waiting to be installed, which a relaunch into
 *  that update starts. */
type Beside = 'nothing' | 'relaunch' | 'fetching'

export function beside(state: EngineState, fetching: boolean, withUpdate = false): Beside {
  if (fetching) return 'fetching'
  if (state.chosen === state.running) return 'nothing'
  // The system's engine is always there; Chromium only once it has been fetched.
  if (state.chosen === 'system' || state.installed || withUpdate) return 'relaunch'
  return 'nothing'
}

/** Why a fetch of Chromium ended without it, as the crate says it; `Refused` in
 *  src-tauri/src/engine_switch/fetch.rs. `version` is the one the release's Chromium
 *  is for, where that is another version of the app. */
export interface Refused {
  reason: 'offline' | 'missing' | 'moved' | 'unsigned' | 'full' | 'stopped' | 'failed'
  version: string | null
  detail: string
}

export function isRefused(value: unknown): value is Refused {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Refused).reason === 'string' &&
    typeof (value as Refused).detail === 'string'
  )
}

/** The few words the row says a refusal in, Chrome's way with a failed download:
 *  what went wrong, never how. The detail is for the log. Nothing for a fetch that
 *  was stopped, which the person did themselves. A release that has moved on to the
 *  next version is only said where no update brings that version's Chromium. */
export function said(refused: Refused): string {
  switch (refused.reason) {
    case 'stopped':
      return ''
    case 'offline':
      return key('No connection')
    case 'missing':
      return key('Not in this release')
    case 'moved':
      return key('Needs an update')
    case 'unsigned':
      return key('Signature did not match')
    case 'full':
      return key('Disk full')
    case 'failed':
      return key('Could not be installed')
  }
}

/** The version a release has moved on to, where that is why a fetch failed. */
export function movedTo(error: unknown): string | null {
  return isRefused(error) && error.reason === 'moved' ? error.version : null
}
