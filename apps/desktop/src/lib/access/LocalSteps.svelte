<script lang="ts">
  /** How an agent on this computer is connected (docs/agent-native.md 9.1, 10), for one
   *  way in of Settings > AI > Access.
   *
   *  A client is given one line: nib's own program as its MCP server, `nib mcp`, which
   *  asks the reader once, the first time it connects, and is remembered after. The line
   *  is the client's own way of adding a server - Claude Code's, Codex's, or the JSON
   *  entry the rest take from a file - with the path of the program that is installed
   *  here, so it is pasted and not edited.
   *
   *  A client somewhere else, or a script, is given a token instead, under Other: made
   *  here by hand with somebody else's defaults and shown the once, as GitHub shows one;
   *  nib keeps only its hash. */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Copyable from '../Copyable.svelte'
  import CopyButton from '../CopyButton.svelte'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { type McpClient, mcpLine } from '../agents/mcp'
  import type { AgentsPane } from '../agents/settings/pane.svelte'

  const { pane, client }: { pane: AgentsPane; client: 'claude-code' | 'codex' | 'other' } = $props()

  /** Each way's line, in the words `mcpLine` writes it in: Other is the entry a client
   *  takes from a file. */
  const lineOf = (way: typeof client): McpClient =>
    way === 'claude-code' ? 'claude' : way === 'codex' ? 'codex' : 'json'

  let making = $state(false)
  let name = $state('')

  const line = $derived(pane.program === null ? null : mcpLine(pane.program, lineOf(client)))

  /** Opens the fold, or closes it and the token with it: shown once means gone once it
   *  is put away, and the fold then makes the next one. */
  function fold() {
    making = !making
    if (making) return
    pane.minted = null
    name = ''
  }
</script>

{#if line !== null}
  {#if client === 'other'}
    <pre>{line}</pre>
    <CopyButton value={line} wide />
  {:else}
    <Copyable label={t('Command')} value={line} />
  {/if}
  <p class="hint">{t('nibeditor asks you once, the first time it connects.')}</p>
{/if}

{#if client === 'other'}
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
          <button class="nib-chip" type="submit" disabled={!name.trim()}
            >{t('Create a token')}</button
          >
        </form>
      {/if}
    </div>
  {/if}
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
     it. See AccountSteps.svelte. */
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
