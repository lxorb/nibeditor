/** PDFs another program opened with nib, as the window takes them.
 *
 *  The crate hears them - a launch, a second launch, a Mac's "open these" - and hands
 *  them to one window, the way it hands a link (see src-tauri/src/launch.rs). This is
 *  that window's half: each PDF in the viewer, in a tab in front, in the space
 *  arrival.ts chooses, brought into it first when it came from outside every space.
 *
 *  Fetched with the rest of the roads in, after the space has restored. */

import { log } from '../log'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { arrivalOf } from './arrival'

/** Listens for PDFs, takes the ones the app was started for, and answers how to stop.
 *  Listening before asking, because asking is what tells the crate this window hears
 *  them; see `take_startup_pdfs` in launch.rs. */
export async function hearPdfs(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const stop = await getCurrentWindow().listen<unknown>('nib://open-pdfs', (event) => {
    void showPdfs(event.payload)
  })

  // Not waited for: a paper being copied in holds up none of the other roads.
  void showPdfs(await invoke<unknown>('take_startup_pdfs').catch(() => []))
  return stop
}

/** Each PDF a tab, in the order they came, the last in front. What crossed from the
 *  crate is read as unknown. */
export async function showPdfs(said: unknown) {
  if (!Array.isArray(said)) return

  for (const path of said) {
    if (typeof path === 'string' && path) await showPdf(path)
    else log('warn', `pdf: a file handed over was not one: ${String(path)}`)
  }
}

async function showPdf(handed: string) {
  const arrival = arrivalOf(handed, workspace.spaces, workspace.activeSpaceId)
  if (!arrival) {
    log('warn', 'pdf: a file was handed over with no space to put it in')
    return
  }

  if (arrival.spaceId !== workspace.activeSpaceId) await workspace.selectSpace(arrival.spaceId)
  const path =
    arrival.kind === 'open' ? arrival.path : await workspace.bringInPdf(handed, arrival.root)

  if (path) workspace.openPdf(path)
}
