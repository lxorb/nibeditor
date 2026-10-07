<script lang="ts">
  /** A chat in a tab (docs/chats.md 4.15): its head, its rows, its composer, and one
   *  message's replies beside it. The tab's file is the chat's `.chat` pointer; which
   *  chat it names is the store's to read (4.2).
   *
   *  The layers a chat puts up live here, once for the tab: the emoji picker (for the
   *  composer and for reactions), the lightbox, a new poll, the bubble. A file dropped
   *  anywhere on the chat lands in the composer. Ctrl+J goes to the New line and
   *  Escape to the bottom (4.16). On a phone the replies are the page. */
  import type { FileRef, Message, Poll } from '@nib/chats'
  import { onDestroy, untrack } from 'svelte'
  import EmojiPicker from '../../emoji/EmojiPicker.svelte'
  import { t } from '../../i18n.svelte'
  import { shortcuts } from '../../shortcuts.svelte'
  import { samePath } from '../../space-paths'
  import { viewport } from '../../viewport.svelte'
  import type { Tab } from '../../workspace.svelte'
  import { ChatPage } from './chat.svelte'
  import ChatHead from './ChatHead.svelte'
  import Composer from './Composer.svelte'
  import Float from './Float.svelte'
  import Glyph from './Glyph.svelte'
  import Lightbox from './Lightbox.svelte'
  import { isPicture, isVideo } from './media'
  import { hearJumps, takeJump } from './open'
  import type { Box } from './place'
  import PollSheet from './PollSheet.svelte'
  import Replies from './Replies.svelte'
  import { store } from './source.svelte'
  import Timeline from './Timeline.svelte'
  import Tip from './Tip.svelte'

  const { tab }: { tab: Tab } = $props()

  let page = $state<ChatPage | null>(null)
  let missing = $state(false)
  let width = $state(0)
  let timeline = $state<{
    toNew: () => void
    toBottom: () => Promise<void>
    focusRows: () => void
  }>()
  let composer = $state<{ focus: () => void; addFiles: (files: readonly File[]) => void }>()
  let picking = $state<{ at: Box; pick: (emoji: string) => void } | null>(null)
  let looking = $state<{ files: FileRef[]; start: number } | null>(null)
  let polling = $state<((poll: Poll) => void) | null>(null)
  let dropping = $state(false)

  const space = $derived(page?.entry?.space ?? null)
  const phone = $derived(viewport.device === 'phone')

  // The chat the pointer names, opened once the store has started and says which it is:
  // a tab put back by the launch comes before the store does.
  $effect(() => {
    const path = tab.path
    if (!path || !store().ready) return
    untrack(() => {
      void store()
        .chatAt(path)
        .then((id) => {
          missing = !id
          if (!id || page?.id === id) return
          page?.close()
          page = new ChatPage(id)
        })
    })
  })

  /** A message a link or a search hit asked this chat to open at, once it is open. */
  function jumpWaiting() {
    if (!page?.ready || !tab.path) return
    const message = takeJump(tab.path)
    if (message) void page.jump(message)
  }

  $effect(() => {
    if (page?.ready) untrack(jumpWaiting)
  })

  $effect(() =>
    hearJumps((path) => {
      if (tab.path && samePath(path, tab.path)) jumpWaiting()
    }),
  )

  onDestroy(() => page?.close())

  function boxOf(element: Element): Box {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }

  function reactPicker(message: Message, from: HTMLElement) {
    picking = { at: boxOf(from), pick: (emoji) => page?.react(message, emoji) }
  }

  function composePicker(from: HTMLElement, insert: (emoji: string) => void) {
    picking = { at: boxOf(from), pick: insert }
  }

  function openFiles(message: Message, index: number) {
    const shown = message.files.filter((one) => isPicture(one) || isVideo(one))
    looking = { files: shown, start: index }
  }

  function onKey(event: KeyboardEvent) {
    if (!page) return
    if (shortcuts.pressed('chat.jump-new', event)) {
      event.preventDefault()
      event.stopPropagation()
      timeline?.toNew()
    }
  }

  function dragging(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dropping = true
  }

  function dropped(event: DragEvent) {
    dropping = false
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    composer?.addFiles(files)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="chat-tab"
  class:dropping
  bind:clientWidth={width}
  onkeydowncapture={onKey}
  ondragover={dragging}
  ondragleave={(event) => {
    if (event.currentTarget === event.target) dropping = false
  }}
  ondrop={dropped}
>
  {#if page}
    {@const open = page}
    <div class="main" class:hidden={phone && open.replying !== null}>
      <ChatHead page={open} {space} />
      {#if open.ready}
        <Timeline
          bind:this={timeline}
          page={open}
          {space}
          onreply={(message: Message) => (open.replying = message.id)}
          onquote={(message: Message) => {
            open.aside = { kind: 'quote', message }
            composer?.focus()
          }}
          onedit={(message: Message) => (open.aside = { kind: 'edit', message })}
          onpicker={reactPicker}
          onfiles={openFiles}
          oncompose={() => composer?.focus()}
        />
      {:else}
        <div class="waiting"></div>
      {/if}
      {#if open.view.role !== 'read'}
        <Composer
          bind:this={composer}
          page={open}
          {space}
          path={tab.path}
          onrows={() => timeline?.focusRows()}
          onescape={() => void timeline?.toBottom()}
          onpicker={composePicker}
          onpoll={(send: (poll: Poll) => void) => (polling = send)}
        />
      {/if}
    </div>
    {#if open.replying}
      {#key open.replying}
        <Replies
          page={open}
          parent={open.replying}
          {space}
          path={tab.path}
          width={phone ? width : Math.min(420, Math.max(320, width * 0.36))}
          onclose={() => {
            open.replying = null
            composer?.focus()
          }}
          onpicker={composePicker}
          onfiles={openFiles}
        />
      {/key}
    {/if}
  {:else if missing}
    <!-- A pointer that names no chat this account reaches: the chat's mark, faded. -->
    <p class="missing"><Glyph name="hash" /></p>
  {/if}
</div>

<Float at={picking?.at ?? null} end label={t('Emoji')} onclose={() => (picking = null)}>
  <EmojiPicker
    onpick={(emoji: string) => {
      picking?.pick(emoji)
      picking = null
    }}
  />
</Float>

{#if looking && page}
  <Lightbox
    chat={page.id}
    files={looking.files}
    start={looking.start}
    onclose={() => (looking = null)}
  />
{/if}

{#if polling}
  <PollSheet
    onsend={(poll: Poll) => {
      polling?.(poll)
      polling = null
    }}
    onclose={() => (polling = null)}
  />
{/if}

<Tip />

<style>
  .chat-tab {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .chat-tab.dropping {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-bottom: var(--inset-bottom);
  }

  .main.hidden {
    display: none;
  }

  .chat-tab :global(.replies) {
    flex: none;
    width: min(420px, max(320px, 36%));
  }

  :global([data-touch]) .chat-tab :global(.replies) {
    flex: 1;
    width: auto;
    border: none;
  }

  .waiting {
    flex: 1;
  }

  .missing {
    --glyph-size: 32px;
    margin: auto;
    color: var(--muted);
    opacity: 0.4;
  }
</style>
