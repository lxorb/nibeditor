<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appCommands, type Command } from './commands'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { rank } from './fuzzy'
  import { shownName } from './note-name'
  import { overlays } from './overlays'
  import { trap } from './trap'
  import { workspace, type Entry } from './workspace.svelte'
  import { LAYER } from './motion'

  // eslint-disable-next-line prefer-const -- `open` is bindable, and a $props() pattern cannot be split
  let { open = $bindable(false), view }: { open?: boolean; view?: EditorView | undefined } =
    $props()

  let query = $state('')
  let cursor = $state(0)
  let input = $state<HTMLInputElement>()

  const asCommands = $derived(query.startsWith('>'))
  const term = $derived(asCommands ? query.slice(1).trim() : query.trim())

  /** Every command there is, built while the palette is open and not once per
   *  keystroke: the list asks what the document goes out as, and answering that
   *  walks every line of it. What a row says still follows the app - the labels
   *  read the stores, so this rebuilds when one of them changes - but typing
   *  changes none of them. */
  const commands = $derived(open ? appCommands(view) : [])

  /** The notes the switcher offers. Every file of the space except the ones it is not
   *  showing: an archived note is reachable by its own name from a link, from a
   *  bookmark and from the archive, and the switcher is the space listing itself. */
  const openable = $derived(workspace.files.filter((one) => !workspace.leftOut.has(one.path)))

  const results = $derived.by((): (Command | Entry)[] => {
    if (asCommands) return rank(term, commands, (command) => command.label)
    return rank(term, openable, (one) => shownName(one.name)).slice(0, 40)
  })

  const label = (item: Command | Entry) => ('label' in item ? item.label : shownName(item.name))

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

  function choose(item: Command | Entry) {
    if ('run' in item) {
      if (item.disabled) return
      item.run()
    } else void workspace.openEntry(item.path)

    open = false
    query = ''
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

    const chosen = results[cursor]
    if (event.key === 'Enter' && chosen) {
      spend(event)
      choose(chosen)
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
        {#each results as item, index (`${label(item)}:${index}`)}
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
              aria-disabled={'disabled' in item && item.disabled ? 'true' : undefined}
              class:is-on={index === cursor}
              class:dim={'disabled' in item && item.disabled}
              onmouseenter={() => (cursor = index)}
              onclick={() => choose(item)}
            >
              <!-- The same tick the menu rows carry, in a slot every command row
                   keeps whether or not there is one in it, so the words line up.
                   See AppMenu.svelte. -->
              {#if asCommands}
                <span class="tick">{'checked' in item && item.checked ? '✓' : ''}</span>
                <!-- A note wears the mark it wears everywhere else, in the box
                     every list keeps for it: the name of a note in the palette used
                     to start eight pixels in where the same name in the file list
                     starts thirty-two, so going from one list to the other moved
                     every word on screen. Read off the name, like every other list
                     that shows a file and knows little else; see file-mark.ts. -->
              {:else if 'path' in item}
                <FileMark mark={fileMark(item.name)} path={item.path} />
              {/if}
              <span class="nib-row-label">{label(item)}</span>
              {#if 'hint' in item && item.hint}<kbd>{item.hint}</kbd>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <!-- Typed into and nothing answered. The same words the find sheet says,
           since it is the same question; see PromptSheet.svelte. -->
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

  :global([data-touch]) .palette {
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
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
    max-height: 60dvh;
    padding-bottom: var(--touch-bottom);
  }
</style>
