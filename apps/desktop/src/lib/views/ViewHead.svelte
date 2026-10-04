<script lang="ts">
  /** The head every view wears (docs/tasks.md 5.5): its name, which is a menu of the
   *  base's views and what can be done to them; the layout switch, as marks; the
   *  filter, the sort and the group, each a small layer; the view's own search; and
   *  the plus. A mark lights when what it stands for is set. Names and counts and
   *  nothing else. */
  import { writeBase } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
  import { ORDER_MARK } from '../panel-marks'
  import { segmented } from '../slide'
  import { viewport } from '../viewport.svelte'
  import ArrangeBuilder from './ArrangeBuilder.svelte'
  import { addView, removeView, renameView } from './edit'
  import FilterBuilder from './FilterBuilder.svelte'
  import type { Kit } from './kit'
  import { switched } from './layout'
  import { ADD_MARK, FILTER_MARK, GROUP_MARK, LAYOUT_MARKS } from './marks'
  import Popover from './Popover.svelte'
  import { copyToBase } from './save'
  import { type Layout, LAYOUTS, layoutName, layoutOf } from './words'

  const {
    kit,
    title,
    onadd,
  }: {
    kit: Kit
    /** What the view is called where it has no name of its own: the tab's name. */
    title: string
    onadd: () => void
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const base = $derived(live.base)
  const layout = $derived(layoutOf(view?.type ?? 'table'))
  /** What the head calls the view: its own name, else the tab's. */
  const named = $derived(view?.name.trim() ? view.name : title)
  /** The layouts this place has room for: a fence and a phone leave the timeline out. */
  const offered = $derived(
    LAYOUTS.filter((one) => one !== 'timeline' || (!kit.compact && viewport.device !== 'phone')),
  )

  let open = $state<'filter' | 'sort' | 'group' | null>(null)
  let renaming = $state(false)

  const toggle = (which: 'filter' | 'sort' | 'group') => (open = open === which ? null : which)

  function pick(next: Layout) {
    kit.change((one, at) => switched(one, at, next, live.rows))
  }

  function nameMenu(event: MouseEvent) {
    if (!base) return
    const views = base.views
    const items: MenuEntry[] = [
      ...(views.length > 1
        ? [
            ...views.map((one, at) => ({
              label: one.name ? one.name : title,
              checked: at === live.at,
              run: () => (live.at = at),
            })),
            DIVIDER,
          ]
        : []),
      ...(kit.spec.builtin === undefined || views.length > 1
        ? [{ label: t('Rename'), run: () => (renaming = true) }]
        : []),
      { label: t('New view'), run: () => kit.change((one, at) => addView(one, at, 'table')) },
      { label: t('Duplicate view'), run: () => kit.change((one, at) => addView(one, at)) },
      ...(views.length > 1
        ? [
            {
              label: t('Delete view'),
              danger: true,
              run: () => kit.change((one, at) => removeView(one, at)),
            },
          ]
        : []),
      ...(kit.file === null
        ? [
            DIVIDER,
            {
              label: t('Copy to a base'),
              run: () => void copyToBase(writeBase(base), named),
            },
          ]
        : []),
    ]
    menu.show(event, items, { title: named })
  }

  const active = $derived({
    filter: view?.filters !== undefined,
    sort: (view?.sort.length ?? 0) > 0,
    group: view?.groupBy !== undefined,
  })
</script>

<div class="head" class:compact={kit.compact}>
  {#if renaming}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="nib-field rename"
      value={view?.name ?? ''}
      aria-label={t('Rename')}
      autofocus
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          renaming = false
        }
      }}
      onblur={(event) => {
        const name = event.currentTarget.value
        renaming = false
        kit.change((one, at) => renameView(one, at, name))
      }}
    />
  {:else}
    <button type="button" class="name" onclick={nameMenu} oncontextmenu={nameMenu}>
      <span class="words">{named}</span>
      <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
    </button>
  {/if}

  <div class="nib-segmented layouts" role="tablist" aria-label={t('Layout')} use:segmented>
    {#each offered as one (one)}
      <button
        type="button"
        role="tab"
        class:on={layout === one}
        aria-selected={layout === one}
        title={layoutName(one)}
        aria-label={layoutName(one)}
        onclick={() => pick(one)}
      >
        <svg viewBox="0 0 13 13"><path d={LAYOUT_MARKS[one]} /></svg>
      </button>
    {/each}
  </div>

  <span class="spring"></span>

  {#each [{ id: 'filter', mark: FILTER_MARK, label: t('Filter') }, { id: 'sort', mark: ORDER_MARK, label: t('Sort') }, { id: 'group', mark: GROUP_MARK, label: t('Group') }] as const as tool (tool.id)}
    <div class="tool">
      <button
        type="button"
        class="nib-glyph"
        class:set={active[tool.id]}
        class:open={open === tool.id}
        data-opens-popover
        title={tool.label}
        aria-label={tool.label}
        aria-expanded={open === tool.id}
        onclick={() => toggle(tool.id)}
      >
        <svg viewBox="0 0 13 13"><path d={tool.mark} /></svg>
      </button>
      <Popover open={open === tool.id} label={tool.label} onclose={() => (open = null)}>
        {#if tool.id === 'filter'}
          <FilterBuilder {kit} />
        {:else}
          <ArrangeBuilder {kit} part={tool.id} />
        {/if}
      </Popover>
    </div>
  {/each}

  {#if !kit.compact}
    <label class="nib-field search">
      <svg class="nib-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3" /></svg
      >
      <input
        type="search"
        value={live.typed}
        aria-label={t('Search')}
        placeholder={t('Search')}
        oninput={(event) => live.search(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Escape' && live.typed) {
            event.preventDefault()
            event.stopPropagation()
            live.search('')
          }
        }}
      />
    </label>
  {/if}

  <button
    type="button"
    class="nib-glyph"
    title={t('Add task')}
    aria-label={t('Add task')}
    onclick={onadd}
  >
    <svg viewBox="0 0 13 13"><path d={ADD_MARK} /></svg>
  </button>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--header-height);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
  }

  .head.compact {
    min-height: 0;
    padding: var(--space-1) var(--space-2);
    border-bottom: none;
  }

  .name {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    max-width: 30%;
    padding: 0 var(--space-2);
    height: var(--row-height);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .compact .name {
    font-size: var(--text-row);
  }

  @media (hover: hover) {
    .name:hover {
      background: var(--surface-hover);
    }
  }

  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name svg,
  .head svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rename {
    max-width: 30%;
  }

  .layouts button {
    display: grid;
    place-items: center;
    padding: 0 var(--space-2);
  }

  .spring {
    flex: 1;
  }

  .tool {
    position: relative;
  }

  .nib-glyph.set {
    color: var(--accent);
  }

  .nib-glyph.open {
    background: var(--surface-press);
  }

  .search {
    width: 168px;
    min-height: var(--row-height-sm);
  }

  :global([data-touch]) .search {
    display: none;
  }

  /* A phone has no width for one row of it: the name and the tools on the first line,
     the layout switch under them, the whole width. */
  :global([data-touch]) .head {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  :global([data-touch]) .name {
    max-width: none;
    flex: 1;
  }

  :global([data-touch]) .spring {
    display: none;
  }

  :global([data-touch]) .layouts {
    order: 1;
    flex-basis: 100%;
  }
</style>
