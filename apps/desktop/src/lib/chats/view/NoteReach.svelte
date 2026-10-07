<script lang="ts">
  /** Who in the chat cannot open the note the words link (docs/chats.md 4.13), over the
   *  composer before the message goes: their faces, and Share where the reader owns the
   *  note, which lets them read it in one press. Slack's prompt when a file's link goes
   *  where some cannot follow it. Sending without it sends the link alone. */
  import type { Member } from '@nib/chats'
  import { fade } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import Avatar from '../../people/Avatar.svelte'
  import type { ChatMember } from '../api'
  import { faceOf, nameOf } from './people'
  import { store } from './source.svelte'
  import { tip } from './tips.svelte'

  const {
    chat,
    path,
    members,
    space,
  }: { chat: string; path: string; members: readonly Member[]; space: string | null } = $props()

  /** The most faces drawn; the rest are in the bubble. */
  const FACES = 5

  let reach = $state.raw<{ missing: ChatMember[]; share: boolean } | null>(null)
  let sharing = $state(false)

  $effect(() => {
    const asked = path
    let current = true
    reach = null
    void store()
      .noteReach(chat, asked)
      .then((found) => {
        if (current) reach = found
      })
    return () => {
      current = false
    }
  })

  const names = $derived(
    (reach?.missing ?? []).map((one) => one.name ?? nameOf(one.who, members, space)).join(', '),
  )

  async function share() {
    sharing = true
    if (await store().shareNote(chat, path)) reach = null
    sharing = false
  }
</script>

{#if reach?.missing.length}
  <div class="reach" transition:fade={{ duration: dur(120) }}>
    <span class="faces" use:tip={() => names}>
      {#each reach.missing.slice(0, FACES) as one (one.who)}
        <span class="face"><Avatar face={faceOf(one.who, members, space)} size={20} /></span>
      {/each}
    </span>
    {#if reach.share}
      <button type="button" class="nib-button is-quiet" disabled={sharing} onclick={share}
        >{t('Share')}</button
      >
    {/if}
  </div>
{/if}

<style>
  .reach {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
    padding: 0 0 0 var(--space-3);
    border-inline-start: 2px solid var(--line-strong);
  }

  .faces {
    display: flex;
  }

  /* Overlapping, as a tab's people are. */
  .face + .face {
    margin-inline-start: -6px;
  }

  .face {
    display: flex;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--surface);
  }
</style>
