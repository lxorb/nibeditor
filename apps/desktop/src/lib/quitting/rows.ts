/** What would stop if this window went: the rows the question before quitting lists.
 *
 *  A terminal whose shell runs something besides itself - Claude Code, `npm run dev`, a
 *  training run - or that is another machine's and connected (the crate's answer; see
 *  `Held::busy` in src-tauri/src/terminal.rs), and an AI turn still answering, Claude Code
 *  and Codex threads among them. Named the way their tab and their thread are named, so
 *  the list reads as the strip does: `claude · quaestur`, the title Claude Code set, a
 *  thread's title.
 *
 *  Every tab of the window counts, in whichever space's set it is: a shell in a space out
 *  of sight runs as much as one on screen. A terminal put back after a restart and never
 *  looked at runs nothing yet, and is not a row. */

import { t } from '../i18n.svelte'
import { invoke } from '../tauri'
import { ptyOf, runningTabs } from '../terminal/running'
import type { Warning } from '../terminal/shells.svelte'
import { type Tab, workspace } from '../workspace.svelte'

/** Why the question is asked: the app quitting, a window closing, or an update's
 *  restart. */
export type Why = 'quit' | 'window' | 'restart'

/** One thing that would stop. Plain data, since another window's rows arrive over a
 *  broadcast channel; see windows.ts. */
export interface Row {
  /** The window it is in, by label. */
  window: string
  kind: 'terminal' | 'thread'
  /** The tab's id, or the thread's. */
  id: string
  name: string
  /** Whether something runs in it; false only for an idle shell, which is a row when
   *  Settings says to ask whenever a terminal is open. */
  busy: boolean
  /** What its mark is drawn from (TerminalMark.svelte): a terminal's own, and Claude
   *  Code or Codex for a thread they answer. A thread of a provider nib asks itself has
   *  none, and wears the AI's spark. */
  doc?: string
  running?: Tab['running']
}

/** Whether to ask at all, out of what Settings says and what was found. */
export function asks(warning: Warning, rows: readonly Row[]): boolean {
  if (warning === 'never') return false
  return warning === 'always' ? rows.length > 0 : rows.some((row) => row.busy)
}

/** This window's rows. `idle` takes the shells at their prompt too. */
export async function rowsHere(window: string, idle: boolean): Promise<Row[]> {
  const [terminals, threads] = await Promise.all([terminalRows(window, idle), threadRows(window)])
  return [...terminals, ...threads]
}

async function terminalRows(window: string, idle: boolean): Promise<Row[]> {
  const live = new Set(runningTabs())
  const tabs = workspace.tabs.filter((tab) => tab.kind === 'terminal' && live.has(tab.id))

  const rows = await Promise.all(
    tabs.map(async (tab): Promise<Row | null> => {
      const id = ptyOf(tab.id)
      if (id === undefined) return null
      const busy = await invoke<boolean>('pty_busy', { id }).catch(() => false)
      if (!busy && !idle) return null
      return {
        window,
        kind: 'terminal',
        id: tab.id,
        name: tab.shown,
        busy,
        doc: tab.doc,
        // A copy: the tab's own is a rune, which no channel can carry.
        running: tab.running ? { ...tab.running } : null,
      }
    }),
  )
  return rows.filter((row) => row !== null)
}

/** The turns answering now. The AI's store is only asked once one is, which means it
 *  has been fetched already. */
async function threadRows(window: string): Promise<Row[]> {
  const { answering } = await import('../ai/chat/sends')
  const threads = answering()
  if (!threads.length) return []

  const { ai } = await import('../ai/store.svelte')
  return threads.map((thread) => {
    const kind = ai.providers.find((one) => one.id === thread.provider)?.kind
    const program = kind === 'claude-code' ? 'claude' : kind === 'codex' ? 'codex' : null
    return {
      window,
      kind: 'thread',
      id: thread.id,
      name: thread.title || t('Untitled'),
      busy: true,
      ...(program ? { doc: '', running: { name: null, program, host: null, colour: null } } : {}),
    }
  })
}
