<script lang="ts">
  /** Settings, Remote: every host a remote terminal reaches, in the order the picker
   *  offers the rest of them, and a row opens one (HostDetail.svelte).
   *
   *  A host of the ssh config is a mirror - its name and where it is are the config's,
   *  and Open config is where they change - and one made here is nib's own, in the app's
   *  data folder. Either can be coloured, grouped and pinned. Dragged to reorder where
   *  there is a pointer, and the two arrows everywhere, as the phone bar's rows are.
   *
   *  Fetched when the pane is opened, never before: nothing of it is in the first paint. */
  import { t } from '../i18n.svelte'
  import { prompt } from '../prompt.svelte'
  import { arrive } from '../slide'
  import { invoke } from '../tauri'
  import { viewport } from '../viewport.svelte'
  import HostDetail from './HostDetail.svelte'
  import HostMark from './HostMark.svelte'
  import { destinationOf, moved } from './hosts'
  import { remote } from './hosts.svelte'

  $effect(() => {
    void remote.refresh()
  })

  let chosen = $state<string | null>(null)
  const host = $derived(chosen === null ? null : (remote.byId(chosen) ?? null))

  let problem = $state('')

  /** A host made here: where it is, typed as `ssh` takes it. */
  async function add() {
    problem = ''
    const typed = await prompt.ask({
      title: t('Add host'),
      placeholder: 'user@host:22',
      confirmLabel: t('Add'),
    })
    if (typed === null) return

    const wanted = destinationOf(typed)
    if (!wanted) {
      problem = t('Not an address')
      return
    }
    const made = await remote.make(wanted)
    if (made) chosen = made.id
  }

  const move = (from: number, to: number) =>
    void remote.keep((kept) => moved(kept, remote.hosts, from, to))

  async function openConfig() {
    problem = ''
    await invoke('remote_config_open').catch((error: unknown) => {
      problem = String(error)
    })
  }

  /** Which row is being dragged, while one is, and where it would land. */
  let dragging = $state<number | null>(null)
  let dropAt = $state<number | null>(null)

  function over(event: DragEvent, at: number) {
    if (dragging === null || dragging === at) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }

  function dropped(event: DragEvent, at: number) {
    event.preventDefault()
    if (dragging !== null) move(dragging, at)
    dragging = null
    dropAt = null
  }
</script>

<div class="remote">
  {#key host?.id}
    <div class="page" in:arrive>
      {#if host}
        <HostDetail {host} onback={() => (chosen = null)} />
      {:else}
        <div class="card">
          {#each remote.hosts as one, at (one.id)}
            {@const about = [one.detail, one.group].filter(Boolean).join(' · ')}
            <div
              class="nib-setting row"
              class:landing={dropAt === at}
              role="group"
              aria-label={one.name}
              draggable={!viewport.touch}
              ondragstart={(event) => {
                event.dataTransfer?.setData('text/plain', one.id)
                dragging = at
              }}
              ondragover={(event) => over(event, at)}
              ondragleave={() => (dropAt = null)}
              ondragend={() => {
                dragging = null
                dropAt = null
              }}
              ondrop={(event) => dropped(event, at)}
            >
              <button class="open" onclick={() => (chosen = one.id)}>
                <HostMark colour={one.colour} />
                <span class="name">
                  {one.name}
                  {#if about}<small>{about}</small>{/if}
                </span>
              </button>
              <button
                class="step"
                disabled={at === 0}
                title={t('Move up')}
                aria-label={t('Move up')}
                onclick={() => move(at, at - 1)}
              >
                <svg viewBox="0 0 16 16"><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
              </button>
              <button
                class="step"
                disabled={at === remote.hosts.length - 1}
                title={t('Move down')}
                aria-label={t('Move down')}
                onclick={() => move(at, at + 1)}
              >
                <svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
              </button>
            </div>
          {/each}
          <button class="nib-setting row add" onclick={() => void add()}>
            <span class="plus" aria-hidden="true"
              ><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg></span
            >
            <span class="name">{t('Add host')}</span>
          </button>
        </div>

        {#if remote.file}
          <button class="link" onclick={() => void openConfig()}>{t('Open config')}</button>
        {/if}
      {/if}

      {#if problem}
        <p class="hint bad">{problem}</p>
      {/if}
    </div>
  {/key}
</div>

<style>
  /* The settings pane's own shapes, said once here for this pane and the host page in
     it, since the panel's rules are scoped to the panel; see AgentsPane.svelte, which
     does the same. */
  .remote,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .remote :global(h3) {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .remote :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .remote :global(.nib-setting .name) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .remote :global(.nib-setting .name small) {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .remote :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .remote :global(.hint.bad) {
    color: var(--danger);
  }

  /* The row opens its host; the arrows at its end order it. */
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }

  @media (hover: hover) {
    .open:hover,
    .add:hover {
      color: var(--text-strong);
    }
  }

  .step,
  .plus {
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

  .plus {
    width: var(--icon-md);
    height: var(--icon-md);
  }

  @media (hover: hover) {
    .step:not(:disabled):hover {
      color: var(--text-strong);
    }
  }

  .step svg,
  .plus svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Where a dragged row would land: the line the phone bar's rows draw. */
  .row.landing {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  /* To the config, in the accent, as a link inside the settings leads. */
  .link {
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

  @media (hover: hover) {
    .link:hover {
      color: var(--accent-hover);
    }
  }
</style>
