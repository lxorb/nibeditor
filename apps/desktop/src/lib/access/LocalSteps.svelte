<script lang="ts">
  /** How one more agent is connected (docs/agent-native.md 9.1, 10).
   *
   *  On this machine a client is given one line: nib's own program as its MCP server,
   *  `nib mcp`, which asks the reader once, the first time it connects, and is remembered
   *  after. The line is the client's own way of adding a server - Claude Code's, Codex's,
   *  or the JSON entry the rest take from a file - with the path of the program that is
   *  installed here, so it is pasted and not edited.
   *
   *  A client somewhere else, or a script, is given a token instead, made here by hand
   *  with somebody else's defaults and shown the once, as GitHub shows one: nib keeps only
   *  its hash. The same fold as the account connector's Show config, because it is the
   *  same second road for the same reader. */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Copyable from '../../Copyable.svelte'
  import CopyButton from '../../CopyButton.svelte'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { segmented } from '../../slide'
  import { type McpClient, mcpLine } from '../mcp'
  import type { AgentsPane } from './pane.svelte'

  const { pane }: { pane: AgentsPane } = $props()

  const CLIENTS = $derived<{ id: McpClient; label: string }[]>([
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'json', label: t('Other') },
  ])

  let client = $state<McpClient>('claude')
  let making = $state(false)
  let name = $state('')

  const line = $derived(pane.program === null ? null : mcpLine(pane.program, client))

  /** Opens the fold, or closes it and the token with it: shown once means gone once it
   *  is put away, and the fold then makes the next one. */
  function fold() {
    making = !making
    if (making) return
    pane.minted = null
    name = ''
  }
</script>

<h3>{pane.grants.length ? t('Connect another') : t('Connect')}</h3>

<div class="nib-segmented" role="tablist" use:segmented>
  {#each CLIENTS as one (one.id)}
    <button
      role="tab"
      class:on={client === one.id}
      aria-selected={client === one.id}
      onclick={() => (client = one.id)}
    >
      {one.label}
    </button>
  {/each}
</div>

{#if line !== null}
  {#if client === 'json'}
    <pre>{line}</pre>
    <CopyButton value={line} wide />
  {:else}
    <Copyable label={t('Command')} value={line} />
  {/if}
  <p class="hint">{t('nibeditor asks you once, the first time it connects.')}</p>
{/if}

<button class="disclose" aria-expanded={making} onclick={fold}>
  <svg class="chevron nib-mirror" class:open={making} viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M6 3l5 5-5 5" /></svg
  >
  {t('A client on another machine?')}
</button>

{#if making}
  <div class="made" transition:slide={{ duration: dur(180), easing: cubicOut }}>
    {#if pane.minted}
      <Copyable value={pane.minted.token} />
      <p class="hint">{t('Shown only once.')}</p>
    {:else}
      <form
        class="make"
        onsubmit={(event) => {
          event.preventDefault()
          void pane.mint(name)
        }}
      >
        <input
          class="named"
          bind:value={name}
          placeholder={t('Name')}
          aria-label={t('Name')}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="nib-chip" type="submit" disabled={!name.trim()}>{t('Create a token')}</button
        >
      </form>
    {/if}
  </div>
{/if}

<style>
  pre {
    width: 100%;
    margin: 0;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-x: auto;
    color: var(--muted-strong);
  }

  /* The fold, as the account connector's: a chevron that turns, and the words beside
     it. See McpSetup.svelte. */
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .disclose:hover {
      color: var(--text-strong);
    }
  }

  .disclose:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .disclose .chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    transform: scaleX(var(--dir));
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .disclose .chevron.open {
    transform: scaleX(var(--dir)) rotate(90deg);
  }

  .made {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline-start: 17px;
  }

  .make {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .named {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .named::placeholder {
    color: var(--muted);
  }

  .named:focus {
    background: var(--bg);
  }
</style>
