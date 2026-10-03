<script lang="ts">
  /** Everything that answered one message, in the order it arrived: words, folded
   *  thinking and tool rows, and the one-line notices between them (another model from
   *  here, compacted, stopped, the provider's error). Ask's citations are buttons that
   *  open their passage, and the notes they cite are a row under the words, as the Ask
   *  panel drew them.
   *
   *  The words are the model's, which are nobody's markup: drawn through ai/drawn.ts
   *  with raw HTML escaped and nothing to load. */
  import type { EditorView } from '@nib/editor'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Answer from '../Answer.svelte'
  import { answerHtml } from '../drawn'
  import { citationLinks, citedIn, linkedAnswer } from '../retrieve'
  import type { Part, Turn } from '../chat/types'
  import { copyText } from '../../clipboard'
  import { t } from '../../i18n.svelte'
  import { links } from '../../link-index.svelte'
  import { menu, type MenuEntry } from '../../menu.svelte'
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
  import PartRow from './PartRow.svelte'

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
  type Folded = Extract<Part, { kind: 'thinking' | 'tool' }>
  type Block =
    | { kind: 'words'; text: string; at: number }
    | { kind: 'notice'; notice: Notice; at: number }
    | { kind: 'row'; row: Folded; at: number }

  /** Consecutive text parts drawn as one answer, so a paragraph split across two
   *  rounds of a stream is one paragraph. */
  const blocks = $derived.by(() => {
    const out: Block[] = []
    turn.parts.forEach((part, at) => {
      const before = out.at(-1)
      if (part.kind === 'text') {
        if (before?.kind === 'words') before.text += part.text
        else out.push({ kind: 'words', text: part.text, at })
      } else if (part.kind === 'notice') out.push({ kind: 'notice', notice: part, at })
      else out.push({ kind: 'row', row: part, at })
    })
    return out
  })

  function drawn(text: string): string {
    const source = citationLinks(text, sources.length)
    return answerHtml(source, (link) => {
      const found = link.target
        ? links.targetOf(workspace.panelNote, { kind: 'wikilink', target: link.target })
        : null
      return found === null ? null : { href: found }
    })
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

  /** Ask again, and on its menu every model the provider has: claude.ai's and
   *  Raycast's way of comparing two answers. */
  function againMenu(event: MouseEvent) {
    const provider = chat.provider
    if (!provider) return
    const listed = chat.models[provider.id] ?? []
    const rows: MenuEntry[] = listed.map((one) => ({
      label: one.name,
      checked: one.id === chat.head?.model,
      run: () => chat.retry({ provider: provider.id, id: one.id }),
    }))
    if (rows.length) menu.show(event, rows, { title: t('Ask again') })
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
    }
  }

  const failed = $derived(
    turn.parts.some((part) => part.kind === 'notice' && part.code === 'error'),
  )
  const answered = $derived(!!words.trim())
</script>

<div class="answer" class:last>
  {#each blocks as block (block.at)}
    {#if block.kind === 'words'}
      <Answer html={drawn(block.text)} onfollow={follow} />
    {:else if block.kind === 'notice'}
      <p
        class="notice"
        class:wrong={block.notice.code === 'error'}
        class:model={block.notice.code === 'model'}
        in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
      >
        {noticeOf(block.notice)}
        {#if block.notice.code === 'error' && last && !live}
          <button class="link" onclick={() => chat.retry()}>{t('Ask again')}</button>
        {/if}
      </p>
    {:else}
      <div in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
        <PartRow part={block.row} {live} />
      </div>
    {/if}
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
        <button
          class="nib-glyph act"
          title={t('Save as a note')}
          aria-label={t('Save as a note')}
          onclick={() => void saveAsNote()}
        >
          <svg viewBox="0 0 13 13">
            <path
              d="M7.5 1.8H3.6a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1V4.7zM7.5 1.8v2.9h2.9M6.5 6.2v3.4M4.8 7.9h3.4"
            />
          </svg>
        </button>
      {/if}
      {#if last && ai.providers.length}
        <button
          class="nib-glyph act"
          title={t('Ask again')}
          aria-label={t('Ask again')}
          onclick={() => chat.retry()}
          oncontextmenu={againMenu}
        >
          <svg viewBox="0 0 13 13"><path d="M10.6 6.5a4.1 4.1 0 1 1-1.2-2.9M10.6 2v2.6H8" /></svg>
        </button>
      {/if}
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

  /* The last answer's under its words, always there. An earlier one's float over its
     top corner while it is pointed at, the way a chat's message tools do, so a long
     thread is neither a column of buttons nor a column of gaps where they hide. */
  .answer {
    position: relative;
  }

  .acts {
    gap: 0;
    margin-inline-start: -6px;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .answer:not(.last) .acts {
    position: absolute;
    top: -10px;
    inset-inline-end: 0;
    margin: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    opacity: 0;
    pointer-events: none;
  }

  .answer:not(.last):hover .acts,
  .answer:not(.last) .acts:focus-within {
    opacity: 1;
    pointer-events: auto;
  }

  :global([data-touch]) .answer:not(.last) .acts {
    position: static;
    border: 0;
    background: none;
    box-shadow: none;
    opacity: 1;
    pointer-events: auto;
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
