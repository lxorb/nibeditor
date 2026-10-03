<script lang="ts">
  /** The panel you ask your notes in: the conversation above, the field at the foot,
   *  and the note in front still on screen beside it.
   *
   *  A panel and not a sheet, because a question about the notes is asked while reading
   *  them: nothing is covered, the answer arrives beside the note, and a citation opens
   *  its passage in the note without anything being dismissed first. On the right, where
   *  VS Code keeps its chat and Obsidian's assistants live.
   *
   *  Every answer cites its passages by number, and each number is a button: it opens
   *  the note at the line the passage was taken from and lights it. An answer that
   *  cannot be checked in one press is a rumour. What a question is sent with is
   *  ai/retrieve.ts; the turns are ai/asking.svelte.ts.
   *
   *  The answer is the model's words, which are nobody's markup: rendered with raw HTML
   *  escaped and every picture and frame taken out, so a note that talked a model into
   *  writing `![](https://somewhere/?what-you-wrote)` loads nothing from anywhere.
   *
   *  Fetched the first time the panel is shown, and everything behind it with it - the
   *  providers, the keys, the stream, the retrieval; see surfaces.svelte.ts and
   *  test/weight.test.ts. */
  import type { EditorView } from '@nib/editor'
  import { onMount, tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { asking, type Source, type Turn } from './ai/asking.svelte'
  import Answer from './ai/Answer.svelte'
  import { answerHtml } from './ai/drawn'
  import Thinking from './ai/Thinking.svelte'
  import { citationLinks, citedIn, linkedAnswer } from './ai/retrieve'
  import { copyText } from './clipboard'
  import { t } from './i18n.svelte'
  import { links } from './link-index.svelte'
  import { dur } from './motion'
  import { howFor, tabAsk } from './new-tab'
  import { followHref, followNote, MIDDLE, opensLink } from './open-link'
  import { scrollbar } from './scrollbar'
  import { settings } from './settings.svelte'
  import { insideSpace } from './space-paths'
  import { viewport } from './viewport.svelte'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const { ongoto }: { ongoto?: ((line: number) => void) | undefined } = $props()

  let talk = $state<HTMLElement>()
  let field = $state<HTMLTextAreaElement>()
  let setup = $state<HTMLButtonElement>()
  /** Whether the conversation is scrolled to its end, which is when an answer arriving
   *  takes the view down with it. Scrolled up to read, it stays where it was put. */
  let atEnd = true

  const turns = $derived(asking.turns)
  const last = $derived(turns.at(-1))
  /** Waiting for the first words of an answer. */
  const waiting = $derived(asking.running && last?.role !== 'model')

  /** The note in front, as the chip over the field names it. */
  const front = $derived(
    workspace.panelTab?.kind === 'note' && workspace.panelTab.path
      ? workspace.panelTab.shown
      : null,
  )

  /** What is selected in the note, which goes with the question beside it: the words,
   *  read again whenever the selection moves. */
  const picked = $derived(views.chosen > 0 ? views.selectedText().slice(0, 120) : '')

  /** The editor a press acts on: the pane the reader was last writing in. */
  const view = $derived<EditorView | undefined>(views.of(workspace.panes.focusedId))

  /** An answer as the panel draws it: escaped and with nothing to load (ai/drawn.ts),
   *  its citations links the click below answers and its wikilinks resolved the way
   *  the reading view resolves them. */
  function drawn(turn: Turn): string {
    const source = citationLinks(turn.text, turn.sources?.length ?? 0)
    return answerHtml(source, (link) => {
      const found = link.target
        ? links.targetOf(workspace.panelNote, { kind: 'wikilink', target: link.target })
        : null
      return found === null ? null : { href: found }
    })
  }

  /** The notes an answer cited, each once, with the first passage it cited of each. */
  function citedNotes(turn: Turn): Source[] {
    const sources = turn.sources ?? []
    const out: Source[] = []
    for (const n of citedIn(turn.text, sources.length)) {
      const one = sources[n - 1]
      if (one && !out.some((other) => other.path === one.path)) out.push(one)
    }
    return out
  }

  /** Opens a note at a passage, as a Search row opens its hit: a tab of its own where
   *  the press asked for one, and the line lit. A drawer over the note is put away
   *  first, because the point is to see the passage. */
  async function openAt(source: Source, press: MouseEvent) {
    const root = workspace.activeSpace?.root
    if (!root) return

    const ask = tabAsk(press)
    if (viewport.drawer) workspace.closePanel('right')
    await workspace.open(insideSpace(root, source.path), howFor(ask))
    if (ask !== 'behind') ongoto?.(source.line)
  }

  /** A press inside an answer: a citation, a wikilink, or an address. */
  function follow(event: MouseEvent, turn: Turn) {
    if (!opensLink(event)) return
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    event.preventDefault()
    const cited = /^#cite-(\d+)$/.exec(href)
    if (cited) {
      const source = turn.sources?.[Number(cited[1]) - 1]
      if (source) void openAt(source, event)
      return
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
      followHref(href, event)
      return
    }

    if (event.button === MIDDLE && !anchor.classList.contains('wikilink')) return
    followNote({ path: href, target: href, heading: null, block: null, page: null }, event)
  }

  /** The words of an answer as they go into a note, each citation a wikilink. */
  const asNote = (turn: Turn) => linkedAnswer(turn.text, turn.sources ?? [])

  function insert(turn: Turn) {
    const editor = view
    if (!editor || editor.state.readOnly) return

    const text = asNote(turn)
    const { from, to } = editor.state.selection.main
    editor.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    })
    editor.focus()
  }

  async function saveAsNote(turn: Turn) {
    const path = await workspace.noteFrom(asNote(turn))
    if (path) await workspace.open(path)
  }

  /** Which answer's words were copied a moment ago, for the tick that says so. */
  let copied = $state<Turn | null>(null)
  let copying: ReturnType<typeof setTimeout> | undefined

  async function copy(turn: Turn) {
    await copyText(asNote(turn))
    copied = turn
    clearTimeout(copying)
    copying = setTimeout(() => (copied = null), 1600)
  }

  /** Enter asks and Shift+Enter is a new line, as every field a question is typed into
   *  does; Escape stops an answer on its way. */
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && asking.running) {
      event.preventDefault()
      asking.stop()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

    event.preventDefault()
    void asking.ask()
  }

  function onScroll() {
    const box = talk
    if (box) atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  }

  /** Reads values for their own sake, so the effect around them follows them. The same
   *  helper the Links panel keeps, for the same reason. */
  const follows = (..._values: unknown[]) => undefined

  // The end of the conversation stays in view as an answer arrives, while the reader
  // has not scrolled up to read something else.
  $effect(() => {
    follows(last?.text.length, waiting, asking.trouble)
    const box = talk
    if (box && atEnd) void tick().then(() => (box.scrollTop = box.scrollHeight))
  })

  // A key that opened this panel put the keyboard in its body while the panel was still
  // on its way; the field takes it from there. See `revealPanel` in focus.ts.
  onMount(() => {
    const entry = field ?? setup
    if (entry?.closest('[data-panel]') === document.activeElement) entry.focus()
    if (talk) talk.scrollTop = talk.scrollHeight
  })
</script>

<div class="ask" class:is-empty={!turns.length && !asking.running && !asking.trouble}>
  <div class="talk" bind:this={talk} use:scrollbar onscroll={onScroll}>
    {#if !asking.ready}
      <!-- The one thing to say before a provider is set up, and where to do it. -->
      <p class="empty-text">
        {t('Add an AI provider in Settings first.')}
        <button class="link" bind:this={setup} onclick={() => settings.show('ai')}
          >{t('Settings › AI')}</button
        >
      </p>
    {/if}

    {#each turns as turn, at (at)}
      {#if turn.role === 'you'}
        <p class="said" in:fly={{ y: 6, duration: dur(150), easing: cubicOut }}>{turn.text}</p>
      {:else}
        {@const notes = citedNotes(turn)}
        <div class="answer">
          <Answer html={drawn(turn)} onfollow={(event: MouseEvent) => follow(event, turn)} />

          {#if notes.length}
            <div class="sources">
              {#each notes as one (one.path)}
                <button class="source" title={one.path} onclick={(event) => void openAt(one, event)}
                  >{one.name}</button
                >
              {/each}
            </div>
          {/if}

          {#if !(asking.running && turn === last)}
            <div class="acts">
              <button
                class="nib-glyph act"
                title={t('Copy')}
                aria-label={t('Copy')}
                onclick={() => void copy(turn)}
              >
                <svg viewBox="0 0 13 13">
                  {#if copied === turn}
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
                title={t('Insert at the caret')}
                aria-label={t('Insert at the caret')}
                disabled={!view || view.state.readOnly}
                onclick={() => insert(turn)}
              >
                <svg viewBox="0 0 13 13"
                  ><path d="M6.5 2v6.5M3.8 5.8l2.7 2.7 2.7-2.7M2.5 11h8" /></svg
                >
              </button>
              <button
                class="nib-glyph act"
                title={t('Save as a note')}
                aria-label={t('Save as a note')}
                onclick={() => void saveAsNote(turn)}
              >
                <svg viewBox="0 0 13 13">
                  <path
                    d="M7.5 1.8H3.6a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1V4.7zM7.5 1.8v2.9h2.9M6.5 6.2v3.4M4.8 7.9h3.4"
                  />
                </svg>
              </button>
              {#if turn === last}
                <button
                  class="nib-glyph act"
                  title={t('Ask again')}
                  aria-label={t('Ask again')}
                  onclick={() => asking.again()}
                >
                  <svg viewBox="0 0 13 13"
                    ><path d="M10.6 6.5a4.1 4.1 0 1 1-1.2-2.9M10.6 2v2.6H8" /></svg
                  >
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if waiting}
      <!-- Three dots while the passages are gathered and the first words are on their
           way: something is happening, and nothing needs saying about it. -->
      <Thinking />
    {/if}

    {#if asking.trouble}
      <p class="wrong">
        {asking.trouble}
        {#if last?.role === 'you'}
          <button class="link" onclick={() => asking.again()}>{t('Ask again')}</button>
        {/if}
      </p>
    {/if}
  </div>

  {#if asking.ready}
    <!-- The field, at the foot, with what goes with the question over it: the note in
         front, which a press takes off for the next question and puts back. -->
    <div class="foot">
      {#if front}
        <div class="chips">
          <button
            class="context"
            class:off={!asking.withNote}
            aria-pressed={asking.withNote}
            title={front}
            onclick={() => (asking.withNote = !asking.withNote)}
          >
            <svg viewBox="0 0 13 13"
              ><path
                d="M7.5 1.8H3.6a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1V4.7zM7.5 1.8v2.9h2.9"
              /></svg
            >
            <span>{front}</span>
          </button>
          {#if picked && asking.withNote}
            <span class="context picked" title={picked}><span>{picked}</span></span>
          {/if}
        </div>
      {/if}

      <div class="nib-field box">
        <textarea
          bind:this={field}
          bind:value={asking.question}
          data-entry
          rows="1"
          placeholder={t('Ask about this space')}
          aria-label={t('Ask about this space')}
          onkeydown={onKey}></textarea>

        {#if asking.running}
          <button
            class="nib-glyph go"
            title={t('Stop')}
            aria-label={t('Stop')}
            onclick={() => asking.stop()}
          >
            <svg viewBox="0 0 13 13"><rect x="3.5" y="3.5" width="6" height="6" rx="1" /></svg>
          </button>
        {:else}
          <button
            class="nib-glyph go"
            title={t('Ask')}
            aria-label={t('Ask')}
            disabled={!asking.question.trim()}
            onclick={() => void asking.ask()}
          >
            <svg viewBox="0 0 13 13"><path d="M6.5 10.6V2.6M3.2 5.9l3.3-3.3 3.3 3.3" /></svg>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* A column with one thing that scrolls in it: the conversation grows and the field at
     the foot stays put. The body this sits in gives up its own scrolling and padding
     for it; see Sidebar.svelte. */
  .ask {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .talk {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-1) calc(var(--space-1) + var(--row-pad)) var(--space-3);
  }

  /* The question: set off by its weight and a rule down its starting edge rather than
     by a bubble. Two bubbles facing each other is a chat app, and this is a panel in a
     text editor. */
  .said {
    margin: 0;
    padding-inline-start: var(--space-2);
    border-inline-start: 2px solid var(--line-strong);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .sources,
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /* The notes an answer cited, each a press away from its first passage. */
  .source {
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .source:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  /* Quiet until the answer is pointed at, so a long conversation is not a column of
     buttons; the last answer's are always there. */
  .acts {
    gap: 0;
    margin-inline-start: -6px;
    opacity: 0.55;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .answer:hover .acts,
  .acts:focus-within,
  .answer:last-of-type .acts,
  :global([data-touch]) .acts {
    opacity: 1;
  }

  .act svg,
  .go svg,
  .context svg {
    stroke-width: 1.3;
  }

  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-2) var(--space-1);
    border-top: 1px solid var(--line);
  }

  /* What goes with the question: the note in front, as a chip that a press takes off
     and puts back. Struck through while it is off. */
  .chips {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .context {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    padding: 1px var(--space-2) 1px 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .context svg {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
  }

  .context span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context.off {
    opacity: 0.6;
  }

  /* The selection, quoted, beside the note it is in: it goes with the note or not at
     all, so it is said here and pressed nowhere. */
  .context.picked {
    max-width: 60%;
  }

  .context.picked span::before {
    content: '\201C';
  }

  .context.picked span::after {
    content: '\201D';
  }

  .context.off span {
    text-decoration: line-through;
  }

  @media (hover: hover) {
    .context:hover {
      border-color: var(--line-strong);
      color: var(--text);
    }
  }

  /* The field and its one button, one box: the shared field's wrapper, which answers
     the keyboard for the words inside it; see base.css. */
  .box {
    align-items: flex-end;
    padding: 2px 2px 2px var(--row-pad);
  }

  /* Grows to a few lines and then scrolls: a question is sometimes a paragraph, and the
     conversation above it is what the room is for. */
  .box textarea {
    min-height: calc(var(--row-height) - 4px);
    max-height: 9rem;
    padding: 5px 0;
    line-height: 1.4;
    resize: none;
    field-sizing: content;
  }

  .go {
    flex: none;
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

  .wrong {
    color: var(--danger);
  }

  :global([data-touch]) .said,
  :global([data-touch]) .empty-text,
  :global([data-touch]) .wrong,
  :global([data-touch]) textarea {
    font-size: var(--text-base);
  }
</style>
