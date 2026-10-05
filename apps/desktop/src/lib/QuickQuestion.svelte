<script lang="ts">
  /** The quick question: a field in the middle of the window, what the reader is
   *  looking at as a chip under it, and the answer arriving in place below. Drawn as
   *  ChatGPT's small composer: one rounded box with the round send button in it, the
   *  question in a bubble at the end of the line and the answer across the width, and
   *  under the answer its row - into the note, copy, and on in the AI panel.
   *
   *  The palette's shape and place - a box at the top of a layer that hangs from
   *  `--screen-top` and grows down as the answer arrives - because it is the same
   *  gesture: a key, a few words, Enter. Raycast's quick AI and Claude Code's /btw have
   *  the field first and the answer under it for the same reason. Escape, a click
   *  outside or the key again put it away, and a follow-up is the field again.
   *
   *  The store is ai/quick.svelte.ts; what goes along is ai/quick.ts. */
  import { cubicOut } from 'svelte/easing'
  import { fade, fly, scale } from 'svelte/transition'
  import Answer from './ai/Answer.svelte'
  import { answerHtml } from './ai/drawn'
  import type { ContextKind } from './ai/quick'
  import { quick } from './ai/quick.svelte'
  import Thinking from './ai/Thinking.svelte'
  import { closeOnBack } from './backstack.svelte'
  import { copyText } from './clipboard'
  import Cross from './Cross.svelte'
  import { t } from './i18n.svelte'
  import { dur, LAYER } from './motion'
  import { followHref, opensLink } from './open-link'
  import { overlays } from './overlays'
  import { scrollbar } from './scrollbar'
  import { settings } from './settings.svelte'
  import { trap } from './trap'

  let talk = $state<HTMLElement>()
  let field = $state<HTMLTextAreaElement>()

  const turns = $derived(quick.turns)
  const last = $derived(turns.at(-1))
  /** Waiting for the first words of an answer. */
  const waiting = $derived(quick.running && last?.role !== 'model')
  /** The answer the two actions are about: the last one, once it has stopped arriving. */
  const done = $derived(last?.role === 'model' && !quick.running ? last : null)

  // Escape puts it away, like everything the app puts over a note, and so does Back.
  $effect(() => (quick.open ? overlays.show(() => quick.close()) : undefined))
  $effect(() => closeOnBack(quick.open, () => quick.close()))

  /** Reads values for their own sake, so the effect around them follows them. */
  const follows = (..._values: unknown[]) => undefined

  // The end of the thread stays in view as an answer arrives.
  $effect(() => {
    follows(last?.text.length, waiting, quick.trouble)
    const box = talk
    if (box) box.scrollTop = box.scrollHeight
  })

  /** Enter asks and Shift+Enter is a new line, as in every field a question is typed
   *  into. Escape is the overlay's. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    void quick.ask()
  }

  /** A link in an answer is followed the way a note's is, and the question is put away:
   *  the reader has gone where it pointed. */
  function follow(event: MouseEvent) {
    if (!opensLink(event)) return
    const href = (event.target as Element | null)?.closest('a')?.getAttribute('href')
    if (!href) return

    event.preventDefault()
    if (!/^[a-z][a-z\d+.-]*:/i.test(href)) return
    quick.close()
    followHref(href, event)
  }

  /** Which answer's words were copied a moment ago, for the tick that says so. */
  let copied = $state(false)
  let copying: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string) {
    await copyText(text)
    copied = true
    clearTimeout(copying)
    copying = setTimeout(() => (copied = false), 1600)
  }

  /** The chip's mark: a note's page, a selection's quote marks, a page's globe. */
  const MARKS: Record<ContextKind, string> = {
    note: 'M7.5 1.8H3.6a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1V4.7zM7.5 1.8v2.9h2.9',
    selection: 'M2.5 3.5h8M2.5 6.5h8M2.5 9.5h5',
    page: 'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM1.8 6.5h9.4M6.5 1.8c1.3 1.3 1.9 2.9 1.9 4.7s-.6 3.4-1.9 4.7c-1.3-1.3-1.9-2.9-1.9-4.7s.6-3.4 1.9-4.7z',
  }
</script>

{#if quick.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => quick.close()}
  ></div>

  <div
    class="nib-screen quick"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Quick question')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#if quick.ready}
      <div class="field nib-field">
        <textarea
          bind:this={field}
          bind:value={quick.question}
          data-lands
          rows="1"
          placeholder={t('Ask')}
          aria-label={t('Quick question')}
          spellcheck="false"
          onkeydown={onKey}></textarea>

        {#if quick.running}
          <button class="go" title={t('Stop')} aria-label={t('Stop')} onclick={() => quick.stop()}>
            <svg viewBox="0 0 13 13"
              ><rect class="square" x="4" y="4" width="5" height="5" rx="0.8" /></svg
            >
          </button>
        {:else}
          <button
            class="go"
            title={t('Ask')}
            aria-label={t('Ask')}
            disabled={!quick.question.trim()}
            onclick={() => void quick.ask()}
          >
            <svg viewBox="0 0 13 13"><path d="M6.5 10.6V2.6M3.2 5.9l3.3-3.3 3.3 3.3" /></svg>
          </button>
        {/if}
      </div>

      <!-- What goes along, said once: the note, the selection in it or the page, and
           a cross that takes it off for the rest of the thread. -->
      {#if quick.context}
        {@const context = quick.context}
        <div class="chips" transition:fade={{ duration: dur(120) }}>
          <span class="chip" class:quoted={context.kind === 'selection'} title={context.name}>
            <svg viewBox="0 0 13 13"><path d={MARKS[context.kind]} /></svg>
            <span class="what"
              >{context.kind === 'selection' ? context.text.slice(0, 120) : context.name}</span
            >
            <button
              class="drop"
              title={t('Remove')}
              aria-label={t('Remove')}
              onclick={() => {
                quick.drop()
                field?.focus()
              }}
            >
              <Cross small />
            </button>
          </span>
        </div>
      {/if}
    {:else}
      <!-- The one thing to say before a provider is set up, and where to do it. -->
      <p class="empty-text">
        {t('Add an AI provider in Settings first.')}
        <button
          class="link"
          data-lands
          onclick={() => {
            quick.close()
            settings.show('ai')
          }}>{t('Settings › AI')}</button
        >
      </p>
    {/if}

    {#if turns.length || quick.trouble}
      <div class="talk" bind:this={talk} use:scrollbar>
        {#each turns as turn, at (at)}
          {#if turn.role === 'you'}
            <p class="said" in:fly={{ y: 6, duration: dur(150), easing: cubicOut }}>{turn.text}</p>
          {:else}
            <Answer
              html={answerHtml(turn.text, undefined, t('Copy code'))}
              live={quick.running && at === turns.length - 1}
              onfollow={follow}
            />
          {/if}
        {/each}

        {#if waiting}
          <Thinking />
        {/if}

        {#if quick.trouble}
          <p class="wrong">{quick.trouble}</p>
        {/if}

        {#if done}
          <div class="acts" in:fade={{ duration: dur(120) }}>
            <button
              class="nib-glyph act"
              title={t('Add to note')}
              aria-label={t('Add to note')}
              onclick={() => void quick.addToNote(done.text)}
            >
              <svg viewBox="0 0 13 13"><path d="M6.5 2v6.5M3.8 5.8l2.7 2.7 2.7-2.7M2.5 11h8" /></svg
              >
            </button>
            <button
              class="nib-glyph act"
              title={t('Copy')}
              aria-label={t('Copy')}
              onclick={() => void copy(done.text)}
            >
              <svg viewBox="0 0 13 13">
                {#if copied}
                  <path d="M2.8 6.8l2.4 2.4 5-5.4" />
                {:else}
                  <path
                    d="M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"
                  />
                {/if}
              </svg>
            </button>
            <button
              class="nib-glyph act"
              title={t('Continue in the panel')}
              aria-label={t('Continue in the panel')}
              onclick={() => void quick.continueInPanel()}
            >
              <svg viewBox="0 0 13 13"
                ><path
                  d="M2.5 3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6l-2.5 2v-2h0a1 1 0 0 1-1-1z"
                /></svg
              >
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: var(--z-screen);
  }

  /* `.nib-screen` in the themes package: the palette's width of the scale, hanging
     from the same line, so it grows downwards as the answer arrives. */
  .quick {
    --screen-width: var(--screen-list);

    z-index: var(--z-screen);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* The composer's box, ChatGPT's: rounded, inset from the sheet's edge, the round
     button inside it at the end of the words. */
  .field {
    flex: none;
    align-items: flex-end;
    min-height: 0;
    width: calc(100% - 2 * var(--space-3));
    margin: var(--space-3) var(--space-3) 0;
    padding: 0 var(--space-2) 0 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  /* Grows to a few lines and then scrolls: a question is sometimes a paragraph. */
  textarea {
    min-height: 0;
    max-height: 9rem;
    padding: var(--space-3);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: 1.4;
    resize: none;
    field-sizing: content;
  }

  textarea::placeholder {
    color: var(--muted);
  }

  /* The one round button: filled while there is something to send, the stop while an
     answer arrives; the AI panel's. */
  .go {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-bottom: calc((var(--text-base) * 1.4 + 2 * var(--space-3) - 28px) / 2);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--text-strong);
    color: var(--bg);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      scale var(--dur-fast) var(--ease-out);
  }

  .go:disabled {
    background: var(--surface-hover);
    color: var(--muted);
  }

  .go:active:not(:disabled) {
    scale: 0.92;
  }

  .go svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .go .square {
    fill: currentColor;
    stroke: none;
  }

  .act svg,
  .chip svg {
    stroke-width: 1.3;
  }

  .chips {
    flex: none;
    display: flex;
    padding: var(--space-2) var(--space-4) var(--space-1);
  }

  /* What goes along: its mark, its name, and the cross that takes it off. The Ask
     panel's chip, with a way to remove it rather than to turn it over. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    padding: 1px 1px 1px 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .chip svg {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.quoted .what::before {
    content: '\201C';
  }

  .chip.quoted .what::after {
    content: '\201D';
  }

  .drop {
    flex: none;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .drop :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  @media (hover: hover) {
    .drop:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .drop:active {
    background: var(--surface-press);
  }

  /* The thread: the only thing in the layer that scrolls. */
  .talk {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-3);
  }

  /* The question: the AI panel's bubble at the end of the line. */
  .said {
    align-self: flex-end;
    max-width: 85%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .acts {
    display: flex;
    margin: calc(var(--space-2) * -1) 0 0 -6px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: default;
  }

  @media (hover: hover) {
    .link:hover {
      text-decoration: underline;
    }
  }

  .empty-text,
  .wrong {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--muted);
  }

  .empty-text {
    padding: var(--space-4);
  }

  .wrong {
    color: var(--danger);
  }

  /* A sheet from the bottom on a phone, standing on the keyboard; see PromptSheet. */
  :global([data-touch]) .quick {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }

  :global([data-touch]) textarea,
  :global([data-touch]) .said,
  :global([data-touch]) .empty-text,
  :global([data-touch]) .wrong {
    font-size: var(--text-base);
  }
</style>
