<script lang="ts">
  /** The bar that finds words, wherever words are being read or written.
   *
   *  One bar for all three surfaces: the note being written in, the note being
   *  read, and a PDF. It used to be two - this one, for the two surfaces with no
   *  CodeMirror to ask, and CodeMirror's own panel for the one that has it, which
   *  was the only control in the app wearing none of the design: bare inputs,
   *  three checkboxes labelled in the library's own English, a `x` for a close
   *  button, and no idea what a finger is. So the panel is gone (see find.ts in
   *  @nib/editor) and this is what all three draw.
   *
   *  What each surface can do differs, and the bar is what it is given rather
   *  than three bars: the three flags appear only where something can honour them,
   *  and the replace row only where the words can be changed. A note being read
   *  gets the field, the tally, the steps and the cross, which is exactly what it
   *  had.
   *
   *  Everything about the shape is the design system's: one `.nib-field` for the
   *  query with the flags inside it at the right, the row scale for every target
   *  so a thumb gets 56px where a pointer gets 28, `--radius-row`, the focus ring
   *  stated once in base.css, and the two transitions from slide.ts. What is left
   *  here is where things sit inside the field.
   *
   *  The keys: Enter steps on, Shift+Enter steps back, Escape closes and the
   *  caller puts the caret back where it was. Tab is not swallowed - the bar is a
   *  bar, not a dialog, and the steps beside the field are where Tab should go. */

  import type { FindSpec } from '@nib/editor'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import CaseSensitive from 'lucide/dist/esm/icons/case-sensitive.mjs'
  import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs'
  import Regex from 'lucide/dist/esm/icons/regex.mjs'
  import WholeWord from 'lucide/dist/esm/icons/whole-word.mjs'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { SEARCH_MARK } from './panel-marks'
  import { arrive, leave } from './slide'

  /** The three things a match may be fussy about: the same three the editor's
   *  query already has, named here as what they are rather than declared again,
   *  so there is one definition of them in the app. A surface that matches plain
   *  words passes none and the field stays plain. */
  type FindFlags = Pick<FindSpec, 'caseSensitive' | 'regexp' | 'wholeWord'>

  const {
    query,
    count,
    /** Which match is the current one, counting from zero, or -1 for none. */
    current,
    /** Whether the count stopped before the end of the document, so the tally
     *  says "300+" rather than a number that is not true. */
    capped = false,
    flags,
    onflags,
    replacing = false,
    replacement = '',
    onreplacing,
    onreplacement,
    onreplace,
    onreplaceall,
    onstep,
    onclose,
    onquery,
  }: {
    query: string
    count: number
    current: number
    capped?: boolean
    /** Undefined where the surface cannot honour them, which is what takes the
     *  three toggles out of the field. */
    flags?: FindFlags | undefined
    onflags?: ((flags: FindFlags) => void) | undefined
    /** Undefined where the words cannot be changed, which is what takes the
     *  chevron and the second row away. */
    replacing?: boolean
    replacement?: string
    onreplacing?: ((open: boolean) => void) | undefined
    onreplacement?: ((typed: string) => void) | undefined
    onreplace?: (() => void) | undefined
    onreplaceall?: (() => void) | undefined
    onstep: (by: number) => void
    onclose: () => void
    /** What was typed. The caller holds the query, because the caller is what
     *  searches with it. */
    onquery: (typed: string) => void
  } = $props()

  let field = $state<HTMLInputElement>()
  let replaceField = $state<HTMLInputElement>()

  /** Whether the replace row is offered at all: one question, asked of the
   *  callbacks rather than of a flag, so a caller cannot say yes and then have
   *  nothing to do about it. */
  const writable = $derived(!!onreplace)

  // The bar exists only while it is open, so arriving is the moment to take the
  // keyboard: whatever was typed last is there and selected, ready to replace.
  // The replace row is what takes it when the row is what was asked for.
  $effect(() => {
    const landing = replacing && replaceField ? replaceField : field
    landing?.focus()
    landing?.select()
  })

  /** What the tally reads. Three states and a word for each: nothing typed says
   *  nothing at all, a query with no matches says so in words rather than with a
   *  zero, and a query with matches says which one of how many. */
  const tally = $derived.by(() => {
    if (!query) return ''
    if (!count) return t('No matches')

    const of = capped ? `${count}+` : `${count}`
    return t('{at} of {count}', { at: current < 0 ? 1 : current + 1, count: of })
  })

  function flip(which: keyof FindFlags) {
    if (!flags || !onflags) return
    onflags({ ...flags, [which]: !flags[which] })
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      // Kept off the window: what is open here is the bar, and the layer above
      // it has its own Escape; see overlays.ts.
      event.preventDefault()
      event.stopPropagation()
      onclose()
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    onstep(event.shiftKey ? -1 : 1)
  }
</script>

<!-- A bar under the strip rather than a layer over the note: what is being
     searched has to stay where it was, and a bar that covered the first line of
     it would be a bar that hid the first match. -->
<div class="findbar" in:arrive out:leave>
  <div class="line">
    <div class="box">
      <!-- The same magnifier every search in the app wears, in the field's own
           left padding, so the words start where the placeholder's do. -->
      <svg class="nib-field-mark mag" viewBox="0 0 13 13" aria-hidden="true"
        ><path d={SEARCH_MARK} /></svg
      >

      <input
        bind:this={field}
        class="nib-field query"
        class:flagged={!!flags}
        type="text"
        value={query}
        placeholder={t('Find')}
        aria-label={t('Find')}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
          onquery(event.currentTarget.value)}
        onkeydown={onKeydown}
      />

      <!-- Inside the field, at the right, because all three are about what is in
           it. Three, always the same three, which is what lets the room for them
           be taken out of the field by a fixed amount rather than measured. -->
      <span class="inside">
        {#if flags}
          <button
            class="flag"
            class:on={flags.caseSensitive}
            title={t('Match case')}
            aria-label={t('Match case')}
            aria-pressed={flags.caseSensitive}
            onclick={() => flip('caseSensitive')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each CaseSensitive as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
          <button
            class="flag"
            class:on={flags.wholeWord}
            title={t('Whole word')}
            aria-label={t('Whole word')}
            aria-pressed={flags.wholeWord}
            onclick={() => flip('wholeWord')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each WholeWord as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
          <button
            class="flag"
            class:on={flags.regexp}
            title={t('Regular expression')}
            aria-label={t('Regular expression')}
            aria-pressed={flags.regexp}
            onclick={() => flip('regexp')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each Regex as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {/if}
      </span>
    </div>

    <!-- Beside the field rather than in it: how many there are is a fact about
         the document, and a count inside the box would have to be measured
         before the field knew how much room to leave it. Grouped with the
         controls so that where the line wraps, it wraps as one thing. -->
    <span class="acts">
      {#if tally}
        <span class="tally" aria-live="polite">{tally}</span>
      {/if}

      <button
        class="nib-glyph act"
        title={t('Previous')}
        aria-label={t('Previous')}
        disabled={!count}
        onclick={() => onstep(-1)}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.2 8.2 6.5 4.9l3.3 3.3" /></svg>
      </button>
      <button
        class="nib-glyph act"
        title={t('Next')}
        aria-label={t('Next')}
        disabled={!count}
        onclick={() => onstep(1)}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.2 4.9 6.5 8.2l3.3-3.3" /></svg>
      </button>

      {#if writable}
        <!-- The chevron turns over as the row it opens arrives, which is the same
           thing the space switcher's does: one control, one movement. Ctrl+H is
           the same gesture from the keyboard. -->
        <button
          class="nib-glyph act"
          class:on={replacing}
          title={t('Replace')}
          aria-label={t('Replace')}
          aria-expanded={replacing}
          onclick={() => onreplacing?.(!replacing)}
        >
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
            {#each ChevronDown as [tag, attrs], index (index)}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
        </button>
      {/if}

      <button
        class="nib-glyph act shut"
        title={t('Close')}
        aria-label={t('Close')}
        onclick={onclose}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"
          ><path d="M3.6 3.6l5.8 5.8M9.4 3.6l-5.8 5.8" /></svg
        >
      </button>
    </span>
  </div>

  {#if writable && replacing}
    <div class="line" transition:fly={{ y: -6, duration: dur(130), easing: cubicOut }}>
      <div class="box">
        <input
          bind:this={replaceField}
          class="nib-field"
          type="text"
          value={replacement}
          placeholder={t('Replace with')}
          aria-label={t('Replace with')}
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
            onreplacement?.(event.currentTarget.value)}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onclose()
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onreplaceall?.()
              else onreplace?.()
            }
          }}
        />
      </div>

      <button class="apply" disabled={!count} onclick={() => onreplace?.()}>{t('Replace')}</button>
      <button class="apply" disabled={!count} onclick={() => onreplaceall?.()}
        >{t('Replace all')}</button
      >
    </div>
  {/if}
</div>

<style>
  /* Level 2 of the elevation model: a small bar over the text, so a hairline
     under it and the surface it is drawn on. It does not float - it is a row of
     the pane, above what is being searched - so no shadow and no radius of its
     own; see docs/design.md. */
  .findbar {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  /* One row, and the same row wrapped where it will not fit. A phone is 390px
     wide: the field, a count and four squares at the touch scale come to more
     than that, so the field takes the width and everything beside it drops to the
     line below. The same controls in the same order, reflowed - not a second
     design for a small screen. */
  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /* Where it wraps, the field is the whole of the first line and what follows it
     gathers at the right of the second. */
  .box {
    flex: 1 1 14rem;
  }

  /* Everything beside the field, as one group, so the whole lot wraps together
     and lands at the right of the line it wraps onto. */
  .acts {
    flex: none;
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* Holds the field and everything that sits inside it. */
  .box {
    position: relative;
    min-width: 0;
  }

  /* The box is `.nib-field` in the themes package. What is left here is the room
     the mark in front and the flags behind take out of it. The right-hand room
     is only taken where there are flags to take it. */
  .query {
    padding-inline-start: calc(var(--row-pad) + var(--icon-md) + var(--row-gap));
  }

  /* Room for exactly three flags. Worked out from the flag's own size, so it
     comes out right at both scales without the bar knowing which it is on. */
  .query.flagged {
    padding-inline-end: calc((var(--row-height) - 6px) * 3 + var(--space-3));
  }

  /* Over the field rather than beside it, because here the field is the input
     itself and there is no box to stand in. The drawing is `.nib-field-mark` in
     the themes package, which every search in the app wears. */
  .mag {
    position: absolute;
    inset-inline-start: var(--row-pad);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  /* The right end of the field, as one group, so the tally and the three flags
     keep their order and their spacing whatever is in the box. */
  .inside {
    position: absolute;
    top: 50%;
    inset-inline-end: 3px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .tally {
    flex: none;
    padding: 0 var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }

  /* A flag inside the field. Smaller than the row it sits in, because it is
     inside a control rather than beside one, and the same shape the search
     panel's own in-field button wears. */
  .flag {
    flex: none;
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
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .flag:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
  }

  .flag:active {
    background: var(--surface-press);
  }

  /* On, in the accent, with a ground of its own so the state survives a hover.
     The same three colours the search panel's replace button uses for the same
     idea. */
  .flag.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .flag:focus-visible {
    outline-offset: -1px;
  }

  .flag svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Beside the field: a step, the chevron, the cross. `.nib-glyph` in the themes
     package draws each one - the same square every icon button in the app is, a
     thumb's target under a thumb and a pointer's under a pointer. What is left
     here is the hairline a pressed-in one turns, which needs a transparent one
     to turn from, and which keeps the square the same size either way. */
  .act {
    border: 1px solid transparent;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .act.on {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .act:focus-visible {
    outline-offset: -1px;
  }

  .act svg {
    stroke-width: 1.6;
  }

  /* The chevron is drawn on Lucide's grid, which is a quarter again as wide as
     the paths written here, and it turns over while what it opened is open -
     the same movement the space switcher's makes. */
  .act .chevron {
    width: var(--icon-sm);
    height: var(--icon-sm);
    stroke-width: 2.2;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .act.on .chevron {
    transform: rotate(180deg);
  }

  @media (hover: hover) {
    .shut:hover {
      color: var(--danger);
    }
  }

  /* A word rather than a glyph: replacing is not something to guess at. */
  .apply {
    flex: none;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    white-space: nowrap;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .apply:hover:not(:disabled) {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
  }

  .apply:active:not(:disabled) {
    background: var(--accent-press);
    border-color: var(--accent-press);
    color: #fff;
  }

  .apply:disabled {
    color: var(--muted);
  }
</style>
