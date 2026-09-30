<script lang="ts">
  /** Finding a word on a plane.
   *
   *  A canvas has no scrollbar to look down, so the only way to find something on
   *  a big one is to be taken to it. Type, and the list underneath is what holds
   *  the word; choose one and the plane goes there.
   *
   *  The editor's own find bar's shape, docked at the top of the pane, because it
   *  is the same question asked of a different surface. */

  import type { Canvas } from './canvas/format'
  import { matches } from './canvas/find'
  import { t } from './i18n.svelte'
  import Cross from './Cross.svelte'

  const {
    canvas,
    onpick,
    onclose,
  }: {
    canvas: Canvas
    onpick: (id: string) => void
    onclose: () => void
  } = $props()

  let term = $state('')
  let at = $state(0)
  let field = $state<HTMLInputElement>()

  const found = $derived(matches(canvas, term))

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  $effect(() => {
    field?.focus()
  })

  // A new search starts at the top of its own answers.
  $effect(() => {
    follows(found.length)
    at = 0
  })

  function go(step: number) {
    if (!found.length) return

    at = (at + step + found.length) % found.length
    const one = found[at]
    if (one) onpick(one.id)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      go(event.shiftKey ? -1 : 1)
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="nib-bar find"
  onkeydown={onKey}
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
>
  <input
    bind:this={field}
    bind:value={term}
    type="text"
    placeholder={t('Find on the canvas')}
    aria-label={t('Find on the canvas')}
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
  />

  <span class="count">{found.length ? `${at + 1}/${found.length}` : ''}</span>

  <button type="button" aria-label={t('Previous')} title={t('Previous')} onclick={() => go(-1)}>
    <svg viewBox="0 0 14 14"><path d="M4 8.5 7 5.5l3 3" /></svg>
  </button>
  <button type="button" aria-label={t('Next')} title={t('Next')} onclick={() => go(1)}>
    <svg viewBox="0 0 14 14"><path d="M4 5.5 7 8.5l3-3" /></svg>
  </button>
  <button type="button" class="shut" aria-label={t('Close')} title={t('Close')} onclick={onclose}>
    <Cross />
  </button>
</div>

{#if term && found.length}
  <ul
    class="hits"
    onpointerdown={(event) => event.stopPropagation()}
    onpointermove={(event) => event.stopPropagation()}
    onpointerup={(event) => event.stopPropagation()}
  >
    {#each found.slice(0, 12) as one, index (one.id)}
      <li>
        <button
          type="button"
          class:on={index === at}
          onclick={() => {
            at = index
            onpick(one.id)
          }}
        >
          {one.says}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .find {
    position: absolute;
    right: var(--space-3);
    top: var(--space-3);
    z-index: var(--z-bars);
    align-items: center;
    gap: 2px;
  }

  /* A hairline that is there and is not seen until the keyboard lands in it,
     which is what turns into the accent: the box had no border at all and took
     the ring off itself, so there was nothing at all to find it by. The width is
     the box's, so nothing moves when the colour arrives. */
  input {
    width: 180px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .count {
    min-width: 34px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  svg,
  .shut :global(svg) {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* What was found, under the field it was found with. */
  .hits {
    position: absolute;
    right: var(--space-3);
    top: calc(var(--space-3) + 40px);
    z-index: var(--z-bars);
    width: 280px;
    max-height: 40vh;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    animation: drop var(--dur-fast) var(--ease-out);
  }

  @keyframes drop {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  .hits button {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hits button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
