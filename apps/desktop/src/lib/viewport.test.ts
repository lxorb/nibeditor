import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** Two things the store answers, and one it publishes.
 *
 *  The keyboard reaches the layout in two different shapes, and the store has to
 *  read both as the same thing. In a browser the page keeps its height and the
 *  keys cover the bottom of it, so the visual viewport is shorter than the
 *  window. In the phone app the window itself is made shorter, so the two agree
 *  and the only trace of the keyboard is the height that has gone.
 *
 *  The device class is the other: which of phone, tablet and desktop this
 *  window is, said once here and written on the document so no stylesheet can
 *  come to a different conclusion about the same screen. It is settled from the
 *  machine and not from the width - a window is not a device - so what is covered
 *  is every combination of the three signals that decide it. */

const KEYS = 340

/** What a machine says about itself. The defaults are a plain desktop browser:
 *  no app around the page, a desktop user agent, and a pointer that hovers. */
interface Kind {
  /** The native Android or iOS build. */
  app?: boolean
  agent?: string
  /** `navigator.userAgentData.mobile`, where the browser has it. */
  mobile?: boolean | null
  /** Whether the primary pointer is a finger. */
  finger?: boolean
}

/** The strings the browsers actually send, trimmed to the tokens that matter. */
const AGENTS = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  phone:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  // Chrome on an Android tablet says nothing about being one: `Android` is the
  // whole of it, and `userAgentData.mobile` is false.
  tablet:
    'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  // What "Desktop site" rewrites the phone's into: a Linux desktop, with every
  // handheld token gone.
  asked: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  // An iPad, which since iPadOS 13 calls itself a Mac.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605',
} as const

/** The document as the store writes to it: the attributes it publishes, and
 *  the inline properties the insets would go into. And how tall the page is laid
 *  out, which is the window's layout height and not whatever `innerHeight` says. */
function stubDocument(window: { layout: number }) {
  const attributes = new Set<string>()

  return {
    documentElement: {
      get clientHeight() {
        return window.layout
      },
      dataset: {} as Record<string, string>,
      attributes,
      toggleAttribute: (name: string, on: boolean) =>
        on ? attributes.add(name) : attributes.delete(name),
      style: { setProperty: () => undefined },
    },
  }
}

/** A window of a given size, with the two heights a test can move apart. */
function stubWindow(width = 390, height = 844, finger = false) {
  const resized: (() => void)[] = []
  const turned: (() => void)[] = []

  const seen = {
    width,
    height,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_kind: string, run: () => void) => void resized.push(run),
    removeEventListener: () => undefined,
  }

  return {
    innerWidth: width,
    innerHeight: height,
    /** The height the page is laid out to, which is what the keys are measured
     *  against. Moves with the window, and not with WebKit's `innerHeight`. */
    layout: height,
    visualViewport: seen,
    // Two queries are asked of this: whether the glass is under a finger, and
    // whether the page is installed rather than a tab.
    matchMedia: (query: string) => ({
      matches: query.includes('pointer: coarse') ? finger : false,
      addEventListener: () => undefined,
    }),
    addEventListener: (_kind: string, run: () => void) => void turned.push(run),
    /** Where the page was last scrolled to by the store. */
    scrolled: null as [number, number] | null,
    scrollTo(x: number, y: number) {
      this.scrolled = [x, y]
    },
    /** What the browser does when the keys come up over the page. */
    keysOver(pixels: number) {
      seen.height = height - pixels
      for (const run of resized) run()
    },
    /** What an iPhone does besides: the whole page slid up to show the caret's
     *  line, which moves the visual viewport down the page by as much. */
    keysOverSliding(pixels: number, slid: number) {
      seen.height = height - pixels
      seen.offsetTop = slid
      for (const run of resized) run()
    },
    /** And what it says as the page scrolls with the keys up: a window no taller
     *  than what can be seen, when nothing about the window has changed. */
    innerShrinks() {
      this.innerHeight = seen.height
      for (const run of resized) run()
    },
    /** What the app does instead: the page ends where the keys begin. */
    keysBelow(pixels: number) {
      seen.height = height - pixels
      this.innerHeight = height - pixels
      this.layout = height - pixels
      for (const run of resized) run()
    },
    /** Turned on its side, which is a new window rather than a keyboard. */
    turned() {
      this.innerWidth = height
      this.innerHeight = width
      this.layout = width
      seen.width = height
      seen.height = width
      for (const run of [...turned, ...resized]) run()
    },
  }
}

/** A fresh store, because whether this is the phone app is decided once, when
 *  the module is first read. */
async function started(kind: Kind = {}, width = 390, height = 844) {
  const window = stubWindow(width, height, kind.finger ?? false)
  const document = stubDocument(window)
  vi.resetModules()
  vi.doMock('./tauri', () => ({ isMobile: kind.app ?? false }))
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('navigator', {
    userAgent: kind.agent ?? AGENTS.desktop,
    ...(kind.mobile === undefined || kind.mobile === null
      ? {}
      : { userAgentData: { mobile: kind.mobile } }),
  })

  const { pageHeight, viewport } = await import('./viewport.svelte')
  viewport.start()

  return { pageHeight, viewport, window, root: document.documentElement }
}

/** The signals `deviceFor` reads, as one of these describes them. */
async function machine(kind: Kind = {}) {
  const { deviceFor } = await import('./viewport.svelte')

  return (width: number, height: number) =>
    deviceFor(width, height, {
      native: kind.app ?? false,
      handheld: kind.mobile ?? null,
      agent: kind.agent ?? AGENTS.desktop,
      finger: kind.finger ?? false,
    })
}

beforeAll(async () => {
  // Reading the store compiles its runes, and on a cold cache that costs more
  // than a test is given. A hook is allowed longer, so the first read is here.
  await started()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('./tauri')
})

describe('the keyboard', () => {
  test('in a browser it covers the page, and the page says by how much', async () => {
    const { viewport, window } = await started()
    expect(viewport.typing).toBe(false)
    expect(viewport.keyboard).toBe(0)

    window.keysOver(KEYS)
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.height).toBe(844 - KEYS)
    expect(viewport.typing).toBe(true)

    window.keysOver(0)
    expect(viewport.keyboard).toBe(0)
    expect(viewport.typing).toBe(false)
  })

  test('in the app it takes the height instead, and nothing is covered', async () => {
    const { viewport, window } = await started({ app: true })

    window.keysBelow(KEYS)
    expect(viewport.keyboard).toBe(0)
    expect(viewport.height).toBe(844 - KEYS)
    expect(viewport.typing).toBe(true)

    window.keysBelow(0)
    expect(viewport.typing).toBe(false)
  })

  /** The page is put back where it was (see `measure`), and the keys are as tall as
   *  they are, not less the slide: measured from where the page was slid to, a slide
   *  of the whole keyboard's height left none at all, and the format bar that stands
   *  on the keys stood at the foot of the window, behind them. */
  test('an iPhone sliding the page up to the caret is put back, and the keys measured whole', async () => {
    const { viewport, window } = await started({ app: true, finger: true })

    window.keysOverSliding(KEYS, KEYS)
    expect(window.scrolled).toEqual([0, 0])
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.typing).toBe(true)
  })

  /** Measured against `innerHeight`, the next scroll with the keys up said there
   *  were none, and the format bar that stands on them dropped to the foot of the
   *  window, behind them. */
  test('an iPhone saying its window shrank as the page scrolled still has its keys', async () => {
    const { viewport, window } = await started({ app: true, finger: true })

    window.keysOver(KEYS)
    window.innerShrinks()
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.typing).toBe(true)
  })

  test('a browser window made shorter by hand is not a keyboard', async () => {
    const { viewport, window } = await started()

    window.keysBelow(KEYS)
    expect(viewport.typing).toBe(false)
  })

  test('a few pixels of browser chrome sliding away is not one either', async () => {
    const { viewport, window } = await started()

    window.keysOver(60)
    expect(viewport.typing).toBe(false)
  })

  test('turning the phone is a new window, not a keyboard', async () => {
    const { viewport, window } = await started({ app: true })

    window.turned()
    expect(viewport.typing).toBe(false)
    expect(viewport.height).toBe(390)
  })
})

/** The machine first, the width second. Every case is one of the six ways a
 *  screen reaches the app. */
describe('which device this is', () => {
  test('the app on a phone is a phone, either way up', async () => {
    const device = await machine({ app: true })

    expect(device(390, 844)).toBe('phone')
    expect(device(844, 390)).toBe('phone')
  })

  test('the app on a tablet is a tablet, not a phone with a big screen', async () => {
    const device = await machine({ app: true })

    expect(device(800, 1280)).toBe('tablet')
    expect(device(1280, 800)).toBe('tablet')
    // A small tablet held upright is still a tablet.
    expect(device(600, 960)).toBe('tablet')
  })

  test('a phone browser is a phone: it says so, and the glass says so', async () => {
    const phone = await machine({ agent: AGENTS.phone, mobile: true, finger: true })

    expect(phone(412, 915)).toBe('phone')
    expect(phone(915, 412)).toBe('phone')
  })

  /** A tablet's browser says `mobile: false` and puts no token but `Android` in
   *  its user agent, so the string is what answers for it. */
  test('a tablet browser is a tablet, though it calls itself no such thing', async () => {
    const tablet = await machine({ agent: AGENTS.tablet, mobile: false, finger: true })
    expect(tablet(800, 1280)).toBe('tablet')

    // And an iPad, which calls itself a Mac: a Mac never has the glass under a
    // finger, so the pair of signals is unambiguous.
    const ipad = await machine({ agent: AGENTS.ipad, finger: true })
    expect(ipad(1024, 768)).toBe('tablet')
  })

  test('a phone asked for the desktop site is a desktop, which is the point', async () => {
    // The tick rewrites the user agent and widens the viewport. Nothing about
    // the glass changes, so the user agent is what has to be believed.
    const asked = await machine({ agent: AGENTS.asked, mobile: false, finger: true })

    expect(asked(980, 1743)).toBe('desktop')
    // Even at the width the phone had before the tick.
    expect(asked(412, 915)).toBe('desktop')
  })

  /** The two halves of what a browser says about itself can disagree - a hint
   *  left behind by a tick that rewrote the string, and every device toolbar that
   *  fakes one and not the other. The string wins: it is the half the reader's own
   *  tick rewrites, and the half every browser has. */
  test('and it is a desktop even if the hint beside the string says otherwise', async () => {
    const asked = await machine({ agent: AGENTS.asked, mobile: true, finger: true })

    expect(asked(980, 1743)).toBe('desktop')
  })

  test('a desktop window dragged narrow stays a desktop', async () => {
    const desktop = await machine()

    expect(desktop(420, 900)).toBe('desktop')
    expect(desktop(320, 700)).toBe('desktop')
    expect(desktop(1280, 800)).toBe('desktop')
  })

  test('a desktop with a touch screen is a desktop', async () => {
    // Whether it reports a fine pointer beside the touch screen or nothing but
    // a coarse one: no browser on it names a handheld.
    expect((await machine({ finger: false }))(1280, 800)).toBe('desktop')
    expect((await machine({ finger: true }))(1280, 800)).toBe('desktop')
  })

  test('and a touch screen alone is not a handheld either', async () => {
    // The other half of the pair: a phone's user agent with a pointer that
    // hovers is a desktop browser pretending, which is what a developer's
    // device toolbar does.
    const spoofed = await machine({ agent: AGENTS.phone, mobile: true, finger: false })
    expect(spoofed(412, 915)).toBe('desktop')
  })
})

describe('what the document is told', () => {
  test('the app on a tablet: touch, and the drawer while it is upright', async () => {
    const upright = await started({ app: true }, 800, 1280)

    expect(upright.viewport.device).toBe('tablet')
    expect(upright.viewport.touch).toBe(true)
    expect(upright.viewport.narrow).toBe(false)
    expect(upright.root.dataset.device).toBe('tablet')
    expect(upright.viewport.drawer).toBe(true)
    expect(upright.root.attributes.has('data-drawer')).toBe(true)

    upright.window.turned()
    expect(upright.viewport.portrait).toBe(false)
    expect(upright.viewport.drawer).toBe(false)
    expect(upright.root.attributes.has('data-drawer')).toBe(false)
    expect(upright.root.attributes.has('data-touch')).toBe(true)
  })

  test('a desktop browser: no touch, and no drawer', async () => {
    const { viewport, root } = await started({}, 1280, 800)

    expect(viewport.device).toBe('desktop')
    expect(viewport.touch).toBe(false)
    expect(viewport.installed).toBe(false)
    expect(root.attributes.has('data-touch')).toBe(false)
  })

  /** The width is still published, for whatever layout depends on the width. It
   *  says nothing about which device this is: a desktop window this narrow wears
   *  the same flag and keeps its columns. */
  test('the width, whichever device it is', async () => {
    const phone = await started({ app: true }, 390, 844)
    expect(phone.viewport.narrow).toBe(true)
    expect(phone.root.attributes.has('data-narrow')).toBe(true)

    phone.window.turned()
    expect(phone.viewport.device).toBe('phone')
    expect(phone.viewport.drawer).toBe(true)
    // 844 wide is a phone on its side: past the narrow mark, still one column.
    expect(phone.viewport.narrow).toBe(false)
    expect(phone.root.attributes.has('data-narrow')).toBe(false)

    const window = await started({}, 420, 900)
    expect(window.viewport.device).toBe('desktop')
    expect(window.viewport.narrow).toBe(true)
    expect(window.root.attributes.has('data-narrow')).toBe(true)
    expect(window.root.attributes.has('data-drawer')).toBe(false)
  })
})

/** A page that fills the screen - the settings are one - is as tall as what is
 *  on screen, which on a touch device is not the window. */
describe('a page that fills the screen', () => {
  test('is the viewport, and gives the keyboard its share back', async () => {
    const { pageHeight, window } = await started({ app: true })
    expect(pageHeight()).toBe('844px')

    window.keysOver(KEYS)
    expect(pageHeight()).toBe(`${844 - KEYS}px`)
  })

  test('is the window everywhere else, which CSS can say on its own', async () => {
    const { pageHeight } = await started({}, 1280, 800)
    expect(pageHeight()).toBe(undefined)
  })
})
