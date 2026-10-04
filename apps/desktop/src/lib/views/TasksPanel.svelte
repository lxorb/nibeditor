<script lang="ts">
  /** The Tasks panel (docs/tasks.md 5.5): where things are, with how many, in one
   *  glance - the add row, Inbox, Today (its count in the danger tone when something is
   *  overdue), Upcoming and the Logbook; then the saved views (the space's `.base`
   *  files), the projects (every note with open tasks, the most recently written first,
   *  seven and then More) and the labels. Bookmarked ones first in each. A row opens
   *  its view in a tab, the way the graph opens; the panel is navigation, the tab is
   *  the work.
   *
   *  Moved to the right, beside the note being written, it is Today's list itself, so
   *  the day can be worked through without leaving the note. */
  import { answer, readBase, type Row } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { rows } from '../rows/rows.svelte'
  import { relativeTo, samePath } from '../space-paths'
  import { links } from '../link-index.svelte'
  import { invoke } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { addTyped, openQuickAdd } from './add'
  import { contextFor } from './context'
  import { todayHere } from './days'
  import { kitFor } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { LiveView } from './live.svelte'
  import {
    ADD_MARK,
    INBOX_MARK,
    LABEL_MARK,
    LOGBOOK_MARK,
    PROJECT_MARK,
    TODAY_MARK,
    UPCOMING_MARK,
    VIEW_MARK,
  } from './marks'
  import { openBaseFile, openBuiltin, openLabel, openProject } from './open'
  import { panelCounts, PROJECTS_SHOWN } from './panel'
  import { builtinBase } from './source'
  import { type Builtin, readSpec } from './spec'
  import { builtinName } from './words'

  const { side = 'left' }: { side?: 'left' | 'right' } = $props()

  /** Every space's rows as the store last told of a change, which is what counts again. */
  let all = $state.raw<readonly Row[]>(untrack(() => rows.of()))
  let today = $state(todayHere())
  $effect(() =>
    untrack(() =>
      rows.watch(() => {
        all = rows.of()
        today = todayHere()
      }),
    ),
  )
  const counts = $derived(panelCounts(all, today, rows.inboxes()))

  let more = $state(false)
  const projects = $derived(more ? counts.projects : counts.projects.slice(0, PROJECTS_SHOWN))

  /** The open space's bookmarks, for the rows that go first. */
  const marked = $derived(workspace.bookmarks.list)
  const bookmarked = (space: string, path: string) =>
    space === workspace.activeSpace?.name &&
    marked.some((one) => one.kind === 'note' && samePath(one.path, path))
  const first = <T,>(list: readonly T[], top: (one: T) => boolean) => [
    ...list.filter(top),
    ...list.filter((one) => !top(one)),
  ]

  /** The space's `.base` files: its saved views. */
  const bases = $derived.by(() => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []
    return workspace.files
      .filter((one) => !one.is_dir && /\.base$/i.test(one.name))
      .map((one) => ({
        path: one.path,
        name: one.name.replace(/\.base$/i, ''),
        relative: relativeTo(root, one.path),
      }))
  })

  /** Each base file read once, and again when it is written. */
  let read = $state<Record<string, ReturnType<typeof readBase> | null>>({})
  $effect(() => {
    const paths = bases.map((one) => one.path)
    untrack(() => {
      for (const path of paths) {
        if (path in read) continue
        void invoke<string>('read_note', { path })
          .then((text) => (read = { ...read, [path]: readBase(text) }))
          .catch(() => (read = { ...read, [path]: null }))
      }
    })
  })
  $effect(() =>
    untrack(() =>
      links.hearSaves((path, text) => {
        if (path in read) read = { ...read, [path]: readBaseOrNull(text) }
      }),
    ),
  )
  const readBaseOrNull = (text: string) => {
    try {
      return readBase(text)
    } catch {
      // A base being written by hand is YAML half the time: it counts nothing until
      // it reads again.
      return null
    }
  }
  const baseCount = (path: string): number | null => {
    const base = read[path]
    const space = workspace.activeSpace?.name
    if (!base || space === undefined) return null
    try {
      const mine = all.filter((one) => one.space === space)
      return answer(base, 0, mine, contextFor({ rows: mine, today, now: `${today}T00:00:00` }))
        .total
    } catch {
      return null
    }
  }

  /** Which view the tab in front is, to mark its row. */
  const front = $derived.by(() => {
    const tab = workspace.panelTab ?? workspace.active
    if (tab?.kind !== 'view') return null
    return { path: tab.path, spec: readSpec(tab.doc) }
  })
  const isOn = (builtin: Builtin, extra?: { path?: string; tag?: string }) =>
    front?.spec?.builtin === builtin &&
    (extra?.path === undefined || front.spec.path === extra.path) &&
    (extra?.tag === undefined || front.spec.tag === extra.tag)

  let typing = $state(false)
  let words = $state('')

  function add() {
    if (!openQuickAdd()) typing = true
  }

  async function write() {
    const said = words
    if (!said.trim()) return
    words = ''
    await addTyped(said, {})
  }

  function projectMenu(event: MouseEvent, space: string, path: string) {
    menu.show(event, [
      { label: t('Open'), run: () => openProject(space, path) },
      { label: t('Open as board'), run: () => openProject(space, path, 'kanban') },
      { label: t('Open as calendar'), run: () => openProject(space, path, 'calendar') },
    ])
  }

  /** On the right: Today, worked through beside the note. */
  const beside = $derived.by(() => {
    if (side !== 'right') return null
    return untrack(() => {
      // Changes to how it is drawn here stay here: the panel keeps no words of its own.
      const live = new LiveView({
        scope: null,
        load: () => Promise.resolve(builtinBase({ builtin: 'today' })),
        save: () => Promise.resolve(),
      })
      return { live, kit: kitFor(live, { builtin: 'today' }, null, true) }
    })
  })
  $effect(() => {
    const here = beside
    if (here) return untrack(() => here.live.start())
  })
</script>

{#snippet row(
  mark: string,
  label: string,
  count: number | null,
  on: boolean,
  open: () => void,
  late = false,
  context?: (event: MouseEvent) => void,
)}
  <button type="button" class="nib-row" class:is-on={on} onclick={open} oncontextmenu={context}>
    <span class="nib-row-mark"
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={mark} /></svg></span
    >
    <span class="nib-row-label">{label}</span>
    {#if count}<span class="nib-row-meta" class:late>{count}</span>{/if}
  </button>
{/snippet}

<div class="tasks">
  {#if typing}
    <div class="nib-row adding">
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field"
        bind:value={words}
        autofocus
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
            typing = false
            words = ''
          }
        }}
        onblur={() => {
          if (!words.trim()) typing = false
        }}
      />
    </div>
  {:else}
    <button type="button" class="nib-row adder" onclick={add}>
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <span class="nib-row-label">{t('Add task')}</span>
    </button>
  {/if}

  {#if beside}
    <ListLayout kit={beside.kit} />
  {:else}
    {@render row(INBOX_MARK, builtinName('inbox'), counts.inbox, isOn('inbox'), () =>
      openBuiltin('inbox'),
    )}
    {@render row(
      TODAY_MARK,
      builtinName('today'),
      counts.today,
      isOn('today'),
      () => openBuiltin('today'),
      counts.overdue,
    )}
    {@render row(UPCOMING_MARK, builtinName('upcoming'), null, isOn('upcoming'), () =>
      openBuiltin('upcoming'),
    )}
    {@render row(LOGBOOK_MARK, builtinName('logbook'), null, isOn('logbook'), () =>
      openBuiltin('logbook'),
    )}

    {#if bases.length}
      <p class="nib-section">{t('Views')}</p>
      {#each first( bases, (one) => bookmarked(workspace.activeSpace?.name ?? '', one.relative) ) as one (one.path)}
        {@render row(
          VIEW_MARK,
          one.name,
          baseCount(one.path),
          front?.path !== undefined && samePath(front.path, one.path),
          () => openBaseFile(one.path),
        )}
      {/each}
    {/if}

    {#if counts.projects.length}
      <p class="nib-section">{t('Projects')}</p>
      {#each first( projects, (one) => bookmarked(one.space, one.path) ) as one (`${one.space}:${one.path}`)}
        {@render row(
          PROJECT_MARK,
          one.name,
          one.count,
          isOn('project', { path: one.path }),
          () => openProject(one.space, one.path),
          false,
          (event) => projectMenu(event, one.space, one.path),
        )}
      {/each}
      {#if counts.projects.length > PROJECTS_SHOWN}
        <button type="button" class="nib-row is-short more" onclick={() => (more = !more)}>
          <span class="nib-row-label">{more ? t('Less') : t('More')}</span>
        </button>
      {/if}
    {/if}

    {#if counts.labels.length}
      <p class="nib-section">{t('Labels')}</p>
      {#each counts.labels as one (one.tag)}
        {@render row(LABEL_MARK, one.tag, one.count, isOn('label', { tag: one.tag }), () =>
          openLabel(one.tag),
        )}
      {/each}
    {/if}
  {/if}
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
  }

  .nib-row-mark svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .late {
    color: var(--danger);
  }

  .adder,
  .more {
    color: var(--muted);
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
