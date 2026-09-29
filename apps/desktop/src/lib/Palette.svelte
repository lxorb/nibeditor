<script lang="ts">
  import { tick } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import FilePlus from 'lucide/dist/esm/icons/file-plus.mjs'
  import { appCommands, type Command } from './commands'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import Icon from './Icon.svelte'
  import { rank, recentFirst } from './fuzzy'
  import { howFor, middleOpens, tabAsk } from './new-tab'
  import { shownName } from './note-name'
  import { scanHeadings } from './outline'
  import { overlays } from './overlays'
  import { lineAsked, modeOf } from './palette/mode'
  import { type NoteToMake, noteToMake } from './palette/new-note'
  import { type NoteRow, noteRows } from './palette/notes'
  import { useCommand, usedCommands } from './palette/used'
  import { joinPath } from './tauri'
  import { trap } from './trap'
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

  /** One row of the list, whichever list it is. A place is a heading or a line of
   *  the note in front: both are a line to go to and a word or two to say which. */
  type Row =
    | { kind: 'command'; command: Command }
    | { kind: 'note'; note: NoteRow }
    | { kind: 'make'; make: NoteToMake }
    | { kind: 'place'; line: number; text: string; depth: number; hint: string | null }

  /** Every command there is, built while the palette is open and not once per
   *  keystroke: the list asks what the document goes out as, and answering that
   *  walks every line of it. What a row says still follows the app - the labels
   *  read the stores, so this rebuilds when one of them changes - but typing
   *  changes none of them. The ones run lately go first; see palette/used.ts. */
  const commands = $derived(
    open ? recentFirst(appCommands(view), usedCommands(), (command) => command.id) : [],
  )

  /** The note a `#` or a `:` is about: the one in front, and only a note - a canvas
   *  and a paper have no lines to go to. */
  const writing = $derived(workspace.active?.kind === 'note' ? view : undefined)

  /** Its headings, read when the `#` is typed rather than on every opening. */
  const headings = $derived(
    open && mode === 'headings' && writing ? scanHeadings(writing.state.doc.toString()) : [],
  )

  const root = $derived(workspace.activeSpace?.root ?? null)

  /** The note Shift+Enter would make out of what was typed, whatever else answers. */
  const makeable = $derived(mode === 'notes' && root ? noteToMake(term) : null)

  const results = $derived.by((): Row[] => {
    if (mode === 'commands') {
      return rank(term, commands, (command) => command.label).map((command) => ({
        kind: 'command',
        command,
      }))
    }

    if (mode === 'headings') {
      const top = Math.min(...headings.map((one) => one.level))
      return rank(term, headings, (one) => one.text).map((one) => ({
        kind: 'place',
        line: one.line,
        text: one.text,
        depth: one.level - top,
        hint: null,
      }))
    }

    if (mode === 'line') {
      const line = writing ? lineAsked(term, writing.state.doc.lines) : null
      if (line === null || !writing) return []
      const text = writing.state.doc.line(line + 1).text.trim()
      return [{ kind: 'place', line, text, depth: 0, hint: String(line + 1) }]
    }

    // The note in front is not among the ones opened lately: with nothing typed,
    // Enter is the note before it, the way Alt+Tab is the window before this one.
    const recent = workspace.recent.filter((path) => path !== workspace.active?.path)
    const notes = noteRows(term, workspace.files, recent, root ?? '')
    if (notes.length || !makeable) return notes.map((note) => ({ kind: 'note', note }))

    return [{ kind: 'make', make: makeable }]
  })

  function label(row: Row): string {
    if (row.kind === 'command') return row.command.label
    if (row.kind === 'note') return shownName(row.note.entry.name)
    if (row.kind === 'make') return shownName(row.make.name)
    return row.text
  }

  /** The folder a row says it is in, where it says one. */
  function folderOf(row: Row): string | null {
    if (row.kind === 'note') return row.note.folder
    return row.kind === 'make' && row.make.folder ? row.make.folder : null
  }

  function hintOf(row: Row): string | null {
    if (row.kind === 'command') return row.command.hint ?? null
    return row.kind === 'place' ? row.hint : null
  }

  const dimmed = (row: Row) => row.kind === 'command' && row.command.disabled === true

  /** Reads a value for its own sake, so the effect around it follows that
   *  value. Nothing wants the value itself. */
  const follows = (_value: unknown) => undefined

  // A fresh set of results starts at the top: the row the cursor pointed at is
  // no longer the one under it.
  $effect(() => {
    follows(results)
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
    list?.querySelector('.nib-row.is-on')?.scrollIntoView({ block: 'nearest' })
  })

  /** Ctrl+Alt with Enter or with a click: in a pane to the right, which is
   *  Obsidian's chord for it; see `openAside`. */
  const asksAside = (press: KeyboardEvent | MouseEvent) =>
    press.altKey && (press.ctrlKey || press.metaKey)

  function choose(row: Row, press?: KeyboardEvent | MouseEvent) {
    if (row.kind === 'command') {
      if (row.command.disabled) return
      useCommand(row.command.id)
      row.command.run()
    } else if (row.kind === 'note') {
      const path = row.note.entry.path
      // Ctrl+Enter, a Ctrl+click or the middle button: a tab of its own, behind the
      // one in front or, with Shift, in front of it, the way a link opens; see new-tab.ts.
      if (press && asksAside(press)) void workspace.openAside(path)
      else void workspace.openEntry(path, press ? howFor(tabAsk(press)) : {})
    } else if (row.kind === 'make') make(row.make)
    else ongoto?.(row.line)

    open = false
    query = ''
  }

  /** Writes the note and opens it, in the folder it names under the space - made
   *  along with the note where it is not there yet. */
  function make(note: NoteToMake) {
    if (!root) return
    void workspace.createNote(note.folder ? joinPath(root, note.folder) : root, note.name)
  }

  /** Opens it on the commands, and says so the way a reader would: the `>` goes in
   *  front of whatever is in the field - once, so a second press is only ever the
   *  mode - with the caret after everything, which is the field somebody who typed
   *  the `>` themselves would be looking at. Deleting it is still the way back to the
   *  notes, so there is nothing new to learn.
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

    if (event.key !== 'Enter') return

    // Obsidian's key for a new note whatever else the name answers to: a note
    // called `Plan` beside `Planning` is otherwise out of reach from here.
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && makeable) {
      spend(event)
      choose({ kind: 'make', make: makeable })
      return
    }

    const chosen = results[cursor]
    if (chosen) {
      spend(event)
      choose(chosen, event)
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
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKeydown}
      placeholder={t('Go to note, or > for commands')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
      role="combobox"
      aria-expanded={results.length > 0}
      aria-controls="nib-palette-list"
      aria-activedescendant={results.length ? `nib-palette-${cursor}` : undefined}
      aria-label={t('Search notes and commands')}
    />

    {#if results.length}
      <ul
        bind:this={list}
        id="nib-palette-list"
        role="listbox"
        aria-label={t('Search notes and commands')}
      >
        {#each results as row, index (`${label(row)}:${index}`)}
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
              onclick={(event) => choose(row, event)}
              use:middleOpens={(event) => row.kind === 'note' && choose(row, event)}
            >
              <!-- The same tick the menu rows carry, in a slot every command row
                   keeps whether or not there is one in it, so the words line up.
                   See AppMenu.svelte. -->
              {#if row.kind === 'command'}
                <span class="tick">{row.command.checked ? '✓' : ''}</span>
                <!-- A note wears the mark it wears everywhere else, in the box
                     every list keeps for it: the name of a note in the palette used
                     to start eight pixels in where the same name in the file list
                     starts thirty-two, so going from one list to the other moved
                     every word on screen. Read off the name, like every other list
                     that shows a file and knows little else; see file-mark.ts. -->
              {:else if row.kind === 'note'}
                <FileMark mark={fileMark(row.note.entry.name)} path={row.note.entry.path} />
                <!-- The note that is not there yet wears the page with a plus on it,
                     in the same box, so the name it will have starts where every
                     other note's does. -->
              {:else if row.kind === 'make'}
                <span class="make"><Icon icon={null} fallback={FilePlus} /></span>
              {/if}
              <span class="nib-row-label">{label(row)}</span>
              {#if folderOf(row)}<span class="folder">{folderOf(row)}</span>{/if}
              {#if hintOf(row)}<kbd>{hintOf(row)}</kbd>{/if}
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
    --scrim-z: 20;
  }

  /* The shape is `.nib-screen` in the themes package - the surface, the corner,
     the hairline and the shadow anything that replaces part of the screen wears,
     and the centring the four of them had a copy of each. What is its own is how
     wide and how far down: a list of commands starts higher than a question
     does, because it is a list and needs the room under it. */
  .palette {
    --screen-width: 34rem;

    top: 16vh;
    z-index: 21;
    overflow: hidden;
  }

  /* The hairline under the box is the box's border, so the one answer a box with
     a caret in it gives - the border turns to the accent - is already the right
     one here and is drawn in the themes package. It used to take the ring off and
     put nothing in its place. */
  input {
    width: 100%;
    padding: var(--space-4);
    border: none;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition: border-color var(--dur-fast) var(--ease-out);
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

  /* The width is held whether or not there is a tick in it, so the labels line
     up down the list. The same shape the menu rows use.

     A whole em, not 0.9 of one: U+2713 is drawn by whatever font has it, and on a
     page whose lang is Japanese that is a CJK face, where every glyph is full
     width. Nine tenths of an em cut two pixels off the tick's right arm, which is
     what scripts/locale-e2e.py reported under `ja`. */
  .tick {
    width: 1em;
    flex: none;
    color: var(--accent);
  }

  kbd {
    flex: none;
  }

  /* A heading sits under the one it belongs to, as it does in the outline. */
  .nib-row-label {
    padding-inline-start: calc(var(--depth) * var(--space-3));
  }

  /* Quieter than the name, and the first thing to give way: a long path loses its
     end before the name loses any of it. */
  .folder {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The box FileMark draws every other note's mark in; see FileMark.svelte. */
  .make {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
    opacity: 0.8;
  }

  .nothing {
    margin: 0;
    padding: var(--space-4);
    color: var(--muted);
    font-size: var(--text-row);
  }

  kbd {
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
  :global([data-touch]) input {
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
