/** The activity UI, started: the store, and everything that follows it for as long as
 *  the window lives.
 *
 *  Started by the first agent event the shell hears (agent-marks.svelte.ts), or by the
 *  activity panel being opened, whichever is first, and only ever once. What it keeps
 *  up to date is small and all of it is the shell's: which tabs wear a mark, the badge,
 *  the takeovers, whether closing the window hides it, the stop's key from any app, and
 *  the pairing bubble while a client is asking. */

import { mount, unmount, untrack } from 'svelte'
import { agentMarks } from '../../agent-marks.svelte'
import { t } from '../../i18n.svelte'
import { shortcuts } from '../../shortcuts.svelte'
import { accelerator } from './accelerator'
import { Activity } from './activity.svelte'
import { nextLapse, sameMarks, wornAt } from './marks'
import PairingBubble from './PairingBubble.svelte'
import { readEvent } from './read'
import { crate, type Source } from './source'
import type { NoteDoc } from '../../workspace/documents.svelte'

/** How long past an acting tab's lapse its timer fires, so the look it takes is on the
 *  far side of the edge rather than a millisecond short of it. */
const PAST = 20

let running: Activity | null = null

/** Stops following the store: the effect root the UI was started with. */
let unfollow: (() => void) | null = null

/** The activity UI, started once. Answers the store; `hear` is what the door hands
 *  each event to. */
export function started(source: Source = crate): Activity {
  if (running) return running

  const activity = new Activity(source)
  running = activity
  agentMarks.heard = true
  agentMarks.act = (tab, what) => void activity.act(tab, what)
  agentMarks.hide = () => source.hide().catch(() => false)

  unfollow = $effect.root(() => {
    // Which tabs wear a mark: written only when one changed, since the strip and every
    // web tab read it.
    $effect(() => {
      const worn = wornAt(activity.seen, activity.now, (agent) => activity.colourOf(agent))
      untrack(() => {
        if (!sameMarks(worn, agentMarks.on)) agentMarks.on = worn
      })
    })

    // An acting tab lets go once nothing has called on it for a while: looked at again
    // when the first of them is due, and not before.
    $effect(() => {
      const now = activity.now
      const next = nextLapse(activity.seen, now)
      if (next === null) return

      const timer = setTimeout(() => (activity.now = Date.now()), next - now + PAST)
      return () => clearTimeout(timer)
    })

    // The badge on the panel's tab, and the takeovers each web tab puts under its bar.
    $effect(() => {
      agentMarks.waiting = activity.questions.length
      agentMarks.takeovers = Object.fromEntries(
        activity.seen.approvals.flatMap((one) =>
          one.category === 'takeover' && one.tab !== undefined
            ? [[one.tab, { id: one.id, reason: one.summary }] as const]
            : [],
        ),
      )
    })

    // While an agent is connected: the stop answers from any app, the tray has its
    // rows, and closing the window that holds the agents' pages hides it instead.
    const connected = $derived(activity.seen.connected.length > 0)
    const key = $derived(connected ? shortcuts.keyFor('agents.stop') : null)
    $effect(() => {
      agentMarks.holding = connected && activity.holds
    })
    $effect(() => {
      const system = key === null ? null : accelerator(key, shortcuts.platform)
      const words = {
        show: t('Open'),
        stop: t('Stop agents'),
        quit: t('Quit'),
        stopped: t('Agents stopped'),
        closed: t('Agent tabs closed'),
        hidden: t('nibeditor is still running for your agents'),
        pairing: t('{client} wants to connect'),
      }
      untrack(() => void source.shell(system, words).catch(() => undefined))
    })

    // A client asking to become an agent: the bubble, for as long as it asks.
    const pairing = $derived(activity.seen.approvals.some((one) => one.category === 'pairing'))
    $effect(() => {
      if (!pairing) return
      const bubble = untrack(() =>
        mount(PairingBubble, { target: document.body, props: { activity } }),
      )
      return () => void unmount(bubble, { outro: true })
    })
  })

  void activity.load().catch(() => undefined)
  return activity
}

/** The UI taken down, and the shell told nothing is known: for a test that starts it
 *  again against a crate of its own. */
export function ended(): void {
  unfollow?.()
  unfollow = null
  running = null
  agentMarks.on = {}
  agentMarks.heard = false
  agentMarks.waiting = 0
  agentMarks.takeovers = {}
  agentMarks.holding = false
  agentMarks.act = null
  agentMarks.hide = null
}

/** The door's side: starts the UI if it was not, and hands it the event. */
export function start(source: Source = crate): (event: unknown) => void {
  const activity = started(source)
  return (payload) => {
    const event = readEvent(payload)
    if (event) activity.hear(event)
  }
}

/** The stop key, the tray's row and the panel's: every agent. A second press, with
 *  everything already stopped, closes their tabs; see stop.rs. A window no agent has
 *  spoken to has nothing to stop, and a stop pressed there would hold the next agent
 *  that comes, so it does nothing. */
export function stopAgents(): void {
  void running?.stop().catch(() => undefined)
}

/** An agent wrote in a note: the tabs showing it wear its mark. */
export function wrote(note: NoteDoc, agent: string): void {
  started().wrote(note, agent)
}
