/** A page out of sight: when it is frozen, and when Memory saver takes it down.
 *
 *  Emil, 2026-10-01: *"When I cycle with Ctrl+Tab through my tabs, some of them fully
 *  reload every time [...] the default must be that tabs don't reload."* They did because
 *  a seventh running page parked the one looked at longest ago, so a cycle through more
 *  than six tabs parked each one just before it came round again.
 *
 *  So by default nothing is ever taken down for being one too many or out of sight too
 *  long. A page out of sight is **frozen** instead, which is Edge's sleeping tab and
 *  Chrome's freezing: its timers and scripts stop, the engine gives most of its memory
 *  back, and it keeps its document, its place, what was typed into it and its login, so
 *  showing it again is a frame and never a load. The one way to do that is web_pause.rs,
 *  which Hidden tabs' Pause uses too.
 *
 *  **Memory saver** is the setting that does take pages down, off unless chosen, in
 *  Chrome's three strengths. A parked page keeps its address, its place and its trail
 *  and loads again when it is looked at; see `park` in pages.svelte.ts.
 *
 *  Pure, so the rules are tested on numbers; pages.svelte.ts carries them out, and
 *  docs/web-tabs.md has the products each number was held against. */

/** Memory saver: off, or how hard it works. */
export type Saver = 'off' | 'moderate' | 'balanced' | 'maximum'

/** The four, in the order they are offered: from never to soonest. */
export const SAVERS: readonly Saver[] = ['off', 'moderate', 'balanced', 'maximum']

export function isSaver(value: unknown): value is Saver {
  return SAVERS.some((one) => one === value)
}

/** How long a page runs out of sight before it is frozen, and how long after it was last
 *  heard.
 *
 *  Five minutes. Going back and forth between pages is seconds to a few minutes, and a
 *  page in that use stays running, so nothing about it changes. Past five minutes a page
 *  is one somebody went away from: it is where Chrome starts throttling a hidden page's
 *  timers to once a minute and may freeze one, and the soonest Edge's efficiency mode puts
 *  a tab to sleep. Waking one costs a frame, so there is nothing to gain by waiting
 *  longer, as Edge's own default of two hours does. */
export const FROZEN_AFTER = 5 * 60_000

/** What each strength of Memory saver takes down: any page out of sight for `after`, and
 *  those out of sight beyond the `live` running.
 *
 *  Chrome's strengths are time alone: six hours, four and two. The first two are taken
 *  as they are, with a count beside them, because a page here costs about 180 MB
 *  (`scripts/web-switch-probe.py`) and a day of reading never reaches four hours out of
 *  sight: sixteen pages is about 2.9 GB, ten about 1.8. Maximum is what nib did before
 *  there was a choice, half an hour and six at a gigabyte, because a strength that never
 *  takes a page in a working day would not be the most it can do. */
export const SAVING: Record<Exclude<Saver, 'off'>, { live: number; after: number }> = {
  moderate: { live: 16, after: 6 * 60 * 60_000 },
  balanced: { live: 10, after: 4 * 60 * 60_000 },
  maximum: { live: 6, after: 30 * 60_000 },
}

/** What the rules read of one tab's page. */
export interface Resting {
  id: string
  live: boolean
  /** Shown in a pane on screen, or the tab in front of one under something of the app's. */
  onScreen: boolean
  frozen: boolean
  /** When it went out of sight, or was last looked at. */
  looked: number
  loading: boolean
  /** Heard now: a song or a call somebody left running on purpose. */
  playing: boolean
  /** When it last stopped being heard, or nought: the next track is a moment away. */
  heard: number
  /** An agent is acting in it, through the engine's own protocol. */
  acting: boolean
  /** Its site was given the camera or the microphone, so it may be in a call. */
  calling: boolean
  /** Its site was allowed to notify, so it is a page somebody expects to hear from. */
  notifying: boolean
  /** A field typed into and not sent, which a load would lose. */
  edited: boolean
  pinned: boolean
  /** A private tab's, whose session ends with its last page; see private.ts. */
  inPrivate: boolean
}

/** Whether a page may be frozen: out of sight, and nothing in it somebody is listening
 *  to, talking through, waiting to hear from, or letting an agent work in. Chrome and
 *  Edge leave the same pages running. */
export function mayFreeze(page: Resting, now: number): boolean {
  return page.live && !page.onScreen && !page.frozen && running(page, now)
}

/** Whether Memory saver may take a page down: as `mayFreeze`, frozen or not, and never a
 *  pinned one or one with something typed into it, which Chrome's never takes either -
 *  nor a private one, whose page is the whole of what it holds: built again it would be
 *  signed out of everything, its last page would have ended its session. */
export function mayPark(page: Resting, now: number): boolean {
  return (
    page.live &&
    !page.onScreen &&
    !page.edited &&
    !page.pinned &&
    !page.inPrivate &&
    running(page, now)
  )
}

/** Nothing in the page that has to go on. */
function running(page: Resting, now: number): boolean {
  const quiet = !page.playing && now - page.heard >= FROZEN_AFTER
  return quiet && !page.loading && !page.acting && !page.calling && !page.notifying
}

/** What happens to a page out of sight now, and how long until it is asked again; null
 *  for never. A page held up - playing, or typed into - is asked again a freeze's wait
 *  later. */
export function rest(
  page: Resting,
  saver: Saver,
  now: number,
): { act: 'freeze' | 'park' | null; again: number | null } {
  const away = now - page.looked
  const saving = saver === 'off' ? null : SAVING[saver]
  if (saving && away >= saving.after && mayPark(page, now)) return { act: 'park', again: null }

  const freezing = away >= FROZEN_AFTER && mayFreeze(page, now)
  const waits = [
    page.frozen || freezing ? null : FROZEN_AFTER - away,
    saving ? saving.after - away : null,
  ].filter((wait) => wait !== null)

  const soonest = waits.length ? Math.min(...waits) : null
  return {
    act: freezing ? 'freeze' : null,
    again: soonest === null ? null : soonest > 0 ? soonest : FROZEN_AFTER,
  }
}

/** The pages Memory saver takes down because more are running than its strength keeps:
 *  those it may, looked at longest ago first. None while it is off. */
export function overCap(pages: readonly Resting[], saver: Saver, now: number): string[] {
  if (saver === 'off') return []

  const live = pages.filter((page) => page.live)
  const over = live.length - SAVING[saver].live
  if (over <= 0) return []

  return live
    .filter((page) => mayPark(page, now))
    .sort((one, other) => one.looked - other.looked)
    .slice(0, over)
    .map((page) => page.id)
}
