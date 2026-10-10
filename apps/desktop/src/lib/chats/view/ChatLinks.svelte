<script lang="ts">
  /** The messages that link a note, under its backlinks in the Links panel (docs/chats.md
   *  4.13): a message that says `[[thesis]]` is a backlink like a note that does, read
   *  out of the chats' store rather than out of any file, since nothing of a chat is
   *  written into the space. A row is the message's first line, its chat and who wrote
   *  it, and a press opens the chat at it. Looked for while the panel shows, and again
   *  when a message arrives. */
  import { t } from '../../i18n.svelte'
  import FileMark from '../../FileMark.svelte'
  import { nameOf as fileName, relativeTo, withoutExtension } from '../../space-paths'
  import { workspace } from '../../workspace.svelte'
  import type { Hit } from '../api'
  import { firstLine } from './body'
  import { openChat } from './open'
  import { store } from './source.svelte'

  const { path }: { path: string } = $props()

  let hits = $state.raw<Hit[]>([])
  /** Bumped when a message arrives anywhere, so the list is asked again. */
  let heard = $state(0)

  $effect(() => store().heard(() => heard++))

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  $effect(() => {
    const root = workspace.activeSpace?.root
    const names = [withoutExtension(fileName(path))]
    if (root) names.push(withoutExtension(relativeTo(root, path)))
    follows(heard)
    let current = true
    void store()
      .linking(names)
      .then((found) => {
        if (current) hits = found.filter((one) => !one.message.deleted)
      })
    return () => {
      current = false
    }
  })

  function open(hit: Hit) {
    const at = store().entry(hit.chat)?.path
    if (at) openChat(at, {}, hit.message.id)
  }
</script>

{#if hits.length}
  <p class="nib-section">{t('Chats')}<span>{hits.length}</span></p>
  {#each hits as hit (hit.message.id)}
    <button type="button" class="nib-row" onclick={() => open(hit)}>
      <FileMark mark="chat" path={store().entry(hit.chat)?.path ?? undefined} />
      <span class="nib-row-label">{firstLine(hit.message.body)}</span>
      <span class="where">#{store().entry(hit.chat)?.name ?? ''}</span>
    </button>
  {/each}
{/if}

<style>
  .where {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
