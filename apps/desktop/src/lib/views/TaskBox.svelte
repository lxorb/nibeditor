<script lang="ts">
  /** A task's box in a view: Todoist's circle, ringed in its priority's tone, half
   *  filled while it is being done, filled and ticked once it is. Pressing it ticks the
   *  task through the engine's tick (act.ts), which is the editor's tick: a recurring
   *  task writes its next occurrence in the same edit. The fill answers the press at
   *  once and the row follows when the note is written. */
  import type { TaskRow } from '@nib/bases'
  import { priorityTone } from '../quick-add/labels'

  const {
    task,
    label,
    ontick,
    disabled = false,
  }: {
    task: TaskRow
    label: string
    ontick: () => void
    disabled?: boolean
  } = $props()

  /** The task as it was when the box was pressed and before the note was written back:
   *  drawn ticked so the press lands at once. The row that comes back from the note is
   *  another object, and whatever it says is the truth from then on. */
  let pressed = $state.raw<TaskRow | null>(null)
  const done = $derived(task.done || pressed === task)

  const tone = $derived(priorityTone(task.priority))
</script>

<button
  type="button"
  class="box"
  class:done
  class:doing={task.status === '/'}
  class:cancelled={task.cancelled}
  style:--tone={tone}
  role="checkbox"
  aria-checked={task.status === '/' ? 'mixed' : done}
  aria-label={label}
  {disabled}
  onclick={(event) => {
    event.stopPropagation()
    if (!task.done) pressed = task
    ontick()
  }}
>
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle class="ring" cx="8" cy="8" r="6.6" />
    <path class="half" d="M8 1.4a6.6 6.6 0 0 1 0 13.2z" />
    <circle class="fill" cx="8" cy="8" r="6.6" />
    <path class="tick" d="M5 8.2l2 2 4-4.2" />
    <path class="dash" d="M5 8h6" />
  </svg>
</button>

<style>
  .box {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--tone, var(--muted));
    cursor: default;
  }

  svg {
    width: 16px;
    height: 16px;
    overflow: visible;
  }

  .ring {
    fill: color-mix(in srgb, var(--tone, transparent) 10%, transparent);
    stroke: currentColor;
    stroke-width: 1.4;
    transition: stroke var(--dur-fast) var(--ease-out);
  }

  .half {
    fill: currentColor;
    opacity: 0;
  }

  .fill {
    fill: var(--tone, var(--muted));
    transform-origin: 8px 8px;
    transform: scale(0);
    transition: transform var(--dur-base) var(--ease-spring);
  }

  .tick,
  .dash {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .doing .half {
    opacity: 0.55;
  }

  .done .fill,
  .cancelled .fill {
    transform: scale(1);
  }

  .done .tick,
  .cancelled .dash {
    opacity: 1;
  }

  .cancelled {
    color: var(--muted);
  }

  @media (hover: hover) {
    .box:hover .tick {
      opacity: 0.6;
      stroke: currentColor;
    }

    .box.done:hover .tick {
      stroke: var(--bg);
      opacity: 1;
    }
  }

  .box:active svg {
    transform: scale(0.88);
  }

  :global([data-touch]) .box {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }
</style>
