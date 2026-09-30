/** Ctrl and the wheel over a note, which is how a reader has changed the size of
 *  text since the first browser had a zoom.
 *
 *  What it changes is the app's own text size - `--zoom`, the same value the
 *  slider in Appearance sets and the same one the keys step - and not the
 *  webview's zoom. Those are two different things that look alike for one notch:
 *  the webview's would scale the chrome, the panel and the tab strip with the
 *  words, would not be remembered, and would not reach the phone or the browser
 *  build. So the app takes the gesture: the listener is not passive and it
 *  prevents the default, which is what stops WebView2 and WKWebView from zooming
 *  underneath us. The hotkeys are off in the window's own configuration for the
 *  same reason; see src-tauri/tauri.conf.json.
 *
 *  Over the note and nowhere else. `#write` is the writing surface - the editor,
 *  the reading view and a slide all carry it - and the surfaces that have a zoom
 *  of their own (the canvas, the graph, a page note) handle the same gesture on
 *  their own element and prevent it there, so a wheel they have answered is one
 *  this stands down on. */

import { modes } from './modes.svelte'

/** What one wheel event over the note should do to the text size: a notch in, a
 *  notch out, or nothing at all.
 *
 *  Pure, because this is the whole of the decision and the rest is one call.
 *  Ctrl rather than Mod: a trackpad pinch arrives as Ctrl and the wheel on every
 *  platform, which is the gesture a Mac reader makes, and Cmd and the wheel is
 *  not a gesture anybody makes. */
export function sizeStepFor(
  event: { ctrlKey: boolean; deltaY: number; defaultPrevented: boolean },
  overNote: boolean,
): number {
  if (!event.ctrlKey || event.defaultPrevented || !event.deltaY || !overNote) return 0

  // Up is bigger, which is the way round every other zoom on every platform
  // reads: a wheel pushed away from the reader brings the words closer.
  return event.deltaY < 0 ? 1 : -1
}

/** Whether what the wheel was over is the note: a page a note is written or read
 *  on, which the editor, the reading view and a slide all are; see write.ts in
 *  @nib/themes. */
function overNote(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.nib-write')
}

/** Listens for it, and answers how to stop.
 *
 *  On the window rather than on the surface: the editor is rebuilt whenever a
 *  note opens and a listener on it would have to be rebuilt with it, and the
 *  bubble phase is what lets the surfaces with their own zoom answer first. */
export function watchTextSize(): () => void {
  const onWheel = (event: WheelEvent) => {
    const step = sizeStepFor(event, overNote(event.target))
    if (!step) return

    // Before the step, so a browser that would have zoomed the page does not,
    // whether or not the size had anywhere left to go.
    event.preventDefault()
    modes.stepZoom(step)
  }

  // Not passive, or the default cannot be prevented: a wheel listener on the
  // window is passive unless it says otherwise.
  window.addEventListener('wheel', onWheel, { passive: false })
  return () => window.removeEventListener('wheel', onWheel)
}
