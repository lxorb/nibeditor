<script lang="ts">
  /** Who an `@` could be, over the composer (docs/chats.md 3, #36): each person's face
   *  and the name the chat calls them, then @nib (the reader's own agent, at the start
   *  of a message), @here and @everyone. The composer keeps
   *  the keys; this draws the list and takes a press. */
  import type { Member } from '@nib/chats'
  import type { Special } from './compose'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from '../../motion'
  import Avatar from '../../people/Avatar.svelte'
  import { faceOf, nameOf } from './people'

  const {
    choices,
    lit,
    members,
    space,
    onpick,
  }: {
    choices: (Member | Special)[]
    lit: number
    members: readonly Member[]
    space: string | null
    onpick: (choice: Member | Special) => void
  } = $props()

  /** Each choice as a row: a person of the chat, or @here and @everyone. */
  const rows = $derived(
    choices.map((choice) =>
      typeof choice === 'string'
        ? { key: choice, choice, member: null }
        : { key: choice.who, choice, member: choice },
    ),
  )
</script>

<div
  class="mentions nib-layer"
  role="listbox"
  aria-label="@"
  transition:fly={{ y: 4, duration: dur(130), easing: cubicOut }}
>
  {#each rows as row, index (row.key)}
    <button
      type="button"
      class="nib-row"
      class:is-on={index === lit}
      role="option"
      aria-selected={index === lit}
      onpointerdown={(event) => {
        // Taken before the editor loses the caret to the press.
        event.preventDefault()
        onpick(row.choice)
      }}
    >
      {#if row.member}
        <span class="nib-row-mark"
          ><Avatar face={faceOf(row.member.who, members, space)} size={20} /></span
        >
        <span class="nib-row-label">{nameOf(row.member.who, members, space)}</span>
        {#if row.member.nick && row.member.nick !== row.member.name}
          <span class="nib-row-meta">{row.member.name}</span>
        {/if}
      {:else if row.key === 'nib'}
        <span class="nib-row-mark at">✦</span>
        <span class="nib-row-label">@{row.key}</span>
      {:else}
        <span class="nib-row-mark at">@</span>
        <span class="nib-row-label">@{row.key}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .mentions {
    position: absolute;
    left: var(--space-3);
    bottom: calc(100% + 4px);
    z-index: var(--z-popover);
    width: min(280px, calc(100% - 2 * var(--space-3)));
    padding: var(--space-1);
  }

  .at {
    color: var(--muted);
    font-weight: var(--weight-strong);
  }
</style>
