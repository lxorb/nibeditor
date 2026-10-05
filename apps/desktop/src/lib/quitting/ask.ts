/** The question before something running stops: the app quitting, a window closing, an
 *  update's restart.
 *
 *  Emil, 2026-10-05: *"When you want to close nib, it should give you a warning about the
 *  terminal windows ... not just open, but the ones running something, e.g. claude."*
 *
 *  macOS Terminal's rule and VS Code's `hasChildProcesses`: a shell at its prompt goes
 *  without a word, and the question comes only when something would stop - and then it
 *  names each one, as macOS Terminal and Warp do and VS Code's "terminate the active
 *  terminal session?" does not. One question for every window, as Chrome's "Close N
 *  tabs?". A row pressed calls the quit off and goes to it. Nothing is asked about notes,
 *  which write themselves, nor about a terminal's screen, which the next launch puts
 *  back (terminal/history.ts): only what runs stops.
 *
 *  Settings > Terminal > Warn before quitting says when (terminal/shells.svelte.ts), and
 *  "Don't ask again" is its Never. The crate holds a quit while this asks; see `quit` in
 *  src-tauri/src/lifecycle.rs. Mounted here rather than by App.svelte, since nothing of
 *  it is worth a byte before something runs; see save-place/ask.ts. */

import { mount } from 'svelte'
import { invoke, platform } from '../tauri'
import { shells } from '../terminal/shells.svelte'
import { jump } from './jump'
import QuitSheet from './QuitSheet.svelte'
import { asks, rowsHere, type Why } from './rows'
import { quitAsk } from './state.svelte'
import { rowsEverywhere, showElsewhere } from './windows'

let mounted = false

/** This window's label, which the rows say they are in. */
async function label(): Promise<string> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().label
}

/** Whether what runs may stop for `why`: true at once with nothing running or Settings
 *  saying never, and otherwise once somebody said so. */
export async function mayStop(why: Why): Promise<boolean> {
  const warning = shells.warning
  if (warning === 'never') return true

  const window = await label()
  const idle = warning === 'always'
  const rows = why === 'window' ? await rowsHere(window, idle) : await rowsEverywhere(window, idle)
  if (!asks(warning, rows)) return true

  // A window's own close stops its own shells only - unless it is the last, which ends
  // the app everywhere but on a Mac.
  const alone =
    why === 'window' &&
    platform() !== 'macos' &&
    !(await invoke<string[]>('quit_others').catch(() => [])).length

  // Quit in the tray asks a window that may be out of sight.
  if (why === 'quit') await invoke('quit_show').catch(() => undefined)
  if (!mounted) {
    mount(QuitSheet, { target: document.body })
    mounted = true
  }

  const answer = await quitAsk.ask(alone ? 'quit' : why, rows)
  if (answer === 'go') return true
  if (answer !== 'stay') {
    if (answer.window === window) void jump(answer)
    else showElsewhere(answer)
  }
  return false
}

/** The crate holds a quit and asks this window: the answer goes back. */
export async function quitAsked() {
  if (quitAsk.open) return
  const going = await mayStop('quit').catch(() => true)
  await invoke(going ? 'quit_confirmed' : 'keep_running').catch(() => undefined)
}
