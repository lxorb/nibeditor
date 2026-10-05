<script lang="ts">
  /** Cards: Bases' gallery. A cover from the view's image property (fit, ratio and size
   *  under the names Bases writes them, `imageFit`, `imageAspectRatio`, `cardSize`),
   *  the title and the view's other properties under it (docs/tasks.md 5.9).
   *
   *  A picture in the space loads at once; one on the web does not, since nothing loads
   *  from a third party until the reader asks (docs/conventions.md, Security): the card
   *  keeps the space for it and says whose it is. A card pressed opens its note beside
   *  the view; carried to another group it is written into it. */
  import { cellValue, groupName, type Row, rowId } from '@nib/bases'
  import { linkModifier } from '@nib/editor'
  import { imageUrl } from '../images'
  import { valueText } from './chips'
  import { displayName } from './columns'
  import { draggable, droppable } from './drag.svelte'
  import { plain } from './inline'
  import { notePath, type Kit } from './kit'
  import TaskBox from './TaskBox.svelte'
  import { isLinkValue } from './values'
  import { groupLabel, propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const property = $derived(view?.groupBy?.property)
  const image = $derived(typeof view?.options.image === 'string' ? view.options.image : null)
  const fit = $derived(view?.options.imageFit === 'contain' ? 'contain' : 'cover')
  const ratio = $derived(
    typeof view?.options.imageAspectRatio === 'number' ? view.options.imageAspectRatio : 0.5,
  )
  const size = $derived(typeof view?.options.cardSize === 'number' ? view.options.cardSize : 220)
  /** The properties under the title: the view's columns but the one that is the title. */
  const shown = $derived(
    live.columns
      .filter(
        (one) =>
          one !== 'file.name' && one !== 'file.basename' && one !== 'task.text' && one !== image,
      )
      .slice(0, 4),
  )

  /** The cover a row's image property points at: a picture in the space as an address
   *  the webview loads, one on the web as the host it is on. */
  function coverOf(row: Row): { src: string } | { host: string } | null {
    const base = live.base
    if (!base || image === null) return null
    const value = cellValue(base, image, row, live.context)
    const target = typeof value === 'string' ? value : isLinkValue(value) ? value.target : null
    if (!target) return null
    if (/^https?:\/\//i.test(target)) {
      try {
        return { host: new URL(target).host }
      } catch {
        return null
      }
    }
    const path = notePath(row)
    return { src: imageUrl(target, path) }
  }
</script>

<div class="cards" style:--card={`${size}px`}>
  {#each live.answer?.groups ?? [] as group (groupName(group.key))}
    {#if property !== undefined}
      <p class="nib-section" use:droppable={(row) => kit.drop(row, group.key)}>
        {groupLabel(property, group.key, live.today)}<span>{group.rows.length}</span>
      </p>
    {/if}
    <div
      class="grid"
      use:droppable={(row) => {
        if (property !== undefined) kit.drop(row, group.key)
      }}
    >
      {#each group.rows as row (`${row.space}:${rowId(row)}`)}
        {@const cover = coverOf(row)}
        {@const title = row.task ? plain(row.task.text) : row.file.basename}
        {@const tone = live.colourOf(row)}
        <div
          class="card"
          class:toned={tone !== null}
          style:--row-tone={tone}
          role="button"
          tabindex="0"
          use:draggable={{ row, label: title }}
          onclick={(event) => kit.open(row, linkModifier(event) ? 'tab' : 'aside')}
          onkeydown={(event) => {
            if (event.key === 'Enter') kit.open(row, 'aside')
          }}
        >
          {#if image !== null}
            <div class="cover" style:aspect-ratio={1 / ratio}>
              {#if cover && 'src' in cover}
                <img
                  src={cover.src}
                  alt=""
                  style:object-fit={fit}
                  loading="lazy"
                  draggable="false"
                />
              {:else if cover}
                <span class="host">{cover.host}</span>
              {/if}
            </div>
          {/if}
          <div class="title">
            {#if row.task}<TaskBox
                task={row.task}
                label={title}
                ontick={() => kit.tick(row)}
              />{/if}
            <span>{title}</span>
          </div>
          {#each shown as one (one)}
            {@const value = live.base
              ? valueText(cellValue(live.base, one, row, live.context), live.today)
              : ''}
            {#if value}
              <div class="prop">
                <span class="key"
                  >{propertyName(one, live.base ? displayName(live.base, one) : undefined)}</span
                >
                <span class="said">{value}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .cards {
    padding: var(--space-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(var(--card), 100%), 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    overflow: hidden;
    padding-bottom: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .card:hover {
      border-color: var(--line-strong);
      box-shadow: var(--shadow-sm);
    }
  }

  .card:active {
    transform: scale(0.99);
  }

  .card:global(.is-carried) {
    opacity: 0.35;
  }

  .cover {
    display: grid;
    place-items: center;
    width: 100%;
    overflow: hidden;
    background: var(--surface-2);
  }

  .cover img {
    width: 100%;
    height: 100%;
  }

  .host {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) 0;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .prop {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
  }

  .key {
    flex: none;
    color: var(--muted);
  }

  .said {
    min-width: 0;
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grid:global(.is-taking) {
    border-radius: var(--radius-md);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* The view's conditional colour (nib.colour), the row's tone over its ground. */
  .toned {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
