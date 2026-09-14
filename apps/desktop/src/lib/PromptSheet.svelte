<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import FileMark from './FileMark.svelte'
  import { rank } from './fuzzy'
  import { t } from './i18n.svelte'
  import { prompt } from './prompt.svelte'
  import { selectAll } from './select-all'
  import Select from './Select.svelte'
  import SpaceMark from './SpaceMark.svelte'
  import { LAYER } from './motion'
  import { trap } from './trap'

  // Back answers the question with nothing, the same as tapping away.
  $effect(() => closeOnBack(prompt.open, () => prompt.dismiss()))

  /** How many rows a search through many answers shows at once. Enough to pick
   *  from without the sheet becoming a page. */
  const MOST_SHOWN = 8

  let cursor = $state(0)

  /** The answers that match what has been typed, best first. */
  const matches = $derived(
    prompt.mode === 'find'
      ? rank(prompt.value.trim(), prompt.options, (option) => option.label).slice(0, MOST_SHOWN)
      : [],
  )

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // A fresh set of rows starts at the top: the row the cursor pointed at is no
  // longer the one under it.
  $effect(() => {
    follows(matches)
    cursor = 0
  })

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (prompt.open ? overlays.show(() => prompt.dismiss()) : undefined))

  function onFindKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      cursor = (cursor + 1) % Math.max(matches.length, 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      cursor = (cursor - 1 + matches.length) % Math.max(matches.length, 1)
    }
  }

  function submitFind() {
    const chosen = matches[cursor]
    if (chosen) prompt.pick(chosen.id)
  }
</script>

{#if prompt.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => prompt.dismiss()}
  ></div>

  <!-- The same three the shared sheet says, from the same words it is headed
       with: what it is, that nothing behind it can be reached while it is up, and
       its name. See Sheet.svelte. -->
  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={prompt.title}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault()
        if (prompt.mode === 'find') submitFind()
        else prompt.submit()
      }}
    >
      <p class="title">{prompt.title}</p>

      {#if prompt.mode === 'text'}
        <!-- Selected, so a rename can be typed straight over. -->
        <input
          bind:value={prompt.value}
          placeholder={prompt.placeholder}
          spellcheck="false"
          use:selectAll
        />

        <!-- Where the file goes, for a save: a space, or a note in it - a note that holds
             notes is what nib has instead of folders, so the word is never used; see
             docs/tree.md. Only worth asking when there is more than one answer. -->
        {#if prompt.folders.length > 1}
          <div class="field">
            <span class="label">{t('Where')}</span>
            <Select
              value={prompt.folder ?? ''}
              options={prompt.folders.map((one) => ({ value: one.id, label: one.label }))}
              onchange={(id: string) => {
                prompt.folder = id
              }}
              label={t('Where')}
            />
          </div>
        {/if}

        <!-- Only worth asking when there is more than one answer. -->
        {#if prompt.spaces.length > 1}
          <div class="field">
            <span class="label">{t('Space')}</span>
            <Select
              value={prompt.space ?? ''}
              options={prompt.spaces.map((one) => ({ value: one.id, label: one.name }))}
              onchange={(id: string) => {
                prompt.space = id
              }}
              label={t('Space')}
            />
          </div>
        {/if}
      {:else if prompt.mode === 'find'}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={prompt.value}
          placeholder={prompt.placeholder}
          spellcheck="false"
          onkeydown={onFindKey}
          autofocus
        />

        {#if matches.length}
          <ul class="found">
            {#each matches as option, index (option.id)}
              <li>
                <button
                  type="button"
                  class="found-row"
                  class:at={index === cursor}
                  onmouseenter={() => (cursor = index)}
                  onclick={() => prompt.pick(option.id)}
                >
                  <!-- Where the answers are things the file list also shows, they
                       wear the same marks here: a note that chose an icon is that
                       icon in the tree and in the sheet that moves into it. A
                       space wears what the switcher gives it, in the same box, so
                       the names still read as one column. -->
                  {#if option.space}
                    <span class="space"><SpaceMark {...option.space} /></span>
                  {:else if option.mark}
                    <FileMark mark={option.mark} path={option.id} />
                  {/if}
                  <span class="found-label">{option.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="detail">{t('Nothing found')}</p>
        {/if}
      {:else if prompt.detail}
        <p class="detail">{prompt.detail}</p>
      {/if}

      <div class="row">
        {#if prompt.mode === 'choose'}
          {#each prompt.options as option (option.id)}
            <button
              type="button"
              class="nib-button"
              class:is-danger={option.danger}
              class:is-quiet={!option.primary && !option.danger}
              onclick={() => prompt.pick(option.id)}
            >
              {t(option.label)}
            </button>
          {/each}
        {:else if prompt.mode === 'find'}
          <button type="button" class="nib-button is-quiet" onclick={() => prompt.dismiss()}
            >{t('Cancel')}</button
          >
        {:else}
          <button type="button" class="nib-button is-quiet" onclick={() => prompt.dismiss()}
            >{t('Cancel')}</button
          >
          <button
            type="submit"
            class="nib-button"
            class:is-danger={prompt.danger}
            disabled={prompt.mode === 'text' && !prompt.value.trim()}
          >
            {t(prompt.confirmLabel)}
          </button>
        {/if}
      </div>
    </form>
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package; see Palette.svelte. */
  .sheet {
    --screen-width: 22rem;

    z-index: 51;
    padding: var(--space-5);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .detail {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  /* The answers to a question with too many of them, narrowed by typing. The
     gap the form puts between its children is the whole spacing here: the list
     sits under the field like the field sits under the title. */
  .found {
    list-style: none;
    margin: calc(var(--space-4) * -1 + var(--space-1)) 0 0;
    padding: 0;
  }

  .found-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  /* A space's mark in the box a file's mark sits in: the same width, so one
     column of names, and the letter a space falls back to set at the size of the
     marks beside it. The badge the switcher draws is not this - that is a place
     with a name of its own, and this is a row in a list of rows. */
  .space {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  /* The name is what runs out of room, not the mark beside it. */
  .found-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .found-row.at {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  /* The three buttons a question ever offers are `.nib-button` in the themes
     package: the one thing, `is-quiet` beside it, and `is-danger` where the
     answer takes something away. They were their own three here, at
     `--text-sm` where the sign-in panel's are `--text-base`, with no lift where
     its lift, and with a danger press mixed towards black - which on a dark
     theme is a press that reads as fading. */

  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }

  /* The sheet a note is renamed in, at the size the tree behind it is read at:
     the field and the names it suggests. The buttons under them take the row
     scale from `.nib-button` in the themes package, which is where their touch
     size and type size are said once. */
  :global([data-touch]) input,
  :global([data-touch]) .title {
    font-size: var(--touch-text);
  }

  :global([data-touch]) input {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
  }

  :global([data-touch]) .found-row {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
  }

  :global([data-touch]) .detail,
  :global([data-touch]) .label {
    font-size: var(--text-base);
  }
</style>
