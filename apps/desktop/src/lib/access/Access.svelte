<script lang="ts">
  /** Settings > AI > Access: everything that can reach the notes, in one list, and one
   *  way to connect one more (docs/agent-native.md 9.1, 9.5, 10; docs/ai.md).
   *
   *  Settings used to split this by plumbing - Agents for what reaches nib on this
   *  computer through `nib mcp`, LLM access for what reaches the account's notes through
   *  its connector - and the reader had to know which road a client took to find it. So
   *  both are rows of one list: an agent on this computer opens its grant (what it may
   *  do, its sites, what it asks, what it did), a connected app says what it reaches and
   *  can be disconnected. Under the list, Connect: one chooser over both roads, each way
   *  only where it applies (choices.ts).
   *
   *  Fetched when Settings > AI is opened, never before: nothing of the agents is in the
   *  first paint (weight.test.ts). The crate is the real one on a desktop and the
   *  stand-in a drive puts in front of it anywhere else; see reach.svelte.ts. */
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { account } from '../account.svelte'
  import AgentDetail from '../agents/settings/AgentDetail.svelte'
  import AgentMark from '../agents/settings/AgentMark.svelte'
  import { tauriCrate } from '../agents/settings/crate'
  import { AgentsPane } from '../agents/settings/pane.svelte'
  import { reach } from '../agents/settings/reach.svelte'
  import { connectors } from '../connectors.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { arrive, segmented } from '../slide'
  import { keep, storedText } from '../stored'
  import AccountSteps from './AccountSteps.svelte'
  import { type Choice, choices, shownFirst, viaAccount } from './choices'
  import LocalSteps from './LocalSteps.svelte'

  /** Told whether an agent's grant is open, which the page shows instead of its accounts. */
  const { ondetail }: { ondetail?: (open: boolean) => void } = $props()

  /** Which way in was looked at last; people have one. */
  const CHOICE_KEY = 'nib:access-choice'

  const local = !__EVEN_PLUGIN__ && reach.offered
  const pane = local ? new AgentsPane(reach.standIn ?? tauriCrate) : null

  $effect(() => {
    if (!pane) return
    void pane.open()
    return () => {
      pane.close()
    }
  })

  // Kept fresh while the page shows: the moment a client has signed in, it is in the list
  // without anyone reloading anything.
  $effect(() => {
    if (!account.user) return
    return connectors.watch()
  })

  let chosen = $state<string | null>(null)
  const agent = $derived(pane?.grants.find((one) => one.id === chosen) ?? null)
  $effect(() => {
    ondetail?.(agent !== null)
  })

  /** The one somebody used last at the top, and those never used by when they came. */
  const listed = $derived(
    pane
      ? [...pane.grants].sort(
          (a, b) =>
            (pane.last.get(b.id) ?? 0) - (pane.last.get(a.id) ?? 0) || a.created - b.created,
        )
      : [],
  )

  const offered = $derived(choices(local, !!account.user))
  let picked = $state<Choice | null>(null)
  const choice = $derived(picked ?? shownFirst(offered, storedText(CHOICE_KEY)))

  /** The ways, as their tabs read: products' names, and Other. */
  const LABELS: Record<Choice, () => string> = {
    'claude-code': () => 'Claude Code',
    codex: () => 'Codex',
    claude: () => 'Claude',
    chatgpt: () => 'ChatGPT',
    other: () => t('Other'),
  }

  function pick(one: Choice) {
    picked = one
    keep(CHOICE_KEY, one)
  }

  const when = (at: number | null | undefined) =>
    at === null || at === undefined
      ? t('Not used yet.')
      : t('Last used {time}.', {
          time: i18n.when(at, { dateStyle: 'short', timeStyle: 'medium' }),
        })

  const access = (readOnly: boolean) =>
    readOnly ? t('Reads your notes.') : t('Reads and writes your notes.')

  const anything = $derived(
    listed.length > 0 ||
      (!!account.user && (connectors.clients.length > 0 || !!connectors.token?.exists)),
  )

  let root = $state<HTMLElement>()

  // Opened at Access - an old link to Agents or LLM access, `/mcp` - the page lands here.
  onMount(() => {
    if (settings.at !== 'access') return
    settings.at = null
    requestAnimationFrame(() => root?.scrollIntoView({ block: 'start' }))
  })
</script>

<div class="agents" bind:this={root}>
  {#key agent?.id}
    <div class="page" in:arrive>
      {#if agent && pane}
        <AgentDetail {pane} grant={agent} onback={() => (chosen = null)} />
      {:else}
        <h3>{t('Access')}</h3>
        {#if anything}
          <div class="card">
            {#each listed as grant (grant.id)}
              <button class="nib-setting agent" onclick={() => (chosen = grant.id)}>
                <AgentMark name={grant.name} />
                <span class="name">
                  {grant.name}
                  <small>
                    {grant.client !== grant.name ? `${grant.client} · ` : ''}{when(
                      pane?.last.get(grant.id),
                    )}
                  </small>
                </span>
                <svg class="chevron nib-mirror" viewBox="0 0 16 16" aria-hidden="true"
                  ><path d="M6 3l5 5-5 5" /></svg
                >
              </button>
            {/each}

            {#if account.user}
              {#each connectors.clients as one (one.id)}
                <div
                  class="nib-setting connected"
                  transition:slide={{ duration: dur(180), easing: cubicOut }}
                >
                  <AgentMark name={one.name} />
                  <span class="name">
                    {one.name}
                    <small>{access(one.readOnly)} {when(one.lastUsedAt)}</small>
                  </span>
                  <button class="nib-chip is-quiet" onclick={() => connectors.disconnect(one.id)}>
                    {t('Disconnect')}
                  </button>
                </div>
              {/each}

              {#if connectors.token?.exists}
                <div
                  class="nib-setting connected"
                  transition:slide={{ duration: dur(180), easing: cubicOut }}
                >
                  <AgentMark name={t('Pasted token')} />
                  <span class="name">
                    {t('Pasted token')}
                    <small
                      >{access(connectors.token.readOnly)}
                      {when(connectors.token.lastUsedAt)}</small
                    >
                  </span>
                  <button
                    class="nib-chip is-quiet"
                    disabled={connectors.busy}
                    onclick={() => connectors.revokeToken()}
                  >
                    {t('Revoke')}
                  </button>
                </div>
              {/if}
            {/if}
          </div>
        {/if}

        {#if choice && (!local || pane?.ready)}
          <h3>{anything ? t('Connect another') : t('Connect')}</h3>
          <div class="nib-segmented" role="tablist" use:segmented>
            {#each offered as one (one)}
              <button
                role="tab"
                class:on={choice === one}
                aria-selected={choice === one}
                onclick={() => pick(one)}
              >
                {LABELS[one]()}
              </button>
            {/each}
          </div>

          {#if pane && (choice === 'claude-code' || choice === 'codex' || choice === 'other')}
            <LocalSteps {pane} client={choice} />
          {/if}
          {#if account.user && (viaAccount(choice) || choice === 'other')}
            <AccountSteps client={viaAccount(choice) ? choice : 'other'} />
          {/if}
        {/if}
      {/if}

      {#if pane?.error}
        <p class="hint bad">{pane.error}</p>
      {/if}
    </div>
  {/key}
</div>

<style>
  /* The page's own shapes, for every part of it. A component does not inherit the
     panel's rules - those are scoped to it - so they are said once here, with the
     panel's values, for the components inside: the list, one agent, its log and the
     ways to connect. See SettingsPanel.svelte. */
  .agents,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .agents {
    margin-top: var(--space-4);
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
</style>
