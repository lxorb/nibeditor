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
   *  Laid out as every other pane is. The machine is one row of settings: its name and
   *  what it is on the left, and at the end what it is doing beside what can be done
   *  about it, as the AI pane's account rows are. The bars are a card of their own, with
   *  the day they start again under it.
   *
   *  Under the machine, every session on it, a tab open on it or not, one row each: what
   *  runs in it, the file's name and when it last printed, and at the end Open (its tab,
   *  or a new one) and End, which ends its program and asks first as every ending does.
   *  The list follows sessions made and ended on any device (sessions.svelte.ts).
   *
   *  Fetched as it is opened, never before. */
  import { i18n, t } from '../i18n.svelte'
  import { diskNear, diskShare, shares } from '@nib/online'
  import { prompt } from '../prompt.svelte'
  import { settings } from '../settings.svelte'
  import { within } from '../space-paths'
  import { runner } from '../sync2/runner.svelte'
  import { workspace } from '../workspace.svelte'
  import { cityOf } from './calls'
  import { opens, rowsOf, type SessionRow } from './listing'
  import { machine } from './machine.svelte'
  import { sessions } from './sessions.svelte'
  import { refusalWords } from './words'

  $effect(() => {
    void machine.refresh()
  })

  $effect(() => {
    void sessions.refresh()
    return sessions.watch()
  })

  const rows = $derived(rowsOf(sessions.list ?? []))

  /** Where Open goes for each session: its file on this disk, or nowhere - a file in the
   *  trash, in a space this device does not sync, or no file at all. */
  const files = $derived(
    new Map(
      (sessions.list ?? []).map((one) => [
        one.session,
        one.term !== null && opens(one) ? runner.fileOf(one.term) : null,
      ]),
    ),
  )

  const when = (stamp: number) => i18n.when(stamp, { dateStyle: 'short', timeStyle: 'short' })

  /** The file's name and when it last printed, as the row's second line. */
  const detail = (row: SessionRow) =>
    [row.file, row.at === null ? null : when(row.at)].filter((one) => one !== null).join(' · ')

  /** Its tab, in front, or a new tab for it, in the space it is in; Settings goes. */
  async function open(path: string) {
    const space = workspace.spaces.find((one) => within(one.root, path) !== null)
    if (space && space.id !== workspace.activeSpaceId) await workspace.showSpace(space.id)
    await workspace.openEntry(path, { activate: true })
    settings.open = false
  }

  async function end(row: SessionRow) {
    const sure = await prompt.confirm({
      title: t('End {name}?', { name: row.name ?? t('Terminal') }),
      confirmLabel: t('End'),
      danger: true,
    })
    if (sure) await sessions.end(row.listed)
  }

  const known = $derived(machine.known)
  const state = $derived(known?.machine?.state ?? null)
  const awake = $derived(state === 'awake' || state === 'starting')
  const server = $derived(known?.machine?.host === 'hetzner')

  /** Gigabytes as Hetzner counts them, whole. */
  const gb = (value: number) => `${i18n.amount(Math.round(value))} GB`

  /** Bytes as the service counts them, in thousands rather than 1024s, so the month's
   *  5 GB of home reads 5 GB and not 4.7; to one place under ten. */
  function bytes(value: number): string {
    const [amount, unit] = value >= 1e9 ? [value / 1e9, 'GB'] : [value / 1e6, 'MB']
    const shown = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount)
    return `${i18n.amount(shown)} ${unit}`
  }

  /** What the server is, where, and what it costs, one line:
   *  CX43 · Falkenstein · 8 vCPU · 16 GB · 160 GB · €16.49 a month. Where the line has
   *  to wrap, as it does beside the row's end on a phone, it wraps between two facts and
   *  never inside one, with the dot at the end of a line rather than the start of the
   *  next. */
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
    return parts.map((part) => part.replaceAll(' ', '\u00a0')).join('\u00a0· ')
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
            words: `${bytes(disk.used)} / ${bytes(disk.total)}`,
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
      <div class="nib-setting setting">
        <span class="name">
          {t('Machine')}
          {#if spec}<small>{spec}</small>{/if}
        </span>
        <div class="row">
          <span class="hint">{stateWords}</span>
          <button
            class="nib-chip"
            disabled={machine.busy || state === 'stopping' || (server && state === 'starting')}
            onclick={() => void machine.startStop(!awake)}
            >{awake ? (server ? t('Restart') : t('Stop')) : t('Start')}</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if rows.length}
    <div class="card">
      {#each rows as row (row.key)}
        {@const file = files.get(row.key) ?? null}
        <div class="nib-setting setting">
          <span class="name">
            {row.name ?? t('Terminal')}
            {#if detail(row)}<small>{detail(row)}</small>{/if}
          </span>
          <div class="row">
            {#if file}
              <button class="nib-chip" onclick={() => void open(file)}>{t('Open')}</button>
            {/if}
            <button class="nib-chip" onclick={() => void end(row)}>{t('End')}</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if meters.length}
    <div class="card">
      <div class="stack">
        {#each meters as meter (meter.label)}
          <div class="meter">
            <div class="line">
              <span>{meter.label}</span>
              <span class="words">{meter.words}</span>
            </div>
            <div
              class="nib-meter"
              class:is-near={meter.near}
              role="meter"
              aria-label={meter.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(meter.share * 100)}
            >
              <div class="nib-meter-fill" style:width={`${meter.share * 100}%`}></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
    {#if known && !server}
      <p class="hint caption">
        {t('Starts again {date}', { date: i18n.when(known.resets, { dateStyle: 'medium' }) })}
      </p>
    {/if}
  {/if}

  {#if refusal}
    <p class="hint">{refusal}</p>
  {/if}
</div>

<style>
  /* The settings pane's own shapes, with the panel's values: a section in a component
     of its own does not inherit the panel's rules, which are scoped to it. See
     SettingsPanel.svelte, and AiPane.svelte, which does the same. */
  .online {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  /* A run of rows. Plain on a desktop; a phone draws the box around it. */
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .setting .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* What the machine is doing, and what can be done about it, at the end of its row. */
  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }

  /* One allowance: its name and its numbers on a line, the bar under them. */
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

  .hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  /* Under the card it explains, closer to it than the next group. */
  .hint.caption {
    margin-top: calc(-1 * var(--space-2));
  }

  /* A phone draws the box, the touch row and the room inside the box, at the sizes
     the panel's own cards have there. The sheet is the panel's, so that half of the
     selector is global. */
  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .setting {
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting .name small,
  :global(.sheet.phone) .hint {
    font-size: var(--text-base);
  }

  :global(.sheet.phone) .stack {
    padding: var(--touch-pad);
  }

  :global(.sheet.phone) .meter {
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .hint.caption {
    margin: calc(-1 * var(--space-2)) var(--touch-pad) 0;
  }
</style>
