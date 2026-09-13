<script lang="ts">
  /** What the picture of a space can be asked, in one card in its corner.
   *
   *  Folded away to a single button until it is wanted, because most of the time the
   *  answer to "how should this be drawn" is "the way it already is": the settings
   *  belong to the space and came down with it, so a reader who set them last month
   *  wants the picture and not the controls. The same card the canvas panels are - the
   *  surface, the hairline, the corner and the lift - because it is the same kind of
   *  thing over the same kind of plane.
   *
   *  Only what changes what the picture tells you. Which notes are in it, what the
   *  colours mean, how far apart they sit, whether a link says which way it points,
   *  how big a note is drawn, and when. Nothing about the camera: that is the
   *  pointer's business, and a dial for it would be a second way to do what a
   *  scroll already does.
   *
   *  It writes straight to the space's own settings, so every surface that draws a
   *  graph reads one answer; see workspace/graph-settings.svelte.ts. */

  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { overlays } from './overlays'
  import Twist from './Twist.svelte'
  import { workspace } from './workspace.svelte'
  import {
    DEEPEST,
    LEAST_DISTANCE,
    LEAST_FADE,
    LEAST_LINES,
    LEAST_PUSH,
    LEAST_SPREAD,
    MOST_DISTANCE,
    MOST_FADE,
    MOST_GROUPS,
    MOST_LINES,
    MOST_PUSH,
    MOST_SPREAD,
    SHALLOWEST,
  } from './workspace/graph-settings.svelte'

  const {
    open,
    span,
    at,
    playing,
    onopen,
    onplay,
    onscrub,
  }: {
    open: boolean
    /** The first and last note of the space, or null where none of them has a date
     *  to play - which is what a browser store with no times looks like. */
    span: { from: number; to: number } | null
    /** Where the scrub bar stands, in milliseconds. */
    at: number
    playing: boolean
    onopen: (open: boolean) => void
    onplay: () => void
    onscrub: (at: number) => void
  } = $props()

  /** Four sliders, which is what a card of controls is. On the same 13 unit grid
   *  every mark in the shell is drawn on; see panel-marks.ts. */
  const CARD_MARK = 'M2 3.5h9M2 9.5h9M4.6 1.9v3.2M8.4 7.9v3.2'
  const ADD_MARK = 'M6.5 3v7M3 6.5h7'
  const DROP_MARK = 'M3.8 3.8l5.4 5.4M9.2 3.8l-5.4 5.4'
  const PLAY_MARK = 'M4 2.6 10.4 6.5 4 10.4z'
  const PAUSE_MARK = 'M4.4 3v7M8.6 3v7'

  const settings = $derived(workspace.graphSettings.here)
  const spread = $derived(settings.spread)

  /** Whether the forces are let out. Here rather than in the space's settings: it is
   *  a disclosure, not a fact about the picture, and a card that remembered which of
   *  its groups was open on every machine signed in would be syncing furniture. */
  let forcing = $state(false)

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts, which is also what keeps this press from reaching the graph's own
  // Escape and closing the tab underneath. And Android's back, the same gesture on
  // a phone.
  $effect(() => (open ? overlays.show(() => onopen(false)) : undefined))
  $effect(() => closeOnBack(open, () => onopen(false)))

  function addGroup() {
    const held = settings.groups
    // The next colour along, so six groups are six colours without anybody
    // choosing: what a reader wants first is to tell them apart.
    const colour = (held.length % MOST_GROUPS) + 1
    workspace.graphSettings.set({ groups: [...held, { query: '', colour }] })
  }

  function setGroup(index: number, change: { query?: string; colour?: number }) {
    workspace.graphSettings.set({
      groups: settings.groups.map((group, one) =>
        one === index ? { ...group, ...change } : group,
      ),
    })
  }

  function dropGroup(index: number) {
    workspace.graphSettings.set({ groups: settings.groups.filter((_one, at) => at !== index) })
  }

  /** The next of the six. A tap rather than a picker: there are six colours in the
   *  theme and a group is one of them, so a row of dots or a wheel would be a
   *  second palette over a card that has room for neither. */
  function nextColour(index: number, colour: number) {
    setGroup(index, { colour: (colour % MOST_GROUPS) + 1 })
  }

  /** Keeps this view under a name of its own. Asked for a name, because a view
   *  is a row in a list of names and "Graph" twice is two rows nobody can tell
   *  apart. The prompt is imported where it is used, the way the bookmarks' own
   *  rows import it: it is a sheet, and a card should not carry one. */
  async function keepView() {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.ask({ title: t('Bookmark this view'), confirmLabel: t('Keep') })
    if (!name) return

    workspace.bookmarks.toggle(workspace.bookmarks.forGraph(name, settings))
  }
</script>

<div class="corner">
  {#if open}
    <div class="nib-layer card">
      <!-- What the picture is narrowed to. The search's own language, so a habit
           carries over; the placeholder is what says which three things a picture
           can be asked about. See graph-filter.ts. -->
      <input
        class="nib-field"
        type="text"
        value={settings.filter}
        placeholder={t('Name, path or tag')}
        aria-label={t('Filter')}
        spellcheck="false"
        oninput={(event) => workspace.graphSettings.set({ filter: event.currentTarget.value })}
      />

      <button
        class="nib-row"
        role="switch"
        aria-checked={settings.orphans}
        onclick={() => workspace.graphSettings.set({ orphans: !settings.orphans })}
      >
        <span class="nib-row-label">{t('Orphans')}</span>
        <span class="nib-switch" class:on={settings.orphans} aria-hidden="true"></span>
      </button>

      <!-- The files the notes embed, as nodes of their own. Off unless it is asked
           for, and beside the orphans switch because it is the same question: which
           things are in the picture at all. Unlike every switch below it this one is
           a different graph rather than a different drawing of one, so the
           arrangement is made again - which is honest, since the notes have to make
           room for the pictures. See `namesFile` in graph.ts. -->
      <button
        class="nib-row"
        role="switch"
        aria-checked={settings.attachments}
        onclick={() => workspace.graphSettings.set({ attachments: !settings.attachments })}
      >
        <span class="nib-row-label">{t('Attachments')}</span>
        <span class="nib-switch" class:on={settings.attachments} aria-hidden="true"></span>
      </button>

      <!-- How far the picture beside a note reaches: one link out, or five. Here
           rather than only beside the panel it draws, because it is a fact about this
           space's picture like everything else on the card, and it travels with the
           space. The stepper in the Links panel writes the same setting, so the two
           are never out of step; see Sidebar.svelte. -->
      <div class="dial">
        <span>{t('Depth')}</span>
        <input
          class="nib-slider"
          type="range"
          min={SHALLOWEST}
          max={DEEPEST}
          step="1"
          value={settings.depth}
          aria-label={t('Depth')}
          style:--fill="{((settings.depth - SHALLOWEST) / (DEEPEST - SHALLOWEST)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ depth: Number(event.currentTarget.value) })}
        />
      </div>

      <div class="rule"></div>

      {#each settings.groups as group, index (index)}
        <div class="group">
          <button
            class="swatch"
            style:--swatch="var(--canvas-{group.colour})"
            title={t('Colour {number}', { number: String(group.colour) })}
            aria-label={t('Colour {number}', { number: String(group.colour) })}
            onclick={() => nextColour(index, group.colour)}
          ></button>

          <input
            class="nib-field"
            type="text"
            value={group.query}
            placeholder={t('Name, path or tag')}
            aria-label={t('Colour a group')}
            spellcheck="false"
            oninput={(event) => setGroup(index, { query: event.currentTarget.value })}
          />

          <button
            class="drop"
            title={t('Remove')}
            aria-label={t('Remove')}
            onclick={() => dropGroup(index)}
          >
            <svg viewBox="0 0 13 13"><path d={DROP_MARK} /></svg>
          </button>
        </div>
      {/each}

      {#if settings.groups.length < MOST_GROUPS}
        <button class="nib-row" onclick={addGroup}>
          <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={ADD_MARK} /></svg>
          <span class="nib-row-label">{t('Colour a group')}</span>
        </button>
      {/if}

      <div class="rule"></div>

      <!-- Everything that decides where a note goes, folded away behind one row.
           All four of them, because the layout has four and a reader who wants a
           denser picture of a dense space has no other way to ask: how far apart a
           link holds two notes, how hard the notes push, how much more of that push
           than the arrangement does unasked, and whether the middle pulls at all.
           See graph-layout.ts.

           Folded, because these are the four a reader touches once and then leaves,
           and a card is quiet or it is a settings panel. The twist is the file
           tree's - one disclosure in the app, one shape; see Twist.svelte.

           Each named, like the switches above, rather than a bare slider with a
           number beside it: a dial in a pen's popover is about the pen, and a dial
           in a card of a dozen things has to say which of them it is. -->
      <button class="nib-row" aria-expanded={forcing} onclick={() => (forcing = !forcing)}>
        <span class="nib-row-label">{t('Forces')}</span>
        <span class="chevron"><Twist open={forcing} /></span>
      </button>

      {#if forcing}
        <div class="dial">
          <span>{t('Spread')}</span>
          <input
            class="nib-slider"
            type="range"
            min={LEAST_SPREAD}
            max={MOST_SPREAD}
            step="0.25"
            value={spread}
            aria-label={t('Spread')}
            style:--fill="{((spread - LEAST_SPREAD) / (MOST_SPREAD - LEAST_SPREAD)) * 100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ spread: Number(event.currentTarget.value) })}
          />
        </div>

        <div class="dial">
          <span>{t('Link distance')}</span>
          <input
            class="nib-slider"
            type="range"
            min={LEAST_DISTANCE}
            max={MOST_DISTANCE}
            step="4"
            value={settings.distance}
            aria-label={t('Link distance')}
            style:--fill="{((settings.distance - LEAST_DISTANCE) /
              (MOST_DISTANCE - LEAST_DISTANCE)) *
              100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ distance: Number(event.currentTarget.value) })}
          />
        </div>

        <div class="dial">
          <span>{t('Push')}</span>
          <input
            class="nib-slider"
            type="range"
            min={LEAST_PUSH}
            max={MOST_PUSH}
            step="10"
            value={settings.push}
            aria-label={t('Push')}
            style:--fill="{((settings.push - LEAST_PUSH) / (MOST_PUSH - LEAST_PUSH)) * 100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ push: Number(event.currentTarget.value) })}
          />
        </div>

        <button
          class="nib-row"
          role="switch"
          aria-checked={settings.gather}
          onclick={() => workspace.graphSettings.set({ gather: !settings.gather })}
        >
          <span class="nib-row-label">{t('Gather')}</span>
          <span class="nib-switch" class:on={settings.gather} aria-hidden="true"></span>
        </button>
      {/if}

      <!-- How wide a link is drawn: thin, the look the picture has always had, and
           thick. Three steps rather than a range, because a stroke wider than one of
           the screen's own pixels is what costs a picture of ten thousand links its
           frame rate: the thick step is the same hairline drawn three times a pixel
           apart. See `LINES` in graph-paint.ts. -->
      <div class="dial">
        <span>{t('Lines')}</span>
        <input
          class="nib-slider"
          type="range"
          min={LEAST_LINES}
          max={MOST_LINES}
          step="1"
          value={settings.lines}
          aria-label={t('Lines')}
          style:--fill="{((settings.lines - LEAST_LINES) / (MOST_LINES - LEAST_LINES)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ lines: Number(event.currentTarget.value) })}
        />
      </div>

      <!-- Where the names fade in. A threshold that follows the zoom is what a
           picture of a space wants; how dense the space is is what only its reader
           knows, so this is where that threshold sits. One is the zoom the names have
           always arrived at, so nothing changes until it is touched: to the left they
           arrive while the space is still small, to the right they wait until the view
           is in among the notes. See `LABELS_FROM` in graph-paint.ts. -->
      <div class="dial">
        <span>{t('Text fade')}</span>
        <input
          class="nib-slider"
          type="range"
          min={LEAST_FADE}
          max={MOST_FADE}
          step="0.25"
          value={settings.fade}
          aria-label={t('Text fade')}
          style:--fill="{((settings.fade - LEAST_FADE) / (MOST_FADE - LEAST_FADE)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ fade: Number(event.currentTarget.value) })}
        />
      </div>

      <button
        class="nib-row"
        role="switch"
        aria-checked={settings.arrows}
        onclick={() => workspace.graphSettings.set({ arrows: !settings.arrows })}
      >
        <span class="nib-row-label">{t('Arrows')}</span>
        <span class="nib-switch" class:on={settings.arrows} aria-hidden="true"></span>
      </button>

      <button
        class="nib-row"
        role="switch"
        aria-checked={settings.sized}
        onclick={() => workspace.graphSettings.set({ sized: !settings.sized })}
      >
        <span class="nib-row-label">{t('Size by links')}</span>
        <span class="nib-switch" class:on={settings.sized} aria-hidden="true"></span>
      </button>

      {#if span}
        <div class="rule"></div>

        <!-- The space as it was written: the notes arrive in the order they were
             made. One button and one bar, because there is one thing to say and
             one place to say it from. -->
        <div class="time">
          <button
            class="press"
            title={playing ? t('Pause') : t('Play')}
            aria-label={playing ? t('Pause') : t('Play')}
            onclick={onplay}
          >
            <svg viewBox="0 0 13 13" class:filled={!playing}>
              <path d={playing ? PAUSE_MARK : PLAY_MARK} />
            </svg>
          </button>

          <input
            class="nib-slider"
            type="range"
            min={span.from}
            max={span.to}
            step={Math.max(1, Math.round((span.to - span.from) / 400))}
            value={at}
            aria-label={t('Over time')}
            style:--fill="{((at - span.from) / (span.to - span.from)) * 100}%"
            oninput={(event) => onscrub(Number(event.currentTarget.value))}
          />
        </div>
      {/if}

      <div class="rule"></div>

      <!-- The card says how this picture is drawn; this is how to come back to
           it. The space already remembers the way it was left, so a bookmark is
           for the second way of looking at the same space: the whole of it, one
           project, what nothing links to. It lands in the row above the file
           list with everything else that is kept; see Bookmarks.svelte. -->
      <button class="nib-row" onclick={() => void keepView()}>
        <span class="nib-row-label">{t('Bookmark this view')}</span>
      </button>

      <button class="nib-row" onclick={() => workspace.graphSettings.reset()}>
        <span class="nib-row-label">{t('Reset')}</span>
      </button>
    </div>
  {/if}

  <button
    class="tab"
    class:on={open}
    title={t('Graph controls')}
    aria-label={t('Graph controls')}
    aria-pressed={open}
    onclick={() => onopen(!open)}
  >
    <svg viewBox="0 0 13 13"><path d={CARD_MARK} /></svg>
  </button>
</div>

<style>
  /* In the corner and against the two edges of it, clear of whatever the system
     puts there. The bottom left, because the app's own round button is bottom
     right on a phone and the tab strip is along the top. */
  .corner {
    position: absolute;
    inset-inline-start: var(--space-2);
    bottom: calc(var(--space-2) + var(--inset-bottom));
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    /* The card is as wide as it is, and the corner is only as wide as the card:
       everything either side of it is the picture, and the picture takes the
       pointer. */
    max-width: calc(100% - 2 * var(--space-2));
  }

  /* The same card the canvas panels have, and the same `.nib-layer` in the themes
     package that draws every layer floating over the app. One shape over a plane,
     whichever plane it is. */
  .card {
    box-sizing: border-box;
    width: min(21rem, 100%);
    /* Never taller than the pane it is in, so a phone scrolls the card rather
       than losing the end of it. */
    max-height: calc(100vh - 8rem);
    max-height: calc(100dvh - 8rem);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior-y: contain;
    animation: lift var(--dur-fast) var(--ease-out);
  }

  @keyframes lift {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }

  /* Between the four things the card holds: which notes, which colours, how it is
     drawn, and when. */
  .rule {
    flex: none;
    height: 1px;
    margin: var(--space-2) var(--row-pad);
    background: var(--line);
  }

  /* One colour group: the colour, the query, and the way to be rid of it. */
  .group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .group input {
    flex: 1;
    min-width: 0;
  }

  /* The colour, as the colour. Not the picker's dot: that is a 40px target with a
     hairline and a halo, built for a row of twelve of them, and this is one tap
     among six in a row that also holds a field. */
  .swatch {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    cursor: default;
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:active {
    scale: 1.08;
  }

  /* The tab the card folds away to, and the two small buttons inside it. */
  .tab,
  .drop,
  .press {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .tab {
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-md);
  }

  @media (hover: hover) {
    .drop:hover,
    .press:hover {
      color: var(--text-strong);
      background: var(--surface-hover);
    }

    /* The tab has a surface of its own, so what a hover moves is its edge. */
    .tab:hover {
      color: var(--text-strong);
      border-color: var(--muted);
    }
  }

  .drop:active,
  .press:active {
    background: var(--press);
  }

  .tab.on {
    color: var(--accent);
  }

  svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A triangle is a shape rather than a stroke. */
  svg.filled {
    fill: currentColor;
    stroke: none;
  }

  /* The box the twist on the Forces row fills; the shape, the weight and the turn
     are Twist.svelte's, the way they are in the two trees. */
  .chevron {
    display: block;
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted);
  }

  /* Every dial, laid out as the switches beside them are: the word at the left, the
     control at the right, and the row the height theirs is. */
  .dial {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--row-gap);
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
  }

  /* The word, with a width reserved for it: a card of six dials whose tracks each
     start where their own word happens to end reads as six different controls. Wide
     enough for the longest of the six in English, and a floor rather than a fixed
     width - a language that spells one of them out at length needs the room more than
     the track does, and the track shrinks to give it. */
  .dial span {
    flex: none;
    min-width: 7rem;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .dial input {
    flex: 0 1 11rem;
    min-width: 0;
  }

  /* The play button and the bar it moves along. */
  .time {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .time input {
    flex: 1;
    min-width: 0;
  }

  :global([data-touch]) .tab,
  :global([data-touch]) .drop,
  :global([data-touch]) .press {
    width: var(--touch-target);
    height: var(--touch-target);
  }

  :global([data-touch]) svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }
</style>
