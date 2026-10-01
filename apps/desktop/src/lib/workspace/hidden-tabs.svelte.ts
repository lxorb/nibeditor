/** Hidden tabs: whether the pages of a space's set out of sight keep running, are paused,
 *  or the reader is asked the first time it matters.
 *
 *  Emil, 2026-10-01: *"there should be a setting whether the stuff is paused when you
 *  switch to another space or whether it keeps running in the background. The first time
 *  you switch and you haven't decided yet, you should be asked in a modal."*
 *
 *  - **Keep running** treats them as any tab out of sight: frozen after five minutes
 *    unless something in it has to go on (web-tab/resting.ts), so a page in another space
 *    costs the space on screen nothing it would not cost as a background tab, and a call
 *    or a song goes on. The space's row says so with the tab's speaker; see
 *    SpaceSound.svelte.
 *  - **Pause** stops what plays and freezes the page at once - WebView2's own suspend, the
 *    page lifecycle's freeze on nib's Chromium - and the page comes back as it was the
 *    moment its space is shown again, with no reload. See web_pause.rs. A page in a call, or
 *    capturing the camera, the microphone or the screen, is one the engine will not
 *    freeze, as Chrome and Edge never freeze one; it goes on running.
 *  - **Ask** until the reader has said: the first switch away from a set with a page
 *    running asks, once, in the app's own question sheet, and the answer becomes the
 *    setting. Dismissed, the pages run this time and the next switch asks again.
 *
 *  A terminal is never paused either way. A shell stopped behind the reader's back is a
 *  build that never finishes and a server that stops answering; VS Code keeps its
 *  terminals running in a process of their own for the same reason. What sleeps is its
 *  drawing, which only happens for a screen that is shown. And an agent's own pages are
 *  never in a set at all, so nothing here touches them; a tab of the reader's that an
 *  agent is acting in is left running too. A frozen page keeps its web login's lease:
 *  nothing about which computer runs the site has changed, and the lease's own idle
 *  release still applies (lease.svelte.ts).
 *
 *  This machine's, like the engine: what a hidden page may cost is a question about this
 *  computer. */

import { agentMarks } from '../agent-marks.svelte'
import { key, t } from '../i18n.svelte'
import { keep, stored } from '../stored'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { type HiddenTabs, isHiddenTabs, onLeaving } from './sets'

const STORAGE_KEY = 'nib:hidden-tabs'

/** Ask until somebody has answered. */
function read(): HiddenTabs {
  const kept = stored(STORAGE_KEY)
  return isHiddenTabs(kept) ? kept : 'ask'
}

/** Whether a tab's page is running and is the reader's to pause. */
function running(tab: Tab): boolean {
  return tab.kind === 'web' && pages.of(tab.id).live && !(tab.id in agentMarks.on)
}

class Hidden {
  choice = $state<HiddenTabs>(read())

  /** The tabs whose pages this run paused, so coming back resumes only those. */
  private paused = new Set<string>()
  /** The question while it is up, so two switches in a row ask once. */
  private asking: Promise<string | null> | null = null

  /** The answer, from the setting or from the question; what it means for the pages
   *  already out of sight follows at once. */
  set(choice: HiddenTabs) {
    this.choice = choice
    keep(STORAGE_KEY, JSON.stringify(choice))

    if (choice === 'pause') {
      for (const tab of this.hidden()) this.pause(tab.id)
    } else {
      for (const id of [...this.paused]) this.resume(id)
    }
  }

  /** A set has gone out of sight with these tabs. */
  async left(tabs: readonly Tab[]): Promise<void> {
    const pausing = tabs.filter(running)
    const doing = onLeaving(this.choice, pausing.length)
    if (doing === 'run') return
    if (doing === 'ask' && (await this.ask()) !== 'pause') return

    // Only what is still out of sight: the reader may have gone back while asked.
    for (const tab of pausing) if (!workspace.panes.at(tab.paneId)) this.pause(tab.id)
  }

  /** A set has come into sight: what was paused in it runs again. */
  came(tabs: readonly Tab[]) {
    for (const tab of tabs) if (this.paused.has(tab.id)) this.resume(tab.id)
  }

  /** The question, once at a time. Answered, it is the setting from then on; dismissed,
   *  it is nothing, and the next switch asks again. */
  private ask(): Promise<string | null> {
    this.asking ??= import('../prompt.svelte')
      .then(({ prompt }) =>
        prompt.choose({
          title: t('Hidden tabs'),
          options: [
            { id: 'run', label: key('Keep running'), primary: true },
            { id: 'pause', label: key('Pause') },
          ],
        }),
      )
      .then((said) => {
        if (said === 'run' || said === 'pause') this.set(said)
        return said
      })
      .finally(() => (this.asking = null))

    return this.asking
  }

  /** Every running page in a set out of sight. */
  private hidden(): Tab[] {
    return workspace.tabs.filter((tab) => running(tab) && !workspace.panes.at(tab.paneId))
  }

  /** Through the pages' own freeze, the one a page out of sight in the space on screen
   *  is given too, so the two never undo each other; see resting.ts. */
  private pause(tab: string) {
    this.paused.add(tab)
    pages.freeze(tab)
  }

  private resume(tab: string) {
    this.paused.delete(tab)
    void pages.thaw(tab)
  }
}

export const hiddenTabs = new Hidden()
