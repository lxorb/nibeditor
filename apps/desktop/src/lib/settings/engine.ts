/** The Browser row's engines: which two there are on this system, and what the row
 *  offers from what the crate says. The row itself is EngineRow.svelte; the choosing,
 *  the fetching and the relaunch are src-tauri/src/engine_switch.rs.
 *
 *  Pure, so what the row shows is a test rather than a launch. */

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
 *  is ready to be started, or the ring while it is being fetched. */
type Beside = 'nothing' | 'relaunch' | 'fetching'

export function beside(state: EngineState, fetching: boolean): Beside {
  if (fetching) return 'fetching'
  if (state.chosen === state.running) return 'nothing'
  // The system's engine is always there; Chromium only once it has been fetched.
  if (state.chosen === 'system' || state.installed) return 'relaunch'
  return 'nothing'
}
