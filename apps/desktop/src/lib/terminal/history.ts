/** A terminal's last lines between runs: what a restart puts back above the fresh shell,
 *  so the build that failed yesterday is still there to read.
 *
 *  VS Code writes a hundred lines of every terminal down as the window goes and replays
 *  them under a dim "History restored"; Windows Terminal replays the whole buffer under
 *  the date it was written; Warp keeps its recent blocks. A thousand lines here: what
 *  VS Code keeps while it runs, where its hundred across a restart is a short build log,
 *  and a failed build's error is almost always inside its last thousand. Half a million
 *  characters at most, whatever the lines hold. Measured on a coloured build log 160
 *  columns wide: a thousand lines serialise in about 13 ms, five thousand in about 60,
 *  which is past the 50 a task may take before a keystroke waits for it.
 *
 *  A screen can hold anything that was printed to it, so where it is kept is the crate's
 *  and nowhere else's: one file per terminal in the app's local data folder, under the
 *  space it was opened in - never this page's storage, which the session's unsaved words
 *  share, never a space's folder, never the account. See
 *  src-tauri/src/terminal/history.rs. Closing a tab forgets its file, and this run keeps
 *  its lines in memory for Reopen closed tab; turning Restore history off forgets every
 *  one at once, which is what Warp's switch does not.
 *
 *  What is written is decided by the screen; see `Session.remember` in
 *  sessions.svelte.ts. Everything here is one call to the crate at a time per terminal,
 *  in order, and the window going waits for whatever is in the air; see parting.ts. */

import { writing } from '../parting'
import { forget, isNumber, isRecord, isString, stored } from '../stored'
import { invoke } from '../tauri'

/** A screen written down: the text xterm.js serialised, the size it was written at, so
 *  it is replayed at that width and reflowed into the pane, and when. */
export interface History {
  cols: number
  rows: number
  at: number
  text: string
}

/** Where one terminal's history is kept: the space it was opened in, if it was opened in
 *  one, and the key the tab was made with (see spec.ts). */
export interface Place {
  space: string | null
  key: string
}

/** How many lines of scrollback go with the screen. */
export const LINES = 1000

/** How many characters one history may be. */
export const MOST = 512 * 1024

/** The screen as it fits: all of `LINES` above it, or half as many until it fits - a
 *  minified file printed whole is one line a megabyte long - and nothing at all where
 *  even the screen alone does not. `serialize` is asked for the text with that many lines
 *  of scrollback. */
export function fitted(serialize: (lines: number) => string, most = MOST): string | null {
  for (let lines = LINES; ; lines = Math.floor(lines / 2)) {
    const text = serialize(lines)
    if (text.length <= most) return text
    if (lines === 0) return null
  }
}

/** The line under a replayed screen, dim and on a line of its own, saying when what is
 *  above it is from: VS Code's dim "History restored", Windows Terminal's date. The shell
 *  below it is a new one. */
export function restoredLine(words: string): string {
  return `\x1b[0m\r\n${dim(words)}`
}

/** The same on Windows, where the pseudo console owns every row of the screen it starts
 *  on: it knows nothing of the replayed lines, and a resize that reflows them repaints
 *  its own rows over theirs. So they are pushed above the screen, into the scrollback -
 *  `rows` new lines, then the top - as VS Code pushes them, and the line saying when is
 *  the screen's first row, so the fresh prompt under it is not all there is to see. */
export function restoredAbove(words: string, rows: number): string {
  return `\x1b[0m\r\n${'\r\n'.repeat(Math.max(0, rows - 1))}\x1b[H${dim(words)}`
}

function dim(words: string): string {
  return `\x1b[2m${words}\x1b[22m\r\n`
}

/** What the crate answered, read rather than trusted. */
function readHistory(value: unknown): History | null {
  if (!isRecord(value)) return null
  const { cols, rows, at, text } = value
  if (!isNumber(cols) || !isNumber(rows) || !isNumber(at) || !isString(text) || !text) return null
  return { cols, rows, at, text }
}

/** The histories of tabs closed in this run, for Reopen closed tab, newest last. Never
 *  written anywhere: a closed tab's lines are gone from the disk, and go from here with
 *  the window. */
const closed = new Map<string, History>()

/** As many closed tabs' lines as the closed-tab stack is likely to give back. */
const KEPT_CLOSED = 12

/** Each terminal's calls to the crate, one after the other: a forget that overtook the
 *  write before it would leave the file it meant to remove. */
const turns = new Map<string, Promise<void>>()

function inTurn(key: string, run: () => Promise<unknown>): Promise<void> {
  const mine = (turns.get(key) ?? Promise.resolve()).then(run).then(
    () => undefined,
    () => undefined,
  )
  turns.set(key, mine)
  void mine.then(() => {
    if (turns.get(key) === mine) turns.delete(key)
  })
  writing(mine)
  return mine
}

/** What a terminal had on its screen last time: a tab closed a moment ago from memory,
 *  anything else from the disk. */
export async function historyOf(place: Place): Promise<History | null> {
  if (!place.key) return null

  const kept = closed.get(place.key)
  if (kept) {
    closed.delete(place.key)
    return kept
  }

  await turns.get(place.key)
  const found = await invoke<unknown>('terminal_history_read', {
    space: place.space,
    key: place.key,
  }).catch(() => null)
  return readHistory(found)
}

/** A terminal's screen, written down in place of the last. */
export function keepHistory(place: Place, history: History): void {
  if (!place.key) return
  void inTurn(place.key, () =>
    invoke('terminal_history_write', { space: place.space, key: place.key, history }),
  )
}

/** A tab closed: its file goes, and its last screen is kept in memory for this run, in
 *  case the tab comes back through Reopen closed tab. */
export function dropHistory(place: Place, last: History | null): void {
  if (!place.key) return

  if (last) {
    closed.delete(place.key)
    closed.set(place.key, last)
    for (const key of closed.keys()) {
      if (closed.size <= KEPT_CLOSED) break
      closed.delete(key)
    }
  }

  void inTurn(place.key, () =>
    invoke('terminal_history_forget', { space: place.space, key: place.key }),
  )
}

/** A terminal moved to another space: its lines go with it, written under the new space
 *  before the old file goes, in the key's own turn - so a write already on its way to the
 *  old place lands first and moves with the rest, and the next one finds the new place.
 *  Nothing is lost if the read finds nothing: there was nothing to move. */
export function moveHistory(from: Place, to: Place): void {
  if (!from.key || from.space === to.space) return
  void inTurn(from.key, async () => {
    const found = readHistory(
      await invoke<unknown>('terminal_history_read', { space: from.space, key: from.key }),
    )
    if (found) {
      await invoke('terminal_history_write', { space: to.space, key: to.key, history: found })
    }
    await invoke('terminal_history_forget', { space: from.space, key: from.key })
  })
}

/** Every history there is, forgotten: Restore history turned off. After whatever was
 *  already on its way, which would otherwise land in the folder just emptied. */
export function forgetHistories(): void {
  closed.clear()
  const before = Promise.all(turns.values())
  writing(
    before
      .then(() => invoke('terminal_history_forget', { space: null, key: null }))
      .catch(() => undefined),
  )
}

/** Where the last lines were kept before they were the crate's: one entry of this page's
 *  storage for every terminal, a dozen at most. */
const LEGACY = 'nib:terminal-lines'

/** The lines the old entry held for the terminals that are open, moved into files; the
 *  entry itself goes, with the lines of terminals closed long ago that it still held. */
export function moveLegacy(open: readonly Place[]): void {
  const value = stored(LEGACY)
  if (value === null) return
  forget(LEGACY)
  if (!isRecord(value)) return

  for (const place of open) {
    const one = place.key ? value[place.key] : undefined
    if (!isRecord(one) || !isString(one.text) || !one.text) continue
    keepHistory(place, {
      cols: 0,
      rows: 0,
      at: isNumber(one.at) ? one.at : Date.now(),
      text: one.text,
    })
  }
}
