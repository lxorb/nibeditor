<script lang="ts">
  /** The bell in a chat's head (docs/chats.md 4.11): what pings for this chat, all,
   *  mentions or nothing, and Mute, until turned back or, from the row's chevron, for an
   *  hour, the evening, a day or a week. The chat's own setting, kept by the account so
   *  every device agrees; the head hands it in and takes the change (the chats' store,
   *  `notifyFor`). A chat of more than ten people starts at mentions, the rest at all. */
  import type { Notify } from '@nib/chats'
  import { DIVIDER, type MenuEntry, menu } from '../menu.svelte'
  import { plural, t } from '../i18n.svelte'
  import { askToShow } from '../notify'
  import { MUTE_HOURS, mutedUntil as muteFor, ringOf } from './bell'

  const {
    notify,
    mutedUntil,
    members,
    onchange,
  }: {
    notify: Notify | null
    mutedUntil: number | null
    members: number
    onchange: (notify: Notify | null, mutedUntil: number | null) => void
  } = $props()

  /** Once a minute is enough to see a mute run out. */
  let now = $state(Date.now())
  $effect(() => {
    const ticking = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(ticking)
  })

  const ring = $derived(ringOf(notify, mutedUntil, members, now))
  const muted = $derived(mutedUntil !== null && mutedUntil > now)

  function length(hours: number): string {
    return hours < 24
      ? t('{count} h', { count: hours })
      : plural(hours / 24, { one: '{count} day', other: '{count} days' })
  }

  function open(event: MouseEvent) {
    // A browser asks before it shows anything, and a press is the moment it may ask.
    askToShow()
    const level = ringOf(notify, null, members, now)
    const levels: [Notify, string][] = [
      ['all', t('All')],
      ['mentions', t('Mentions')],
      ['nothing', t('Nothing')],
    ]
    const rows: MenuEntry[] = levels.map(([value, label]) => ({
      label,
      checked: value === 'nothing' ? level === 'off' : level === value,
      run: () => onchange(value, mutedUntil),
    }))
    const mute: MenuEntry = muted
      ? { label: t('Unmute'), run: () => onchange(notify, null) }
      : {
          label: t('Mute'),
          run: () => onchange(notify, muteFor(null, Date.now())),
          more: () =>
            Promise.resolve(
              MUTE_HOURS.map((hours) => ({
                label: length(hours),
                run: () => onchange(notify, muteFor(hours, Date.now())),
              })),
            ),
        }
    menu.show(event, [...rows, DIVIDER, mute])
  }
</script>

<button
  class="nib-glyph"
  aria-haspopup="menu"
  title={t('Notifications')}
  aria-label={t('Notifications')}
  onclick={open}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    {#if ring === 'off'}
      <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
      <path d="m2 2 20 20" />
      <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
    {:else}
      <path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
      />
      {#if ring === 'mentions'}
        <circle class="dot" cx="18.5" cy="5.5" r="3" />
      {/if}
    {/if}
  </svg>
</button>

<style>
  /* Mentions only: the bell with the accent's dot, the mark a mention wears in the
     Chats panel. */
  .dot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 2;
  }
</style>
