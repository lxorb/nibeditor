<script lang="ts">
  /** A thinking block or a tool call, as one folded row (docs/ai-sidebar.md 4.3): a
   *  verb and an object, "Thought · 6 s", "Read Herons", "Edited Birds +3 −2". Open, it
   *  shows what the provider summarised of the thinking, or the call's arguments and
   *  what it answered. A call still going pulses; one that asked the reader is a
   *  question with its two answers in place, the Activity panel's question here.
   *
   *  Folded by default because the answer is what was asked for; Ctrl+O opens them all
   *  (Claude Code's Focus view, the other way round). */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { i18n, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { workspace } from '../../workspace.svelte'
  import { insideSpace } from '../../space-paths'
  import type { Part } from '../chat/types'
  import { chat } from './chat.svelte'
  import { seconds } from './numbers'
  import { bareName, objectOf, verbOf } from './verbs'

  type Row = Extract<Part, { kind: 'thinking' | 'tool' }>
  const { part, live = false }: { part: Row; live?: boolean } = $props()

  let opened = $state(false)
  const open = $derived(opened || chat.unfolded)

  const verb = $derived.by(() => {
    if (part.kind === 'thinking') return t('Thought')
    const known = verbOf(part.verb)
    return known ? t(known) : bareName(part.verb)
  })

  const object = $derived(
    part.kind === 'thinking'
      ? part.ms
        ? seconds(part.ms, i18n.language)
        : ''
      : objectOf(part.args),
  )

  const going = $derived(live && (part.kind === 'thinking' ? !part.ms : part.state === 'running'))

  /** What the row opens to. */
  const detail = $derived.by(() => {
    if (part.kind === 'thinking') return part.text.trim()
    const args = JSON.stringify(part.args ?? {}, null, 2)
    const said = part.result?.text.trim() ?? ''
    return said ? `${args}\n\n${said}` : args
  })

  /** An edit's row opens the note it changed instead: the change is in the note. */
  async function press() {
    const change = part.kind === 'tool' ? part.change : undefined
    const root = workspace.activeSpace?.root
    if (change && root) {
      await workspace.open(insideSpace(root, change.path))
      return
    }
    opened = !opened
  }

  let answering = $state(false)
  async function answer(allow: boolean) {
    const approval = part.kind === 'tool' ? part.result?.approval : undefined
    if (!approval || answering) return
    answering = true
    await chat.approve(approval, allow)
  }
</script>

<div class="row" class:going class:failed={part.kind === 'tool' && part.state === 'error'}>
  <button class="line" aria-expanded={open} onclick={() => void press()}>
    <svg class="caret" class:open viewBox="0 0 13 13"><path d="M4.8 3.2l3.3 3.3-3.3 3.3" /></svg>
    <span class="verb">{verb}</span>
    {#if object}<span class="object">{object}</span>{/if}
    {#if part.kind === 'tool' && part.change}
      <span class="plus">+{part.change.added}</span>
      <span class="minus">−{part.change.removed}</span>
    {/if}
  </button>

  {#if part.kind === 'tool' && part.state === 'asking' && part.result?.approval}
    <div class="ask">
      {#if part.result.text}<p>{part.result.text}</p>{/if}
      <button class="nib-button" disabled={answering} onclick={() => void answer(true)}
        >{t('Allow')}</button
      >
      <button class="nib-button is-quiet" disabled={answering} onclick={() => void answer(false)}
        >{t('Don’t allow')}</button
      >
    </div>
  {/if}

  {#if open && detail}
    <pre class="detail" transition:slide={{ duration: dur(150), easing: cubicOut }}>{detail}</pre>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    margin-inline-start: -3px;
    padding: 1px 4px 1px 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .line:hover {
      color: var(--text);
    }
  }

  .caret {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .caret.open {
    transform: rotate(calc(var(--dir) * 90deg));
  }

  .verb {
    flex: none;
  }

  .object {
    min-width: 0;
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plus,
  .minus {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .plus {
    color: var(--success);
  }

  .minus {
    color: var(--danger);
  }

  /* A call on its way breathes rather than spins: something is happening, and nothing
     about it needs reading. */
  .going .verb {
    animation: breathe calc(var(--dur-slow) * 4) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .going .verb {
      animation: none;
    }
  }

  .failed .verb {
    color: var(--danger);
  }

  .detail {
    margin: 4px 0 2px 13px;
    padding: var(--space-2);
    max-height: 16rem;
    overflow: auto;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .ask {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 4px 0 2px 13px;
  }

  .ask p {
    flex-basis: 100%;
    margin: 0;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>
