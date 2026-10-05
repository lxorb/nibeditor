<script lang="ts">
  /** Reads that followed one another, as one step (steps.ts): "Explored" and what was
   *  looked at, Codex's row. Open, each read is a row of its own, which opens as any
   *  other does. Ctrl+O opens it with the rest. */
  import { cubicOut } from 'svelte/easing'
  import { slide } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Part } from '../chat/types'
  import { chat } from './chat.svelte'
  import PartRow from './PartRow.svelte'
  import StepLine from './StepLine.svelte'
  import { objectOf } from './verbs'

  const { rows, live = false }: { rows: Extract<Part, { kind: 'tool' }>[]; live?: boolean } =
    $props()

  let opened = $state(false)
  const open = $derived(opened || chat.unfolded)
  const going = $derived(live && rows.some((one) => one.state === 'running'))
  /** What was looked at, each once, in the order it was. */
  const what = $derived([...new Set(rows.map((one) => objectOf(one.args)).filter(Boolean))])
</script>

<div class="row">
  <StepLine
    verb={t('Explored')}
    object={what.join(', ')}
    {open}
    {going}
    onpress={() => (opened = !opened)}
  />
  {#if open}
    <div class="inner" transition:slide={{ duration: dur(150), easing: cubicOut }}>
      {#each rows as one (one.id)}
        <PartRow part={one} {live} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 0 13px;
  }
</style>
