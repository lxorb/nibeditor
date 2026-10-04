/** What the phone hands the page, and what the page does about it.
 *
 *  Three things arrive from outside the app on Android: something another app
 *  shared, a quick settings tile pressed, and a widget row tapped. All three come
 *  in as one intent, are read by `MainActivity` and wait there until the page asks
 *  - because the usual case is a launch, where the page does not exist yet.
 *
 *  A tile and a widget carry the id of a command in the app's own registry and
 *  nothing else. That is the whole of the wiring: the row the home screen offers
 *  and the row the palette offers are the same row, so one cannot drift from the
 *  other, and an id nothing answers to does nothing at all - which is what keeps
 *  the recorder's tile inert until the recorder lands.
 *
 *  What a share becomes is next door, in shared.ts. */

import { attachmentFolder } from '../attachments'
import { busy } from '../busy.svelte'
import { fromBase64 } from '../bytes'
import { appCommands } from '../commands'
import { t } from '../i18n.svelte'
import { applyImport } from '../import/apply'
import { putPicture, writeAtCaret } from '../insert-picture'
import { log } from '../log'
import { modes } from '../modes.svelte'
import { prompt } from '../prompt.svelte'
import { insideAnyOf } from '../space-paths'
import { joinPath } from '../tauri'
import { waited } from '../timing'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { answer, method, onTheActivity } from './bridge'
import {
  type Arrived,
  arrivedFrom,
  isPicture,
  sharedPlan,
  sharedTask,
  sharedTitle,
  sharedWords,
  type SharedItem,
} from './shared'
import { watchWidgets } from './widgets.svelte'

/** How much of a shared file to carry over at once. A photograph is megabytes and
 *  every one of them costs a third again as base64 on the way across, so it comes
 *  in slices with a breath between them rather than as one string that stops the
 *  page while it is built. */
const SLICE = 256 * 1024

/** How much of what arrived the sheet shows, so the reader can see which share
 *  they are answering about. */
const SHOWN = 160

/** Where a tile or a widget row asked to go. */
interface Asked {
  command: string
  open: string
}

/** Reads what the activity said about the press that started this. */
export function askedFrom(json: string): Asked {
  const nothing: Asked = { command: '', open: '' }
  if (!json) return nothing

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return nothing
  }

  if (typeof parsed !== 'object' || parsed === null) return nothing
  const held = parsed as Record<string, unknown>

  return {
    command: typeof held.command === 'string' ? held.command : '',
    open: typeof held.open === 'string' ? held.open : '',
  }
}

/** Runs one of the app's own commands by id, and answers whether there was one.
 *
 *  The registry as the palette reads it, view and all, so a tile gets the row's
 *  own behaviour including its refusal: a command that is greyed out in the
 *  palette does nothing from a tile either. */
function run(id: string): boolean {
  if (!id) return false

  const view = views.of(workspace.panes.focusedId)
  const found = appCommands(view).find((one) => one.id === id)
  if (!found || found.disabled) return false

  found.run()
  return true
}

/** The note a widget row named, if it named one this app has any business
 *  opening.
 *
 *  A widget row hands back a path on disk, and the activity that carries it is
 *  exported: anything on the phone can send that intent, so the path is judged
 *  against the spaces before it reaches the disk. Refused quietly on screen and
 *  in the log, because the reader did not ask for whatever this was. */
export function openable(said: string): string | null {
  const found = insideAnyOf(
    workspace.spaces.map((one) => one.root),
    said,
  )
  if (!found) log('error', `handed: ${said} is not a note in any space`)

  return found
}

/** Everything one intent was carrying, in the order it matters: the note a widget
 *  row named, then the command a tile asked for, then whatever was shared. */
async function take(): Promise<void> {
  const asked = askedFrom(method('handed')?.() ?? '')

  const open = asked.open ? openable(asked.open) : null
  if (open) await workspace.open(open).catch(() => undefined)
  if (asked.command) run(asked.command)

  await taken()
}

/** The share, from what the activity holds to what the space holds. */
async function taken(): Promise<void> {
  const arrived = arrivedFrom(method('shared')?.() ?? '')
  if (!arrived) return

  try {
    const bytes = await carried(arrived)
    const where = await ask(arrived)

    if (where === 'here') await intoTheOpenNote(arrived, bytes)
    else if (where === 'new') await intoANewNote(arrived, bytes)
    else if (where === 'task') await asATask(arrived)
  } catch (error) {
    log('error', `shared: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    // Either way the copies in the cache have been answered for. A share nobody
    // took is a share that was dismissed, which always means do nothing.
    method('sharedDone')?.()
  }
}

/** The bytes of everything that came over as a file, by where it sat in the
 *  share. Asked for in slices, yielding between them, so a photograph does not
 *  hold the page still while it crosses. */
async function carried(arrived: Arrived): Promise<Map<number, Uint8Array>> {
  const read = method('sharedBytes')
  const held = new Map<number, Uint8Array>()
  if (!read) return held

  for (const [at, item] of arrived.items.entries()) {
    if (item.text !== null || item.size <= 0) continue

    const parts: Uint8Array[] = []
    let got = 0

    while (got < item.size) {
      const text = read(at, got, SLICE)
      if (!text) break

      const bytes = fromBase64(text)
      if (!bytes.length) break

      parts.push(bytes)
      got += bytes.length
      // A turn of the event loop, so the page can draw between two slices.
      await waited()
    }

    if (!got) continue

    const whole = new Uint8Array(got)
    let put = 0
    for (const part of parts) {
      whole.set(part, put)
      put += part.length
    }

    held.set(at, whole)
  }

  return held
}

/** Which way this share should land, or null for none.
 *
 *  Asked only where there is a choice: a note open to write in, for a share that is
 *  nothing but words and pictures, which are the two things that can go into a note
 *  that already exists; and a task in the inbox, for a share that is words alone (a
 *  link, a sentence). Anything else makes its own note without asking, because there
 *  is nothing to choose between. */
async function ask(arrived: Arrived): Promise<'new' | 'here' | 'task' | null> {
  const tab = workspace.active
  const view = views.of(workspace.panes.focusedId)
  const fits = arrived.items.every((one) => one.text !== null || isPicture(one))
  const here = tab?.kind === 'note' && !!view && !view.state.readOnly && fits
  const words = arrived.items.every((one) => one.text !== null)
  if (!here && !words) return 'new'

  const chosen = await prompt.choose({
    title: t('Shared'),
    detail: summary(arrived),
    options: [
      { id: 'new', label: t('New note'), primary: true },
      ...(here && tab ? [{ id: 'here', label: t('Add to {name}', { name: tab.shown }) }] : []),
      ...(words ? [{ id: 'task', label: t('As a task') }] : []),
    ],
  })

  if (chosen === 'new' || chosen === 'here' || chosen === 'task') return chosen
  return null
}

/** A line in the open space's inbox, the share's title linked to where it came from. */
async function asATask(arrived: Arrived) {
  const { addTask } = await import('../task-actions')
  await addTask(sharedTask(arrived))
}

/** What arrived, in one line, so the question is about something the reader can
 *  see. Their own words and their own file names, so nothing here is translated. */
function summary(arrived: Arrived): string {
  const words = sharedWords(arrived).replace(/\s+/g, ' ').trim()
  if (words) return words.length > SHOWN ? `${words.slice(0, SHOWN)}…` : words

  return arrived.items
    .map((one: SharedItem) => one.name)
    .filter(Boolean)
    .join(', ')
}

/** A note of its own, written the way an import is written. */
async function intoANewNote(arrived: Arrived, bytes: ReadonlyMap<number, Uint8Array>) {
  const space = workspace.activeSpace
  if (!space) return

  // Where the pictures and the files go, which is the reader's own Attachments
  // setting, worked out for the note this is about to write.
  const folder = attachmentFolder(
    modes.attachments,
    joinPath(space.root, `${sharedTitle(arrived)}.md`),
    space.root,
  )

  const plan = sharedPlan(arrived, bytes, new Date(), folder)
  if (!plan.files.length) return

  const landed = await busy.run(t('Importing'), () =>
    applyImport(plan, { root: space.root, folder: '' }),
  )

  // The note is first in the plan, so it is the first path back.
  const first = landed.paths[0]
  if (first) await workspace.open(first)
}

/** Into the note in front of somebody: the words at the caret, and each picture
 *  stored and drawn exactly as a paste of it would be. */
async function intoTheOpenNote(arrived: Arrived, bytes: ReadonlyMap<number, Uint8Array>) {
  const view = views.of(workspace.panes.focusedId)
  if (!view) return

  const words = sharedWords(arrived)
  if (words) writeAtCaret(view, words)

  for (const [at, item] of arrived.items.entries()) {
    const held = bytes.get(at)
    if (item.text !== null || !held?.length) continue

    // Copied on the way into the `File`, which will only take a view of a buffer
    // that is certainly not shared. One picture's worth, once.
    const file = new File([new Uint8Array(held)], item.name || 'shared', { type: item.mime })
    await putPicture(view, file)
  }
}

/** Starts listening for all of it, and answers how to stop.
 *
 *  Nothing is registered anywhere but in the app on a phone: a browser and a
 *  desktop have no activity behind them, and asking for a share there would be
 *  asking an object that is not there. */
export function startHanded(): () => void {
  if (!onTheActivity()) return () => undefined

  const stopWidgets = watchWidgets()

  // An intent that arrives while the app is already open, rather than one that
  // started it: the activity runs this line and the page comes and asks.
  answer('__nibHanded', () => void take())
  void take()

  return () => {
    answer('__nibHanded', undefined)
    stopWidgets()
  }
}
