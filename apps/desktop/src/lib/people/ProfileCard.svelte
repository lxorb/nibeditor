<script lang="ts">
  /** A person's card: their face, their name, their pronouns and status, the time where
   *  they are when it is not the reader's, and the few words they wrote about
   *  themselves. Slack's card, with nothing that is not about the person: no Message
   *  (nib's chats are channels in spaces, never direct), no menu.
   *
   *  A layer beside what was pressed, closed by Escape, a press anywhere else and back.
   *  On the reader's own card the one button is Edit, which is where all of it is
   *  changed (Settings > Account). See card.svelte.ts and docs/chats.md 4.15. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../backstack.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { settings } from '../settings.svelte'
  import { openExternal } from '../tauri'
  import Avatar from './Avatar.svelte'
  import { card } from './card.svelte'
  import { people } from './people.svelte'
  import { stands } from './status'
  import { farApart } from './zone'

  const shown = $derived(card.shown)
  const person = $derived(shown ? people.of(shown.id) : undefined)
  const mine = $derived(!!shown && people.mine?.id === shown.id)
  const name = $derived(shown ? (people.called(shown.id, shown.space) ?? '') : '')
  const now = $derived(Date.now())
  const status = $derived(person && stands(person.status, now) ? person.status : null)

  /** The time where they are, when it is an hour or more from the reader's: the one
   *  case where knowing it changes whether to write now. */
  const theirTime = $derived.by(() => {
    const zone = person?.zone
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone || mine || !farApart(zone, here, now)) return null
    return i18n.when(now, { timeStyle: 'short', timeZone: zone })
  })

  /** The bio in pieces, each address a link: the one kind of markup a bio has. */
  const pieces = $derived(
    (person?.bio ?? '')
      .split(/(https?:\/\/[^\s<>"]+)/g)
      .filter(Boolean)
      .map((text) => ({ text, link: /^https?:\/\//.test(text) })),
  )

  let layer = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)

  /** Under what was pressed, its start edges lined up, kept inside the window; above
   *  it where there is no room below. */
  const place = $derived.by(() => {
    if (!shown) return { left: 0, top: 0 }
    const gap = 6
    const room = 8
    const left = Math.min(Math.max(room, shown.at.left), window.innerWidth - width - room)
    const below = shown.at.bottom + gap
    const top =
      below + height + room > window.innerHeight
        ? Math.max(room, shown.at.top - gap - height)
        : below
    return { left, top }
  })

  const close = () => card.close()

  $effect(() => (shown ? overlays.show(close) : undefined))
  $effect(() => closeOnBack(!!shown, close))
  $effect(() => {
    if (!shown) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && layer?.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  })
  $effect(() => {
    if (!shown) return
    const id = shown.id
    return people.watch(() => [id])
  })
</script>

{#if shown}
  {#key shown.id}
    <div
      class="card nib-layer"
      bind:this={layer}
      bind:clientWidth={width}
      bind:clientHeight={height}
      style:left="{place.left}px"
      style:top="{place.top}px"
      role="dialog"
      aria-label={name}
      tabindex="-1"
      transition:fly={{ y: 6, duration: LAYER.rise, easing: cubicOut }}
    >
      <Avatar
        face={{
          name,
          avatar: person?.avatar ?? null,
          accent: person?.accent ?? null,
          key: shown.id,
        }}
        size={80}
        presence={person?.presence ?? null}
        quiet={status?.quiet ?? false}
      />
      <div class="who">
        <strong class="name">{name}</strong>
        {#if person?.pronouns}<span class="soft">{person.pronouns}</span>{/if}
      </div>
      {#if status && (status.emoji || status.text)}
        <div class="status">
          {#if status.emoji}<span class="emoji">{status.emoji}</span>{/if}
          <span>{status.text}</span>
          {#if status.until}
            <span class="soft">
              {t('until {time}', {
                time: i18n.when(status.until, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </span>
          {/if}
        </div>
      {/if}
      {#if theirTime}
        <div class="soft time">{t('{time} local time', { time: theirTime })}</div>
      {/if}
      {#if pieces.length}
        <p class="bio">
          {#each pieces as piece, at (at)}
            {#if piece.link}
              <a
                href={piece.text}
                onclick={(event) => {
                  event.preventDefault()
                  void openExternal(piece.text)
                }}>{piece.text}</a
              >
            {:else}{piece.text}{/if}
          {/each}
        </p>
      {/if}
      {#if mine}
        <button
          class="nib-chip edit"
          onclick={() => {
            close()
            settings.show('account')
          }}>{t('Edit profile')}</button
        >
      {/if}
    </div>
  {/key}
{/if}

<style>
  /* Over the sheets too: a face in the Share sheet opens one. */
  .card {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    width: min(280px, calc(100vw - 16px));
    padding: var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--text);
  }

  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .name {
    color: var(--text-strong);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    overflow-wrap: anywhere;
  }

  .soft {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    color: var(--text);
  }

  .time {
    font-variant-numeric: tabular-nums;
  }

  .bio {
    margin: 0;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .bio a {
    color: var(--accent);
  }

  .edit {
    margin-top: var(--space-1);
  }
</style>
