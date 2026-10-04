<script lang="ts">
  /** A view, whole: its head and the layout its type asks for, over the engine's answer
   *  (docs/tasks.md 5.9). One frame for a view in a tab, a ` ```base ` fence and an
   *  embedded base, which differ only in how much room they have (`kit.compact`).
   *
   *  The layout switch swaps the body with the app's swap motion. On a phone the table
   *  becomes rows with their first properties under them, the calendar an agenda, and
   *  there is no timeline. Q adds a task, and G then T, U or I goes to Today, Upcoming
   *  or the Inbox, Todoist's own keys, wherever no field has the keyboard. */
  import { onDestroy } from 'svelte'
  import { t } from '../i18n.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { arrive } from '../slide'
  import { viewport } from '../viewport.svelte'
  import { workspace } from '../workspace.svelte'
  import AddRow from './AddRow.svelte'
  import AgendaLayout from './AgendaLayout.svelte'
  import BoardLayout from './BoardLayout.svelte'
  import CalendarLayout from './CalendarLayout.svelte'
  import CardsLayout from './CardsLayout.svelte'
  import ChartLayout from './ChartLayout.svelte'
  import { ghostOwner } from './drag.svelte'
  import DragGhost from './DragGhost.svelte'
  import type { Kit } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { openBuiltin } from './open'
  import PhoneRows from './PhoneRows.svelte'
  import TableLayout from './TableLayout.svelte'
  import TimelineLayout from './TimelineLayout.svelte'
  import UpcomingLayout from './UpcomingLayout.svelte'
  import ViewHead from './ViewHead.svelte'
  import { layoutOf } from './words'

  const { kit, title }: { kit: Kit; title: string } = $props()

  const live = $derived(kit.live)
  const layout = $derived(layoutOf(live.view?.type ?? 'table'))
  const phone = $derived(viewport.device === 'phone')
  const project = $derived(kit.spec.builtin === 'project')

  /** The add row the plus or Q asked for, over whichever layout is showing, and how
   *  many times it was asked (AddRow's `asked`). */
  let adding = $state(false)
  let asked = $state(0)

  const ghost = ghostOwner()
  onDestroy(ghost.release)

  /** G pressed, waiting for the letter that says where to. */
  let going = false
  let goingTimer: ReturnType<typeof setTimeout> | undefined

  function keydown(event: KeyboardEvent) {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]')
    )
      return
    // Undo and redo are the notes' own: a cell, a drop or a tick made here is a write
    // of a note, and the file actions' undo is the one that takes it back.
    if (shortcuts.pressed('edit.undo', event)) {
      event.preventDefault()
      void workspace.undoFileAction()
      return
    }
    if (shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)) {
      event.preventDefault()
      void workspace.redoFileAction()
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (going) {
      going = false
      clearTimeout(goingTimer)
      const to =
        event.key === 't'
          ? 'today'
          : event.key === 'u'
            ? 'upcoming'
            : event.key === 'i'
              ? 'inbox'
              : null
      if (to) {
        event.preventDefault()
        openBuiltin(to)
      }
      return
    }
    if (event.key === 'g') {
      going = true
      goingTimer = setTimeout(() => (going = false), 1200)
    } else if (shortcuts.pressed('tasks.quick-add', event) && layout !== 'list') {
      event.preventDefault()
      add()
    }
  }

  function add() {
    adding = true
    asked++
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="frame" class:compact={kit.compact} onkeydown={keydown}>
  <ViewHead {kit} {title} onadd={add} />
  {#if adding}
    <div class="adding"><AddRow {kit} {asked} onclose={() => (adding = false)} /></div>
  {/if}

  {#if live.failed}
    <p class="empty">{t('This base cannot be read')}</p>
  {:else}
    {#key layout}
      <div
        class="body"
        class:fills={layout === 'kanban' || layout === 'calendar' || layout === 'timeline'}
        in:arrive
      >
        {#if layout === 'list' && kit.spec.builtin === 'upcoming'}
          <UpcomingLayout {kit} />
        {:else if layout === 'list' || (layout === 'timeline' && phone)}
          <ListLayout {kit} where={!project} />
        {:else if layout === 'table'}
          {#if phone}<PhoneRows {kit} />{:else}<TableLayout {kit} />{/if}
        {:else if layout === 'cards'}
          <CardsLayout {kit} />
        {:else if layout === 'kanban'}
          <BoardLayout {kit} />
        {:else if layout === 'calendar'}
          {#if phone}<AgendaLayout {kit} />{:else}<CalendarLayout {kit} />{/if}
        {:else if layout === 'timeline'}
          <TimelineLayout {kit} />
        {:else}
          <ChartLayout {kit} />
        {/if}
      </div>
    {/key}
  {/if}
</div>

{#if ghost.mine()}
  <DragGhost />
{/if}

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    color: var(--text);
  }

  .frame.compact {
    height: auto;
    max-height: 560px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .adding {
    padding: var(--space-1) var(--space-2) 0;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .body.fills {
    overflow: hidden;
  }

  .compact .body.fills {
    height: 420px;
  }

  .empty {
    margin: var(--space-4);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
</style>
