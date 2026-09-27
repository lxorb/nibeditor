/** What the web tabs have downloaded this run, as the bar shows it.
 *
 *  The crate saves the file - in the Downloads folder, under the server's name, numbered
 *  the way Chrome numbers one beside a file already there - and says so as each one
 *  starts, moves and ends; see src-tauri/src/downloads.rs. This is the other half: the
 *  list the glyph in the bar and the bubble under it are drawn from, and the three things
 *  a reader can do with a row. Every one of those goes back to the crate by the id it
 *  gave the download, never by a path, so nothing here can open a file the crate did not
 *  save.
 *
 *  For as long as the app runs, like Chrome's own bubble: a list of every file ever
 *  saved is the Downloads folder itself. */

import { invoke } from '../tauri'

type DownloadState = 'going' | 'done' | 'failed' | 'cancelled'

/** One download, as the crate describes it. */
export interface Download {
  id: number
  /** The tab whose page asked for it. */
  tab: string
  url: string
  /** What the file was saved as. */
  name: string
  state: DownloadState
  received: number
  /** How large it is, when the server said. */
  total: number | null
}

const STATES: readonly DownloadState[] = ['going', 'done', 'failed', 'cancelled']

/** A download out of what the crate sent, or null for anything that is not one. */
export function readDownload(value: unknown): Download | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  const state = STATES.find((one) => one === said.state)
  if (
    typeof said.id !== 'number' ||
    typeof said.tab !== 'string' ||
    typeof said.url !== 'string' ||
    typeof said.name !== 'string' ||
    state === undefined
  ) {
    return null
  }

  return {
    id: said.id,
    tab: said.tab,
    url: said.url,
    name: said.name,
    state,
    received: typeof said.received === 'number' ? said.received : 0,
    total: typeof said.total === 'number' && said.total > 0 ? said.total : null,
  }
}

/** The list with one download put in: in its own place if it is already there, at the
 *  end if it is new, and taken out if the reader cancelled it - a download somebody
 *  stopped is not something they want to read about again. */
export function merged(list: readonly Download[], one: Download): Download[] {
  if (one.state === 'cancelled') return list.filter((each) => each.id !== one.id)
  if (!list.some((each) => each.id === one.id)) return [...list, one]

  return list.map((each) => {
    if (each.id !== one.id) return each
    // A report of how far it had got can arrive after the one that says it ended; the
    // end is the last word.
    if (each.state !== 'going' && one.state === 'going') return each
    return one
  })
}

/** How far along everything still going is, for the ring round the glyph: a fraction,
 *  `'unknown'` when nothing going has said how large it is, and null when nothing is
 *  going at all. */
export function progressOf(list: readonly Download[]): number | 'unknown' | null {
  const going = list.filter((one) => one.state === 'going')
  if (going.length === 0) return null

  const sized = going.filter((one) => one.total !== null)
  const total = sized.reduce((sum, one) => sum + (one.total ?? 0), 0)
  if (total === 0) return 'unknown'

  const received = sized.reduce((sum, one) => sum + Math.min(one.received, one.total ?? 0), 0)
  return received / total
}

class Downloads {
  /** Oldest first, as they arrived. */
  list = $state<Download[]>([])

  /** What the crate said about one download. True when it is one this list had not
   *  heard of, which is the moment a download starts. */
  heard(one: Download): boolean {
    const fresh = !this.list.some((each) => each.id === one.id)
    this.list = merged(this.list, one)
    return fresh
  }

  /** Opens a finished file the way the system opens it. */
  async open(id: number): Promise<void> {
    await invoke('web_download_open', { id }).catch(() => undefined)
  }

  /** Shows a finished file in its folder. */
  async show(id: number): Promise<void> {
    await invoke('web_download_show', { id }).catch(() => undefined)
  }

  /** Stops one on its way. */
  async cancel(id: number): Promise<void> {
    await invoke('web_download_cancel', { id }).catch(() => undefined)
  }
}

export const downloads = new Downloads()
