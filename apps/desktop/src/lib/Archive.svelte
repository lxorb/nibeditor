<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { relativeStep } from './ago'
  import { archivedSaid, unarchive } from './archive'
  import { archivedAt } from './archived'
  import { archiveList } from './archive-list.svelte'
  import { archiveGroups } from './archive-rows'
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { i18n, t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { dur } from './motion'
  import { shownName } from './note-name'
  import { roving } from './roving'
  import { insideSpace, nameOf } from './space-paths'
  import Twist from './Twist.svelte'
  import { workspace } from './workspace.svelte'

  /** One archived thing, as a row. */
  interface Row {
    /** As the space speaks of it, which is the key everything here is about. */
    at: string
    /** And as the app holds it, which is what opens and what a menu is about. */
    path: string
    label: string
    /** When it was put away, or null where the file says a word rather than a date. */
    when: number | null
    kind: Mark
    folder: boolean
    active: boolean
  }

  const root = $derived(workspace.activeSpace?.root ?? null)

  /** The formatter, once per language rather than once per row: building one reads the
     locale data, which is far and away the dearest thing on a list of a few rows. The same
     trade RecentlyDeleted.svelte makes. */
  const relative = $derived(new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }))

  function ago(when: number): string {
    const step = relativeStep(Date.now() - when)
    return relative.format(step.value, step.unit)
  }

  /** Everything the space has put away, as rows.
   *
   *  Off the one predicate, so this list and the absences it explains are the same fact
   *  read twice rather than two facts that can disagree: a row is here exactly when it is
   *  not in the file list. See workspace/left-out.svelte.ts. */
  const rows = $derived.by((): Row[] => {
    const here = root
    if (here === null) return []

    return workspace.leftOut.archived.map((at) => {
      const path = insideSpace(here, at)
      const folder = workspace.entryAt(path)?.is_dir ?? false

      return {
        at,
        path,
        label: shownName(nameOf(at)),
        when: archivedAt(archivedSaid(path)),
        // A folder wears the blank page the file list gives it, so the two rows for one
        // thing are one thing; see Bookmarks.svelte, which reads the same rule.
        kind: folder ? 'file' : fileMark(nameOf(at)),
        folder,
        active: workspace.active?.path === path,
      }
    })
  })

  /** The same rows under the folder each was in, narrowed where the reader arrived here
   *  from a refused deletion. The ordering is archive-rows.ts's, so it can be said without
   *  a screen; see there for why it is what it is. */
  const groups = $derived(archiveGroups(rows, archiveList.inside))

  /** The count beside the heading. Everything in the space, not what a narrowing left: the
   *  heading says how much is put away, and the narrowing is a state of the list under it. */
  const count = $derived(rows.length)

  function open(row: Row) {
    if (row.folder) workspace.revealFolder(row.path)
    else void workspace.openEntry(row.path, { preview: true })
  }

  function rowMenu(row: Row): MenuEntry[] {
    return [
      { label: t('Open'), run: () => open(row) },
      DIVIDER,
      // The two that keep the mark. A note taken out of the archive has to come back where
      // it was, and a note renamed inside the archive has to still be in it: both are the
      // workspace's own operations, which tell every store that keys by path - the archive
      // among them. See `moved` in workspace/archived-folders.svelte.ts.
      { label: t('Rename'), run: () => workspace.startRenaming(row.path) },
      DIVIDER,
      { label: t('Unarchive'), run: () => void unarchive(row.path) },
    ]
  }
</script>

<!-- Only where there is something in it. An archive nobody has put anything in is a row
     that explains a feature rather than showing a list, at the foot of the one panel that
     is read most - so it is not drawn at all until the first thing goes into it. -->
{#if count}
  <p class="nib-section">
    <button
      class="head"
      aria-expanded={archiveList.open}
      onclick={() => archiveList.toggle()}
      type="button"
    >
      <span class="chevron"><Twist open={archiveList.open} /></span>
      {t('Archived')}
    </button>
    <span class="tally">{count}</span>
  </p>

  {#if archiveList.open}
    <div transition:slide={{ duration: dur(160), easing: cubicOut }}>
      {#if archiveList.inside !== null}
        <!-- What a narrowing is, said where it applies, and pressing it is the way out: a
             list quietly showing three of two hundred rows is a list that looks broken,
             and the count over the heading says the two hundred either way. No word for
             the way out, because the folder's name and a cross are the whole sentence -
             and a word here would be a word in forty catalogues for a row a reader sees
             once. -->
        <button class="narrowed" onclick={() => archiveList.show(null)} type="button">
          <span>{archiveList.inside}</span>
          <span class="cross" aria-hidden="true">×</span>
        </button>
      {/if}

      <!-- One tab stop for the whole archive and the arrows inside it, the bookmarks' own
           shape one section along: Enter opens and the note takes the keyboard, Space
           opens and leaves the keyboard here. Delete is what a list normally binds to
           taking a row off itself, and here it is bound to nothing at all - an archived
           note is never deleted, and the key that deletes elsewhere doing it here would
           be the one hole in that. -->
      <ul
        use:roving={{
          current: '.is-on',
          rows: '.row',
          open: (element) => element.click(),
          peek: (element) => {
            element.click()
            element.focus()
          },
          menu: (element, at) => element.dispatchEvent(at),
        }}
      >
        {#each groups as group (group.at)}
          {#if group.at}
            <li class="where">{group.at}</li>
          {/if}

          {#each group.rows as row (row.at)}
            <li>
              <button
                class="nib-row row"
                class:is-quiet={row.folder}
                class:is-on={row.active}
                data-at={row.at}
                onclick={() => open(row)}
                oncontextmenu={(event) => menu.show(event, rowMenu(row), { title: row.label })}
                use:longPress={(event) => menu.show(event, rowMenu(row), { title: row.label })}
                type="button"
              >
                <FileMark mark={row.kind} path={row.path} />
                <span class="nib-row-label">{row.label}</span>
                {#if row.when !== null}
                  <span class="nib-row-meta">{t('archived {when}', { when: ago(row.when) })}</span>
                {/if}
              </button>
            </li>
          {/each}
        {/each}
      </ul>
    </div>
  {/if}
{/if}

<style>
  /* The bookmarks' list, to the character: same reset, same bottom space. The two sections
     bracket the file list and a reader should not be able to tell which of them they are
     in by the spacing. */
  ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
  }

  /* The heading is a button, because the section folds. It takes the heading's own words
     from `.nib-section` and adds nothing but the twist. */
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: default;
  }

  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  .tally {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .where {
    padding: var(--space-1) var(--row-pad) 0;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .narrowed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 0 var(--row-pad) var(--space-1);
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    text-align: start;
    color: var(--accent);
    cursor: default;
  }

  .narrowed span:first-child {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cross {
    flex: none;
    font-size: var(--text-sm);
    line-height: 1;
  }

  .row {
    flex: 1;
    min-width: 0;
    padding-inline-start: calc(var(--icon-md) + var(--space-1));
  }
</style>
