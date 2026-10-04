<script lang="ts">
  /** A chart of the view's groups: bars (up or across), a line, a donut or one number,
   *  measured by a count, a sum, an average, the earliest or the latest, with a running
   *  total where asked (docs/tasks.md 5.9). Drawn as SVG in the theme's six tones, and
   *  read-only, as Notion's are; its settings are kept under the view's `nib:`. */
  import { groupName } from '@nib/bases'
  import { amount, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import {
    CHART_KINDS,
    donutPaths,
    heights,
    linePath,
    MEASURES,
    seriesOf,
    settingsOf,
    totalOf,
  } from './chart'
  import { toneColour } from './chips'
  import { displayName, knownProperties, toneOf } from './columns'
  import { setNibOption } from './edit'
  import type { Kit } from './kit'
  import { dayWords } from '@nib/editor/task-days'
  import { chartName, groupLabel, measureName, propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const settings = $derived(view ? settingsOf(view) : null)
  const property = $derived(view?.groupBy?.property)

  const points = $derived(
    live.answer && settings && live.base
      ? seriesOf(live.answer, settings, live.base, live.context)
      : [],
  )
  const total = $derived(
    live.answer && settings && live.base
      ? totalOf(live.answer, settings, live.base, live.context)
      : null,
  )
  const fractions = $derived(heights(points))

  const TONES = [
    'var(--canvas-5)',
    'var(--canvas-4)',
    'var(--canvas-2)',
    'var(--canvas-6)',
    'var(--canvas-1)',
    'var(--canvas-3)',
  ]
  /** A group's colour: the tone its option has where the base gives it one (a status's
   *  green Done), else the next of the six. */
  const tone = (at: number) => {
    const key = points[at]?.key
    const own =
      live.base && property && typeof key === 'string'
        ? toneColour(toneOf(live.base, property, key))
        : null
    return own ?? TONES[at % TONES.length] ?? 'var(--accent)'
  }

  const label = (at: number) => groupLabel(property, points[at]?.key ?? null, live.today)
  const said = (at: number) => {
    const one = points[at]
    if (!one) return ''
    return one.day ? dayWords(one.day, live.today) : amount(Math.round(one.value * 100) / 100)
  }

  const set = (key: string, value: unknown) =>
    kit.change((base, at) => setNibOption(base, at, key, value))

  const numeric = $derived(
    live.base ? knownProperties(live.base, view?.nib.rows ?? 'notes', live.rows) : [],
  )

  const W = 640
  const H = 260
</script>

<div class="chart">
  <div class="settings">
    <div class="nib-segmented kinds" role="tablist">
      {#each CHART_KINDS as kind (kind)}
        <button
          type="button"
          role="tab"
          class:on={settings?.kind === kind}
          aria-selected={settings?.kind === kind}
          onclick={() => set('chart', kind)}>{chartName(kind)}</button
        >
      {/each}
    </div>
    <span class="pick">
      <Select
        label={t('Measure')}
        value={settings?.measure ?? 'count'}
        options={MEASURES.map((one) => ({ value: one, label: measureName(one) }))}
        onchange={(value: string) => set('measure', value)}
      />
    </span>
    {#if settings && settings.measure !== 'count'}
      <span class="pick">
        <Select
          label={t('Property')}
          value={settings.of ?? ''}
          options={numeric.map((one) => ({
            value: one,
            label: propertyName(one, live.base ? displayName(live.base, one) : undefined),
          }))}
          onchange={(value: string) => set('of', value)}
        />
      </span>
    {/if}
    {#if settings && settings.kind !== 'number' && settings.kind !== 'donut'}
      <button
        type="button"
        class="nib-chip"
        class:is-on={settings.cumulative}
        aria-pressed={settings.cumulative}
        onclick={() => set('cumulative', settings.cumulative ? undefined : true)}
        >{t('Cumulative')}</button
      >
    {/if}
  </div>

  {#if settings?.kind === 'number'}
    <div class="number">
      {total?.day
        ? dayWords(total.day, live.today)
        : amount(Math.round((total?.value ?? 0) * 100) / 100)}
    </div>
  {:else if settings?.kind === 'donut'}
    <div class="donut">
      <svg viewBox="-110 -110 220 220" role="img" aria-label={view?.name ?? ''}>
        {#each donutPaths( points.map((one) => one.value), 100, 62 ) as path, at (at)}
          <path d={path} fill={tone(at)}><title>{label(at)}: {said(at)}</title></path>
        {/each}
        <text class="middle" x="0" y="8" text-anchor="middle"
          >{amount(live.answer?.total ?? 0)}</text
        >
      </svg>
      <ul class="legend">
        {#each points as point, at (groupName(point.key))}
          <li>
            <span class="swatch" style:background={tone(at)}></span>{label(at)}<span class="value"
              >{said(at)}</span
            >
          </li>
        {/each}
      </ul>
    </div>
  {:else if settings?.kind === 'line'}
    <svg class="plot" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={view?.name ?? ''}>
      <path class="line" d={linePath(fractions, W - 20, H - 10)} transform="translate(10 5)" />
      {#each points as point, at (groupName(point.key))}
        {@const cx = 10 + (points.length > 1 ? (at * (W - 20)) / (points.length - 1) : 0)}
        {@const cy = 5 + (H - 10) - (fractions[at] ?? 0) * (H - 10)}
        <circle {cx} {cy} r="3.5"><title>{label(at)}: {said(at)}</title></circle>
        <text class="tick" x={cx} y={H + 18} text-anchor="middle">{label(at)}</text>
      {/each}
    </svg>
  {:else if settings?.kind === 'hbar'}
    <div class="hbars">
      {#each points as point, at (groupName(point.key))}
        <div class="hbar">
          <span class="name">{label(at)}</span>
          <span class="track"
            ><span
              class="fill"
              style:width={`${(fractions[at] ?? 0) * 100}%`}
              style:background={tone(at)}
            ></span></span
          >
          <span class="value">{said(at)}</span>
        </div>
      {/each}
    </div>
  {:else}
    <svg class="plot" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={view?.name ?? ''}>
      {#each points as point, at (groupName(point.key))}
        {@const step = W / Math.max(1, points.length)}
        {@const tall = (fractions[at] ?? 0) * (H - 16)}
        <rect
          x={at * step + step * 0.18}
          y={H - tall}
          width={step * 0.64}
          height={tall}
          rx="3"
          fill={tone(at)}
        >
          <title>{label(at)}: {said(at)}</title>
        </rect>
        <text class="tick" x={at * step + step / 2} y={H + 18} text-anchor="middle"
          >{label(at)}</text
        >
        <text class="tick value" x={at * step + step / 2} y={H - tall - 5} text-anchor="middle"
          >{said(at)}</text
        >
      {/each}
    </svg>
  {/if}
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    font-family: var(--font-ui);
  }

  .settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .pick {
    width: 180px;
  }

  .kinds button {
    padding: 0 var(--space-3);
  }

  .plot {
    width: 100%;
    max-height: 420px;
  }

  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
  }

  circle {
    fill: var(--accent);
  }

  .tick {
    fill: var(--muted);
    font-size: 11px;
  }

  .tick.value {
    fill: var(--muted-strong);
  }

  .number {
    padding: var(--space-6) 0;
    color: var(--text-strong);
    font-size: 64px;
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .donut {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .donut svg {
    width: 240px;
    height: 240px;
  }

  .middle {
    fill: var(--text-strong);
    font-size: 24px;
    font-weight: 600;
  }

  .legend {
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text);
    font-size: var(--text-row);
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .hbars {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hbar {
    display: grid;
    grid-template-columns: minmax(80px, 22%) 1fr auto;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-row);
  }

  .name {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track {
    height: 14px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 4px;
    transition: width var(--dur-base) var(--ease-out);
  }
</style>
