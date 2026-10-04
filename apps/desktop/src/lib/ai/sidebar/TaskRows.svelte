<script lang="ts">
  /** `/tasks`'s rows in a thread: a box, the words, the day. A box ticks the task in
   *  its note through the one write path, as a box in any view does, and stays where it
   *  is, dimmed, so a tick is undone by ticking again; the words open the note when it
   *  is in the space on screen. The filter the rows answer is shown above them, so a
   *  filter the model wrote is one the reader can learn. See commands/todos.ts. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { insideSpace } from '../../space-paths'
  import { workspace } from '../../workspace.svelte'
  import type { Listed } from '../commands/todos'

  const { said }: { said: string } = $props()

  type Task = Listed['tasks'][number]

  /** The notice's words, read back: a thread is a file anybody could have written. */
  function read(text: string): Listed | null {
    try {
      const value: unknown = JSON.parse(text)
      if (typeof value !== 'object' || value === null || !('tasks' in value)) return null
      const { tasks, total, filter } = value as Record<string, unknown>
      if (!Array.isArray(tasks)) return null
      const rows = tasks.filter(
        (one): one is Task =>
          typeof one === 'object' &&
          one !== null &&
          typeof (one as Task).at === 'string' &&
          typeof (one as Task).text === 'string' &&
          typeof (one as Task).space === 'string',
      )
      return {
        tasks: rows,
        total: typeof total === 'number' ? total : rows.length,
        ...(typeof filter === 'string' ? { filter } : {}),
      }
    } catch {
      // Not ours, or cut short: nothing to draw.
      return null
    }
  }

  const listed = $derived(read(said))

  /** What each box says now, where the reader changed it here. */
  let ticked = $state<Record<string, boolean>>({})

  const isDone = (one: Task) => ticked[one.at] ?? (one.status === 'x' || one.status === 'X')

  async function tick(one: Task) {
    const done = !isDone(one)
    ticked = { ...ticked, [one.at]: done }
    const { tickTask } = await import('../../task-actions')
    if (!(await tickTask(one.at, one.space, done))) ticked = { ...ticked, [one.at]: !done }
  }

  function open(one: Task) {
    const space = workspace.activeSpace
    if (space?.name !== one.space) return
    void workspace.open(insideSpace(space.root, one.at.replace(/#\d+:[0-9a-z]+$/, '')))
  }

  /** The day and time a row is for, as written. */
  const when = (one: Task) => [one.due, one.time].filter(Boolean).join(' ')
</script>

{#if listed}
  <div class="tasks" in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    {#if listed.filter}
      <code class="filter">{listed.filter}</code>
    {/if}
    {#each listed.tasks as one (one.at)}
      <div class="task" class:done={isDone(one)}>
        <button
          class="box"
          class:p1={one.priority === 1}
          class:p2={one.priority === 2}
          class:p3={one.priority === 3}
          role="checkbox"
          aria-checked={isDone(one)}
          aria-label={t('Done')}
          onclick={() => void tick(one)}
        ></button>
        <button class="words" title={one.space} onclick={() => open(one)}>{one.text}</button>
        {#if when(one)}
          <span class="when">{when(one)}</span>
        {/if}
      </div>
    {:else}
      <span class="none">∅</span>
    {/each}
    {#if listed.total > listed.tasks.length}
      <span class="none">+{listed.total - listed.tasks.length}</span>
    {/if}
  </div>
{/if}

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .filter {
    align-self: flex-start;
    margin-bottom: var(--space-1);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-mono);
  }

  .task {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .task.done {
    opacity: 0.5;
  }

  .box {
    flex: none;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1.5px solid var(--muted);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    transition:
      background var(--dur-instant) var(--ease-out),
      border-color var(--dur-instant) var(--ease-out);
  }

  .box.p1 {
    border-color: var(--canvas-1);
  }

  .box.p2 {
    border-color: var(--canvas-2);
  }

  .box.p3 {
    border-color: var(--canvas-5);
  }

  .task.done .box {
    border-color: var(--accent);
    background: var(--accent);
  }

  .box:active {
    transform: scale(0.9);
  }

  .words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .task.done .words {
    text-decoration: line-through;
  }

  .when,
  .none {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
