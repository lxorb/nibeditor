<script lang="ts">
  /** The change a write that asked first would make (docs/ai-sidebar.md 4.4, "Ask
   *  before edits"): drawn in the tool's row beside Allow and Don't allow, so the
   *  question is a diff rather than a sentence. Nothing where the change cannot be
   *  worked out; the question's own line says it then. */
  import type { Part } from '../chat/types'
  import { workspace } from '../../workspace.svelte'
  import { diffCount } from '../../diff'
  import { type Preview, previewOf } from './preview'
  import Tally from './Tally.svelte'

  const { part }: { part: Extract<Part, { kind: 'tool' }> } = $props()

  let shown = $state.raw<Preview | null>(null)

  $effect(() => {
    let current = true
    void previewOf(
      part.verb,
      part.args,
      workspace.spaces,
      workspace.activeSpaceId ?? undefined,
      (path) => workspace.noteText(path).catch(() => null),
    ).then((made) => {
      if (current) shown = made
    })
    return () => {
      current = false
    }
  })

  const counted = $derived(shown ? diffCount(shown.rows) : null)
</script>

{#if shown && counted}
  <div class="asked">
    <div class="head">
      <span class="name">{shown.path}</span>
      <Tally added={counted.added} removed={counted.removed} />
    </div>
    <div class="diff">
      {#each shown.rows as row, at (at)}
        <div class="row {row.change}">{row.text || ' '}</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .asked {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff {
    max-height: 14rem;
    overflow: auto;
    padding: var(--space-1) 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .row {
    padding: 0 var(--space-2);
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .row.added {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-strong);
  }

  .row.removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--text-strong);
  }
</style>
