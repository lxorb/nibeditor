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
import { insideSpace } from '../space-paths'
import { afterQuiet } from '../timing'
import { type Entry, workspace } from '../workspace.svelte'
import { method } from './bridge'

/** As many rows as the layout has; see res/layout/widget_notes.xml. */
const MOST = 5

/** One row: what it says, and what it opens. */
export interface WidgetRow {
  name: string
  path: string
}

/** One task of the Today widget: its words, its anchor and space for the box to tick
 *  it by, and its note's path for the words to open it. */
export interface TodayRow {
  text: string
  at: string
  space: string
  path: string
}

/** Everything a widget draws: the notes widget's rows, and the Today widget's. */
interface WidgetState {
  title: string
  empty: string
  notes: WidgetRow[]
  today: { title: string; empty: string; tasks: TodayRow[] }
}

/** Today as the widget draws it, from what `list_tasks` answers: the first rows, each
 *  with where its note is on this phone. Pure, like `widgetRows`. */
export function todayRows(
  tasks: readonly { text: string; at: string; space: string }[],
  rootOf: (space: string) => string | undefined,
  most = MOST,
): TodayRow[] {
  return tasks.slice(0, most).map((one) => {
    const root = rootOf(one.space)
    const relative = one.at.replace(/#\d+:[0-9a-z]+$/, '')
    return {
      text: one.text,
      at: one.at,
      space: one.space,
      path: root ? insideSpace(root, relative) : '',
    }
  })
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

/** What the app would hand over now, Today's tasks as they were last read. */
function widgetState(today: TodayRow[]): WidgetState {
  const kept = workspace.tabs.filter((one) => one.pinned).map((one) => one.path ?? '')

  return {
    title: workspace.activeSpace?.name ?? t('Notes'),
    empty: t('Nothing here'),
    // What the space archived is off the home screen as it is off the file list.
    notes: widgetRows(
      workspace.notes.filter((one) => !workspace.archive.has(one.path)),
      kept,
    ),
    // No sentence for an empty Today: an empty list with its plus (docs/tasks.md 5.19).
    today: { title: t('Today'), empty: '', tasks: today },
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
  let today = $state<TodayRow[]>([])

  // Today read again when the rows change, once the typing has stopped: a widget
  // redrawn for every keystroke is a launcher woken for every keystroke.
  const read = async () => {
    const { listed } = await import('../task-actions')
    const tasks = (await listed()).tasks
    today = todayRows(tasks, (space) => workspace.spaces.find((one) => one.name === space)?.root)
  }
  const reread = afterQuiet(() => void read(), 600)
  let unwatch: () => void = () => undefined
  void import('../rows/rows.svelte').then(({ rows }) => {
    unwatch = rows.watch(() => {
      reread()
    })
    void read()
  })

  const stop = $effect.root(() => {
    $effect(() => {
      const said = JSON.stringify(widgetState(today))
      if (said === last) return

      last = said
      push(said)
    })
  })
  return () => {
    reread.cancel()
    unwatch()
    stop()
  }
}
