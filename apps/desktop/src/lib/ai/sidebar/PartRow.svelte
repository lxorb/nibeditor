<script lang="ts">
  /** A thinking block or a tool call, as one folded step (docs/ai-sidebar.md 4.3): a
   *  verb and an object, "Thought 6s", "Read Herons", "Ran pnpm test", "Edited Birds
   *  +3 −2". Open, it shows what the provider summarised of the thinking, a command's
   *  output, or the call's arguments and what it answered. A call still going breathes;
   *  one waiting for the reader is the question with its answers in place
   *  (review/Approval.svelte).
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
  import Approval from '../review/Approval.svelte'
  import { chat } from './chat.svelte'
  import { seconds } from './numbers'
  import StepLine from './StepLine.svelte'
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

  /** A command run: its words in the code face, and its row opens to what it said. */
  const command = $derived(part.kind === 'tool' && verbOf(part.verb) === 'Ran')

  /** What the row opens to: the summary of the thinking; a command's output after it,
   *  as a terminal shows it; any other call's arguments and what it answered. */
  const detail = $derived.by(() => {
    if (part.kind === 'thinking') return part.text.trim()
    const said = part.result?.text.trim() ?? ''
    if (command) return said ? `$ ${object}\n${said}` : `$ ${object}`
    const args = JSON.stringify(part.args ?? {}, null, 2)
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
</script>

<div class="row">
  <StepLine
    {verb}
    {object}
    {open}
    {going}
    failed={part.kind === 'tool' && part.state === 'error'}
    code={command}
    change={part.kind === 'tool' ? part.change : undefined}
    onpress={() => void press()}
  />

  {#if part.kind === 'tool' && part.state === 'asking' && part.result?.approval}
    <Approval {part} thread={chat.thread} />
  {/if}

  {#if open && detail}
    <pre
      class="detail"
      class:said={command}
      transition:slide={{ duration: dur(150), easing: cubicOut }}>{detail}</pre>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    min-width: 0;
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

  /* A command's output, Codex's: the terminal's own words, under a hairline. */
  .detail.said {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
  }
</style>
