/** What the home screen draws, and who decides it.
 *
 *  A widget is drawn by the launcher in its own process, so it cannot ask the app
 *  anything: what it shows is whatever the page last handed over. Which notes
 *  those are is decided here rather than in Kotlin, because it is a question about
 *  notes - what is kept to hand, what was written in last - and because here it
 *  can be read and tested.
 *
 *  A pinned note comes first. That is what "open a chosen note" means on the home
 *  screen: the app already has one gesture for keeping a note to hand, and a
 *  picker written in Kotlin would be a second file list in a second language
 *  answering a question the app has already answered.
 *
 *  The words are handed over too, not only the rows, so the heading and the line
 *  for a space with nothing in it are in the reader's own language - Android's own
 *  resources cannot reach the page's dictionaries. See res/values/strings.xml for
 *  what stands there before the app has ever run. */

import { t } from '../i18n.svelte'
import { shownName } from '../note-name'
import { type Entry, workspace } from '../workspace.svelte'
import { method } from './bridge'

/** As many rows as the layout has; see res/layout/widget_notes.xml. */
const MOST = 5

/** One row: what it says, and what it opens. */
export interface WidgetRow {
  name: string
  path: string
}

/** Everything a widget draws. */
interface WidgetState {
  title: string
  empty: string
  notes: WidgetRow[]
}

/** The rows, in the order they are drawn: the notes being kept open first, in the
 *  order they were pinned, then everything else by when it was last written in.
 *
 *  Pure, and given its lists rather than reading them, so what the home screen
 *  will say can be asked without a home screen. */
export function widgetRows(
  notes: readonly Entry[],
  kept: readonly string[],
  most = MOST,
): WidgetRow[] {
  const rows: WidgetRow[] = []

  const add = (entry: Entry) => {
    if (rows.length >= most || rows.some((one) => one.path === entry.path)) return
    rows.push({ name: shownName(entry.name), path: entry.path })
  }

  // Lists rather than a map of every note: what is kept open is a handful, and
  // five rows is the whole answer.
  for (const path of kept) {
    const found = notes.find((one) => one.path === path)
    if (found) add(found)
  }

  for (const one of [...notes].sort((a, b) => b.modified - a.modified)) add(one)

  return rows
}

/** What the app would hand over now. */
function widgetState(): WidgetState {
  const kept = workspace.tabs.filter((one) => one.pinned).map((one) => one.path ?? '')

  return {
    title: workspace.activeSpace?.name ?? t('Notes'),
    empty: t('Nothing here'),
    // What the space archived is off the home screen as it is off the file list.
    notes: widgetRows(
      workspace.notes.filter((one) => !workspace.archive.has(one.path)),
      kept,
    ),
  }
}

/** Keeps the home screen in step with the space, and answers how to stop.
 *
 *  One line across the bridge whenever what it would draw changes, and nothing at
 *  all when it has not: switching tabs changes the pinned list only sometimes, and
 *  a widget redrawn for nothing is a launcher woken for nothing. */
export function watchWidgets(): () => void {
  const push = method('widgets')
  if (!push) return () => undefined

  let last = ''

  return $effect.root(() => {
    $effect(() => {
      const said = JSON.stringify(widgetState())
      if (said === last) return

      last = said
      push(said)
    })
  })
}
