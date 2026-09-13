/** Turning the card a web embed renders as into the frame it stands for, when the
 *  reader asks for it.
 *
 *  One place, because every surface that renders a note shows the same card: the
 *  editor's live preview, the reading view, a canvas card and a slide. The markup
 *  comes from @nib/markdown, which knows the provider, the sandbox it needs and the
 *  permissions it is granted; this only builds the element from what the card
 *  already says. Nothing here decides policy - a surface that could loosen a
 *  sandbox would be a surface where the policy is not the policy.
 *
 *  Which is also why there is nothing to wire per surface beyond the press: the
 *  editor's card carries `embedClicks` in the widget that draws it, a canvas card
 *  carries it on the card, and the reading view and a deck each read a click they
 *  were already reading. The card is styled by one set of rules for all four; see
 *  the Embedded pages section of packages/themes/src/document.css.
 *
 *  A published page has none of this and does not want it: there the card is a
 *  link, and a click goes to the page itself. */

/** The sandbox tokens a card is allowed to ask for. A card comes from the
 *  renderer, but a note can be pasted, synced or shared, and one that arrived
 *  with `allow-top-navigation` written into it would be a note that can move the
 *  window the app is in. So the card says what it wants and this says what it may
 *  have; `allow-same-origin` is on the list because with a cross-origin frame it
 *  grants the frame its own origin, never this one. */
const SANDBOX = new Set([
  'allow-scripts',
  'allow-same-origin',
  'allow-presentation',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
])

/** What a frame tells the provider about where it was asked from: the origin, and
 *  never the page.
 *
 *  `no-referrer` was the first answer here, and it does not work. YouTube refuses
 *  to play to an embedder that sends none and puts "Error 153" where the video
 *  should be, which is worse than the link the card replaced. The origin is what a
 *  provider learns from the request in any case - which site, never which note -
 *  and saying it out loud beats leaving it to whatever the page defaults to. */
export const FRAME_REFERRER = 'origin'

/** The permissions a card may be granted, for the same reason. */
const ALLOW = new Set([
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
])

/** Only over https, and only what a browser will frame. A card written by hand
 *  with a `javascript:` frame in it is a card that gets no frame. */
export function framedPage(address: string): string | null {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function allowed(written: string | undefined, list: ReadonlySet<string>, between: string): string {
  return (written ?? '')
    .split(/[\s;]+/)
    .filter((one) => list.has(one))
    .join(between)
}

/** The sandbox a card may actually have, whatever it asked for. */
export function frameSandbox(written: string | undefined): string {
  return allowed(written, SANDBOX, ' ')
}

/** The permissions a card may actually be granted, whatever it asked for. */
export function framePermissions(written: string | undefined): string {
  return allowed(written, ALLOW, '; ')
}

/** The frame a card stands for, or null when the card does not name one this may
 *  load. */
function frameOf(card: HTMLElement, title: string): HTMLIFrameElement | null {
  const own = card.dataset.srcdoc
  if (own !== undefined) return ownFrame(own, title)

  const source = framedPage(card.dataset.frame ?? '')
  if (source === null) return null

  const frame = document.createElement('iframe')
  frame.className = 'embed-frame'
  frame.setAttribute('sandbox', frameSandbox(card.dataset.sandbox))
  const permissions = framePermissions(card.dataset.allow)
  if (permissions) frame.setAttribute('allow', permissions)
  frame.referrerPolicy = FRAME_REFERRER
  frame.loading = 'lazy'
  frame.title = title
  frame.src = source

  return frame
}

/** The kind on the one message a block of the note's own HTML sends out, so a
 *  frame's word about how tall it is cannot be mistaken for anything else being
 *  shouted on the page. The frame has an opaque origin, so it can only aim at
 *  `*`; the parent also checks the message came from the frame it made, which is
 *  the check that matters. */
const SIZED = 'nib-html-frame'

/** How tall an interactive block may say it is.
 *
 *  A floor because a frame reporting nothing is a frame nobody can press again,
 *  and a ceiling because a block asking for ten thousand pixels is a note that
 *  pushed everything under it off the page. */
const LEAST_HEIGHT = 40
const MOST_HEIGHT = 2400

/** The height a message asks for, or null when it is not one of ours. */
export function frameHeight(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null

  const message = data as Record<string, unknown>
  if (message.nib !== SIZED) return null

  const asked = message.height
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return null

  return Math.min(MOST_HEIGHT, Math.max(LEAST_HEIGHT, Math.ceil(asked)))
}

/** The script the frame says how tall it is with.
 *
 *  Written out as characters rather than as a function of this module's, because
 *  what goes into the document has to be the same whatever a minifier does to the
 *  code around it - and because there is nothing here for the type checker to
 *  learn: it runs in a document that is not this one. */
const REPORT = `(function(){
var post=function(){parent.postMessage({nib:'${SIZED}',height:document.body.scrollHeight},'*')}
if(window.ResizeObserver){new ResizeObserver(post).observe(document.body)}
addEventListener('load',post)
post()
})()`

/** The document a block of the note's own HTML runs in.
 *
 *  The block goes in as it was written - it is the note's own markup, and the
 *  point of the frame is that it does not have to be trusted to be rendered. What
 *  keeps it harmless is the frame around it: sandboxed without
 *  `allow-same-origin`, so the document has an opaque origin and the app's DOM,
 *  storage and notes are all cross-origin to it and throw on being read. The
 *  app's own content policy is inherited on top of that, which is what stops the
 *  block fetching a library from a CDN; see docs/conventions.md.
 *
 *  The reporter goes last so that a block whose own script throws still says how
 *  tall it is, and so that a block ending in a script has run before it says. */
export function htmlFrameDocument(html: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>html</title>
<style>html,body{margin:0;padding:0;background:transparent;color-scheme:light dark}</style>
${html}
<script>${REPORT}</script>
`
}

/** The frame a block of the note's own HTML runs in.
 *
 *  The sandbox is this file's own and not the card's. Every other card names the
 *  sandbox its provider needs, because the table promised what that frame needs;
 *  a document built out of the note itself has promised nothing, and one line of
 *  `allow-same-origin` written into a card would be the note running in the app. */
function ownFrame(html: string, title: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.className = 'embed-frame'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.title = title
  // Set before the frame joins the page, so it has this document to load rather
  // than an empty one to be navigated away from a moment later.
  frame.srcdoc = htmlFrameDocument(html)

  return frame
}

/** Every running block on the page, by the window it runs in, and the card it is
 *  sizing.
 *
 *  One listener for all of them rather than one each, and the map is swept on
 *  every message: a card that has left the page - the note was edited, the pane
 *  was closed - is forgotten then, so nothing is held onto and the listener has
 *  nothing to find. */
const sizing = new Map<MessageEventSource, HTMLElement>()

/** Whether the one listener is on. Said rather than counted off the map, which
 *  empties itself as cards go and would otherwise ask for a second one. */
let listening = false

function sized(event: MessageEvent) {
  for (const [where, card] of sizing) {
    if (!card.isConnected) sizing.delete(where)
  }

  // The only sender that counts is a frame this made. A sandboxed document's
  // origin is opaque and reports as null, so the window is the thing to compare -
  // and it is compared by identity rather than asked what it is, because a
  // cross-origin window answers nothing about itself, `instanceof` included.
  const card = event.source === null ? undefined : sizing.get(event.source)
  if (card === undefined) return

  const height = frameHeight(event.data)
  if (height !== null) card.style.setProperty('--embed-height', `${height}px`)
}

/** Starts listening for how tall a block turned out, and remembers which card to
 *  tell. Called once the frame is on the page, because a frame that is not has no
 *  window to be recognised by yet. */
function sizeWith(card: HTMLElement, frame: HTMLIFrameElement) {
  const where = frame.contentWindow
  if (where === null) return

  if (!listening) {
    listening = true
    window.addEventListener('message', sized)
  }
  sizing.set(where, card)
}

/** Puts the frame where the card was. Returns whether it did: a card already
 *  loaded, or one naming nothing loadable, is left alone. */
export function loadEmbed(card: HTMLElement): boolean {
  if (card.dataset.loaded !== undefined) return false

  // What the card said, before the card stops saying it: the provider's name, or
  // the domain of a page a note framed by hand. Said out loud as the frame's own
  // title so a screen reader hears the same word an eye reads.
  const said = card.textContent.trim()
  const frame = frameOf(card, said || (card.dataset.provider ?? 'embed'))
  if (frame === null) return false

  card.textContent = ''
  card.dataset.loaded = ''
  card.append(frame)

  // A block of the note's own says how tall it turned out to be, which it can
  // only do now: a frame that is not on the page has no window to say it from.
  if (card.dataset.srcdoc !== undefined) sizeWith(card, frame)

  return true
}

/** Listens for a click on any card inside `root` and loads that one. Returns what
 *  undoes it, so a surface can give the listener back. */
export function embedClicks(root: HTMLElement): () => void {
  const clicked = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const card = target.closest('.embed-web')
    if (!(card instanceof HTMLElement)) return

    // The card is a link, and its href is where a page with no script sends the
    // reader. Here there is a script, so the frame arrives in place instead.
    if (loadEmbed(card)) event.preventDefault()
  }

  root.addEventListener('click', clicked)
  return () => root.removeEventListener('click', clicked)
}
