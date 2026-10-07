<script lang="ts">
  /** Settings, Online terminal: the reader's machine - its state, Start and Stop - and the
   *  month's use as one bar per allowance (hours, CPU, home, the web), with the day it
   *  starts again (docs/online-terminal.md 4.9, 4.10). A bar turns amber past 80%, which
   *  is also when a tab's mark does.
   *
   *  A server of its own (4.15) has no allowance to meter: it is one line of what it is
   *  and costs a month, Restart in place of Stop, and its disk, the bar that matters,
   *  amber at 80% as every disk's is.
   *
   *  Fetched as it is opened, never before. */
  import { readableSize as bytes } from '../usage.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { diskNear, diskShare, shares } from '@nib/online'
  import { cityOf } from './calls'
  import { machine } from './machine.svelte'
  import { refusalWords } from './words'

  $effect(() => {
    void machine.refresh()
  })

  const known = $derived(machine.known)
  const state = $derived(known?.machine?.state ?? null)
  const awake = $derived(state === 'awake' || state === 'starting')
  const server = $derived(known?.machine?.host === 'hetzner')

  /** Gigabytes as Hetzner counts them, whole. */
  const gb = (value: number) => `${i18n.amount(Math.round(value))} GB`

  /** What the server is, where, and what it costs, one line:
   *  CX43 · Falkenstein · 8 vCPU · 16 GB · 160 GB · €16.49 a month. */
  const spec = $derived.by(() => {
    const about = known?.machine?.server
    if (!about) return null
    const parts = [
      about.type.toUpperCase(),
      ...(about.location ? [cityOf(about.location)] : []),
      t('{cores} vCPU', { cores: i18n.amount(about.cores) }),
      gb(about.memoryGb),
      gb(about.diskGb),
    ]
    if (about.price !== null && about.currency) {
      const price = new Intl.NumberFormat(i18n.language, {
        style: 'currency',
        currency: about.currency,
      }).format(about.price)
      parts.push(t('{price} a month', { price }))
    }
    return parts.join(' · ')
  })

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

  const disk = $derived(known?.machine?.disk ?? null)

  const diskMeter = $derived(
    disk
      ? [
          {
            label: t('Disk'),
            share: diskShare(disk),
            near: diskNear(disk),
            words: `${gb(disk.used / 1e9)} / ${gb(disk.total / 1e9)}`,
          },
        ]
      : [],
  )

  const meters = $derived(
    server
      ? diskMeter
      : known && share
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
            ...diskMeter,
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
          {#if spec}<small>{spec}</small>{/if}
        </span>
        <button
          class="nib-action"
          disabled={machine.busy || state === 'stopping' || (server && state === 'starting')}
          onclick={() => void machine.startStop(!awake)}
          >{awake ? (server ? t('Restart') : t('Stop')) : t('Start')}</button
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
      {#if known && !server}
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
