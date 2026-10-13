/** What backs a layer of ink.
 *
 *  `desynchronized` is not the same canvas with less latency. Chromium takes the
 *  element out of the page's paint order for it, gives it a compositor surface
 *  of its own and allocates its pixels as a buffer the display may scan out
 *  directly. Where that buffer keeps no alpha channel, a layer meant to be
 *  transparent composites as opaque black: the plane is black all over, and
 *  clearing the layer leaves black rather than nothing, so lifting the pen hides
 *  the stroke that was just written instead of settling it.
 *
 *  Nothing reports any of that. A 2d context's `getContextAttributes()` hands
 *  back the attributes it was asked for and says nothing about what was done
 *  with them, so a page cannot learn that the hint was taken and the alpha
 *  dropped. The hint is therefore asked for only where it is known to be
 *  honoured with alpha, what the browser does report is read as a ceiling and
 *  never as proof, and a layer whose backing is in any doubt is drawn the
 *  ordinary way. Ink that is there is worth more than ink that is there a frame
 *  sooner. */

/** Which backing a layer is drawn on: the low latency path, or the ordinary
 *  composited one. */
export type InkMode = 'latency' | 'plain'

/** What `getContext` is asked for in each mode. Transparency is written out
 *  rather than left to the default, and the pixels are never read back, so they
 *  can stay where they are drawn. */
const SETTINGS: Record<InkMode, CanvasRenderingContext2DSettings> = {
  latency: { alpha: true, desynchronized: true, willReadFrequently: false },
  plain: { alpha: true, desynchronized: false, willReadFrequently: false },
}

/** Platforms that hand a desynchronised layer a surface of their own whose alpha
 *  may not survive being composited. Android does, in Chrome and in every
 *  WebView an app embeds, which is where Orden runs on a tablet. */
const OVERLAID = /android/i

/** The user agent, where there is one. A server rendering the page and a test
 *  are both no platform in particular, and get the honest path. */
const AGENT = typeof navigator === 'undefined' ? '' : navigator.userAgent

export interface InkBacking {
  /** What the platform says it is, which is `navigator.userAgent`. */
  agent: string
  /** What a context that exists reports about itself, and `null` where there is
   *  no context yet, which is the question of what to ask the next one for. */
  reported: CanvasRenderingContext2DSettings | null
}

/** Which backing a layer of ink may have.
 *
 *  Answers the mode to ask for when nothing has been created yet, and the mode
 *  to keep once a context has spoken for itself. Every answer but one is
 *  `plain`, which is the point: the low latency path has to earn its place, and
 *  the ordinary one is always right. */
export function inkMode({ agent, reported }: InkBacking): InkMode {
  // The one thing no attribute answers, so the one thing the code has to know.
  if (OVERLAID.test(agent)) return 'plain'

  // No context yet, or an engine that does not answer for itself: worth asking,
  // and being refused costs nothing.
  if (!reported) return 'latency'

  // An opaque backing, admitted. Then a cleared layer is a black one.
  if (reported.alpha === false) return 'plain'

  // Refused, so there is no latency left to keep, and no reason to stay on the
  // path with the fewer guarantees.
  if (reported.desynchronized === false) return 'plain'

  return 'latency'
}

/** The mode to ask a layer for on this platform, before any context exists. */
export function wantedInkMode(): InkMode {
  return inkMode({ agent: AGENT, reported: null })
}

/** Modes already said out loud, so a stroke does not fill the console. */
const announced = new Set<string>()

/** Which backing the ink got, said once. A tablet has no devtools to hand, so a
 *  remote console or a screenshot of one is how this is answered on the device
 *  it matters on. */
function announce(mode: InkMode, wanted: InkMode) {
  const line =
    mode === wanted ? `nib ink: ${mode} backing` : `nib ink: ${mode} backing, ${wanted} refused`
  if (announced.has(line)) return

  announced.add(line)
  // eslint-disable-next-line no-console -- The line the device is diagnosed from.
  console.info(line)
}

export interface InkLayer {
  context: CanvasRenderingContext2D
  /** The mode the context is in, which is not always the one asked for. */
  mode: InkMode
}

/** A context for a layer of ink, and what it turned out to be.
 *
 *  An element cannot be asked for a second context: the attributes of the first
 *  are the ones it keeps, and asking again hands the first one back whatever is
 *  asked for. So a layer that answers in another mode than the one wanted, or
 *  with no context at all - which is what Chromium does when it cannot make the
 *  surface the hint needs - leaves the caller to replace the element and ask
 *  again. */
export function inkLayer(canvas: HTMLCanvasElement, wanted: InkMode): InkLayer | null {
  const context = canvas.getContext('2d', SETTINGS[wanted])
  if (!context) return null

  // An engine old enough to have no `getContextAttributes` has nothing to say
  // about the backing, and the types promise the method is always there.
  const reported = 'getContextAttributes' in context ? context.getContextAttributes() : null

  // A layer that asked for the plain backing has the plain backing, whatever it
  // reports; only one that asked for the hint has anything to find out.
  const mode = wanted === 'latency' ? inkMode({ agent: AGENT, reported }) : wanted
  announce(mode, wanted)
  return { context, mode }
}
