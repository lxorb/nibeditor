/** A web note is open in one tab of one window, across every window of this app.
 *
 *  Within a window the strip itself sees to it (`secondWebTabs` in workspace/open.ts). Between two
 *  windows nothing is shared but storage and a channel, so each says on the channel
 *  which web notes it holds and since when, the way the web logins say which leases a
 *  window uses (web-sync.svelte.ts):
 *
 *  - Opening a web note another window holds opens nothing here: that window shows its
 *    tab and comes forward, as Chrome's "Switch to tab" goes to the window a tab is in.
 *  - Two windows that came to hold one anyway - a session restored in a second window,
 *    two opens in the same instant - settle it by who had it first: the later tab
 *    becomes an unsaved web tab at the same page, which is what a second tab of a web
 *    note is made in one window too.
 *
 *  Started with the launch's later turns and fetched by the first open of a web note
 *  before that; a window that has not heard from the others yet simply knows of none. */

import { untrack } from 'svelte'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'

interface Said {
  window?: unknown
  held?: unknown
  ask?: unknown
  show?: unknown
  to?: unknown
}

const me = crypto.randomUUID()
/** What each other window holds: path and when it came to hold it. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what the other windows said; nothing renders from it
const others = new Map<string, Map<string, number>>()
/** What this one holds, and since when. */
let mine = new Map<string, number>()
let channel: BroadcastChannel | null = null

const say = (what: object) => channel?.postMessage({ window: me, ...what })

/** Whether another window has this web note open. */
export function heldElsewhere(path: string): boolean {
  return [...others.values()].some((held) => held.has(path))
}

/** Asks the window holding a web note to show it. */
export function showElsewhere(path: string): void {
  const to = [...others.entries()].find(([, held]) => held.has(path))?.[0]
  if (to) say({ show: path, to })
}

function heard(said: Said) {
  if (said.ask === true) say({ held: [...mine] })
  if (typeof said.window !== 'string' || said.window === me) return

  if (typeof said.show === 'string' && said.to === me) show(said.show)
  if (!Array.isArray(said.held)) return

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what one window said; nothing renders from it
  const theirs = new Map<string, number>()
  for (const one of said.held as unknown[]) {
    if (Array.isArray(one) && typeof one[0] === 'string' && typeof one[1] === 'number') {
      theirs.set(one[0], one[1])
    }
  }
  others.set(said.window, theirs)
  settle(said.window, theirs)
}

/** A web note both windows hold goes to whoever had it first; the other ties break
 *  by the windows' own names, so both sides reach the same answer. */
function settle(window: string, theirs: Map<string, number>) {
  for (const [path, since] of mine) {
    const other = theirs.get(path)
    if (other === undefined) continue
    if (since < other || (since === other && me < window)) continue

    const tab = workspace.tabs.find((one) => one.kind === 'web' && one.path === path)
    if (tab) workspace.asUnsaved(tab, tab)
  }
}

function show(path: string) {
  const tab = workspace.tabs.find((one) => one.kind === 'web' && one.path === path)
  if (!tab) return

  workspace.activate(tab.id)
  void invoke('show_window').catch(() => undefined)
}

let started = false

/** Starts listening, once: on the first import, which is the launch or an open. */
function start(): void {
  if (started || typeof BroadcastChannel !== 'function' || typeof window === 'undefined') return
  started = true

  channel = new BroadcastChannel('nib:web-notes')
  channel.onmessage = (event: MessageEvent<Said>) => {
    heard(event.data)
  }
  say({ ask: true })
  window.addEventListener('pagehide', () => say({ held: [] }))

  // What this window holds, said whenever it changes.
  $effect.root(() => {
    $effect(() => {
      const paths = workspace.tabs.flatMap((one) =>
        one.kind === 'web' && one.path !== null ? [one.path] : [],
      )
      untrack(() => {
        const now = Date.now()
        mine = new Map(paths.map((path) => [path, mine.get(path) ?? now]))
        say({ held: [...mine] })
        for (const [window, theirs] of others) settle(window, theirs)
      })
    })
  })
}

start()
