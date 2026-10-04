<script lang="ts">
  /** The timeline: rows down, time across, a bar from each row's start to its end, and
   *  the rows' names beside it, as Notion draws one (docs/tasks.md 5.9). A bar dragged
   *  moves both its dates; an edge dragged moves one. A task blocked by another (`⛔`)
   *  has an arrow from the end of the one it waits for. The scale is days, weeks,
   *  months or quarters, and today is a line in the accent. */
  import { addDays, cellValue, type Row, rowId, type Value } from '@nib/bases'
  import { linkModifier } from '@nib/editor'
  import { i18n, t } from '../i18n.svelte'
  import type { RowChange } from '../rows/write'
  import { priorityTone } from '../quick-add/labels'
  import { changeOf } from './columns'
  import { dateAt } from './days'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import {
    arrowsOf,
    type Bar,
    barOf,
    DAY_WIDTH,
    daysBetween,
    dragged,
    type Scale,
    SCALES,
    spanOf,
  } from './timeline'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  let scale = $state<Scale>('week')

  const SCALE_NAMES: Record<Scale, string> = {
    day: t('Days'),
    week: t('Weeks'),
    month: t('Months'),
    quarter: t('Quarters'),
  }

  const rows = $derived((live.answer?.groups ?? []).flatMap((group) => group.rows))
  const bars = $derived.by((): Bar[] => {
    const base = live.base
    if (!base) return []
    const read = (row: Row, property: string): Value => cellValue(base, property, row, live.context)
    return rows.flatMap((row) => {
      const bar = barOf(row, { start: view?.nib.date, end: view?.nib.end }, read)
      return bar ? [bar] : []
    })
  })
  const span = $derived(spanOf(bars, live.today))
  const width = $derived(DAY_WIDTH[scale])
  const total = $derived((daysBetween(span.first, span.last) + 1) * width)
  const ROW = 32
  /** How wide a bar has to be to hold its own words. */
  const NAMED = 80

  const x = (day: string) => daysBetween(span.first, day) * width

  /** The marks along the top: every day, the Mondays, the firsts of the month or of a
   *  quarter, as the scale has room for. */
  const ticks = $derived.by(() => {
    const out: { day: string; label: string }[] = []
    for (let day = span.first; day <= span.last; day = addDays(day, 1)) {
      const date = dateAt(day)
      const first = day.endsWith('-01')
      if (scale === 'day') out.push({ day, label: i18n.when(date, { day: 'numeric' }) })
      else if (scale === 'week' && date.getDay() === 1)
        out.push({ day, label: i18n.when(date, { month: 'short', day: 'numeric' }) })
      else if (scale === 'month' && first)
        out.push({ day, label: i18n.when(date, { month: 'short' }) })
      else if (scale === 'quarter' && first && date.getMonth() % 3 === 0)
        out.push({ day, label: i18n.when(date, { month: 'short', year: '2-digit' }) })
    }
    return out
  })

  /** Where each task with an id ends, for the arrows from it. */
  const arrows = $derived(
    arrowsOf(bars).map((one) => ({
      from: { x: x(one.from.bar.end) + width, y: one.from.at * ROW + ROW / 2 },
      to: { x: x(one.to.bar.start), y: one.to.at * ROW + ROW / 2 },
    })),
  )

  /** A bar or an edge dragged: whole days, written once on letting go. */
  function drag(event: PointerEvent, bar: Bar, part: 'move' | 'start' | 'end') {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = event.clientX
    const element = (
      part === 'move' ? event.currentTarget : (event.currentTarget as HTMLElement).parentElement
    ) as HTMLElement
    let moved = false
    const days = (to: number) => Math.round((to - start) / width)
    const move = (next: PointerEvent) => {
      const by = days(next.clientX)
      if (Math.abs(next.clientX - start) > 3) moved = true
      if (part === 'move') element.style.translate = `${by * width}px 0`
      else if (part === 'start') {
        element.style.marginInlineStart = `${by * width}px`
      } else element.style.marginInlineEnd = `${-by * width}px`
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      element.style.translate = ''
      element.style.marginInlineStart = ''
      element.style.marginInlineEnd = ''
      if (!moved) {
        if (part === 'move') kit.open(bar.row, linkModifier(next) ? 'tab' : 'aside')
        return
      }
      const written = dragged(bar, part, days(next.clientX))
      const change: RowChange = {}
      for (const [property, day] of Object.entries(written)) {
        const one = changeOf(bar.row, property, day)
        if (one?.note) change.note = { ...change.note, ...one.note }
        if (one?.task) change.task = { ...change.task, ...one.task }
      }
      if (change.note || change.task) kit.write(bar.row, change)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
</script>

<div class="timeline">
  <div class="bar-head">
    <div class="nib-segmented scales" role="tablist">
      {#each SCALES as one (one)}
        <button
          type="button"
          role="tab"
          class:on={scale === one}
          aria-selected={scale === one}
          onclick={() => (scale = one)}>{SCALE_NAMES[one]}</button
        >
      {/each}
    </div>
  </div>
  <div class="body">
    <div class="names">
      <div class="corner"></div>
      {#each bars as bar (`${bar.row.space}:${rowId(bar.row)}`)}
        <button
          type="button"
          class="name"
          onclick={(event) => kit.open(bar.row, linkModifier(event) ? 'tab' : 'aside')}
        >
          {bar.row.task ? plain(bar.row.task.text) : bar.row.file.basename}
        </button>
      {/each}
    </div>
    <div class="track">
      <div class="inner" style:width={`${total}px`}>
        <div class="ticks">
          {#each ticks as tick (tick.day)}
            <span style:inset-inline-start={`${x(tick.day)}px`}>{tick.label}</span>
          {/each}
        </div>
        <div class="lanes" style:height={`${bars.length * ROW}px`}>
          {#each ticks as tick (tick.day)}
            <span class="rule" style:inset-inline-start={`${x(tick.day)}px`}></span>
          {/each}
          <span class="today" style:inset-inline-start={`${x(live.today) + width / 2}px`}></span>
          <svg class="arrows" width={total} height={bars.length * ROW} aria-hidden="true">
            {#each arrows as arrow, at (at)}
              <path
                d={`M${arrow.from.x} ${arrow.from.y} C${arrow.from.x + 16} ${arrow.from.y} ${arrow.to.x - 16} ${arrow.to.y} ${arrow.to.x} ${arrow.to.y}`}
              />
            {/each}
          </svg>
          {#each bars as bar, at (`${bar.row.space}:${rowId(bar.row)}`)}
            {@const long = (daysBetween(bar.start, bar.end) + 1) * width}
            {@const words = bar.row.task ? plain(bar.row.task.text) : bar.row.file.basename}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="span"
              class:done={bar.row.task?.done}
              style:--tone={bar.row.task ? priorityTone(bar.row.task.priority) : null}
              style:top={`${at * ROW + 5}px`}
              style:inset-inline-start={`${x(bar.start)}px`}
              style:width={`${long}px`}
              onpointerdown={(event) => drag(event, bar, 'move')}
            >
              <span class="edge start" onpointerdown={(event) => drag(event, bar, 'start')}></span>
              <span class="words">{long >= NAMED ? words : ''}</span>
              <span class="edge end" onpointerdown={(event) => drag(event, bar, 'end')}></span>
            </div>
            {#if long < NAMED}
              <!-- A bar too short to hold its words has them beside it. -->
              <span
                class="beside"
                style:top={`${at * ROW + 5}px`}
                style:inset-inline-start={`${x(bar.start) + long + 6}px`}>{words}</span
              >
            {/if}
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .bar-head {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-3);
  }

  .scales button {
    padding: 0 var(--space-3);
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow-y: auto;
    border-top: 1px solid var(--line);
  }

  .names {
    flex: none;
    width: 220px;
    border-inline-end: 1px solid var(--line);
  }

  .corner {
    height: 28px;
    border-bottom: 1px solid var(--line);
  }

  .name {
    display: block;
    width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    overflow: hidden;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  @media (hover: hover) {
    .name:hover {
      color: var(--text-strong);
    }
  }

  .track {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }

  .inner {
    position: relative;
  }

  .ticks {
    position: relative;
    height: 28px;
    border-bottom: 1px solid var(--line);
  }

  .ticks span {
    position: absolute;
    top: 6px;
    padding-inline-start: 4px;
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .lanes {
    position: relative;
  }

  .rule,
  .today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
  }

  .today {
    width: 2px;
    background: var(--accent);
  }

  .arrows {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .arrows path {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.2;
  }

  .span {
    position: absolute;
    display: flex;
    align-items: center;
    height: 22px;
    min-width: 8px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--tone, var(--accent)) 30%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--tone, var(--accent)) 60%, transparent);
    color: var(--text-strong);
    font-size: var(--text-xs);
    cursor: grab;
    touch-action: none;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .span.done {
    opacity: 0.55;
  }

  .words {
    flex: 1;
    min-width: 0;
    padding: 0 var(--space-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .beside {
    position: absolute;
    height: 22px;
    line-height: 22px;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
  }

  .edge {
    flex: none;
    width: 6px;
    align-self: stretch;
    cursor: ew-resize;
  }
</style>
