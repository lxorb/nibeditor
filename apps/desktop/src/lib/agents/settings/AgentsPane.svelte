<script lang="ts">
  /** Settings > Agents: every agent, what it may do, and what it did
   *  (docs/agent-native.md 9.1, 9.5, 10).
   *
   *  The list first - each agent's mark, its name, when it last did something - and a
   *  row opens the agent. Under the list, how to connect one more: the line that gives a
   *  client `nib mcp` on this machine, and a token for one somewhere else. At the foot,
   *  the other half: the account's connector in LLM access reaches the notes from
   *  anywhere, and this pane is everything on this computer, so each pane leads to the
   *  other.
   *
   *  Fetched when the pane is opened, never before: nothing of agents is in the first
   *  paint (weight.test.ts). The crate is the real one on a desktop and the stand-in a
   *  drive puts in front of it anywhere else; see reach.svelte.ts. */
  import { account } from '../../account.svelte'
  import { i18n, t } from '../../i18n.svelte'
  import { settings } from '../../settings.svelte'
  import { arrive } from '../../slide'
  import AddAgent from './AddAgent.svelte'
  import AgentDetail from './AgentDetail.svelte'
  import AgentMark from './AgentMark.svelte'
  import { tauriCrate } from './crate'
  import { AgentsPane } from './pane.svelte'
  import { reach } from './reach.svelte'

  const pane = new AgentsPane(reach.standIn ?? tauriCrate)

  $effect(() => {
    void pane.open()
    return () => {
      pane.close()
    }
  })

  let chosen = $state<string | null>(null)
  const agent = $derived(pane.grants.find((one) => one.id === chosen) ?? null)

  /** The one somebody used last at the top, and those never used by when they came. */
  const listed = $derived(
    [...pane.grants].sort(
      (a, b) => (pane.last.get(b.id) ?? 0) - (pane.last.get(a.id) ?? 0) || a.created - b.created,
    ),
  )

  /** What the account's connector says about a client, said the same way here. */
  const used = (id: string) => {
    const at = pane.last.get(id)
    return at === undefined
      ? t('Not used yet.')
      : t('Last used {time}.', {
          time: i18n.when(at, { dateStyle: 'short', timeStyle: 'medium' }),
        })
  }
</script>

<div class="agents">
  {#key agent?.id}
    <div class="page" in:arrive>
      {#if agent}
        <AgentDetail {pane} grant={agent} onback={() => (chosen = null)} />
      {:else}
        {#if listed.length}
          <div class="card">
            {#each listed as grant (grant.id)}
              <button class="nib-setting agent" onclick={() => (chosen = grant.id)}>
                <AgentMark name={grant.name} />
                <span class="name">
                  {grant.name}
                  <small>
                    {grant.client !== grant.name ? `${grant.client} · ` : ''}{used(grant.id)}
                  </small>
                </span>
                <svg class="chevron nib-mirror" viewBox="0 0 16 16" aria-hidden="true"
                  ><path d="M6 3l5 5-5 5" /></svg
                >
              </button>
            {/each}
          </div>
        {/if}

        {#if pane.ready}
          <AddAgent {pane} />
        {/if}

        {#if account.user}
          <button class="link" onclick={() => (settings.section = 'llm')}>
            {t('Your account’s connector')}
            <svg class="chevron nib-mirror" viewBox="0 0 16 16" aria-hidden="true"
              ><path d="M6 3l5 5-5 5" /></svg
            >
          </button>
        {/if}
      {/if}

      {#if pane.error}
        <p class="hint bad">{pane.error}</p>
      {/if}
    </div>
  {/key}
</div>

<style>
  /* The settings pane's own shapes, for every part of this one. A section in its own
     component does not inherit the panel's rules - those are scoped to it - so they are
     said once here, with the panel's values, for the components inside: the list, one
     agent, its log and the way to add one. See SettingsPanel.svelte. */
  .agents,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .agents :global(h3) {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  /* A run of rows. */
  .agents :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .agents :global(.nib-setting .name) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .agents :global(.nib-setting .name small) {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .agents :global(.chevron) {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .agents :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .agents :global(.hint.bad) {
    color: var(--danger);
  }

  /* A row that is itself a control: it shows what it does when pointed at. */
  @media (hover: hover) {
    .agents :global(button.nib-setting:hover),
    .agents :global(.nib-setting.pressable:hover) {
      color: var(--text-strong);
    }
  }

  .agents :global(button.nib-setting:focus-visible),
  .agents :global(.nib-setting.pressable:focus-visible) {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* To the other half, in the accent, as a link inside the settings leads. */
  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .link .chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
  }

  @media (hover: hover) {
    .link:hover {
      color: var(--accent-hover);
    }
  }
</style>
