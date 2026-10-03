<script lang="ts">
  /** One host, in Settings, Remote: its name and where it is, its colour, its group and
   *  its pin.
   *
   *  A host of the ssh config shows its name and address as the config has them and
   *  nothing to type into: the config is the reader's own file, which nib never writes
   *  (VS Code's Add host writing a block in front of the reader's own is the complaint
   *  this avoids), so Open config is how those change. A host made here is nib's, and
   *  its name and address are fields. Every change is written as it is made; see
   *  hosts.svelte.ts. */
  import { t } from '../i18n.svelte'
  import { prompt } from '../prompt.svelte'
  import Select from '../Select.svelte'
  import Swatches from '../Swatches.svelte'
  import { invoke } from '../tauri'
  import HostMark from './HostMark.svelte'
  import {
    type About,
    type Change,
    COLOURS,
    destinationOf,
    groupsOf,
    type Host,
    said,
    withAbout,
    withOwn,
    withoutOwn,
  } from './hosts'
  import { remote } from './hosts.svelte'

  const { host, onback }: { host: Host; onback: () => void } = $props()

  const about = (change: Change<About>) =>
    void remote.keep((kept) => withAbout(kept, host.id, change))

  /** The value of the Group control that makes a new group rather than choosing one. */
  const NEW = '\u0000new'

  const groups = $derived(groupsOf(remote.hosts, remote.kept))
  const groupChoices = $derived([
    { value: '', label: t('No group') },
    ...groups.map((group) => ({ value: group, label: group })),
    { value: NEW, label: t('New group') },
  ])

  async function grouped(value: string) {
    if (value !== NEW) {
      about({ group: value || undefined })
      return
    }
    const named = await prompt.ask({ title: t('New group'), confirmLabel: t('Add') })
    if (named?.trim()) about({ group: named.trim() })
  }

  const colours = $derived([
    { value: '', label: t('No colour'), colour: 'var(--line-strong)' },
    ...COLOURS.map((one) => ({
      value: one,
      label: t('Colour {number}', { number: one }),
      colour: `var(--canvas-${one})`,
    })),
  ])

  let problem = $state('')

  /** Where a host made here is, as typed: kept only where it reads as a destination. */
  function placed(typed: string, field: HTMLInputElement) {
    const wanted = destinationOf(typed)
    if (!wanted) {
      problem = t('Not an address')
      field.value = host.detail ?? host.hostname ?? ''
      return
    }
    problem = ''
    void remote.keep((kept) =>
      withOwn(kept, host.id, {
        hostname: wanted.hostname,
        user: wanted.user ?? undefined,
        port: wanted.port ?? undefined,
      }),
    )
  }

  function renamed(typed: string, field: HTMLInputElement) {
    // A host is never nobody: a name cleared is the name it had.
    if (!typed.trim()) field.value = host.name
    else void remote.keep((kept) => withOwn(kept, host.id, { name: typed.trim() }))
  }

  async function remove() {
    const sure = await prompt.confirm({ title: host.name, confirmLabel: t('Remove'), danger: true })
    if (!sure) return
    onback()
    await remote.keep((kept) => withoutOwn(kept, host.id))
  }

  /** Space or Enter on a row that is a switch. */
  function pressed(event: KeyboardEvent, then: () => void) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    then()
  }
</script>

<header class="who">
  <button class="back" aria-label={t('Back')} title={t('Back')} onclick={onback}>
    <svg class="nib-mirror" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>
  <HostMark colour={host.colour} />
  <span class="name">
    {#if host.own}
      <input
        class="title"
        value={host.name}
        aria-label={t('Name')}
        spellcheck="false"
        autocomplete="off"
        onchange={(event) => renamed(event.currentTarget.value, event.currentTarget)}
      />
    {:else}
      <span class="title">{host.name}</span>
    {/if}
  </span>
</header>

<div class="card">
  <label class="nib-setting">
    <span class="name">{t('Address')}</span>
    {#if host.own}
      <input
        class="field"
        value={host.hostname
          ? said({ user: host.user, hostname: host.hostname, port: host.port })
          : ''}
        aria-label={t('Address')}
        spellcheck="false"
        autocomplete="off"
        onchange={(event) => placed(event.currentTarget.value, event.currentTarget)}
      />
    {:else}
      <span class="value">{host.detail ?? host.name}</span>
    {/if}
  </label>

  <div class="nib-setting">
    <span class="name">{t('Colour')}</span>
    <Swatches
      options={colours}
      label={t('Colour')}
      chosen={host.colour ?? ''}
      onchoose={(value: string) => about({ colour: (value || undefined) as About['colour'] })}
    />
  </div>

  <div class="nib-setting">
    <span class="name">{t('Group')}</span>
    <Select
      plain
      label={t('Group')}
      value={host.group ?? ''}
      options={groupChoices}
      onchange={(value: string) => void grouped(value)}
    />
  </div>

  <div
    class="nib-setting pressable"
    role="switch"
    tabindex="0"
    aria-checked={host.pinned}
    onclick={() => about({ pinned: !host.pinned })}
    onkeydown={(event) => pressed(event, () => about({ pinned: !host.pinned }))}
  >
    <span class="name">{t('Pin')}</span>
    <span class="nib-switch" class:on={host.pinned} aria-hidden="true"></span>
  </div>
</div>

{#if problem}
  <p class="hint bad">{problem}</p>
{/if}

<div class="card">
  {#if host.own}
    <button class="nib-action is-danger" onclick={() => void remove()}>{t('Remove')}</button>
  {:else if remote.file}
    <button
      class="nib-action"
      onclick={() => void invoke('remote_config_open').catch(() => undefined)}
      >{t('Open config')}</button
    >
  {/if}
</div>

<style>
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .who .name {
    flex: 1;
    min-width: 0;
  }

  /* Back to the list, as a host's page in Agents has it. */
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

  /* The name, in the type a pane's own title is set in; a field only where it can
     change. */
  .title {
    display: block;
    width: 100%;
    padding: 2px 0;
    border: none;
    border-bottom: 1px solid transparent;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  input.title:focus {
    border-bottom-color: var(--accent);
  }

  .field {
    flex: none;
    width: 14rem;
    max-width: 55%;
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .field:focus {
    border-color: var(--accent);
  }

  .value {
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>
