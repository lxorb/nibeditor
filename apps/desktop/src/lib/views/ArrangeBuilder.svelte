<script lang="ts">
  /** How a view's rows are put in order and into groups: sorts one under another, a
   *  grouping and a grouping under it (swimlanes on a board), each a property and a
   *  direction (docs/tasks.md 5.9). `part` says which of the two the head asked for. */
  import type { Sort } from '@nib/bases'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { displayName, knownProperties } from './columns'
  import { setGroup, setSort, setSubGroup } from './edit'
  import type { Kit } from './kit'
  import { propertyName } from './words'

  const { kit, part }: { kit: Kit; part: 'sort' | 'group' } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const kinds = $derived(view?.nib.rows ?? 'notes')
  const properties = $derived(live.base ? knownProperties(live.base, kinds, live.rows) : [])
  const options = (current?: string) =>
    (current && !properties.includes(current) ? [current, ...properties] : properties).map(
      (one) => ({
        value: one,
        label: propertyName(one, live.base ? displayName(live.base, one) : undefined),
      }),
    )

  const NONE = ''

  function direction(sort: Sort): Sort {
    return { ...sort, direction: sort.direction === 'ASC' ? 'DESC' : 'ASC' }
  }
</script>

{#snippet arrow(sort: Sort, flip: () => void)}
  <button
    type="button"
    class="nib-glyph"
    title={sort.direction === 'ASC' ? t('Ascending') : t('Descending')}
    aria-label={sort.direction === 'ASC' ? t('Ascending') : t('Descending')}
    onclick={flip}
  >
    <svg viewBox="0 0 13 13" class:down={sort.direction === 'DESC'}
      ><path d="M6.5 10.5v-8M3.5 5.5l3-3 3 3" /></svg
    >
  </button>
{/snippet}

{#if part === 'sort'}
  {#each view?.sort ?? [] as sort, at (at)}
    <div class="row">
      <Select
        label={t('Sort')}
        value={sort.property}
        options={options(sort.property)}
        onchange={(property: string) =>
          kit.change((base, index) =>
            setSort(
              base,
              index,
              (view?.sort ?? []).map((one, place) => (place === at ? { ...one, property } : one)),
            ),
          )}
      />
      {@render arrow(sort, () =>
        kit.change((base, index) =>
          setSort(
            base,
            index,
            (view?.sort ?? []).map((one, place) => (place === at ? direction(one) : one)),
          ),
        ),
      )}
      <button
        type="button"
        class="nib-glyph"
        title={t('Remove')}
        aria-label={t('Remove')}
        onclick={() =>
          kit.change((base, index) =>
            setSort(
              base,
              index,
              (view?.sort ?? []).filter((_, place) => place !== at),
            ),
          )}><Cross small /></button
      >
    </div>
  {/each}
  <button
    type="button"
    class="nib-row is-short adder"
    onclick={() =>
      kit.change((base, index) =>
        setSort(base, index, [
          ...(view?.sort ?? []),
          { property: properties[0] ?? 'file.name', direction: 'ASC' },
        ]),
      )}
  >
    <span class="nib-row-label">{t('Add a sort')}</span>
  </button>
{:else}
  {@const group = view?.groupBy}
  {@const sub = view?.nib.subGroupBy}
  <div class="row">
    <Select
      label={t('Group')}
      value={group?.property ?? NONE}
      options={[{ value: NONE, label: t('None') }, ...options(group?.property)]}
      onchange={(property: string) =>
        kit.change((base, index) =>
          setGroup(
            base,
            index,
            property === NONE ? undefined : { property, direction: group?.direction ?? 'ASC' },
          ),
        )}
    />
    {#if group}
      {@render arrow(group, () =>
        kit.change((base, index) => setGroup(base, index, direction(group))),
      )}
    {/if}
  </div>
  {#if group}
    <div class="row">
      <Select
        label={t('Then by')}
        value={sub?.property ?? NONE}
        options={[{ value: NONE, label: t('None') }, ...options(sub?.property)]}
        onchange={(property: string) =>
          kit.change((base, index) =>
            setSubGroup(
              base,
              index,
              property === NONE ? undefined : { property, direction: sub?.direction ?? 'ASC' },
            ),
          )}
      />
      {#if sub}
        {@render arrow(sub, () =>
          kit.change((base, index) => setSubGroup(base, index, direction(sub))),
        )}
      {/if}
    </div>
  {/if}
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-base) var(--ease-out);
  }

  svg.down {
    transform: rotate(180deg);
  }

  .adder .nib-row-label {
    color: var(--muted);
  }
</style>
