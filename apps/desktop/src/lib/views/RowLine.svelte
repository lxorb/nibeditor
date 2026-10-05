<script lang="ts">
  /** One row of a list: a task's box, its words, where it lives and its chips, or a
   *  note's name. Pressing the words opens the note at the line beside the view
   *  (Ctrl or Cmd: in a tab); pressing where it lives does the same. Carried by the
   *  pointer onto another group, which writes what that group is (drop.ts). */
  import type { Row } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import { linkModifier } from '@nib/editor'
  import Twist from '../Twist.svelte'
  import { chipsOf } from './chips'
  import { draggable } from './drag.svelte'
  import type { Kit } from './kit'
  import TaskBox from './TaskBox.svelte'
  import { workspace } from '../workspace.svelte'
  import Words from './Words.svelte'
  import { plain } from './inline'

  const {
    row,
    kit,
    dated = true,
    where = true,
    depth = 0,
    twist = null,
    ontwist,
    selected = false,
    onselect,
  }: {
    row: Row
    kit: Kit
    dated?: boolean
    where?: boolean
    depth?: number
    twist?: 'open' | 'shut' | null
    ontwist?: () => void
    selected?: boolean
    onselect?: () => void
  } = $props()

  const task = $derived(row.task)
  const chips = $derived(task ? chipsOf(task, kit.live.today, dated) : [])
  const section = $derived(task?.section.at(-1))
  const label = $derived(task ? plain(task.text) : row.file.basename)
  /** Which space, where it is not the open one (decision 8.4). */
  /** The view's conditional colour for this row, if any. */
  const tone = $derived(kit.live.colourOf(row))
  const elsewhere = $derived(
    kit.spec.builtin !== undefined && row.space !== workspace.activeSpace?.name ? row.space : null,
  )

  function open(event: MouseEvent) {
    onselect?.()
    kit.open(row, linkModifier(event) ? 'tab' : 'aside')
  }
</script>

<div
  class="nib-row line"
  class:is-on={selected}
  class:finished={!!task && (task.done || task.cancelled)}
  class:toned={tone !== null}
  style:--row-tone={tone}
  style:--depth={depth}
  role="option"
  aria-selected={selected}
  tabindex={selected ? 0 : -1}
  data-row={row.anchor ? `${row.path}#${row.anchor.line}` : row.path}
  use:draggable={{ row, label }}
  onfocus={() => onselect?.()}
>
  {#if twist}
    <button
      type="button"
      class="twist"
      tabindex="-1"
      aria-label={twist === 'open' ? t('Collapse') : t('Expand')}
      aria-expanded={twist === 'open'}
      onclick={(event) => {
        event.stopPropagation()
        ontwist?.()
      }}><Twist open={twist === 'open'} /></button
    >
  {:else if depth}
    <span class="spacer" aria-hidden="true"></span>
  {/if}
  {#if task}
    <TaskBox {task} {label} ontick={() => kit.tick(row)} />
  {/if}
  <button type="button" class="words" onclick={open} tabindex="-1">
    {#if task}<Words words={task.text} />{:else}{row.file.basename}{/if}
  </button>
  {#if chips.length}
    <span class="chips">
      {#each chips as chip (chip.kind)}
        <span class="chip {chip.kind}" class:late={chip.late}>{chip.text}</span>
      {/each}
    </span>
  {/if}
  {#if where}
    <button type="button" class="nib-row-meta where" onclick={open} tabindex="-1" title={t('Open')}>
      {#if elsewhere}<span class="space">{elsewhere}</span>{/if}
      {row.kind === 'task' ? row.file.basename : row.file.folder}{#if section}<span
          class="sep"
          aria-hidden="true">›</span
        >{section}{/if}
    </button>
  {/if}
</div>

<style>
  .line {
    gap: var(--space-2);
    padding-inline-start: calc(var(--row-pad) + var(--depth) * var(--row-indent));
    color: var(--text);
    outline-offset: -2px;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }

  .line.finished {
    opacity: 0.55;
  }

  .line.finished .words {
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }

  .spacer,
  .twist {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
  }

  .twist {
    display: grid;
    place-items: center;
    padding: 2px;
    border: none;
    background: none;
    color: var(--muted);
  }

  .words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .chips {
    flex: none;
    display: flex;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .chip.late {
    color: var(--danger);
  }

  .where {
    max-width: 38%;
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .sep {
    margin: 0 0.3em;
  }

  .space {
    margin-inline-end: 0.4em;
    color: var(--muted-strong);
  }

  @media (hover: hover) {
    .where:hover {
      color: var(--text-strong);
    }
  }

  .line:global(.is-carried) {
    opacity: 0.35;
  }

  :global([data-touch]) .where {
    display: none;
  }

  /* The view's conditional colour (nib.colour), the row's tone over its ground. */
  .toned {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
