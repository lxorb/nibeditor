<script lang="ts">
  /** A note's front matter as rows on the right side, and edited in them: Obsidian's
   *  File properties view.
   *
   *  Front matter starts hidden in the note, because the metadata at the top of a file
   *  is what the app reads rather than what a reader reads on the way in. Hidden is not
   *  gone: somebody who files notes by status, date and tag still has to see and change
   *  those, and the choice used to be the whole block back on the page or the YAML. So
   *  the rows are here, beside the note, one press away and out of the words.
   *
   *  Every control writes through property-edits.ts in @nib/markdown, whose answer is
   *  one edit of the characters that change and nothing else in the file. It goes into
   *  the note's own document, so it is the note's undo step and every pane showing the
   *  note has it at once; see `edit` in @nib/editor's shared.ts.
   *
   *  Follows the panel's note - the note in front, or the one the panel is held on -
   *  and reads `tab.doc`, which catches up when the typing pauses, as the outline does:
   *  nothing here runs per keystroke. Fetched the first time the panel is shown; see
   *  surfaces.svelte.ts. */
  import { documentOf, insertFrontMatter } from '@nib/editor'
  import type { TextEdit } from '@nib/markdown/edits'
  import { frontMatterBlock } from '@nib/markdown/front-matter'
  import { type Property, readProperties } from '@nib/markdown/properties'
  import {
    removeProperty,
    renameProperty,
    withItem,
    withoutItem,
    writeList,
    writeProperty,
  } from '@nib/markdown/property-edits'
  import { tick } from 'svelte'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { menu, type MenuEntry } from './menu.svelte'
  import { modes } from './modes.svelte'
  import { PROPERTY_CHOICES } from './property-choices'
  import { canWriteIn } from './sharing.svelte'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const {
    onsearch,
  }: {
    /** Asks the space about a tag, which is what pressing one means everywhere else. */
    onsearch?: ((text: string) => void) | undefined
  } = $props()

  /** The note the panel is about, while it is a note. */
  const tab = $derived(workspace.panelTab?.kind === 'note' ? workspace.panelTab : null)
  const doc = $derived(tab?.doc ?? null)
  const block = $derived(doc === null ? null : frontMatterBlock(doc))
  /** The rows, or null for a note with no block or one nib cannot read without
   *  guessing; `block` tells those two apart. */
  const rows = $derived(doc === null ? null : readProperties(doc))
  const writable = $derived(!!tab && !modes.readOnly && canWriteIn(tab.note))

  /** Which key is being renamed, and whether a new key is being named. */
  let renaming = $state<string | null>(null)
  let adding = $state(false)
  let list = $state<HTMLElement>()

  /** Puts one edit into the note, and the panel's own words forward at once rather
   *  than at the next pause, so the row answers the press that changed it. */
  function apply(edit: TextEdit | null): boolean {
    const note = tab?.note
    if (!edit || !note || !writable) return false

    note.live.edit([edit], { userEvent: 'input.property' })
    note.flush()
    return true
  }

  /** The words the edit is worked out against: the document as it stands, which may
   *  be a pause ahead of `doc`. */
  function source(): string {
    return tab?.note.latest ?? ''
  }

  function write(property: Property, value: string | null) {
    apply(writeProperty(source(), property.key, value, property.kind))
  }

  function writeItems(key: string, items: string[] | null) {
    if (items) apply(writeList(source(), key, items))
  }

  /** A list's field: Enter or leaving it adds what was typed. */
  function addItem(property: Property, field: HTMLInputElement) {
    const said = field.value
    field.value = ''
    writeItems(property.key, withItem(property, said))
  }

  /** A field commits on Enter as well as on leaving it. */
  function commitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
  }

  /** The value a date field holds, as the file writes it. */
  function dated(field: HTMLInputElement): string {
    return field.type === 'datetime-local' ? field.value.replace('T', ' ') : field.value
  }

  /** What a scalar row is edited in. */
  function fieldType(property: Property): string {
    if (property.kind === 'number') return 'number'
    if (property.kind !== 'date') return 'text'
    return property.value.length > 10 ? 'datetime-local' : 'date'
  }

  async function startRenaming(key: string) {
    if (!writable) return
    renaming = key
    await tick()
    list?.querySelector<HTMLInputElement>('.rename')?.select()
  }

  function finishRenaming(key: string, field: HTMLInputElement) {
    if (renaming !== key) return
    renaming = null
    apply(renameProperty(source(), key, field.value))
  }

  /** A new key, written with nothing after it, and the keyboard put in its value. */
  async function finishAdding(field: HTMLInputElement) {
    if (!adding) return
    adding = false
    const name = field.value.trim()
    if (!name || !apply(writeProperty(source(), name, ''))) return

    await tick()
    list
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(name)}"] .value :is(input, select)`)
      ?.focus()
  }

  function cancelOnEscape(event: KeyboardEvent, cancel: () => void) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  function rowMenu(property: Property): MenuEntry[] {
    if (!writable) return []

    return [
      { label: t('Rename'), run: () => void startRenaming(property.key) },
      { label: t('Remove'), run: () => apply(removeProperty(source(), property.key)) },
    ]
  }

  function showMenu(event: MouseEvent, property: Property) {
    const items = rowMenu(property)
    if (!items.length) return
    event.preventDefault()
    menu.show(event, items, { title: property.key })
  }

  /** The block as it is written, in the note, with the caret in it: shown there for as
   *  long as the caret stays, whatever the setting says; see `insertFrontMatter`. */
  function editSource() {
    const open = tab
    if (!open) return
    if (open.id !== workspace.activeTabId) workspace.activate(open.id)

    const view = views.of(open.paneId)
    if (!view || documentOf(view) !== open.note.live) return
    insertFrontMatter(view)
    view.focus()
  }

  /** A tag list's chips ask the space about their tag, as a tag does everywhere. */
  const tagged = (key: string) => /^tags?$/i.test(key)
</script>

{#if !tab}
  <p class="empty-text">{t('No note is open')}</p>
{:else}
  <p class="nib-section">{t('Properties')}<span>{rows?.length ?? 0}</span></p>

  {#if block && rows === null}
    <!-- A block nib cannot read without guessing: a comment, a nested shape. Shown as
         it is written, and edited where it is written. -->
    <button class="yaml" onclick={editSource}
      >{doc?.slice(block.body.from, block.body.to).trimEnd()}</button
    >
  {:else}
    <div class="props" bind:this={list}>
      {#each rows ?? [] as property (property.key)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="prop"
          data-key={property.key}
          oncontextmenu={(event) => showMenu(event, property)}
          use:longPress={(event) => showMenu(event, property)}
        >
          {#if renaming === property.key}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="key rename"
              value={property.key}
              aria-label={t('Rename')}
              autofocus
              onkeydown={(event) => {
                commitOnEnter(event)
                cancelOnEscape(event, () => (renaming = null))
              }}
              onblur={(event) => finishRenaming(property.key, event.currentTarget)}
            />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="key"
              title={property.key}
              ondblclick={() => void startRenaming(property.key)}>{property.key}</span
            >
          {/if}

          <span class="value">
            {#if property.kind === 'list' || property.kind === 'map'}
              {#each property.items as item (item)}
                <span class="chip">
                  {#if tagged(property.key)}
                    <button class="chip-word" onclick={() => onsearch?.(`tag:${item}`)}
                      >{item}</button
                    >
                  {:else}
                    {item}
                  {/if}
                  {#if writable && property.kind === 'list'}
                    <button
                      class="chip-off"
                      title={t('Remove')}
                      aria-label={t('Remove')}
                      onclick={() => writeItems(property.key, withoutItem(property, item))}
                      >×</button
                    >
                  {/if}
                </span>
              {/each}
              {#if writable && property.kind === 'list'}
                <input
                  class="field add"
                  placeholder={t('Add')}
                  aria-label={t('Add')}
                  onkeydown={(event) => {
                    if (event.key !== 'Enter' || event.isComposing) return
                    event.preventDefault()
                    addItem(property, event.currentTarget)
                  }}
                  onblur={(event) => addItem(property, event.currentTarget)}
                />
              {/if}
            {:else if property.kind === 'checkbox'}
              <input
                type="checkbox"
                class="nib-checkbox"
                checked={property.value.toLowerCase() === 'true'}
                disabled={!writable}
                aria-label={property.key}
                onchange={(event) =>
                  write(property, event.currentTarget.checked ? 'true' : 'false')}
              />
            {:else if PROPERTY_CHOICES[property.key] && writable}
              {@const choices = PROPERTY_CHOICES[property.key] ?? []}
              <select
                class="field"
                aria-label={property.key}
                value={property.value}
                onchange={(event) => write(property, event.currentTarget.value || null)}
              >
                {#each choices.includes(property.value) || !property.value ? choices : [property.value, ...choices] as one (one)}
                  <option value={one}>{one}</option>
                {/each}
              </select>
            {:else}
              <input
                class="field"
                type={fieldType(property)}
                value={fieldType(property) === 'datetime-local'
                  ? property.value.replace(' ', 'T')
                  : property.value}
                readonly={!writable}
                aria-label={property.key}
                onkeydown={commitOnEnter}
                onchange={(event) => write(property, dated(event.currentTarget) || null)}
              />
            {/if}
          </span>
        </div>
      {/each}

      {#if adding}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="field new"
          aria-label={t('Add a property')}
          autofocus
          onkeydown={(event) => {
            commitOnEnter(event)
            cancelOnEscape(event, () => (adding = false))
          }}
          onblur={(event) => void finishAdding(event.currentTarget)}
        />
      {:else if writable}
        <button class="nib-row is-short adder" onclick={() => (adding = true)}>
          <span class="nib-row-label">{t('Add a property')}</span>
        </button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .props {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Key and value on one line, the key a fixed share of it and quiet, as the note's
     own rows draw them; see document.css. A long list wraps under its value. */
  .prop {
    display: grid;
    grid-template-columns: minmax(4.5em, 38%) 1fr;
    align-items: start;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .key {
    padding: 0.35em 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }

  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: var(--row-height);
    color: var(--text);
  }

  /* A field with no box until a pointer or the keyboard arrives, so the rows go on
     reading as metadata rather than as a form: the note's own controls, drawn the
     same way; see editor.css. */
  .field,
  .rename {
    min-width: 0;
    width: 100%;
    padding: 0.2em 0.35em;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .field[type='number'],
  .field[type='date'],
  .field[type='datetime-local'] {
    font-variant-numeric: tabular-nums;
  }

  .rename {
    color: var(--text-strong);
  }

  @media (hover: hover) {
    .field:hover:not([readonly]) {
      border-color: var(--line);
    }
  }

  .field.add {
    flex: 1 1 5em;
    width: auto;
    color: var(--muted);
  }

  .field.new {
    width: auto;
    margin: 2px var(--row-pad) 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .chip-word,
  .chip-off {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
  }

  .chip-off {
    line-height: 1;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .chip-word:hover {
      color: var(--accent);
    }

    .chip:hover .chip-off {
      opacity: 1;
    }
  }

  .chip-off:focus-visible,
  :global([data-touch]) .chip-off {
    opacity: 1;
  }

  .adder {
    margin-top: 2px;
  }

  .adder .nib-row-label {
    color: var(--muted);
  }

  .yaml {
    display: block;
    width: calc(100% - 2 * var(--row-pad));
    margin: 0 var(--row-pad);
    padding: 0;
    border: 0;
    background: none;
    text-align: start;
    cursor: default;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty-text {
    margin: var(--space-1) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  :global([data-touch]) .prop,
  :global([data-touch]) .empty-text {
    font-size: var(--text-base);
  }
</style>
