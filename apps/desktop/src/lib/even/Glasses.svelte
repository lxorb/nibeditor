<script lang="ts">
  /** The region of the note that is on the glasses, marked in the plugin.
   *
   *  A white card over exactly the characters the panel is showing, with the rest of
   *  the note faded behind it. It is the one thing the plugin adds to the editor, and
   *  it is what makes the binding legible: without it the glasses are a second screen
   *  showing something; with it they are showing *that*.
   *
   *  A card rather than an outline, which is what it was: an outline is a border
   *  somebody has to look for, and this has to answer a glance. It follows the words
   *  while the finger drags and springs into place when it lets go, and it is hidden
   *  the moment anything is over the note - a sheet, the settings - because a mark on
   *  a note has no business floating over a panel.
   *
   *  Drawn from the editor's own coordinates rather than guessed at from a fraction
   *  of the document. `coordsAtPos` is what CodeMirror uses to put its own cursor
   *  somewhere, so the frame lands on the same pixel the words do whatever the line
   *  heights are.
   *
   *  The other half of the scroll binding lives here too: the scroller says where the
   *  top of the viewport is, `posAtCoords` turns that into a place in the note, and
   *  the glasses go to the page that holds it. */

  import { onMount } from 'svelte'
  import { account } from '../account.svelte'
  import { bridge } from './bridge.svelte'
  import { Frame, MOVE } from './frame.svelte'
  import { settings } from '../settings.svelte'
  import { viewport } from '../viewport.svelte'
  import { views } from '../views.svelte'
  import { workspace } from '../workspace.svelte'

  const voice = $derived(bridge.voiceState)

  /** How often the phone's own scroll is turned into a page.
   *
   *  A scroll fires every frame and a page costs radio, so the reader's thumb is
   *  read at a sensible rate rather than at sixty hertz. */
  const SCROLLED = 120

  /** The smallest a frame may be, so that a page of one short line is still a
   *  rectangle rather than a line. */
  const LEAST = 26

  interface Box {
    top: number
    left: number
    width: number
    height: number
    /** True when the frame is only part of the region, because the rest of it has
     *  scrolled off the top or the bottom of the editor. */
    cut: boolean
  }

  let box = $state<Box | null>(null)
  /** Following a finger, or springing into place, or neither. The one part of this
   *  that is a decision rather than a measurement, and the part with a test; see
   *  frame.svelte.ts. */
  const frame = new Frame()

  const showing = $derived(bridge.showing)

  /** Anything the app has put over the note, from the app's own stores.
   *
   *  Emil: *"when I open the sidebar I can still see that frame."* The sidebar was
   *  the one thing missing from the list, and it is the one a reader opens twenty
   *  times an hour: on a phone it is a drawer over the note rather than a column
   *  beside it, so the card was left floating on top of the file list. On a desktop
   *  the same panel covers nothing, which is why the drawer is asked about rather
   *  than the panel. */
  let overlaid = $state(false)
  const covered = $derived(
    overlaid || settings.open || account.open || (viewport.drawer && !!workspace.panel),
  )

  /** The region of the note a card is drawn around. */
  interface Region {
    from: number
    to: number
  }

  /** The editor in the pane that has the focus, if it is showing a note. */
  function editor() {
    const tab = workspace.active
    if (tab?.kind !== 'note') return null

    return views.of(tab.paneId) ?? null
  }

  /** Where the page on the glasses is, in the window's own pixels.
   *
   *  `coordsAtPos` answers null for a position the editor has not drawn - most of a
   *  long note, most of the time - so both ends are asked for and either one is
   *  enough to place the frame. Clamped to the editor, and null when the region has
   *  scrolled out of it altogether: a frame pinned to an edge with no words in it is
   *  worse than no frame. */
  function measure(where: Region | null): Box | null {
    const view = editor()
    if (!view || !where) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    const length = view.state.doc.length
    const from = view.coordsAtPos(Math.min(where.from, length))
    const to = view.coordsAtPos(Math.max(0, Math.min(where.to, length) - 1))
    if (!from && !to) return null

    const first = from?.top ?? to?.top ?? 0
    const last = to?.bottom ?? from?.bottom ?? 0
    if (last <= rect.top || first >= rect.bottom) return null

    const top = Math.max(first, rect.top)
    const bottom = Math.min(last, rect.bottom)
    return {
      top,
      left: rect.left,
      width: rect.width,
      height: Math.max(LEAST, bottom - top),
      cut: first < rect.top || last > rect.bottom,
    }
  }

  /** The place in the note at the top of the editor's own viewport.
   *
   *  What the glasses are taken to. Not the caret: a reader scrolls to read, and what
   *  they are looking at is the top of the screen rather than wherever they last
   *  typed. */
  function atTop(): number | null {
    const view = editor()
    if (!view) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    return view.posAtCoords({ x: rect.left + 8, y: rect.top + 4 }, false)
  }

  onMount(() => {
    let waiting: ReturnType<typeof setTimeout> | undefined
    let painting = 0
    let looping = 0
    let watched: HTMLElement | null = null
    /** What the card is drawn around: the region the glasses are showing, or - while
     *  a finger is dragging - the region the note is passing over. */
    let region: Region | null = null

    const paint = () => {
      box = measure(region ?? showing)
    }

    const remeasure = () => {
      // A drag is already painting every frame; a second timer would only fight it.
      if (looping) return

      cancelAnimationFrame(painting)
      // After the browser has laid out whatever moved: an edit, a page turn, a
      // resize. One frame is enough and two would be a flicker.
      painting = requestAnimationFrame(() => {
        painting = 0
        paint()
      })
    }

    /** One frame of a drag.
     *
     *  The card is measured from where the note *is* rather than from where the
     *  glasses have been told to be, because being told costs a tenth of a second of
     *  waiting and a page of radio and neither belongs in front of a moving thumb.
     *  `regionAt` is arithmetic over pages the session has already cut, so this is a
     *  lookup and a measurement per frame and nothing else.
     *
     *  Not while the plugin is steering: that scroll is a page turn moving the phone,
     *  and the card belongs where the glasses are rather than on every line the note
     *  passes through on its way there. */
    const follow = () => {
      if (!frame.following) {
        looping = 0
        region = null
        paint()
        return
      }

      if (!bridge.steering) {
        const at = atTop()
        region = at === null ? null : bridge.regionAt(at)
      }

      paint()
      looping = requestAnimationFrame(follow)
    }

    const scrolled = () => {
      frame.scrolled()
      if (!looping) looping = requestAnimationFrame(follow)

      clearTimeout(waiting)
      waiting = setTimeout(() => {
        const at = atTop()
        if (at !== null) bridge.scrolled(at)
      }, SCROLLED)
    }

    /** Anything else over the note: a sheet, a dialog, a picker. The stores answer
     *  for the sidebar, the settings and the sign-in; this is the catch-all, because
     *  half a dozen things can be over a note and they have one thing in common -
     *  they are in the document. One query beats six imports and cannot fall behind
     *  one of them being added. */
    const look = () => {
      overlaid = document.querySelector('.sheet, dialog[open], [role="dialog"]') !== null
    }

    // The scroller is the editor's own, and a pane rebuilds its editor when it
    // changes note, so it is found again rather than held.
    const attach = () => {
      const found = editor()?.scrollDOM ?? null
      if (found === watched) return

      watched?.removeEventListener('scroll', scrolled)
      watched = found
      found?.addEventListener('scroll', scrolled, { passive: true })
      remeasure()
    }

    const every = setInterval(attach, 250)
    // The same beat looks for anything over the note. A quarter of a second is far
    // faster than a reader can open a sheet and read what is in it, and it costs one
    // selector query.
    const watching = setInterval(look, 250)
    window.addEventListener('resize', remeasure)
    attach()
    look()

    // The page turned: spring to it, once.
    let was = -1
    const turned = $effect.root(() => {
      $effect(() => {
        const page = showing?.page ?? -1
        if (page !== was) {
          was = page
          frame.turned()
        }

        remeasure()
      })
    })

    return () => {
      turned()
      clearInterval(every)
      clearInterval(watching)
      clearTimeout(waiting)
      frame.stop()
      cancelAnimationFrame(painting)
      cancelAnimationFrame(looping)
      window.removeEventListener('resize', remeasure)
      watched?.removeEventListener('scroll', scrolled)
    }
  })
</script>

<!-- Which way the plugin is listening, and how far it got, for the browser drive
     and for nothing else. Hidden: it is four facts that answer "why did the voice do
     nothing", and they cost a reader a panel over their note to look at. Emil, on his
     own glasses, on that panel: "that ugly listening overlay". So it went, and the
     facts are still here, at no cost on screen at all. See voice.ts. -->
<div
  hidden
  data-voice="{voice.path} {voice.on ? 'on' : 'off'} {String(voice.frames)} frames{voice.nothing
    ? ' nothing'
    : ''}{voice.trouble ? ` ${voice.trouble}` : ''}{voice.detail ? ` ${voice.detail}` : ''}"
  data-heard={voice.heard}
  data-took={voice.took
    ? `${String(voice.took.spoke)} spoke ${String(voice.took.hang)} hang ${String(voice.took.sent)} sent`
    : ''}
></div>

<!-- What the glasses are showing, marked on the note.

     One outline in the accent around exactly those characters, and **nothing over the
     words**. It was a white card with the rest of the note faded behind it, and on a
     phone that came out as a note nobody could read: the hole in the fade was cut with
     `mix-blend-mode: destination-out`, which is not a blend mode at all - the value
     belongs to canvas compositing - so no hole was ever cut and the whole note took a
     shade over it. Emil: "the note on the phone is very dark and hardly visible."

     So the mark is back to what it was and will stay there. A frame around the words
     costs the reading nothing, and nothing that dims a note is worth a mark on it. -->
{#if box}
  <div
    class="frame"
    class:moving={frame.moving}
    class:cut={box.cut}
    class:gone={covered}
    aria-hidden="true"
    style:top="{box.top}px"
    style:left="{box.left}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:--move="{MOVE}ms"
  ></div>
{/if}

<style>
  /* The app's own shape: the same radius, the same accent, the same easing as
     anything else that marks a region. Fixed, because the measurement is in the
     window's pixels and a plugin must not have to find a positioned ancestor inside
     somebody else's component.

     No background and no shadow. The words inside it are the note's own and are read
     through it, so the frame is an edge and nothing else; see the markup above for
     what happened the one time it was more than that. */
  .frame {
    position: fixed;
    z-index: var(--z-drawn);
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    border-radius: var(--radius-md);
    opacity: 0.5;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* While the page is turning, or while a drag has just let go: a short spring into
     place. Not while the reader is dragging - a frame that eases its way down a
     scroll lags behind the words it is meant to be around. */
  .moving {
    transition:
      top var(--move) var(--ease-spring),
      height var(--move) var(--ease-spring),
      opacity var(--dur-fast) var(--ease-out);
  }

  /* Part of the region is off the screen, so the frame is not the whole of it: the
     edge it was cut at is left open rather than drawn as a boundary that is not
     there. */
  .cut {
    border-radius: 0;
    opacity: 0.35;
  }

  /* Something is over the note - the sidebar, the settings, a sheet - so the mark on
     the note is not drawn. Faded rather than dropped, because a card that vanishes
     the instant a drawer starts to open reads as a glitch, and because it has to come
     back when the note is bare again. Emil: "when I open the sidebar I can still see
     that frame."

     Last of the three, so it wins over the cut frame's own opacity. */
  .gone {
    opacity: 0;
  }
</style>
