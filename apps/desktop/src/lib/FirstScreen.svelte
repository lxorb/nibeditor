<script lang="ts">
  /** The first screen of the note a window was left on, drawn where its editor will
   *  be until the editor has drawn itself; see first-screen.svelte.ts. Inside the
   *  panes area, which is what it was measured against. */
  import { documentOf, parsedOnScreen } from '@nib/editor'
  import { firstScreen, type Kept, sameNote } from './first-screen.svelte'
  import { mark } from './trace'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const kept = $derived(firstScreen.showing)

  /** How many frames the drawing waits for the editor's words to be parsed before it
   *  hands over regardless: a second's worth. */
  const MOST_FRAMES = 60

  /** The drawing, built out of what was kept: the surface, the editor, its scroller
   *  and its content, each wearing what it wore, and the lines inside. Built here and
   *  not in markup because every class and style on the way down is the kept one.
   *  Measured before it is shown - the frame it goes out in is the launch's first -
   *  and dropped there and then if the area or the type is not what it was. */
  function drawn(node: HTMLElement, what: Kept) {
    const area = node.parentElement
    if (!area) return

    // First in the head, where CodeMirror puts its own: the app's sheets come after
    // and win every tie, which is what they do over a live editor.
    const style = document.createElement('style')
    style.textContent = what.css
    document.head.prepend(style)

    const [surface, editor, scroller, content] = what.levels.map((one) => {
      const element = document.createElement(one.tag)
      element.className = one.className
      if (one.style) element.setAttribute('style', one.style)
      return element
    })
    if (!surface || !editor || !scroller || !content) return

    const spacer = document.createElement('div')
    spacer.style.height = `${String(what.inset)}px`
    content.style.transform = `translateY(${String(what.shift)}px)`
    content.innerHTML = what.lines
    content.prepend(spacer)
    scroller.append(content)
    editor.append(scroller)
    surface.append(editor)
    surface.style.height = '100%'
    node.append(surface)

    const now = getComputedStyle(content)
    const same =
      Math.abs(area.clientWidth - what.area.width) < 1 &&
      Math.abs(area.clientHeight - what.area.height) < 1 &&
      Object.entries(what.look).every(([name, value]) =>
        name === 'left'
          ? `${String(Math.round(content.getBoundingClientRect().left - surface.getBoundingClientRect().left))}px` ===
            value
          : now.getPropertyValue(name) === value,
      )
    if (!same) {
      style.remove()
      firstScreen.drop()
      return
    }

    // Rising in the editor's place, the way the writing surface arrives when the app
    // opens; the editor that takes over does not rise again. See Editor.svelte.
    if (firstScreen.rise()) surface.classList.add('rise')
    mark('first screen drawn')

    // A window made another size lays the lines out another way: what was kept is
    // no longer what the editor will draw.
    const resized = new ResizeObserver(() => {
      if (
        Math.abs(area.clientWidth - what.area.width) >= 1 ||
        Math.abs(area.clientHeight - what.area.height) >= 1
      ) {
        firstScreen.drop()
      }
    })
    resized.observe(area)

    return {
      destroy() {
        resized.disconnect()
        style.remove()
      },
    }
  }

  // Handed to the editor once it holds the note, on the frame after its own first one
  // is on screen; dropped at once if the launch put another note in front.
  $effect(() => {
    const what = firstScreen.showing
    if (!what) return

    const active = workspace.active
    if (!active) {
      if (workspace.restored) firstScreen.drop()
      return
    }
    if (!sameNote(active.path, what.path) || active.kind !== 'note' || active.reading) {
      firstScreen.drop()
      return
    }

    const view = views.of(workspace.panes.focusedId)
    if (!view || documentOf(view) !== active.note.live) return

    // The editor's own first frames go under the drawing: measured, scrolled to the
    // place, and parsed as far as it shows, which on a slow machine takes a few (see
    // parse-ahead.ts in @nib/editor). Then one more for what the parse decorated to be
    // drawn, lined up with the drawing, and one for that to be drawn before it goes.
    let frame = 0
    let waited = 0
    const settle = () => {
      frame = requestAnimationFrame(() => {
        if (!parsedOnScreen(view) && ++waited < MOST_FRAMES) {
          settle()
          return
        }
        frame = requestAnimationFrame(() => {
          firstScreen.lineUp(view, what)
          frame = requestAnimationFrame(() => firstScreen.handTo(view))
        })
      })
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  })

  /** A key typed at the drawing, which is typed at the note: kept for the editor.
   *  Only words, and only where nothing else has the keyboard. */
  function typing(event: KeyboardEvent) {
    if (!firstScreen.showing || event.target !== document.body) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return

    const typed = event.key === 'Enter' ? '\n' : event.key.length === 1 ? event.key : null
    if (typed === null) return

    event.preventDefault()
    event.stopPropagation()
    firstScreen.typed += typed
  }
</script>

<svelte:window onkeydowncapture={typing} />

{#if kept}
  <!-- Not a control: a press on it is where the caret goes, once there is a caret. -->
  <div
    class="first"
    aria-hidden="true"
    style:left="{kept.box.left}px"
    style:top="{kept.box.top}px"
    style:width="{kept.box.width}px"
    style:height="{kept.box.height}px"
    use:drawn={kept}
    onpointerdown={(event: PointerEvent) => {
      event.preventDefault()
      firstScreen.pressed = { x: event.clientX, y: event.clientY }
    }}
  ></div>
{/if}

<style>
  /* Over the pane it stands in for, on the pane's own paper: the pane underneath has
     nothing in it yet but the ground. */
  .first {
    position: absolute;
    z-index: var(--z-raised);
    overflow: hidden;
    background: var(--bg);
  }
</style>
