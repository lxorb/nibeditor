<script lang="ts">
  /** One card on the canvas: its frame, and whatever is inside it.
   *
   *  Positioned rather than laid out. Every card is absolute at the plane
   *  coordinates the file gives it, so the surface above can move the whole plane
   *  with one transform and the browser has no layout to redo; a card being
   *  dragged is offset by a transform of its own, for the same reason.
   *
   *  The chrome is not here. Which card is picked, its handles and the dots an
   *  edge is dragged from all belong to the surface, which is what owns the
   *  gestures; this is the card itself. */

  import { onDestroy } from 'svelte'
  import { createEditor, type EditorView, embedClicks, type NoteJump, type Text } from '@nib/editor'
  import type { CanvasNode } from './canvas/format'
  import { cardHtml, fileSource, fileUrl, isPicture } from './canvas/render'
  import { isLineShape, shapeLine, shapePath } from './canvas/geometry'
  import { shownColour } from './canvas/palette'
  import { pickedLink } from './composer'
  import { t } from './i18n.svelte'
  import { links } from './link-index.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { openExternal } from './tauri'

  const {
    node,
    canvasPath,
    trusted,
    root,
    picked,
    dimmed = false,
    editing,
    offset,
    ontext,
    onleave,
    onfollow,
  }: {
    node: CanvasNode
    /** The canvas's own path, so a link in a card resolves from where it lives. */
    canvasPath: string | null
    /** Whether the HTML in this plane is markup rather than the characters it is
     *  made of. A card is a small page, and a plane arrives through a room card by
     *  card; see trust.ts. */
    trusted: boolean
    /** The space's folder, which is what a file node's path is relative to. */
    root: string | null
    picked: boolean
    /** Whether the plane has been narrowed to something else, in which case this
     *  card is still there but is not what this is about. */
    dimmed?: boolean
    /** Whether this card is the one being written in. */
    editing: boolean
    /** How far a drag has carried it since the pointer went down. */
    offset: { x: number; y: number }
    ontext?: (text: string) => void
    onleave?: () => void
    onfollow?: (jump: NoteJump) => void
  } = $props()

  /** The card's own colour, as a border and a wash. Null for one with none,
   *  which wears the surface. */
  const colour = $derived(shownColour(node.color))

  /** The words of the note a file node names, once they have arrived. Null until
   *  then, and for a file the space no longer holds. */
  let source = $state<string | null>(null)

  $effect(() => {
    if (node.type !== 'file' || isPicture(node.file)) return

    const wanted = node.file
    let mine = true
    void fileSource(wanted).then((text) => {
      if (mine) source = text
    })

    return () => {
      mine = false
    }
  })

  /** The words this node holds, whichever kind it is: a card's own, a shape's, or the
   *  note a file card names once it has arrived. */
  const words = $derived(
    node.type === 'text' ? node.text : node.type === 'shape' ? (node.text ?? '') : source,
  )

  /** The card's markdown as HTML. Read from the cache next door, so a card that
   *  has not changed costs nothing however often the plane moves. */
  const html = $derived(words ? cardHtml(words, canvasPath, trusted) : '')

  /** The shape's own corners, in the box's own coordinates, so the svg scales with
   *  the node and the arithmetic stays in one place. Through the same geometry the hit
   *  test and the export read, so a click, a picture and the screen agree.
   *
   *  A body comes back closed and a line comes back open, which is the only
   *  difference between drawing one and drawing the other. */
  const drawing = $derived.by(() => {
    if (node.type !== 'shape') return null

    const points = shapePath(node).map((one) => ({ x: one.x - node.x, y: one.y - node.y }))
    const d = `M ${points.map((one) => `${one.x} ${one.y}`).join(' L ')}`
    const open = isLineShape(node.shape)

    return { d: open ? d : `${d} Z`, open, points }
  })

  /** How far back from the end of a line its arrow head starts, and how wide the
   *  head is, in the box's own units. */
  const HEAD = 11

  const head = $derived.by(() => {
    if (node.type !== 'shape' || node.shape !== 'arrow') return null

    const ends = shapeLine(node)
    const from = { x: ends.from.x - node.x, y: ends.from.y - node.y }
    const to = { x: ends.to.x - node.x, y: ends.to.y - node.y }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const away = Math.hypot(dx, dy) || 1

    return {
      x: to.x,
      y: to.y,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      size: Math.min(HEAD, away / 3),
    }
  })

  /** Whether the picture a file card names failed to load, which is a reference into
   *  a space that no longer holds it: a moved file, a copy that arrived without its
   *  attachments, a share that left them behind. Shown as a quiet placeholder, because
   *  the card is still where somebody put it and the plane is still readable. */
  let broken = $state(false)

  $effect(() => {
    // The card being pointed at a different file is a different question, so the
    // path is read for its own sake and the answer starts again with it.
    if (node.type === 'file' && node.file) broken = false
  })

  /** A link node's host, which is the closest thing to a title that can be known
   *  without asking the web for one. */
  const host = $derived.by(() => {
    if (node.type !== 'link') return ''
    try {
      return new URL(node.url).hostname.replace(/^www\./, '')
    } catch {
      // Not a URL a browser would parse, so the whole of it is the name.
      return node.url
    }
  })

  let editor: EditorView | undefined
  let typed = ''

  /** The small editor, mounted only while this card is being written in and taken
   *  down the moment it is not: five hundred cards must not be five hundred
   *  editors, and the one that exists is sized to its own card. */
  function edit(host: HTMLElement) {
    if (node.type !== 'text' && node.type !== 'shape') return

    typed = words ?? ''
    editor = createEditor({
      parent: host,
      doc: typed,
      onChange: (doc: Text) => {
        typed = doc.toString()
      },
      notes: links.index(canvasPath),
      // A `[[` picked in a card is spelled the way one picked in a note is; see
      // composer.ts.
      writeLink: pickedLink,
      // The plane's own answer about its HTML, which is the surface's; see
      // trust.ts.
      trustedMarkup: trusted,
      ...(onfollow ? { openNote: onfollow } : {}),
      openLink: (href: string) => void openExternal(href),
      shortcuts: shortcuts.forEditor,
    })
    editor.focus()

    return {
      destroy: () => {
        ontext?.(typed)
        editor?.destroy()
        editor = undefined
      },
    }
  }

  onDestroy(() => {
    editor?.destroy()
    editor = undefined
  })

  /** The one press a rendered card has of its own: a click-to-load embed swaps its
   *  frame in where the card was, rather than sending the reader out to the page.
   *
   *  The same listener the reading view and the editor's live preview use, so what a
   *  card does is decided in one place and a canvas is not a surface with a bargain
   *  of its own; see web-frame.ts in @nib/editor. Everything else about a press on a
   *  card belongs to the surface, which is why this is the card's only handler: a
   *  card that loaded a frame is still a card that was picked. */
  function embeds(host: HTMLElement) {
    return { destroy: embedClicks(host) }
  }

  /** Escape leaves the card. Everything else belongs to the editor inside it,
   *  including the keys that would otherwise reach the canvas: a card being
   *  written in is a text field, and Delete in one deletes a character. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      event.stopPropagation()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onleave?.()
  }
</script>

<div
  class="node"
  class:picked
  class:dimmed
  class:group={node.type === 'group'}
  class:shape={node.type === 'shape'}
  class:editing
  class:coloured={colour !== null}
  data-id={node.id}
  style:left="{node.x}px"
  style:top="{node.y}px"
  style:width="{node.width}px"
  style:height="{node.height}px"
  style:translate="{offset.x}px {offset.y}px"
  style:--card-colour={colour}
>
  {#if node.type === 'text'}
    {#if editing}
      <div class="editor" use:edit onkeydowncapture={onKey}></div>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the reader's own note, through the same renderer the reading view uses -->
      <div class="card page nib-rendered" use:embeds>{@html html}</div>
    {/if}
  {:else if node.type === 'file'}
    {#if isPicture(node.file)}
      {#if broken}
        <!-- A reference into a space that no longer holds the picture. Quiet, and
             still the size and the place somebody put it. -->
        <p class="missing">{t('Nothing here')}</p>
      {:else}
        <img
          class="picture"
          src={fileUrl(node.file, root)}
          alt={node.file}
          draggable="false"
          onerror={() => (broken = true)}
        />
      {/if}
    {:else if html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note this card names, through the same renderer the reading view uses -->
      <div class="card page embed nib-rendered" use:embeds>{@html html}</div>
    {:else}
      <p class="missing">{t('Nothing here')}</p>
    {/if}
  {:else if node.type === 'link'}
    <div class="card link">
      <span class="host">{host}</span>
      <span class="url">{node.url}</span>
    </div>
  {:else if node.type === 'shape'}
    <svg
      class="drawn"
      class:filled={node.fill}
      viewBox="0 0 {node.width} {node.height}"
      width={node.width}
      height={node.height}
      aria-hidden="true"
    >
      {#if node.shape === 'rect'}
        <rect
          x="1"
          y="1"
          width={Math.max(0, node.width - 2)}
          height={Math.max(0, node.height - 2)}
          rx="4"
        />
      {:else if node.shape === 'ellipse'}
        <ellipse
          cx={node.width / 2}
          cy={node.height / 2}
          rx={Math.max(0, node.width / 2 - 1)}
          ry={Math.max(0, node.height / 2 - 1)}
        />
      {:else if drawing}
        <path class={drawing.open ? 'stroke' : 'body'} d={drawing.d} />
        {#if head}
          <path
            class="point"
            d="M 0 0 L {-head.size} {-head.size * 0.5} L {-head.size} {head.size * 0.5} Z"
            transform="translate({head.x} {head.y}) rotate({head.angle})"
          />
        {/if}
      {/if}
    </svg>

    <!-- A shape in a diagram is nearly always a shape with a name in it, so it holds
         words the way a card does, through the same renderer. -->
    {#if editing}
      <div class="editor inside" use:edit onkeydowncapture={onKey}></div>
    {:else if html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the reader's own words, through the same renderer the reading view uses -->
      <div class="card page inside nib-rendered">{@html html}</div>
    {/if}
  {:else if node.type === 'group' && node.label}
    <span class="label">{node.label}</span>
  {/if}
</div>

<style>
  /* Absolute at its own plane coordinates: the surface moves the plane, never
     the cards. */
  .node {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--card-colour, var(--line-strong));
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    /* The pointer belongs to the surface, which decides what a press means. */
    touch-action: none;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  /* A card with a colour wears it as a breath of it behind the words, so a
     coloured card still reads as paper rather than as a block of paint. */
  .node.coloured {
    background: color-mix(in srgb, var(--card-colour) 9%, var(--surface));
  }

  /* Narrowed to something else: still there, still where it was, and quietly
     out of the way. */
  .node.dimmed {
    opacity: 0.25;
  }

  .node.picked {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent),
      var(--shadow-md);
  }

  .node.editing {
    box-shadow: var(--shadow-md);
  }

  /* A group is room with a name on it: a frame, and nothing in the middle to
     get in the way of what sits inside it. */
  .node.group {
    background: color-mix(in srgb, var(--card-colour, var(--muted)) 7%, transparent);
    border-style: dashed;
    border-radius: var(--radius-lg);
    box-shadow: none;
    overflow: visible;
  }

  /* A shape is what it is drawn as: no card behind it, no frame round it. */
  .node.shape {
    background: none;
    border: none;
    box-shadow: none;
    overflow: visible;
  }

  .node.shape.picked {
    box-shadow: none;
  }

  .drawn {
    display: block;
    overflow: visible;
    fill: none;
    stroke: var(--card-colour, var(--text-strong));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A filled shape wears its colour as a breath of it, the way a coloured card does,
     so words inside one are still words on paper. */
  .drawn.filled rect,
  .drawn.filled ellipse,
  .drawn.filled .body {
    fill: color-mix(in srgb, var(--card-colour, var(--muted)) 14%, transparent);
  }

  .drawn .point {
    fill: var(--card-colour, var(--text-strong));
    stroke: none;
  }

  /* The words inside a shape, over the shape and in the middle of it: a diamond with
     a name in it is a name in a diamond, not a name beside one. */
  .inside {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
    pointer-events: none;
  }

  /* Being written in is the one time the words take the pointer back. */
  .editor.inside {
    pointer-events: auto;
    height: auto;
    text-align: start;
  }

  /* As tall as what is in it rather than as tall as the shape, so the line being
     typed sits where the line being read sat: in the middle. */
  .editor.inside :global(.cm-editor) {
    height: auto;
  }

  .label {
    position: absolute;
    left: 2px;
    bottom: 100%;
    padding: 2px 6px;
    color: var(--card-colour, var(--muted-strong));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    white-space: nowrap;
  }

  .card {
    width: 100%;
    height: 100%;
    padding: 8px 12px;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-content);
    font-size: 13px;
    line-height: 1.55;
  }

  /* A card is a page a couple of inches across, so the rendered markdown is
     tightened rather than left at document spacing: the same shapes, closer
     together. */
  .card.page :global(> :first-child) {
    margin-top: 0;
  }

  .card.page :global(> :last-child) {
    margin-bottom: 0;
  }

  .card.page :global(h1),
  .card.page :global(h2),
  .card.page :global(h3) {
    margin: 0 0 4px;
    font-size: 1.15em;
    line-height: 1.3;
    color: var(--text-strong);
  }

  .card.page :global(p) {
    margin: 0 0 6px;
  }

  .card.page :global(ul),
  .card.page :global(ol) {
    margin: 0 0 6px;
    padding-inline-start: 1.2em;
  }

  .card.page :global(img) {
    max-width: 100%;
  }

  .card.page :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .card.page :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  /* An embedded note is somebody else's words, so it reads a shade quieter than
     a card of your own. */
  .embed {
    color: var(--muted-strong);
  }

  .picture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
  }

  .link {
    display: flex;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
  }

  .host {
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url {
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .missing {
    margin: 0;
    padding: 8px 12px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .editor {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* The editor fills the card it was mounted in, and scrolls inside it: a card
     is as big as somebody made it, and the words go in it rather than the other
     way about. */
  .editor :global(.cm-editor) {
    height: 100%;
  }

  /* The writing surface carries Typora's `#write`, which in the app is the page
     column: a measure, a margin that centres it, and half a screen of padding
     underneath. A card is not a page, so inside one it is the card - at the same
     size and in the same place as the rendered words it replaces, which is what
     makes double-clicking one read as the card opening rather than as something
     else arriving. */
  .editor :global(#write) {
    max-width: none;
    margin: 0;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.55;
  }
</style>
