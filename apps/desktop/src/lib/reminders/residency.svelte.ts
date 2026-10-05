/** Whether nib stays in the tray when its window is closed (docs/tasks.md decision 6).
 *
 *  Todoist's way: on by default while there is a reason, a reminder waiting or the
 *  global quick add key held, and off otherwise; one switch in Settings makes it the
 *  reader's choice from then on. A desktop with a tray only, Windows and a Mac, where
 *  the crate holds the one tray the agents use as well (agents/shell.rs). On Windows and
 *  a Mac a reminder rings from the system's own schedule either way; the tray is what
 *  keeps Done and the quick add key a moment away. */

import { t } from '../i18n.svelte'
import { keep, storedText } from '../stored'
import { invoke, isDesktop, platform } from '../tauri'
import { keptInTray } from '../parting'

const KEY = 'nib.tray'

type Choice = 'auto' | 'on' | 'off'

/** Whether this desktop has a tray to stay in at all. */
export const hasTray = isDesktop && ['windows', 'macos'].includes(platform())

function choiceOf(text: string | null): Choice {
  return text === 'on' || text === 'off' ? text : 'auto'
}

/** Hides the window into the tray; false where the crate would not, because nothing
 *  keeps nib there any more. */
const hide = (): Promise<boolean> =>
  invoke<boolean>('agents_hold', { hide: true }).catch(() => false)

class Residency {
  /** The reader's choice, or `auto` until they made one. */
  choice = $state<Choice>(choiceOf(storedText(KEY)))

  /** Whether a reminder is waiting: the scheduler says. */
  waiting = $state(false)

  /** Whether the global quick add key is held: the quick add says. */
  quickAdd = $state(false)

  /** Whether nib stays in the tray now. */
  get on(): boolean {
    if (!hasTray) return false
    if (this.choice !== 'auto') return this.choice === 'on'
    return this.waiting || this.quickAdd
  }

  /** The switch in Settings: the reader's choice from now on. */
  set(on: boolean) {
    this.choice = on ? 'on' : 'off'
    keep(KEY, this.choice)
    this.apply()
  }

  /** Tells the close handler and the crate. Decides from the fields alone, so an effect
   *  may call it. */
  apply(on = this.on) {
    keptInTray(on ? hide : null)
    if (!hasTray) return
    void invoke('tray_keep', { on, words: { show: t('Open'), quit: t('Quit') } }).catch(
      () => undefined,
    )
  }
}

export const residency = new Residency()
