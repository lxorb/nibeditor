<script lang="ts">
  /** One agent: what it did, what it may reach, where, and what it asks first
   *  (docs/agent-native.md 9.1 to 9.6).
   *
   *  Chrome's page for one site and the Privacy pane of a Mac, which are the two places
   *  people already decide what something may do: a switch for each thing, grouped by
   *  what it reaches, and nothing on the page that is not a decision or a fact. What it
   *  did comes first, because that is what somebody opens an agent to find out after it
   *  has worked for an hour; the one sentence above it is the lethal trifecta (9.6),
   *  said where it is true and nowhere else.
   *
   *  Every change goes through `pane.change`, which writes it to what the crate holds
   *  (see pane.svelte.ts), so a switch here is the grant, not a copy of it. */
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import Cross from '../../Cross.svelte'
  import { i18n, t } from '../../i18n.svelte'
  import { prompt } from '../../prompt.svelte'
  import Select from '../../Select.svelte'
  import { workspace } from '../../workspace.svelte'
  import type { Category, Grant, Scope } from '../verbs'
  import AgentLog from './AgentLog.svelte'
  import AgentMark from './AgentMark.svelte'
  import {
    ASKS,
    LIMITS,
    LIMIT_NAMES,
    type Limit,
    SCOPE_GROUPS,
    askApplies,
    asks,
    reaches,
    sidebars,
    sitesOf,
    trifecta,
    withAsk,
    withEverySpace,
    withLimit,
    withListed,
    withMode,
    withName,
    withoutAlways,
    withScope,
    withSite,
    withSpace,
  } from './grant'
  import type { AgentsPane } from './pane.svelte'
  import { registrable, typedSite } from './sites'
  import Words from './Words.svelte'
  import { CATEGORY_WORDS, GROUP_WORDS, LIMIT_WORDS, RULE_WORDS, SCOPE_WORDS } from './words'

  const { pane, grant, onback }: { pane: AgentsPane; grant: Grant; onback: () => void } = $props()

  const change = (edit: (one: Grant) => Grant) => void pane.change(grant.id, edit)

  const spaceNames = $derived(workspace.spaces.map((one) => one.name))
  /** The spaces a switch is shown for: those there are, and any a grant still names. */
  const listedSpaces = $derived(
    grant.spaces === 'all'
      ? spaceNames
      : [...spaceNames, ...grant.spaces.filter((one) => !spaceNames.includes(one))],
  )

  const sites = $derived(sitesOf(grant))

  /** A chat said "Always in this chat" to, by its name: its id is what the grant keeps
   *  (`chat:<id>`). The chats' store is fetched only for a grant that has one. */
  let chatNames = $state.raw<Record<string, string>>({})
  $effect(() => {
    if (__EVEN_PLUGIN__ || !sites.some((one) => one.site.startsWith('chat:'))) return
    void import('../../chats/store.svelte').then(({ chats }) => {
      chatNames = Object.fromEntries(
        chats.list.map((one) => [`chat:${one.id}`, `#${one.name ?? one.id}`]),
      )
    })
  })
  const asked = $derived(ASKS.filter((one) => askApplies(grant, one.category)))
  const ruleChoices = $derived(
    (['allow', 'deny', 'agent-store'] as const).map((value) => ({
      value,
      label: RULE_WORDS[value](),
    })),
  )

  /** A typed address as the site it is about, the public suffix list fetched the first
   *  time it is asked. */
  const siteTyped = async (typed: string) => typedSite(typed, await registrable())

  /** A program as typed: its name, or the path to it. */
  const programTyped = (typed: string) => Promise.resolve(typed.trim() || null)

  /** A word added to one of the grant's lists, or taken from it. */
  const listing = (list: 'scripts' | 'programs', on: boolean) => (word: string) => {
    change((one) => withListed(one, list, word, on))
  }

  /** A site typed into the list of rules: blocked, unless it has a rule already. */
  function addSite(site: string) {
    change((one) => withSite(one, site, one.sites[site] ?? 'deny'))
  }

  function toggleScope(scope: Scope) {
    change((one) => withScope(one, scope, !one.scopes.includes(scope)))
  }

  function toggleAsk(category: Category) {
    change((one) => withAsk(one, category, !asks(one, category)))
  }

  async function remove() {
    const sure = await prompt.confirm({
      title: t('Remove {name}?', { name: grant.name }),
      detail: t('Its token stops working.'),
      confirmLabel: t('Remove'),
      danger: true,
    })
    if (!sure) return
    onback()
    await pane.remove(grant.id)
  }

  /** A row that is itself a switch: Space and Enter press it, as a button would. */
  function pressed(event: KeyboardEvent, then: () => void) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    then()
  }

  /** A slider being dragged: shown as it moves, and written once, where it is let go,
   *  rather than a write to the crate for every step of the drag. */
  let moving = $state<{ limit: Limit; value: number } | null>(null)

  const limitOf = (limit: Limit) => (moving?.limit === limit ? moving.value : grant.limits[limit])

  /** How much of a limit's track is filled, up to its thumb. */
  const fraction = (limit: Limit) =>
    ((limitOf(limit) - LIMITS[limit].min) / (LIMITS[limit].max - LIMITS[limit].min)) * 100
</script>

{#snippet toggle(label: string, on: boolean, flip: () => void)}
  <div
    class="nib-setting pressable"
    role="switch"
    tabindex="0"
    aria-checked={on}
    onclick={flip}
    onkeydown={(event) => {
      pressed(event, flip)
    }}
  >
    <span class="name">{label}</span>
    <span class="nib-switch" class:on aria-hidden="true"></span>
  </div>
{/snippet}

<header class="who">
  <button class="back" aria-label={t('Back')} title={t('Back')} onclick={onback}>
    <svg class="nib-mirror" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>
  <AgentMark name={grant.name} />
  <span class="name">
    <input
      class="title"
      value={grant.name}
      aria-label={t('Name')}
      spellcheck="false"
      autocomplete="off"
      onchange={(event) => {
        const name = event.currentTarget.value
        // A name cleared is the name it had: an agent is never nobody.
        if (!name.trim()) event.currentTarget.value = grant.name
        else change((one) => withName(one, name))
      }}
    />
    <small>
      {grant.client !== grant.name ? `${grant.client} · ` : ''}{t('Added {date}', {
        date: i18n.when(grant.created, { dateStyle: 'medium' }),
      })}
    </small>
  </span>
</header>

{#if trifecta(grant)}
  <p class="trifecta">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each TriangleAlert as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    {t(
      'It reads your notes and browses signed in as you, so a page could try to make it send them out.',
    )}
  </p>
{/if}

<h3>{t('Activity')}</h3>
<AgentLog {pane} {grant} />

{#each SCOPE_GROUPS as group (group.id)}
  <h3>{GROUP_WORDS[group.id]()}</h3>
  <div class="card">
    {#each group.scopes as scope (scope)}
      {@render toggle(SCOPE_WORDS[scope](), grant.scopes.includes(scope), () => {
        toggleScope(scope)
      })}
    {/each}
    {#if group.id === 'scripts' && grant.scopes.includes('browser.script')}
      <Words
        words={grant.scripts}
        placeholder={t('Add a site')}
        parse={siteTyped}
        onadd={listing('scripts', true)}
        onremove={listing('scripts', false)}
      />
    {/if}
    {#if group.id === 'terminal' && grant.scopes.includes('terminal')}
      <Words
        words={grant.programs}
        placeholder={t('Add a program')}
        parse={programTyped}
        onadd={listing('programs', true)}
        onremove={listing('programs', false)}
      />
    {/if}
  </div>
{/each}

<h3>{t('Spaces')}</h3>
<div class="card">
  {@render toggle(t('Every space'), grant.spaces === 'all', () => {
    change((one) => withEverySpace(one, one.spaces !== 'all', spaceNames))
  })}
  {#if grant.spaces !== 'all'}
    {#each listedSpaces as space (space)}
      {@render toggle(space, reaches(grant, space), () => {
        change((one) => withSpace(one, space, !reaches(one, space)))
      })}
    {/each}
  {/if}
</div>

<h3>{t('Sites')}</h3>
<div class="card">
  {#each sites as { site, rule, always } (site)}
    <div class="nib-setting site">
      <span class="name">
        <span class="what"><bdi>{chatNames[site] ?? site}</bdi></span>
        {#if always.length}
          <span class="always">
            {#each always as category (category)}
              <button
                class="said"
                title={t('Remove')}
                onclick={() => {
                  change((one) => withoutAlways(one, site, category))
                }}
              >
                {CATEGORY_WORDS[category]()}<Cross small />
              </button>
            {/each}
          </span>
        {/if}
      </span>
      {#if rule}
        <div class="pick">
          <Select
            value={rule}
            options={ruleChoices}
            label={site}
            onchange={(value: string) => {
              const chosen = ruleChoices.find((one) => one.value === value)?.value
              if (chosen) change((one) => withSite(one, site, chosen))
            }}
          />
        </div>
        <button
          class="drop"
          aria-label={t('Remove')}
          title={t('Remove')}
          onclick={() => {
            change((one) => withSite(one, site, null))
          }}
        >
          <Cross />
        </button>
      {/if}
    </div>
  {/each}
  <Words
    words={[]}
    placeholder={t('Add a site')}
    parse={siteTyped}
    onadd={addSite}
    onremove={() => undefined}
  />
</div>

{#if !sidebars(grant)}
  <h3>{t('Asks first')}</h3>
  <div class="card">
    {@render toggle(CATEGORY_WORDS.writing(), grant.mode === 'confirm', () => {
      change((one) => withMode(one, one.mode !== 'confirm'))
    })}
    {#each asked as { category } (category)}
      {@render toggle(CATEGORY_WORDS[category](), asks(grant, category), () => {
        toggleAsk(category)
      })}
    {/each}
  </div>
{/if}

<h3>{t('Limits')}</h3>
<div class="card">
  {#each LIMIT_NAMES as limit (limit)}
    <div class="nib-setting sliding">
      <span class="name">{LIMIT_WORDS[limit]()}</span>
      <span class="value">{limitOf(limit)}</span>
      <input
        class="slider nib-slider"
        type="range"
        min={LIMITS[limit].min}
        max={LIMITS[limit].max}
        step={LIMITS[limit].step}
        value={limitOf(limit)}
        aria-label={LIMIT_WORDS[limit]()}
        style:--fill="{fraction(limit)}%"
        oninput={(event) => {
          moving = { limit, value: Number(event.currentTarget.value) }
        }}
        onchange={(event) => {
          const value = Number(event.currentTarget.value)
          moving = null
          change((one) => withLimit(one, limit, value))
        }}
      />
    </div>
  {/each}
</div>

<div class="card">
  <button class="nib-action is-danger" onclick={() => void remove()}>{t('Remove')}</button>
</div>

<style>
  /* Back to the list, in front of the agent it leaves, as a phone's bar has it: the
     pane's own title stays above, so this is a step rather than a heading. */
  .back {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-inline-start: -6px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .back svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .back:hover {
      color: var(--text-strong);
    }
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .who .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .who small {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* The name is written where it is read, as a space's is renamed in place. */
  .title {
    width: 100%;
    margin-inline-start: -7px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .title:hover {
      border-color: var(--line);
    }
  }

  .title:focus {
    background: var(--bg);
  }

  /* The one warning on the page, in the colour a callout warns in. */
  .trifecta {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--callout-warning);
  }

  .trifecta svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    margin-block-start: 1px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A site's name, and under it the questions allowed there for good, each the
     button that takes it back: Claude in Chrome's approved sites. */
  .always {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-block-start: 2px;
  }

  .said {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0 0.5em;
    border: none;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .said:hover {
      background: var(--danger-soft);
      color: var(--danger);
    }
  }

  .pick {
    flex: none;
    width: 12rem;
  }

  .drop {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .drop :global(svg) {
    width: 12px;
    height: 12px;
    stroke-width: 1.5;
  }

  .said :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  @media (hover: hover) {
    .drop:hover {
      color: var(--danger);
    }
  }

  .value {
    flex: none;
    width: 3.5rem;
    text-align: end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .slider {
    width: 11rem;
  }
</style>
