<script lang="ts">
  /** Everything that answered one message, in the order it arrived, as the Codex
   *  sidebar draws a turn (docs/ai-sidebar.md 4.3): the work as compact steps - folded
   *  thinking, tool rows, reads in a row as one Explored step, the words between - and
   *  once the answer is in, all of it folded behind "Worked for 1m 23s" over the last
   *  words (steps.ts). One-line notices stay in their place (another model from here,
   *  compacted, stopped, the provider's error). Across the whole width with no bubble.
   *  Ask's citations are buttons that open their passage, and the notes they cite are a
   *  row of chips under the words: each opens its note beside.
   *
   *  Under it, while it is pointed at: copy, insert at the caret, ask again (whose menu
   *  asks another model) and "..." for the rest.
   *
   *  The words are the model's, which are nobody's markup: drawn through ai/drawn.ts
   *  with raw HTML escaped and nothing to load. */
  import type { EditorView } from '@nib/editor'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Answer from '../Answer.svelte'
  import { answerHtml } from '../drawn'
  import { citationLinks, citedIn, linkedAnswer } from '../retrieve'
  import type { Part, Turn } from '../chat/types'
  import { copyText } from '../../clipboard'
  import { i18n, t } from '../../i18n.svelte'
  import { links } from '../../link-index.svelte'
  import { DIVIDER, menu, type MenuEntry } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { howFor, tabAsk } from '../../new-tab'
  import { followHref, followNote, MIDDLE, opensLink } from '../../open-link'
  import { insideSpace } from '../../space-paths'
  import { viewport } from '../../viewport.svelte'
  import { views } from '../../views.svelte'
  import { workspace } from '../../workspace.svelte'
  import { ai } from '../store.svelte'
  import { chat } from './chat.svelte'
  import type { Source } from './citations'
  import Explored from './Explored.svelte'
  import { lasted } from './numbers'
  import PartRow from './PartRow.svelte'
  import StepLine from './StepLine.svelte'
  import { type Block, blocksOf, foldOf } from './steps'
  import TaskRows from './TaskRows.svelte'

  const {
    turn,
    sources,
    last,
    live,
    ongoto,
  }: {
    turn: Turn
    sources: Source[]
    last: boolean
    live: boolean
    ongoto?: ((line: number) => void) | undefined
  } = $props()

  /** The words of the turn, every text part in order. */
  const words = $derived(
    turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(''),
  )

  type Notice = Extract<Part, { kind: 'notice' }>

  const blocks = $derived(blocksOf(turn.parts))
  /** Once it is done, the steps fold into "Worked for" over the last words (steps.ts). */
  const fold = $derived(foldOf(blocks, live))
  let working = $state(false)
  const showWork = $derived(working || chat.unfolded)
  const worked = $derived(
    turn.took ? t('Worked for {time}', { time: lasted(turn.took, i18n.language) }) : t('Worked'),
  )

  function drawn(text: string): string {
    const source = citationLinks(text, sources.length)
    return answerHtml(
      source,
      (link) => {
        const found = link.target
          ? links.targetOf(workspace.panelNote, { kind: 'wikilink', target: link.target })
          : null
        return found === null ? null : { href: found }
      },
      t('Copy code'),
    )
  }

  /** The notes the answer cited, each once, with the first passage cited of each. */
  const cited = $derived.by(() => {
    const out: Source[] = []
    for (const n of citedIn(words, sources.length)) {
      const one = sources[n - 1]
      if (one && !out.some((other) => other.path === one.path)) out.push(one)
    }
    return out
  })

  async function openAt(source: Source, press: MouseEvent) {
    const root = workspace.activeSpace?.root
    if (!root) return
    const ask = tabAsk(press)
    if (viewport.drawer) workspace.closePanel('right')
    await workspace.open(insideSpace(root, source.path), howFor(ask))
    if (ask !== 'behind') ongoto?.(source.line)
  }

  /** A press inside the words: a citation, a wikilink, or an address. */
  function follow(event: MouseEvent) {
    if (!opensLink(event)) return
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return
    event.preventDefault()
    const number = /^#cite-(\d+)$/.exec(href)
    if (number) {
      const source = sources[Number(number[1]) - 1]
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

  const asNote = $derived(linkedAnswer(words, sources))
  const view = $derived<EditorView | undefined>(views.of(workspace.panes.focusedId))

  function insert() {
    const editor = view
    if (!editor || editor.state.readOnly) return
    const { from, to } = editor.state.selection.main
    editor.dispatch({
      changes: { from, to, insert: asNote },
      selection: { anchor: from + asNote.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    })
    editor.focus()
  }

  async function saveAsNote() {
    const path = await workspace.noteFrom(asNote)
    if (path) await workspace.open(path)
  }

  let copied = $state(false)
  let copying: ReturnType<typeof setTimeout> | undefined
  async function copy() {
    await copyText(asNote)
    copied = true
    clearTimeout(copying)
    copying = setTimeout(() => (copied = false), 1600)
  }

  /** Ask again, ChatGPT's "Try again": the same model first, and under it every model
   *  the provider has, to compare two answers (claude.ai's and Raycast's way too). */
  function againMenu(event: MouseEvent) {
    const provider = chat.provider
    if (!provider) return
    const listed = chat.models[provider.id] ?? []
    const rows: MenuEntry[] = listed.map((one) => ({
      label: one.name,
      checked: one.id === chat.head?.model,
      run: () => chat.retry({ provider: provider.id, id: one.id }),
    }))
    menu.show(event, [{ label: t('Ask again'), run: () => chat.retry() }, DIVIDER, ...rows], {
      title: t('Ask again'),
    })
  }

  /** The rest of what can be done with an answer, behind "...". */
  function moreMenu(event: MouseEvent) {
    menu.show(event, [
      ...(answered ? [{ label: t('Save as a note'), run: () => void saveAsNote() }] : []),
      { label: t('Branch'), run: () => chat.branch(undefined, turn.id) },
    ])
  }

  /** What a notice says, in the catalogue's words or the provider's own. */
  function noticeOf(part: Notice): string {
    switch (part.code) {
      case 'compacted':
        return t('Compacted')
      case 'model':
        return part.text
      case 'steps':
        return t('Step limit')
      case 'max_tokens':
        return t('Length limit')
      case 'refusal':
        return part.text ? `${t('Declined')} · ${part.text}` : t('Declined')
      case 'error':
        return part.text
      case 'stopped':
        return t('Stopped')
      case 'no_tools':
        return t('Without tools')
      case 'command':
        return part.text
      case 'tasks':
        return ''
    }
  }

  const failed = $derived(
    turn.parts.some((part) => part.kind === 'notice' && part.code === 'error'),
  )
  const answered = $derived(!!words.trim())
</script>

{#snippet one(block: Block)}
  {#if block.kind === 'words'}
    <Answer
      html={drawn(block.text)}
      live={live && block.at === blocks.at(-1)?.at}
      onfollow={follow}
    />
  {:else if block.kind === 'notice' && block.notice.code === 'tasks'}
    <TaskRows said={block.notice.text} />
  {:else if block.kind === 'notice'}
    <p
      class="notice"
      class:wrong={block.notice.code === 'error'}
      class:model={block.notice.code === 'model'}
      class:said={block.notice.code === 'command'}
      in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
    >
      {noticeOf(block.notice)}
      {#if block.notice.code === 'error' && last && !live}
        <button class="link" onclick={() => chat.retry()}>{t('Ask again')}</button>
      {/if}
    </p>
  {:else if block.kind === 'explored'}
    <div in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <Explored rows={block.rows} {live} />
    </div>
  {:else}
    <div in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <PartRow part={block.row} {live} />
    </div>
  {/if}
{/snippet}

<div class="answer" class:last>
  {#each fold.before as block (block.at)}
    {@render one(block)}
  {/each}

  {#if fold.work.length}
    <!-- Codex's "Worked for": the way to the answer, folded once it is done, with a
         hairline across to the end as the line between the work and the answer. -->
    <div class="worked">
      <StepLine verb={worked} open={showWork} onpress={() => (working = !working)} />
    </div>
    {#if showWork}
      <div class="work" transition:slide={{ duration: dur(150), easing: cubicOut }}>
        {#each fold.work as block (block.at)}
          {@render one(block)}
        {/each}
      </div>
    {/if}
  {/if}

  {#each fold.after as block (block.at)}
    {@render one(block)}
  {/each}

  {#if cited.length}
    <div class="sources">
      {#each cited as one (one.path)}
        <button class="source" title={one.path} onclick={(event) => void openAt(one, event)}
          >{one.name}</button
        >
      {/each}
    </div>
  {/if}

  {#if !live && (answered || (last && !failed))}
    <div class="acts">
      {#if answered}
        <button
          class="nib-glyph act"
          title={t('Copy')}
          aria-label={t('Copy')}
          onclick={() => void copy()}
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
          title={t('Insert at the caret')}
          aria-label={t('Insert at the caret')}
          disabled={!view || view.state.readOnly}
          onclick={insert}
        >
          <svg viewBox="0 0 13 13"><path d="M6.5 2v6.5M3.8 5.8l2.7 2.7 2.7-2.7M2.5 11h8" /></svg>
        </button>
      {/if}
      {#if last && ai.providers.length}
        <button
          class="nib-glyph act"
          title={t('Ask again')}
          aria-label={t('Ask again')}
          aria-haspopup="menu"
          onclick={againMenu}
        >
          <svg viewBox="0 0 13 13"><path d="M10.6 6.5a4.1 4.1 0 1 1-1.2-2.9M10.6 2v2.6H8" /></svg>
        </button>
      {/if}
      <button
        class="nib-glyph act"
        title={t('More')}
        aria-label={t('More')}
        aria-haspopup="menu"
        onclick={moreMenu}
      >
        <svg class="dots" viewBox="0 0 13 13"><path d="M3 6.5h.01M6.5 6.5h.01M10 6.5h.01" /></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .worked {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .worked::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .work {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .notice {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  /* Another model answers from here: a rule across with its name in it, the line
     between messages Claude Code draws. */
  .notice.model {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .notice.model::before,
  .notice.model::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  /* A command's own lines (a goal that ended, /status, /usage): already worded, a row
     a line, and never sent to the model. */
  .notice.said {
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .notice.wrong {
    color: var(--danger);
  }

  .sources,
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .source {
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface-2);
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

  /* Under the words while the answer is pointed at, Codex's hover-revealed actions, in
     their place all along, so a long thread is neither a column of buttons nor a thread
     that jumps as the pointer crosses it. */
  .acts {
    gap: 0;
    margin-inline-start: -6px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .answer:hover .acts,
  .acts:focus-within,
  :global([data-touch]) .acts {
    opacity: 1;
  }

  .act {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .act .dots {
    stroke-width: 2.2;
  }

  .act svg {
    stroke-width: 1.3;
  }

  .link {
    padding: 0;
    margin-inline-start: var(--space-1);
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
</style>
