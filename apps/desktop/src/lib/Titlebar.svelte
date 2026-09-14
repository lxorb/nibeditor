<script lang="ts">
  import type { EditorView } from '@nib/editor'
  import AppMenu from './AppMenu.svelte'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import SidebarToggle from './SidebarToggle.svelte'
  import SpaceMark from './SpaceMark.svelte'
  import TabMark from './TabMark.svelte'
  import Tabs from './Tabs.svelte'
  import { currentWindow, isDesktop } from './tauri'
  import { viewport } from './viewport.svelte'
  import { WindowState } from './window-state.svelte'
  import { workspace } from './workspace.svelte'

  const {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView | undefined; onpalette: () => void; onhistory: () => void } = $props()

  /** What the middle button says. Read off the window itself rather than off its
   *  own clicks, because dragging a maximised window off the top of the screen
   *  restores it too; see window-state.svelte.ts. */
  const shape = new WindowState()
  const maximized = $derived(shape.maximized)

  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))

  /** The one pane, while there is only one. Null once something is split, and
   *  then the strips live in the panes. */
  const only = $derived(workspace.panes.count === 1 ? workspace.panes.focused : null)

  /** A phone and a tablet show one document, so the bar says which one, with the
   *  dot that says something in it is not written down yet. The mark in front of the
   *  name is the same one the desktop's tab wears, because this bar is that strip on
   *  a screen that holds one document; see TabMark.svelte. */
  const title = $derived(
    workspace.active ? workspace.active.shown + (workspace.active.unsaved ? ' ·' : '') : 'Nib',
  )
  const showing = $derived(workspace.active)

  async function minimize() {
    if (isDesktop) await (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    await shape.toggle(await currentWindow())
  }

  async function close() {
    if (isDesktop) await (await currentWindow()).close()
  }
</script>

<!-- One row: what the app is, the button that opens the file list, the open
     notes, and the window's own buttons. On a desktop the note's name lives in
     its tab, so there is no separate title; a phone and a tablet hold one
     document, so the name is the middle of the row and the whole of the app is
     behind the dots at the end of it. -->
<header>
  <!-- The application itself, at the top left corner of the screen, which is
       where it was when there was a column of spaces to put it above. A phone
       reaches it through the three dots at the other end of this same row
       instead: there the left corner is the file list. -->
  {#if !viewport.touch}
    <AppMenu {view} {onpalette} {onhistory} />
  {/if}

  <SidebarToggle />

  <!-- With the list shut there is nothing on the screen saying which space
       these notes are in, and the panel's own header is what usually says it.
       So the name stands here while the panel is away, and goes again the moment
       it is back - a word, not a control: what opens the list is the button
       beside it. -->
  {#if !viewport.touch && !workspace.panel && workspace.activeSpace}
    {@const space = workspace.activeSpace}
    <span class="space">
      <!-- The mark the space wears everywhere else it is named: the same badge and
           the same drawing the switcher's rows put in front of it, so the space is
           one object whether the list is out or away. Plain rather than `is-on`:
           this is the space you are in said quietly, not a row to pick out of a
           list of them. -->
      <span class="nib-badge" aria-hidden="true">
        <SpaceMark id={space.id} name={space.name} />
      </span>
      <span class="name">{space.name}</span>
    </span>
  {/if}

  {#if viewport.touch}
    <!-- One document at a time, so its name goes here rather than a strip of
         tabs too narrow to read: the mark for what it is, and what it is called.
         The rest is behind the three dots. -->
    <h1 class="title">
      {#if showing}<TabMark tab={showing} />{/if}
      <span class="name">{title}</span>
    </h1>

    <!-- Everything the desktop's menu bar holds, as one menu with its groups and
         their submenus: the same rows, the same order, asked for with the three
         dots a phone puts at this end of a bar. See AppMenu.svelte. -->
    <AppMenu {view} {onpalette} {onhistory} dots />
  {:else}
    <!-- One pane keeps its tabs up here, where a browser puts them. Split, each
         pane carries its own strip instead, so which tabs belong to which pane
         is never a question; see Pane.svelte. -->
    {#if only}
      <Tabs paneId={only.id} />
    {/if}

    <!-- The empty stretch is what the window is dragged by. -->
    <div class="drag" data-tauri-drag-region></div>
  {/if}

  <!-- The other side's own button, and only once that side holds a panel: a
       window nobody has moved a panel over on has no right side, so there is
       nothing here to press and nothing here at all. See workspace.movePanel. -->
  {#if workspace.right.length}
    <SidebarToggle side="right" />
  {/if}

  <!-- A page in a browser has no window of its own to minimise or close, so it
       has none of these. Left out rather than hidden: three buttons a stylesheet
       hides are still three buttons a screen reader reads out and a key reaches.

       And out again where the reader asked for the system's own frame, for exactly
       the same reason: the titlebar above the bar already has these three, and two
       sets of them is one set that lies about which window it belongs to. The bar
       itself stays - it holds the menu, the sidebar toggle and the tabs - and so
       does the stretch the window is dragged by. See modes.svelte.ts. -->
  {#if isDesktop}
    {#if modes.frame === 'nib'}
      <div class="controls">
        <button onclick={minimize} aria-label={t('Minimize')}>
          <svg viewBox="0 0 10 10"><path d="M0 5h10" /></svg>
        </button>
        <button onclick={toggleMaximize} aria-label={maximized ? t('Restore') : t('Maximize')}>
          {#if maximized}
            <svg viewBox="0 0 10 10"><path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" /></svg>
          {:else}
            <svg viewBox="0 0 10 10"><path d="M0.5 0.5h9v9h-9z" /></svg>
          {/if}
        </button>
        <button class="close" onclick={close} aria-label={t('Close')}>
          <svg viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        </button>
      </div>
    {/if}
  {/if}
</header>

<style>
  header {
    height: var(--header-height);
    display: flex;
    align-items: stretch;
    flex: none;
    user-select: none;
    border-bottom: 1px solid var(--line);
  }

  .drag {
    flex: 1;
    min-width: var(--space-5);
  }

  .controls {
    flex: none;
    display: flex;
    opacity: 0.45;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  header:hover .controls {
    opacity: 1;
  }

  .controls button {
    width: 44px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .controls button:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }

    .controls button.close:hover {
      background: var(--danger);
      color: #fff;
    }
  }

  .controls button:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .controls button.close:active {
    background: color-mix(in srgb, var(--danger) 82%, black);
    color: #fff;
  }

  .controls svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: square;
  }

  /* The document's name, taking whatever room the two buttons leave, with its
     mark in front of it the way every list in the app puts one. */
  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    align-self: center;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  /* The one part of the bar that gives way: a long name is cut, the mark and the
     buttons either side of it are not. */
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Which space these notes are in, while the panel that usually says so is
     shut: its mark and its name, the pair the switcher shows on every row.
     Quiet: it is a fact about what is open, not something to press. */
  .space {
    flex: none;
    min-width: 0;
    max-width: 14rem;
    align-self: center;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    /* Room enough on the right that it does not read as the first tab in the
       strip: it belongs to the button beside it, which is what brings the panel
       carrying this name back. */
    padding: 0 var(--space-4) 0 var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  /* The name is what gives way, not the mark: a long space name is cut and the
     badge in front of it is not. The same division every row in the app makes. */
  .space .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* A phone has no window to drag and a thumb to hit this with. The bar grows
     to a comfortable target and clears the status bar. */
  :global([data-touch]) header {
    height: auto;
    /* Under the clock and battery, and clear of a cutout on the side a tablet
       held sideways puts it. */
    padding-top: var(--inset-top);
    padding-inline-end: var(--inset-end);
  }

  /* The note's name is titled the way the space's name is over the list beside
     it - `--text-head` - and the two buttons either side of it are sized where
     they are drawn: SidebarToggle.svelte and AppMenu.svelte. */
</style>
