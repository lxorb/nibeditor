<script lang="ts">
  /** Save, for a tab with no file: a small layer hanging from the tab, like Chrome's
   *  bookmark bubble hangs from its star. The name, prefilled and selected so it can
   *  be typed straight over, and where it goes - the places the Move sheet offers,
   *  starting on the root of the space the tab was opened in. Enter saves, Escape or a
   *  press anywhere else leaves it as it was. No title and no question: the tab it
   *  hangs from says what is being saved. See ask.ts and workspace/drafts.ts. */
  import { onMount, tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { scale } from 'svelte/transition'
  import FileMark from '../FileMark.svelte'
  import { rank } from '../fuzzy'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { selectAll } from '../select-all'
  import SpaceMark from '../SpaceMark.svelte'
  import { trap } from '../trap'
  import { pages } from '../web-tab/pages.svelte'
  import { type Tab, workspace } from '../workspace.svelte'
  import { offeredName } from '../workspace/drafts'
  import { fileFor, placesFor, startingPlace } from './places'

  const { tab, anchor, onclose }: { tab: Tab; anchor: DOMRect | null; onclose: () => void } =
    $props()

  /** How many places the list shows at once: enough to pick from without the layer
   *  becoming a page, the Move sheet's own number. */
  const MOST_SHOWN = 8
  /** The layer's width, which is also what keeps it on the screen. */
  const WIDTH = 288
  const GAP = 6
  const EDGE = 8

  // What the tab offers, read once as the layer opens: the page's title may change
  // under a web tab while somebody is typing over it, and the field is theirs now.
  // svelte-ignore state_referenced_locally
  const title = tab.kind === 'web' ? pages.of(tab.id).title : undefined
  // svelte-ignore state_referenced_locally
  let name = $state(offeredName(tab.note, title))

  const places = placesFor(workspace.tree, workspace.spaces, workspace.activeSpace?.root ?? null)
  const home = workspace.spaces.find((one) => one.id === workspace.spaceOf(tab.note))?.root
  let place = $state(startingPlace(places, home ?? null))

  let named = $state<HTMLInputElement>()

  /** The list of places, open while one is being picked. */
  let choosing = $state(false)
  let query = $state('')
  let cursor = $state(0)
  const matches = $derived(
    choosing ? rank(query.trim(), places, (one) => one.label).slice(0, MOST_SHOWN) : [],
  )

  /** Under the tab, starting where it starts and kept on the screen; the middle of the
   *  top of the window where there is no tab to hang from. */
  const at = $derived.by(() => {
    const left = anchor ? anchor.left : (innerWidth - WIDTH) / 2
    return {
      top: anchor ? anchor.bottom + GAP : 64,
      left: Math.max(EDGE, Math.min(left, innerWidth - WIDTH - EDGE)),
    }
  })

  // Escape leaves it, like everything else the app puts over a note; and while it is
  // up a web tab's page is out of sight, since a page is drawn over everything the
  // window draws. See overlays.ts.
  onMount(() => overlays.show(onclose))

  function pick(index = cursor) {
    const chosen = matches[index]
    if (!chosen) return

    place = chosen
    choosing = false
    query = ''
    // Back in the name, where the next Enter saves.
    void tick().then(() => named?.focus())
  }

  function onListKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      cursor = (cursor + step + matches.length) % Math.max(matches.length, 1)
    } else if (event.key === 'Enter') {
      // The place, not the whole layer: Enter on a row picks it, and the next Enter
      // saves.
      event.preventDefault()
      pick()
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault()
    const folder = place?.id
    const file = fileFor(name, tab.note, title)
    // Gone at once, with the row arriving in the list as it goes: what is left is a
    // write, and a write that fails says so where every write says it.
    onclose()
    void workspace.save(tab, folder, file)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="nib-scrim is-clear scrim" onclick={onclose}></div>

<div
  class="nib-layer bubble"
  role="dialog"
  aria-label={t('Save')}
  style:top="{at.top}px"
  style:left="{at.left}px"
  style:width="{WIDTH}px"
  use:trap
  transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
>
  <form onsubmit={save}>
    <input
      class="nib-field"
      bind:this={named}
      bind:value={name}
      aria-label={t('Name')}
      spellcheck="false"
      use:selectAll
    />

    {#if choosing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="nib-field"
        bind:value={query}
        aria-label={t('Save to')}
        spellcheck="false"
        onkeydown={onListKey}
        oninput={() => (cursor = 0)}
        autofocus
      />
      <ul class="found">
        {#each matches as option, index (option.id)}
          <li>
            <button
              type="button"
              class="nib-row is-short"
              class:is-on={index === cursor}
              onmouseenter={() => (cursor = index)}
              onclick={() => pick(index)}
            >
              {#if option.space}
                <span class="space"><SpaceMark {...option.space} /></span>
              {:else if option.mark}
                <FileMark mark={option.mark} path={option.id} />
              {/if}
              <span class="nib-row-label">{option.label}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if place}
      <button
        type="button"
        class="nib-field where"
        aria-label={t('Save to')}
        onclick={() => (choosing = true)}
      >
        {#if place.space}
          <span class="space"><SpaceMark {...place.space} /></span>
        {:else if place.mark}
          <FileMark mark={place.mark} path={place.id} />
        {/if}
        <span class="nib-row-label">{place.label}</span>
        <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"
          ><path d="M3 4.5 6 7.5 9 4.5" /></svg
        >
      </button>
    {/if}

    <div class="row">
      <button type="submit" class="nib-button">{t('Save')}</button>
    </div>
  </form>
</div>

<style>
  .scrim {
    --scrim-z: var(--z-menu);
  }

  /* `.nib-layer` in the themes package: a thing that floats, over the note and under
     nothing but another menu. Its places are `.nib-row`s, every list's row. */
  .bubble {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--space-3);
    transform-origin: top left;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .where {
    gap: var(--row-gap);
  }

  .chevron {
    width: 12px;
    height: 12px;
    flex: none;
    margin-inline-start: auto;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .found {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .space {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  .row {
    display: flex;
    justify-content: flex-end;
  }
</style>
