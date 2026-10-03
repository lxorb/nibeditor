<script lang="ts">
  /** Delete browsing data: Chrome's dialog, in nib's sheet.
   *
   *  Chrome's choices in Chrome's words - a time range, Browsing history, Cookies and
   *  other site data, Cached images and files - and Chrome's default: the last hour, all
   *  three. A space that keeps its web data apart is asked one thing more, whose data,
   *  the way a browser with profiles clears one profile. The browser build has no engine
   *  of its own behind its pages, so it offers the history and nothing it cannot clear.
   *  What goes and how is clearing.ts.
   *
   *  Drawn in the window's own layer rather than in the pane, so the sheet is over every
   *  page: a page is cut out under anything with the layer's shape; see covers.ts. */

  import Select from '../Select.svelte'
  import Sheet from '../Sheet.svelte'
  import { message, t } from '../i18n.svelte'
  import { isDesktop } from '../tauri'
  import { viewport } from '../viewport.svelte'
  import { clearData, DEFAULT_RANGE, keptApart, type Range } from './clearing'

  const {
    space,
    spaces,
    onclose,
  }: {
    /** The space of the tab that asked. */
    space: string | null
    /** Every space this window knows. */
    spaces: readonly string[]
    onclose: () => void
  } = $props()

  let range = $state<Range>(DEFAULT_RANGE)
  let history = $state(true)
  let site = $state(isDesktop)
  let cache = $state(isDesktop)
  let everywhere = $state(false)
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  const RANGES: { value: Range; label: () => string }[] = [
    { value: 'quarter', label: () => t('Last 15 minutes') },
    { value: 'hour', label: () => t('Last hour') },
    { value: 'day', label: () => t('Last 24 hours') },
    { value: 'week', label: () => t('Last 7 days') },
    { value: 'month', label: () => t('Last 4 weeks') },
    { value: 'all', label: () => t('All time') },
  ]

  const apart = $derived(keptApart(spaces))
  const kinds = $derived([
    { label: t('Browsing history'), on: history, set: (on: boolean) => (history = on) },
    ...(isDesktop
      ? [
          {
            label: t('Cookies and other site data'),
            on: site,
            set: (on: boolean) => (site = on),
          },
          { label: t('Cached images and files'), on: cache, set: (on: boolean) => (cache = on) },
        ]
      : []),
  ])

  /** Moved to the end of the window's own document as it arrives, so the sheet is the
   *  window's and not the pane's, whatever the pane is inside. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  async function go() {
    busy = true
    wrong = null
    try {
      await clearData({ range, history, site, cache, everywhere }, space, spaces)
      onclose()
    } catch (error) {
      wrong = message(error, 'the data could not be deleted')
    } finally {
      busy = false
    }
  }
</script>

<div class="holder" use:portal>
  <Sheet open title={t('Delete browsing data')} {onclose}>
    {#if wrong}<p class="wrong">{wrong}</p>{/if}

    <div class="card">
      <div class="row">
        <span class="name">{t('Time range')}</span>
        <div class="pick">
          <Select
            value={range}
            options={RANGES.map((one) => ({ value: one.value, label: one.label() }))}
            onchange={(value: string) => {
              const chosen = RANGES.find((one) => one.value === value)
              if (chosen) range = chosen.value
            }}
            label={t('Time range')}
            plain={viewport.touch}
          />
        </div>
      </div>
      {#if apart}
        <div class="row">
          <span class="name">{t('Spaces')}</span>
          <div class="pick">
            <Select
              value={everywhere ? 'all' : 'here'}
              options={[
                { value: 'here', label: t('This space') },
                { value: 'all', label: t('All spaces') },
              ]}
              onchange={(value: string) => (everywhere = value === 'all')}
              label={t('Spaces')}
              plain={viewport.touch}
            />
          </div>
        </div>
      {/if}
    </div>

    <div class="card">
      {#each kinds as kind (kind.label)}
        <div
          class="row pressable"
          role="switch"
          tabindex="0"
          aria-checked={kind.on}
          onclick={() => kind.set(!kind.on)}
          onkeydown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            kind.set(!kind.on)
          }}
        >
          <span class="name">{kind.label}</span>
          <span class="nib-switch" class:on={kind.on} aria-hidden="true"></span>
        </div>
      {/each}
    </div>

    {#snippet foot()}
      <button class="nib-button is-quiet" onclick={onclose}>{t('Cancel')}</button>
      <button
        class="nib-button is-danger"
        disabled={busy || !(history || site || cache)}
        onclick={() => void go()}
      >
        {t('Delete data')}
      </button>
    {/snippet}
  </Sheet>
</div>

<style>
  /* Nothing of its own: the sheet's scrim and screen are fixed to the window. */
  .holder {
    display: contents;
  }

  .pick {
    flex: none;
    width: 11rem;
  }

  .pressable {
    cursor: default;
    border-radius: var(--radius-row);
    padding-inline: var(--space-1);
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .pressable:hover {
      background: var(--surface-hover);
    }
  }

  .pressable:active {
    background: var(--surface-press);
  }

  /* The sheet's foot holds the two answers at its end, the way a dialog's are. */
  .holder :global(.foot) {
    justify-content: flex-end;
  }
</style>
