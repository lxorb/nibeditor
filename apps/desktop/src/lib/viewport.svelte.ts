/** What the layout has to answer to that a stylesheet cannot see on its own:
 *  which of the three kinds of device this is, which way it is being held, how
 *  much of the window the on-screen keyboard is covering, and whether somebody
 *  is typing at all. The last two come from the visual viewport, which is the
 *  only thing that shrinks when the keyboard opens.
 *
 *  The device is settled here, once, and written on the document as well: every
 *  rule that used to key off a width now keys off `html[data-device]`, and off
 *  `data-touch`, `data-drawer` and `data-narrow` beside it, so the markup and the
 *  stylesheet cannot come to different conclusions about the same screen. Those
 *  four and no others; see `shape`.
 *
 *  It is settled from the machine rather than from the width; see `deviceFor`.
 *  A window is not a device, and the width is only ever asked which handheld
 *  this is. */

import { startInsets } from './insets'
import { isMobile } from './tauri'

/** The three shapes the app comes in. A phone is one column with the sidebar as
 *  a drawer over it. A tablet is that same drawer in portrait and a sidebar
 *  beside the note in landscape, sized for fingers either way. A desktop is
 *  columns and a pointer. */
export type Device = 'phone' | 'tablet' | 'desktop'

/** At or below this on its narrow side a handheld is a phone rather than a
 *  tablet: a phone laid on its side is 844 points wide and still a phone, and a
 *  small tablet held upright is 600 and still a tablet. */
const PHONE_SIDE = 500
/** A screen so narrow that the drawer, open, covers all of it. */
const NARROW = 460

/** How much of the window has to go before it counts as a keyboard rather than
 *  a few pixels of browser chrome sliding away. */
const KEYBOARD_THRESHOLD = 120

/** The primary pointer is a finger rather than something that can hover. */
const FINGER = '(hover: none) and (pointer: coarse)'

/** The tokens a handheld names itself with. A phone says `Mobile` in every
 *  browser there is, Firefox says `Tablet` on one, and an Android tablet in
 *  Chrome says only `Android`. Asking a browser for the desktop site takes every
 *  one of these out of the string, which is exactly what makes the checkbox work
 *  here.
 *
 *  `Macintosh` is in the list because an iPad calls itself one: since iPadOS 13
 *  Safari there says Macintosh and nothing else, and so does Safari on an iPhone
 *  asked for the desktop site. It only ever reaches this test with the glass
 *  under a finger, which no Mac has - a Mac has a trackpad, and answers the
 *  pointer query with `hover: hover`. */
const HANDHELD =
  /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|BlackBerry|Opera Mini|IEMobile|Macintosh/

/** What the app is told about the machine, as against what it can measure about
 *  the window. */
export interface Machine {
  /** The native Android or iOS build, rather than a page in a browser. */
  native: boolean
  /** `navigator.userAgentData.mobile`: true on a phone, false on anything else
   *  that answers it, and null in a browser that has no such thing to ask. */
  handheld: boolean | null
  /** The user agent string: the one signal every browser has, and the one that
   *  "Desktop site" rewrites. */
  agent: string
  /** Whether the primary pointer is a finger; see FINGER. */
  finger: boolean
}

/** Which of the three this is.
 *
 *  The machine decides, and the width only tells a phone from a tablet. That
 *  order is the whole point: a window is not a device, and a reader who ticks
 *  "Desktop site" is asking for the desktop app however small the screen is. So
 *  a browser has to say it is a handheld - in `navigator.userAgentData.mobile`
 *  or in the tokens of its user agent - and the glass has to be under a finger
 *  rather than a pointer, and only then is the width asked which handheld it is.
 *
 *  Both halves have to agree, which is what keeps a desktop with a touch screen a
 *  desktop: it has a mouse to hover with, so the pointer half says no. And a
 *  desktop window dragged narrow stays a desktop, with `data-narrow` left to say
 *  what the layout should do about the width.
 *
 *  The native builds are not asked any of this. An Android or iOS build is a
 *  handheld because it is one, and only its shape is in question. */
export function deviceFor(width: number, height: number, machine: Machine): Device {
  if (!machine.native && !handheld(machine)) return 'desktop'

  return Math.min(width, height) <= PHONE_SIDE ? 'phone' : 'tablet'
}

/** The platform tokens only a desktop sends, and which "Desktop site" writes in
 *  place of the handheld's own. They have the last word over the hint beside the
 *  string: Chrome rewrites both when the tick goes on, but the string is the half
 *  that has always been rewritten and the half every browser has, and a reader who
 *  asked for the desktop must get it.
 *
 *  `Macintosh` is deliberately not among them - an iPad says it too, and telling
 *  those apart is what the finger is for. */
const DESKTOP = /Windows NT|X11|CrOS/

/** Whether a browser is being read on a handheld at all. */
function handheld(machine: Machine): boolean {
  if (!machine.finger || DESKTOP.test(machine.agent)) return false

  return machine.handheld === true || HANDHELD.test(machine.agent)
}

/** `navigator.userAgentData`, which the DOM types have no name for. Only the one
 *  field is ever read, and a browser without it answers nothing. */
interface UserAgentData {
  mobile?: boolean
}

class Viewport {
  /** Pixels of the window hidden behind the keyboard. Zero when it is closed,
   *  and zero in the phone app, where the window is made shorter to sit above
   *  the keyboard rather than left under it. */
  keyboard = $state(0)
  /** Whether the keyboard is up, however this platform makes room for it. What
   *  everything that gets out of the way while a note is being written reads. */
  typing = $state(false)
  /** How tall the format bar standing on the keyboard is, while it stands there:
   *  the bottom of the note it covers, which the editor keeps the caret above. Set
   *  by FormatBar.svelte, and nought whenever there is no such bar. */
  covered = $state(0)
  /** How tall the page is right now. Read by whatever has to be scrolled back
   *  into sight each time the keyboard takes some of it away. */
  height = $state(0)
  /** Which kind of screen this is; see `deviceFor`. */
  device = $state<Device>('desktop')
  /** Taller than it is wide. Only a tablet reads it, to know whether there is
   *  room for the sidebar to stay open beside the note. */
  portrait = $state(false)
  /** A screen so narrow that a drawer, open, covers all of it. Width alone, so
   *  it is there to be read by any layout that depends on the width - it says
   *  nothing about which device this is. */
  narrow = $state(false)
  /** True while the app is running as an installed app rather than a tab. */
  installed = $state(false)

  /** Fingers rather than a pointer: thumb-sized targets, sheets instead of
   *  dropdowns, one note at a time. Both the phone and the tablet. */
  touch = $derived(this.device !== 'desktop')
  /** The sidebar is a drawer over the note rather than a column beside it, so
   *  it is what a swipe drags and what the scrim dims. A tablet on its side has
   *  room for both and keeps the sidebar open, the way tablet apps do. */
  drawer = $derived(this.device === 'phone' || (this.device === 'tablet' && this.portrait))

  private started = false
  /** Whether the primary pointer is a finger, as a query that can be asked again:
   *  plugging a mouse into a tablet, or unplugging one, changes the answer and
   *  with it which device this is. */
  private glass: MediaQueryList | null = null

  /** The tallest the page has been since the window was last this wide, which
   *  is the page with no keyboard making room for itself. Per width, so turning
   *  the phone on its side starts the measurement again. */
  private tallest = 0
  private atWidth = 0

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    // What the system bars leave for the page, which on Android only the
    // activity knows; see insets.ts.
    startInsets()

    const shape = () => this.shape()

    // Asked before the first shape, since the shape is read off it. A browser
    // that cannot answer the query at all reads as a pointer, which is the
    // desktop the web app has always been.
    this.glass = window.matchMedia(FINGER)
    this.glass.addEventListener('change', shape)

    this.shape()
    window.addEventListener('resize', shape)
    window.addEventListener('orientationchange', shape)

    // Standalone, not fullscreen: the phone's clock and battery stay visible.
    const standalone = window.matchMedia('(display-mode: standalone)')
    this.installed = isMobile || standalone.matches
    standalone.addEventListener('change', (event) => (this.installed = isMobile || event.matches))

    const seen = window.visualViewport
    if (!seen) return

    const measure = () => this.measure(seen)

    measure()
    seen.addEventListener('resize', measure)
    seen.addEventListener('scroll', measure)
  }

  /** Which device this is and which way up, from the window as it stands, said
   *  once in these fields and once on the document for the stylesheets. Every
   *  rule that used to ask a width asks one of these instead, so there is no
   *  screen on which the markup says phone and the stylesheet says desktop.
   *
   *  Orientation is the window's own shape rather than the screen's: no
   *  keyboard is deep enough to turn a screen held upright into one on its
   *  side, and reading the window keeps a browser window dragged into a tall
   *  shape honest as well. */
  private shape() {
    const width = window.innerWidth
    const height = window.innerHeight
    this.device = deviceFor(width, height, this.machine())
    this.portrait = height >= width
    this.narrow = width <= NARROW

    const root = document.documentElement
    root.dataset.device = this.device
    root.toggleAttribute('data-touch', this.touch)
    root.toggleAttribute('data-drawer', this.drawer)
    root.toggleAttribute('data-narrow', this.narrow)
  }

  /** What this machine says about itself, read afresh each time the shape is
   *  settled: the query above can change under a mouse being plugged in, and the
   *  rest costs nothing to ask again. */
  private machine(): Machine {
    const said: (Navigator & { userAgentData?: UserAgentData }) | null =
      typeof navigator === 'undefined' ? null : navigator
    const hints = said?.userAgentData

    return {
      native: isMobile,
      handheld: typeof hints?.mobile === 'boolean' ? hints.mobile : null,
      agent: said?.userAgent ?? '',
      finger: this.glass?.matches ?? false,
    }
  }

  private measure(seen: VisualViewport) {
    // What the layout viewport has that the visual one does not. Scrolling the
    // page moves `offsetTop`, so it has to come off as well or the bar jumps
    // while the document scrolls under the keyboard.
    const hidden = window.innerHeight - (seen.height + seen.offsetTop)
    this.keyboard = Math.max(0, Math.round(hidden))
    this.height = Math.round(seen.height)
    // And on the document, for the sheets pinned to the bottom of the screen: on an
    // iPhone the keys cover the page rather than shortening it, and a sheet left at
    // `bottom: 0` is a field somebody types into without seeing it. See tokens.css.
    document.documentElement.style.setProperty('--keyboard', `${this.keyboard}px`)

    const full = this.height + this.keyboard
    if (seen.width !== this.atWidth) {
      this.atWidth = seen.width
      this.tallest = 0
    }
    this.tallest = Math.max(this.tallest, full)

    // In the phone app the keyboard is not over the page at all: the window is
    // padded by its height so the page ends where the keys begin, and the only
    // trace of it is the height the window has lost. See MainActivity.kt. In a
    // browser the page keeps its height and the keyboard covers the bottom of
    // it, which is what `keyboard` measures. A desktop window is only ever
    // resized by the person using it, so nothing there is read as a keyboard.
    const shorter = isMobile ? this.tallest - full : 0
    this.typing = Math.max(this.keyboard, shorter) > KEYBOARD_THRESHOLD

    // The page is sized to what can be seen (`pageHeight`) and never scrolls itself,
    // but WebKit still slides the whole of it up to show a line under the keyboard
    // before the editor has had the chance to - taking the app's bar off the top of
    // the screen. So a page moved that way is put back, and the editor brings the
    // line into sight inside its own scroller. Never at any zoom but the page's own:
    // a pinch in a phone's browser moves the same offset, and that is the reader's.
    if (this.touch && seen.offsetTop > 0 && Math.abs(seen.scale - 1) < 0.01) {
      window.scrollTo(0, 0)
    }
  }
}

export const viewport = new Viewport()

/** How tall a page that fills the screen should be drawn, or nothing while
 *  there is no measurement yet and the stylesheet's `100dvh` is the best answer
 *  going.
 *
 *  A touch device's page is the visual viewport rather than the window: the
 *  keyboard covers the bottom of the window and takes none of its height away,
 *  so a page sized from the window ends underneath the keys with its last rows
 *  out of reach. Everywhere else the window is the page and CSS can say so on
 *  its own. */
export function pageHeight(): string | undefined {
  return viewport.touch && viewport.height ? `${viewport.height}px` : undefined
}
