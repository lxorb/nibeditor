<script module lang="ts">
  import { owes, writing } from '../parting'

  /** The write a window going owes, while a card is up; see parting.ts. */
  let owing: (() => void) | null = null
  owes(() => owing?.())

  /** Where the caret was when the card last went, for the next time it comes. */
  let caret: number | null = null
</script>

<script lang="ts">
  /** The scratchpad's card: the note's own live-preview editor, built as the card comes
   *  and gone with it, the way the hover card's is (preview-card.ts). Written a pause
   *  after the typing stops, and at once as the card goes or the window does - no dot,
   *  nothing to save. Its edge widens it; Escape puts it away. See pad.ts. */
  import { createEditor, EditorView, modeEffects } from '@nib/editor'
  import { onMount } from 'svelte'
  import { SAVE_DELAY } from '../backoff'
  import { pickedLink } from '../composer'
  import { readingFactor } from '../direction'
  import { t } from '../i18n.svelte'
  import { adrift, pressedThrough } from '../keyboard-home'
  import { links } from '../link-index.svelte'
  import { modes } from '../modes.svelte'
  import { followHref, followNote } from '../open-link'
  import { PROPERTY_CHOICES } from '../property-choices'
  import { shortcuts } from '../shortcuts.svelte'
  import { afterQuiet } from '../timing'
  import { writeFile } from '../workspace/write-file'
  import { scratchpad } from './pad'
  import { shown, WIDTH } from './is.svelte'

  const NARROWEST = 240
  const WIDEST = 560
  const fit = (width: number) => Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))

  let host: HTMLDivElement
  let view = $state<EditorView | null>(null)
  let path: string | null = null
  /** Typed since the last write. */
  let owed = false
  let resizing = $state(false)

  function flush() {
    save.cancel()
    if (!owed || path === null || !view) return
    owed = false
    writing(writeFile(path, view.state.doc.toString()))
  }
  const save = afterQuiet(flush, SAVE_DELAY)

  onMount(() => {
    const going = new AbortController()
    void (async () => {
      path = await scratchpad.where()
      // Read as it comes rather than kept: another window may have written it since.
      const text = await scratchpad.text()
      if (going.signal.aborted) return

      const made = createEditor({
        parent: host,
        doc: text,
        selection: { anchor: Math.min(caret ?? text.length, text.length) },
        onChange: () => {
          owed = true
          save()
        },
        notes: links.index(path),
        openNote: followNote,
        openLink: followHref,
        writeLink: pickedLink,
        shortcuts: shortcuts.forEditor,
        propertyChoices: PROPERTY_CHOICES,
        // Where pastes from anywhere go, so its markup is never run.
        trustedMarkup: false,
      })
      made.dispatch({ effects: modeEffects(modes.settings) })
      view = made
      scratchpad.live = made
      owing = flush
    })()

    return () => {
      going.abort()
      flush()
      owing = null
      scratchpad.live = null
      caret = view?.state.selection.main.head ?? caret
      view?.destroy()
    }
  })

  // Asked for by a person: the keyboard in, remembering where it was for the way back.
  $effect(() => {
    if (!shown.calling || !view) return
    shown.calling = false

    const at = document.activeElement
    if (at instanceof HTMLElement && !host.contains(at) && !adrift(at) && !pressedThrough(at)) {
      shown.from = at
    }
    view.focus()

    const line = scratchpad.line
    scratchpad.line = null
    if (line === null) return
    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
  })

  /** Escape the editor had no use for puts the card away. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    shown.hide()
  }

  /** The edge faces the note, so dragging it towards the note widens the card. */
  function grab(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const edge = event.currentTarget as HTMLElement
    edge.setPointerCapture(event.pointerId)
    const from = event.clientX
    const was = shown.width
    resizing = true
    const move = (one: PointerEvent) =>
      shown.resize(fit(was - (one.clientX - from) * readingFactor()))
    const done = () => {
      resizing = false
      edge.removeEventListener('pointermove', move)
    }
    edge.addEventListener('pointermove', move)
    edge.addEventListener('lostpointercapture', done, { once: true })
  }

  function onEdgeKey(event: KeyboardEvent) {
    const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    shown.resize(fit(shown.width + step * readingFactor()))
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card nib-layer" class:resizing onkeydown={onKey}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="edge"
    role="separator"
    aria-orientation="vertical"
    aria-label={t('Panel width')}
    aria-valuemin={NARROWEST}
    aria-valuemax={WIDEST}
    aria-valuenow={shown.width}
    tabindex="0"
    title={t('Drag to resize')}
    onpointerdown={grab}
    ondblclick={() => shown.resize(WIDTH)}
    onkeydown={onEdgeKey}
  ></div>
  <div class="host" bind:this={host}></div>
</div>

<style>
  /* The column App.svelte keeps for the card: its width is the card's own. */
  :global([data-scratchpad]) {
    flex: none;
    max-width: 60%;
    padding: var(--space-2);
  }

  /* Where the panels are drawers, or the window is too narrow for two columns, over
     the note. */
  :global(:is([data-drawer], [data-narrow]) [data-scratchpad]) {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: var(--z-lifted);
    max-width: 100%;
  }

  .card {
    position: relative;
    height: 100%;
    display: flex;
    min-width: 0;
    overflow: hidden;
  }

  .host {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .host :global(.cm-editor) {
    flex: 1;
    min-width: 0;
    background: none;
  }

  /* A card's worth of margin rather than a page's. */
  .host :global(#write) {
    max-width: none;
    margin: 0 var(--space-4);
    padding: var(--space-4) 0 var(--space-7);
  }

  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: 0;
    width: 6px;
    z-index: var(--z-lifted);
    cursor: col-resize;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: var(--radius-md);
    bottom: var(--radius-md);
    inset-inline-start: 0;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  .resizing .edge::after {
    background: var(--accent);
  }
</style>
