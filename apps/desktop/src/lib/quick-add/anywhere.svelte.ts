/** Quick add over every other app: the key handed to the system, and the tasks the
 *  global window sends written (docs/tasks.md 5.6).
 *
 *  The key is the app's own (`app.quick-add`, Ctrl+Alt+Space unless the reader moved it)
 *  and is held only while Settings' From any app is on. The crate registers it and opens
 *  the small window it shows (src-tauri/src/quick_add.rs); the window reads its line
 *  itself and hands the task here, where the workspace is, so it is written the way
 *  every other task is.
 *
 *  Several windows of the app may be open and each starts this. One of them answers,
 *  the one holding the lock; when it closes, the next takes the lock and the key. */

import { untrack } from 'svelte'
import { accelerator } from '../accelerator'
import { i18n } from '../i18n.svelte'
import { log } from '../log'
import { shortcuts } from '../shortcuts.svelte'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { quickAdd } from './asked.svelte'
import { ANSWERING, CHANNEL, heard, type Said } from './channel'
import { addTask, noteNames } from './write'

/** Starts answering, once this window holds the lock; answers the way to stop. */
export function listen(): () => void {
  const stopping = new AbortController()
  let stopKey: (() => void) | null = null
  let channel: BroadcastChannel | null = null

  const answer = (said: Said) => {
    if (said.kind === 'hello') {
      const root = workspace.activeSpace?.root
      channel?.postMessage({
        kind: 'world',
        notes: root ? noteNames(root).slice(0, 400) : [],
        lang: i18n.language,
        smart: quickAdd.smart,
      } satisfies Said)
    } else if (said.kind === 'task') {
      void addTask(said.entry, { open: said.open }).catch((error: unknown) => {
        log('error', `quick add: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  void navigator.locks
    .request(ANSWERING, { signal: stopping.signal }, () => {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (event: MessageEvent) => {
        const said = heard(event.data)
        if (said) answer(said)
      }
      stopKey = $effect.root(() => {
        $effect(() => {
          const key = quickAdd.anywhere
            ? accelerator(shortcuts.keyFor('app.quick-add'), shortcuts.platform)
            : null
          untrack(() => {
            void invoke<string | null>('quick_add_key', { key })
              .then((now) => (quickAdd.held = now !== null))
              .catch(() => (quickAdd.held = false))
          })
        })
      })
      // Held for as long as this window answers.
      return new Promise<void>((resolve) =>
        stopping.signal.addEventListener('abort', () => resolve()),
      )
    })
    .catch(() => {
      // Stopped before the lock came: another window answers, and still does.
    })

  return () => {
    stopping.abort()
    stopKey?.()
    channel?.close()
    if (stopKey) void invoke('quick_add_key', { key: null }).catch(() => undefined)
    quickAdd.held = false
  }
}
