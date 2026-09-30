<script lang="ts">
  /** One search over everything: the notes and every other file, the open tabs, the
   *  bookmarks, the commands, the pages this device has visited and the settings, in
   *  one list, each row wearing the mark its kind wears everywhere else. Opened with
   *  Shift twice, Ctrl+P, or Ctrl+Shift+P narrowed to the commands; see the shortcut
   *  registry.
   *
   *  Emil, 2026-09-30: *"for ctrl + P the search should be kinda global, I don't wanna
   *  split between > or not, it should be all in the same thing"*. What is found and
   *  in what order is palette/kinds.ts and palette/rank.ts; this is the field, the
   *  list, and what a row does when it is chosen. */
  import { tick, untrack } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import FilePlus from 'lucide/dist/esm/icons/file-plus.mjs'
  import { appCommands } from './commands'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { frecency } from './frecency'
  import { recentFirst } from './fuzzy'
  import { t } from './i18n.svelte'
  import Icon from './Icon.svelte'
  import { middleOpens } from './new-tab'
  import { shownName } from './note-name'
  import { scanHeadings } from './outline'
  import { overlays } from './overlays'
  import { OUTLINE_MARK, GRAPH_MARK, SEARCH_MARK } from './panel-marks'
  import { candidates, headingCandidates, resting, rowKey, type World } from './palette/kinds'
  import { lineAsked, modeOf } from './palette/mode'
  import { choose, type Hands } from './palette/choose'
  import { makeable, typedAddress, withOffers } from './palette/offers'
  import { pieces } from './palette/pieces'
  import { MOST, ranked } from './palette/rank'
  import type { OpenTab, Row } from './palette/rows'
  import { settingsOf, settingValue } from './palette/settings'
  import { type Look, lookOf } from './palette/trying'
  import { preferences } from './preferences'
  import { search } from './search.svelte'
  import { settings } from './settings.svelte'
  import { landing } from './settings/landing.svelte'
  import { places } from './settings/places'
  import { ICONS, sectionGroups } from './settings/sections'
  import { relativeTo } from './space-paths'
  import TabMark from './TabMark.svelte'
  import { theme } from './theme.svelte'
  import { joinPath } from './tauri'
  import { trap } from './trap'
  import { viewport } from './viewport.svelte'
  import { shownAddress } from './web-tab/omnibox'
  import { pages } from './web-tab/pages.svelte'
  import { visited } from './web-tab/visited'
  import { visitKey } from './web-tab/visits'
  import { webData } from './web-tab/web-data.svelte'
  import { workspace } from './workspace.svelte'
  import { LAYER } from './motion'

  /* eslint-disable prefer-const -- `open` is bindable, and a $props() pattern cannot be split */
  let {
    open = $bindable(false),
    view,
    ongoto,
  }: {
    open?: boolean
    view?: EditorView | undefined
    /** Takes the note in front to a line of it, counting from zero; see App.svelte. */
    ongoto?: (line: number) => void
  } = $props()
  /* eslint-enable prefer-const */

  let query = $state('')
  let cursor = $state(0)
  let input = $state<HTMLInputElement>()

  const asked = $derived(modeOf(query))
  const mode = $derived(asked.mode)
  const term = $derived(asked.term)

  /** A phone has no web tab, so it has no pages to go to either; nor has the glasses'
   *  plugin on any screen, whose package leaves the history and the address rows out. */
  const browses = $derived(!__EVEN_PLUGIN__ && viewport.device !== 'phone')

  /** Something was taken out of the history or the list of things used: the one
   *  change the stores below do not say themselves. */
  let forgotten = $state(0)

  /** Every command there is, built while the palette is open and not once per
   *  keystroke: the list asks what the document goes out as, and answering that
   *  walks every line of it. What a row says still follows the app - the labels
   *  read the stores, so this rebuilds when one of them changes - but typing
   *  changes none of them. */
  const commands = $derived(open ? appCommands(view) : [])

  /** Every setting, read off the same lists the settings' own search reads. */
  const settingRows = $derived(
    open ? settingsOf(sectionGroups().flat(), preferences(view), places(), t('Settings')) : [],
  )

  /** The open tabs, as the list needs them: a page's address read the way the
   *  history keeps one, so the same page is known in both. */
  const tabs = $derived(
    workspace.tabs.map((tab): OpenTab => ({
      id: tab.id,
      kind: tab.kind,
      path: tab.path,
      shown: tab.shown,
      url: tab.kind === 'web' ? visitKey(pages.of(tab.id).url ?? '') : null,
    })),
  )

  const root = $derived(workspace.activeSpace?.root ?? null)

  /** What the stores hold, while the palette is open. The history is read here the
   *  first time, never at launch; see visited.ts. */
  const world = $derived.by((): World | null => {
    if (!open) return null
    follows(forgotten)

    return {
      root: root ?? '',
      files: workspace.files,
      tabs,
      active: workspace.activeTabId,
      focused: workspace.active?.kind ?? null,
      recent: workspace.recent,
      bookmarks: workspace.bookmarks.list,
      commands,
      pages: browses ? visited.all(webData.history(workspace.activeSpaceId)) : [],
      settings: settingRows,
      worth: (key) => frecency.worth(key),
      now: Date.now(),
    }
  })

  const all = $derived(world ? candidates(world) : [])

  /** What the space archived is offered for its whole name only, the way `[[` offers
   *  it: somebody who types all of it means that one. Per keystroke, over rows already
   *  built, so the candidates are still built once per opening. */
  const offered = $derived.by(() => {
    const whole = term.trim().toLowerCase()
    return all.filter(
      ({ item }) =>
        item.kind !== 'note' ||
        !workspace.archive.has(item.entry.path) ||
        shownName(item.entry.name).toLowerCase() === whole,
    )
  })

  /** The note a `#`, a `:` or a heading typed for is about: the one in front, and
   *  only a note - a canvas and a paper have no lines to go to. */
  const writing = $derived(workspace.active?.kind === 'note' ? view : undefined)

  /** Its headings, read the first time something could want them - a `#`, or three
   *  letters of a search - rather than on every opening. */
  const wantsHeadings = $derived(mode === 'headings' || (mode === 'everything' && term.length >= 3))
  const headings = $derived(
    open && wantsHeadings && writing ? scanHeadings(writing.state.doc.toString()) : [],
  )
  const headingRows = $derived(headingCandidates(headings, mode === 'headings'))

  /** Folder and name, lower case, of every file: what a name typed would collide with. */
  const taken = $derived(
    new Set(workspace.files.map((one) => relativeTo(root ?? '', one.path).toLowerCase())),
  )

  /** The note Shift+Enter would make out of what was typed, whatever else answers:
   *  only where the words read as a name, and not one the space already has. */
  const makes = $derived(mode === 'everything' && root ? makeable(term, taken) : null)

  /** An address typed, where it is one. */
  const address = $derived.by(() => {
    const url = browses && mode === 'everything' ? typedAddress(term) : null
    return url ? { url, shown: shownAddress(url) } : null
  })

  /** The commands narrowed to, with the ones run lately first: VS Code's "recently
   *  used". */
  function commandRows(): Row[] {
    const list = all.filter((one) => one.kind === 'command')
    if (term) return ranked(term, list)

    const lately = frecency.latest('command:', 8)
    return recentFirst(list, lately, (one) => one.key ?? '').map((one) => one.item)
  }

  const results = $derived.by((): Row[] => {
    if (mode === 'commands') return commandRows()

    // Every heading of a long note, not the first screenful of them.
    if (mode === 'headings') return ranked(term, headingRows, headingRows.length)

    if (mode === 'line') {
      const line = writing ? lineAsked(term, writing.state.doc.lines) : null
      if (line === null || !writing) return []
      const text = writing.state.doc.line(line + 1).text.trim()
      return [{ kind: 'place', line, text, depth: 0, hint: String(line + 1) }]
    }

    if (!term) return world ? resting(offered, world, (key) => frecency.last(key), MOST) : []

    return withOffers(ranked(term, [...offered, ...headingRows]), term, address, makes)
  })

  /** What a row is called. */
  function label(row: Row): string {
    switch (row.kind) {
      case 'command':
        return row.command.label
      case 'note':
        return shownName(row.entry.name)
      case 'tab':
        return row.tab.shown
      case 'bookmark':
        return row.label
      case 'page':
        return row.title
      case 'setting':
        return row.setting.label
      case 'make':
        return shownName(row.make.name)
      case 'address':
        return row.address
      case 'place':
        return row.text
    }
  }

  /** What a row says after its name, quieter: the folder where the name alone would
   *  not do, a page's address, the pane a setting is in, the note a heading is in. */
  function whereOf(row: Row): string | null {
    switch (row.kind) {
      case 'note':
      case 'tab': {
        // Where two share the name, or where it was the folder that matched rather
        // than anything on the row.
        const byName = pieces(label(row), term).some((one) => one.hit)
        return row.folder && (row.shared || (term && !byName)) ? row.folder : null
      }
      case 'bookmark':
        return row.note
      case 'page':
        return row.title === row.address ? null : row.address
      case 'setting':
        return row.setting.where
      case 'make':
        return row.make.folder || null
      case 'command':
      case 'place':
      case 'address':
        return null
    }
  }

  /** The key a command is on, or the line a place is. */
  function hintOf(row: Row): string | null {
    if (row.kind === 'command') return row.command.hint ?? null
    return row.kind === 'place' ? row.hint : null
  }

  const dimmed = (row: Row) => row.kind === 'command' && row.command.disabled === true

  /** The tab behind a tab row, for the mark the strip gives it. */
  const tabOf = (row: Extract<Row, { kind: 'tab' }>) =>
    workspace.tabs.find((one) => one.id === row.tab.id)

  /** Reads a value for its own sake, so the effect around it follows that
   *  value. Nothing wants the value itself. */
  const follows = (_value: unknown) => undefined

  // A fresh set of results starts at the top: the row the cursor pointed at is
  // no longer the one under it. Not when a switch was flipped where it stands,
  // which changes no row.
  $effect(() => {
    follows(term)
    follows(mode)
    cursor = 0
  })

  $effect(() => {
    if (open) input?.focus()
  })

  let list = $state<HTMLElement>()

  // The row the arrows are on stays in view, or walking past the tenth result
  // moves a cursor nobody can see. Nearest, so a row already showing does not pull
  // the list around under the eye.
  $effect(() => {
    follows(cursor)
    list?.querySelector('.nib-row.is-on')?.scrollIntoView({ block: 'nearest' })
  })

  /** What the app wore before a theme, a mode or an accent was tried on from here,
   *  while one is. See palette/trying.ts. */
  let kept: Look | null = null

  /** Puts on the look the row under the arrows is, or takes one off again. */
  function wear(row: Row | undefined) {
    const was = kept ?? { id: theme.id, scheme: theme.scheme, accent: theme.accent }
    const look = lookOf(row, was)
    if (look) {
      kept = was
      theme.preview(look.id, look.scheme, look.accent)
    } else if (kept) {
      theme.preview(kept.id, kept.scheme, kept.accent)
      kept = null
    }
  }

  // The row the arrows are on, tried on while they are on it, and taken off as they
  // leave it or the palette closes.
  $effect(() => {
    const row = open ? results[cursor] : undefined
    untrack(() => wear(row))
  })

  /** The rows the middle button opens in a tab of their own: the ones that go to a
   *  file or a page. */
  const opensTab = (row: Row) =>
    row.kind === 'note' ||
    row.kind === 'tab' ||
    row.kind === 'page' ||
    row.kind === 'address' ||
    (row.kind === 'bookmark' && (row.mark.kind === 'heading' || row.mark.kind === 'block'))

  /** What there is to act with; see palette/choose.ts. */
  const hands: Hands = {
    openEntry: (path, how) => void workspace.openEntry(path, how),
    openAside: (path) => void workspace.openAside(path),
    openPage: (url, ask) => workspace.openPage(url, ask),
    activate: (tab) => workspace.activate(tab),
    openAtHeading: (path, heading, how) => void workspace.openAtHeading(path, heading, how),
    openAtBlock: (target, how) => void workspace.openAtBlock(target, how),
    revealFolder: (path) => workspace.revealFolder(path),
    searchFor: (words) => {
      workspace.showPanel('search')
      search.ask(words)
    },
    openGraph: (view) => {
      // The space keeps one picture and a view is a way of looking at it; see
      // workspace/graph-settings.svelte.ts.
      workspace.graphSettings.take(view)
      workspace.openGraph()
    },
    showSetting: (section, label) => {
      settings.show(section)
      landing.label = label
    },
    // Written and opened in the folder it names under the space, made along with
    // the note where it is not there yet.
    make: (note) => {
      if (root)
        void workspace.createNote(note.folder ? joinPath(root, note.folder) : root, note.name)
    },
    goto: (line) => ongoto?.(line),
  }

  function pick(row: Row, press?: KeyboardEvent | MouseEvent) {
    // A look tried on and chosen is kept by its own command, not taken off again.
    if (lookOf(row, theme)) kept = null
    const chosen = choose(row, press, hands)
    if (chosen === 'nothing') return

    // A note counts itself as it opens, from anywhere, so it is not counted twice
    // here; see `remember` in workspace/device.svelte.ts.
    const key = row.kind === 'note' ? null : rowKey(row)
    if (key) frecency.use(key)
    if (chosen === 'close') dismiss()
  }

  /** Takes a row out of what the palette remembers: a page out of the history and a
   *  note off the list of recent ones, which is Chrome's Shift+Delete and VS Code's
   *  "remove from recently opened", and anything's count of uses. */
  function forget(row: Row) {
    const key = rowKey(row)
    if (!key) return

    frecency.forget(key)
    if (row.kind === 'note') workspace.device.unremember(row.entry.path)
    if (row.kind === 'tab' && row.tab.path) workspace.device.unremember(row.tab.path)
    if (!__EVEN_PLUGIN__ && row.kind === 'page') {
      visited.remove(webData.history(workspace.activeSpaceId), row.url)
    }
    forgotten++
  }

  /** Opens it narrowed to the commands, and says so the way a reader would: the `>`
   *  goes in front of whatever is in the field - once, so a second press is only ever
   *  the mode - with the caret after everything, which is the field somebody who
   *  typed the `>` themselves would be looking at. Deleting it is the way back to
   *  everything, so there is nothing new to learn.
   *
   *  The text in the box is what the mode is made of, so this writes the box rather
   *  than raising a flag beside it: two answers to what the palette is showing is how
   *  one ends up listing commands with nothing typed. The app calls it for the key;
   *  see `app.commands` in the shortcut registry. */
  export async function showCommands() {
    if (!query.startsWith('>')) query = `>${query}`
    open = true

    // The field is not in the page until the opening pass has run, and a caret cannot
    // be put at the end of a value the input has not been handed yet.
    await tick()
    input?.focus()
    input?.setSelectionRange(query.length, query.length)
  }

  /** Closed, and forgotten: the next opening starts on an empty field rather
   *  than on whatever was typed last time. */
  function dismiss() {
    open = false
    query = ''
  }

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (open ? overlays.show(dismiss) : undefined))

  /** A keystroke this list has answered goes no further. The app reads its own
   *  keys off the window, and Ctrl+N there is New note: without this, stepping
   *  down the list with Ctrl+N opens a blank note behind the palette. */
  function spend(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor + 1) % Math.max(results.length, 1)
      return
    }

    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor - 1 + results.length) % Math.max(results.length, 1)
      return
    }

    // The two ends of a long list, without holding an arrow down. Only with a
    // modifier: Home and End on their own belong to the words in the box.
    if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
      spend(event)
      cursor = event.key === 'Home' ? 0 : Math.max(results.length - 1, 0)
      return
    }

    // Chrome's key for taking a row out of what it remembers.
    if (event.key === 'Delete' && event.shiftKey) {
      const chosen = results[cursor]
      if (chosen) {
        spend(event)
        forget(chosen)
      }
      return
    }

    if (event.key !== 'Enter') return

    // Obsidian's key for a new note whatever else the name answers to: a note
    // called `Plan` beside `Planning` is otherwise out of reach from here.
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && makes) {
      spend(event)
      pick({ kind: 'make', make: makes })
      return
    }

    const chosen = results[cursor]
    if (chosen) {
      spend(event)
      pick(chosen, event)
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <!-- Tapping away is the same answer as Escape, so it forgets the same. -->
  <div class="nib-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={dismiss}></div>

  <div
    class="nib-screen palette"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Search notes and commands')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <!-- A box with a list under it is one control and not two: the keyboard never
         leaves the box, and the arrows move which row the box is pointing at. That
         is what a combobox is, and why the rows are out of the tab sequence - forty
         notes would otherwise be forty presses of Tab between here and the note
         behind. See docs/keyboard.md. -->
    <!-- On a touch screen with a word beside the box that puts it away, as a
         phone's search has: there is no Escape there, and a list long enough to
         reach the keys leaves no dim edge to tap. -->
    <div class="field nib-field">
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onKeydown}
        placeholder={t('Search')}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="nib-palette-list"
        aria-activedescendant={results.length ? `nib-palette-${cursor}` : undefined}
        aria-label={t('Search notes and commands')}
      />
      {#if viewport.touch}
        <button type="button" class="give" onclick={dismiss}>{t('Cancel')}</button>
      {/if}
    </div>

    {#if results.length}
      <ul
        bind:this={list}
        id="nib-palette-list"
        role="listbox"
        aria-label={t('Search notes and commands')}
      >
        {#each results as row, index (`${row.kind}:${label(row)}:${index}`)}
          {@const where = whereOf(row)}
          {@const hint = hintOf(row)}
          <li role="none">
            <!-- A command that cannot be run right now is faded, and says it is out
                 of anybody's hands rather than only being drawn that way: to
                 anything reading the list it was an ordinary row in a grey nobody
                 could read, and eight of the serious things axe-core found in this
                 app were exactly that. Not `disabled`, which would take the row out
                 of the list the arrows walk: the row is still there to be read, it
                 simply does nothing. -->
            <button
              class="nib-row"
              id="nib-palette-{index}"
              role="option"
              tabindex="-1"
              aria-selected={index === cursor}
              aria-disabled={dimmed(row) ? 'true' : undefined}
              class:is-on={index === cursor}
              class:dim={dimmed(row)}
              style:--depth={row.kind === 'place' ? row.depth : 0}
              onmouseenter={() => (cursor = index)}
              onclick={(event) => pick(row, event)}
              use:middleOpens={(event) => opensTab(row) && pick(row, event)}
            >
              <!-- Every row keeps the one box every list in the app keeps for a mark,
                   so every name starts at the same place, and what is in the box says
                   what the row is: the mark a file wears in the file list, the one a
                   tab wears in the strip, a chevron for a command - the `>` the field
                   narrows to them with - or the tick of one that is on, the drawing a
                   pane wears in the settings, a globe for the web. See FileMark. -->
              {#if row.kind === 'command'}
                {#if row.command.checked}
                  <span class="mark tick">✓</span>
                {:else}
                  <span class="mark quiet"><Icon icon={null} fallback={ChevronRight} /></span>
                {/if}
              {:else if row.kind === 'note'}
                <FileMark mark={fileMark(row.entry.name)} path={row.entry.path} />
              {:else if row.kind === 'tab'}
                {@const tab = tabOf(row)}
                {#if tab}<TabMark {tab} />{:else}<span class="mark"></span>{/if}
              {:else if row.kind === 'bookmark'}
                {#if row.file}
                  <FileMark mark={row.file} path={row.path ?? undefined} />
                {:else}
                  <svg class="mark drawn" viewBox="0 0 13 13"
                    ><path d={row.mark.kind === 'graph' ? GRAPH_MARK : SEARCH_MARK} /></svg
                  >
                {/if}
              {:else if row.kind === 'page' || row.kind === 'address'}
                <FileMark mark="web" />
              {:else if row.kind === 'setting'}
                <svg class="mark drawn" viewBox="0 0 16 16"
                  ><path d={ICONS[row.setting.section]} /></svg
                >
              {:else if row.kind === 'place'}
                <svg class="mark drawn" viewBox="0 0 13 13"><path d={OUTLINE_MARK} /></svg>
              {:else if row.kind === 'make'}
                <span class="mark quiet"><Icon icon={null} fallback={FilePlus} /></span>
              {/if}
              <span class="nib-row-label"
                >{#each pieces(label(row), mode === 'everything' || mode === 'commands' || mode === 'headings' ? term : '') as piece, at (at)}{#if piece.hit}<b
                      >{piece.text}</b
                    >{:else}{piece.text}{/if}{/each}</span
              >
              {#if where}<span class="where">{where}</span>{/if}
              {#if row.kind === 'setting' && row.setting.field?.kind === 'switch'}
                <span class="flip" aria-hidden="true"
                  ><span class="nib-switch" class:on={row.setting.field.get()}></span></span
                >
              {:else if row.kind === 'setting' && settingValue(row.setting.field)}
                <span class="value">{settingValue(row.setting.field)}</span>
              {:else if hint}
                <kbd>{hint}</kbd>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      <!-- Typed into and nothing answered. The same words the find sheet says,
           since it is the same question; see PromptSheet.svelte. A `#` on a note
           with no headings says what the outline says about it. -->
    {:else if mode === 'headings' && !headings.length}
      <p class="nothing">{t('No headings in this note')}</p>
    {:else if term}
      <p class="nothing">{t('Nothing found')}</p>
    {/if}
  </div>
{/if}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: var(--z-screen);
  }

  /* The shape is `.nib-screen` in the themes package - the surface, the corner,
     the hairline and the shadow anything that replaces part of the screen wears,
     and the centring the four of them had a copy of each. What is its own is how
     wide and how far down: a list of commands starts higher than a question
     does, because it is a list and needs the room under it. */
  .palette {
    --screen-width: 36rem;

    top: 16vh;
    z-index: var(--z-screen);
    overflow: hidden;
  }

  /* The hairline under the box is the box's border, so the one answer a box with
     a caret in it gives - the border turns to the accent - is already the right
     one here and is drawn in the themes package. It used to take the ring off and
     put nothing in its place. The box is the row around the words, which wears
     `.nib-field` for the word a touch screen puts beside them, and keeps the one
     line it always had rather than that class's frame. */
  .field {
    min-height: 0;
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .field input {
    padding: var(--space-4);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
  }

  .give {
    flex: none;
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--touch-text);
  }

  input::placeholder {
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    max-height: 46vh;
    overflow-y: auto;
  }

  /* The rows are `.nib-row`, the same row the file list is made of - the one the
     arrow keys walk carries the same fill an open note does. */
  button.dim {
    opacity: 0.45;
  }

  /* The box FileMark draws every file's mark in, for the marks that are not a
     file's: the same size and the same hairline, so a list of every kind at once
     reads as one list. See FileMark.svelte. */
  .mark {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .quiet {
    opacity: 0.8;
  }

  /* The panel's and the settings' own drawings, on their own grids, at the weight
     the file marks are drawn at. */
  svg.drawn {
    stroke-width: 1.2;
    opacity: 0.8;
  }

  /* The tick the menu rows carry, in the mark's box. A whole em wide: U+2713 is
     drawn by whatever font has it, and on a page whose lang is Japanese that is a
     CJK face, where every glyph is full width. Nine tenths of an em cut two pixels
     off the tick's right arm, which is what scripts/locale-e2e.py reported under
     `ja`. */
  .tick {
    min-width: 1em;
    color: var(--accent);
    stroke: none;
  }

  /* A heading sits under the one it belongs to, as it does in the outline. */
  .nib-row-label {
    padding-inline-start: calc(var(--depth) * var(--space-3));
  }

  /* The letters the words were found at, drawn stronger: what the eye checks a row
     against. */
  .nib-row-label b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* Quieter than the name, and the first thing to give way: a long path loses its
     end before the name loses any of it. */
  .where,
  .value {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* What a setting is set to sits where a command's key does, at the far end. */
  .value {
    margin-inline-start: auto;
  }

  /* The settings' own switch, drawn by the themes package, a size down to sit in a
     row and at the far end of it. */
  .flip {
    display: flex;
    flex: none;
    margin-inline-start: auto;
    scale: 0.8;
  }

  .nothing {
    margin: 0;
    padding: var(--space-4);
    color: var(--muted);
    font-size: var(--text-row);
  }

  kbd {
    flex: none;
    margin-inline-start: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  /* No taller than what the keys leave, the rows giving up the rest: the list ran on
     under the keyboard, and the last commands in it could not be scrolled to. */
  :global([data-touch]) .palette {
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: calc(100dvh - var(--keyboard));
    display: flex;
    flex-direction: column;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    padding-top: var(--inset-top);
  }

  /* The rows are a list like any other and take the row scale with every other
     list; the field over them is the one thing here that does not. */
  :global([data-touch]) .field input {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  /* Room for more of them, now that each is taller, and the last one clears the
     gesture bar. */
  :global([data-touch]) ul {
    min-height: 0;
    max-height: 60dvh;
    padding-bottom: var(--touch-bottom);
  }
</style>
