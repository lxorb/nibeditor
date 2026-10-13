/** A Mac's copy that cannot be updated where it runs: started from its disk image, or
 *  from a download macOS translocated, where the installer can write nothing and the
 *  same version would be offered on every launch. Fetched with the notice that offers
 *  an update, which is the one place that asks. See src-tauri/src/app_place.rs. */

import { discard } from './updater'
import { invoke, isDesktop, platform } from './tauri'

/** Asked once. */
let asked: Promise<boolean> | null = null

export function stuck(): Promise<boolean> {
  asked ??=
    isDesktop && platform() === 'macos'
      ? invoke<boolean>('app_stuck').catch(() => false)
      : Promise.resolve(false)
  return asked
}

/** Moves such a copy into Applications and starts it from there; the look it makes
 *  there finds the update again, and installs it. What was downloaded here could only
 *  fail, so it goes. */
export async function moveToApplications() {
  await discard()
  await invoke('move_to_applications')
}
