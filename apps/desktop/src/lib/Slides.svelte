<script lang="ts">
  /** A note presented.
   *
   *  The deck covers the window with nothing on it but the slide, a hairline
   *  saying how far through it is, and a counter that appears when the deck
   *  moves and goes again. The slides are the note through the renderer the
   *  reading view uses, laid out on a stage of a fixed size and scaled to
   *  whatever screen this is - so the words never reflow between the laptop
   *  they were written on and the projector they end up on.
   *
   *  Nothing here writes to the note, and the note stays open behind it: typing
   *  in another pane, or a change a sync brought over, redraws the slide that is
   *  up without leaving the place in the deck.
   */

  import { onDestroy, tick } from 'svelte'
  import { loadEmbed } from '@nib/editor'
  import { claimsGesture } from './swipe'
  import { menu } from './menu.svelte'
  import { overlays } from './overlays'
  import { trustsHtmlIn } from './sharing.svelte'
  import { deckHtml, type StageSlide } from './slides/render'
  import {
    openPresenter,
    presenterChannel,
    closePresenter,
    secondScreen,
    type Channel,
    type Message,
  } from './slides/presenter'
  import { fitSurface } from './slides/fit'
  import { present } from './slides/present.svelte'
  import {
    axesOf,
    back,
    clamp,
    forward,
    type Move,
    type Place,
    moveBetween,
    shownFragments,
    STAGE_HEIGHT,
    STAGE_WIDTH,
    stageScale,
    START,
    stepsOf,
    toEnd,
    toSlide,
    typedSlide,
  } from './slides/stage'
  import { openExternal } from './tauri'
  import { theme } from './theme.svelte'
  import { views } from './views.svelte'
  import type { Tab } from './workspace.svelte'

  const { tab }: { tab: Tab } = $props()

  /** How long after the last keystroke elsewhere the deck is drawn again. The
   *  reading view's own pause, for the same reason: a burst of typing should
   *  cost one render. */
  const REDRAW = 200
  /** How long the counter stays up after the deck has moved. */
  const COUNTER = 1600
  /** How long a still pointer takes to disappear. */
  const STILL = 2000
  /** How far a finger travels before a swipe means the notes. Further than a
   *  sideways swipe needs, because the page under it does not scroll and a short
   *  flick up is usually somebody missing the tap. */
  const SHEET = 40

  let slides = $state<StageSlide[]>([])
  let place = $state<Place>(START)
  let move = $state<Move>(null)
  /** The digits somebody is typing to jump by number, before Enter. */
  let typed = $state('')
  let notesOpen = $state(false)
  let counting = $state(false)
  let still = $state(false)
  let scale = $state(0)

  let deck = $state<HTMLElement>()
  let page = $state<HTMLElement>()

  const steps = $derived(stepsOf(slides))
  const axes = $derived(axesOf(slides))
  const current = $derived(slides[place.slide])
  const next = $derived(slides[place.slide + 1])
  const count = $derived(slides.length)

  // ── The deck itself ────────────────────────────────────────────────

  /** Which render is the current one, so an older one that finishes later - the
   *  first, which waits for the parsers and the diagram drawers - cannot
   *  overwrite it. */
  let latest = 0
  let redraw: ReturnType<typeof setTimeout> | undefined
  let drawn = false

  async function draw() {
    const mine = ++latest
    tab.note.flush()
    const built = await deckHtml(
      { text: tab.doc, path: tab.path },
      theme.current,
      trustsHtmlIn(tab.note),
    )
    if (mine !== latest) return

    slides = built
    // The note may have lost the slide that was up while it was being typed in.
    place = clamp(stepsOf(built), place)
    fitted = []
  }

  // The first deck, and another whenever the words change under it or the scheme
  // its diagrams were drawn for changes. Exactly what the reading view watches.
  $effect(() => {
    const reasons = [tab.note.revision, theme.current]
    if (!reasons.length) return

    if (!drawn) {
      drawn = true
      void draw()
      return
    }

    clearTimeout(redraw)
    redraw = setTimeout(() => void draw(), REDRAW)
    return () => clearTimeout(redraw)
  })

  onDestroy(() => clearTimeout(redraw))

  // ── Fitting the stage, and the slide on it ─────────────────────────

  // The stage is scaled to the window rather than laid out to it, which is what
  // keeps a slide the same slide on every screen.
  $effect(() => {
    const room = deck
    if (!room) return

    const measure = () => {
      scale = stageScale(room.clientWidth, room.clientHeight)
    }

    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(room)
    return () => watcher.disconnect()
  })

  /** The size each slide's text settled at, by slide, so going back to one costs
   *  no measuring. Emptied whenever the note is drawn again. Nothing renders
   *  from it: it is a memo, not state. */
  let fitted: (number | undefined)[] = []

  /** The slide on screen, sized so it does not scroll; see slides/fit.ts. Going
   *  back to a slide costs no measuring. */
  function fit() {
    const surface = page
    if (!surface) return

    const known = fitted[place.slide]
    if (known !== undefined) {
      surface.style.setProperty('--stage-fit', String(known))
      return
    }

    fitted[place.slide] = fitSurface(surface)
  }

  /** Whether the fonts have arrived. Until they have, every measurement is of
   *  the fallback face and has to be taken again. Once, not per slide. */
  let facesReady = false

  // Fitted as the slide appears, and again once anything that changes its height
  // has arrived: a picture whose size the page did not know, or a maths font.
  $effect(() => {
    // Read, not used: a new slide or a redrawn deck is what this waits for.
    const reasons = [place.slide, slides]
    if (!reasons.length) return

    fit()

    const surface = page
    if (!surface) return

    const again = () => {
      fitted[place.slide] = undefined
      fit()
    }

    const pictures = [...surface.querySelectorAll('img')].filter((one) => !one.complete)
    for (const picture of pictures) picture.addEventListener('load', again, { once: true })

    if (!facesReady) {
      void document.fonts.ready.then(() => {
        facesReady = true
        fitted = []
        fit()
      })
    }

    return () => {
      for (const picture of pictures) picture.removeEventListener('load', again)
    }
  })

  // Which of the slide's `+` items are out. By their place among the items the
  // slide renders, which is what the deck parser counted; see slides.ts. An
  // embedded note's own list is not the slide's, and the parser never saw it, so
  // it is skipped here too.
  $effect(() => {
    const surface = page
    const waiting = current?.fragments ?? []
    if (!surface) return

    const items = [...surface.querySelectorAll('li')].filter(
      (item) => !item.closest('figure.embed'),
    )
    const shown = new Set(shownFragments(waiting, place.step))

    for (const [at, item] of items.entries()) {
      item.classList.toggle('fragment', waiting.includes(at))
      item.classList.toggle('shown', shown.has(at))
    }
  })

  // ── Moving ────────────────────────────────────────────────────────

  function go(to: Place) {
    if (to.slide === place.slide && to.step === place.step) return

    move = moveBetween(axes, place.slide, to.slide)
    place = to
    show()
  }

  function onwards() {
    go(forward(steps, place))
  }

  function backwards() {
    go(back(steps, place))
  }

  /** Brings the counter up, and takes it down again a moment later. */
  let counter: ReturnType<typeof setTimeout> | undefined

  function show() {
    counting = true
    clearTimeout(counter)
    counter = setTimeout(() => (counting = false), COUNTER)
  }

  onDestroy(() => clearTimeout(counter))

  // The counter is up as the deck opens, so nobody has to guess how long it is.
  // Once: a note being typed into in another pane redraws the deck, and the
  // counter flashing at every keystroke over there is somebody else's typing
  // showing up on a projector.
  let counted = false

  $effect(() => {
    if (!slides.length || counted) return

    counted = true
    show()
  })

  function leave() {
    // The caret follows onto the slide that was up: stopping to fix a word is
    // most of why anybody leaves a deck.
    const view = views.of(tab.paneId)
    const from = current?.from
    if (view && from !== undefined && from <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: from } })
    }

    present.stop()
  }

  // Escape closes the deck the way it closes everything else the app puts over
  // a note, and only when nothing newer is on top of it; see overlays.ts.
  $effect(() => overlays.show(leave))

  function onKeydown(event: KeyboardEvent) {
    // A key held with a modifier is one of the app's own, and the app reads it
    // off the same window: Ctrl+P is the palette, not the presenter's window.
    if (event.ctrlKey || event.metaKey || event.altKey) return

    // Something over the deck has the keyboard: a field being typed into - the
    // palette, a prompt - or a menu the arrows are walking down.
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
    if (menu.open) return

    // A number, then Enter, jumps. Held as it is typed and shown where the
    // counter is, so a slip is visible before it does anything.
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      typed = (typed + event.key).slice(-4)
      show()
      return
    }

    // Shift alone is somebody about to type a capital, not a slip that should
    // throw away the number they have started.
    const jumping = typed
    if (event.key !== 'Shift') typed = ''

    switch (event.key) {
      case 'Enter': {
        event.preventDefault()
        const wanted = typedSlide(jumping, count)
        if (wanted !== null) go(toSlide(steps, wanted))
        else onwards()
        return
      }
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Spacebar':
        event.preventDefault()
        onwards()
        return
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
        event.preventDefault()
        backwards()
        return
      case 'Home':
        event.preventDefault()
        go(toSlide(steps, 0))
        return
      case 'End':
        event.preventDefault()
        go(toEnd(steps))
        return
      case 'n':
      case 'N':
        event.preventDefault()
        notesOpen = !notesOpen
        return
      case 'p':
      case 'P':
        event.preventDefault()
        void openPresenter()
        return
      default:
        return
    }
  }

  /** Half the screen forwards, half back, which is how every deck anybody has
   *  used behaves. A link is a link, though: it is followed rather than counted
   *  as a press. */
  function onClick(event: MouseEvent) {
    const target = event.target as Element | null

    // The notes are read, not pressed: a tap in them is not a tap on the deck.
    if (target?.closest('.notes')) return

    // A card standing in for a page somewhere else shows that page here, in the
    // frame and the sandbox its provider needs, rather than sending the reader out
    // of the app or turning the slide under them. The card is a link so that a
    // published deck - which runs no script - still goes somewhere; here there is a
    // script. The same loader every other surface presses; see web-frame.ts.
    const card = target?.closest('.embed-web')
    if (card instanceof HTMLElement && loadEmbed(card)) {
      event.preventDefault()
      return
    }

    const href = target?.closest('a')?.getAttribute('href')
    if (href && /^[a-z][a-z\d+.-]*:/i.test(href)) {
      event.preventDefault()
      void openExternal(href)
      return
    }

    const room = deck
    if (!room) return

    const box = room.getBoundingClientRect()
    if (event.clientX - box.left < box.width / 2) backwards()
    else onwards()
  }

  /** A finger: sideways moves the deck, upwards asks for the notes. */
  let touch: { x: number; y: number } | null = null

  function onTouchStart(event: TouchEvent) {
    const finger = event.changedTouches[0]
    touch = finger ? { x: finger.clientX, y: finger.clientY } : null
  }

  function onTouchEnd(event: TouchEvent) {
    const from = touch
    const finger = event.changedTouches[0]
    touch = null
    if (!from || !finger) return

    const dx = finger.clientX - from.x
    const dy = finger.clientY - from.y

    if (claimsGesture(dx, dy)) {
      event.preventDefault()
      if (dx < 0) onwards()
      else backwards()
      return
    }

    // Up for the notes, down to put them away again.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SHEET) {
      event.preventDefault()
      notesOpen = dy < 0
    }
  }

  // The pointer disappears once it has been left alone, so a talk is the slide
  // and nothing else.
  $effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const wake = () => {
      still = false
      clearTimeout(timer)
      timer = setTimeout(() => (still = true), STILL)
    }

    wake()
    window.addEventListener('pointermove', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
    }
  })

  // ── The presenter's own window ─────────────────────────────────────

  let channel: Channel | null = null
  const started = Date.now()

  /** Everything the other window draws, as one message. */
  const broadcast = $derived<Message>({
    kind: 'stage',
    stage: {
      slide: current?.html ?? '',
      next: next?.html ?? '',
      shape: current?.shape ?? 'prose',
      nextShape: next?.shape ?? 'prose',
      notes: current?.notes ?? '',
      at: place.slide + 1,
      count,
      started,
      scheme: theme.current,
    },
  })

  $effect(() => {
    const line = presenterChannel((message) => {
      // A window that has just opened has nothing on it and nothing about the
      // deck is about to change, so it is told where the deck is.
      if (message.kind === 'here') {
        line.send(broadcast)
        return
      }

      // The other thing it says is which way to go, so somebody reading their
      // notes can move the deck without reaching for it.
      if (message.kind === 'move') {
        if (message.by > 0) onwards()
        else backwards()
      }
    })
    channel = line

    // On a machine with a screen the audience is not looking at, the notes
    // belong on it and nobody should have to ask. Anywhere else `P` asks.
    void secondScreen().then((other) => {
      if (other) void openPresenter()
    })

    return () => {
      line.send({ kind: 'gone' })
      line.close()
      channel = null
      void closePresenter()
    }
  })

  // Sent whole whenever any of it changes.
  $effect(() => {
    channel?.send(broadcast)
  })

  // The deck takes the keyboard the moment it opens, so the first arrow lands.
  $effect(() => {
    void tick().then(() => deck?.focus({ preventScroll: true }))
  })

  const stageStyle = $derived(
    `--stage-width: ${STAGE_WIDTH}px; --stage-height: ${STAGE_HEIGHT}px; --stage-scale: ${scale}`,
  )
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Focusable so the keys that move a deck reach it; nothing in it is a field,
     and there is no caret to draw. The click is read here rather than on each
     half, because a deck has no furniture: the halves are the screen. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
  class="deck nib-host"
  tabindex="-1"
  data-move={move ?? 'none'}
  data-still={still ? 'yes' : 'no'}
  style={stageStyle}
  bind:this={deck}
  onclick={onClick}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <div class="stage">
    {#key place.slide}
      <div class="slide" data-shape={current?.shape ?? 'prose'}>
        <div id="write" bind:this={page}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, through the renderer the reading view and every export use -->
          {@html current?.html ?? ''}
        </div>
      </div>
    {/key}
  </div>

  {#if notesOpen && current?.notes}
    <div class="notes">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words again, the part only the presenter reads -->
      {@html current.notes}
    </div>
  {/if}

  <div class="rail">
    <div class="run" style="--at: {count ? (place.slide + 1) / count : 0}"></div>
  </div>
  <div class="count" data-shown={counting ? 'yes' : 'no'}>
    {typed || place.slide + 1}/{count}
  </div>
</div>

<!-- Every rule a slide is drawn with is in packages/themes/src/slides.css,
     because an exported deck and a published one are drawn by the same ones and a
     slide has to look the same in all three. `.nib-host` above is the one rule
     that says a surface taking the keyboard so the keys reach it draws no ring. -->
