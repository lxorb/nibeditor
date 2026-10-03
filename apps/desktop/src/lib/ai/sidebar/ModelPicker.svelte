<script lang="ts">
  /** The model chip under the field and the one popover it opens (Alt+P), Claude Code's
   *  and Codex's: which provider, which of its models (from the provider's own list,
   *  with each one's window), how hard it thinks (only the levels that model has), and
   *  Fast where the provider has a faster tier. The chip says the model and the level,
   *  `Opus 5.5 · High`, so neither is ever a guess.
   *
   *  A choice applies to the open thread from its next message, and the level picked is
   *  remembered for that model (prefs.ts). */
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { i18n, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { segmented } from '../../slide'
  import { ordered } from '../chat/effort'
  import type { Effort } from '../chat/types'
  import { usable } from '../providers'
  import { ai } from '../store.svelte'
  import { chat } from './chat.svelte'
  import { tokens } from './numbers'
  import { effortWord } from './words'

  const open = $derived(chat.popover === 'model')
  const head = $derived(chat.head)
  const provider = $derived(chat.provider)
  const model = $derived(chat.model)
  const providers = $derived(ai.providers.filter((one) => usable(one)))
  const list = $derived(provider ? (chat.models[provider.id] ?? []) : [])
  const levels = $derived<Effort[]>(model ? ordered(model.efforts) : ['auto'])
  /** One row of up to five levels, two even rows of more: eight in one row of a panel
   *  this narrow would be words cut in half. */
  const columns = $derived(levels.length <= 5 ? levels.length : Math.ceil(levels.length / 2))

  let query = $state('')
  let lit = $state(0)
  let field = $state<HTMLElement>()

  const shown = $derived.by(() => {
    const want = query.trim().toLowerCase()
    const all = list.length ? list : model ? [model] : []
    return want
      ? all.filter(
          (one) => one.name.toLowerCase().includes(want) || one.id.toLowerCase().includes(want),
        )
      : all
  })

  /** The chip's words: the model, and the level where one is chosen. */
  const label = $derived.by(() => {
    if (!head) return ''
    const name = [model?.name, head.model, provider?.name].find(Boolean) ?? ''
    return head.effort === 'auto' ? name : `${name} · ${t(effortWord(head.effort))}`
  })

  // Each time it opens: the filter empty, the model in use lit, the list asked for.
  $effect(() => {
    if (!open) return
    untrack(() => {
      query = ''
      lit = Math.max(
        0,
        shown.findIndex((one) => one.id === head?.model),
      )
      if (provider) void chat.loadModels(provider)
    })
    requestAnimationFrame(() => field?.focus())
  })

  function toggle() {
    chat.popover = open ? null : 'model'
  }

  function pick(id: string) {
    if (!provider) return
    chat.setModel(provider.id, id)
  }

  /** The list's keys: arrows walk it, Enter takes the lit row and closes, Escape closes
   *  and gives the field the keyboard back. */
  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      lit = (lit + step + shown.length) % Math.max(1, shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const one = shown[lit]
      if (one) pick(one.id)
      close()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  function close() {
    chat.popover = null
    chat.focus()
  }
</script>

<div class="picker">
  <button
    class="chip"
    class:on={open}
    aria-haspopup="dialog"
    aria-expanded={open}
    disabled={!head || !provider}
    title={t('Model and effort')}
    onclick={toggle}
  >
    <span>{label || t('Model')}</span>
    <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
  </button>

  {#if open && head}
    <div
      class="pop nib-layer"
      role="dialog"
      aria-label={t('Model and effort')}
      tabindex="-1"
      onkeydown={onKey}
      transition:fly={{ y: 6, duration: dur(150), easing: cubicOut }}
    >
      {#if providers.length > 1}
        <div class="providers">
          {#each providers as one (one.id)}
            <button
              class="nib-chip"
              class:is-on={one.id === provider?.id}
              onclick={() => chat.setModel(one.id, one.model)}>{one.name}</button
            >
          {/each}
        </div>
      {/if}

      {#if shown.length > 6 || query}
        <input
          class="nib-field filter"
          bind:this={field}
          bind:value={query}
          placeholder={t('Model')}
          aria-label={t('Model')}
          oninput={() => (lit = 0)}
        />
      {:else}
        <!-- The keyboard's place while there is nothing to type into. -->
        <span class="catch" tabindex="-1" bind:this={field}></span>
      {/if}

      <div class="models" role="listbox">
        {#each shown as one, index (one.id)}
          <button
            class="model"
            class:lit={index === lit}
            role="option"
            aria-selected={one.id === head.model}
            onpointermove={() => (lit = index)}
            onclick={() => {
              pick(one.id)
              close()
            }}
          >
            <span class="dot" class:on={one.id === head.model}></span>
            <span class="name">{one.name}</span>
            {#if one.window}<span class="window">{tokens(one.window, i18n.language)}</span>{/if}
          </button>
        {/each}
      </div>

      {#if levels.length > 1}
        <div class="line effort">
          <span class="what">{t('Effort')}</span>
          <div
            class="nib-segmented levels"
            style:grid-template-columns={`repeat(${columns}, 1fr)`}
            role="radiogroup"
            aria-label={t('Effort')}
            use:segmented
          >
            {#each levels as level (level)}
              <button
                type="button"
                class:on={level === head.effort}
                aria-pressed={level === head.effort}
                onclick={() => chat.setEffort(level)}>{t(effortWord(level))}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      {#if model?.fast}
        <button class="line fast" onclick={() => chat.setFast()}>
          <span class="what">{t('Fast')}</span>
          <span class="nib-switch" class:on={head.fast}></span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: static;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    height: var(--row-height-sm);
    padding: 0 4px 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip svg {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .chip:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .chip.on {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .pop {
    position: absolute;
    inset-inline: var(--space-1);
    bottom: calc(100% + 4px);
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    outline: none;
  }

  .providers {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .catch {
    position: absolute;
    outline: none;
  }

  .models {
    display: flex;
    flex-direction: column;
    max-height: 15rem;
    overflow-y: auto;
  }

  .model {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .model.lit {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .dot.on {
    background: var(--accent);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0;
    border: 0;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .what {
    flex: none;
    min-width: 3.5rem;
    color: var(--muted);
    text-align: start;
  }

  .fast {
    justify-content: space-between;
  }

  /* The levels under their name, wrapping where a model has eight of them: the panel
     is a third of a laptop's width at most. */
  .effort {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .levels {
    grid-auto-flow: row;
  }

  .levels button {
    min-width: 0;
    padding: 3px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
  }

  .levels button.on {
    color: var(--text-strong);
  }
</style>
