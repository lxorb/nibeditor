/** The keys that reach Orden from other apps, as the crate holds them
 *  (src-tauri/src/hotkeys.rs): quick add's and the agents' stop.
 *
 *  Windows, a Mac and X11 take the key the list says, and there is nothing to add to
 *  the row. A Wayland session decides for itself, through the desktop portal: the key
 *  the list says is only a wish, and the system says back the key it gave, which may
 *  be another or none yet. And on a desktop with no portal for keys - sway, an older
 *  GNOME - no key reaches the app from another one at all, and what does is a command
 *  bound in the desktop's own shortcuts. The row says whichever of those is true, in
 *  one line, rather than showing a key that does nothing. */

import { t } from './i18n.svelte'
import { invoke, isDesktop } from './tauri'

/** What the crate says; `Keys` in hotkeys.rs. */
export interface GlobalKeys {
  reach: 'system' | 'portal' | 'none'
  change: boolean
  held: Record<string, string>
  refused: string[]
  run: string
}

/** The flag that presses each key from a command line, by the registry's id. */
const FLAGS: Readonly<Record<string, string>> = {
  'app.quick-add': '--quick-add',
  'agents.stop': '--stop-agents',
}

/** One line under a shortcut's name, and whether the system's own page for the keys
 *  can be opened from it. */
export interface Note {
  text: string
  change: boolean
}

/** A key as both sides write it, so `Ctrl+Alt+Space` and `CTRL+ALT+space` agree. */
const plain = (key: string) =>
  key
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/control/g, 'ctrl')
    .replace(/logo|meta|win/g, 'super')

/** What the row of shortcut `id`, showing `shown`, says about other apps: nothing
 *  where the list's key is the whole story. */
export function noteFor(keys: GlobalKeys | null, id: string, shown: string | null): Note | null {
  const flag = FLAGS[id]
  if (!keys || !flag || keys.reach === 'system') return null
  if (keys.reach === 'none') {
    return {
      text: t('From other apps: bind {command} in your system settings', {
        command: `${keys.run} ${flag}`,
      }),
      change: false,
    }
  }
  const given = keys.held[id]
  if (keys.refused.includes(id) || given === '') {
    return { text: t('From other apps: set in your system settings'), change: keys.change }
  }
  if (given === undefined || (shown !== null && plain(given) === plain(shown))) return null
  return { text: t('From other apps: {key}', { key: given }), change: keys.change }
}

class Global {
  keys = $state<GlobalKeys | null>(null)
  #asked = false

  /** Asks the crate once, and follows it from then on. */
  follow() {
    if (this.#asked || !isDesktop) return
    this.#asked = true
    void invoke<GlobalKeys>('global_keys')
      .then((keys) => (this.keys = keys))
      .catch(() => undefined)
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<GlobalKeys>('nib://global-keys', (event) => (this.keys = event.payload)),
    )
  }

  /** The system's own page for the keys. */
  change() {
    void invoke('global_keys_change').catch(() => undefined)
  }
}

export const globalKeys = new Global()
