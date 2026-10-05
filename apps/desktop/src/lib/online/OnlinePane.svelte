<script lang="ts">
  /** Settings, Online terminal: the reader's machine - its state, Start and Stop - and the
   *  month's use as one bar per allowance (hours, CPU, home, the web), with the day it
   *  starts again (docs/online-terminal.md 4.9, 4.10). A bar turns amber past 80%, which
   *  is also when a tab's mark does.
   *
   *  Fetched as it is opened, never before. */
  import { readableSize as bytes } from '../usage.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { shares } from '@nib/online'
  import { machine } from './machine.svelte'
  import { refusalWords } from './words'

  $effect(() => {
    void machine.refresh()
  })

  const known = $derived(machine.known)
  const state = $derived(known?.machine?.state ?? null)
  const awake = $derived(state === 'awake' || state === 'starting')

  const stateWords = $derived(
    state === 'awake'
      ? t('Awake')
      : state === 'starting'
        ? t('Starting')
        : state === 'stopping'
          ? t('Stopping')
          : t('Asleep'),
  )

  /** Hours, from seconds, to one place. */
  const hours = (seconds: number) =>
    i18n.amount(Math.round(seconds / (seconds < 36_000 ? 360 : 3600)) / (seconds < 36_000 ? 10 : 1))

  const share = $derived(known ? shares(known.used, known.limit) : null)

  const meters = $derived(
    known && share
      ? [
          {
            label: t('Hours'),
            share: share.awakeS,
            near: machine.near,
            words: `${hours(known.used.awakeS)} / ${hours(known.limit.awakeS)} h`,
          },
          {
            label: t('CPU'),
            share: share.cpuS,
            near: false,
            words: `${hours(known.used.cpuS)} / ${hours(known.limit.cpuS)} h`,
          },
          {
            label: t('Home'),
            share: share.homeBytes,
            near: false,
            words: `${bytes(known.used.homeBytes)} / ${bytes(known.limit.homeBytes)}`,
          },
          {
            label: t('Web'),
            share: share.egressBytes,
            near: false,
            words: `${bytes(known.used.egressBytes)} / ${bytes(known.limit.egressBytes)}`,
          },
        ]
      : [],
  )

  const refusal = $derived(
    machine.known?.allowed === false
      ? refusalWords('list')
      : machine.refused
        ? refusalWords(machine.refused)
        : null,
  )
</script>

<div class="online">
  {#if known?.machine}
    <div class="card">
      <div class="nib-setting">
        <span class="name">
          {t('Machine')}
          <small>{stateWords}</small>
        </span>
        <button
          class="nib-action"
          disabled={machine.busy || state === 'stopping'}
          onclick={() => void machine.startStop(!awake)}>{awake ? t('Stop') : t('Start')}</button
        >
      </div>
    </div>
  {/if}

  {#if meters.length}
    <div class="card meters">
      {#each meters as meter (meter.label)}
        <div class="meter" class:is-near={meter.near}>
          <div class="line">
            <span>{meter.label}</span>
            <span class="words">{meter.words}</span>
          </div>
          <div
            class="track"
            role="meter"
            aria-label={meter.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(meter.share * 100)}
          >
            <div class="fill" style:width={`${meter.share * 100}%`}></div>
          </div>
        </div>
      {/each}
      {#if known}
        <p class="hint">
          {t('Starts again {date}', { date: i18n.when(known.resets, { dateStyle: 'medium' }) })}
        </p>
      {/if}
    </div>
  {/if}

  {#if refusal}
    <p class="hint">{refusal}</p>
  {/if}
</div>

<style>
  .online {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .meters {
    gap: var(--space-3);
  }

  .meter {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .words {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* A thin bar on a recessive track, its end rounded: the month so far. */
  .track {
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
  }

  /* Near the month's end of it: the amber a tab's mark wears too. */
  .is-near .fill {
    background: var(--callout-warning);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
</style>
