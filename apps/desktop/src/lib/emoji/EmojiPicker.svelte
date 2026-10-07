<script lang="ts">
  /** One emoji picker, for the composer and for reactions (docs/chats.md 3, #32): a
   *  search over every emoji's names and keywords, the ones last chosen, Unicode's
   *  groups, and the skin tone. Keyboard first: the field has the keys, the arrows
   *  walk the grid from it, Enter takes the one lit, Escape is the layer's.
   *
   *  The grid is a window of rows, as the icon picker's is: nineteen hundred buttons
   *  are a few dozen in the page. The data arrives with the first picker opened; see
   *  data.ts. */
  import { onMount } from 'svelte'
  import { t } from '../i18n.svelte'
  import { windowFor } from '../row-window'
  import { emojiData, type EmojiData, findEmoji } from './data'
  import { emojiRecent } from './recent.svelte'
  import { inTone, type Tone, TONES } from './tones'

  const { onpick }: { onpick: (emoji: string) => void } = $props()

  /** Cells across, and how tall each row is. */
  const ACROSS = 8
  const CELL = 34

  let data = $state.raw<EmojiData | null>(null)
  let failed = $state(false)
  let query = $state('')
  let lit = $state(0)
  let top = $state(0)
  let room = $state(280)
  let scroller = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()
  let toning = $state(false)

  onMount(() => {
    field?.focus()
    emojiData().then(
      (got) => (data = got),
      () => (failed = true),
    )
  })

  type Row = { head: string } | { cells: string[] }

  /** Every emoji in the order the grid shows them: what was found, or the recent ones
   *  and then every group. */
  const cells = $derived.by((): string[] => {
    if (!data) return []
    if (query.trim()) return findEmoji(data, query)
    return [...emojiRecent.list, ...data.groups.flatMap((group) => group.emojis)]
  })

  const rows = $derived.by((): Row[] => {
    if (!data) return []
    const runs = (list: readonly string[]): Row[] => {
      const out: Row[] = []
      for (let from = 0; from < list.length; from += ACROSS) {
        out.push({ cells: list.slice(from, from + ACROSS) })
      }
      return out
    }
    if (query.trim()) return runs(cells)
    return [
      ...(emojiRecent.list.length ? runs(emojiRecent.list) : []),
      ...data.groups.flatMap((group) => [{ head: group.label }, ...runs(group.emojis)]),
    ]
  })

  const shown = $derived(windowFor({ count: rows.length, height: CELL, top, room, overscan: 4 }))

  const words = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()
    for (const entry of data?.entries ?? []) map.set(entry.name, entry.words)
    return map
  })

  const toned = (emoji: string) => (data ? inTone(emoji, emojiRecent.tone, data.toned) : emoji)

  function pick(emoji: string) {
    const chosen = toned(emoji)
    emojiRecent.add(chosen)
    onpick(chosen)
  }

  /** The row a cell is on, so the arrows can keep the lit one in view. */
  function rowOf(index: number): number {
    const emoji = cells[index]
    return rows.findIndex(
      (row) => 'cells' in row && emoji !== undefined && row.cells.includes(emoji),
    )
  }

  function onKey(event: KeyboardEvent) {
    if (event.isComposing || !cells.length) return
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: ACROSS,
      ArrowUp: -ACROSS,
    }
    const by = step[event.key]
    if (by !== undefined) {
      // Left and right stay the field's while there are words in it to move through.
      if (Math.abs(by) === 1 && query) return
      event.preventDefault()
      lit = Math.min(cells.length - 1, Math.max(0, lit + by))
      const row = rowOf(lit)
      if (scroller && row !== -1) {
        const y = row * CELL
        if (y < scroller.scrollTop) scroller.scrollTop = y
        else if (y + CELL > scroller.scrollTop + room) scroller.scrollTop = y + CELL - room
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const emoji = cells[lit]
      if (emoji) pick(emoji)
    }
  }
</script>

<div class="picker">
  <div class="bar">
    <label class="nib-field">
      <input
        bind:this={field}
        bind:value={query}
        type="search"
        aria-label={t('Search')}
        placeholder={t('Search')}
        onkeydown={onKey}
        oninput={() => (lit = 0)}
      />
    </label>
    <button
      type="button"
      class="nib-glyph tone"
      aria-label={t('Skin tone')}
      title={t('Skin tone')}
      aria-expanded={toning}
      onclick={() => (toning = !toning)}>{inTone('👋', emojiRecent.tone, new Set(['👋']))}</button
    >
  </div>
  {#if toning}
    <div class="tones" role="radiogroup" aria-label={t('Skin tone')}>
      {#each TONES as _, tone (tone)}
        <button
          type="button"
          class="cell"
          role="radio"
          aria-checked={emojiRecent.tone === tone}
          aria-label={inTone('👋', tone as Tone, new Set(['👋']))}
          class:on={emojiRecent.tone === tone}
          onclick={() => {
            emojiRecent.setTone(tone as Tone)
            toning = false
            field?.focus()
          }}>{inTone('👋', tone as Tone, new Set(['👋']))}</button
        >
      {/each}
    </div>
  {/if}
  <div
    class="grid"
    bind:this={scroller}
    bind:clientHeight={room}
    onscroll={() => (top = scroller?.scrollTop ?? 0)}
  >
    {#if failed}
      <p class="empty">{t('That set is not here')}</p>
    {:else if !data}
      <p class="empty">{t('Loading…')}</p>
    {:else if !cells.length}
      <p class="empty">{t('Nothing found')}</p>
    {:else}
      <div style:height="{shown.above}px"></div>
      {#each rows.slice(shown.first, shown.last + 1) as row, index (shown.first + index)}
        {#if 'head' in row}
          <p class="head">{row.head}</p>
        {:else}
          <div class="row">
            {#each row.cells as emoji (emoji)}
              <button
                type="button"
                class="cell"
                class:lit={cells[lit] === emoji}
                title={words.get(emoji) ?? emoji}
                aria-label={words.get(emoji) ?? emoji}
                onclick={() => pick(emoji)}>{toned(emoji)}</button
              >
            {/each}
          </div>
        {/if}
      {/each}
      <div style:height="{shown.below}px"></div>
    {/if}
  </div>
</div>

<style>
  .picker {
    width: min(316px, 100%);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  :global(.float.sheet) .picker {
    width: 100%;
  }

  .bar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
  }

  .tone {
    font-size: 18px;
  }

  .tones {
    display: flex;
    justify-content: space-between;
    padding: 0 var(--space-2) var(--space-2);
  }

  .grid {
    height: 280px;
    overflow-y: auto;
    padding: 0 var(--space-2) var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    height: 34px;
  }

  .head {
    height: 34px;
    margin: 0;
    padding-top: var(--space-3);
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }

  .cell {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    font-size: 22px;
    line-height: 1;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  @media (hover: hover) {
    .cell:hover {
      background: var(--surface-hover);
      transform: scale(1.12);
    }
  }

  .cell:active {
    transform: scale(0.94);
  }

  .cell.lit,
  .cell.on {
    background: var(--accent-soft);
  }

  .empty {
    margin: var(--space-4) 0;
    color: var(--muted);
    text-align: center;
    font-size: var(--text-sm);
  }
</style>
