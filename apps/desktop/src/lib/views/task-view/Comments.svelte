<script lang="ts">
  /** A task's comments in its view, Todoist's way the nib way: the list items under the
   *  task that are no tasks (task-body.ts), each with when it was written, and a field
   *  under them that writes one more, stamped. Enter sends, Shift and Enter is a new line,
   *  and a comment's cross takes it away again; each is one edit of the note, one undo.
   *  Read again whenever the task's row changes, which is when its note was written. */
  import type { Row } from '@nib/bases'
  import { i18n, t } from '../../i18n.svelte'
  import Cross from '../../Cross.svelte'
  import { workspace } from '../../workspace.svelte'
  import { noteText } from '../../workspace/note-text'
  import { addComment, deleteComment } from '../act'
  import { dateAt } from '../days'
  import { type Comment, commentsOf } from '../task-body'
  import Words from '../Words.svelte'
  import { grow } from '../../grow'

  const { row, path }: { row: Row; path: string } = $props()

  let comments = $state.raw<Comment[]>([])
  let words = $state('')
  let field = $state<HTMLTextAreaElement>()

  $effect(() => {
    const now = row
    const anchor = now.anchor
    if (!anchor) return
    let gone = false
    void noteText(workspace, path).then((text) => {
      if (!gone) comments = text === null ? [] : commentsOf(text, anchor)
    })
    return () => (gone = true)
  })

  /** When a comment was written, as a reader says it: the day and the time. */
  function when(at: string): string {
    const [day = '', time = ''] = at.split('T')
    const date = dateAt(day)
    if (Number.isNaN(date.getTime())) return at
    const [hours = 0, minutes = 0] = time.split(':').map(Number)
    date.setHours(hours, minutes)
    return i18n.when(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  function send() {
    const said = words.trim()
    if (!said) return
    words = ''
    void addComment(row, said)
  }

  /** The field, for the `c` key of the task's view. */
  export function focus() {
    field?.focus()
  }
</script>

<div class="comments">
  {#if comments.length}
    <p class="nib-section">{t('Comments')}</p>
  {/if}
  {#each comments as one (one.line)}
    <div class="comment">
      <div class="said"><Words words={one.text} /></div>
      {#if one.at}<span class="at">{when(one.at)}</span>{/if}
      <button
        type="button"
        class="nib-glyph gone"
        aria-label={t('Delete')}
        title={t('Delete')}
        onclick={() => void deleteComment(row, one.line)}><Cross /></button
      >
    </div>
  {/each}
  <textarea
    bind:this={field}
    bind:value={words}
    use:grow={words}
    class="nib-field composer"
    rows="1"
    aria-label={t('Comment')}
    placeholder={t('Comment')}
    onkeydown={(event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        send()
      } else if (event.key === 'Escape' && words) {
        event.stopPropagation()
        words = ''
      }
    }}></textarea>
</div>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .comment {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--text);
  }

  .said {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .at {
    flex: none;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .gone {
    flex: none;
    align-self: center;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .comment:hover .gone,
  .gone:focus-visible {
    opacity: 1;
  }

  :global([data-touch]) .gone {
    opacity: 1;
  }

  .composer {
    margin-top: var(--space-2);
    resize: none;
    field-sizing: content;
    min-height: var(--row-height);
    max-height: 30vh;
  }
</style>
