<script lang="ts">
  /** The add row at the end of a group, and the one-line field it turns into.
   *
   *  Pressed, it asks the view what a task added here starts with (kit.ts): quick add
   *  opens with that, and where the group is more than quick add carries (a section, a
   *  priority, a status) this field takes the words. Enter writes the line and the field stays for the next, Todoist's habit;
   *  Escape or leaving it empty puts the row back. No toast: the new row arrives in the
   *  view above the field. */
  import type { Group } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { addTyped, type Prefill } from './add'
  import type { Kit } from './kit'

  const {
    kit,
    group = null,
    asked = 0,
    onclose,
  }: {
    kit: Kit
    group?: Group | null
    /** Counts the times a key (Q) or the head's plus asked for the field rather than a
     *  press on the row: each new count opens it. */
    asked?: number
    /** The field put away, for a host that drew the row only to hold it. */
    onclose?: () => void
  } = $props()

  let prefill = $state<Prefill | null>(null)
  let words = $state('')
  let field = $state<HTMLInputElement>()

  const property = $derived(kit.live.view?.groupBy?.property)
  /** A view of notes adds a note, where its filter points; see add.ts. */
  const label = $derived(
    (kit.live.view?.nib.rows ?? 'notes') === 'notes' ? t('New note') : t('Add task'),
  )

  function start() {
    const asked = kit.add(group && property ? { property, key: group.key } : undefined)
    prefill = asked
    // The quick add took it, or a note was made: nothing for this field to hold.
    if (asked) queueMicrotask(() => field?.focus())
    else onclose?.()
  }

  $effect(() => {
    if (asked > 0) untrack(start)
  })

  function close() {
    prefill = null
    words = ''
    onclose?.()
  }

  async function write() {
    const said = words
    if (!prefill || !said.trim()) return
    words = ''
    await addTyped(said, prefill)
  }
</script>

{#if prefill}
  <div class="nib-row adding">
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
    </span>
    <input
      bind:this={field}
      bind:value={words}
      class="field"
      aria-label={t('Add task')}
      placeholder={t('Add task')}
      onkeydown={(event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void write()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      onblur={() => {
        if (!words.trim()) close()
      }}
    />
  </div>
{:else}
  <button type="button" class="nib-row adder" onclick={start}>
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
    </span>
    <span class="nib-row-label">{label}</span>
  </button>
{/if}

<style>
  .adder,
  .adding {
    color: var(--muted);
  }

  .plus {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
  }

  .plus svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  @media (hover: hover) {
    .adder:hover {
      color: var(--accent);
    }
  }

  .field {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
  }

  .field::placeholder {
    color: var(--muted);
  }
</style>
