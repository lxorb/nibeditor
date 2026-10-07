<script lang="ts">
  /** A note a message links, as a live card under its words (docs/chats.md 4.13, Teams'
   *  Loop and Slack's file card): the note's mark, its name and folder, and its first
   *  lines, read again whenever the space's index says a note was saved, so the card
   *  says what the note says now rather than what it said when it was sent. A press
   *  opens the note beside the chat. A link the reader's space cannot answer draws no
   *  card: the words already carry it. */
  import FileMark from '../../FileMark.svelte'
  import { fileMark } from '../../file-mark'
  import { links } from '../../link-index.svelte'
  import { folderOf, insideSpace, nameOf, withoutExtension } from '../../space-paths'
  import { workspace } from '../../workspace.svelte'
  import { cardLines } from './note-card'

  const { target }: { target: string } = $props()

  const relative = $derived(links.targetOf(null, { kind: 'wikilink', target }))
  const root = $derived(workspace.activeSpace?.root ?? null)
  const path = $derived(relative && root ? insideSpace(root, relative) : null)
  const name = $derived(path ? withoutExtension(nameOf(path)) : '')
  const folder = $derived(relative ? folderOf(relative) : '')

  let lines = $state.raw<string[]>([])

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  $effect(() => {
    follows(links.version)
    const note = path
    if (!note) return
    let current = true
    void workspace.noteText(note).then((text) => {
      if (current && text !== null) lines = cardLines(text, name)
    })
    return () => {
      current = false
    }
  })
</script>

{#if path}
  <button type="button" class="card" onclick={() => path && void workspace.openAside(path)}>
    <FileMark mark={fileMark(nameOf(path))} {path} />
    <span class="words">
      <span class="head">
        <strong>{name}</strong>
        {#if folder}<span class="folder">{folder}</span>{/if}
      </span>
      {#each lines as line, at (at)}
        <span class="line">{line}</span>
      {/each}
    </span>
  </button>
{/if}

<style>
  /* The link preview's shape, with the note's own mark in place of the site's picture. */
  .card {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    width: min(440px, 100%);
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-inline-start: 3px solid var(--accent-line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .card:hover {
    background: var(--surface-3);
  }

  .words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  strong {
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line {
    overflow: hidden;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
