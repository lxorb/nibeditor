import { GIVE_UP, settleUp, written } from './parting'
import { isNumber, isRecord, isString } from './stored'
import { invoke, isDesktop } from './tauri'
import { waited } from './timing'

/** The two streams of releases a machine can follow: the tagged releases, or the
 *  build of every push to main. Which endpoint each one looks at is decided in the
 *  crate - see src-tauri/src/updates.rs - because the plugin's `check()` here
 *  takes no endpoints and would always read the same list. */
const CHANNELS = ['stable', 'unstable'] as const
export type Channel = (typeof CHANNELS)[number]

/** A channel out of whatever was stored or came off a control. Anything else is
 *  the stable one: following the releases is where every install starts, and the
 *  safe answer to a value nobody wrote. */
export function asChannel(value: unknown): Channel {
  return CHANNELS.find((one) => one === value) ?? 'stable'
}

/** A downloaded update, waiting to be put in place on the way out. Closing one
 *  gives back the installer's bytes, which the crate is holding. */
let staged: { version: string; install(): Promise<void>; close(): Promise<void> } | null = null

export const ready = () => staged !== null

/** The version waiting to be installed, if one has been downloaded. */
export const stagedVersion = () => staged?.version ?? null

/** What `check_update` answers with: the fields the updater plugin builds its own
 *  `Update` from, `rid` being the update itself, kept in the crate. */
interface Found {
  rid: number
  currentVersion: string
  version: string
  rawJson: Record<string, unknown>
}

/** The command's answer, checked rather than cast. A version that came back
 *  half-written is no version at all, and reads here as nothing found. */
function found(value: unknown): Found | null {
  if (!isRecord(value)) return null

  const { rid, currentVersion, version, rawJson } = value
  if (!isNumber(rid) || !isString(currentVersion) || !isString(version)) return null
  if (!isRecord(rawJson)) return null

  return { rid, currentVersion, version, rawJson }
}

/** Fetches a new version in the background if the channel has one.
 *
 *  Only downloads: installing here would restart the app under whoever is
 *  typing. The installer runs on quit instead, so the new version is simply
 *  what starts next time.
 *
 *  Only ever a higher version, whichever channel is being followed: the updater
 *  compares semver, so a machine that has just left the rolling stream is not
 *  handed the older release as an update. It stays on the build it has until a
 *  release passes it. */
export async function stageUpdate(channel: Channel): Promise<string | null> {
  if (!isDesktop || staged) return null

  try {
    const one = found(await invoke<unknown>('check_update', { channel }))
    if (!one) return null

    const { Update } = await import('@tauri-apps/plugin-updater')
    const update = new Update(one)

    await update.download()
    staged = update
    void engineFor(update.version)
    return update.version
  } catch {
    // No network, no release yet, or a signature that did not verify. Any of
    // those simply means carrying on with the version already installed.
    return null
  }
}

/** Where nib runs on its own Chromium, that engine for the version about to be
 *  installed, fetched now rather than when the new version starts - so the two are
 *  never out of step, which is what JetBrains' runtimes get wrong. Nothing where the
 *  system's engine is chosen; and a fetch that fails leaves the next launch on the
 *  system's engine, where the Browser row offers it again. See
 *  src-tauri/src/engine_switch/fetch.rs. */
async function engineFor(version: string) {
  try {
    const state = await invoke<{ chosen: string }>('engine_state')
    if (state.chosen === 'chromium') await fetchEngineFor(version)
  } catch {
    // The launch after the update runs on the system's engine and says so.
  }
}

/** The fetch of one version's Chromium in flight, which a second asker waits for
 *  rather than being told one is already running: the update staging and the Browser
 *  row can both want the update's at once. */
let fetching: { version: string; done: Promise<unknown> } | null = null

export function fetchEngineFor(version: string): Promise<unknown> {
  if (fetching?.version !== version) {
    const done: Promise<unknown> = invoke('engine_fetch', { version }).finally(() => {
      if (fetching?.done === done) fetching = null
    })
    fetching = { version, done }
  }
  return fetching.done
}

/** Throws away what was downloaded instead of installing it.
 *
 *  What a machine does with a build it fetched from the channel it has just left:
 *  a build of main is not what somebody who has asked for the releases wants
 *  started next time. Closing it hands back the installer's bytes as well, which
 *  are megabytes rather than a handle. */
export async function discard() {
  const going = staged
  staged = null

  try {
    await going?.close()
  } catch {
    // Nothing to say: it is not being installed either way, and whatever the
    // crate is still holding goes with the process.
  }
}

/** Puts the update in place and starts the new version straight away, for
 *  someone who would rather not wait until the next launch.
 *
 *  On Windows the installer takes the app down itself, so the relaunch below is
 *  only reached on the platforms where it does not. What a close would write is
 *  written and waited for first, as a close waits; see start.ts. */
export async function restartToUpdate() {
  settleUp()
  await Promise.race([written(), waited(GIVE_UP)])
  await installStaged()

  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // Nothing sensible to do: the update is installed either way, and the next
    // launch picks it up.
  }
}

/** Runs the staged installer. Called as the app closes, so nothing is
 *  interrupted; the update is in place for the next launch. */
export async function installStaged() {
  if (!staged) return

  try {
    await staged.install()
  } catch {
    // A failed install leaves the working version alone, which is the right
    // outcome - it will be offered again next time.
  } finally {
    staged = null
  }
}
