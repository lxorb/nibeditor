<script lang="ts">
  /** The global quick add window: the field and nothing else, over whatever app is in
   *  front (docs/tasks.md 5.6). The crate shows it on the key and hides it again on
   *  Escape, on a task added and as soon as it is left; see src-tauri/src/quick_add.rs.
   *
   *  It writes nothing itself. What the line needs to be read - the space's notes, the
   *  app's language - it asks the app for as it opens, and the task it hands back over
   *  the same channel, so it is written where the workspace is (anywhere.svelte.ts). */
  import { onMount } from 'svelte'
  import { invoke } from '../tauri'
  import { CHANNEL, heard, type Said } from './channel'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'

  let notes = $state<string[]>([])
  let langs = $state<string[]>([navigator.language])
  let smart = $state(true)
  /** Which showing this is, so the field starts empty each time the key is pressed. */
  let shown = $state(0)

  const channel = new BroadcastChannel(CHANNEL)
  const say = (said: Said) => channel.postMessage(said)

  channel.onmessage = (event: MessageEvent) => {
    const said = heard(event.data)
    if (said?.kind !== 'world') return
    notes = said.notes
    langs = [said.lang]
    smart = said.smart
  }

  const hide = (raise = false) => void invoke('quick_add_hide', { raise }).catch(() => undefined)

  function added(entry: Entry, open: boolean) {
    say({ kind: 'task', entry, open })
    hide(open)
  }

  onMount(() => {
    // Asked again each time it comes back, since the space in front may have changed.
    const again = () => {
      if (document.visibilityState !== 'visible') return
      shown++
      say({ kind: 'hello' })
    }
    again()
    document.addEventListener('visibilitychange', again)
    // Left for another app: put away, the way every launcher's field is.
    const left = () => hide()
    window.addEventListener('blur', left)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('blur', left)
      channel.close()
    }
  })
</script>

<main>
  {#key shown}
    <QuickAdd {langs} {notes} {smart} onsubmit={added} onclose={() => hide()} />
  {/key}
</main>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--surface);
  }

  main {
    height: 100%;
  }
</style>
