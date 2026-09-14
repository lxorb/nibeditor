<script lang="ts">
  /** The Search panel: a field that understands operators, the lines they
   *  found, and a replacement to run over the ones that are ticked.
   *
   *  What is asked and what came back live in the search store, because a
   *  bookmarked search runs from the row above the file list. What is here is
   *  the field, the popup that finishes an operator's value, and the rows. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { shownName } from './note-name'
  import { SEARCH_MARK } from './panel-marks'
  import { roving } from './roving'
  import { search } from './search.svelte'
  import { OPERATORS } from './search/query'
  import { warm } from './search/warm.svelte'
  import { chosen, completing, naming, nearest, offered } from './search/suggest'
  import { taskAt } from '@nib/markdown/tasks'
  import type { Hit, Range } from './search/match'
  import { relativeTo } from './space-paths'
  import Suggest from './Suggest.svelte'
  import { nodesIn, tagTree } from './tag-tree'
  import TagTree from './TagTree.svelte'
  import { type Entry, workspace } from './workspace.svelte'
  import { dur } from './motion'

  const { ongoto }: { ongoto?: ((line: number) => void) | undefined } = $props()

  /** A star: the mark bookmarking wears wherever it is not a word. */
  const STAR =
    'M6.5 1.6l1.55 3.14 3.47.5-2.51 2.45.59 3.45L6.5 9.5 3.4 11.14l.59-3.45L1.48 5.24l3.47-.5z'

  /** Two rows and an arrow between them: one word standing in for another. */
  const SWAP = 'M1.8 4h7.4M7.4 2.2 9.2 4 7.4 5.8M11.2 9H3.8M5.6 7.2 3.8 9l1.8 1.8'

  const TICK = 'M2.6 6.6 5 9l5.4-5.4'

  let field = $state<HTMLInputElement>()
  let focused = $state(false)
  /** Set by Escape, so a popup that was shut stays shut until the next
   *  keystroke asks for it again. */
  let shut = $state(false)
  let caret = $state(0)
  let active = $state(0)

  /** The folders of the space, as `path:` writes them. */
  const folders = $derived.by(() => {
    const root = workspace.activeSpace?.root
    const tree = workspace.tree
    if (!root || !tree) return []

    const out: string[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (!child.is_dir) continue

        out.push(`${relativeTo(root, child.path).replace(/\\/g, '/')}/`)
        walk(child)
      }
    }

    walk(tree)
    return out.sort()
  })

  const names = $derived(
    [
      ...new Set(
        workspace.notes
          // What `file:` finishes is a name the search can find, and the search leaves
          // the archive out: offering one would be offering a query with no answer.
          .filter((note) => !workspace.leftOut.has(note.path))
          .map((note) => shownName(note.name)),
      ),
    ].sort(),
  )

  /** The space's tags as the tree their slashes describe. */
  const tags = $derived(tagTree(workspace.tags))

  /** Every node of it, by path, which is what `tag:` is finished with: a path is
   *  what the operator takes, and every node of the tree is one, so `tag:nib`
   *  offers `work/nib` as well as the tags spelled that way. */
  const tagPaths = $derived(nodesIn(tags).map((node) => node.path))

  /** What the caret is finishing, and what the space has to finish it with.
   *  Only while the field has the focus: a popup over a panel nobody is
   *  typing in is in the way. */
  const asking = $derived(
    focused && !shut ? (completing(search.text, caret) ?? naming(search.text, caret)) : null,
  )

  const suggestions = $derived.by(() => {
    if (!asking) return []
    // The operators themselves, while what is typed could still become one.
    if (asking.field === 'name') return offered(asking.typed, OPERATORS)
    // A tag path is deep and long, so it is the one value worth finding by a
    // handful of its letters: `wnc` offers `work/nib/canvas`. The same scorer the
    // hit list ranks with; see search/fuzzy.ts.
    if (asking.field === 'tag') return nearest(asking.typed, tagPaths)
    return offered(asking.typed, asking.field === 'path' ? folders : names)
  })

  // A question asked of another space is not this space's question. The panel
  // is rebuilt for each space, so this says which one it is showing.
  $effect(() => {
    search.forSpace(workspace.activeSpace?.root ?? null)
  })

  /** Reads a value for its own sake, so the effect around it follows that
   *  value. Nothing wants the value itself. */
  const follows = (_value: unknown) => undefined

  // A fresh list starts at the top: the row the arrow pointed at is no longer
  // the one under it.
  //
  // Except a list of operator names, which starts at none of them. That list is
  // offered rather than asked for - the reader typed a word that could still
  // become an operator - so Enter has to keep meaning Enter until an arrow or a
  // click says otherwise.
  $effect(() => {
    follows(suggestions)
    active = asking?.field === 'name' ? -1 : 0
  })

  /** The search in the box, as something to keep. */
  const searchMark = $derived(search.asks ? workspace.bookmarks.forSearch(search.text) : null)

  /** Whether this space has anything archived at all, which is whether the chip can
   *  change the answer. */
  const archived = $derived(workspace.leftOut.archived.length > 0)

  /** Consecutive hits from one note read as that note's hits, with its name
   *  said once above them. */
  const groups = $derived.by(() => {
    const out: { path: string; name: string; loose: boolean; hits: Hit[] }[] = []

    for (const hit of search.hits) {
      const last = out.at(-1)
      if (last?.path === hit.path) last.hits.push(hit)
      // A score is what a loose match has and an exact one has not; see fuzzy.ts.
      else out.push({ path: hit.path, name: hit.name, loose: hit.score !== undefined, hits: [hit] })
    }

    return out
  })

  /** One line cut into what matched and what did not, so the match can be
   *  emphasised without any markup in the string itself. */
  function pieces(text: string, ranges: Range[]) {
    const out: { text: string; mark: boolean }[] = []
    let at = 0

    for (const range of ranges) {
      if (range.from > at) out.push({ text: text.slice(at, range.from), mark: false })
      out.push({ text: text.slice(range.from, range.to), mark: true })
      at = range.to
    }

    if (at < text.length) out.push({ text: text.slice(at), mark: false })
    return out
  }

  function typing(event: Event & { currentTarget: HTMLInputElement }) {
    caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    shut = false
    search.ask(event.currentTarget.value)
  }

  function take(value: string) {
    if (!asking) return

    const next = chosen(search.text, asking, value)
    search.ask(next.text)
    caret = next.caret

    // The caret goes where the value ended, which is only true once Svelte has
    // put the new text in the field.
    queueMicrotask(() => {
      field?.focus()
      field?.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeydown(event: KeyboardEvent) {
    if (suggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        active = (active + 1) % suggestions.length
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        active = (active + suggestions.length - 1) % suggestions.length
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const value = suggestions[active]
        if (value !== undefined) {
          event.preventDefault()
          take(value)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // The popup and nothing else: the field keeps what is in it, and the
        // replace field below it keeps its place.
        shut = true
        return
      }
    }

    if (event.key === 'Escape' && search.replacing) {
      event.preventDefault()
      search.closeReplace()
    }
  }

  /** The task a row's line is, or null for a line that is not one. The words are
   *  what comes after the marker, and the emphasis moves along with them. */
  function taskOf(hit: Hit): { done: boolean; text: string; ranges: Range[] } | null {
    const task = taskAt(hit.text)
    if (!task) return null

    return {
      done: task.done,
      text: hit.text.slice(task.marker),
      ranges: hit.ranges
        .map((range) => ({ from: range.from - task.marker, to: range.to - task.marker }))
        .filter((range) => range.to > 0)
        .map((range) => ({ from: Math.max(range.from, 0), to: range.to })),
    }
  }

  /** The row's words, cut into what matched and what did not. */
  function shown(hit: Hit, task: { text: string; ranges: Range[] } | null) {
    return task ? pieces(task.text, task.ranges) : pieces(hit.text, hit.ranges)
  }

  /** The box in a row, pressed. The row underneath it opens the note, so the
   *  press stops here; and the box is drawn from the note rather than from
   *  itself, so it is left alone until the write has happened. */
  function ticked(event: Event, hit: Hit) {
    event.preventDefault()
    event.stopPropagation()
    void workspace.toggleTaskAt(hit.path, hit.line).then((done) => {
      // The note changed, so the search says what it says now.
      if (done) search.ask(search.text)
    })
  }

  async function openHit(hit: Hit) {
    // A row with a page is a paper: it opens where the words are rather than at a
    // line, which a paper has not got. See pdf/papers.ts.
    if (hit.page !== undefined) {
      workspace.openPdf(hit.path, hit.page)
      return
    }

    await workspace.open(hit.path)
    ongoto?.(hit.line)
  }
</script>

<!-- What the search is holding, said in one line: how many notes, how much text,
     against what cap. Not shown to anybody - it is an attribute, and the panel
     looks exactly as it did - but a profiler, a drive and whoever is asking why a
     search felt slow can all read it. See search/warmth.ts. -->
<div class="find" data-search={warm.said}>
  <div class="row">
    <div class="box">
      <!-- The same magnifier the pill it replaces wears, in the same place: one
           control that has become editable. -->
      <svg class="nib-field-mark mag" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>

      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={field}
        class="nib-field query"
        class:wide={search.asks}
        value={search.text}
        oninput={typing}
        onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onclick={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onkeydown={onKeydown}
        placeholder={focused && !search.text
          ? t('path: tag: file: -word "…" /re/')
          : t('Search this space')}
        spellcheck="false"
        role="combobox"
        aria-label={t('Search this space')}
        aria-expanded={suggestions.length > 0}
        aria-controls="nib-search-values"
        aria-activedescendant={suggestions.length ? `nib-search-values-${active}` : undefined}
        autofocus
      />

      <!-- How many lines answered, in the field it was asked in. -->
      {#if search.asks && search.hits.length}
        <span class="found" transition:fly={{ x: 6, duration: dur(130), easing: cubicOut }}>
          {search.hits.length}
        </span>
      {/if}

      <!-- The one place a bookmark is a mark rather than a word: there is no
           row to right-click, and a star in the box says what it does. -->
      {#if searchMark}
        {@const kept = workspace.bookmarks.has(searchMark)}
        <button
          class="star"
          class:on={kept}
          title={kept ? t('Remove bookmark') : t('Bookmark')}
          aria-label={kept ? t('Remove bookmark') : t('Bookmark')}
          aria-pressed={kept}
          onclick={() => workspace.bookmarks.toggle(searchMark)}
          transition:fly={{ x: 6, duration: dur(130), easing: cubicOut }}
        >
          <svg viewBox="0 0 13 13"><path d={STAR} /></svg>
        </button>
      {/if}

      {#if suggestions.length}
        <Suggest
          id="nib-search-values"
          label={t('Values')}
          values={suggestions}
          typed={asking?.typed ?? ''}
          {active}
          onchoose={take}
        />
      {/if}
    </div>

    <button
      class="swap"
      class:active={search.replacing}
      title={t('Replace')}
      aria-label={t('Replace')}
      aria-pressed={search.replacing}
      onclick={() => search.toggleReplace()}
    >
      <svg viewBox="0 0 13 13"><path d={SWAP} /></svg>
    </button>
  </div>

  <!-- One chip, and only where it can change the answer: a space with nothing archived
       in it has nothing to let back in, and a row that never does anything is a row
       worth not drawing. It says what it lets in rather than what it leaves out,
       because the leaving out is the resting state. -->
  {#if archived}
    <div class="row filters">
      <button
        class="chip"
        class:active={search.archived}
        aria-pressed={search.archived}
        onclick={() => search.showArchived(!search.archived)}
      >
        {t('Archived')}
      </button>
    </div>
  {/if}

  {#if search.replacing}
    <div class="row" transition:fly={{ y: -6, duration: dur(130), easing: cubicOut }}>
      <input
        class="nib-field query"
        value={search.replacement}
        oninput={(event) => (search.replacement = event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Escape') search.closeReplace()
          if (event.key === 'Enter') void search.replace()
        }}
        placeholder={t('Replace with')}
        spellcheck="false"
      />

      <button class="apply" disabled={!search.chosen.length} onclick={() => void search.replace()}>
        {t('Replace')}<span class="count">{search.chosen.length}</span>
      </button>
    </div>
  {/if}
</div>

{#if groups.length}
  <!-- The results are one tab stop and the arrows walk them, the same as every other
       list; see roving.ts. The rows are the lines found, not the notes they sit in:
       the name over a group is a heading, not somewhere to stand. -->
  <ul
    use:roving={{
      rows: '.hit',
      open: (row) => row.click(),
      peek: (row) => {
        row.click()
        row.focus()
      },
    }}
  >
    {#each groups as group, index (`${group.path}:${index}`)}
      <li class="group">
        <div class="nib-section note">
          <!-- One character for "near enough", where a word would be prose. The
               place in the list already says it: the guesses are under the
               answers. -->
          {#if group.loose}<span class="guess" title={t('Close match')}>~</span>{/if}{shownName(
            group.name,
          )}
        </div>

        {#each group.hits as hit (hit.line)}
          {@const task = taskOf(hit)}
          <div class="line">
            {#if search.replacing}
              <button
                class="tick"
                class:on={search.keeps(hit)}
                role="checkbox"
                aria-checked={search.keeps(hit)}
                aria-label={hit.text}
                onclick={() => search.toggle(hit)}
              >
                <svg viewBox="0 0 13 13"><path d={TICK} /></svg>
              </button>
            {/if}

            <button class="nib-row is-short hit" onclick={() => void openHit(hit)}>
              <!-- A line that is a task shows its box, and the box works: a list
                   of everything still to do is only a tool if it can be done
                   from. The words after the marker, because the marker is what
                   the box now says. -->
              {#if task}
                <input
                  type="checkbox"
                  class="nib-checkbox"
                  checked={task.done}
                  aria-label={task.text}
                  onclick={(event) => ticked(event, hit)}
                />
              {/if}
              {#each shown(hit, task) as piece, at (at)}
                {#if piece.mark}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
              {/each}

              <!-- Which page of a paper the words are on, at the far end where a
                   row counts things. A note has no page and says nothing. -->
              {#if hit.page !== undefined}
                <span class="nib-row-meta">{t('Page {page}', { page: hit.page })}</span>
              {/if}
            </button>
          </div>
        {/each}
      </li>
    {/each}
  </ul>
{:else if search.asks && !search.running}
  <p class="empty-text">{t('Nothing found')}</p>
{:else if !search.text.trim() && tags.length}
  <!-- An empty search offers the space's own tags, which is how you find out
       what there is to search for. As the tree their slashes describe, in the
       file tree's own rows: `work/nib/canvas` is a path like a folder's. -->
  <TagTree nodes={tags} />
{/if}

<style>
  /* Where the pill stood, at the same inset, so the panel does not shuffle as
     the field takes its place. */
  /* Where the pill it replaces stood, so nothing shuffles as the field takes
     its place. */
  .find {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  /* Holds the field and everything that sits inside or under it. */
  .box {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  /* The box is `.nib-field`, drawn in the themes package, which is also what
     the pill at the top of the panel wears: the same control, now editable.
     What is left here is the room the mark in front and the marks behind it
     take out of it. */
  .query {
    padding-inline-start: calc(var(--row-pad) + var(--icon-md) + var(--row-gap));
    transition: padding-inline-end var(--dur-fast) var(--ease-out);
  }

  /* Room for the count and the star, taken only once there is a search to
     count or to keep. */
  .query.wide {
    padding-inline-end: 56px;
  }

  /* Over the field's own left padding, so the words start where the pill's
     words did. */
  .mag {
    position: absolute;
    inset-inline-start: var(--row-pad);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .found {
    position: absolute;
    top: 50%;
    inset-inline-end: 32px;
    transform: translateY(-50%);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  /* Inside the field rather than beside it: it is about what is in the field. */
  .star {
    position: absolute;
    top: 50%;
    inset-inline-end: 5px;
    transform: translateY(-50%);
    width: calc(var(--row-height) - 6px);
    height: calc(var(--row-height) - 6px);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .star:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .star:active {
    transform: translateY(-50%) scale(0.88);
  }

  .star.on {
    color: var(--accent);
  }

  /* Filled once it is kept: the shape alone says which way it stands. */
  .star.on svg {
    fill: currentColor;
  }

  .star:focus-visible {
    outline-offset: -1px;
  }

  /* Beside the field, because it is about the field rather than in it. */
  .swap {
    flex: none;
    width: var(--row-height);
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .swap:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .swap:active {
    background: var(--surface-press);
  }

  .swap.active {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .swap:focus-visible {
    outline-offset: -1px;
  }

  /* The filter row under the field, and the one chip on it. A chip rather than the
     glyph the replace toggle is, because it is a word: "Archived" says what it does and
     no picture of an archive would. Its on state is the toggle's own, so the two read as
     one kind of control in one place. */
  .filters {
    padding-inline-start: 2px;
  }

  .chip {
    flex: none;
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .chip:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .chip.active {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .chip:focus-visible {
    outline-offset: -1px;
  }

  :global([data-touch]) .chip {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .apply {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-height: var(--row-height);
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .apply:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .apply:active:not(:disabled) {
    background: var(--accent-press);
  }

  .apply:disabled {
    opacity: 0.45;
  }

  .apply .count {
    color: inherit;
    opacity: 0.75;
  }

  .apply:focus-visible {
    outline-offset: 1px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* One note's lines, under the note's name. */
  .group + .group {
    margin-top: var(--space-2);
  }

  /* A note's name over its lines is the section label the rest of the app uses,
     in the accent because it is also the thing the rows open. */
  .note {
    display: block;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The mark on a note found only by a near enough match. Quieter than the name
     it sits in front of: it says which kind of answer this is, and it is not the
     answer. */
  .guess {
    margin-inline-end: 3px;
    color: var(--muted);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* The row is `.nib-row`; a line of a note is read rather than tapped, so it
     is the short one, and what it holds is one line that never wraps. */
  .hit {
    flex: 1;
    min-width: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: var(--row-height-sm);
  }

  /* The words that answered, marked in the line they were found on. */
  mark {
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* A square that fills when it is on, which is the whole of what it says. */
  .tick {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    display: grid;
    place-items: center;
    margin-inline-start: 4px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: none;
    color: transparent;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .tick:hover {
    border-color: var(--accent-line);
  }

  .tick:active {
    transform: scale(0.86);
  }

  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .tick:focus-visible {
    outline-offset: 1px;
  }

  .tick svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .empty-text {
    margin: var(--space-3) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Everything above reads the row scale, and the row scale is restated from
     the touch scale in one place; see tokens.css. What is left is the room the
     count and the star need once a thumb has made them bigger, and the field's
     own size, which has to clear where iOS zooms into a focused one. */
  :global([data-touch]) .query.wide {
    padding-inline-end: 68px;
  }

  :global([data-touch]) .swap,
  :global([data-touch]) .apply {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .swap {
    width: var(--touch-target);
  }

  :global([data-touch]) .empty-text {
    font-size: var(--touch-text);
  }
</style>
