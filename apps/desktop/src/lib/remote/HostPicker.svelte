<script lang="ts">
  /** Another machine, in the middle of the window: Remote, from Ctrl+T or the plus.
   *
   *  Built as the space switcher is (SpacePicker.svelte), so a hand that knows one knows
   *  the other: every host numbered, a digit goes at once where only one can be meant,
   *  letters find a host by its name, its other names or its address and wait for
   *  Enter, Backspace takes one back, the arrows walk, Escape and the scrim put it away.
   *  No heading and no field. The pinned hosts come first, then the ones connected to
   *  lately, then the rest under their groups' names; a line between, and when each was
   *  last connected to at a row's end, quietly. See hosts.ts for the order.
   *
   *  An address typed that no host has - `emil@10.0.0.5`, `box:2222` - is a row of its
   *  own, and choosing it keeps it as a host made in nib. With no hosts at all, the one
   *  row is Add host, which is Settings, Remote. A right click on a host pins it or goes
   *  to Settings. */
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { tick } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { longPress } from '../longpress'
  import { menu } from '../menu.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { pieces } from '../palette/pieces'
  import { roving } from '../roving'
  import { isNumber } from '../space-pick'
  import SpacePlace from '../SpacePlace.svelte'
  import { ListTyping } from '../space-typing.svelte'
  import { trap } from '../trap'
  import { relativeStep } from '../ago'
  import HostMark from './HostMark.svelte'
  import {
    destinationOf,
    type Host,
    hostFor,
    mayBeDestination,
    pickerOrder,
    plainlyDestination,
    said,
    searchName,
  } from './hosts'
  import { remote } from './hosts.svelte'
  import { hostPicker } from './picker.svelte'

  $effect(() => (hostPicker.open ? overlays.show(() => hostPicker.dismiss()) : undefined))
  $effect(() => closeOnBack(hostPicker.open, () => hostPicker.dismiss()))

  const placed = $derived(pickerOrder(remote.hosts, remote.kept))

  /** What is typed into it, new each time it opens. An address is typing the list
   *  takes even where no host has it; a number never is one, since a digit picks. */
  const typing = $derived(
    hostPicker.open
      ? new ListTyping(
          () => placed.map((one) => searchName(one.host)),
          (at) => {
            const one = placed[at]
            if (one) hostPicker.choose(one.host)
          },
          (typed) => !isNumber(typed) && mayBeDestination(typed),
        )
      : null,
  )
  $effect(() => {
    const one = typing
    return () => one?.stop()
  })

  const typed = $derived(typing?.typed ?? '')
  const shown = $derived(
    (typing?.reading.shown ?? []).flatMap((at) => {
      const one = placed[at]
      return one ? [{ ...one, at }] : []
    }),
  )

  /** An address typed that is no host's yet: the row that keeps it and connects. Only
   *  where nothing else answers or it plainly is one, so a few letters of a host's name
   *  are not offered as an address of their own. */
  const offer = $derived.by(() => {
    if (!typed || isNumber(typed)) return null
    if (shown.length && !plainlyDestination(typed)) return null
    const wanted = destinationOf(typed)
    return wanted && !hostFor(remote.hosts, wanted) ? wanted : null
  })

  const empty = $derived(remote.read && remote.hosts.length === 0 && !offer)

  let box = $state<HTMLElement>()

  /** Each host's button, by its place in the order. */
  const buttons = $state<Record<number, HTMLButtonElement | null>>({})
  let offerButton = $state<HTMLButtonElement | null>(null)

  // The keyboard stands on the row that is meant: the first as it opens, the number or
  // the best of the names as anything is typed, the address where nothing else is.
  $effect(() => {
    const best = typing?.reading.best ?? -1
    const first = shown[0]?.at
    const lone = offer !== null && best < 0
    void tick().then(() => {
      if (lone) offerButton?.focus()
      else if (best >= 0) buttons[best]?.focus()
      else if (!typed && first !== undefined) buttons[first]?.focus()
      else box?.querySelector<HTMLElement>('button')?.focus()
    })
  })

  const relative = $derived(
    new Intl.RelativeTimeFormat(i18n.language, { style: 'narrow', numeric: 'auto' }),
  )

  /** When it was last connected to, said as briefly as a language says it. */
  function ago(at: number): string {
    const step = relativeStep(Date.now() - at)
    return relative.format(step.value, step.unit)
  }

  /** What a host offers about itself: a pin, and Settings. */
  function about(event: MouseEvent, host: Host) {
    event.preventDefault()
    menu.show(event, [
      {
        label: host.pinned ? t('Unpin') : t('Pin'),
        run: () =>
          void remote.keep((kept) => ({
            ...kept,
            about: { ...kept.about, [host.id]: { ...kept.about[host.id], pinned: !host.pinned } },
          })),
      },
      { label: t('Settings'), run: () => hostPicker.manage() },
    ])
  }
</script>

{#if typing}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => hostPicker.dismiss()}
  ></div>

  <div
    class="nib-screen is-centred is-steady picker"
    style:--rows={Math.max(placed.length, 1) + (offer ? 1 : 0)}
    style:--heads={placed.filter((one) => one.head).length}
    style:--parts={placed.filter((one) => one.parted).length}
    role="menu"
    aria-label={t('Remote')}
    bind:this={box}
    use:trap
    use:roving={{ current: '.is-on', wrap: true }}
    onkeydowncapture={typing.press}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#each shown as { host, head, parted, at } (host.id)}
      {#if parted && !typed}<hr />{/if}
      {#if head && !typed}<p class="head" role="none">{head}</p>{/if}
      <button
        class="nib-row"
        role="menuitem"
        bind:this={buttons[at]}
        onclick={() => hostPicker.choose(host)}
        oncontextmenu={(event) => about(event, host)}
        use:longPress={(event) => about(event, host)}
      >
        <SpacePlace place={at} {typed} count={placed.length} />
        <HostMark colour={host.colour} />
        <span class="nib-row-label"
          >{#each isNumber(typed) ? [{ text: host.name, hit: false }] : pieces(host.name, typed) as piece, index (index)}{#if piece.hit}<b
                >{piece.text}</b
              >{:else}{piece.text}{/if}{/each}{#if host.detail}<span class="detail"
              >{host.detail}</span
            >{/if}</span
        >
        {#if host.last !== null}<span class="nib-row-meta">{ago(host.last)}</span>{/if}
      </button>
    {/each}

    {#if offer}
      <button
        class="nib-row"
        role="menuitem"
        bind:this={offerButton}
        onclick={() => hostPicker.connect(offer)}
      >
        <SpacePlace count={placed.length} />
        <HostMark />
        <span class="nib-row-label">{said(offer)}</span>
      </button>
    {/if}

    {#if empty}
      <button class="nib-row" role="menuitem" onclick={() => hostPicker.manage()}>
        <SpacePlace count={1} />
        <HostMark />
        <span class="nib-row-label">{t('Add host')}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* SpacePicker's own shape: a sheet wide, in the middle, one height while it is up so
     the rows a name leaves out never move the edge - held by `--rows`, and by the group
     names and the lines between, which a name typed leaves out too. */
  .picker {
    --screen-width: var(--screen-sheet);
    --screen-height: calc(
      var(--rows) * var(--row-height) + var(--heads) * (var(--row-height-sm) + var(--space-2)) +
        var(--parts) * (2 * var(--space-1) + 1px) + 2 * var(--space-1) + 2px
    );
    z-index: var(--z-sheet);
    padding: var(--space-1);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* Where it is, after the name and quieter: what a host is to `ssh`. */
  .detail {
    margin-inline-start: var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  /* A group's name, over its hosts: a heading in a list, as the outline draws one. */
  .head {
    margin: var(--space-2) 0 0;
    padding: 0 var(--row-pad);
    min-height: var(--row-height-sm);
    display: flex;
    align-items: center;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  button:focus-visible {
    outline-offset: -1px;
  }
</style>
